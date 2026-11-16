# Trouble Shooting

> 발생했던 버그와 해결 방법. 같은 문제를 두 번 겪지 않기 위한 기록.

## 실행하면 화면이 검고 Esc도 안 먹음

### 증상
돋보기 창이 검은 화면으로 뜨고 Esc로 빠져나올 수 없음.

### 원인
1) `screen.setCursorScreenPoint`는 Electron에 없는 함수라 창이 뜬 직후 JS 오류. 2) 그림 디코딩 전에 창을 먼저 보여 검은 창이 보임. 3) 새 창은 키보드 포커스를 못 받아 창 안의 keydown이 안 옴.

### 해결
마우스를 옮기지 말고 현재 커서 위치에서 돋보기를 시작. 렌더러가 `bg.decode()` 뒤에 `lens:ready`를 보내면 그때 `show()`. Esc는 `globalShortcut` + `before-input-event`로 받는다.

## 창 크기가 모니터보다 작음

### 증상
전체 화면용 frameless 창이 작업 표시줄만큼 낮게(예: 1392/1440) 생김.

### 해결
`win.setBounds(display.bounds)`를 show 직전에 다시 호출.

## 휠을 돌려도 반응이 없음

### 원인
코드를 블록 단위로 치환하다가 `showBadge` 함수가 같이 지워져 휠 핸들러가 ReferenceError로 중단됨 (렌더러 오류는 터미널에 안 보임).

### 해결
함수를 복구. 테스트 훅에서 `webContents.on('console-message')`로 렌더러 오류를 모으고, 큰 수정 뒤 휠/Ctrl+휠을 이벤트로 재현해 본다.

## 테스트 중 사용자 화면에 "Error launching app" 창

### 원인
없는 스크립트 경로로 `electron`을 `ELECTRON_RUN_AS_NODE` 없이 실행하면 GUI 오류창이 뜸. Python이 만든 `/tmp/...` 파일이 bash의 `/tmp`와 다른 경로(`C:\tmp`)에 생겨 파일이 없었음.

### 해결
임시 파일은 절대 경로(`C:/Users/<user>/AppData/Local/Temp/...`)로 만들고, 실행 전에 `ls`로 확인.

## 테스트 창에서 `window.api` 없음

### 원인
Electron 45의 BrowserWindow는 기본 `sandbox: true`라 preload의 `require('../package.json')`가 실패. 실제 앱은 `sandbox: false`.

### 해결
테스트용 창에도 `webPreferences: { sandbox: false, contextIsolation: true, preload }`.

## 실행 중인 앱 때문에 테스트가 바로 종료

### 원인
single-instance lock. `--user-data-dir=<임시>`를 주면 별도 인스턴스로 뜬다.

## `start.bat`이 앱을 못 끔

### 원인
`taskkill /FI "WINDOWTITLE eq ScreenMagnify2*"`는 BrowserWindow `title`이 아니라 HTML `<title>`을 따라간다. 페이지 제목이 `ScreenMagnify`면 필터가 안 맞음.

### 해결
`index.html`, `settings.html`, `lens.html`의 `<title>`을 `ScreenMagnify2`로.

## 1~4배에서 AI 결과가 깨짐 (ScreenMagnify 포함)

### 원인
AI 입력을 256px로 줄여 넣어 디테일이 사라진 뒤 4배로 키워 다시 줄임. GPU에서는 4배 결과를 일반 LINEAR로 줄여 계단이 생김.

### 해결
원본 해상도로 타일 처리, 한도를 넘으면 필터 표시, GPU는 mipmap. 비교 이미지로 확인(원본 / 256으로 줄인 AI / 원본 해상도 AI).

## 모델을 바꿨는데 이전 모델 결과가 보임 (ScreenMagnify)

### 원인
느린 모델(x4plus, CPU 3~17초)이 처리 중일 때 모델을 바꾸면 이전 결과가 나중에 도착해 새 모델 이름 아래 표시됨. 도착 시 "AI 모델인지"만 확인했음.

### 해결
요청 시점의 모델을 기억하고 결과가 도착했을 때 현재 모델과 다르면 버린다 (`requestModel`).

## AI 워커를 `terminate()`하면 Electron 전체가 크래시

### 증상
AI 추론이 도는 중에 `aiWorker.terminate()`를 호출하면 앱 프로세스가 종료 코드 127로 죽는다 (crashpad "not connected").

### 원인
onnxruntime-node가 네이티브 스레드에서 실행 중인 워커를 강제 종료하는 것은 안전하지 않다. (코드 리뷰가 "타임아웃 시 워커 재시작"을 제안했지만 그대로 적용하면 앱이 죽는다.)

### 해결
워커를 죽이지 않는다. 처리 시간이 타임아웃에 이르지 않게 렌더러가 영역 면적을 제한한다(`aiTooBig`, -1일 때 CPU 약 100만 화소 / GPU 약 400만 화소). `will-quit`에서의 종료는 유휴 상태에서만.

## 작은 영역에서 걸어 둔 AI 타이머가 큰 영역에서 실행됨

### 증상
배율을 낮춰 영역이 한도를 넘었는데도 큰 입력으로 AI 추론이 시작됨.

### 원인
`scheduleAI`의 `setTimeout`이 이전의 작은 영역에서 설정된 채 남아 있다가, 발동 시 현재(큰) `crop`으로 `runAI`를 실행. 크기 검사는 타이머를 걸 때만 있었다.

### 해결
크기가 커지면 `clearTimeout`하고, `runAI` 시작 시 `aiTooBig()`를 다시 검사한다. 비동기 작업은 실행 시점에 조건을 재확인한다.

## 저장 대화상자 CSS를 잘라 오다가 `.hidden`이 빠져 검은 화면

### 증상
Ctrl+S 기능을 옮긴 뒤 돋보기를 띄우면 검은 화면, 저장 창 없이 파일이 바로 저장되는 것처럼 보임.

### 원인
`result.css`에서 `.modal-backdrop`부터 `.hidden`까지를 `index()`로 잘랐는데 `.hidden`은 파일 앞쪽(83행)에 있어 `a:b`가 빈 문자열. 대화상자 마크업이 스타일 없이(숨김도 없이) 화면을 덮었다. 이어서 아이콘이 검게 보인 것은 main.css의 전역 `svg` 규칙이 없어서.

### 해결
끝 표식을 "시작점 뒤에서" 찾고(`index(marker, a)`), `.hidden`은 따로 붙인다. 복사한 UI는 반드시 실제 화면을 캡처해서 확인한다(조각 CSS가 의존하는 전역 규칙: svg, button, 변수).

## Ctrl+S가 "저장할 화면이 없다"고 함 (마우스를 움직이기 전)

### 원인
스냅샷 함수가 돋보기가 숨겨져 있으면(`display: none`) 바로 `null`을 돌려줬다. 창이 막 뜬 직후에는 포인터 이벤트가 오기 전이거나 `mouseleave`가 잘못 먼저 와서 돋보기가 숨겨져 있을 수 있다. 사용자가 화면을 한 번 클릭해야 저장되었던 이유.

### 해결
숨겨져 있어도 잠깐 보이게 하고(`display: block`) `draw()`로 그린 뒤 복사하고 다시 숨긴다. 이 창이 포인터를 한 번도 못 받았으면(다른 모니터) 채널로 `save` 요청을 보내 포인터가 있는 창이 저장 창을 연다(`hadPointer`).
