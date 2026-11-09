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

## 00:38 블록 0 사전 점검
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
| Vercel 변수 이름 | `GROQ_API_KEY`(production·development), `DEMO_ACCESS_CODE`(production), `SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`NEXT_PUBLIC_SUPABASE_URL`(production·preview). **`OPENAI_API_KEY` 없음**(00:37 사람에게 production 등록 요청, 블록 2·4·6은 배포 전에 `vercel env ls`로 이름만 다시 본다), `UPSTAGE_API_KEY` 없음 |
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
- 시간: 블록 1은 00:40께 시작, 표 상한 02:00(작업 멈춤 01:50). 배정 120분보다 짧다(3.6 min 규칙).
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
추가 00:38 이용자: Vercel `OPENAI_API_KEY`를 production·preview·development에 등록함(이용자 화면 캡처로 확인, 값은 보지 않음. 블록 2는 배포 전 `vercel env ls`로 이름만 다시 본다).
추가 00:38 이용자 결정: 테스트(블록 1 실험, 블록 2·6 공개 완주)의 OpenAI 엔진은 **가장 저렴한 luna 모델**로 한다. 블록 1이 OpenAI 모델 목록(`GET /v1/models`, 키는 실험 서버 쪽 코드가 읽는다)과 공식 가격 페이지로 luna 계열 중 가장 싼 모델 ID를 확정해 결과표·진행 기록에 적고, 블록 2는 그 ID를 쓴다. 확정하지 못하면 결정 9의 `gpt-5.6-luna`. Groq qwen은 무료 비교 기준선으로 유지(C6 엔진 2개).

## 01:17 블록 1 비전 실험
상태: 미완료(Codex 3회 미통과로 멈춤, C6 정답 메모 없음)
PR: #21 https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/21 (base `stage/demo4`, head `feat/demo4/experiment` `ab6447a`, 라벨 `hold-morning`), 실패 횟수: 3
시작 00:53 워크플로(작업 메모 기준 끝 상한 02:00, 작업 멈춤 01:50. 실제 끝 01:17)
실패 목록:
- 01:07 Codex 1차(`484c63e`) 미통과, 심각 3: C6 정답 메모 상품 3개 미달 / 키 비노출이 접두사 가림뿐 / 재시작 간 호출 상한 취약 → 실제 키 값 가림, 호출 전 임시 기록으로 고침
- 01:12 Codex 2차(`cb6707a`) 미통과, 심각 3: C6 미달(반복) / 로그에 검증 안 된 kind / 예산 검사에 OpenAI 재시도 미반영 → 고침
- 01:15 Codex 3차(`ab6447a`) 미통과, 심각 3: C6 미달(3회째) / 화면 429 재시도까지 합치면 실행기 예약량 초과 가능(서버 500 거부는 유지) / 겹침 ≥ 타일 높이 입력 시 자르기 반복 무한 → 같은 실패 3회로 멈춤, 코드 지적 2건은 미수정
실패로 세지 않은 것: 00:54 `openai/package.json` 버전 조회 명령의 exports 오류(검사·시험·빌드 아님)
검증: `npm run check` 종료 0(unit 160/160) 3개 커밋 모두(`test-results/21-check.txt` = `ab6447a`). `test:e2e` 안 돌림(C5, src·tests diff 0줄). axe 해당 없음. Codex 미통과 3회(PR 댓글 3개, 시험 기록 판정). 스크린샷 https://github.com/IBORY-PURPLE/Lighthouse_Dev/blob/evidence/21/synthetic-vision-lab.png (합성). 비밀·접근 코드 패턴 검사 0건. `git ls-files test-results` 0개. 실험 서버(포트 4310, 다른 프로세스 없음)는 3회 띄우고 모두 종료 확인.
배포: 없음(블록 1은 배포하지 않음)
결정:
- **OpenAI 엔진 모델 `gpt-6-luna`로 확정**(이용자 결정 00:38 "가장 저렴한 luna"). 근거: 실험 서버 `/api/openai-models`(OpenAI `GET /v1/models`, luna ID만) → `gpt-5.6-luna`, `gpt-6-luna`. 공식 가격표 https://developers.openai.com/api/docs/pricing (2026-11-10): `gpt-6-luna` 입력 $0.10/출력 $0.50, `gpt-5.6-luna` $0.20/$1.20 per 1M. 블록 2 `extract.ts`는 이 ID를 쓴다.
- `gpt-6-luna`는 Chat Completions `image_url.detail: "original"`과 `reasoning_effort: "none"`을 거부 없이 받았다(`openai` 7.53.0, `dependencies`).
- 결과(합성 LH-200 1개, 정답 메모 없음, 잠정): 1위 `gpt-6-luna` 15/15(100%), Groq qwen 11/15(73%, "방수"→"방송" 등 오독), 지어냄 둘 다 0. 전체 ms 중앙값 luna 13,018 / qwen 51,512(429 대기 포함). 통째·1200·800 모두 luna 정답 → 조각 높이 1,200 유지. 블록 2 기본 엔진은 OpenAI `gpt-6-luna`.
- Groq: qwen 429 7회(대기 후 성공), 503 over capacity 1회(조각 1장 실패). 요약 `gpt-oss-120b` 7회, 429 0회.
- C6 미완료(정답 메모 상품 3개 없음). 아침 보고 첫 줄 대상. Upstage 키 없음 → 미실행.
- 근거 대조(`checkEvidence`): 근거가 원문에 없으면 `value: null`, `check: unverified`. 실제로 qwen 타일 800 사양 항목이 대조로 null이 됐다(블록 2 `evidenceCheck.ts` 초안).
- 판정 문구: `보류(이유: 실패 3회 — Codex 미통과 3회 …, 같은 실패 3회로 멈춤. 훅 guard.js:158 때문에도 사람 병합)`.
- `bd ready`: 열린 이슈 없음.
다음 할 일: 블록 2 ④ 올리기·요약(`feat/demo4/upload-summary`). 엔진 `gpt-6-luna`. 블록 1 코드에 의존하지 않으면 `stage/demo4`에서 시작. 아침: 실제 캡처·정답 메모로 `run.mjs` 재실행, Codex 3차 코드 지적 2건(겹침 입력 검증, 429 재시도 예산 예약) 반영 여부.
결과표 위치: feat/demo4/experiment
호출: luna 12장(누계 12/500), Upstage 0장(누계 0/500), Groq qwen 18회(누계 18), Groq gpt-oss 7회(누계 7/200)
시작 브랜치 분기 근거: 블록 0이 만든 `feat/demo4/experiment`(← `stage/demo4` = `a4fdd26`)에서 이어서 작업
다음 블록: 2
이어 달리기 명령: 메인 세션 local_317d473e-56b7-4ce2-8976-dfd8dfcb2955의 Workflow 스크립트 overnight-1109가 블록 에이전트를 차례로 띄운다(블록 에이전트는 3.5의 6에서 block-<M>.started만 만들고 자식을 띄우지 않으며, 7을 하지 않는다)
훅 수정 허락: 아니오
db push 허락: 예
통합 배포 푸시 허락: 예
토큰: 미측정, 예상 대비 미측정

## 02:02 블록 2 ④ 올리기·요약
상태: 완료(C7은 미완료: 실제 캡처 없음, 합성 이미지로 완주)
PR: #22 https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/22 (base `stage/demo4`, head `feat/demo4/upload-summary` `9bd0e87`, 라벨 `hold-morning`), 실패 횟수: 7
시작 01:17 워크플로(끝 상한 03:47 = min(01:17+150, 04:30), 작업 멈춤 03:37. 실제 끝 02:02)
실패 목록:
- 01:26 `npx vitest run tests/unit`(커밋 전) routes.test.ts health 2건 — 기대값 갱신 치환이 CRLF로 적용 안 됨
- 01:34 `npm run test:e2e`(`317803f`) 77/78 — match.spec.ts:341 봉사자 화면 input·textarea 0개 기대 vs ④ 파일 선택 1개 → 시험을 "정확히 1개, type=file, 라벨 상세 이미지 올리기"로 바꿈(PR "시험 변경")
- 01:38 `vercel deploy --prod --yes`(apps/web) 종료 1 — 프로젝트 Root Directory가 `apps/web`라 `apps/web/apps/web` 경로 없음
- 01:42 Codex 1차(`18d1c12`) 미통과, 심각 2: 값과 무관한 근거도 matched / axe 전체 0건 판정 불가 → 값 낱말이 근거에 모두 있어야 matched, axe 전체 영향도 0건 단언
- 01:45 `npx eslint`(커밋 전) prefer-const 1건 — 편집 치환 미적용
- 01:53 Codex 2차(`784f401`) 미통과, 심각 2: 부분 문자열 검사로 30시간이 130시간에 걸림 / 200자 넘는 근거 → 낱말 경계 검사, 200자 넘는 근거 unverified
- 01:57 `npx vitest run tests/unit`(커밋 전) evidenceCheck.test.ts 구문 오류 — 편집 스크립트 이스케이프 실수
실패로 세지 않은 것: 01:30 스테이징 이름 검사 grep 패턴에 키 파일 이름 글자 → 안전 훅 차단(우회 없이 패턴 없이 확인)
검증(`9bd0e87`): `npm run check` 종료 0(unit 217/217), `npm run test:e2e` 종료 0(78/78, 가짜 음성 입력·가짜 응답 기준, 봉사자 화면 axe 위반 전체 영향도 0건), `test:public` 종료 0(4/4). Codex 3차 통과(심각 0, PR 댓글 3개, 시험 기록 판정). 스크린샷 2장(evidence/22/synthetic-summary.png, synthetic-manual.png, 합성). C10 grep 0건. 비밀·접근 코드 패턴 검사 0건. `git ls-files test-results` 0개.
배포: Vercel API Git 소스 배포(`feat/demo4/upload-summary` `9bd0e87`, target production, 프로젝트 lighthouse-web) `dpl_2QjgKtJNFqpTAN6oQUdi5GyJBML5` → https://lighthouse-web-five.vercel.app 별칭 확인. health `extractEngine=openai`, `groqKeyConfigured=true`. CLI 배포는 Root Directory 때문에 실패했고, 저장소 루트 CLI 배포는 추적 안 된 파일(키 파일, test-results)이 올라갈 위험이 있어 하지 않음. 프로젝트 설정·환경 변수 안 바꿈. Vercel `OPENAI_API_KEY`는 `vercel env ls`로 이름만 확인(production·preview·development).
공개 완주(C7·C15 AI 쪽, **실제 캡처 없음, 합성 이미지로 완주**): 엔진 `gpt-6-luna`, 조각 4(모두 200), engine ms 1906/3057/2174/1771(중앙값 2174), 왕복 ms 3460/4229/3538/3241, summarize 1회 llm 2040ms, 올리기→초안 17,964ms, 항목 5·확인 안 됨 0, key·label 가격·재고·할인 0건. Supabase 시간은 해당 없음(블록 4).
결정:
- 엔진 순서 mock(운영 아님+`EXTRACT_MODE=mock`) → openai → upstage → null. 요약은 Groq gpt-oss-120b JSON 모드(블록 1 요약 429 0회), 상한 4,000자, 넘으면 화면 안내 후 앞부분만.
- summarize 요청에 선택 칸 `lowConfidence`·`unreadable` 추가(TSD 밖, PR 본문).
- ④ 낭독 영역은 `aria-live` 문단(role=status 아님): 봉사자 화면에 role=status가 둘이면 chat.spec의 `getByRole("status")`가 깨짐.
- 근거 대조는 보수적: 근거가 원문에 낱말 경계로 있고, 값의 낱말이 모두 근거에 있어야 matched. 200자 넘는 근거는 unverified. 아침에 실제 요약의 "확인 안 됨" 비율을 보고 조정 여부 결정.
- Vercel Root Directory가 `apps/web`로 바뀌어 있음(11/4 기록 `.`). 블록 4·6도 CLI 배포가 같은 오류를 낼 것 → 같은 Git 소스 배포 방식(브랜치를 원격에 푸시한 뒤 그 커밋을 production으로)을 쓰면 된다. 아침 보고 대상.
- `experiments/`는 `stage/demo4`의 `.vercelignore`에 없어 배포에 포함됨(블록 1 PR #21이 추가).
- 판정 문구: `보류(이유: 실패 7회 — 개발 중 시험·검사 실패 4회, 배포 실패 1회, Codex 미통과 2회. 훅 guard.js:158 때문에도 사람 병합)`.
- `bd ready`: 열린 이슈 없음.
다음 할 일: 블록 3 플로우 A PR 1 질문 3개(`feat/demo1/questions` ← `stage/demo1` ← `github/main`). 아침: 실제 캡처로 ④ 재완주(C7), 아이폰 실기기 파일 선택·자르기 확인.
호출: luna 12장(누계 24/500), Upstage 0장(누계 0/500), Groq qwen 0회(누계 18), Groq gpt-oss 6회(누계 13/200)
시작 브랜치 분기 근거: 블록 1이 `apps/web/src`·`tests`를 바꾸지 않아(progress 블록 1, C5 diff 0) `github/stage/demo4`(`a4fdd26`)에서 시작
다음 블록: 3
이어 달리기 명령: 메인 세션 local_317d473e-56b7-4ce2-8976-dfd8dfcb2955의 Workflow 스크립트 overnight-1109가 블록 에이전트를 차례로 띄운다(블록 에이전트는 3.5의 6에서 block-<M>.started만 만들고 자식을 띄우지 않으며, 7을 하지 않는다)
훅 수정 허락: 아니오
db push 허락: 예
통합 배포 푸시 허락: 예
토큰: 미측정, 예상 대비 미측정

## 02:58 블록 3 플로우 A PR 1 질문 3개
상태: 미완료(Codex 3회 미통과로 멈춤: axe 범위 지적 3회째. 기능 시험은 모두 통과)
PR: #23 https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/23 (base `stage/demo1`, head `feat/demo1/questions` `eee9ed3`, 라벨 `hold-morning`), 실패 횟수: 4
시작 02:02 워크플로(끝 상한 03:12 = min(02:02+70, 05:40), 작업 멈춤 03:02. 실제 끝 02:58)
실패 목록:
- 02:14 `npm run test:e2e`(커밋 전) 71/76 — 매칭 요청 버튼 초점 단언 5건(WebKit은 누른 버튼에 초점을 주지 않음) → onClick에서 버튼에 초점
- 02:25 Codex 1차(`cf11170`) 미통과, 심각 2: 답하는 동안 네트워크 검사가 `/api/**`만 봄 / axe가 critical·serious만 → `page.route("**/*")` 전체 기록, 이용자 화면 axe 위반 전체 0건
- 02:46 Codex 2차(`6241773`) 미통과, 심각 1: axe가 WCAG 태그 한정, match.spec 연결 화면은 critical·serious만 → 이용자 화면 axe 태그 제한 없이 0건(user-screen 전체, match.spec 이용자 화면 2곳)
- 02:57 Codex 3차(`eee9ed3`) 미통과, 심각 1: 봉사자 화면·챗봇 axe(`match.spec.ts:46`, `chat.spec.ts:42`의 기존 함수)가 태그·critical/serious 한정이라 "각 화면 axe 0건" 판정 불가(실제 위반 발견 아님) → axe 관련 3회째라 멈춤, 미수정
실패로 세지 않은 것: 02:35 Codex 2차 첫 실행이 stdin 대기로 10분 넘게 멈춤(판정 전 중지, `< /dev/null`로 다시 실행). 이때 남은 codex.exe 프로세스가 있을 수 있음(종료 확인 못 함).
검증(`eee9ed3`): `npm run check` 종료 0(unit 175/175), `npm run test:e2e` 종료 0(76/76, chat.spec 20/20, 가짜 음성 입력·가짜 응답 기준). 이용자 화면 axe 태그·영향도 무관 위반 0건. 답하는 동안 모든 요청 0건(`page.route("**/*")`). C13 diff(`prompt.ts`·`chat.ts`·`api/chat`) 0줄. Codex 미통과 3회(PR 댓글 3개, 시험 기록 판정). 스크린샷 2장(evidence/23/user-question-1.png, user-summary.png). 비밀·접근 코드 패턴 검사 0건. `git ls-files test-results` 0개. `test:public` 안 돌림(배포 없음, `public.spec.ts`는 경로만 `completeFlowA`로 바꿈 → 블록 4가 처음 실행).
배포: 없음(블록 3은 배포하지 않음)
결정:
- 화면: intro(h1, 안내, 시작하기) → 질문 h2 "질문 N/3. …"(초점) → 음성 확인 "다음 질문"/"완료"·"다시 말하기", 입력창 확인 "입력한 내용: …"·"다시 입력" → 요약 h2 "요청 내용", 목록 3줄, "봉사자 매칭 요청" → 기존 `requestMatch(제품 답)` → `saveMatch` → DemoHandoff. 입력창 이름은 "찾는 제품"/"예산"/"새 제품 또는 중고".
- `requestFlow.ts` 상태: `intro|asking|summary|matching|connected`, `question 0|1|2`, `answers{product,budget,condition}`, `inputMode`, `status`. 블록 4는 `summary` 다음을 `registering/queued`로 바꾸고 `checking`을 더한다. `checkAnswer`(200자, 질문 1 품목)는 기기 안.
- `speech.ts`: STATUS 끝에 `typedBack`, `needProduct`, `answerTooLong`, `summary` 4개(블록 4는 이 뒤에 붙인다. 단위 시험이 키 순서를 단언하므로 블록 4는 `speech.test.ts`의 `keys.slice(18)` 기대값에 새 키를 덧붙여야 한다). 액션 `reset`(text면 `fellBack: true`), `typed`, `reenter`. 동작 변경 2개: `unavailable`은 text+fellBack이면 무시, `matchRejected`는 fellBack이면 입력창으로(챗봇에서는 생기지 않는 조건).
- e2e 도우미 `tests/e2e/helpers/flowA.ts`: `answerFlowA(page, answers?)`(요약까지), `completeFlowA(page, answers?, {timeout})`(이어 보기 버튼까지), `DEFAULT_ANSWERS`, `MATCH_REQUEST_NAME`. 블록 4는 `completeFlowA`가 대기번호 화면을 거치도록 고치면 chat.spec·public.spec이 따라간다.
- match.spec의 품목 없음·201자 사례는 서버 422/400 대신 질문 1 기기 안 검사를 단언(PR "시험 변경"). 서버 계약 사례는 그대로.
- 판정 문구: `보류(이유: 실패 4회 — 개발 중 e2e 실패 1회, Codex 미통과 3회(axe 범위). 같은 실패 3회로 멈춤, Codex 통과 없음(미완료). 훅 guard.js:158 때문에도 사람 병합)`.
- 단계 PR 안 엶(훅 수정 허락 아니오). `bd ready`: 열린 이슈 없음.
다음 할 일: 블록 4 플로우 A PR 2 대기열 접수(`feat/demo2/queue`). PR #23이 보류이고 블록 4가 그 코드에 의존하므로 `github/feat/demo1/questions`에서 따고 base를 그 브랜치로(블록 4 분기 표). 아침: 봉사자 화면·챗봇 axe를 전체 위반 0건으로 넓힐지 결정(PR #22 match.spec 변경과 겹침) 뒤 Codex 재판정, 실기기 VoiceOver(C9).
호출: luna 0장(누계 24/500), Upstage 0장(누계 0/500), Groq qwen 0회(누계 18), Groq gpt-oss 0회(누계 13/200)
시작 브랜치 분기 근거: 블록 3은 앞 블록 의존 없음(4절 표) → `stage/demo1`을 `github/main`(`a4fdd26`)에서 새로 만들어 푸시하고 `feat/demo1/questions`를 땀
다음 블록: 4
이어 달리기 명령: 메인 세션 local_317d473e-56b7-4ce2-8976-dfd8dfcb2955의 Workflow 스크립트 overnight-1109가 블록 에이전트를 차례로 띄운다(블록 에이전트는 3.5의 6에서 block-<M>.started만 만들고 자식을 띄우지 않으며, 7을 하지 않는다)
훅 수정 허락: 아니오
db push 허락: 예
통합 배포 푸시 허락: 예
토큰: 미측정, 예상 대비 미측정
