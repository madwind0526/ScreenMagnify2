# ScreenMagnify2

화면을 돋보기로 확대해 보는 Windows 도구입니다 (Electron). 실행하면 화면이 **정지(Freeze)** 되고, 마우스를 따라다니는 **돋보기**가 그 아래 부분을 확대해서 보여줍니다. 휠로 배율을 바꾸고, Ctrl+휠로 돋보기 크기를 바꿉니다. 보간은 일반 필터부터 **AI 초해상도(Real-ESRGAN, 4xNomosUni)** 까지 고를 수 있고, 모두 내 PC에서만 처리됩니다.

[ScreenMagnify](../ScreenMagnify)(영역을 선택해 결과 창에서 확대)를 바탕으로 만든, "돋보기를 움직이며 보는" 버전입니다.

앱 안의 글자는 한국어이고, 코드 주석은 영어입니다.

## 기능

- **화면 Freeze (기본) / 실시간.** 켜면 실행하는 순간의 화면을 모든 모니터에서 한 장씩 찍어 정지시킵니다. 끄면 움직이는 화면(동영상)을 그대로 확대해서 보여줍니다.
- **돋보기 모양 2가지.** 원형(1:1)과 사각형(가로가 긴 4:3). 크기는 화면 너비의 %로 정하고(기본 10%), Ctrl+휠로 5%씩 키우거나 줄입니다. 최대 크기는 설정의 배수(1~5배, 기본 2배)와 화면 너비의 50% 중 작은 쪽입니다.
- **배율 0.5배 ~ 64배.** 휠 한 칸이 한 단계입니다. 4배 미만은 0.5 단위, 그 위로는 1, 2, 4, 8 단위로 커집니다(ScreenMagnify와 같은 규칙). 배율을 바꿀 때 오른쪽 하단에 `x3.5`처럼 잠깐 표시됩니다.
- **돋보기를 움직이면 그 부분이 같은 배율로 확대됩니다.** 클릭 없이 마우스만 움직이면 따라옵니다.
- **멀티 모니터.** 모니터마다 창을 하나씩 띄우고, 마우스가 있는 모니터에서 돋보기가 나옵니다. 배율과 크기는 모니터가 바뀌어도 유지됩니다.
- **보간 방법.** 없음(최근접), Bilinear, Bicubic, Lanczos3, NIS, 그리고 AI 3종(크기 순):
  - **4xNomosUni SPAN** (1.7 MB): 가장 작고 빠릅니다.
  - **Real-ESRGAN-x4v3** (4.9 MB, 기본): 글씨와 그림 모두 선명하고 CPU에서도 빠릅니다.
  - **Real-ESRGAN x4plus** (67 MB): 그림에 좋지만 글씨가 깨질 수 있고 CPU에서는 너무 느려서 **GPU에서만** 고를 수 있습니다. NIS도 GPU 전용입니다. CPU로 바꾸면 각각 Real-ESRGAN-x4v3, Lanczos3로 자동 전환됩니다.
- **AI는 원본 해상도로 처리합니다.** 돋보기가 비추는 영역을 줄이지 않고 모델에 넣고, 256px보다 크면 타일(192px 단위, 가장자리 32px 겹침)로 나눠 처리해서 이어 붙입니다. 결과(4배 크기)를 화면에 맞춰 줄이거나 키워 보여줍니다. AI 결과가 나오기 전에는 Bilinear가 먼저 보입니다.
- **연산 장치 CPU/GPU.** CPU는 JS 리샘플러와 CPU 추론, GPU는 WebGL 셰이더와 DirectML 추론입니다.
- **돋보기 모양(테마) 3가지.** 깔끔, 강조, 돋보기(검은 카본 테두리와 손잡이가 있는 만화풍. 원형은 왼쪽 아래, 사각형은 아래 가운데에 손잡이).
- **Ctrl+S 저장.** 돋보기가 지금 보여주는 확대 화면을 PNG로 저장합니다. ScreenMagnify의 저장 모듈을 그대로 가져와서, 빠른 위치(바탕화면/문서/다운로드/사진), 폴더 탐색, 새 폴더, 미리보기, 같은 이름이면 번호 붙이기가 같습니다. 원형 돋보기는 원 바깥이 투명하게 저장됩니다. 실시간 모드에서는 Ctrl+S를 누른 순간의 화면을 저장합니다.
- **종료.** Esc(어느 창에서나 동작) 또는 마우스 오른쪽 클릭.

## 조작

| 조작 | 동작 |
|---|---|
| 마우스 이동 | 돋보기가 따라옴 |
| 휠 | 배율 올리기/내리기 (0.5 ~ 64배) |
| Ctrl + 휠 | 돋보기 크기 5%씩 (화면 너비 기준) |
| Ctrl + S | 돋보기가 보여주는 화면을 PNG로 저장 (ScreenMagnify와 같은 내장 저장 창) |
| Esc / 오른쪽 클릭 | 종료 (저장 창이 열려 있으면 저장 창만 닫힘) |

## 설정 (메인 창의 슬라이더 아이콘)

항상 위, 화면 Freeze, 시간 지연(초), 돋보기 크기(화면 너비 %), 돋보기 최대 크기(배, 정수), 보간 방법, 연산 장치, AI 최대 처리 크기(자동 / 돋보기 / 256~1024px), 돋보기 모양. 다크/라이트 테마는 메인 창 아이콘으로 바꿉니다.

## 실시간(동영상) 모드의 AI

Freeze를 끄고 AI 모델을 고르면, 모델이 화면의 최근 조각을 계속 처리합니다. 결과는 모델이 한 번 도는 시간만큼 실제 화면보다 늦고, 돋보기를 움직이는 동안은 일반 필터(Bilinear)가 보입니다. 안내창에 "지연이 있을 수 있습니다" 경고가 나옵니다.

## 설치

설치 프로그램은 없습니다. [Releases](https://github.com/madwind0526/ScreenMagnify2/releases)에서 `ScreenMagnify2-<버전>.zip`을 받아 쓰기 가능한 폴더(`Program Files` 제외)에 풀고 `ScreenMagnify2\ScreenMagnify2.exe`를 실행합니다. AI 모델이 들어 있습니다. Windows 10/11 64비트. GPU 옵션에는 DirectX 12 GPU가 필요합니다.

## 실행 (소스에서)

```bash
npm install            # onnxruntime-node, electron
npm start              # 또는 start.bat / stop.bat
npm run check          # node --check
npm run dist           # release/ScreenMagnify2-<버전>.zip (폴더형, 서명 없음)
```

Claude Code 셸에서는 `env -u ELECTRON_RUN_AS_NODE npx electron .`로 실행합니다. 설정은 `%APPDATA%\screenmagnify2`에 저장됩니다.

## 구조

| 경로 | 내용 |
|---|---|
| `electron/main.js` | 설정, 메인/설정 창, 모니터별 캡처와 돋보기 창, AI 워커 제어, Esc 전역 단축키 |
| `electron/ai-worker.js` | ONNX 세션(모델·장치별), 256px 이하는 한 번에, 그보다 크면 타일 처리 |
| `public/lens.html`, `public/js/lens.js` | 돋보기: 원본 해상도로 잘라서 보간해 그리고, 휠·크기·배율 표시·AI·실시간 처리 |
| `public/js/save-dialog.js`, `public/css/save.css` | Ctrl+S 저장 창 (ScreenMagnify의 `result.js`/CSS에서 복사, 그림 출처만 돋보기 스냅샷) |
| `public/js/methods.js` | 보간/AI 목록, GPU 전용 표시와 대체, 모델·장치별 AI 한도(`aiLimit`) |
| `public/js/upscaler.js`, `cpu-scaler.js` | WebGL2 필터 / JS 리샘플러 (ScreenMagnify에서 복사) |
| `public/assets/ring-carbon.png` | "돋보기" 모양의 카본 질감 (ComfyUI/Flux로 생성) |
| `samples/` | 테두리 질감 후보 8종과 샘플 시트 |
| `models/` | ONNX 모델 3개 (ScreenMagnify에서 복사) |

## 알려진 제한

- 연산 장치가 CPU인 PC에서 큰 영역을 AI로 처리하면 시간이 걸립니다(영역 면적에 비례). 이 PC의 CPU에서 Real-ESRGAN-x4v3는 640×400 영역이 약 3초입니다. "AI 최대 처리 크기"로 제한할 수 있습니다.
- AI가 실패하면 모델을 2초 간격으로 3번 자동으로 다시 불러옵니다. 그래도 안 되면 돋보기에서 **R** 키로 다시 시도합니다. 실시간 화면을 가져오지 못하면 돋보기를 닫고 메인 창에 이유를 표시합니다.
- 마우스를 직접 움직이며 쓰는 전체 흐름은 사람이 확인해야 합니다. 자동 확인은 창과 이벤트를 코드로 보내는 방식이었습니다.
- 코드 서명을 하지 않아 Windows SmartScreen 경고가 뜰 수 있습니다("추가 정보" -> "실행").
