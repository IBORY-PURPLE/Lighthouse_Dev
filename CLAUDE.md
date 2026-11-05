# LightHouse

시각장애인이 음성으로 상품을 요청하면 봉사자가 AI 조언을 받아 찾아 주는 모바일 웹 서비스. AI는 봉사자의 어시스턴트다.

## 저장소 지도

| 경로 | 내용 |
|---|---|
| `apps/web/` | 웹 앱(Next.js). Vercel Root Directory. 명령은 이 폴더에서 `npm run check` 등으로 돌린다 |
| `apps/web/src/app/` | 화면과 서버 함수(`enter/route.ts`, `api/*/route.ts`) |
| `apps/web/src/components/` | 화면 부품(`SpeechInput.tsx`, `StatusRegion.tsx`, `DemoHandoff.tsx`, `VolunteerChat.tsx`) |
| `apps/web/src/lib/` | 서버 공용 코드(`access.ts`, `volunteers.ts`, `llm.ts`, `rateLimit.ts`), 챗봇 지시문(`prompt.ts`), 문장 분석(`parseRequest.ts`), 브라우저 음성 입력(`speech.ts`), 매칭 호출과 시연 이어 보기(`matchHandoff.ts`), 챗봇 호출(`chat.ts`), 답변 규칙 검사(`answerRules.ts`, 시험 전용) |
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
- 작업 추적(`bd`): `.claude/rules/beads.md`, 사용 안내 `docs/beads-guide.md`. 아래 `BEGIN BEADS` 블록보다 이 규칙이 우선한다.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
