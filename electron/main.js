const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

const APP_NAME = 'ScreenMagnify2';
const SHAPES = ['rect', 'ellipse'];
const METHOD_IDS = ['nearest', 'bilinear', 'bicubic-catmull', 'lanczos3', 'nis', 'nomos-span', 'realesrgan', 'realesrgan-x4plus'];
// GPU-only methods fall back on the CPU (keep in sync with `fallback` in public/js/methods.js).
const GPU_ONLY = { nis: 'lanczos3', 'realesrgan-x4plus': 'realesrgan' };
const LENS_STYLES = ['clean', 'bold', 'classic'];
const DEFAULT_SETTINGS = { alwaysOnTop: true, freeze: true, delay: 0, theme: 'dark', shape: 'rect', lensSize: 10, lensStyle: 'clean', method: 'realesrgan', aiDevice: 'cpu', aiMaxSize: -1, lensMaxScale: 2, lastSaveDir: '', customPaths: [] };

let settings = { ...DEFAULT_SETTINGS, customPaths: [] };
let mainWindow = null;
let settingsWindow = null;
let lensWindows = [];
let lensModalOpen = false; // the save dialog is open in a lens window
let settingsWasOpen = false;
let aiWorker = null;
let aiSeq = 0;
let aiProvider = null;
const aiPending = new Map();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.setAppUserModelId('com.screenmagnify2.app');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function validateSettings() {
  settings.alwaysOnTop = !!settings.alwaysOnTop;
  settings.freeze = settings.freeze !== false;
  settings.delay = Math.max(0, Math.min(10, Math.round(Number(settings.delay) || 0)));
  if (!SHAPES.includes(settings.shape)) settings.shape = DEFAULT_SETTINGS.shape;
  if (settings.theme !== 'light' && settings.theme !== 'dark') settings.theme = 'dark';
  if (!LENS_STYLES.includes(settings.lensStyle)) settings.lensStyle = DEFAULT_SETTINGS.lensStyle;
  if (!METHOD_IDS.includes(settings.method)) settings.method = DEFAULT_SETTINGS.method;
  if (settings.aiDevice !== 'gpu') settings.aiDevice = 'cpu';
  if (settings.aiDevice !== 'gpu' && GPU_ONLY[settings.method]) settings.method = GPU_ONLY[settings.method];
  // 0 = automatic (per model and device), -1 = the whole lens region; otherwise the largest region side in px.
  const aiMax = Number(settings.aiMaxSize);
  settings.aiMaxSize = aiMax === -1 ? -1 : Math.max(0, Math.min(1536, Math.round(aiMax) || 0));
  settings.lensSize = Math.max(5, Math.min(40, Math.round(Number(settings.lensSize) || 10)));
  // Largest Ctrl+wheel size as a multiple of the start size (whole number, 1 to 5).
  settings.lensMaxScale = Math.max(1, Math.min(5, Math.round(Number(settings.lensMaxScale) || 2)));
  if (typeof settings.lastSaveDir !== 'string') settings.lastSaveDir = '';
  if (!Array.isArray(settings.customPaths)) settings.customPaths = [];
  settings.customPaths = settings.customPaths
    .filter((item) => item && typeof item.path === 'string' && item.path.trim())
    .map((item) => ({
      label: String(item.label || path.basename(item.path) || item.path),
      path: path.resolve(item.path)
    }))
    .filter((item, index, list) => list.findIndex((other) => other.path === item.path) === index)
    .slice(0, 12);
}

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS, customPaths: [] };
  }
  validateSettings();
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    // Write a temp file and rename it, so a crash in the middle cannot leave a half-written settings.json.
    const tmp = `${settingsFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, settingsFile());
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const preloadPath = () => path.join(__dirname, 'preload.js');
const iconPath = () => path.join(__dirname, '..', 'public', 'assets', 'icon.png');
const webPreferences = () => ({ preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false });

// Windows only ever show our own local pages: no navigation, no new windows.
function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

// Settings may only be changed from the main and settings windows.
function fromPanel(event) {
  return [mainWindow, settingsWindow].some((win) => win && !win.isDestroyed() && win.webContents === event.sender);
}

function reportError(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lens:error', message);
}

function panelOptions(extra) {
  return {
    useContentSize: true,
    resizable: false,
    maximizable: false,
    frame: false,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    icon: iconPath(),
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: webPreferences(),
    ...extra
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow(panelOptions({ width: 290, height: 120, title: APP_NAME }));
  mainWindow.setContentProtection(true);
  hardenWindow(mainWindow);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    closeLens();
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
  });
}

function toggleSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
    return;
  }
  const bounds = mainWindow.getBounds();
  settingsWindow = new BrowserWindow(panelOptions({
    x: bounds.x,
    y: bounds.y + bounds.height + 8,
    width: 290,
    height: 454,
    minimizable: false,
    title: `${APP_NAME} 설정`
  }));
  settingsWindow.setContentProtection(true);
  hardenWindow(settingsWindow);
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, '..', 'public', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Capture every display once and show each one frozen in its own full-display window.
async function startLens() {
  try {
    return await openLens();
  } catch (error) {
    console.error('Lens failed:', error);
    closeLens();
    finishLens();
    reportError(`돋보기를 시작하지 못했습니다: ${error.message}`);
    return { ok: false };
  }
}

// Esc closes the lens, except while the save dialog is open: then it only closes the dialog.
function onEscape() {
  if (lensModalOpen) {
    for (const win of lensWindows) if (!win.isDestroyed()) win.webContents.send('lens:escape');
    return;
  }
  closeLens();
}

function closeLens() {
  lensModalOpen = false;
  for (const win of lensWindows) if (!win.isDestroyed()) win.destroy();
  lensWindows = [];
}

async function openLens() {
  if (lensWindows.length) return { ok: false };
  settingsWasOpen = !!(settingsWindow && !settingsWindow.isDestroyed());
  if (settingsWasOpen) settingsWindow.close();
  mainWindow.hide();
  // Let the countdown run and the main window disappear before grabbing pixels.
  await new Promise((resolve) => setTimeout(resolve, settings.delay * 1000 + 250));

  const cursor = screen.getCursorScreenPoint();
  const cursorDisplay = screen.getDisplayNearestPoint(cursor);
  const shots = [];
  const live = !settings.freeze;
  const displays = screen.getAllDisplays();
  for (const [index, display] of displays.entries()) {
    const physical = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
    // Frozen: grab one full-size picture. Live: only the source id is needed, the window streams the screen itself.
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: live ? { width: 1, height: 1 } : physical });
    // display_id can be empty on some capture backends: fall back to the same position in the list.
    const source = sources.find((src) => src.display_id === String(display.id)) || (sources.length === displays.length ? sources[index] : null);
    // PNG bytes go over IPC as they are (a data URL would add a base64 copy of every screen).
    if (source) shots.push({ display, image: live ? null : source.thumbnail.toPNG(), sourceId: source.id, physical });
  }
  if (!shots.length) {
    finishLens();
    reportError('화면을 가져오지 못했습니다. 화면 캡처 권한과 모니터 연결을 확인해 주세요.');
    return { ok: false };
  }

  try { globalShortcut.register('Escape', onEscape); } catch { /* the in-window handlers still work */ }
  let remaining = shots.length;
  for (const { display, image, sourceId, physical } of shots) {
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x, y, width, height,
      frame: false,
      show: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      backgroundColor: '#000000',
      icon: iconPath(),
      webPreferences: webPreferences()
    });
    lensWindows.push(win);
    // A live lens streams the screen, so its own window must be left out of the capture.
    if (live) win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    hardenWindow(win);
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '..', 'public', 'lens.html'));
    const here = display.id === cursorDisplay.id;
    let shown = false;
    const reveal = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      // Windows may clamp frameless windows to the work area; force the exact display bounds.
      win.setBounds(display.bounds);
      win.show();
      if (here) win.focus();
    };
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('lens:init', {
        image,
        live,
        sourceId,
        physical,
        shape: settings.shape,
        sizePercent: settings.lensSize,
        lensMaxScale: settings.lensMaxScale,
        lensStyle: settings.lensStyle,
        method: settings.method,
        aiMaxSize: settings.aiMaxSize,
        aiDevice: settings.aiDevice,
        // Only the display holding the cursor starts with a visible lens.
        cursor: here ? { x: cursor.x - x, y: cursor.y - y } : null
      });
      setTimeout(reveal, 4000);
    });
    win.webContents.ipc.once('lens:ready', reveal);
    // Esc must work even when the window never got keyboard focus.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') onEscape();
    });
    win.on('closed', () => {
      // Closing one lens window (Esc / right click) closes them all, then the main window returns.
      if (--remaining === 0) {
        lensWindows = [];
        finishLens();
      } else {
        closeLens();
      }
    });
  }
  return { ok: true };
}

function finishLens() {
  globalShortcut.unregister('Escape');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.webContents.send('selection:done');
    if (settingsWasOpen) toggleSettingsWindow();
  }
  settingsWasOpen = false;
}

function setupIpc() {
  ipcMain.handle('settings:get', () => ({ ...settings, customPaths: [...settings.customPaths] }));
  ipcMain.handle('settings:set', (event, patch) => {
    if (patch && typeof patch === 'object' && fromPanel(event)) {
      for (const key of Object.keys(DEFAULT_SETTINGS)) if (key in patch) settings[key] = patch[key];
      validateSettings();
      saveSettings();
      for (const win of [mainWindow, settingsWindow]) if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.alwaysOnTop);
      broadcast('settings:changed', { ...settings, customPaths: [...settings.customPaths] });
    }
    return { ...settings, customPaths: [...settings.customPaths] };
  });
  ipcMain.on('settings:toggleWindow', toggleSettingsWindow);
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('ai:ensure', async (event, payload) => {
    try {
      ensureAIWorker();
      return await sendToAI({ type: 'init', id: ++aiSeq, model: (payload && payload.model) || 'realesrgan', device: settings.aiDevice }, 90000);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('ai:infer', async (event, payload) => {
    try {
      ensureAIWorker();
      if (!payload || !payload.width || !payload.height) throw new Error('AI 입력이 올바르지 않습니다.');
      const data = payload.data instanceof ArrayBuffer ? payload.data : payload.data && payload.data.buffer;
      if (!(data instanceof ArrayBuffer)) throw new Error('AI 입력 데이터가 올바르지 않습니다.');
      const message = { type: 'infer', id: ++aiSeq, width: payload.width, height: payload.height, data, model: payload.model || 'realesrgan', device: settings.aiDevice };
      return await sendToAI(message, 120000, [data]);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('fs:presets', () => buildPresets());

  ipcMain.handle('fs:listDir', async (event, payload) => {
    const target = payload && payload.dir ? payload.dir : app.getPath('pictures');
    try {
      const dir = path.resolve(target);
      const stat = await fs.promises.stat(dir);
      if (!stat.isDirectory()) return { ok: false, error: '폴더가 아닙니다.' };
      const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      const entries = dirents
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: path.join(dir, entry.name),
          type: entry.isDirectory() ? 'dir' : 'file'
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' });
        })
        .slice(0, 601);
      const parent = path.dirname(dir);
      return {
        ok: true,
        dir,
        parent: parent === dir ? null : parent,
        entries
      };
    } catch (error) {
      return { ok: false, error: error.message || '폴더를 읽을 수 없습니다.' };
    }
  });

  ipcMain.handle('fs:mkdir', async (event, payload) => {
    try {
      const dir = payload && payload.dir;
      const name = payload && String(payload.name || '').trim();
      if (!dir || !name) return { ok: false, error: '폴더 이름을 입력하세요.' };
      if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: '사용할 수 없는 문자가 있습니다.' };
      const target = path.join(dir, name);
      await fs.promises.mkdir(target, { recursive: false });
      return { ok: true, path: target };
    } catch (error) {
      return { ok: false, error: error.message || '폴더를 만들 수 없습니다.' };
    }
  });

  ipcMain.handle('fs:savePng', async (event, payload) => {
    try {
      if (!payload || !payload.dir) return { ok: false, error: '저장 폴더가 없습니다.' };
      let name = String(payload.name || '').trim();
      if (!name) return { ok: false, error: '파일 이름을 입력하세요.' };
      name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\.png$/i, '').replace(/[. ]+$/, '');
      if (!name) return { ok: false, error: '사용할 수 없는 파일 이름입니다.' };
      const dir = path.resolve(payload.dir);
      const stat = await fs.promises.stat(dir);
      if (!stat.isDirectory()) return { ok: false, error: '저장 폴더가 아닙니다.' };
      const buffer = Buffer.from(new Uint8Array(payload.buffer));
      const base = path.join(dir, name);
      let target = `${base}.png`;
      let index = 1;
      while (fs.existsSync(target)) {
        target = `${base} (${index}).png`;
        index += 1;
      }
      await fs.promises.writeFile(target, buffer);
      settings.lastSaveDir = dir;
      saveSettings();
      broadcast('settings:changed', { ...settings, customPaths: [...settings.customPaths] });
      return { ok: true, path: target };
    } catch (error) {
      return { ok: false, error: error.message || '파일을 저장할 수 없습니다.' };
    }
  });

  ipcMain.handle('lens:start', startLens);
  ipcMain.on('lens:close', () => {
    closeLens();
  });
  ipcMain.on('lens:modal', (event, open) => {
    lensModalOpen = !!open;
  });
  // A lens window could not get its picture or stream: close everything and tell the main window why.
  ipcMain.on('lens:fail', (event, message) => {
    closeLens();
    reportError(String(message).slice(0, 200));
  });
}

function buildPresets() {
  const presets = [
    { id: 'desktop', label: '바탕화면', path: app.getPath('desktop') },
    { id: 'documents', label: '문서', path: app.getPath('documents') },
    { id: 'downloads', label: '다운로드', path: app.getPath('downloads') },
    { id: 'pictures', label: '사진', path: app.getPath('pictures') },
    { id: 'home', label: '사용자 폴더', path: app.getPath('home') },
    {
      id: 'app',
      label: '앱 폴더',
      path: app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..')
    }
  ];
  for (const item of settings.customPaths) {
    presets.push({ id: `custom:${item.path}`, label: item.label, path: item.path, custom: true });
  }
  return presets;
}

const AI_MODELS = {
  realesrgan: { name: 'Real-ESRGAN-x4v3', file: 'realesr-general-x4v3.onnx' },
  'nomos-span': { name: '4xNomosUni SPAN', file: '4xNomosUni_span_multijpg_fp32_opset17.onnx' },
  'realesrgan-x4plus': { name: 'Real-ESRGAN x4plus', file: 'realesrgan_x4plus.onnx' }
};

function aiModelDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '..', 'models');
}

function ensureAIWorker() {
  if (aiWorker) return;
  aiWorker = new Worker(path.join(__dirname, 'ai-worker.js'), {
    workerData: { modelDir: aiModelDir(), files: Object.fromEntries(Object.entries(AI_MODELS).map(([key, item]) => [key, item.file])) }
  });

  aiWorker.on('message', (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'provider') {
      aiProvider = message.provider;
      return;
    }

    if (message.id && aiPending.has(message.id)) {
      const pending = aiPending.get(message.id);
      aiPending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.type === 'error') {
        pending.reject(new Error(message.message || 'AI 처리에 실패했습니다.'));
      } else {
        pending.resolve(message);
      }
      return;
    }

    if (message.type === 'worker-error') {
      broadcast('ai:event', { type: 'error', message: message.message || 'AI 오류' });
    }
  });

  aiWorker.on('error', (error) => {
    broadcast('ai:event', { type: 'error', message: error.message || 'AI 오류' });
  });

  aiWorker.on('exit', () => {
    aiWorker = null;
    aiProvider = null;
    for (const pending of aiPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('AI 워커가 종료되었습니다.'));
    }
    aiPending.clear();
    broadcast('ai:event', { type: 'provider', provider: null });
  });
}

function sendToAI(message, timeoutMs, transferList) {
  return new Promise((resolve, reject) => {
    if (!aiWorker) {
      reject(new Error('AI 워커가 없습니다.'));
      return;
    }
    const timer = setTimeout(() => {
      if (aiPending.has(message.id)) {
        aiPending.delete(message.id);
        reject(new Error('AI 응답 시간 초과'));
        // Do not terminate() the worker here: killing a worker thread while onnxruntime is running crashes the whole
        // Electron process (exit 127). The renderer caps the work instead (aiTooBig) so a pass stays far below the timeout.
      }
    }, timeoutMs);
    aiPending.set(message.id, { resolve, reject, timer });
    try {
      aiWorker.postMessage(message, transferList || []);
    } catch (error) {
      clearTimeout(timer);
      aiPending.delete(message.id);
      reject(error);
    }
  });
}

app.whenReady().then(() => {
  // A second instance has already asked to quit; do not set anything up.
  if (!gotLock) return;
  loadSettings();
  setupIpc();
  createMainWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (aiWorker) aiWorker.terminate();
});
