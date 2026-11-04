# LightHouse 11/4 밤샘 개발 실행 계획 (AI용)

- 승인일: 2026-11-04
- 1쪽 요약: `docs/plans/2026-11-04-overnight/human.md`
- 사람이 본 것은 1쪽 요약이고 이 파일이 실행 기준이다. 둘이 어긋나 보이면 human.md의 목표·범위·비용·일정이 우선이고, 이 파일은 그것을 실행 단계로 푼 것이다. 어긋남은 진행 기록에 적고 멈춤 조건(6절)을 따른다.
- 기술 명세: `docs/TSD.md`. 규칙: `CLAUDE.md`, `.claude/rules/*.md`. 이 파일은 규칙을 다시 쓰지 않고 파일명으로 가리킨다.

## 0. 이 파일을 읽는 법

세션마다 `.claude/rules/file-navigation.md`의 시작 순서를 따른다.

1. `CLAUDE.md`
2. 이 파일의 0~3절(공통)과 4절의 **내 블록 하나**. 다른 블록은 읽지 않는다.
3. `docs/plans/2026-11-04-overnight/progress.md`의 마지막 항목.

- 밤샘은 날짜가 11/5로 넘어가도 이 폴더(`2026-11-04-overnight`)를 쓴다.
- 블록 번호, 브랜치, 끝 시각은 4절 표를 기준으로 한다.
- TSD는 필요한 절만 `offset`/`limit`로 연다(324줄). 블록마다 읽을 절을 적어 두었다.

## 1. 목표와 완료 조건

**목표**(human.md:4): 아침에 눈을 가린 사람이 VoiceOver를 켠 아이폰에서 "sony껄로 헤드셋 사고싶어"라고 말하면 서버가 가상 봉사자를 매칭하고, 같은 아이폰의 봉사자 챗봇에 "sony 헤드셋 제품을 찾는 가이드 알려줘"라고 물으면 찾는 방법을 답한다(human.md:43).

**AI가 판정하는 완료 조건**(human.md:42). 모두 명령 결과나 파일로 확인한다.

| # | 조건 | 판정 방법 |
|---|---|---|
| C1 | 1~4블록 PR이 각각 열려 있다 | `gh pr list --state all --head feat/<기능>` 에 PR이 있다 |
| C2 | 각 PR 본문이 `.claude/rules/pr-flow.md` "PR 본문" 7항목을 채운다 | `gh pr view <번호>` 본문 확인 |
| C3 | 각 PR의 완료 조건 4개(`.claude/rules/success-criteria.md` "완료 조건")가 본문에 있다. 하나라도 없으면 `미완료`로 기록 | PR 본문, progress.md |
| C4 | `npm run check` 종료 코드 0 | 명령 출력 요약(통과 수, 종료 코드) |
| C5 | `npm run test:e2e` 종료 코드 0(가짜 음성 입력 기준) | 명령 출력 요약 |
| C6 | `npm run test:chatbot` 20문항 전부 `answerRules` 통과(실제 가격·재고·없는 모델명 0건, 세 항목 모두 포함) | 명령 출력 요약, `.claude/rules/chatbot-quality.md` |
| C7 | 최종 공개 주소에서 `test:public` 1회 완주(5블록 1회, 7블록 1회): `/enter` → `/` → 가짜 음성 → 매칭 → 시연 이어 보기 → `/volunteer` → 실제 Groq 답변 | 명령 종료 코드 0, 답변 첫 줄과 소요 시간 기록(TSD:285) |
| C8 | axe `critical`·`serious` 위반 0건 | `test:e2e` 출력(TSD:275) |
| C9 | `morning-report.md`가 `.claude/rules/overnight-loop.md` "아침 보고" 순서로 있다 | 파일 존재와 절 순서 |

- 완료 조건을 채워도 실패 이력이 있으면 그 PR은 보류다(human.md:42, `.claude/rules/success-criteria.md` "실패 세기").
- 사람 판정 항목(실제 VoiceOver 낭독, 실기기 음성 인식, 초점 낭독)은 완료 조건에 넣지 않고 `사람 판정 대기`로 적는다(`.claude/rules/success-criteria.md` "사람 판정 항목").

## 2. 확인된 사실

### 저장소에서 확인한 것 (2026-11-04, main `048e543`)

| 사실 | 근거 |
|---|---|
| 규칙 PR #2와 계획·TSD 문서 PR #3은 이미 main에 병합됐다 | `git log` main: `048e543 ... (#3)`, `af5ebcc Merge pull request #2` |
| `apps/`, `tests/`, `progress.md`, `morning-report.md`는 아직 없다 | `ls` 결과(이 문서 작성 시점) |
| 푸시는 `git push github <브랜치>` 형식만 훅이 허용한다 | `.claude/hooks/guard.js:131` |
| 강제·삭제·`--all`·`--tags`·main 푸시를 훅이 막는다 | `.claude/hooks/guard.js:128-139` |
| main 직접 커밋을 훅이 막는다 | `.claude/hooks/guard.js:122` |
| 훅은 Bash, PowerShell, Read, Edit, Write, NotebookEdit, Grep 호출에 걸린다 | `.claude/settings.json` |
| `.gitignore`에 `.env`, `.env.*`, `node_modules/`, `.next/`, `.vercel/`, `test-results/`, `playwright-report/`가 있고 `.demo-access.local`은 아직 없다 | `.gitignore` |
| PR 템플릿 파일은 없다(이슈 템플릿만 있음) | `.github/ISSUE_TEMPLATE/` |
| 스택: Next.js 16.4.5(App Router, TS, React 19), Node 22, `groq-sdk` 1.6.0, Vitest, `@playwright/test` 1.64.1, `@axe-core/playwright` 4.14.0 | TSD:61-69 |
| 폴더 구조와 파일 이름 | TSD:77-102 |
| 환경 변수 이름: `GROQ_API_KEY`, `DEMO_ACCESS_CODE`, `LLM_MODE` | TSD:112-116 |
| Vercel Root Directory=`apps/web`, `apps/web`에서 `vercel deploy --prod` | TSD:65, TSD:289-290 |
| 음성 입력 상태·전환 조건·`PRIMARY_INPUT`·`SPEECH_START_DELAY_MS` | TSD:134-148 |
| 접근성 상태 안내·초점 이동 표 | TSD:152-172 |
| API 4개(`/enter`, `/api/health`, `/api/match`, `/api/chat`)의 형식·오류 코드 | TSD:176-226 |
| 챗봇 호출값·지시문 초안·횟수 제한(match 분당 30, chat 분당 20) | TSD:230-250 |
| 시험 명령 4개와 필수 사례 | TSD:254-285 |
| Bugbot 체크 이름은 `Cursor Bugbot`, 기본 결과 `neutral`이라 댓글도 읽는다 | TSD:310 |
| 블록별 구현 범위 | TSD:299-308 |

### human.md가 확인됐다고 적은 것 (AI가 재확인하지 않음, 0블록 점검에서 다시 본다)

| 사실 | 근거 |
|---|---|
| `.env`의 GROQ_API_KEY 정리, Vercel·Codex·GitHub CLI 로그인, 안전 훅, `hold-morning` 라벨, Bugbot 실행 시작 | human.md:11 |
| GitHub에 main 보호 규칙이 없다 | human.md:47 |
| Groq `openai/gpt-oss-120b` 무료: 하루 1,000회, 분당 8,000토큰, 답변 약 1.3초·500토큰 | human.md:39 |
| Ultra 주간 한도 26% 사용, 11/9 10시 초기화, 추가 사용량 꺼짐 | human.md:48 |

### 미확인 (추측하지 않는다)

| 항목 | 언제 확인 | 확인 못 하면 |
|---|---|---|
| 아이폰 크롬 음성 인식, VoiceOver 낭독 섞임 | 0블록(사람) | `PRIMARY_INPUT='text'` (TSD:316-318) |
| Bugbot 결과 수신과 포함 사용량 | 0블록 | 결과 없으면 모든 PR 보류(TSD:323) |
| 쌓인 PR에서 Bugbot 동작 | 첫 쌓인 PR | 해당 PR 보류(TSD:324) |
| Groq 스트리밍 SDK 형식 | 4블록, 패키지 타입으로 | 한 번에 표시로 전환(포기 순서) |
| Playwright WebKit의 Windows 동작 | 1블록 | Chromium 모바일 크기로 돌리고 기록(TSD:263) |
| 밤샘 PC의 셸 종류(PowerShell/Git Bash) | 0블록 점검 | 이 파일의 명령은 Git Bash 기준이다. PowerShell이면 같은 뜻으로 바꿔 쓴다 |
| 밤샘 PC 저장소의 `github` 원격 이름 | 0블록 점검(`git remote -v`) | 없으면 멈춤(6절) |
| `create-next-app` 16.4.5의 정확한 플래그 | 1블록, `--help`로 | 수동 설치 |
| `codex` 로그인 확인 명령 | 0블록, `codex --help`로 | 로그인 확인 실패면 사람에게(잠들기 전) |
| 팀 일정표(#7~#9 문서) 위치 | 6블록 | 저장소에 없으면 오늘 코드 기준 초안만 쓴다 |
| `/api/health`가 접근 쿠키를 요구하는지 | 1블록 | TSD:176 공통 규칙대로 쿠키를 요구하고, 시험은 `/enter`로 쿠키를 받은 뒤 호출 |
| 주간 사용량을 밤사이 AI가 잴 수 있는지 | 1블록 | `미측정`으로 적고 시간 기준만 적용(`.claude/rules/overnight-loop.md` "시간과 토큰") |

## 3. 모든 블록에 공통인 절차

규칙 원문은 각 파일에 있다. 여기는 순서와 명령만 적는다.

### 3.1 시작

1. 0절 순서로 읽는다. 앞 블록 PR의 상태(병합/보류)를 progress.md에서 확인한다.
2. 시작 브랜치를 정한다(`.claude/rules/pr-flow.md` "보류 PR 위에 쌓기").
   - 앞 블록 PR이 병합됨 → `git fetch github main && git checkout -b feat/<기능> github/main`
   - 앞 블록 PR이 보류이고 이 블록이 그 코드에 의존 → `git checkout -b feat/<기능> github/feat/<앞 기능>`, PR base를 앞 브랜치로.
   - 1~5블록은 모두 앞 블록 코드에 의존한다.
3. 시작 시각과 블록 끝 시각을 progress.md 작업 메모에 적는다.

### 3.2 구현 중

- 시험은 가짜 응답(`LLM_MODE=mock`)으로 돈다(`.claude/rules/chatbot-quality.md` "운영"). 실제 Groq는 `test:chatbot`, `test:public`에서만.
- 실패(검사·시험·빌드·배포)가 날 때마다 progress.md에 명령과 오류 한 줄을 적는다. 새 시험을 먼저 쓰고 일부러 틀리는 첫 1회는 `의도된 실패`로 적는다(`.claude/rules/success-criteria.md` "실패 세기").
- 명령 출력은 실패 줄과 요약만 본다(`.claude/rules/file-navigation.md` "읽기 제한").
- 커밋 전 `git status --short`로 `.env`, `.demo-access.local`, 생성물이 없는지 본다.

### 3.3 PR과 검증 (각 블록의 "검증" 15분 안)

1. `git push -u github feat/<기능>`
2. `gh pr create --base <main 또는 앞 브랜치> --head feat/<기능> --title "<기능>" --body-file <본문 파일>`. 본문은 `.claude/rules/pr-flow.md` "PR 본문" 7항목. 본문 파일은 `test-results/`(무시 목록) 아래에 둔다.
3. 화면을 바꿨으면 스크린샷 1장을 `evidence` 브랜치 `<PR번호>/`에 올리고 링크한다(`.claude/rules/pr-flow.md` "화면 증거"). 방법: 기능 브랜치를 건드리지 않도록 GitHub API로 올린다.
   `gh api -X PUT repos/IBORY-PURPLE/Lighthouse_Dev/contents/<PR번호>/<이름>.png -f branch=evidence -f message="evidence: PR <번호> <화면>" -f content="$(base64 -w0 test-results/<파일>.png)"`
   링크: `https://github.com/IBORY-PURPLE/Lighthouse_Dev/blob/evidence/<PR번호>/<이름>.png`
4. **병렬**: Codex와 Bugbot을 동시에 기다린다.
   - Codex(`.claude/rules/pr-flow.md` "Codex 검증"): `codex exec -s workspace-write -o test-results/codex-<PR번호>.md "<프롬프트>"`. 프롬프트에는 PR 번호, 그 블록의 합격 기준(4절 "합격 기준" 줄을 그대로), 시험 실행 방법만 넣는다. Claude의 결론은 넣지 않는다. 결과는 `gh pr comment <번호> --body-file test-results/codex-<PR번호>.md`.
   - Bugbot(`.claude/rules/pr-flow.md` "Bugbot 검증"): 2분마다 최대 10분. `gh pr checks <번호> | grep -i bugbot` 와 `gh pr view <번호> --comments` 에서 Bugbot 댓글만 본다. 체크가 `neutral`이어도 댓글의 지적을 읽는다(TSD:310).
5. 판정: 기능 오작동·합격 기준 미달·보안·데이터 손실 지적 0건이면 `통과`. 심각한 지적은 고치고 다시 푸시·재검증하며 실패 1회로 센다. 사소한 지적은 PR에 남긴다.
6. 병합(`.claude/rules/pr-flow.md` "병합" 표): 실패 0, Codex·Bugbot 첫 판정 통과, 쌓인 PR 아님 → `gh pr merge <번호> --squash`. 아니면 `gh pr edit <번호> --add-label hold-morning`.
7. Bugbot 결과가 10분 안에 없으면 `미완료`, `hold-morning`, 다음 블록으로.

### 3.4 배포 (해당 블록만)

- `cd apps/web && vercel deploy --prod`. 사람이 지정한 프로젝트에만(`.claude/rules/pr-flow.md` "배포"). 저장소 루트에서 배포하지 않는다(TSD:290).
- 검사·시험을 통과한 최신 브랜치를 배포한다. 보류 PR이어도 된다. 배포한 브랜치·커밋을 progress.md에 적는다.

### 3.5 끝

- progress.md에 `.claude/rules/overnight-loop.md` "진행 기록 형식"으로 항목 하나를 추가하고, 그 블록 브랜치에 커밋·푸시한다(PR에 포함). 토큰은 잴 수 없으면 `미측정`.
- 블록 끝 시각에 미완료여도 멈추고 원인·시도·다음 할 일을 적는다(`.claude/rules/success-criteria.md` "막혔을 때").

### 3.6 블록 토큰 상한

블록 토큰이 예상의 150%를 넘으면 포기 순서(human.md:24)대로 범위를 줄인다(`.claude/rules/overnight-loop.md` "시간과 토큰"). 포기 순서: 문서 초안 → 시험 질문 수 → 답변 조금씩 표시(한 번에 표시로) → 화면 다듬기. 통합 완주, 최종 배포, 아침 보고는 끝까지 지킨다.

| 블록 | 예상 입력/출력 | 150% 선 |
|---|---|---|
| 1 | 600만/5만 | 900만/7.5만 |
| 2 | 1,300만/11만 | 1,950만/16.5만 |
| 3 | 800만/7만 | 1,200만/10.5만 |
| 4 | 1,500만/13만 | 2,250만/19.5만 |
| 5 | 1,100만/7만 | 1,650만/10.5만 |
| 6 | 700만/8만 | 1,050만/12만 |
| 7 | 500만/4만 | 750만/6만 |
| 합계 | 6,500만/55만 | - |

## 4. 단계별 작업

### 블록 한눈에 보기

| 블록 | 시각 | 브랜치 | 구현 끝 | 검증 끝(블록 끝) | 앞 블록 의존 |
|---|---|---|---|---|---|
| 0 | 자기 전 | `feat/speech-probe` | 사람 준비 뒤 약 20분 | 사람 음성 시험 끝 | - |
| 1 | 00:00~01:00 | `feat/skeleton` | 00:45 | 01:00 | 0 (Vercel 프로젝트, speech-probe) |
| 2 | 01:00~02:30 | `feat/user-screen` | 02:15 | 02:30 | 1 |
| 3 | 02:30~03:30 | `feat/match` | 03:15 | 03:30 | 2 |
| 4 | 03:30~05:00 | `feat/volunteer-chat` | 04:45 | 05:00 | 3 |
| 5 | 05:00~06:00 | `feat/integration`(코드를 고칠 때만) | 05:45 | 06:00 | 4 |
| 6 | 06:00~07:00 | 지적별 브랜치, 문서 초안 `docs/overnight-drafts` | - | 07:00 | 1~5 |
| 7 | 07:00~08:00 | `docs/morning-report` | - | 08:00 | 1~6 |

- 블록 사이는 **순차**다. 1~5블록은 앞 블록 코드 위에서 만들므로 동시에 돌리지 않는다. 블록 안에서는 Codex와 Bugbot 대기만 병렬이다.
- 각 블록은 새 세션이다(`.claude/rules/overnight-loop.md` "세션").

---

### 블록 0. 사전 점검 (자기 전, AI 약 20분 + 사람 약 10분)

human.md:15. 사람이 Vercel 빈 프로젝트를 지정하고 GROQ_API_KEY를 등록한 **뒤** 시작한다.

- **입력**: 사람이 지정한 Vercel 프로젝트 이름, human.md:11의 사람 준비 완료 여부.
- **읽을 TSD**: §4(TSD:73-108), §6 음성 시험 페이지(TSD:142-148), §11(TSD:287-295).
- **할 일**
  1. 첫 5분 점검(human.md:11). 값은 출력하지 않고 있음/없음만 본다.
     - 로그인: `gh auth status`, `vercel whoami`, Codex 로그인(명령은 `codex --help`로 확인, 미확인).
     - 원격: `git remote -v`에 `github`가 있다. 없으면 멈춤(6절).
     - 키: `node -e "console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY)"` 가 `false`. Vercel에 `GROQ_API_KEY` 이름이 있는지 `vercel env ls`(값은 표시되지 않는다). `.env` 파일은 열지 않는다.
     - 배포 권한: 지정 프로젝트에 링크(`cd apps/web && vercel link`, 프로젝트를 고르는 단계는 사람이 지정한 이름으로).
     - PR 권한·라벨: `gh label list | grep hold-morning`.
  2. `evidence` 브랜치를 main 커밋에서 만든다: `gh api repos/IBORY-PURPLE/Lighthouse_Dev/git/refs -f ref=refs/heads/evidence -f sha=$(git rev-parse github/main)`. 이미 있으면 건너뛴다.
  3. `feat/speech-probe` 브랜치에서 TSD:77-81 정적 파일을 만든다: `apps/web/index.html`(→ `/speech-probe/` 안내), `apps/web/speech-probe/index.html`(버튼 2개: 즉시 시작·1초 뒤 시작, API 유무·이벤트 순서·오류 코드·인식 문장 표시, 전송 없음, `lang="ko"`), `apps/web/vercel.json`, `apps/web/package.json`(`@lighthouse/web`). 같은 PR에서 `CLAUDE.md` 지도에 `apps/web`을 추가한다(`.claude/rules/file-navigation.md` "지도 유지").
  4. 배포: `cd apps/web && vercel deploy --prod`. 공개 주소 `/speech-probe/`가 열리는지 `curl -sI <주소>/speech-probe/`로 200 확인.
  5. 사람에게 주소를 넘기고 아이폰 크롬+VoiceOver 시험 결과를 받는다.
  6. 결과로 정한다(TSD:146-148): `PRIMARY_INPUT`(`speech`/`text`), `SPEECH_START_DELAY_MS`(0/1000). 사람 답이 없으면 `text`, 0.
  7. PR을 열고 3.3대로 Codex·Bugbot. Bugbot이 10분 안에 안 오면 잠들기 전에 사람에게 설정 확인을 요청한다(human.md:15).
  8. progress.md를 만들고 첫 항목(블록 0)을 쓴다. 입력 방식 결정, 지연값, Vercel 프로젝트 이름, Bugbot 수신 여부, 공개 주소(접근 코드 없는 주소)를 적는다.
- **산출물**: `apps/web/index.html`, `apps/web/speech-probe/index.html`, `apps/web/vercel.json`, `apps/web/package.json`, `CLAUDE.md`(지도), `docs/plans/2026-11-04-overnight/progress.md`, `evidence` 브랜치, PR(`feat/speech-probe`).
- **검증**: 점검 항목 전부 통과, `/speech-probe/` 200, Bugbot 결과 수신, 사람의 음성 시험 결과 기록.
- **합격 기준(Codex용)**: `/speech-probe/`가 공개 주소에서 열리고, 두 버튼이 음성 인식을 시작하며, API 유무·이벤트·오류·문장을 화면에 표시하고, 어떤 네트워크 전송도 하지 않는다.
- **예상**: 토큰 미집계(human.md:15), AI 약 20분.
- **병렬**: 2(evidence)와 3(파일 작성)은 동시에 해도 된다. 4는 3 뒤, 5~6은 4 뒤, 7은 3 뒤 아무 때나.
- **막혔을 때**: 로그인·원격·Vercel 지정 실패는 사람이 깨어 있으므로 바로 묻는다. Bugbot 미수신은 사람이 설정을 확인한다. 음성 시험이 안 되면 `PRIMARY_INPUT='text'`로 정하고 진행한다(human.md:15). Codex·Bugbot이 잠들기 전에 안 끝나면 PR을 `hold-morning`으로 두고, 1블록은 이 브랜치 위에 쌓는다.

---

### 블록 1. 뼈대 `feat/skeleton` (00:00~01:00, 구현 45분 + 검증 15분)

human.md:16, TSD:302.

- **입력**: progress.md 블록 0 항목(Vercel 프로젝트, 입력 방식 결정, speech-probe PR 상태).
- **읽을 TSD**: §3~5(TSD:59-122), §8 `/enter`·`/api/health`(TSD:176-186), §10 명령 표(TSD:254-263), §11(TSD:287-295).
- **할 일**
  1. `apps/web`에 Next.js 16.4.5(App Router, TypeScript, React 19, ESLint, `src/` 사용). `create-next-app` 플래그는 `--help`로 확인하고, 기존 정적 파일을 덮지 않도록 임시 위치가 아닌 `apps/web` 안에서 정리한다. 0블록 `index.html`, `speech-probe/`는 `public/speech-probe/`로 옮기고 `vercel.json`은 Next에 맞게 정리하거나 지운다(TSD:106, TSD:292).
  2. 개발 의존성: `vitest`, `@playwright/test@1.64.1`, `@axe-core/playwright@4.14.0`. 런타임: `groq-sdk@1.6.0`(4블록에서 쓰지만 여기서 설치해도 된다). `npx playwright install webkit chromium`.
  3. 스크립트(`apps/web/package.json`): `check`(ESLint + `tsc --noEmit` + Vitest), `test:e2e`, `test:chatbot`, `test:public`(TSD:256-259). 아직 없는 시험은 빈 자리 대신 작은 실제 시험 하나씩을 둔다.
  4. 시험 폴더 위치를 정한다(TSD:101 "1블록에서 정함"). 기본안: `apps/web/tests/{unit,e2e,chatbot}` (패키지 하나에 의존성을 모은다). 정한 위치를 `CLAUDE.md` 지도와 progress.md에 적는다.
  5. `src/lib/volunteers.ts`: 서버 전용 상수 3명, 모두 "가상 봉사자 A/B/C", 품목 담당 포함, 실명·연락처 없음(TSD:206).
  6. `src/lib/access.ts`, `src/app/enter/route.ts`: 코드 일치 시 `lh_access` 쿠키(코드의 SHA-256, HttpOnly, Secure, SameSite=Lax, 7일, 상수 시간 비교), `/`로 303. 틀리면 401(TSD:178-182).
  7. `src/app/api/health/route.ts`: `{ ok, groqKeyConfigured, llmMode }`, 키 값 반환 금지, `runtime='nodejs'`(TSD:184-186). 쿠키 요구 여부는 2절 미확인 항목대로.
  8. `DEMO_ACCESS_CODE` 생성·등록. 값이 화면·로그에 나오지 않게 파일로만 다룬다.
     - `node -e "require('fs').writeFileSync('.demo-access.local', require('crypto').randomBytes(16).toString('hex'))"`(저장소 루트, 처음 한 줄은 코드만)
     - `.gitignore`에 `.demo-access.local` 추가, `apps/web/.vercelignore`에 `.env*`, `.demo-access.local`(TSD:120-121).
     - Vercel 등록: 파일 내용을 표준 입력으로 `vercel env add DEMO_ACCESS_CODE production` 에 넘긴다.
     - 배포 뒤 시연 주소 전체(`<주소>/enter?code=...`)를 `.demo-access.local` 둘째 줄에 적는다. 아침 보고에는 파일 위치만(TSD:122).
  9. 아이폰 크기 화면 시험 설정: `devices['iPhone 15']` + WebKit. Windows에서 WebKit이 안 되면 같은 크기 Chromium으로 바꾸고 기록(TSD:263).
  10. `CLAUDE.md` 지도에 `apps/web` 하위 구조와 시험 폴더를 반영한다.
  11. 배포(3.4) 후 `/enter`로 쿠키를 받고 `/api/health`에서 `groqKeyConfigured: true` 확인(TSD:293). 접근 코드는 명령 줄에 직접 쓰지 않고 `.demo-access.local`에서 읽는다.
  12. 1블록 토큰을 잴 수 있으면 재서 progress.md에 적는다. 다음 블록 크기 조정의 근거다(human.md:48).
- **도구·명령**: `npx create-next-app@16.4.5`, `npm i`, `npm run check`, `vercel env add`, `vercel deploy --prod`, `curl`.
- **산출물**: `apps/web/` Next 앱, `apps/web/src/app/{enter/route.ts,api/health/route.ts}`, `apps/web/src/lib/{access.ts,volunteers.ts}`, 시험 폴더, `.gitignore`, `apps/web/.vercelignore`, `CLAUDE.md`, `.demo-access.local`(커밋 안 함), PR.
- **검증**: `npm run check` 종료 0, 공개 주소 열림, `/enter` 틀린 코드 401·맞는 코드 303, health `groqKeyConfigured: true`, `git status --short`에 `.demo-access.local`·`.env` 없음.
- **합격 기준(Codex용)**: 공개 주소가 열린다. `npm run check`가 통과한다. `/api/health`는 키 존재 여부만 돌려주고 값은 어디에도 나오지 않는다. `/enter`는 맞는 코드에만 쿠키를 주고 `/`로 이동한다.
- **스크린샷**: 공개 주소 첫 화면 1장.
- **예상**: 600만/5만, 60분.
- **병렬**: 5·6·7(코드 작성)은 2(설치)와 동시에 해도 된다. 11은 8 뒤. 배포 실패를 초반에 발견하려고 첫 배포(1~2 직후 빈 앱)를 먼저 해도 된다(human.md:16).
- **막혔을 때**: 배포 실패 3회 → 멈추고 `미완료`, 2블록은 로컬 시험만으로 진행하고 5블록에서 배포 재시도. `groqKeyConfigured: false` → 챗봇 실제 호출 시험(`test:chatbot`, `test:public`의 Groq 부분)을 밤새 건너뛰고 아침 보고 첫 줄에 적는다(TSD:293). WebKit 설치 실패 → Chromium.

---

### 블록 2. 이용자 화면 `feat/user-screen` (01:00~02:30, 구현 75분 + 검증 15분)

human.md:17, TSD:303.

- **입력**: 블록 1 PR 상태, progress.md의 `PRIMARY_INPUT`·`SPEECH_START_DELAY_MS`, 시험 폴더 위치.
- **읽을 TSD**: §6(TSD:124-140), §7(TSD:150-172), §10 가짜 음성·필수 사례(TSD:261-275).
- **할 일**
  1. `src/lib/speech.ts`: `SpeechRecognition ?? webkitSpeechRecognition`, `ko-KR`, `continuous=false`, `interimResults=false`, `maxAlternatives=1`. 상수 `PRIMARY_INPUT`, `SPEECH_START_DELAY_MS`(0블록 값). 상태 `idle → starting → listening → confirming → submitting`, 실패 시 `text`.
  2. 입력창 전환(TSD:136): API 없음, `start()` 예외, 3초 안에 `start` 이벤트 없음, `not-allowed`, `service-not-allowed`, `audio-capture`, `network`. `no-speech`·`nomatch`는 "못 들었습니다" 후 재시도, 2회 연속이면 입력창.
  3. `src/components/SpeechInput.tsx`: 제목 아래 남는 영역을 모두 채우는 음성 버튼, `<input type="text" lang="ko">`, 인식 결과 확인("이대로 요청")·다시 말하기. 버튼을 누를 때만 시작, 바로 보내지 않음.
  4. `src/components/StatusRegion.tsx`: `role="status"`, TSD:152-163 문구 그대로.
  5. `src/app/page.tsx`(이용자 전용 `/`): 열림 시 `h1` 초점, 인식 완료 시 "이대로 요청" 초점, 전환 시 입력창 초점. 챗봇 UI 없음. 요청 제출은 3블록의 `/api/match` 자리만 둔다(호출 없이 상태만).
  6. 접근성 기본: `<html lang="ko">`, 확대 허용, `document.title`, 눌림 영역 44px 이상, 대비 4.5:1(TSD:167).
  7. 가짜 음성 입력: Playwright `addInitScript`로 `SpeechRecognition`, `webkitSpeechRecognition`을 바꾸고 `say(문장)`, `fail(오류코드)`, `never()`를 제공(TSD:261). 공용 도우미로 두어 3~5블록이 재사용한다.
  8. E2E: 합격 문장 `say` → 확인 단계 표시와 초점, 다시 말하기, API 없음·`not-allowed`·`never()` → 입력창 전환과 초점, `no-speech` 2회 → 입력창, 이용자 화면에 챗봇 UI 없음, axe 0건.
- **산출물**: `apps/web/src/lib/speech.ts`, `apps/web/src/components/{SpeechInput,StatusRegion}.tsx`, `apps/web/src/app/page.tsx`, 가짜 음성 도우미, E2E 파일, PR.
- **검증**: `npm run check`, `npm run test:e2e` 종료 0(가짜 음성 입력 기준).
- **합격 기준(Codex용)**: 가짜 음성 입력으로 인식 결과가 확인 단계에 나오고 다시 말하기가 된다. 음성 API 없음·권한 거부·3초 무응답이면 입력창으로 바뀌고 초점이 입력창으로 간다. 상태 안내 문구가 TSD §7과 같다. 이용자 화면에 챗봇 UI가 없다. axe critical·serious 0건.
- **스크린샷**: 이용자 첫 화면 1장(아이폰 크기).
- **예상**: 1,300만/11만, 90분.
- **병렬**: 1(speech.ts)과 4(StatusRegion)는 독립. 7(가짜 음성)은 1과 동시에. 8은 3·5 뒤.
- **막혔을 때**: 같은 E2E 실패 3회 → 해당 사례를 PR에 `미완료`로 적고 나머지로 PR을 연다(시험을 빼서 통과시키지 않는다, `.claude/rules/success-criteria.md` "시험을 고칠 때"). 시간이 모자라면 화면 다듬기부터 줄인다.

---

### 블록 3. 매칭 `feat/match` (02:30~03:30, 구현 45분 + 검증 15분)

human.md:18, TSD:304.

- **입력**: 블록 2 PR 상태, 가짜 음성 도우미.
- **읽을 TSD**: §2 시연 예외(TSD:51-57), §7 표(TSD:152-172), §8 `/api/match`(TSD:188-208), §10 필수 사례(TSD:265-275).
- **할 일**
  1. `src/lib/parseRequest.ts`(AI 없이 사전): 브랜드 `sony`, `Sony`, `SONY`, `소니`, `쏘니` → `Sony`, 조사 붙어도(`소니껄로`) 찾음, 없으면 `null`. 품목 `헤드셋`, `헤드폰` → `헤드셋`, 없으면 `need_item`. Vitest 단위 시험.
  2. `src/app/api/match/route.ts`: 쿠키 확인(없으면 401), 200자 이하(넘으면 400), 품목 없음 422 `need_item`, 분당 30회(429, `src/lib/rateLimit.ts` 서버 메모리). 응답 `{ requestId(uuid), volunteer{ id, displayName }, request{ brand, item, raw } }`. 사용자 문장은 로그에 남기지 않고 상태 코드와 소요 시간만.
  3. `src/lib/matchHandoff.ts`: 이용자 화면만 응답을 `sessionStorage`의 `lh.match.v1`에 넣는다.
  4. `src/components/DemoHandoff.tsx`: 매칭 완료 후에만 보이는 "봉사자 화면으로(시연)" 버튼(접근 가능한 이름에 "시연"), 같은 탭에서 `/volunteer`로 이동. 매칭 완료 시 초점을 이 버튼으로.
  5. `src/app/volunteer/page.tsx` 뼈대: 열림 시 `h1` 초점, 상태 안내 "시연: 봉사자 화면으로 바뀌었습니다. 이용자 요청: {브랜드} {품목}.", `document.title`에 시연 표시. `lh.match.v1`이 없으면 "매칭 정보가 없습니다"와 `/` 링크. 이용자 요청 작성 UI 없음.
  6. 이용자 화면 연결: "이대로 요청" → `/api/match` → "봉사자를 찾고 있습니다." → "{봉사자}와 연결됐습니다.", 422면 다시 요청 안내.
  7. E2E: 합격 문장, 표기 변형(`sony`, `소니`, `쏘니`, `소니껄로`), 품목 없는 문장, 매칭 후 초점이 시연 버튼, 전환 후 초점이 봉사자 `h1`이고 "시연" 안내, `sessionStorage` 없이 `/volunteer`, 역할 분리(각 화면에 상대 UI 없음), 쿠키 없는 401, 길이 초과 400, 횟수 초과 429, axe.
- **산출물**: `apps/web/src/lib/{parseRequest,matchHandoff,rateLimit}.ts`, `apps/web/src/app/api/match/route.ts`, `apps/web/src/components/DemoHandoff.tsx`, `apps/web/src/app/volunteer/page.tsx`, 시험, PR.
- **검증**: `npm run check`, `npm run test:e2e` 종료 0(가짜 음성 입력 기준). 실제 낭독은 `사람 판정 대기`.
- **합격 기준(Codex용)**: "sony껄로 헤드셋 사고싶어"와 표기 변형이 모두 Sony·헤드셋으로 분석되고 서버가 가상 봉사자와 요청 번호를 돌려준다. 매칭 직후 초점이 "봉사자 화면으로(시연)" 버튼에, 전환 후 봉사자 화면 제목에 있고 역할 전환 안내가 나온다(DOM과 `document.activeElement` 기준). 쿠키 없음 401, 길이 초과 400, 횟수 초과 429.
- **스크린샷**: 매칭 완료 화면 1장, 봉사자 화면 뼈대 1장.
- **예상**: 800만/7만, 60분.
- **병렬**: 1(parseRequest)과 3·4(handoff)는 독립. 2는 1 뒤. 7은 2·5·6 뒤.
- **막혔을 때**: 초점 시험이 WebKit에서만 실패하면 Chromium 결과와 함께 기록하고 아침 실기기 확인으로 넘긴다. 같은 실패 3회면 멈춤.

---

### 블록 4. 봉사자 챗봇 `feat/volunteer-chat` (03:30~05:00, 구현 75분 + 검증 15분)

human.md:19, TSD:305.

- **입력**: 블록 3 PR 상태, `groqKeyConfigured` 값(블록 1 기록).
- **읽을 TSD**: §8 `/api/chat`(TSD:210-226), §9(TSD:228-250), §10 챗봇 품질(TSD:277-283).
- **할 일**
  1. `src/lib/prompt.ts`: TSD:234-248 지시문 초안. 세 항목(`검색어:`, `확인할 조건:`, `찾는 순서:`), 금액·재고 단정·모델명·할인·특정 상품 추천 금지, 마크다운 금지, `{brand} {item}` 삽입.
  2. `src/lib/llm.ts`: `groq-sdk`, `model: 'openai/gpt-oss-120b'`, `stream: true`, `max_completion_tokens: 800`, `maxRetries: 1`, `timeout: 20_000`. `chunk.choices[0].delta.content`(SDK 타입으로 확인). `finish_reason === 'length'`면 "답변이 길어 일부가 잘렸습니다." 추가. `LLM_MODE=mock`이면 가짜 응답, `VERCEL_ENV=production`에서는 무시.
  3. `src/app/api/chat/route.ts`: `runtime='nodejs'`, `maxDuration=30`, 쿠키 401, 질문 300자·본문 2KB 초과 400, 분당 20회 429, 키 없음 503, Groq 오류·시간 초과 502, Groq 한도 429. `text/plain; charset=utf-8` 스트리밍. 대화 기록 없음, 사용자 문장 로그 금지.
  4. 봉사자 화면: `SpeechInput` 재사용, 질문 → "답변을 만들고 있습니다." → 조금씩 표시(낭독 영역 아님) → 끝나면 "답변이 도착했습니다."와 답변 영역(`tabIndex={-1}`) 초점. 오류 문구는 TSD:220-226 표, 다시 시도 버튼 초점. `/api/chat`은 봉사자 화면에서만 호출.
  5. `src/lib/answerRules.ts`(시험 전용): 필수 세 항목, 금액(숫자 뒤 `원`, `만원`, `달러`, `$`), 재고 단정(`재고가 있`, `재고가 없`, `품절입니다`, `개 남`), 모델명 형식(영문 2자 이상+숫자 3자리 이상). Vitest 시험.
  6. `tests/chatbot/questions.json`(1블록에서 정한 위치) 20개: 합격 질문 포함, 표기 변형(sony·소니·SONY·쏘니), 가격·재고 유도("제일 싼 거 가격이랑 모델명" 등) 포함(`.claude/rules/chatbot-quality.md` "합격 기준" 3). 밤마다 같은 파일을 쓴다.
  7. `npm run test:chatbot`: 실제 Groq, 7초 간격, 20회. 답변 원문을 `test-results/chatbot-<시각>.json`에 저장해 Codex가 볼 수 있게 한다(TSD:283). 실제 Groq 호출 누계를 progress.md에 적는다(밤 전체 200회 이하, 분당 약 10회 이하, human.md:39).
  8. E2E(mock): 질문→답변 표시·초점, 401, 400, 429, 503, Groq 실패 502 안내와 다시 시도, 이용자 화면 코드에 `/api/chat` 호출 없음, axe.
- **산출물**: `apps/web/src/lib/{prompt,llm,answerRules}.ts`, `apps/web/src/app/api/chat/route.ts`, `apps/web/src/app/volunteer/page.tsx` 갱신, `tests/chatbot/questions.json`, 시험, PR.
- **검증**: `npm run check`, `npm run test:e2e`(mock), `npm run test:chatbot` 20/20 통과.
- **합격 기준(Codex용)**: 시험 질문 20개의 모든 답에 검색어·확인할 조건·찾는 순서가 있고 실제 가격·재고·없는 모델명이 0건이다(답변 원문 파일도 본다). 접근 코드 쿠키 없는 요청은 거부된다. 질문 길이·본문 크기·횟수 제한이 작동한다. Groq 실패 시 안내 문구와 다시 시도가 나온다.
- **스크린샷**: 답변이 표시된 봉사자 화면 1장.
- **예상**: 1,500만/13만, 90분.
- **병렬**: 1·5·6은 서로 독립. 2→3→4 순서. 7은 1~3 뒤, 8과 동시에 해도 된다(7초 간격 대기 중 E2E 실행).
- **막혔을 때**: `test:chatbot`에서 규칙 위반이 나오면 지시문을 고치고 다시 돈다(실패 1회씩 센다, 같은 위반 3회면 멈춤). 시간이 모자라면 포기 순서: 시험 질문 수를 줄인다(줄인 수와 이유를 PR에 적는다) → 스트리밍을 한 번에 표시로. `groqKeyConfigured: false`면 `test:chatbot`을 건너뛰고 `미완료`.

---

### 블록 5. 통합 시험 `feat/integration` (05:00~06:00, 구현 45분 + 검증 15분)

human.md:20, TSD:306. 코드를 고쳤을 때만 PR을 연다.

- **입력**: 1~4블록 PR 상태, 시험을 통과한 최신 브랜치.
- **읽을 TSD**: §10 공개 주소 완주(TSD:285), §11(TSD:287-295).
- **할 일**
  1. 최신 브랜치에서 `npm run test:e2e` 전체(iPhone 15 크기, WebKit 또는 기록된 대체).
  2. 전체 흐름 스크린샷: 이용자 첫 화면, 매칭 완료, 봉사자 답변(화면당 1장).
  3. 고칠 것이 있으면 `feat/integration`에서 고치고 PR.
  4. 시험을 통과한 최신 브랜치를 배포(3.4).
  5. `BASE_URL=<최종 공개 주소> npm run test:public`: `/enter`(코드는 `.demo-access.local`에서 읽음) → `/` → 가짜 음성 → 매칭 → 시연 이어 보기 → `/volunteer` → 실제 Groq 답변 1회. 답변 첫 줄과 소요 시간을 progress.md에 적는다. 키와 접근 코드는 적지 않는다.
- **산출물**: 완주 기록(progress.md), 스크린샷(`test-results/`, PR이 있으면 evidence), PR(코드 수정 시).
- **검증**: `test:e2e` 종료 0, axe critical·serious 0건, `test:public` 종료 0.
- **합격 기준(Codex용, PR을 연 경우)**: 최종 공개 주소에서 가짜 음성 입력 → 서버 매칭 → 실제 Groq 응답이 1회 완주된다. 심각한 접근성 오류가 0건이다.
- **예상**: 1,100만/7만, 60분.
- **병렬**: 1과 4(배포)는 동시에 해도 된다. 5는 4 뒤.
- **막혔을 때**: 공개 주소 완주가 실패하면 원인을 고치는 데 이 블록과 6블록 버퍼를 쓴다. 통합 완주는 포기하지 않는다(human.md:24). Groq 장애면 실패를 기록하고 아침 보고에 적는다(human.md:27).

---

### 블록 6. 버퍼 (06:00~07:00)

human.md:21, TSD:307.

- **입력**: progress.md 전체 항목 중 `미완료`·지적 목록, 열린 PR 목록(`gh pr list --label hold-morning`).
- **할 일**
  1. 보류·지적 수정: 해당 기능 브랜치에서 고치고 다시 푸시, 3.3 재검증. 고쳐도 실패 이력은 남아 보류 유지(human.md:21).
  2. 앞 블록 지연 흡수(미완료 블록의 남은 합격 기준).
  3. 시간이 남으면(human.md:34 기본 답 "쓴다") 팀 일정표의 송채우 담당 문서 초안: #7 컴포넌트 구성, #8 화면 정의, #9 사용자 플로우 2종. 저장소에 일정표가 없으므로 오늘 만든 코드 기준으로 쓴다. 위치: `docs/plans/2026-11-04-overnight/drafts/{07-components,08-screens,09-user-flows}.md`. 브랜치 `docs/overnight-drafts`, PR(문서라 Codex 기능 QA 해당 없음, Bugbot은 3.3대로).
- **산출물**: 재검증 기록, 수정 커밋, 문서 초안과 PR(남을 때만).
- **검증**: 재시험 통과 출력, PR 댓글의 재판정.
- **예상**: 700만/8만, 60분.
- **병렬**: 서로 다른 PR의 수정은 독립이지만 한 세션에서 순서대로 한다. 문서 초안 3개도 독립이나 순서대로 쓴다.
- **막혔을 때**: 07:00이 되면 멈춘다. 문서 초안은 포기 순서 첫 번째다.

---

### 블록 7. 마무리 (07:00~08:00) — 새 기능 금지

human.md:22, TSD:308.

- **입력**: progress.md 전체, `gh pr list --state all`, 배포 기록.
- **할 일**
  1. 시험을 통과한 최신 브랜치를 최종 배포(3.4). 이미 최신이면 건너뛴다.
  2. 최종 공개 주소에서 `test:public` 1회 재통과(C7).
  3. `docs/plans/2026-11-04-overnight/morning-report.md` 작성. 순서는 `.claude/rules/overnight-loop.md` "아침 보고": 시연 주소(파일 위치 `.demo-access.local`만)와 배포 브랜치·커밋 → 시연 절차 → PR 표(번호, 기능, 판정, 실패 횟수, AI 병합/보류와 이유) → 사람 판정 항목 → 미완료와 막힌 이유 → 실제 사용량과 예상 차이(`미측정` 허용). `groqKeyConfigured: false`였다면 첫 줄에.
  4. 시연 절차에 human.md:43 그대로: VoiceOver 켜기 → 시연 주소를 눈 가리기 전 한 번 열기 → "sony껄로 헤드셋 사고싶어" → 매칭 → "봉사자 화면으로(시연)" → "sony 헤드셋 제품을 찾는 가이드 알려줘". 크롬 음성 우선, 실패 시 입력창 받아쓰기나 같은 주소 사파리(봉사자 화면도 사파리), 최대 3회.
  5. 이 파일 10절 진행 기록 표를 채운다(블록당 한 줄).
  6. 브랜치 `docs/morning-report`에서 커밋, `git push -u github docs/morning-report`, PR(병합은 3.3의 병합 표대로). 사람은 PR 브랜치에서 보고를 읽는다.
  7. progress.md 마지막 항목, 종료.
- **산출물**: `morning-report.md`, ai.md 10절, PR.
- **검증**: `test:public` 종료 0, 보고 절 순서가 규칙과 같음.
- **예상**: 500만/4만, 60분.
- **병렬**: 1→2 순서. 3·5는 2와 동시에 써도 된다(완주 결과만 마지막에 채운다).
- **막혔을 때**: 08:00에 끝낸다. 완주 실패여도 보고는 쓴다. 보고가 최우선이다.

## 5. 사람 차례

### 자기 전 (약 30분, human.md:11)

| 할 일 | AI에게 넘길 것 |
|---|---|
| Vercel 빈 프로젝트 지정, `GROQ_API_KEY` 등록(AI는 입력하지 않음) | 프로젝트 이름 |
| Cursor 대시보드에서 Bugbot 사용량 확인 | 포함 사용량·남은 크레딧(대략) |
| Claude Code가 Ultra 로그인·Opus 5.5이고 `ANTHROPIC_API_KEY`가 없는지 확인 | 확인 여부 |
| PC 절전 해제 | - |
| 0블록 `/speech-probe/`를 아이폰 크롬+VoiceOver로 시험(마이크 허용, 한 문장, 두 버튼 비교) | 화면에 나온 API 유무, 이벤트 순서, 오류 코드, 인식 문장, VoiceOver 낭독 섞임 여부 |
| AI 첫 5분 점검 통과와 Bugbot 결과 수신을 보고 00:00 시작 명령 | - |

(PR #2와 문서 PR #3 병합은 이미 끝났다.)

### 아침 (약 25분)

| 할 일 | 볼 자료 |
|---|---|
| 눈 가리고 시연 15분(human.md:43) | `morning-report.md`의 시연 절차, `.demo-access.local`의 시연 주소 |
| 보류 PR 판단 10분 | `morning-report.md` PR 표, `gh pr list --label hold-morning`, 각 PR의 Codex·Bugbot 댓글 |
| 정해 줄 것 답하기(human.md:33-35) | 답이 없으면 추천안. 1번 Groq 그대로, 2번 문서 초안 쓴다는 밤사이 이미 적용 |

## 6. 멈춤 조건

밤사이 사람에게 물을 수 없다. "멈춤"은 기록하고 `미완료`로 둔 채 다음 블록으로 가거나 종료하는 것이다.

| 상황 | 처리 | 근거 |
|---|---|---|
| 같은 명령·같은 오류 3회 | 멈추고 원인·시도·다음 할 일 기록, 다음 블록 | `.claude/rules/success-criteria.md` "막혔을 때" |
| 블록 끝 시각 지남 | 같음 | 같음 |
| 블록 토큰 150% 초과 | 포기 순서로 줄이고 마무리 | `.claude/rules/overnight-loop.md` "시간과 토큰" |
| 주간 사용량 한도 도달 | 기록하고 멈춤(추가 요금 없이 멈춘다) | human.md:48, `.claude/rules/overnight-loop.md` "시간과 토큰" |
| 돈 5만 원 상한에 다가감, Bugbot 포함 사용량 초과 우려 | Bugbot을 끄고 해당 PR 보류 | human.md:39, `.claude/rules/chatbot-quality.md` "운영" |
| 실제 Groq 호출 누계 200회 도달 | 실제 호출 중지, 남은 시험은 mock, 기록 | human.md:39 |
| Groq 하루 한도·장애 | 실패 음성 안내 확인, 아침 보고에 기록 | human.md:27 |
| 안전 훅이 막음 | 우회하지 않고 기록, 다른 방법 또는 멈춤. 훅 수정 금지 | `.claude/rules/overnight-loop.md` "금지선" |
| `github` 원격 없음, 로그인 실패, Vercel 프로젝트 미지정 | 자기 전이면 사람에게 묻는다. 밤이면 해당 작업 멈춤 | human.md:11 |
| Codex 실행 불가(로그인·한도) | `미완료`, 건너뛰고 완료로 쓰지 않음 | `.claude/rules/pr-flow.md` "Codex 검증" |
| Bugbot 10분 안에 결과 없음 | `미완료`, `hold-morning` | `.claude/rules/pr-flow.md` "Bugbot 검증" |
| human.md와 이 파일·TSD가 어긋나서 결정이 필요 | human.md 쪽으로 실행하고 기록, 아침 보고에 올림 | 머리말 |
| 결제, 유료 플랜, 외부 발송, 지정 밖 배포가 필요해 보임 | 하지 않음, 기록 | `.claude/rules/overnight-loop.md` "금지선" |

## 7. 위험과 대응

| 위험 | 대응 | 근거 |
|---|---|---|
| 아이폰 크롬 음성 인식이 안 되거나 VoiceOver 낭독이 섞임 | 0블록 결과로 `PRIMARY_INPUT`·지연값 결정, 입력창 받아쓰기·사파리 대체 경로를 시연 절차에 적음 | human.md:46 |
| 무인 실행 실수 | 훅 + 규칙 금지선, 커밋 전 `git status --short` | human.md:47 |
| Bugbot 결과가 안 옴 → 모든 PR 보류 | 0블록에서 수신 확인, 안 오면 사람이 설정 확인 | human.md:48 |
| 앞 블록 보류로 뒤 PR이 줄줄이 보류 | 정상. 쌓아서 계속, 최신 통과 브랜치를 배포해 시연 가능 | human.md:10 |
| 시간 여유 거의 없음 | 블록 끝 시각 엄수, 포기 순서 | human.md:24 |
| 토큰이 주간 한도 12%를 넘음 | 1블록 실측으로 다음 블록 크기 조정, 넘으면 최소 합격 경로만 | human.md:48 |
| 공개 주소 남용으로 Groq 한도 소진 | 접근 코드 쿠키, 크기·횟수 제한(서버 메모리라 완화 수단일 뿐) | human.md:48, TSD:250 |
| 챗봇이 가격·모델명을 지어냄 | 지시문 + `answerRules` 자동 검사 + Codex가 원문 확인 | `.claude/rules/chatbot-quality.md`, TSD:283 |
| 키·접근 코드 유출 | 값은 파일로만 다루고 출력하지 않음, `.gitignore`·`.vercelignore` | TSD:112-122 |
| Windows에서 WebKit 시험 불가 | Chromium 모바일 크기, 기록 | TSD:263 |

## 8. 범위 밖

human.md:28 그대로다. 하지 않는다.

- 외부 저장소·다른 기기 연결(다음 작업, human.md:29), 별도 서버(FastAPI·Render)
- 실제 쇼핑몰 접속·주소 전달·캡처, 이미지 글자 읽기
- 봉사자 답변을 이용자에게 돌려보내 소리로 듣기
- 저장·재사용, 계정, 실제 봉사자, 안드로이드
- 사람 실기기 시험의 대체(AI는 실기기 통과를 판정하지 않는다)
- 11/5 밤 우선순위 결정(human.md:35, 아침 뒤 사람이 답)

## 9. 제안 (실행 기준 아님, 사람이 정하면 반영)

1. **morning-report 위치**: main 직접 커밋이 금지라 보고를 PR 브랜치(`docs/morning-report`)에 둔다. 사람이 아침에 브랜치를 바꾸지 않고 읽으려면, 7블록 보고 PR을 AI 병합 조건과 별개로 "문서 전용 PR은 Bugbot 통과 시 병합"으로 허용하는 규칙을 두는 안이 있다.
2. **0블록 speech-probe PR**: human.md는 speech-probe를 PR로 다루는지 적지 않았다. 이 파일은 규칙대로 기능 PR로 다뤘다. 자기 전 시간이 모자라면 배포만 먼저 하고 PR은 `hold-morning`으로 두는 것을 허용해 두면 좋다.
3. **ai.md 진행 기록 표와 progress.md**: 규칙상 진행 기록은 progress.md다. 10절 표는 7블록이 블록당 한 줄 요약만 채우게 했다. 표가 필요 없으면 다음 계획부터 빼도 된다.
4. **`/api/health` 쿠키**: 키 존재 여부만 돌려주므로 쿠키 없이 열어 두면 배포 확인이 단순해진다. TSD:176 공통 규칙과 달라 이번에는 쿠키를 요구한다.

## 10. 진행 기록 표

블록 7이 블록당 한 줄로 채운다. 세부 기록은 `progress.md`.

| 날짜 | 단계 | 결과 | 근거 |
|---|---|---|---|
| | | | |
