// Draws a fake desktop (1920x1080): a sky wallpaper and a photo viewer showing the Ha Long Bay picture.
// Used only by scripts/capture-docs.cjs. `imgs` = { pic, sky } (loaded Image elements).
// SCENE_INFO says which parts of the picture the screenshots select and magnify (scene coordinates).
const SCENE_INFO = {
  rect: { x: 650, y: 390, w: 230, h: 220 }, // the junk boat's sails
  anchor: { x: 100, y: 91 }, // zoom anchor, relative to rect (a sail)
  zoomRect: { x: 600, y: 775, w: 110, h: 100 },
  zoomAnchor: { x: 30, y: 40 }, // the pink flower
  shapeRect: { x: 640, y: 380, w: 330, h: 250 } // the whole boat
};

function drawScene(ctx, w, h, imgs) {
  const font = (size, weight) => `${weight || 400} ${size}px "Segoe UI", "Malgun Gothic", sans-serif`;

  // Wallpaper: the sky picture, covering the screen.
  const sky = imgs.sky;
  const s = Math.max(w / sky.width, h / sky.height);
  const vh = h / s;
  ctx.drawImage(sky, 0, (sky.height - vh) * 0.4, sky.width, vh, 0, 0, w, h);

  // Photo viewer window.
  const wx = 410;
  const wy = 100;
  const ww = 1100;
  const wh = 800;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(wx + 10, wy + 14, ww, wh); // soft shadow
  ctx.fillStyle = '#14161f';
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = '#1f2230';
  ctx.fillRect(wx, wy, ww, 44);
  ctx.fillStyle = '#e8eaf2';
  ctx.font = font(14, 600);
  ctx.fillText('Photos - halong.jpg', wx + 16, wy + 28);

  // The picture, shown at 720x720 (a 384 px original, so it is a little soft, like a photo viewed zoomed in).
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgs.pic, wx + (ww - 720) / 2, wy + 44 + (wh - 44 - 720) / 2, 720, 720);

  // Taskbar.
  ctx.fillStyle = 'rgba(20, 22, 32, 0.92)';
  ctx.fillRect(0, h - 56, w, 56);
}

if (typeof module !== 'undefined') module.exports = { SCENE_INFO };
