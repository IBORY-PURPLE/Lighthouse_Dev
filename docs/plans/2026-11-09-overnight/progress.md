# 11/9 밤샘 진행 기록

`.claude/rules/overnight-loop.md` "진행 기록 형식"으로 시간순으로 쌓는다. 밤 블록 항목은 `docs/overnight-1109` 브랜치에서 추가한다(ai.md 3.5). 아래 첫 항목은 블록이 아니라 계획을 쓴 낮 세션의 기록이다.

## 2026-11-09 (낮) 문서 세션: ai.md 작성 (클라우드 세션, 블록 아님)
상태: 완료(ai.md 작성·푸시). 블록 0 전.
PR: 없음(브랜치 `claude/cloud-brief-ai-plan-pim0gp`. human.md·notes·research·tsd-review·실험 서버는 `docs/1109-ai-plan` 커밋 `9a881dd`를 그대로 포함), 실패 횟수: 0
결정:
- 정해 줄 것 1~11을 이용자가 모두 추천안으로 확정했다(human.md). ai.md 1.5절 표가 실행 기준이다.
- ai.md는 사실 확인 2 → 초안 3 → 심사 2 → 통합 1 → 검증 4렌즈 × 3회·수정 2회(하위 에이전트 22개)로 썼고, 마지막 검증에 남은 지적(유료 호출 상한 단위, 3.5 시간 포함, 블록 0 예약 시작 중복, 블록 6 체크아웃 순서, 문서 브랜치 이름 등)은 메인 세션이 고쳤다.
- 훅 차단 1회(실패로 세지 않음): 클라우드 세션의 원격 이름이 `origin`뿐이라 `git push -u origin …`이 `guard.js:131`에 막혔다. 훅을 고치거나 끄지 않고, 같은 저장소 URL(`https://github.com/IBORY-PURPLE/Lighthouse_Dev`)의 `github` 원격을 이 컨테이너에 추가해 `git push github <브랜치>`로 푸시했다. PC에는 `github` 원격이 이미 있어 해당 없음.
- 발견: `guard.js:158`이 base가 `main`이 아닌 PR의 `gh pr merge`를 막아 `pr-flow.md` "병합" 표(기능 PR을 AI가 단계 브랜치에 squash 병합)와 충돌한다. `guard.js:198`은 AI의 훅 편집도 막는다. 사람이 정할 일이다(ai.md 블록 0 할 일 2, 9절 1). 허락이 없으면 모든 기능 PR은 `hold-morning`이고 단계 PR은 밤에 열리지 않는다.
- `CLAUDE.md` 지도에 `apps/web/experiments/vision/` 줄을 추가했다(`89d9cb1`).
- `github/main`(`3206331`)의 계획 폴더에는 `tsd-review.md`만 있다. 이 브랜치가 main에 병합되지 않은 채 밤이 시작되면 블록 0 할 일 5대로 계획 폴더 사본을 `docs/overnight-1109`에 먼저 커밋한다.
다음 할 일: 사람이 이 브랜치의 PR을 main에 병합하고, ai.md 5절 "자기 전" 표대로 준비(캡처·정답 메모, OpenAI·Upstage 키, 세 가지 허락)한 뒤 블록 0을 시작한다.
토큰: 미측정(이 세션의 하위 에이전트 사용량 약 640만 토큰은 측정값, 메인 세션은 미측정). 예상 대비 미측정.

## 00:40 블록 0 사전 점검
상태: 완료
PR: 없음(블록 1이 `feat/demo4/experiment`의 PR을 base `stage/demo4`로 연다), 실패 횟수: 0
시작 00:17 사람(메인 세션 `local_317d473e-56b7-4ce2-8976-dfd8dfcb2955`, 이용자 깨어 있음)

점검 표(값은 보지 않고 있음/없음만):

| 항목 | 결과 |
|---|---|
| 셸 | Git Bash(GNU bash 5.2.37, msys) |
| 원격 | `github` = https://github.com/IBORY-PURPLE/Lighthouse_Dev.git 있음. `origin`은 Cursor(푸시 금지) |
| 문서 PR | #20 병합됨. `github/main` = `a4fdd26`에 ai.md·human.md·notes·progress.md 있음 → 할 일 5의 사본 커밋 불필요 |
| `CLAUDE.md` 지도 `experiments/vision` 줄 | `github/main`에 있음(1줄) |
| `stage/*` | 블록 0 전 원격에 없음 → `stage/demo4` 생성·푸시(= `a4fdd26`) |
| gh | IBORY-PURPLE 로그인(repo·workflow 범위). GraphQL 됨(`gh pr list` 성공) → `gh pr create/edit/comment` 그대로 쓴다. `hold-morning` 라벨 있음 |
| vercel | whoami `ibory-purple`, 팀 `iborys-projects`, `apps/web/.vercel` 링크 있음. `vercel project ls`의 lighthouse-web 표시 Node `22.x` |
| codex | codex-cli 0.166.0, ChatGPT 로그인 |
| supabase | CLI 2.98.2, `projects list`에 `lighthouse`(ref `zdnlhnzybbuloquzxwkg`, 서울) LINKED ●. 비대화형 플래그: 전역 `--yes`(모든 질문 예), `init --force`, `link --project-ref`, `db push --linked`·`--dry-run`·`--include-all` |
| bd | 1.3.4 |
| claude CLI | 2.1.309(이 밤은 쓰지 않음, 아래 이어 달리기) |
| 검사 기준선(`a4fdd26`) | `npm ci` 0, `npm run check` 0(unit 160/160, lint가 `experiments/` 포함 통과), `npx playwright install webkit` 0 |
| PC 키(실험 서버 `/api/status`, `ed70cfe`) | Groq true, OpenAI true, Upstage **false** |
| Vercel 변수 이름 | `GROQ_API_KEY`(production·development), `DEMO_ACCESS_CODE`(production), `SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`NEXT_PUBLIC_SUPABASE_URL`(production·preview). **`OPENAI_API_KEY` 없음**(00:40 사람에게 production 등록 요청, 블록 2·4·6은 배포 전에 `vercel env ls`로 이름만 다시 본다), `UPSTAGE_API_KEY` 없음 |
| 캡처·정답 메모 | **없음**(`test-results/vision-samples/` 없음, `public/sample.jpg` 없음). 이용자 결정(00:30): 합성 이미지로 진행 |
| 접근 코드 파일 | `.demo-access.local` 2줄 |
| 공개 주소 | https://lighthouse-web-five.vercel.app 맞음(루트 200, `/api/health` 쿠키 없이 401 정상) |

결정:
- 세 허락(이용자 00:30 답): 훅 수정 아니오(모든 기능 PR `hold-morning` + `조건 충족·훅 차단` 구분, 단계 PR은 밤에 열지 않음), db push 예, 통합 배포 푸시 예.
- 캡처·정답 메모 없음 → 블록 1은 합성 이미지로 절차만, 결과표에 `정답 메모 없음`, C6 `미완료`. 블록 2 공개 완주(C7)도 실제 캡처 없이 합성 이미지로 하고 그렇게 적는다. 아침 보고 첫 줄 대상(6절).
- Upstage 키 없음 → 결정 9대로 블록 1 비교 엔진은 luna + Groq qwen.
- 이어 달리기는 **워크플로 방식**으로 확정. 시험(00:33, 워크플로 `wf_aac5a4a6-630`): 에이전트가 떴고(`block-test.started`), 그 안에서 `guard.test.js` 122/122, 환경 변수 출력 탐침이 훅에 차단됨, 권한 질문 없음. 메인 세션의 Workflow 스크립트가 블록 1→2→3→4→(5)→6을 차례로 띄우고, 블록 에이전트가 실패하거나 죽어도 다음 블록을 띄운다. 블록마다 읽기 전용 독립 점검 에이전트가 다음 블록과 나란히 돌아 `test-results/overnight-1109/review-block-<N>.md`에 결과를 남기고, 블록 6이 아침 보고에 반영한다.
- 블록 에이전트의 3.5 규칙: 1~5와 8은 그대로. 6은 다음 블록을 띄우지 않고 `date > test-results/overnight-1109/block-<M>.started`만 만든다(`다음 블록 시작 시도` 줄은 쓰지 않는다). 7은 하지 않는다.
- 안전망 예약 작업은 걸지 않았다(워크플로와 같은 작업 트리에서 이중 실행될 위험이 있어서). 앱이나 PC가 꺼지면 아침 재개. 절전은 앱의 깨어 있기 요청으로 막는다.
- 블록과 무관한 사전 로컬 변경(손대거나 커밋하지 않는다): 미추적 `.codex/`, `AGENTS.md`, `agent`, `status`, `supabase/`(11/9 낮 init·link한 `config.toml`·`.gitignore`. 블록 4가 계획대로 커밋한다), 추적 파일 삭제 `docs/plans/team_plan.pdf`(이용자 쪽 삭제. 되살리거나 커밋하지 않는다).
- 훅 차단 1회(실패로 세지 않음): `feat/demo4/experiment` 첫 커밋 메시지에 키 파일 이름 글자가 들어가 `[guard] 차단: .env 접근`. 메시지에서 그 글자를 빼고 커밋(`ed70cfe`). 우회 아님.
- `server.mjs` 키 파일 후보를 할 일 1의 2곳에서 3곳으로 늘렸다(`apps/web` 아래 두 곳과 루트. 위치 미확인 대응. 차이는 이 한 줄).
- 시간: 블록 1은 00:45께 시작, 표 상한 02:00(작업 멈춤 01:50). 배정 120분보다 짧다(3.6 min 규칙).
다음 할 일: 블록 1 비전 실험(`feat/demo4/experiment` ← `stage/demo4`). 이미 `ed70cfe`(키 플래그) 1커밋이 있다.
호출: luna 0장(누계 0/500), Upstage 0장(누계 0/500), Groq qwen 0회(누계 0), Groq gpt-oss 0회(누계 0/200)
시작 브랜치 분기 근거: 해당 없음(블록 0)
다음 블록: 1
확인된 방법: 워크플로
이어 달리기 명령: 메인 세션 local_317d473e-56b7-4ce2-8976-dfd8dfcb2955의 Workflow 스크립트 overnight-1109가 블록 에이전트를 차례로 띄운다(블록 에이전트는 3.5의 6에서 block-<M>.started만 만들고 자식을 띄우지 않으며, 7을 하지 않는다)
안전망: 아니오(워크플로가 다음 블록을 띄움)
자식 생존: 됨(워크플로 에이전트, 앱이 켜져 있는 동안)
훅 적용: 됨
훅 수정 허락: 아니오
db push 허락: 예
통합 배포 푸시 허락: 예
토큰: 미측정, 예상 대비 미측정
