# ScreenMagnify2 코드 리뷰

- 리뷰 일자: 2026-11-16
- 리뷰 범위: `electron/` (main, preload, ai-worker), `public/` (HTML 3, JS 7, CSS 1), `package.json`, `start.bat`, `stop.bat`, `samples/sheet.html`
- 방식: 전체 소스 정적 리뷰 + `node --check` + AI 타일 스티칭·CPU 리샘플러 수치 검증.
  GUI를 띄우는 실행 테스트는 하지 않았다(전체 화면 오버레이가 사용자의 화면을 덮기 때문). GPU 셰이더/DirectML 실기기 검증 항목은 마지막 "실기기 확인 필요"에 정리했다.
- 총평: 구조가 단순하고 방어적이다(설정 검증 단일화, preload 최소 노출, `contextIsolation`, AI 워커 분리, GPU/CPU 경로 분리, 전송 버퍼 transfer). 크래시/데이터 손상급 결함은 없다. 다만 **기본 설정에서 AI가 매우 느려지거나 한 번 실패하면 세션 내 복구가 불가능한 문제**, **live 캡처 실패 시 화면이 검게 덮이는 문제**는 실제 사용에서 바로 체감되므로 High로 분류했다.

## 심각도 정의

| 표기 | 의미 |
|---|---|
| High | 기본 설정/일반 사용에서 체감되는 기능·성능 문제, 또는 복구 불가 상태 |
| Medium | 특정 조건에서 문제가 되거나, 유지보수·보안상 개선이 필요한 것 |
| Low | 사소한 버그, UX, 문서/코드 불일치, 죽은 코드 |

## 한눈에 보기

| ID | 심각도 | 위치 | 요약 |
|---|---|---|---|
| H-1 | High | `public/js/lens.js:207` | AI 추론 1회 실패 후 그 돋보기 세션에서는 AI 재시도 불가 |
| H-2 | High | `electron/main.js:12`, `public/js/lens.js:105` | 기본 `aiMaxSize: -1`이 AI 한도를 없애 저배율·큰 돋보기에서 수십 초~타임아웃 |
| M-1 | Medium | `electron/main.js:169` | 전체 화면을 data URL로 IPC 전달 + 모니터마다 `getSources` 반복 호출 |
| M-2 | Medium | `electron/main.js:362`, `electron/ai-worker.js:205` | 타임아웃 후 작업 취소가 없고, 단일 워커 큐가 모든 패널 AI를 막음 |
| M-3 | Medium | `public/js/lens.js:122` | CPU 경로에서 pointermove마다 메인 스레드에서 `getImageData`+리샘플 |
| M-4 | Medium | `public/js/lens.js:301` | live 캡처 실패/제약 불일치 시 검은 전체 화면만 남음 |
| M-5 | Medium | `electron/main.js:335`, `electron/preload.js:29` | `ai:event`를 아무도 구독하지 않음 (워커 오류/종료가 UI에 안 보임) |
| M-6 | Medium | `electron/main.js:9`, `public/js/methods.js:33` | GPU 전용/모델 목록이 두 파일에 중복, `fallback` 필드는 미사용 |
| M-7 | Medium | `electron/main.js:83`, 각 HTML | 보안 하드닝: CSP 없음, `sandbox:false`, 네비게이션 차단 없음, IPC sender 검증 없음 |
| M-8 | Medium | `electron/main.js:24` | single-instance 처리 후에도 모듈이 계속 실행되는 구조 |
| L-1 | Low | `public/js/lens.js:111` | "AI 대기" 라벨이 조건이 풀려도 남을 수 있음 |
| L-2 | Low | `electron/preload.js:21`, `public/js/main.js:47` | `shape` 인자/주석이 실제 동작과 불일치 |
| L-3 | Low | `electron/main.js:141`, `169` | 캡처 실패·source 매칭 실패 시 사용자 피드백 없음 |
| L-4 | Low | `public/js/settings.js:12` | 목록에 없는 `aiMaxSize` 값이면 select가 빈칸이 됨 |
| L-5 | Low | `public/lens.html:58`, `public/js/lens.js:280` | "화면 Freezed", "Press ESC to continue" 오타/영문 혼용 |
| L-6 | Low | `electron/main.js:127` | 설정 창 높이 454px 고정 — 행 추가 시 잘릴 수 있음 |
| L-7 | Low | `package.json`, 문서 | version `0.1.0` vs 릴리스 v1.1.0, `npm run dist` 부재 등 문서 불일치 |
| L-8 | Low | 여러 파일 | 죽은 코드/도달 불가 커널 |
| L-9 | Low | `package.json:8` | `npm run check`가 preload/public JS 일부를 검사하지 않음 |
| L-10 | Low | `electron/main.js:66` | 설정 저장이 동기 + 비원자적 |
| L-11 | Low | `electron/ai-worker.js:100` | 출력이 항상 4배라고 가정 (검증 없음) |
| L-12 | Low | `public/js/cpu-scaler.js:28` | 주석은 LRU, 실제는 FIFO 캐시 |
| L-13 | Low | `public/js/upscaler.js:699` | WebGL2 실패 시 고품질 커널이 조용히 캔버스 보간으로 대체 |
| L-14 | Low | `public/js/upscaler.js:397` | `preserveDrawingBuffer:true` 성능 비용 |

---

## 상세

### H-1. AI 오류 후 그 세션에서는 AI 재시도가 불가능

**위치**
- `public/js/lens.js:186-215` (`runAI`)
- `public/js/lens.js:239-251` (`initAI`)
- `public/js/lens.js:173-184` (`scheduleAI`)

**현상/영향**
`runAI`의 `catch`에서 `aiReady = false`로 바꾼다(`lens.js:207-210`). 이후 `scheduleAI`는 `if (... || !aiReady) return;`(`lens.js:175`)로 즉시 빠져나가고, `liveAiLoop`도 `!aiReady`면 영원히 대기한다(`lens.js:222`). 모델 로드(`ai:ensure`)가 실패한 경우도 `aiReady`가 계속 false다(`lens.js:250`).
즉, 한 번의 일시적 추론 실패(대형 타일 OOM, DirectML/세션 오류, 워커 재시작, 120초 타임아웃 등)로 그 돋보기 세션의 AI가 영구히 꺼진다. UI에는 "AI 오류: ..."만 남고, 사용자는 돋보기를 닫았다 다시 열기 전까지 복구할 방법이 없다.
`memory-bank/knowledge/trouble-shooting.md:38-47`에는 "AI 배지 클릭이 aiError를 해제해 재시도"라고 적혀 있지만, 현재 코드에는 `aiLabel`/`badge`에 클릭 핸들러가 없다. 게다가 `#hint`는 `pointer-events: none`이라(`lens.html:47-48`) 클릭 자체가 불가능하다. 문서와 코드가 다른 상태다.

**원인**
실패 상태를 "세션 종료"로 취급하고, 재시도 진입점(버튼/키/자동 백오프)을 만들지 않았다.

**제안**
- 실패 시 `aiReady = false`만 두지 말고, 일정 시간 뒤 `initAI()`를 1~2회 자동 재시도하거나
- `#hint`(또는 `#ai`)의 `pointer-events`를 켜고 "다시 시도" 클릭 핸들러를 연결하거나
- `R` 키 같은 단축키로 `initAI()`를 다시 호출.
- 재시도 시 `aiBusy`/`aiTimer`/`aiFrameKey`를 초기화하고 라벨을 갱신해야 한다.

```js
// Concept: give the error label a retry affordance.
aiLabel.style.pointerEvents = 'auto';
aiLabel.onclick = () => {
  if (aiBusy) return;
  aiLabel.textContent = '';
  initAI();
};
```

---

### H-2. 기본 `aiMaxSize: -1`이 AI 크기 제한을 무력화한다

**위치**
- `electron/main.js:12` (`aiMaxSize: -1`), `main.js:50-51` (검증)
- `public/js/lens.js:104-109` (`aiLimit`)
- `public/js/lens.js:173-184`, `219-237`
- `electron/main.js:281-292`, `356-377` (타임아웃 120초)

**현상/영향**
`aiMaxSize === -1`이면 `aiLimit()`이 `Infinity`를 반환하므로 "영역이 크면 필터만 표시" 가드가 절대 걸리지 않는다. 기본 돋보기 설정(화면 너비 10%, 최대 2배, 배율 0.5~64)에서도 조건이 나빠지면 타일 수가 급증한다.

- 4K(dpr 2) 화면, 돋보기 20%(CSS 384px), 배율 x0.5 → 소스 영역 약 1536×1152px → 192px 코어 기준 8×6 = 48 타일.
- 최대 허용 50% 너비, 배율 x0.5 → 3840×2880px → 20×15 = 300 타일.
- README(`README.md:67`)에 따르면 이 CPU에서 x4v3가 640×400에 약 3초이므로 256² 1패스 ≈ 0.7~0.8초. 48타일 ≈ 35초, 300타일 ≈ 3~4분.

120초를 넘기면 IPC 타임아웃(`main.js:362-367`)으로 요청이 거부되는데, 워커는 남은 타일을 계속 계산한다. 타임아웃으로 `runAI`가 catch에 걸려 **H-1**에 의해 AI가 꺼지고, 그 시간 동안 CPU를 계속 점유한다. 워커 큐가 직렬이므로(`ai-worker.js:205-209`) 다른 모니터의 AI 요청도 뒤에서 대기한다.

**원인**
"돋보기 전체(-1)"를 기본값으로 두면서, 실제 비용(타일 수·영역 면적)을 추정하는 상한이 없다.

**제안**
- 기본값을 `0`(자동 표)로 바꾸거나,
- `-1`을 유지하되 `Math.min(aiLimit(), budget)`처럼 예상 타일 수/픽셀 수 기반 상한을 적용하고, 초과 시 기존 "AI 대기 · 영역이 커서 Bilinear" 경로로 보낸다.
- `-1` 선택 시 "영역이 크면 매우 느려질 수 있음" 경고를 설정 창 또는 라벨에 표시.
- 장기적으로는 `width*height` 기준 추정치(예: 1M px 초과 시 필터 대체)를 두는 편이 안전하다.

---

### M-1. 전체 화면 캡처를 data URL로 IPC 전달하고, 모니터마다 `getSources`를 반복 호출

**위치**
- `electron/main.js:169-175` (`for display` 안에서 `desktopCapturer.getSources`, `thumbnail.toDataURL()`)
- `electron/main.js:212-227` (`lens:init`으로 `image` 전송)
- `public/js/lens.js:313` (`bg.src = image`)

**현상/영향**
- 모니터 N개면 `getSources`를 N번 호출한다. 각 호출은 모든 화면을 다시 캡처/축소하므로 시작 시간이 대략 N배가 된다.
- `toDataURL()`은 메인 프로세스에서 동기 PNG 인코딩 + base64(약 +33%)를 수행한다. 4K 다중 모니터에서 수 MB~수십 MB 문자열이 생기고, 이를 `shots` 배열과 `lens:init` 구조화 복사, 렌더러 `<img>` 디코드까지 여러 번 복제된다. 시작 지연과 메모리 스파이크의 원인이 된다.

**제안**
- `source.thumbnail.toPNG()`로 Buffer를 보내고, 렌더러에서 `new Blob([buffer], {type:'image/png'})` + `URL.createObjectURL`로 디코드. base64와 문자열 복사를 제거할 수 있다.
- 모니터별 native 해상도를 유지해야 한다면 현재 구조를 유지하되, 최소한 캡처 루프를 분리해 `getSources` 호출 횟수/시간을 로그로 확인하고, 필요하면 가장 큰 해상도로 1회 호출 후 축소하는 트레이드오프를 검토.
- `shots`에서 렌더러로 넘긴 뒤 main 쪽 참조를 빨리 해제(`shots[i].image = null`)해 피크 메모리를 낮춘다.

---

### M-2. AI 타임아웃 후 취소가 없고, 단일 워커 큐가 모든 패널을 막는다

**위치**
- `electron/main.js:356-377` (`sendToAI`, 120초 타임아웃)
- `electron/ai-worker.js:205-209` (직렬 큐)
- `electron/ai-worker.js:132-161` (타일 루프, 중단 지점 없음)

**현상/영향**
타임아웃은 `aiPending`에서만 제거하고 워커 작업은 그대로 둔다. ORT 추론은 중간 취소가 불가능하므로, 한 번 느린 요청이 들어오면 워커가 수 분간 CPU/GPU를 잡고 있으면서 뒤의 모든 요청(다른 모니터 포함)이 지연된다. 또한 H-1과 결합해 "AI가 꺼진 채로 CPU만 계속 사용"하는 상태가 된다.

**제안**
- 타임아웃 시 `aiWorker.terminate(); aiWorker = null;`로 워커를 재시작(exit 핸들러가 pending 정리). 다음 `ai:ensure`에서 새 워커가 만들어진다.
- 또는 워커에 처리 시작 전 `width/height` 기반 예상 시간 검사를 넣고, 상한 초과 요청은 즉시 `{ok:false, reason:'too-big'}`로 거절.
- 렌더러 쪽에서도 `aiBusy` 상태에서 새 요청을 쌓지 말고 최신 1건만 유지(코얼레싱).

---

### M-3. CPU 경로에서 pointermove마다 메인 스레드 리샘플

**위치**
- `public/js/lens.js:122-171` (`draw`)
- `public/js/lens.js:340-345` (`pointermove` → `render` → `draw`)
- `public/js/cpu-scaler.js:84-141` (JS 리샘플)

**현상/영향**
`useGpu() === false`일 때 매 pointermove마다 `cropCtx.getImageData()` + `SM.resample()` + `putImageData()`를 메인 스레드에서 수행한다. 큰 돋보기/저배율에서는 `sourceRect()`가 화면 크기보다 훨씬 큰 영역(예: 배율 0.5에서 뷰의 2배)을 잘라 수백만 픽셀을 처리하므로 120Hz 포인터에서 프레임 드랍이 발생한다. wheel에는 24ms 스로틀이 있지만(`lens.js:348-350`) pointermove에는 없다.

**제안**
- pointermove는 좌표만 갱신하고, 실제 그리기는 `requestAnimationFrame`으로 1회 코얼레싱(`scheduleDraw`).
- 리샘플 출력 버퍼를 재사용하고, 가능하면 `OffscreenCanvas`/Worker로 이동.
- 저배율에서는 가시 영역과 교집합만 AI/리샘플 대상으로 삼아 낭비를 줄인다.

---

### M-4. live 캡처 실패/제약 불일치 시 검은 화면만 남는다

**위치**
- `public/js/lens.js:296-315`
- `electron/main.js:168-179` (`sourceId`가 없으면 해당 디스플레이를 조용히 제외)

**현상/영향**
`getUserMedia`에 `minWidth/maxWidth/minHeight/maxHeight`를 `physical` 값과 정확히 일치하도록 요구한다. 혼합 DPI/특수 캡처 백엔드에서 이 제약이 만족되지 않으면 `OverconstrainedError`가 날 수 있다. 실패 시 `catch`는 라벨에만 메시지를 쓰고 `start()`를 호출하지 않으므로, 렌즈는 그려지지 않고 **모든 모니터가 검은 전체 화면 오버레이**가 된다. `sourceId`가 없는 경우도 `shots`에서 조용히 빠지고, 전부 빠지면 `{ok:false}`만 반환되어 사용자에게 아무 메시지가 없다.

**제안**
- 제약을 `{ mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }`로 최소화하고, 실패 시 `min/max` 없이 1회 재시도.
- 실패 시 해당 윈도우를 닫고 메인 창으로 복귀 + 토스트, 또는 freeze 캡처로 자동 폴백.
- `source.display_id` 매칭 실패 시 `screen.getAllDisplays()` 순서와 `sources` 순서를 폴백으로 사용하고, 실패 사유를 UI에 전달.

---

### M-5. `ai:event`는 브로드캐스트되지만 구독자가 없다

**위치**
- `electron/main.js:335-353` (`worker-error`/`error`/`exit` → `broadcast('ai:event')`)
- `electron/preload.js:29-32` (`ai` API에 이벤트 리스너 없음)
- `public/js/lens.js` (구독 없음)

**현상/영향**
워커가 비정상 종료되거나 `worker-error`를 보내도 렌즈 UI에는 전혀 표시되지 않는다. 진행 중이던 invoke는 reject되어 "AI 오류"로 보이지만, 대기 중 요청이 없을 때의 오류는 조용히 사라진다. `main.js:319-321`의 `aiProvider`도 저장만 하고 사용처가 없다.

**제안**
`preload`에 `ai.onEvent(cb)`를 추가하고 렌즈에서 `provider: null`/`error`를 받아 라벨 갱신 + H-1의 재시도 경로와 연결. 사용하지 않을 거면 dead broadcast와 `aiProvider`를 제거.

---

### M-6. GPU 전용/모델 목록이 main과 renderer에 중복, `fallback` 필드는 미사용

**위치**
- `electron/main.js:8-10` (`METHOD_IDS`, `GPU_ONLY`, "keep in sync" 주석)
- `electron/main.js:299-303` (`AI_MODELS`)
- `public/js/methods.js:32-39`, `60-69` (`gpuOnly`, `fallback`)
- `public/js/methods.js:31-40`의 `fallback`은 어디서도 읽히지 않음(grep 결과 정의만 존재)

**현상/영향**
메서드/모델을 추가할 때 세 곳을 수정해야 하고, 한 곳을 빠뜨리면 설정 검증과 UI가 어긋난다. 실제로 renderer의 `fallback` 데이터는 죽은 필드이며, 대체 규칙은 main의 `GPU_ONLY`에 하드코딩되어 있다.

**제안**
공용 데이터 파일(예: `shared/methods.json` 또는 UMD 형태의 `public/js/methods-data.js`) 하나를 main에서 `require`하고 renderer에서 `<script>`로 읽게 한다. 최소한 `fallback`을 main에서 사용해 중복을 제거.

---

### M-7. 보안 하드닝 권장

**위치**
- `electron/main.js:83` (`sandbox: false`)
- `public/index.html`, `public/settings.html`, `public/lens.html` (CSP 없음)
- `electron/main.js:258-297` (`settings:set`, `window:close` sender 검증 없음)
- 모든 창에 `will-navigate`/`setWindowOpenHandler` 없음

**현상/영향**
현재 외부 입력/DOM 주입 경로가 없어 실제 위험은 낮다. 다만 로컬 파일 앱이라도 `sandbox:false` + CSP 부재 + 네비게이션 미차단은 defense-in-depth가 약하다. preload가 모든 창에 `settings.set`/`window.close`를 노출하므로, 렌즈 페이지가 침해되면 설정을 바꿀 수 있다.

**제안**
- 렌즈/설정/메인 HTML에 CSP 메타 추가(스크립트 `'self'`, `img-src 'self' data: blob:`, `style-src 'self' 'unsafe-inline'` 등 실제 필요한 최소).
- `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`, `will-navigate`에서 `event.preventDefault()`.
- 가능하면 `sandbox: true`로 전환하고, `preload`의 `require('../package.json')` 대신 `ipcRenderer.invoke('app:version')` 또는 빌드 시 주입한 상수 사용.
- `settings:set`에서 sender가 `mainWindow`/`settingsWindow`인지 확인.

---

### M-8. single-instance 처리 구조

**위치**
- `electron/main.js:24-34`, `379-383`

**현상/영향**
표준 패턴은 `if (!app.requestSingleInstanceLock()) { app.quit(); } else { ...모든 초기화... }`다. 현재는 lock 실패 시 `app.quit()`만 호출하고, `app.setAppUserModelId`, `whenReady().then(loadSettings/setupIpc/createMainWindow)`, `window-all-closed` 등록이 그대로 실행된다. `quit()`이 ready 이전에 확정된다는 가정에 의존하며, 둘째 인스턴스가 IPC 핸들러를 잠깐 등록하거나 창을 만들 여지가 있다.

**제안**
초기화 전체를 `else` 블록으로 감싸거나, lock 실패 시 `return`(모듈 최상위이므로 early pattern을 함수로 분리).

---

## Low / Nit

### L-1. "AI 대기" 라벨 잔상
`public/js/lens.js:111-114`: `setLabel()`은 `tooBig`이 참일 때만 문구를 쓰고, 거짓이 되면 아무것도 하지 않는다. 영역이 한도 아래로 줄어도 다음 AI 실행 전까지 "AI 대기 · 영역이 커서 Bilinear"가 남는다. `else`에서 `aiLabel.textContent = ''`로 지우면 된다.

### L-2. `shape` 인자/주석 불일치
`public/js/main.js:47-48`은 `window.api.selection.start(current.shape)`로 shape를 넘기고 "preload wraps it"라고 주석했지만, `electron/preload.js:21`은 인자를 받지 않고 `ipcMain`의 `lens:start`도 인자를 무시한다(실제 shape은 `settings.shape`). 죽은 인자와 잘못된 주석을 제거하거나, shape을 실제로 전달하도록 정리. (메모리뱅크의 double-wrap 버그 기록과도 현재 코드가 어긋난다.)

### L-3. 캡처 실패 피드백 없음
`electron/main.js:141-150`: `startLens`의 catch는 콘솔 로그만 남기고 `{ok:false}` 반환. `public/js/main.js:49`도 `setBusy(false)`만 한다. 캡처 권한/소스 없음/`getSources` 실패 시 사용자는 "눌렀는데 아무 일도 안 일어남"을 본다. `toast(...)`로 사유를 표시.

### L-4. 목록에 없는 `aiMaxSize`
`electron/main.js:51`은 0~1536을 허용하지만 `public/settings.html:28`의 옵션은 0, -1, 256, 512, 768, 1024뿐이다. `settings.json`을 직접 수정하거나 이전 버전 값이 남으면 `select.value = String(next.aiMaxSize)`(`settings.js:12`)가 매칭 실패로 빈칸이 된다. 옵션을 추가하거나 가장 가까운 값으로 스냅.

### L-5. UI 문구 오타/영문 혼용
- `public/lens.html:58`: "화면 Freezed" → "화면 정지" 또는 "화면 고정" ("Frozen" 오타이기도 함)
- `public/js/lens.js:280`: "Press ESC to continue" (한국어 UI 원칙 위반)
- `public/lens.html:58`: "화면 Freezed, Press ESC to continue" 전체를 한국어로.

### L-6. 설정 창 높이 고정
`electron/main.js:127`의 `height: 454`. 현재 행(체크 2 + 필드 7)과 CSS(`padding 14/22`, `gap 3`, `min-height 38`)를 계산하면 약 452px로 여유가 2px뿐이다. 행을 추가하거나 폰트/간격이 바뀌면 `overflow:hidden`에 잘린다. `CLAUDE.md`의 "마지막 행 bottom + ~24px 측정" 방침대로 `measure` 후 높이 설정을 권장.

### L-7. 문서/패키지 불일치
- `package.json:4` version `0.1.0` vs `memory-bank/STATE.md`의 v1.1.0 릴리스 기록.
- `README.md:69` "배포 패키징은 아직 없습니다" vs `RULES.md` P-04 "`npm run dist`(asar:false)" — 실제 `package.json`에 `dist` 스크립트/electron-builder 설정이 없음.
- `public/css/main.css:419-431`은 "Rounded main window" 주석이지만 `border-radius: 0`(직각). `PATTERNS.md:47-51`의 둥근 모서리 패턴도 현재 UI와 다름.
- `active-context.md:8`에 `codereview.md`가 있다고 적혀 있지만 리포지토리 루트에는 없었음(이 문서로 새로 생성).

### L-8. 죽은 코드 / 도달 불가 코드
- `public/js/methods.js:136-141` `defaultMethodFor` — 호출 없음.
- `public/js/upscaler.js:557-559` `setMethod` — `lens.js`가 `upscaler.method = ...`로 직접 대입.
- `public/js/upscaler.js:606-609` `clearAI`, `720-728` `dispose` — 호출 없음.
- `public/js/upscaler.js:341-371` `bicubic-bspline`, `bicubic-mitchell`, `lanczos2`, `lanczos4` — 메서드 목록에 없음.
- `electron/ai-worker.js:10` `BUCKETS`의 384/512/768 — `TILE_MAX=256`이라 도달 불가.
- `electron/main.js:299-303` `AI_MODELS[x].name` — 사용처 없음. `electron/main.js:318-321` `aiProvider` — 저장만 함. `ai:event` — 구독자 없음.

### L-9. `npm run check` 범위
`package.json:8`은 `electron/main.js`, `electron/ai-worker.js`, `public/js/lens.js`, `public/js/settings.js`만 검사한다. `preload.js`, `public/js/main.js`, `methods.js`, `cpu-scaler.js`, `upscaler.js`, `nis-coefs.js`는 빠져 있다. 별도로 `node --check`를 돌려 모두 문법 통과를 확인했지만, 스크립트에 포함하는 것이 좋다.

### L-10. 설정 저장
`electron/main.js:66-73`: 변경마다 `writeFileSync`. 원자적 쓰기(임시 파일 후 rename)가 아니라 저장 중 크래시 시 `settings.json`이 손상되고, 다음 실행에서 조용히 기본값으로 돌아간다. 빈도는 낮지만 설정을 잃을 수 있다.

### L-11. x4 출력 가정
`electron/ai-worker.js:100-124`는 `dims[last-1]`, `dims[last]`를 H/W로 보고 입력의 정확히 4배를 복사한다고 가정한다. `RULES.md` P-05의 "x4 모델만 추가" 전제와 일치하지만, 2배/3배 모델을 실수로 추가하면 검증 없이 잘못된 픽셀을 만든다. `ensureSession` 후 `session.outputMetadata` 또는 1회 더미 추론으로 출력 배율을 확인하는 편이 안전하다.

### L-12. CPU 가중치 캐시는 FIFO
`public/js/cpu-scaler.js:23-31`은 `get` 시 순서를 갱신하지 않고 가장 먼저 삽입된 키를 지운다. `PATTERNS.md`의 "LRU(16)"와 다르다. 동작에는 문제 없지만 문서와 맞추거나 `get` 후 `delete`/`set`으로 LRU 구현.

### L-13. WebGL2 실패 시 조용한 품질 저하
`public/js/upscaler.js:699-707`의 2D 폴백은 `imageSmoothing`만 사용하므로 `lanczos3`/`bicubic`/`nis`가 캔버스 bilinear로 대체된다. 사용자는 이유를 알 수 없다. 폴백 시 라벨/콘솔에 알리거나, CPU 리샘플러로 대체.

### L-14. `preserveDrawingBuffer`
`public/js/upscaler.js:397`: 화면 표시만 하는데 `preserveDrawingBuffer:true`는 추가 복사/메모리 비용이 있다. `capturePage`로 렌즈를 캡처하는 기능이 없다면 false로.

### L-15. 타일 패딩 32px의 충분성
`electron/ai-worker.js:127-129`의 `TILE_PAD=32`는 모델의 수용 영역(receptive field)보다 작을 수 있다. 특히 x4plus 계열은 타일 경계가 보일 수 있다. 모델별로 경계 아티팩트를 실제 화면(글씨/그래프)에서 확인하고, 필요하면 패딩을 늘리거나 경계 블렌딩을 적용.

### 기타 Nit
- `public/js/lens.js:296-314`: `bg.decode().catch(() => {})` 후 `start()` — 디코드 실패해도 빈 화면으로 진행. 사유 표시 권장.
- `electron/main.js:212-229`: `setTimeout(reveal, 4000)`은 이미지 디코드가 4초를 넘으면 검은 창을 먼저 보여 준다(본문은 `visibility:hidden`). 폴백 시간을 늘리거나 로딩 표시 권장.
- `electron/main.js:384`: `window-all-closed`에서 무조건 `app.quit()` — Windows 전용이면 문제 없음. macOS 대비라면 분기.
- `electron/main.js:42`: `settings.freeze = settings.freeze !== false` — 문자열 `"false"`가 true가 됨. JSON이 정상이면 문제 없음.
- `electron/main.js:51`: `settings.aiMaxSize`가 문자열 `"-1"`이면 `-1` 비교에 실패해 0(자동)이 된다. `Number()` 후 비교 권장.
- `electron/main.js:281-292`: `payload.data`가 `ArrayBuffer`가 아닐 때 `.buffer`만 사용해 `byteOffset/byteLength`를 무시한다. 렌즈는 `.buffer`를 넘기므로 현재는 안전하지만, API 계약을 `ArrayBuffer`로 명시하고 검증하는 편이 좋다.
- `electron/main.js:169-175`: `sources.find((src) => src.display_id === String(display.id))` — `display_id`가 비거나 형식이 다르면 전부 매칭 실패. 폴백 필요(M-4/L-3).
- `electron/ai-worker.js:211-218`: `uncaughtException`/`unhandledRejection`을 잡고 메시지만 보낸 뒤 프로세스를 유지한다. 손상된 워커가 계속 요청을 받을 수 있으므로 `process.exit(1)` 후 main의 `exit` 핸들러로 재생성하는 편이 안전.
- `public/js/upscaler.js:589-604`: live AI에서 매 프레임 `generateMipmap` 호출. 결과가 표시되지 않는 경우가 많으므로 비용이 크다. 필요할 때만 갱신/표시 시에만 mipmap 생성 검토.
- `public/js/lens.js:253`: `settings:changed`를 렌즈가 구독하지 않는다. 현재 설정 창이 돋보기 실행 중 닫히므로 도달 가능성은 낮지만, 다른 경로(추후 단축키/트레이)로 설정이 바뀌면 열린 돋보기는 이전 `method`/`aiDevice`를 계속 쓴다. `window.api.onSettingsChanged`로 cfg 갱신 + 필요 시 `initAI()` 재호출 권장.

---

## 양호한 점

- **G-01 준수**: 소스 주석은 전부 영어. 한글은 UI 문자열에만 있다(정규식 검사로 확인).
- **preload 최소 노출**: `window.api`가 설정/창/선택/렌즈/AI로 좁게 나뉘고 `contextIsolation:true`, `nodeIntegration:false`.
- **설정 검증 단일화**: `validateSettings()`가 로드/저장/변경 시 모두 적용되고, GPU 전용 메서드의 CPU 대체가 main에서 강제된다.
- **AI 워커 격리**: ONNX 세션/추론이 worker thread에 있고, 입력/출력 `ArrayBuffer`를 transfer list로 넘겨 복사를 줄였다. 모델·장치별 세션 캐시와 DML→CPU 폴백도 구현되어 있다.
- **AI 원본 해상도 처리**: 입력을 줄이지 않고 192px 코어 + 32px 패딩 타일링. 스티칭 인덱스 계산을 500×300, 200×900, 771×513, 257×257, 1000×40 입력에 대해 시뮬레이션했고, 모든 출력 픽셀이 원본과 4배 nearest 매핑으로 정확히 일치했다(불일치 0).
- **CPU 리샘플러**: 동일 크기 변환 시 원본과 완전히 동일(identity), 상수 영상은 모든 커널에서 값 보존(200..200) — 가중치 정규화가 정상임을 확인.
- **이중 장치 경로**: WebGL/2D 캔버스를 겹쳐 두고 device 변경 시 표시만 전환하는 패턴이 깔끔하고, GPU 컨텍스트가 없을 때의 2D 폴백도 존재.
- **콘텐츠 보호**: live 오버레이가 캡처에 포함되지 않도록 `setContentProtection(true)`, 메인/설정 창도 보호.
- **안전한 DOM**: 사용자/워커 오류 메시지를 `textContent`로만 넣어 XSS 경로가 없다.
- **검증 통과**: `npm run check` 및 누락 파일 6개에 대한 추가 `node --check` 모두 통과.

## 이미 알려진/보류 항목(리뷰에서 제외하지 않고 확인함)

`memory-bank/STATE.md:23`의 보류 항목과 일치한다.

- WebGL 컨텍스트 손실 처리 및 텍스처 공유 — 현재 없음(`upscaler`에 `webglcontextlost` 핸들러 없음). 컨텍스트가 손실되면 렌즈가 빈 화면이 될 수 있다.
- NIS 1x 우회 — `mag`가 1 근처일 때도 NIS 커널을 실행.
- overlay dim 구조 변경.
- fs API 최소화/CSP — M-7과 동일.

## 권장 수정 순서

1. **H-1** 실패 후 재시도 경로(자동 백오프 또는 라벨 클릭) — 작은 변경, 효과 큼.
2. **H-2** 기본 `aiMaxSize`를 자동(0)으로 바꾸거나 비용 상한 추가 + `-1` 경고.
3. **M-2** 타임아웃 시 워커 terminate/재생성, 렌더러 요청 코얼레싱.
4. **M-1** 캡처를 PNG Buffer/Blob URL로 전환, main 메모리 조기 해제.
5. **M-4** live 캡처 제약 최소화 + 실패 시 폴백/복귀.
6. **M-3** pointermove 그리기 rAF 코얼레싱.
7. **M-5/M-7/M-8/M-6** 이벤트 연결, 보안 하드닝, single-instance 구조, 공용 메서드 데이터.
8. Low 항목 묶음 정리(특히 L-5 UI 문구, L-7 문서/버전).

## 실기기 확인 필요(자동 리뷰로 판정 불가)

- GPU 경로의 각 셰이더(`bilinear`, `bicubic-catmull`, `lanczos3`, `nis`) 출력과 CPU 경로 결과의 시각적 일치.
- DirectML 세션 성공/실패 시 `provider` 표시와 CPU 대체 동작.
- 다중 모니터(서로 다른 DPI/배율, 음수 좌표 모니터)에서 live 캡처와 커서 좌표 매핑.
- 4K/다중 모니터에서 freeze 시작 시간과 메모리 사용량(M-1).
- H-2 시나리오: 4K, 돋보기 최대, 배율 x0.5에서 AI 응답 시간/타임아웃 여부.
- 타일 경계 아티팩트(특히 x4plus) — L-15.

## 검증 기록

```
npm run check
  > screenmagnify2@0.1.0 check
  > node --check electron/main.js && node --check electron/ai-worker.js &&
    node --check public/js/lens.js && node --check public/js/settings.js
  (통과)

추가 node --check
  electron/preload.js, public/js/main.js, public/js/methods.js,
  public/js/cpu-scaler.js, public/js/upscaler.js, public/js/nis-coefs.js  (모두 통과)

타일 스티칭 시뮬레이션 (192/32, 256, 4x nearest mock)
  500x300, 200x900, 771x513, 257x257, 1000x40 → 불일치 0

CPU 리샘플러 sanity
  nearest/bilinear/bicubic-catmull/lanczos3: identityMaxDiff=0
  상수 영상(200) 확대/축소: 모든 커널에서 200..200
```

## 리뷰하지 않은 것

- `models/*.onnx` 내용과 라이선스(파일 크기만 확인).
- `samples/` 이미지/텍스처의 시각적 품질(코드 아님).
- 실제 ONNX 추론 성능 수치(README의 측정값을 인용).
- 패키징(electron-builder) 설정 — 현재 리포지토리에 없음(L-7).

---

## 수정 결과 (2026-11-16)

| ID | 처리 | 내용 |
|---|---|---|
| H-1 | 수정 | AI 실패 시 `failAI`가 자동으로 모델을 다시 불러온다(2초 간격으로 늘리며 3회). 3회 뒤에는 `R` 키로 다시 시도. 라이브 루프가 중복으로 시작되지 않게 `liveLoopStarted` 가드. |
| H-2 | 수정 (기본값은 유지) | 기본 `aiMaxSize: -1`("돋보기")은 사용자가 정한 기본값이라 바꾸지 않았다. 대신 -1일 때만 **면적 예산**을 둔다(CPU 약 100만 화소, GPU 약 400만 화소). 넘으면 Bilinear와 "영역이 너무 커서" 문구. 숫자를 직접 고른 경우는 사용자의 선택이라 그대로. 리뷰 수정 중에 **작은 영역일 때 걸어 둔 AI 타이머가 큰 영역에서 그대로 실행되는 버그**도 찾아 고쳤다(`runAI` 시작 시 크기 재확인, 큰 영역이면 타이머 취소). |
| M-1 | 일부 수정 | `toDataURL()` 대신 `toPNG()` 바이트를 IPC로 보내고 렌더러는 Blob URL로 디코드(base64 복사 제거). 모니터별 `getSources` 반복 호출은 모니터마다 해상도가 달라 유지. |
| M-2 | 수정하지 않음 (제안이 위험) | 타임아웃 시 `aiWorker.terminate()`를 시험해 보니 **AI가 도는 중에 워커를 종료하면 Electron 프로세스 전체가 크래시**한다(종료 코드 127, crashpad). 코드에 이유를 주석으로 남기고, 타임아웃에 이르지 않도록 H-2 예산으로 막았다. 렌더러 요청 코얼레싱은 `aiBusy` 중 새 요청을 쌓지 않는 기존 구조로 충분하다고 판단. |
| M-3 | 수정 | `pointermove`와 채널 메시지에서는 좌표만 갱신하고 `requestRender()`로 프레임당 한 번만 그린다. |
| M-4 | 수정 | 실시간 캡처는 정확한 크기 제약으로 먼저 시도하고 실패하면 제약 없이 재시도. 그래도 실패하면 `lens:fail`로 돋보기를 닫고 메인 창에 사유를 토스트로 알린다(검은 전체 화면이 남지 않음). `display_id` 매칭 실패 시 목록 순서를 폴백으로 사용. |
| M-5 | 수정 | preload에 `ai.onEvent`를 추가하고 렌즈가 워커 오류/종료를 받아 `failAI`로 연결. |
| M-6 | 수정하지 않음 | `methods.js`는 ScreenMagnify와 공유하는 파일이라 `fallback`을 지우면 두 앱이 어긋난다. main의 `GPU_ONLY`와 "keep in sync" 주석으로 유지. |
| M-7 | 일부 수정 | 세 HTML에 CSP 메타, 모든 창에 `setWindowOpenHandler` 거부와 `will-navigate` 차단, `settings:set`은 메인/설정 창에서 온 요청만 허용. `sandbox:false`는 preload의 `require('../package.json')` 때문에 유지. |
| M-8 | 수정 | 잠금을 얻지 못한 인스턴스는 `whenReady`에서 초기화를 건너뛴다. |
| L-1 | 수정 | 조건이 풀리면 "AI 대기" 문구를 지운다. |
| L-2 | 수정 | 쓰지 않는 `shape` 인자와 잘못된 주석 제거. |
| L-3 | 수정 | 캡처 실패와 source 없음 때 메인 창에 토스트. |
| L-4 | 수정 | 목록에 없는 `aiMaxSize`는 가장 가까운 선택지로 표시. |
| L-5 | 수정하지 않음 | "화면 Freezed, Press ESC to continue"는 사용자가 직접 정한 문구다. |
| L-6 | 수정하지 않음 | 실제 측정으로 마지막 줄 아래 여백이 약 24px라 문제 없음(설정 창 454px). |
| L-7 | 일부 수정 | `main.css`의 "Rounded" 주석 수정. 버전/문서 불일치는 README(패키징 없음)와 맞다. |
| L-8 | 수정하지 않음 | 공유 파일(`upscaler.js`, `methods.js`, `ai-worker.js`)의 미사용 코드는 ScreenMagnify와 같게 두었다. |
| L-9 | 수정 | `npm run check`가 모든 JS(preload, main/methods/cpu-scaler/upscaler/nis-coefs 포함)를 검사. |
| L-10 | 수정 | 설정 저장을 임시 파일 후 rename(원자적). |
| L-11~L-15 | 수정하지 않음 | 출력 배율 검증, LRU, 2D 폴백 알림, `preserveDrawingBuffer`, 타일 패딩은 영향이 작거나 실기기 확인이 필요해 보류. 기타 nit 중 `aiMaxSize`가 문자열일 때의 비교(`Number()` 후 비교)만 수정. |

**확인:** 프로젝트의 임시 훅으로 정지/실시간 × CPU/GPU 조합에서 휠, Ctrl+휠, AI 표시를 재현해 렌더러 콘솔 오류(CSP 위반 포함) 0건. 워커 오류를 일으킨 뒤 AI가 자동으로 다시 시작되는 것, `lens:fail`이 돋보기를 닫고 메인 창을 복귀시키는 것, 면적 예산을 넘는 영역에서 추론이 시작되지 않는 것(추론 호출 0회)을 확인했다.

