# LightHouse

시각장애인이 음성으로 상품을 요청하면 봉사자가 AI 조언을 받아 찾아 주는 모바일 웹 서비스. AI는 봉사자의 어시스턴트다.

## 저장소 지도

| 경로 | 내용 |
|---|---|
| `apps/web/` | 웹 앱(Next.js). Vercel Root Directory. 명령은 이 폴더에서 `npm run check` 등으로 돌린다 |
| `apps/web/src/app/` | 화면과 서버 함수(`enter/route.ts`, `api/*/route.ts`) |
| `apps/web/src/components/` | 화면 부품(`SpeechInput.tsx`, `StatusRegion.tsx`, `DemoHandoff.tsx`) |
| `apps/web/src/lib/` | 서버 공용 코드(`access.ts`, `volunteers.ts`, `llm.ts`, `rateLimit.ts`), 문장 분석(`parseRequest.ts`), 브라우저 음성 입력(`speech.ts`), 매칭 호출과 시연 이어 보기(`matchHandoff.ts`) |
| `apps/web/public/speech-probe/` | 0블록 음성 시험 정적 페이지(`/speech-probe/`) |
| `apps/web/tests/{unit,e2e,chatbot}/` | Vitest 단위, Playwright 화면(가짜 음성: `e2e/helpers/fakeSpeech.ts`), 챗봇 고정 질문 |
| `docs/plans/<날짜>-<이름>/` | 계획. `human.md`(사람용), `ai.md`(실행 기준), `progress.md`(진행 기록), `morning-report.md`(아침 보고) |
| `docs/plans/2026-11-03-iphone-mvp/human.md` | 전체 개발 계획 |
| `docs/TSD.md` | 기술 설계서 |
| `.claude/rules/` | 개발 규칙(자동 로드) |
| `.claude/hooks/guard.js` | 금지 명령 차단 훅. 이용자 허락 없이 수정 금지. 시험: `guard.test.js` |
| `.github/ISSUE_TEMPLATE/` | 이슈 템플릿 |

코드 폴더를 만들면 이 표에 추가한다. 웹 배포는 저장소 루트가 아니라 `apps/web`이다.

## 새 세션을 시작할 때

1. 이 파일
2. 오늘 `ai.md`의 내 블록
3. 오늘 `progress.md`의 마지막 항목

이후는 검색으로 찾은 파일만 연다(`.claude/rules/file-navigation.md`).

## 규칙

- 완료 기준: `.claude/rules/success-criteria.md`
- 챗봇 품질: `.claude/rules/chatbot-quality.md`
- 파일 탐색: `.claude/rules/file-navigation.md`
- PR·Codex·병합·배포: `.claude/rules/pr-flow.md`
- 밤샘 루프·금지선: `.claude/rules/overnight-loop.md`
