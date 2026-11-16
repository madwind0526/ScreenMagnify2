# ScreenMagnify2

> Working directory: `E:\Claude\ScreenMagnify2`

## Project Overview

A Windows lens magnifier built with Electron, based on ScreenMagnify. Run freezes the screen (or streams it live), and a draggable lens (circle 1:1 or rectangle 4:3) follows the mouse and shows the picture under it magnified. The wheel changes the magnification (0.5x to 64x, same steps as ScreenMagnify), Ctrl+wheel changes the lens size (5 % of the display width per step). Filters and AI upscalers (ONNX Runtime) are selectable. The UI text is Korean; code comments are English. See `README.md` for the user-facing description.

## Tech Stack

Plain HTML/CSS/JS (no bundler, no TypeScript), Electron 45 (frameless windows), WebGL2 shaders and a JS CPU resampler (both copied from ScreenMagnify), ONNX Runtime (`onnxruntime-node`, CPU or DirectML) in a worker thread. `node_modules` is a directory junction to `..\ScreenMagnify\node_modules`.

## Commands

```bash
npm start              # run in Electron
npm run check          # node --check on the scripts
npm run dist           # release/ScreenMagnify2-<version>.zip (electron-builder dir target, asar off, unsigned)
start.bat / stop.bat   # start, and stop only the "ScreenMagnify2" Electron windows
```

Launch from the Claude shell with `env -u ELECTRON_RUN_AS_NODE npx electron .`. Settings live in `%APPDATA%\screenmagnify2`. To test while the app is running use `--user-data-dir=<tmp>` (single-instance lock).

## Map of the code

| Path | What |
|---|---|
| `electron/main.js` | settings (validated, broadcast), main/settings windows, per-display capture, one lens window per display (frozen picture or live stream), Esc global shortcut, AI worker control (`ai:ensure`, `ai:infer`) |
| `electron/preload.js` | `window.api` (settings, window, selection, lens, ai) |
| `electron/ai-worker.js` | ONNX session per model/device. Inputs up to 256 px run once; bigger ones run as overlapping tiles (192 core + 32 pad) at full resolution, output x4 |
| `public/lens.html`, `public/js/lens.js` | the lens: crop under the lens at full resolution, draw with the chosen method (WebGL on GPU, `SM.resample` on CPU), AI frame per view, magnification (`nextZoom`), size steps, badge, live loop |
| `public/js/save-dialog.js`, `public/css/save.css`, save markup in `lens.html` | Ctrl+S save dialog copied from ScreenMagnify (`result.js` save functions, `main.js` `fs:*` handlers and `buildPresets`). `lens.js` supplies `SMSave.setProvider(lensSnapshot)`; while the dialog is open the lens stands still and Esc only closes the dialog (`lens:modal` IPC, `onEscape` in main) |
| `public/js/methods.js` | method list (labels, order by model size), GPU-only flags with `fallback`, AI limit table `aiLimit(id, device, override)` |
| `public/js/upscaler.js`, `cpu-scaler.js`, `nis-coefs.js` | copied from ScreenMagnify (AI frame texture uses mipmaps) |
| `public/settings.html`, `public/js/settings.js`, `public/css/main.css` | main/settings UI (square corners, compact) |
| `public/assets/ring-carbon.png` | carbon ring texture for the "classic" lens style (ComfyUI / Flux schnell) |
| `samples/` | ring texture candidates and the sample sheet |
| `models/` | three ONNX models copied from ScreenMagnify |

## Key decisions

- **Behave like ScreenMagnify.** Magnification steps and limits, the 24 ms wheel throttle, device split (CPU = JS resampler + CPU inference, GPU = WebGL + DirectML), GPU-only methods with fallbacks (NIS -> Lanczos3, x4plus -> x4v3), method order by model size, the magnification HUD look. When porting a behavior, diff the original code instead of re-deriving it.
- **Frozen by default, live optional.** Frozen: one full-size capture per display, shown as the background. Live (`freeze: false`): each lens window streams its display with `getUserMedia` (`chromeMediaSource: 'desktop'`) and is excluded from the capture with `setContentProtection(true)`. Live AI runs back to back on the newest region; a warning shows in the hint box.
- **AI never sees a shrunken picture.** Shrinking the input to 256 px made text worse than the original (found at x1.0 in ScreenMagnify). The worker tiles instead. The limit (`aiMaxSize`: `-1` whole lens region (default), `0` auto table, or px) only decides when to skip the AI and show the filter.
- **Multi-monitor.** One window per display, `setBounds(display.bounds)` after creation (Windows clamps frameless windows to the work area), shown only after the picture is decoded (`lens:ready`). Closing one closes all. Esc works without focus (global shortcut plus `before-input-event`).
- **Lens style.** `clean`, `bold` are CSS frames; `classic` is a cartoon magnifier (carbon ring, handle at the lower left for a circle, straight handle at the bottom centre for a rectangle). Frame sizes follow the lens via `--u/--t/--hw` (set in `lens.js`).
- **Settings window** is as wide as the main window; its height is the last row's bottom plus ~24 px (measure it when adding rows).

## Testing notes

- There is no automated suite. The checks used so far: an `SM_TEST` hook appended to `main.js` temporarily (start the lens, dispatch `PointerEvent`/`WheelEvent`, read the DOM, `capturePage`), always removed afterwards (`grep -c SM_TEST electron/main.js` must be 0). Run it with `--user-data-dir` and `env -u ELECTRON_RUN_AS_NODE`.
- After a larger edit of `lens.js`, re-run the basic interactions (wheel, Ctrl+wheel, both devices, frozen and live). Once a refactor silently deleted `showBadge` and broke the wheel.
- The AI worker can be driven alone with `ELECTRON_RUN_AS_NODE=1 electron.exe <script>` using `worker_threads`.
- A test script that launches Electron without `ELECTRON_RUN_AS_NODE` for a path that does not exist opens a GUI error dialog for the user.

## Global requirements

- Code comments in English only; UI strings in Korean.
- Ports: this app has no server and uses none (see `C:\Claude\PORTS.md`).
- Cross-project lessons from this project are in `C:\Claude\memory-bank\` (see its `INDEX.md`, Electron and AI sections).

## Memory Bank

| File | Purpose |
|------|---------|
| `memory-bank/active-context.md` | current focus |
| `memory-bank/STATE.md` | wave state |
| `memory-bank/CACHE.md` | findings during a session |
| `memory-bank/knowledge/PATTERNS.md` | reusable code patterns |
| `memory-bank/knowledge/RULES.md` | project rules |
| `memory-bank/knowledge/trouble-shooting.md` | bugs and fixes |

At session start read `active-context.md`, then `STATE.md`.

## Release

- Repository: https://github.com/madwind0526/ScreenMagnify2 (public, MIT). Versions are `package.json` `version`; tag `v<version>`.
- Steps: bump the version, `npm run check`, `npm run dist`, check the packaged worker (`ELECTRON_RUN_AS_NODE=1 release/win-unpacked/ScreenMagnify2.exe <script>` with a `worker_threads` test), commit, push, `git tag v<version>`, `gh release create v<version> release/ScreenMagnify2-<version>.zip --notes-file <notes>`.
- `release/` and `samples/parts/` are git-ignored; `models/` (71 MB, copied from ScreenMagnify) is committed and packaged as `resources/models`.
- 1.0.0 (2026-11-16): first release.
