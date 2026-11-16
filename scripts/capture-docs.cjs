// Captures the cut-outs for the store images (store/cutouts/*.png) from the real windows.
// Runs the real electron/main.js with a throw-away profile (your settings are not touched) and a fake desktop as
// the frozen "screen". Compose the store images afterwards with `python scripts/store-mockup.py`.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron scripts/capture-docs.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CUT = path.join(ROOT, 'store', 'cutouts');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SCENE = fs.readFileSync(path.join(__dirname, 'demo-scene.js'), 'utf8');
const { SCENE_INFO } = require('./demo-scene.js');
const dataUrl = (file) => `data:image/jpeg;base64,${fs.readFileSync(path.join(ROOT, 'store', 'gen', file)).toString('base64')}`;
const IMAGES = { pic: dataUrl('halong-card.jpg'), sky: dataUrl('sky-d.jpg') };

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sm2-docs-')));
fs.mkdirSync(CUT, { recursive: true });
require(path.join(ROOT, 'electron', 'main.js'));

const prefs = { preload: path.join(ROOT, 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false };

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(CUT, name), image.toPNG());
  console.log('wrote', name, image.getSize());
}

// A window of logical size w x h, drawn at `zoom` times the pixels so the capture is crisp.
async function open(page, w, h, zoom, transparent) {
  const win = new BrowserWindow({
    width: Math.round(w * zoom), height: Math.round(h * zoom), useContentSize: true, frame: false, show: true, resizable: false,
    transparent: !!transparent, backgroundColor: transparent ? '#00000000' : '#0b0c10', webPreferences: prefs
  });
  await win.loadFile(path.join(ROOT, 'public', page));
  win.webContents.setZoomFactor(zoom);
  return win;
}

// Draws the fake desktop once and returns it as PNG bytes (what the main process sends as the frozen screen).
async function sceneBytes(win) {
  const url = await win.webContents.executeJavaScript(`${SCENE}
    (async () => {
      const load = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
      const imgs = { pic: await load(${JSON.stringify(IMAGES.pic)}), sky: await load(${JSON.stringify(IMAGES.sky)}) };
      const c = document.createElement('canvas');
      c.width = 1920; c.height = 1080;
      drawScene(c.getContext('2d'), 1920, 1080, imgs);
      return c.toDataURL('image/png');
    })()`);
  return Buffer.from(url.split(',')[1], 'base64');
}

// Opens a full-screen lens window like main.js does, moves the pointer to `at`, steps the zoom with the wheel and
// captures the whole 1920x1080 window. store-mockup.py crops around the lens.
async function lens({ name, image, shape, style, method, size, at, wheels }) {
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, frame: false, show: true, backgroundColor: '#000000', webPreferences: prefs });
  await win.loadFile(path.join(ROOT, 'public', 'lens.html'));
  win.focus();
  win.webContents.focus();
  win.webContents.send('lens:init', {
    image, live: false, sourceId: null, physical: { width: 1920, height: 1080 }, shape, sizePercent: size, lensMaxScale: 2, lensStyle: style,
    method, aiMaxSize: -1, aiDevice: 'gpu', cursor: at
  });
  await sleep(2500);
  const act = (body) => win.webContents.executeJavaScript(`(() => { ${body} })()`);
  await act(`window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: ${at.x}, clientY: ${at.y}, bubbles: true }))`);
  for (let i = 0; i < wheels; i += 1) {
    await act(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: ${at.x}, clientY: ${at.y}, bubbles: true, cancelable: true }))`);
    await sleep(120);
  }
  // Time for the AI pass on the final view (the first pass loads the model); a filter only has to let the x-badge fade (1.6 s).
  await sleep(method.startsWith('real') || method.startsWith('nomos') ? 7000 : 2300);
  await shot(win, name);
  win.destroy();
}

app.whenReady().then(async () => {
  await sleep(2500);
  const boot = BrowserWindow.getAllWindows()[0];
  await boot.webContents.executeJavaScript('window.api.settings.set({ aiDevice: "gpu" })');

  // Main and settings windows (transparent, like the real ones), at 2x.
  const main = await open('index.html', 290, 120, 2, true);
  await sleep(500);
  await shot(main, 'main.png');
  const settings = await open('settings.html', 290, 454, 2, true);
  await sleep(500);
  await shot(settings, 'settings.png');
  main.close();
  settings.close();

  const image = await sceneBytes(boot);
  const sails = { x: 765, y: 500 };
  const flowers = { x: 650, y: 825 };

  // The same spot at x8: nearest against Real-ESRGAN.
  await lens({ name: 'lens-nearest.png', image, shape: 'ellipse', style: 'clean', method: 'nearest', size: 18, at: sails, wheels: 6 });
  await lens({ name: 'lens-ai.png', image, shape: 'ellipse', style: 'clean', method: 'realesrgan', size: 18, at: sails, wheels: 6 });
  // The three lens looks.
  await lens({ name: 'lens-classic.png', image, shape: 'ellipse', style: 'classic', method: 'realesrgan', size: 22, at: sails, wheels: 4 });
  await lens({ name: 'lens-bold.png', image, shape: 'rect', style: 'bold', method: 'realesrgan', size: 22, at: flowers, wheels: 5 });
  await lens({ name: 'lens-clean.png', image, shape: 'rect', style: 'clean', method: 'realesrgan', size: 22, at: flowers, wheels: 5 });

  app.exit(0);
});
