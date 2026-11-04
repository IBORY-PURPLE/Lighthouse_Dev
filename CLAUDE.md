# LightHouse

시각장애인이 음성으로 상품을 요청하면 봉사자가 AI 조언을 받아 찾아 주는 모바일 웹 서비스. AI는 봉사자의 어시스턴트다.

## 저장소 지도

| 경로 | 내용 |
|---|---|
| `apps/web/` | 웹 앱. Vercel Root Directory. 0블록 정적 speech-probe, 1블록~ Next.js |
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
- PR·Codex·Bugbot·병합·배포: `.claude/rules/pr-flow.md`
- 밤샘 루프·금지선: `.claude/rules/overnight-loop.md`
