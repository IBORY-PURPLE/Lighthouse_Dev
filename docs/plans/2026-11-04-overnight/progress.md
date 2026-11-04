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
