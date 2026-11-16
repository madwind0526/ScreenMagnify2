# State

## Current Wave

- **Wave:** 1
- **Status:** Complete (v1.0.0 released, 사람의 실사용 확인 대기)
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-11-16 v1.0.0 패키징(`npm run dist`)/커밋/푸시/릴리스, 코드 리뷰 반영, Ctrl+S 저장 추가

## Wave History

| Wave | 작업 내용 | 상태 |
|------|-----------|------|
| 1 | ScreenMagnify 복사 후 돋보기 앱으로 개편: Freeze/실시간, 원형·사각 돋보기, 휠 배율(ScreenMagnify와 같은 단계), Ctrl+휠 크기(5%), 멀티 모니터, 보간 + AI(타일 처리, 한도 설정), 돋보기 모양 3종(카본 테두리 만화풍), 컴팩트 직각 UI | Done |

## Session Notes

- 원본은 `E:\Claude\ScreenMagnify`. `node_modules`는 그쪽으로의 디렉터리 junction. 모델 파일 `models/`는 복사본(71 MB).
- 사용자 취향: 직각 모서리, 컴팩트한 창, 설정 창 폭 = 메인 창 폭, 모델 목록은 크기 순, 기본 보간 Real-ESRGAN-x4v3, 기본 AI 한도 "돋보기", 기본 Freeze. 디자인은 샘플 이미지를 보여 주고 고르게 한다.
- 사용자가 지적한 사항: "ScreenMagnify와 같게"라고 한 동작이 달랐던 적이 있다(스크롤 배율 단계, CPU 경로) -> 복사 대상은 원본 코드와 직접 비교한다.
- 보류: 배포 패키징, 실사용(마우스) 확인, 실시간 AI의 CPU 부하 조절.
- 2026-11-16: `codereview.md`(전체 리뷰)의 수정 반영. 결과 표는 `codereview.md` 끝. AI 워커 `terminate()`는 크래시 -> 금지.
- 릴리스: GitHub `madwind0526/ScreenMagnify2` v1.0.0 (`ScreenMagnify2-1.0.0.zip`, 폴더형, 서명 없음, 모델 포함). 저장소는 공개.
- Ctrl+S 저장 창은 ScreenMagnify의 저장 모듈을 복사해서 사용한다(`public/js/save-dialog.js`).
