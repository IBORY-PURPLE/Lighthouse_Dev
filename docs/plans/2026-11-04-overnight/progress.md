# 11/4 밤샘 진행 기록

항목 형식은 `.claude/rules/overnight-loop.md`를 따른다. 다음 세션은 마지막 항목만 읽는다.

## 00:20 블록 0 사전 점검
상태: 완료
PR: 없음(speech-probe는 [#5](https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/5)로 main에 있음. Codex를 돌리지 않았고 Bugbot은 문서 PR이라 `skipping`), 실패 횟수: 0
결정:
- 통과: gh 로그인, vercel 로그인, codex 로그인, `github` 원격, `ANTHROPIC_API_KEY` 없음, `hold-morning` 라벨, `evidence` 브랜치.
- Vercel 프로젝트: `lighthouse-web`(`apps/web/.vercel`에 링크). 이 프로젝트에만 배포한다.
- Bugbot 수신은 [#2](https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/2)의 `SUCCESS`로 확인.
- 고정 주소로 적었던 `lighthouse-web.vercel.app/speech-probe/`는 블록 0 시점에 308 후 404였다. 원인은 블록 1 항목 참고.
- `GROQ_API_KEY`는 Vercel에 Development로만 등록돼 있었다. Production에 있는 이름은 `Groq_API_key`라 코드가 읽는 이름과 대소문자가 다르다. 이용자에게 이름 수정을 요청했다. 코드에 대소문자 우회를 넣지 않는다. 블록 4 전에 다시 확인한다.
- 음성 시험: 이용자가 아이폰에서 `lighthouse-web-five.vercel.app`의 speech-probe로 시험했고 "안녕하세요 저는 소니 헤드셋을 원합니다"가 그대로 인식됐다. 인식 문장에 VoiceOver 낭독이 섞이지 않았다. 이벤트 로그와 어느 버튼을 눌렀는지는 확인되지 않았다.
- 입력 결정: `PRIMARY_INPUT='speech'`. `SPEECH_START_DELAY_MS=1000`은 임시값이다(어느 버튼인지 미확인이라 안전한 쪽). 이용자가 답하면 바꾼다.
- 시작이 늦어 블록 1 구현 01:15, 검증 포함 01:30 끝으로 조정했다. 30분 지연은 블록 6 버퍼에서 흡수한다.
다음 할 일: 블록 1 `feat/skeleton`
토큰: 미측정

## 00:58 블록 1 뼈대
상태: 미완료
PR: [#7](https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/7) `hold-morning`, 실패 횟수: 2
결정:
- 공개 주소는 `https://lighthouse-web-five.vercel.app`이다(`vercel inspect`의 별칭). `lighthouse-web.vercel.app`은 다른 사람의 사이트이니 쓰지 않는다. 블록 0의 404 원인이 이것이다. `vercel.json`은 `{"framework":"nextjs"}`만 남겼고 `/speech-probe/`는 308 1회 후 200이다.
- 시험 폴더: `apps/web/tests/{unit,e2e,chatbot}`. 공개 주소 시험은 `tests/e2e/public.spec.ts`이고 Playwright 프로젝트 `public`으로 돈다. 접근 코드는 저장소 루트 `.demo-access.local` 첫 줄에서 읽는다. 둘째 줄은 시연 주소다.
- WebKit: Windows에서 동작한다. `devices['iPhone 15']` + WebKit으로 `test:e2e` 4개 통과. `http://localhost`에서도 `Secure` 쿠키가 저장된다. Chromium 대체 불필요.
- 2블록은 `github/feat/skeleton`에서 시작하고 PR base를 `feat/skeleton`으로 둔다(#7 보류).
- `/`는 쿠키 없이 열린다. `/api/health`는 쿠키가 없으면 401이다. 이후 API의 401은 `{ ok: false, error: "unauthorized" }` 형식을 따른다. `src/lib/llm.ts`에 `getLlmMode()`만 있다.
- `.vercelignore`에 시험 폴더와 시험 설정을 넣어 배포에서 뺐다.
- 주간 사용량은 `mcp__ccd_session_mgmt__get_usage`로 잴 수 있다(블록 1 끝 전체 모델 26%, 이 세션 문맥 약 18.5만 토큰).
막힌 것:
- Codex: `codex exec -s workspace-write`가 Vitest와 Playwright를 `spawn EPERM`으로 시작하지 못해 2회 모두 판정 `실패`(코드 결함 0건, 원인은 실행 환경). 샌드박스를 넓히는 일은 AI가 정하지 않았다. 해결 전까지 이후 PR도 Codex 미통과로 전부 보류된다.
- `DEMO_ACCESS_CODE`: 값은 `.demo-access.local`에 있으나 `vercel env add`를 권한 분류기가 막았다(비밀 저장소 쓰기). 우회하지 않았다. 등록 전까지 공개 주소 `/enter`는 모든 코드에 401이고 `/api/health`도 401이다.
- `GROQ_API_KEY`: Production에 이름이 `Groq_API_key`로 있다. 수정 전까지 `groqKeyConfigured`는 false일 것이다(공개 주소에서는 위 이유로 아직 못 봄).
- 환경 변수를 고치면 재배포해야 반영된다. 그 뒤 `BASE_URL=https://lighthouse-web-five.vercel.app npm run test:public`을 돌린다.
검증: `npm run check` 0(12개), `test:e2e` 0(4개, 가짜 음성 입력 없음), 공개 주소 열림, 틀린 코드 401, 맞는 코드 303은 로컬만 통과, health `true`는 미확인, `git status`에 비밀 파일 없음. Bugbot `success` 지적 0건(10분 34초).
실패 목록: Codex 판정 실패 2회(`spawn EPERM`). 훅 차단 2회와 권한 차단 1회는 실패로 세지 않았다.
배포: `feat/skeleton` `2273e20`.
다음 할 일: 블록 2 `feat/user-screen`을 `feat/skeleton` 위에서 시작
토큰: 미측정(세션 문맥 약 18.5만, 호출 누적 입력/출력은 잴 수 없음), 예상 대비 미측정. 시간은 00:25~00:58로 조정 끝 01:30보다 빠름.

## 01:22 블록 2 이용자 화면
상태: 완료
PR: [#9](https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/9) `hold-morning`(보류 PR #7 위에 쌓임, 실패 이력 있음), 실패 횟수: 1
결정:
- Codex 방식(이용자 결정 "시험 기록으로 판정"): Claude가 최종 커밋에서 `npm run check`, `npm run test:e2e`를 돌려 전체 출력을 저장소 루트 `test-results/<PR번호>-<명령>.txt`에 둔다. 첫 줄은 커밋 해시와 명령, 끝 줄은 종료 코드다. Codex는 저장소 루트에서 `codex exec -s workspace-write -o test-results/codex-<PR번호>.md "<프롬프트>"`로 돌린다. 프롬프트는 PR 번호, 합격 기준 줄, 기록 파일 경로, "시험을 실행하지 마세요. 기록 파일과 코드를 읽고 합격 기준대로 판정하세요. 기록의 커밋 해시가 현재 HEAD와 다르거나 기록이 없는 항목은 판정 불가로 적으세요. 코드를 고치거나 커밋하지 마세요."만 넣는다. PR 본문에 `Codex: 시험 기록 판정(직접 실행 아님, spawn EPERM 때문)`을 적는다. 판정 불가 항목은 `미완료`다.
- `apps/web/test-results/`는 Playwright가 시작할 때 지운다. 기록 파일은 루트 `test-results/`에 두고, 스크린샷은 다음 시험 전에 올린다.
- 스크린샷 업로드는 `gh api ... -f content=...`가 명령 길이 제한에 걸릴 수 있어 JSON 파일을 만들어 `--input`으로 보냈다.
- 3블록 시작점: `github/feat/user-screen`, PR base `feat/user-screen`.
- 3블록이 이어 붙일 곳: `src/app/page.tsx`의 `handleSubmit`. 지금은 `submit`만 보내 `submitting`에 머물고 API를 부르지 않는다. 제출 문장은 `model.submitted`, 안내 문구는 `src/lib/speech.ts`의 `STATUS`에 있다. 매칭 결과 상태는 아직 없다.
- 시험은 `tests/e2e/helpers/fakeSpeech.ts`의 `installFakeSpeech`(페이지 열기 전), `say`, `fail`, `never`, `removeSpeechApi`를 쓴다. 가짜를 깔지 않으면 음성 API가 없는 화면(입력창)으로 열린다. API 없음은 버튼을 누르기 전, 화면이 열릴 때 판단한다.
- 화면 이름: 제목 "LightHouse 상품 요청", 버튼 "눌러서 말하기", "이대로 요청", "다시 말하기", 입력창 라벨 "찾는 상품", 문서 제목 "상품 요청 - LightHouse".
- TSD에 없어 정한 것: 듣기 시작 뒤 15초 안에 끝나지 않으면 끊고 못 들은 것으로 친다(버튼 멈춤 방지). 표에 없는 오류 코드와 결과 없는 `end`도 못 들은 것으로 친다. 안내 문구 "못 들었습니다. 버튼을 눌러 다시 말씀하세요."와 "입력창에 찾는 상품을 입력하세요."를 추가했다.
- 듣는 동안 초점이 있는 버튼의 이름과 상태를 바꾸지 않는다. VoiceOver가 다시 읽어 마이크에 섞이지 않게 하려는 것이다.
남은 것:
- Bugbot: 10분 28초에 결과가 나와 대기 기준 10분을 28초 넘겼다(01:20 확인은 `pending`, 01:21 확인에서 도착). 체크 결과는 `skipping`이라 리뷰 댓글로 판정했다. 심각한 지적 0건, 사소한 지적 1건(Low): 빈 값을 두 번 제출하면 안내 문구가 같아 VoiceOver가 다시 읽지 않는다. 고치지 않고 PR에 남겼다. 블록 1·2 모두 10분을 조금 넘겼으니 뒤 블록은 11분까지 볼 만하다. 이 기준 변경은 규칙 소관이라 사람이 정한다.
- 판정 뒤 `progress.md` 커밋을 올려 Bugbot이 다시 돌 수 있다. 코드 변경은 없다.
- Codex의 판정 불가: TSD §7의 매칭 완료 이후·봉사자 화면·답변 안내는 3·4블록 범위라 이 PR에 없다. 구현된 문구는 합격이다.
- 사람 판정: 실제 아이폰 음성 인식, VoiceOver 낭독, `SPEECH_START_DELAY_MS=1000`(임시값). "듣고 있습니다. 말씀하세요." 안내는 마이크가 열린 뒤 나오므로 인식 문장에 섞이는지 아침에 본다(TSD §7 그대로 구현).
검증: `npm run check` 0(37개), `npm run test:e2e` 0(26개, 가짜 음성 입력 기준), 커밋 `c88ef71`. Codex 합격(시험 기록 판정, 심각한 지적 0건), Bugbot 심각한 지적 0건. `git status`에 비밀 파일 없음. 환경 변수와 `.env` 값은 다루지 않았다.
실패 목록: 1회. `npm run check`, eslint `@typescript-eslint/no-this-alias`(`fakeSpeech.ts:57`). 고친 뒤 재발 없음.
배포: 없음(블록 2에 배포 단계가 없다). 공개 주소는 아직 `feat/skeleton` `2273e20`이다.
다음 할 일: 블록 3 `feat/match`를 `feat/user-screen` 위에서 시작
토큰: 미측정(호출 누적 입력/출력은 잴 수 없음), 예상 대비 미측정. 시간은 00:58~01:22로 끝 시각 02:30보다 빠름.
