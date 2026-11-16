# Patterns

> 검증된 코드 패턴. 복붙 바로 가능한 형태로 유지.

## 모니터마다 돋보기 창 하나 (멀티 모니터)

**사용 시점:** 전체 화면 오버레이가 여러 모니터를 덮어야 할 때.

```js
for (const display of screen.getAllDisplays()) {
  const win = new BrowserWindow({ x, y, width, height, frame: false, show: false, skipTaskbar: true, resizable: false, backgroundColor: '#000' });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Windows clamps frameless windows to the work area: force the exact bounds, and only after the renderer is ready.
  reveal = () => { win.setBounds(display.bounds); win.show(); };
  win.webContents.ipc.once('lens:ready', reveal);          // renderer sends it after bg.decode()
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'Escape') closeLens(); });
}
globalShortcut.register('Escape', closeLens);              // unregister when the lens closes and in will-quit
```

렌더러: `mouseleave`에서 돋보기를 숨기고, 배율/크기는 `BroadcastChannel`로 창끼리 공유한다.

## 정지 화면(모니터당 한 장) / 실시간(스트림)

```js
// Frozen: thumbnailSize = physical size of the display.
const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w * sf, height: h * sf } });
// Live: only the source id; the window excludes itself from the capture, then the renderer streams it.
win.setContentProtection(true);
navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, minWidth: pw, maxWidth: pw, minHeight: ph, maxHeight: ph, maxFrameRate: 30 } } });
```

## 원본 해상도 AI 추론: 타일 이어 붙이기 (`ai-worker.js`)

```js
const TILE_MAX = 256, TILE_CORE = 192, TILE_PAD = 32;
// <= 256 px: one pass. Otherwise cut core tiles (192) with 32 px of context on each side (clamped to the image),
// run each through the model, drop the context part of the x4 output and copy the core into the result.
```

모델 계산 시간은 입력 면적에 비례(CPU, general-x4v3: 256px 0.2 s, 512px 1.1 s, 1024px 4.8 s).

## 4배 AI 결과를 줄여 보이기

GPU: `generateMipmap` + `LINEAR_MIPMAP_LINEAR` (일반 LINEAR는 픽셀을 건너뛰어 계단이 생김). CPU: 줄일 때만 Lanczos3(`out < ai.w`), 키울 때는 Bilinear.

## 배율 단계 (ScreenMagnify와 동일)

```js
const clampZoom = (v) => Math.round(Math.min(64, Math.max(0.5, v)) * 2) / 2;
function nextZoom(value, dir) {
  const edge = dir > 0 ? value : value - 0.001;
  const step = edge < 4 ? 0.5 : edge < 8 ? 1 : edge < 16 ? 2 : edge < 32 ? 4 : 8;
  return clampZoom(value + dir * step);
}
```

배율 = 화면에 표시되는 물리 픽셀 / 원본 물리 픽셀. 원본에서 잘라 올 폭 = `view.clientWidth * dpr / mag`.

## 만화풍 돋보기 프레임 (CSS)

링은 `#ring { inset: calc(var(--t) * -1); border: 3px solid #111; background: var(--ring) }`, 손잡이는 링 뒤(`z-index: -1`)에서 링 두께의 30% 안쪽부터 시작해 링이 연결부를 덮게 하고, 손잡이 목은 링과 같은 재질(`var(--ring)`)로 칠한다. 원형은 45° 회전(왼쪽 아래), 사각형은 아래 가운데에 수직. `--u/--t/--hw`는 JS가 돋보기 크기에서 계산한다.

## ComfyUI로 질감 만들기 (HTTP API)

`POST /prompt` (CheckpointLoaderSimple -> CLIPTextEncode -> EmptyLatentImage -> KSampler(steps 4, cfg 1, euler/simple) -> VAEDecode -> SaveImage), `/history/<id>` 폴링 후 `/view`로 받는다. 체크포인트 이름의 역슬래시(`Flux` + `chr(92)` + `flux1-schnell-fp8_CHKP.safetensors`)는 Python에서 `chr(92)`로 만든다.

## 다른 앱의 저장 모듈 재사용 (Ctrl+S)

`save-dialog.js`는 원본 함수(`loadDir`, `renderList`, `confirmSave`...)를 그대로 두고, 그림 출처만 `provider()` 콜백으로 바꾼다. main은 `fs:presets/listDir/mkdir/savePng` 핸들러와 `buildPresets`를 그대로 복사하고 설정에 `lastSaveDir`, `customPaths`를 둔다. 전체 화면 창 안의 모달이므로 열린 동안 돋보기는 멈추고(`SMSave.isOpen`), Esc는 `lens:modal` IPC로 main에 알려 "저장 창만 닫기"로 바꾼다. 스냅샷은 저장 시점에 한 번 만들어(`draw()` 후 복사) 실시간 모드에서도 같은 그림을 저장한다.
