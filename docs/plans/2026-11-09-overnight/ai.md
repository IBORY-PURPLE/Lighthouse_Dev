# LightHouse 11/9 밤샘 개발 실행 계획 (AI용)

- 승인일: 2026-11-09 (정해 줄 것 1~11을 모두 추천안으로 확정)
- 1쪽 요약: `docs/plans/2026-11-09-overnight/human.md`. 세부 메모: 같은 폴더의 `notes-flow-a.md`(플로우 A), `research-vision.md`(비전 후보), `tsd-review.md`(백엔드 검증)
- 사람이 본 것은 1쪽 요약이고 이 파일이 실행 기준이다. 둘이 어긋나 보이면 human.md의 목표·범위·비용·일정이 우선이고, 이 파일은 그것을 실행 단계로 푼 것이다. 어긋남은 진행 기록에 적고 멈춤 조건(6절)을 따른다.
- 기술 명세: `docs/TSD.md`(v2, 477줄). 규칙: `CLAUDE.md`, `.claude/rules/*.md`. 이 파일은 규칙을 다시 쓰지 않고 파일명과 절 이름으로 가리킨다.
- 밤 실행 환경은 이용자의 Windows PC다(이 계획을 쓴 클라우드 세션이 아니다). 명령은 Git Bash 기준이고, PowerShell이면 같은 뜻으로 바꿔 쓴다.

## 0. 이 파일을 읽는 법

세션마다 `.claude/rules/file-navigation.md`의 시작 순서를 따른다.

1. `CLAUDE.md`
2. 이 파일의 0~3절(공통)과 4절의 **내 블록 하나**. 다른 블록은 읽지 않는다. 내 블록이 다른 블록의 특정 "할 일"을 가리키면(예: 블록 1 → 블록 0 할 일 1) 그 항목만 읽는다.
3. `docs/plans/2026-11-09-overnight/progress.md`의 마지막 항목. 밤 블록 항목은 브랜치 `docs/overnight-1109`에만 쌓인다(낮 문서 세션 항목은 main·문서 브랜치에도 있다. 3.5). 기능 브랜치에서 읽으려면 `git fetch github && git show github/docs/overnight-1109:docs/plans/2026-11-09-overnight/progress.md | tail -60`. 마지막 항목 안에는 라벨로 시작하는 고정 줄 4개(`이어 달리기 명령:`, `훅 수정 허락:`, `db push 허락:`, `통합 배포 푸시 허락:`. 라벨 글자는 3.5의 3이 확정한다)가 블록 0 기록 그대로 옮겨 적혀 있다. 항목 끝이 아닐 수 있으니(3.5의 6·7이 뒤에 줄을 덧붙인다) `grep -n "^이어 달리기 명령:"`처럼 라벨로 찾는다. 없으면 `grep -n "블록 0"`으로 블록 0 항목 위치를 찾아 그 부분만 읽는다. 이 파일(ai.md)이 `github/main`에 없으면(2026-11-09 기준 main의 계획 폴더에는 `tsd-review.md`만 있다) 같은 브랜치에서 `git show github/docs/overnight-1109:docs/plans/2026-11-09-overnight/ai.md`로 읽는다(블록 0 할 일 5가 문서 브랜치 `claude/cloud-brief-ai-plan-pim0gp`의 계획 폴더 사본을 커밋한다).

- 밤샘은 날짜가 11/10으로 넘어가도 이 폴더(`2026-11-09-overnight`)를 쓴다.
- 블록 번호, 브랜치, 끝 상한은 4절 표를 기준으로 하되, 실제 끝 시각은 3.6의 시간 규칙으로 계산한다.
- TSD는 필요한 절만 `offset`/`limit`로 연다. 블록마다 읽을 절과 줄을 적어 두었다.
- 플로우 A의 상태·낭독 문구 표, 실패 분기 표, 시험 목록은 `notes-flow-a.md` C2·C5·C6에 있다. 이 파일은 그것을 다시 적지 않고 가리킨다.

## 1. 목표와 완료 조건

**목표**(human.md:15, 76, 116): ④ 봉사자가 올린 상세 이미지를 AI가 읽어 항목별 요약 초안을 보여 주는 기능을 실험으로 검증한 뒤 만들고, 이용자 화면을 플로우 A(질문 3개 → 대기열 접수 → 대기번호)로 바꾼다. 결과표와 입문 메모로 사람이 글자 읽기 엔진을 고를 수 있게 한다. 아침에 사람이 아이폰으로 둘 다 확인한다.

**AI가 판정하는 완료 조건**(human.md:61-62, 103, 145). 모두 명령 결과나 파일로 확인한다. "판정 방법" 열이 없는 조건은 없다.

| # | 조건 | 판정 방법 |
|---|---|---|
| C1 | 블록 1~3 PR과, 돌았으면 4·5 PR이 각각 열렸고(AI 병합돼 닫혔어도 포함, `state=all`. 블록 4 포기 ②(PR 2 전체 다음 밤)는 progress.md 기록으로 갈음) base가 4절 표(또는 블록별 분기 표)의 브랜치다 | `gh api repos/IBORY-PURPLE/Lighthouse_Dev/pulls?state=all --jq '.[] \| {number,title,base:.base.ref,head:.head.ref}'`(GraphQL이 되면 `gh pr list --state all`) |
| C2 | 각 PR 본문이 `.claude/rules/pr-flow.md` "PR 본문" 7항목 + "시험 변경" + "유료 호출 수"를 채우고 `Codex: 시험 기록 판정(직접 실행 아님)`이 있다 | PR 본문(`gh api …/pulls/<번호> --jq .body`) |
| C3 | 각 PR이 `.claude/rules/success-criteria.md` "완료 조건" 3개(시험 출력 요약, 스크린샷 링크, Codex `통과`)를 채운다. 하나라도 없으면 `미완료` | PR 본문, progress.md |
| C4 | PR마다 `npm run check` 종료 코드 0 | `test-results/<PR번호>-check.txt` 첫 줄 해시 = PR HEAD, 끝 줄 `exit 0` |
| C5 | 블록 2~5 PR마다 `npm run test:e2e` 종료 코드 0(가짜 음성 입력·가짜 응답 기준: `LLM_MODE=mock`, `STORE_MODE=memory`, `EXTRACT_MODE=mock`). 블록 1 PR은 `apps/web/src`·`tests` 불변이 확인되면 `check`만으로 갈음한다(PR 본문에 그 이유를 적는다) | `test-results/<PR번호>-test-e2e.txt`, 통과 수(기존 약 72개 + 신규). 블록 1은 `git diff github/stage/demo4 --stat -- apps/web/src apps/web/tests` → 0 |
| C6 | `results-vision.md`가 정답 메모 상품 3개 이상 × 보내는 방법(통째·타일 1,200 둘 다) × 돌린 엔진 **2개**로 채워져 있고 항목 셀이 블록 1 "채점 규칙"의 값 중 하나다. 엔진 2개는 키 유무로 정해진다: 기본 luna+Upstage, Upstage 없으면 luna+qwen(결정 9), luna 없으면 Upstage+qwen(AI 결정, 9절 13), 둘 다 없으면 qwen만 → C6 `미완료`이고 결론 줄에 `비교 없음`. 통째는 두 엔진 모두 상품 3개 필수(Upstage 통째도 1회로 줄이지 않는다. 블록 1 "포기 순서"와 같은 문장). 빈 칸은 `미실행(이유)` | 파일의 표 행 수 ≥ 3 × 2 × 2, 빈 셀 0, 결론 줄에 두 엔진 이름 |
| C7 | ④ 공개 주소 실제 완주 1회: 실제 캡처 1장 → 조각 → `extract-text`(실험 1위 엔진) → `summarize` → 초안 도착. 엔진·조각 수·각 호출 ms·전체 ms 기록 | `test-results/<PR번호>-test-public.txt` 종료 0, progress.md 블록 2 항목. 초안 JSON의 `fields[].key`와 `fields[].label`에 `price\|가격\|재고\|할인\|stock\|discount` 0건. 검사는 `public.spec.ts` ④ 사례 안에서 `expect`로 단언하고 출력에 key·label 목록을 적는다(`jq`는 PC에 있는지 미확인이라 쓰지 않는다. `value`·`evidence`·`reason`은 검사 대상이 아니다. "가격은 변동될 수 있습니다" 같은 정상 문구가 걸리지 않게) |
| C8 | ④ 가짜 응답 시험: 서버 한도(4.5MB)보다 **파일 크기가 실제로 큰** 긴 합성 이미지가 조각으로 나뉘어 끝까지 읽힘 | `test:e2e` 출력의 사례 이름. 시험 안에 `buffer.length > 4.5 * 1024 * 1024` 단언이 있다 |
| C9 | ④ 가짜 응답 시험: 근거가 원문에 없는 항목 `unverified`("확인 안 됨"), 초안에 가격·재고·할인 항목 없음, 같은 조각 3회 실패 → 입력창 → 같은 모양 초안 | `evidenceCheck` 단위 시험(고정 시험값), e2e(가짜 LLM 응답이 **일부러** 원문에 없는 근거 1개를 낸다) |
| C10 | ④ 서버에 이미지·읽은 글자·초안을 저장하는 코드가 없다 | `grep -rnE "writeFile\|storage\.from\|createSignedUploadUrl\|supabase" apps/web/src/app/api/volunteer apps/web/src/lib/extract.ts` 0건, Codex가 코드로 확인 |
| C11 | 플로우 A: 세 질문 → 요약 → 대기번호 → 다시 열기 낭독 → 봉사자 화면(시연) 챗봇까지 `test:e2e` 통과(human.md:103) | `test:e2e` 출력의 사례 이름(블록 3·4) |
| C12 | 접수 실패 뒤 재시도해도 대기번호가 하나다(같은 `clientRequestId` → 같은 번호) | `requestStore` 단위 시험, e2e(`page.route` 500 뒤 재시도) |
| C13 | 봉사자 챗봇 기존 시험이 그대로 통과한다(`chat.spec.ts` 20개, `prompt.ts` endsWith 시험). 시험을 지우거나 기준을 낮춘 diff가 없다 | 플로우 A PR의 `-test-e2e.txt`·`-check.txt` 통과 수, `git diff github/main -- apps/web/tests/e2e/chat.spec.ts apps/web/tests/unit` 검토(3.2 "시험 변경") |
| C14 | 공개 주소 완주 1회와 실제 저장소 연결 여부(`/api/health`의 `store`, `memory`면 "흉내")가 기록에 있다 | progress.md 블록 4 항목, `test-results/<PR번호>-test-public.txt` |
| C15 | 공개 주소 완주 때 Supabase 호출과 AI(Groq·OpenAI·Upstage) 호출에 걸린 시간이 각각 적혀 있다(결정 11) | progress.md 블록 2·4, morning-report.md 8절. `Server-Timing` 헤더 값 또는 클라이언트 측정 ms |
| C16 | 유료 호출이 엔진당 조각(API 호출) 500장 이하다(= 상품 50개분, 상품 1개 ≈ 조각 10장, 최대 약 2천 원. human.md:142) | progress.md 엔진별 누계(조각 수) = 실험 서버 `/api/status`의 `calls` 기록(블록 1) + 공개 완주 조각 수(블록 2·6, `test:public` 출력). 코드 거부는 블록 1 실험 서버뿐이다(3.6 돈) |
| C17 | axe `critical`·`serious` 위반 0건(이용자 화면 intro·질문·요약·접수 완료, 봉사자 화면 요약 도착) | `test:e2e` 출력 |
| C18 | `morning-report.md`가 `.claude/rules/overnight-loop.md` "아침 보고" 순서(1~6)로 있고, 그 뒤에 11/9 추가 절(비전 실험 결론·결과표 링크·입문 메모, 서버 지역 시간, 이어 달리기 결과·호출 수·돈, 아침에 정해 줄 것)이 붙어 있다 | 파일 존재와 절 순서(블록 6) |

- 표 안 명령의 `\|`는 마크다운 표 이스케이프다. 실제 명령은 `|`로 친다(C1의 `jq '.[] | {…}'`, C7의 `price|가격|…`, C10의 `writeFile|storage\.from|…`). `\|`를 그대로 치면 GNU grep -E가 리터럴 `|`로 읽어 아무것도 안 걸리고 0건이 허위 통과한다.

- 완료 조건을 채워도 실패 이력이 있으면 그 PR은 보류다(`.claude/rules/success-criteria.md` "실패 세기", `.claude/rules/pr-flow.md` "병합"). 개발 중 실패도 센다. 숨기지 않는다.
- 사람 판정 항목은 완료 조건에 넣지 않고 `사람 판정 대기`로 적는다(5절 "사람 판정 대기 항목").
- 가짜 입력으로 통과한 시험은 `가짜 음성 입력 기준`, 가짜 응답으로 통과한 시험은 `가짜 응답 기준`이라고 보고에 밝힌다.
- 참고 지표(합격 판정 아님, human.md:62, 145): 정답 메모 기준 정확도 vs 90%, 지어냄 vs 0건, 요약 1건 시간 vs 2분, 캡처 올리기부터 초안까지 시간. 결과표 끝에 나란히 적는다.

## 1.5 확정한 결정 (정해 줄 것 1~11, 2026-11-09 이용자 확정)

| # | 확정 답 | 이 파일에 미치는 영향 |
|---|---|---|
| 1 | 비교 모델은 9번이 대신한다(Groq+Gemini 안 폐기) | 블록 1 엔진 목록은 luna·Upstage·(Upstage 없을 때 대체, 시간이 남으면 기준선) Groq qwen. Gemini 키·코드 없음. human.md:46 "유료 모델 안 씀"은 138행대로 9번이 대신한다 |
| 2 | 화면 요약에서 가격을 뺀다. 실험 결과표에서만 채점한다 | 블록 1 결과표에 "가격(채점용)" 열. 블록 2 `evidenceCheck`가 가격·재고·할인 항목을 초안에서 제거(TSD:388). `SummaryDraft.fields` key 목록에 price 계열 없음 |
| 3 | 오늘 밤 이미지 범위는 실험 + 봉사자 화면 "올리기·요약"까지. ⑤ 대조·수정 화면은 안 함 | 블록 2 산출물은 `InfoSummary`까지. 항목 수정 UI 없음(8절) |
| 4 | 밤 순서: 이미지(④) → 플로우 A → 마무리 | 4절 블록 순서 1·2(④) → 3·4(플로우 A) → (5) → 6 |
| 5 | 대기열 저장소는 Supabase(`lighthouse`, 서울, 무료). Vercel 연동과 변수 16개(production+preview)는 11/9 낮에 끝남. development 없음 → 로컬은 `STORE_MODE=memory` | 블록 4가 notes C4 Redis 설계 대신 notes-flow-a.md 129-141·149-155 갱신 절과 TSD §8.3을 따른다. 사람 자기 전 "Supabase 연결"(human.md:84)은 끝났다 |
| 6 | 다시 열면 서버에 물어 "대기번호 N번, 기다리는 중" 낭독. 남은 사람 수는 안 함 | 블록 4 `GET /api/requests/{id}`와 `checking` 상태(notes C2). 포기 순서 ①의 대상 |
| 7 | 질문 1 품목 검사는 기기 안에서 `parseRequest`로 바로. 시연 대본은 소니 헤드셋 | 블록 3 `requestFlow`가 질문 1 확인 때 `parseRequest(answer).item` 검사. 사전 확장 없음 |
| 8 | FastAPI 없이 Next.js 하나. TSD는 v2 | 모든 서버 코드는 `apps/web/src/app/api/*`. 별도 배포 없음(TSD:104) |
| 9 | ④ 엔진은 OpenAI `gpt-5.6-luna`(detail original, 추론 끔)와 Upstage Document OCR을 같은 정답 메모로 재 보고 고른다. luna는 조각·통이미지 둘 다. Upstage 가입이 안 되면 luna와 Groq qwen만. 생김새 설명(qwen)은 시연 뒤 | 블록 1 실험 설계와 채점 규칙. 블록 2 기본 엔진은 결과표 1위, `미정`이면 OpenAI → Upstage 순(근거 human.md:125: OpenAI 키는 확정 등록 항목, Upstage는 선택) |
| 10 | 오늘 밤은 ④만. ③은 다음 밤. 단, 07:00 전에 60분 넘게 남으면 ③을 당겨 시작(`feat/demo3/search-advice`, `stage/demo3`) | 블록 5가 조건부. 블록 2만 `volunteer/page.tsx`를 고치고 블록 5는 고치지 않는다(TSD:455) |
| 11 | 서버 지역은 미국 동부 기본값 유지. 공개 주소 완주 때 Supabase 호출과 AI 호출 시간을 각각 재서 아침 보고에 적는다 | `apps/web/vercel.json`에 `regions`를 넣지 않는다. 블록 2·4가 `Server-Timing` 헤더(`engine`·`llm`·`store`)와 클라이언트 ms를 기록, C15, 블록 6 보고 8절 |

## 2. 확인된 사실

### 저장소에서 확인한 것 (2026-11-09, `origin/main` = `3206331`(#19), 클라우드 작업 브랜치 `claude/cloud-brief-ai-plan-pim0gp`(`89d9cb1` 이후))

| 사실 | 근거 |
|---|---|
| `apps/web/src`·`tests` 줄 번호는 PR #17(`48b38ea`) 시점과 같다. 그 뒤 앱 변경은 `experiments/vision/{index.html,server.mjs}` 추가뿐 | `git diff --stat 48b38ea HEAD -- apps/web` → 2 files, +358 |
| 푸시는 `git push github <브랜치>` 형식만 훅이 허용한다(`-u` 허용). 강제·`--delete`·`--all`·`--tags`·main·HEAD 푸시 차단 | `.claude/hooks/guard.js:126-139`, `guard.test.js:28-44` |
| main 직접 커밋을 훅이 막는다. 브랜치·폴더를 확인 못 해도 막는다 | `.claude/hooks/guard.js:73, 118, 121-122` |
| **`gh pr merge`는 `--squash`가 없거나, base가 `main`이 아니거나, `hold-morning`이 있거나, `gh pr view`가 실패하면 훅이 막는다.** 그래서 기능 PR(base `stage/…`)의 AI 병합은 훅을 고치지 않는 한 불가능하다 | `.claude/hooks/guard.js:141-160`(158 "main이 base가 아닌 쌓인 PR은 사람이 병합"); `.claude/rules/pr-flow.md` "병합" 표와 충돌 |
| **훅은 Edit/Write로 `.claude/hooks/`·`settings(.local).json`을 고치는 것도 막는다.** 그래서 AI는 훅 파일을 편집하지 못한다(Bash로 쓰는 것은 우회라 하지 않는다) | `.claude/hooks/guard.js:198` |
| `gh api -X PUT …/contents/…`(evidence 업로드), `supabase db push --linked`, `vercel deploy --prod --yes`, `git remote add`, `gh pr edit --add-label`은 훅이 막지 않는다 | 가짜 훅 이벤트로 `guard.js` 실행(e1~e15), `guard.js:178`은 `set-url`·`remove`만 차단 |
| 훅은 `.env` 이름이 명령 안에 있으면 막는다(따옴표·`node -e` 안도). 키 확인은 `.env`를 읽는 프로그램(실험 서버)의 상태 응답으로만 한다 | `.claude/hooks/guard.js:41-46, 162-166, 170, 196` |
| `node .claude/hooks/guard.test.js` 122/122 통과 | 실행, 종료 코드 0 |
| 저장소 설정: `delete_branch_on_merge=true`, squash·merge 허용, 라벨 `hold-morning` 있음, 열린 PR 0, `evidence` 브랜치 있음(폴더 7/, 9/, 10/, 11/, 12/), `stage/*` 브랜치 아직 없음, PR 템플릿 없음 | `gh api repos/IBORY-PURPLE/Lighthouse_Dev`, `…/labels`, `…/branches`, `…/contents?ref=evidence`; `.github/` |
| 클라우드 작업본의 gh는 REST(`gh api`)는 되고 GraphQL(`gh pr view`, `gh pr list`)은 403이다. PC에서는 미확인 | `gh pr view 19 --json baseRefName` → HTTP 403 |
| `speech.ts`: STATUS 19-38, InputState 48-55, 모델 57-68, 액션 70-82, reducer 96-169, matchRejected 153-160·matchFailed 161-167(transcript 유무로 분기), reset 액션 없음, startRecognition 217-296 | `apps/web/src/lib/speech.ts` |
| `SpeechInput.tsx`: typed 48, 마운트 때 API 없으면 unavailable 63-66, 입력창 제출은 확인 없이 onSubmit 106-116, 말하기 버튼 138-154·입력창 155-177, labels 선택 prop 39, 기본 문구 27-33 | `apps/web/src/components/SpeechInput.tsx` |
| 봉사자 챗봇이 같은 부품을 쓴다: `VolunteerChat.tsx:4` import, QUESTION_LABELS 13-19, 렌더 72-77; `volunteer/page.tsx:13`에서 VolunteerChat import, 85-89 렌더. `volunteer/page.tsx`는 URL 쿼리를 쓰지 않고 `lh.match.v1`을 `useSyncExternalStore`로 읽는다(35-50). ④ 부품은 `{match && (...)}` 조각(75-91) 안 VolunteerChat(85-89) 뒤에 붙인다 | `apps/web/src/components/VolunteerChat.tsx`, `apps/web/src/app/volunteer/page.tsx` |
| `MatchResponse = {requestId, volunteer{id, displayName}, request{brand, item, raw}}`(sessionStorage `lh.match.v1`). `volunteers.ts`는 server-only 고정 명단 3명 | `apps/web/src/lib/matchHandoff.ts:6-14`, `apps/web/src/lib/volunteers.ts:9-17` |
| `chat.ts:28-30` context.item은 비어 있지 않은 문자열 필수(결정 7 근거). `api/chat/route.ts`: 질문 300자, 본문 2048바이트, 분당 20, 쿠키 401, 503, 502, 스트리밍, maxDuration 30 | `apps/web/src/lib/chat.ts:23-32`, `apps/web/src/app/api/chat/route.ts:9-16, 47-148` |
| `api/match/route.ts`: 200자(12), 분당 30(15), 품목 없음 422(54-55), 로그는 상태·ms만(68-76). `rateLimit.ts`는 서버 메모리 Map이라 Vercel 인스턴스마다 따로 센다 | `apps/web/src/app/api/match/route.ts`, `apps/web/src/lib/rateLimit.ts:1-16` |
| `api/health/route.ts:18-25` 응답 `{ok, groqKeyConfigured, llmMode}`. **키를 더하면 깨지는 시험**: `public.spec.ts:57-62`(키 집합 toEqual), `routes.test.ts:62-66, 74-78`(본문 toEqual). `skeleton.spec.ts:35`는 llmMode만 본다 | 각 파일 |
| `llm.ts`: `openai/gpt-oss-120b`, max_completion_tokens 800, `getLlmMode`는 `VERCEL_ENV=production`이면 live, `LLM_MODE=mock`이면 mock, 429→`rate_limited`. `prompt.ts` 37줄, INSTRUCTIONS 8-27, buildSystemPrompt 34-37이 마지막 줄에 브랜드·품목 한 줄을 붙인다 | `apps/web/src/lib/llm.ts:9-35, 47-124`, `apps/web/src/lib/prompt.ts` |
| `answerRules.ts` checkAnswer: 세 항목 순서, 가격 패턴 5개, 재고 단정, 모델명 `/[A-Za-z]{2,}[-\s]?\d{3,}/` | `apps/web/src/lib/answerRules.ts:16-71` |
| `parseRequest.ts`: import 없는 순수 함수, 사전 Sony(`/sony|소니|쏘니/i`)·헤드셋(`/헤드셋|헤드폰/`)뿐, 브라우저에서 쓸 수 있다 | `apps/web/src/lib/parseRequest.ts:4-21` |
| `fakeSpeech.ts`: installFakeSpeech, removeSpeechApi, say, fail, never, startCount, recognitionConfig | `apps/web/tests/e2e/helpers/fakeSpeech.ts:28-135` |
| e2e 개수(코드를 읽어 센 값, 실행 안 함): skeleton 4, user-screen 22, match 26, chat 20 = 약 72개. public 3개(`BASE_URL` 필수, 접근 코드는 루트 `.demo-access.local` 첫 줄). `chat.spec.ts:54-76, 412-436`은 이용자 화면을 거쳐 봉사자 화면으로 가므로 플로우 A가 바꾸면 깨진다 | `apps/web/tests/e2e/*.spec.ts`, `public.spec.ts:9-23` |
| `tests/chatbot/questions.json` 20개(q01~q20, 표기 변형·가격·재고·모델명·할인 유도 포함). `questions.test.ts`는 `GROQ_API_KEY` 없으면 skip, 7초 간격, 결과를 루트 `test-results/chatbot-<시각>.json`에 기록 | `apps/web/tests/chatbot/questions.json:2-21`, `questions.test.ts:11-104` |
| `playwright.config.ts`: workers 1, 프로젝트 `e2e`·`public` 모두 iPhone 15, baseURL은 `BASE_URL` 또는 `http://localhost:3100`, `BASE_URL`이 없을 때만 webServer를 `LLM_MODE=mock`, `DEMO_ACCESS_CODE=e2e-test-code`로 띄운다(36-39). `test:public`에는 webServer env가 적용되지 않는다 | `apps/web/playwright.config.ts:17-40` |
| `package.json` scripts: check(lint+typecheck+test:unit), test:e2e(`--project=e2e`), test:chatbot, test:public(`--project=public`). Node 22.x. next 16.4.5, groq-sdk 1.6.0, vitest 5.1.0, @playwright/test 1.64.1 | `apps/web/package.json:6-38`, `package-lock.json` |
| `experiments/vision/server.mjs`: 포트 4310(`VISION_LAB_PORT`), `GROQ_API_KEY`를 `apps/web/.env.local` 또는 루트 `.env`에서 `process.loadEnvFile`로 읽음, `GET /api/status` → `{keyConfigured, models}`, `POST /api/analyze` `{images[1~3], kind: summary|ocr, model?}` → `{model, text, finishReason, ms, usage}`, MODELS=[`qwen/qwen3.8-27b`], 바디 30MB, max_completion_tokens 2048, temperature 0.2, timeout 120초, 자르기 없음, 파일 쓰기 없음 | `apps/web/experiments/vision/server.mjs:2-3, 14-46, 68-137` |
| `experiments/vision/index.html`: 보내기 select whole/tiles, 지시 summary/ocr, 최대 폭 1024·타일 높이 1400 기본, `prepare()`가 createImageBitmap 축소 → JPEG 0.85, 80px 겹침, 마지막 조각 40% 미만이면 앞에 붙임, 3장씩 `/api/analyze`, 429면 retryAfterSec 대기 최대 4회, "예시 이미지 만들기"(860×4200 합성 LH-200) | `apps/web/experiments/vision/index.html:47-63, 89-121, 130-218` |
| `.gitignore`(루트): `.env`, `.env.*`, `node_modules/`, `.next/`, `.vercel/`, `test-results/`, `playwright-report/`, `.demo-access.local`. **`apps/web/.vercelignore`에 `experiments/`는 없다**(배포 업로드에 포함됨). `test-results`는 .vercelignore에 있다. `apps/web/vercel.json`은 `{"framework":"nextjs"}`뿐 | 각 파일 |
| `CLAUDE.md` 지도에 `apps/web/experiments/vision/` 줄은 클라우드 작업본(`89d9cb1`)에 있고 `github/main`에 있는지는 블록 0이 본다. `supabase/` 줄은 없다. `supabase/` 폴더는 저장소에 없다 | `CLAUDE.md:15`, `ls -d supabase` |
| TSD v2: §3 표 ④ 행(97-99), §4 폴더(106-137, `supabase/`는 저장소 루트), §5 환경 변수(140-155), §7.1 ④ 상태 문구(216-218)·항목 순서(224), §8 공통 규칙(229: 401, 로그 금지, `{ok:false,error}`, 봉사자 API `X-Demo-Volunteer` 없음 → 403 `unknown_volunteer`), §8.1 health 추가 키(234), §8.2(236-254), §8.3(256-313), §8.4(315-322), §8.6 chat(336-346), §8.7 extract-text(348-356), §8.8 summarize(358-391), ④ 자르기(393-398), §9 챗봇 지시문 삽입 위치(404)·고정 질문 추가(411), §10(413-428), §11(430-438), §12(440-456), §13(458-477) | `docs/TSD.md` |

### 문서가 확인됐다고 적은 것 (AI가 재확인하지 않음, 블록 0 점검에서 있음/없음만 다시 본다)

| 사실 | 근거 |
|---|---|
| Supabase 프로젝트 `lighthouse`, ref `zdnlhnzybbuloquzxwkg`, 서울, 무료. CLI는 로그인 토큰으로 비밀번호 없이 `supabase init`·`link`·`migration list --linked` 성공(저장소 루트에서). `supabase/`(config.toml, .gitignore)는 PC 작업본(브랜치 `docs/overnight-1109-plan`)에 미커밋으로 남아 있고(notes:152) `supabase/.temp/`만 지웠다(notes:147). 이 클라우드 작업본에는 없다. 마이그레이션 0개. `db push --linked`는 **미확인** | notes-flow-a.md:130-131, 147, 151-152 |
| Vercel `lighthouse-web` 환경변수 16개(이름만): `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 등, target production+preview, development 없음. 연동 재동기화 때 target이 되돌아갈 수 있음 | notes-flow-a.md:150, 155 |
| 공개 주소 `https://lighthouse-web-five.vercel.app`(11/4 기준, 미확인). `lighthouse-web.vercel.app`은 남의 사이트. 접근 코드·시연 주소는 루트 `.demo-access.local`(첫 줄 코드, 둘째 줄 주소) | 11/4 progress.md:24-25; 11/4 morning-report.md:14 |
| Vercel 프로젝트 `lighthouse-web`(팀 `iborys-projects`), PC의 `apps/web/.vercel`에 링크. 설정은 Root Directory `.`, Node 26.x로 문서(apps/web, 22)와 다르지만 `apps/web`에서 `vercel deploy --prod --yes`로 빌드된다. Production에 옛 `Groq_API_key`가 남아 있다. main 병합이 Production 자동 배포를 만드는지 미확인 | 11/4 progress.md:131, 211; 11/4 morning-report.md:76-77, 81 |
| 11/4 밤 기능 블록 실제 소요 25~35분(블록 1 00:25~00:58, 2 00:58~01:22, 3 01:23~01:55). 블록 3 뒤 다음 블록이 시작되지 않아 09:58에야 재개 | 11/4 progress.md:40, 64, 92; 11/4 morning-report.md:7; human.md:37, 83 |
| 11/4 통합 때 `progress.md`를 기능 브랜치에 넣어 squash 병합 뒤 충돌(`CLAUDE.md`, `globals.css`, `page.tsx`, `progress.md`) | 11/4 morning-report.md:59-60 |
| Codex는 Windows `codex exec -s workspace-write` 안에서 Vitest·Playwright를 `spawn EPERM`으로 못 띄운다(2026-11-05) → 시험 기록 판정 | `.claude/rules/pr-flow.md` "Codex 검증", 11/4 progress.md:32, 46 |
| `test:public`에서 health만 보려면 `-g "접근 코드와 health|첫 화면"`(Groq 호출 없음) | 11/4 progress.md:129 |
| 비용 추정: 상품 1개(조각 10장) luna 약 14원, Upstage 약 23원. 엔진당 상품 50개분(조각 500장) 이하 → 최대 약 2천 원(예산 5만 원). 이 산수(50 × 37원 ≈ 2천 원)는 1번 = 상품 1개(조각 10장)일 때만 맞는다. OpenAI 크레딧 소모도 예산으로 센다 | human.md:142, tsd-review.md:76-81 |
| Upstage OCR: `POST https://api.upstage.ai/v1/document-digitization`, multipart `document`+`model=ocr`, Bearer 키, Tier 0 동기 3 RPS, 글자 높이 2.5% 권장(16px 글자면 약 640px 조각). 가입 크레딧·쪽수 과금(`usage.pages`)은 미확인 | research-vision.md:29-30, 33, 75, 77, 79 |
| 블록 이어 달리기 방식(각 블록이 다음 블록 세션을 직접 시작, 30분 주기 안전망, 자기 전 시험)은 **아직 확인되지 않은 방법**이다 | human.md:37-42 |

### 미확인 (추측하지 않는다)

| 항목 | 언제 확인 | 확인 못 하면 |
|---|---|---|
| 새 Claude Code 세션을 블록 세션이 시작하는 방법(CLI 새 프로세스, 앱 예약 작업), 권한 모드·훅 적용·창 종료 시 생존 | 블록 0 시험(사람 옆에 있음) | 안전망만. 그것도 안 되면 아침 보고 첫 줄에 멈춘 시각 |
| 약 30분 주기 안전망을 어떤 기능으로 거는지 | 블록 0 | 없이 간다. 블록이 끊기면 사람이 아침에 재개 |
| PC에 `github` 원격, `gh`·`vercel`·`codex`·`supabase`·`bd` 로그인·설치, 셸 종류 | 블록 0 `git remote -v`, 각 `--help`/`whoami` | 원격 없음·로그인 실패면 사람에게(자기 전). 밤에는 멈춤 |
| PC의 gh가 `gh pr view`·`gh pr list`(GraphQL)를 쓸 수 있는지 | 블록 0 `gh pr list --state all --limit 1` | 안 되면 모든 PR 조회를 `gh api …/pulls`로, PR 열기·라벨·댓글도 REST로(`gh api -X POST …/pulls`, `…/issues/<번호>/labels`, `…/issues/<번호>/comments`. 명령은 3.3의 2. 형식은 블록 0이 1회 확인하고 기록), `gh pr merge`는 훅이 막으므로 모든 PR `hold-morning` |
| HEAD에서 `npm run check`가 통과하는지, `eslint .`이 `experiments/`를 검사하는지 | 블록 0 `npm ci && npm run check`(기준선, 실패는 세지 않음) | 원인만 기록. 블록 1은 자기 변경분만 책임진다 |
| `@playwright/test`의 webkit 브라우저가 PC에 아직 설치돼 있는지. e2e는 `devices["iPhone 15"]`(WebKit)로 돌고 11/4에 Windows WebKit으로 `test:e2e`가 통과했다(11/4 progress.md:26 "Chromium 대체 불필요", `playwright.config.ts:21`) | 블록 0 `cd apps/web && npx playwright install webkit`(이미 있으면 바로 끝남). chromium은 새로 설치하지 않는다 | 블록 1 `run.mjs`는 webkit 기본, 실패 시 chromium 설치를 시도하고, 그것도 안 되면 AI가 브라우저 없이 `curl`로 미리 자른 조각을 보낸다 |
| `OPENAI_API_KEY`·`UPSTAGE_API_KEY`가 PC와 Vercel production에 있는지. PC 키 파일 위치는 **미확인**: `apps/web/.env.local` 또는 `apps/web/.env` 또는 루트 `.env`(`server.mjs:14-17`은 앞뒤 둘을, TSD:144는 `apps/web/.env`를, 11/4 ai.md:71은 `.env`를 적어 서로 다르다. 저장소에 PC 파일 위치 근거가 없다) | 블록 0: 실험 서버 `GET /api/status`의 불리언으로 확인하고 파일 이름은 사람에게 묻는다(블록 0이 플래그 1커밋을 넣는다. 지금 `server.mjs:14-25`는 `GROQ_API_KEY`가 비어 있을 때만 env 파일을 읽으므로 같은 커밋에서 두 파일을 조건 없이 차례로 읽게 고친다), `vercel env ls`의 이름(값은 안 본다) | 없는 엔진은 실험에서 빼고 기록. 둘 다 없으면 Groq qwen만, 아침 보고 첫 줄. 세 불리언이 모두 false면 사람에게 파일 위치를 되묻는다 |
| OpenAI 크레딧 잔액·등급, `gpt-5.6-luna`의 정확한 요청 매개변수 이름(detail original, 추론 끔) | 블록 1 첫 호출, `openai` SDK 타입으로 | 매개변수가 거부되면 기본값으로 호출하고 결과표에 적는다 |
| Upstage 가입·크레딧·쪽수 과금(`usage.pages`), 세로 긴 조각이 몇 쪽인지 | 블록 1 첫 호출 응답 | 가입 안 되면 결정 9대로 luna+qwen만 |
| Groq `qwen/qwen3.8-27b` 가용성·무료 한도·3장 제한, Groq `gpt-oss-120b` 분당 한도(③과 ④ 요약이 나눠 씀) | 블록 1 첫 호출, 요약 단계 429 여부 | 429·404면 기준선 없이 두 엔진만. 요약 429면 블록 2 요약 모델을 OpenAI로 |
| 조각 높이 최적값(1,200px 기준, 2.5% 권장이면 약 640px) | 블록 1 타일 비교(1,200 vs 800) | 1,200으로 두고 기록 |
| `supabase db push --linked`가 비밀번호 없이 되는지, 사람이 밤 실행을 허락하는지 | 블록 0에서 사람에게 묻고 progress.md에 기록, 블록 4에서 실행 | 메모리 "흉내"로 공개 완주, 마이그레이션 파일만 PR에. 흉내는 블록 4 할 일 3의 자동 전환(RPC가 함수·표 없음 오류를 내면 메모리로) 때문에 production에서도 가능하다. 전환 코드가 없으면 production은 `STORE_MODE`를 무시하고(TSD:153) 변수 16개가 있어 Supabase 구현을 고르므로 완주가 503으로 끝난다. 그래서 전환 코드는 빼지 않는다 |
| `supabase-js` `rpc` 반환 모양(배열, 0행), `register_request` SQL이 실제 Postgres에서 도는지 | 블록 4 첫 RPC | 래퍼에서 맞춤. 3회 실패면 흉내 |
| Vercel 함수 지역 실제값(iad1 추정)과 서울 DB 왕복 지연 | 블록 4 공개 완주 기록 | 결정 11대로 아침에 사람이 정한다 |
| Supabase 변수 preview target이 유지되는지 | 블록 2·4 배포 뒤 `/api/health`의 `store` | production 배포로 완주 |
| 아이폰 canvas 면적 한도, 실기기 자르기 | 아침 사람 | 대체 경로는 다음 밤(human.md:150) |
| Vercel 프로젝트 설정(Root Directory, Node)이 11/5 이후 바뀌었는지 | 블록 0 `vercel project inspect lighthouse-web`(CLI에 있으면, 미확인. `vercel project ls`는 이름·갱신 시각만 보여 준다) 또는 대시보드에서 사람이 본다. 둘 다 안 되면 그대로 둔다 | 설정을 바꾸지 않고 `apps/web`에서 배포 |
| 11/9 ai.md·human.md가 `github/main`에 있는지(2026-11-09 기준 `github/main`(`3206331`)의 계획 폴더에는 `tsd-review.md`만 있다. 나머지는 문서 브랜치 `claude/cloud-brief-ai-plan-pim0gp`에 있다) | 블록 0 `git log github/main -1 -- docs/plans/2026-11-09-overnight/ai.md` | 없으면 사람이 자기 전에 문서 PR을 병합한다(5절). 병합을 못 하면 블록 0 할 일 5대로 문서 브랜치의 계획 폴더(ai.md·human.md·notes-flow-a.md·research-vision.md·progress.md 모두)를 `docs/overnight-1109`에 먼저 커밋한다(필수). 블록은 ai.md를 그 브랜치에서 `git show`로 읽는다(0절 3) |
| 주간 사용량·블록 토큰을 밤사이 잴 수 있는지 | 블록 1 | `미측정`으로 적고 시간 기준만 적용 |
| 두 엔진 키가 모두 있을 때 어느 엔진을 쓰는지(TSD §8.7에 없음) | 블록 2가 정한다(1.5의 9) | 결과표 1위 → 없으면 OpenAI → Upstage |

## 3. 모든 블록에 공통인 절차

규칙 원문은 각 파일에 있다. 여기는 순서와 명령만 적는다. 모델은 `.claude/rules/overnight-loop.md` "모델"(구현·판단 Opus 5.5 high, 5개 이상 파일 탐색·긴 로그는 Sonnet 하위 에이전트).

### 3.1 시작

1. 0절 순서로 읽는다. progress.md 마지막 항목에서 앞 블록 PR의 상태(AI 병합/보류/미완료)와, 항목 안의 고정 줄 4개(`이어 달리기 명령:`, `훅 수정 허락:`, `db push 허락:`, `통합 배포 푸시 허락:`. 블록 0 기록을 매 항목이 옮겨 적는다, 3.5의 3)를 `grep -n "^이어 달리기 명령:"`처럼 라벨로 찾아 확인한다(항목 끝이 아닐 수 있다. 0절 3). 고정 줄이 없으면 `grep -n "블록 0"`으로 블록 0 항목을 찾아 그 부분만 읽는다.
2. 시작 표시: **첫 명령으로** `mkdir -p test-results/overnight-1109 && echo "시작 $(date +%H:%M) <방법: 앞 블록 직접 시작|안전망|사람>" >> test-results/overnight-1109/block-<N>.started`(저장소 루트, git 무시 폴더. 읽기보다 먼저 한다. 부모·안전망이 띄우기 직전에 같은 파일을 만들어 두므로 **덧붙인다**. 없으면 이 명령이 만든다). 부모(3.5의 7)와 안전망은 이 파일에 자식 줄(`시작 HH:MM`)이 덧붙는 것으로 "떴다"를 판단한다. 같은 내용을 작업 메모(5)에도 적어 두고 블록 끝 progress.md 항목에 넣는다(앞 블록은 시작 성공을 기록하지 않는다).
3. `git fetch github`. `git status --short`가 비어 있는지 본다(앞 블록이 작업을 모두 커밋·푸시하고 끝났어야 한다). 비어 있지 않으면 내용을 작업 메모에 적고 `git stash`하지 않고 그대로 둔 채 새 브랜치로 간다(파일이 겹치면 멈춤 조건). `supabase/.temp/`가 보이면 무시한다(블록 4 전까지. 블록 4가 루트 `.gitignore`에 넣는다).
4. 시작 브랜치를 정한다(`.claude/rules/pr-flow.md` "브랜치와 푸시", "보류 PR 위에 쌓기"). 블록마다 4절 "시작 브랜치"에 분기가 있다. 공통 명령:
   - 단계 브랜치가 아직 없을 때: `git checkout -b stage/demo<N> github/main && git push github stage/demo<N>`
   - 기능 브랜치: `git checkout -b feat/demo<N>/<기능> github/stage/demo<N>`(단계 브랜치가 원격에 있으면) 또는 방금 만든 로컬 `stage/demo<N>`에서.
   - 앞 기능 PR이 보류이고 이 블록이 그 **코드**에 의존할 때만: `git checkout -b feat/demo<N>/<기능> github/feat/demo<N>/<앞 기능>`, PR base를 앞 기능 브랜치로.
5. 시작 시각과 이 블록의 끝 상한·작업 멈춤 시각(3.6으로 계산)을 작업 메모 `test-results/overnight-1109/block-<N>-notes.md`(로컬, git 무시. 블록 끝에 progress.md 항목으로 옮긴다)에 적는다. progress.md에는 블록 중에 쓰지 않는다(기능 브랜치에 없는 파일이라 untracked가 된다).
6. `bd ready`로 이 블록에 걸린 이슈가 있으면 `bd update <id> --claim`(`.claude/rules/beads.md`). `bd`가 없으면 건너뛰고 메모에 적는다.

### 3.2 구현 중

- 시험은 가짜 응답으로 돈다: `LLM_MODE=mock`, `STORE_MODE=memory`, `EXTRACT_MODE=mock`(TSD:149-153, 418). 실제 호출은 `test:chatbot`(블록 5만), `test:public`, 블록 1 실험에서만.
- 실패(검사·시험·빌드·배포·Codex 심각 지적)가 날 때마다 작업 메모에 명령·커밋·오류 한 줄을 적는다. 새 시험을 먼저 쓰고 일부러 틀리는 첫 1회는 `의도된 실패`(`.claude/rules/success-criteria.md` "실패 세기").
- **시험 변경**: 기존 시험 문구·기대값을 바꾸면(예: `/api/health` 키 집합, 이용자 화면 진입 경로) 이유를 PR 본문 "시험 변경" 항목에 적고 Codex 프롬프트에 그 목록을 넣는다. 시험을 빼거나 `skip`하거나 `arrayContaining`처럼 느슨하게 바꿔 통과시키지 않는다(`.claude/rules/success-criteria.md` "시험을 고칠 때"). 사례를 빼야 하면 PR에 `미완료`로 적는다.
- 유료·외부 호출은 할 때마다 메모에 `엔진 N장(누계 N/500)`로 적는다(조각 1장 = API 호출 1회. 3.6 돈). Groq는 `qwen`과 `gpt-oss` 회수로 따로 센다.
- 명령 출력은 실패 줄과 요약만 본다. 긴 로그는 Sonnet 하위 에이전트에 맡긴다.
- 커밋은 파일을 지정해 `git add <경로>`로만 한다. `git add -A`·`git add .`는 쓰지 않는다. 커밋 전 `git status --short`에 `.env*`, `.demo-access.local`, `test-results/`, `supabase/.temp/`, 이미지 파일이 없는지 본다.
- 새 lib 파일·최상위 폴더를 만들면 같은 PR에서 `CLAUDE.md` 지도를 고친다(`.claude/rules/file-navigation.md` "지도 유지"). 블록 1·2·3·4가 모두 `CLAUDE.md` 표를 고친다. 다른 줄은 옮기지 않되, **`apps/web/src/lib/` 행은 블록 2·3·4가 같은 한 줄에 파일 이름을 덧붙이므로 통합 충돌이 예상된다**. 블록 6이 세 쪽 파일 이름을 모두 살려 손으로 합친다(7절 충돌 행).
- `playwright.config.ts` webServer env의 `STORE_MODE: "memory"`, `EXTRACT_MODE: "mock"` 두 줄은 블록 2와 4가 **같은 자리(`LLM_MODE` 바로 아래, 이 순서)에 같은 두 줄**을 넣는다(이미 있으면 건너뜀). 통합 때 충돌을 피하기 위해서다.
- `progress.md`·`morning-report.md`는 기능 브랜치에 넣지 않는다(3.5).

### 3.3 PR과 검증 (각 블록의 "검증" 15분 안)

1. `git push github feat/demo<N>/<기능>`
2. (저장소 루트에서) `gh pr create --base <4절 표의 base> --head feat/demo<N>/<기능> --title "<기능>" --body-file test-results/pr-<기능>.md`. 본문은 `.claude/rules/pr-flow.md` "PR 본문" 7항목 + "시험 변경"(바꾼 기존 시험과 이유) + "유료 호출 수" + `Codex: 시험 기록 판정(직접 실행 아님)` + 가짜 입력으로 통과한 시험에 `가짜 음성 입력·가짜 응답 기준`. 번호를 받은 뒤 아래를 채워 `gh pr edit <번호> --body-file`로 갱신한다. PC에서 `gh pr list`가 실패하면(블록 0 기록 "gh GraphQL 불가") PR 열기·라벨·댓글도 REST로 대체한다: 열기 `gh api -X POST repos/IBORY-PURPLE/Lighthouse_Dev/pulls -f title=… -f head=… -f base=… -F body=@<파일>`, 라벨 `gh api -X POST repos/IBORY-PURPLE/Lighthouse_Dev/issues/<번호>/labels -f "labels[]=hold-morning"`, 댓글 `gh api -X POST repos/IBORY-PURPLE/Lighthouse_Dev/issues/<번호>/comments -F body=@<파일>`(명령 형식은 블록 0이 1회 확인하고 기록한다. 6의 `gh pr comment`, 8의 `gh pr edit --add-label`도 같은 대체).
3. (`cd apps/web`) 시험 기록 파일(`.claude/rules/pr-flow.md` "Codex 검증"). PR의 최종 커밋에서 `apps/web`에서 돌리고 저장소 루트 `test-results/`에 둔다. 명령마다:
   ```
   ( echo "commit $(git rev-parse HEAD) | npm run check"; npm run check 2>&1; echo "exit $?" ) > ../../test-results/<PR번호>-check.txt
   ( echo "commit $(git rev-parse HEAD) | npm run test:e2e"; npm run test:e2e 2>&1; echo "exit $?" ) > ../../test-results/<PR번호>-test-e2e.txt
   ```
   명령별 파일: `-check`, `-test-e2e`, `-test-public`, `-test-chatbot`(해당 시). 기록 뒤 커밋을 더 올리면 옛 기록을 `<PR번호>-<명령>-<옛 해시>.txt`로 바꾸고 다시 돌린다.
4. 비밀 패턴 검사(3.7): `grep -rcE "gsk_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{10,}|UPSTAGE_API_KEY=|SUPABASE_[A-Z_]*KEY=" test-results/<PR번호>-*.txt` → 모두 0. 접근 코드는 값을 출력하지 않고 `grep -rcF -f <(head -1 .demo-access.local) test-results/<PR번호>-*.txt` → 0. (Upstage 키 접두는 미확인이라 변수 이름으로 검사한다.)
5. 화면을 바꿨으면 스크린샷을 화면당 1장 `evidence` 브랜치 `<PR번호>/`에 GitHub API로 올린다(명령 길이 제한 때문에 JSON 파일로). ④ 화면(블록 1·2)은 합성 이미지로 만든 화면만 올리고 파일 이름에 `synthetic`을 넣는다. 이용자 화면(블록 3·4)은 캡처가 보이지 않으므로 그대로 올린다(3.7):
   ```
   node -e "const fs=require('fs');fs.writeFileSync('test-results/evidence-<PR>-<이름>.json',JSON.stringify({branch:'evidence',message:'evidence: PR <PR> <화면>',content:fs.readFileSync('test-results/<파일>.png').toString('base64')}))"
   gh api -X PUT repos/IBORY-PURPLE/Lighthouse_Dev/contents/<PR>/<이름>.png --input test-results/evidence-<PR>-<이름>.json
   ```
   링크: `https://github.com/IBORY-PURPLE/Lighthouse_Dev/blob/evidence/<PR>/<이름>.png`
6. Codex(저장소 루트): 프롬프트를 먼저 파일 `test-results/codex-prompt-<PR>.md`에 쓰고 `codex exec -s workspace-write -o test-results/codex-<PR>.md "$(cat test-results/codex-prompt-<PR>.md)"`로 넘긴다(명령 글에 프롬프트 본문이 들어가지 않는다. 훅은 따옴표 안 글에서도 `.env` 이름을 찾아 막는다(`guard.js:170`). `gh pr merge` 검사는 따옴표를 지운 명령 본문에만 적용된다(`guard.js:162-166, 183`)라 따옴표 안 글자는 걸리지 않지만, 안전하게 프롬프트 본문은 파일로 넘긴다). 프롬프트에는 PR 번호, 그 블록의 "합격 기준(Codex용)" 문단 그대로, 기록 파일 경로 목록, 바꾼 기존 시험 목록(3.2 "시험 변경"), 그리고 "시험을 실행하지 마세요. 기록 파일과 코드를 읽고 합격 기준대로 판정하세요. 기록의 커밋 해시가 현재 HEAD와 다르거나 기록이 없는 항목은 판정 불가로 적으세요. 코드를 고치거나 커밋하지 마세요."만 넣는다. Claude의 결론은 넣지 않는다. 예방 조치로 합격 기준 문단·커밋 메시지·PR 본문에 `.env`와 `gh pr merge` 글자를 쓰지 않는다. 결과는 `gh pr comment <PR> --body-file test-results/codex-<PR>.md`(PR 본문·댓글은 항상 `--body-file`). Bugbot은 보지 않는다(`.claude/rules/pr-flow.md` "코드 리뷰 도구").
7. 판정은 `.claude/rules/pr-flow.md` "Codex 검증" 판정 기준(기능 오작동·합격 기준 미달·보안 문제 0건이면 `통과`)대로. 데이터 손실 지적은 보안 문제로 센다. 심각한 지적은 고치고 다시 푸시·기록·재판정하며 실패 1회로 센다. 같은 지적 3회면 멈춤. 사소한 지적은 PR에 남긴다.
8. 병합(`.claude/rules/pr-flow.md` "병합" 표). **블록 0의 "훅 수정 허락"으로 갈린다.**
   - 허락돼 사람이 훅을 고쳐 `stage/demo<N>` base가 허용되고, 실패 0·Codex 첫 판정 통과·보류 위에 쌓이지 않음 → `gh pr merge <PR> --squash`. **훅은 체크아웃된 작업 트리의 `.claude/hooks/guard.js`로 실행되므로**(`.claude/settings.json:7` `$CLAUDE_PROJECT_DIR/.claude/hooks/guard.js`) 병합 명령은 고친 훅이 들어 있는 브랜치에서 실행한다. **기본 경로**: `git fetch github && git checkout github/main`(detached)에서 병합 명령을 실행하고 끝나면 원래 브랜치로 돌아온다(`git checkout -`). 블록 0 할 일 2가 훅 PR 병합 뒤 `stage/demo4`(`--ff-only`)와 자기 커밋이 있는 `feat/demo4/experiment`·`docs/overnight-1109`(`git merge --no-edit github/main`, 병합 커밋)에 `github/main`을 넣어 두지만, 그 브랜치에서 실행하는 것은 대안이다. 병합되면 `git fetch github`로 `stage/demo<N>` 끝을 갱신한다.
   - 그 외(허락 없음, 훅 미수정, 실패 이력, Codex 미통과, 쌓임, PC의 `gh pr view` 실패) → `gh pr edit <PR> --add-label hold-morning`(GraphQL 불가면 2의 REST 라벨 명령). 본문 7항 판정은 `pr-flow.md` "PR 본문"의 두 값만 쓴다: `보류(이유: AI 병합 조건 충족, 훅 guard.js:158 차단으로 사람 병합)` 또는 `보류(이유: 실패 1회 …)`. 보고 PR 표에서는 전자를 `조건 충족·훅 차단`으로 구분한다(블록 6 보고 3). 훅을 우회해(`gh api …/merge`) 병합하지 않는다.
9. 단계 PR(`stage/demo<N>` → main): 그 단계의 기능 PR이 모두 AI 병합됐을 때만 `gh pr create --base main --head stage/demo<N> --title "stage/demo<N>" --body-file …`을 열고, `stage/demo<N>`에서 `check`·`test:e2e`를 한 번 더 돌려 기록한 뒤 표대로 병합하거나 `hold-morning`. **단계 PR 열기와 단계 전체 시험은 기본적으로 블록 6 할 일 1이 한다.** 기능 블록은 작업 멈춤 시각까지 20분 이상 남을 때만 이 블록에서 한다(`test:e2e` 1회가 빌드 포함 4~7분이라 검증 15분 안에 두 번째 전체 시험이 들어가지 않는다. 11/4 progress.md:112). 훅 미수정이면 단계 PR은 밤에 열지 않는다(기능 PR이 단계 브랜치에 들어가지 않아 뜻이 없다).

### 3.4 배포 (블록 2·4·6. 블록 5는 배포하지 않는다)

- `cd apps/web && vercel deploy --prod --yes`. `lighthouse-web`에만. 저장소 루트에서 배포하지 않는다. 프로젝트 설정·환경 변수는 건드리지 않는다.
- 검사·시험을 통과한 최신 브랜치를 배포한다. 보류 PR이어도 된다. 배포 출력의 배포 이름과 커밋을 메모에 적는다.
- 배포 뒤 쿠키 값을 넣은 `curl`은 쓰지 않는다. `BASE_URL=https://lighthouse-web-five.vercel.app npm run test:public -- -g "접근 코드와 health|첫 화면"`으로 health를 본다(Groq 호출 없음). 전체 `test:public`은 실행마다 Groq 1회 + (블록 2 이후) 엔진 호출 조각 수만큼 든다. 돌리기 전에 누계를 본다(3.6 돈).

### 3.5 끝과 블록 이어 달리기

진행 기록과 아침 보고는 **밤 전용 문서 브랜치 `docs/overnight-1109` 하나**에만 append한다. 기능 브랜치에는 넣지 않는다. 이유: 11/4에 `progress.md`를 기능 브랜치에 넣어 통합 때 충돌했고(11/4 morning-report.md:59), 이번 밤은 단계가 셋이라 충돌 지점이 더 많다. 이름은 `.claude/rules/pr-flow.md` "문서 브랜치"의 `docs/<이름>`(단계 무관) 꼴이다. 블록 0이 `github/main`에서 만든다(문서 PR이 main에 없으면 블록 0 할 일 5의 순서대로). `results-vision.md`는 블록 1 PR 브랜치에 둔다(Codex가 작업 폴더에서 읽어야 하므로, 블록 1 참고).

**부모(현재 블록)와 자식(다음 블록) 세션은 같은 PC의 같은 작업 트리를 쓴다.** 자식이 3.1의 3~4로 브랜치를 바꾼 뒤 부모가 progress.md를 고치면 그 파일이 자식의 기능 브랜치에 untracked로 생겨 거기에 커밋된다(훅은 main이 아니면 막지 않는다. `guard.js:92-124`). 11/4의 충돌이 그대로 재현된다. 그래서 **부모는 6에서 자식을 띄운 순간부터 종료까지 git 명령을 쓰지 않는다**(7의 실패 기록 한 경우만 예외).

1. 기능 브랜치의 작업이 모두 커밋·푸시됐는지 `git status --short`로 본다(기록 파일·작업 메모는 무시 목록이라 보이지 않는다).
2. `git checkout docs/overnight-1109 && git pull --ff-only github docs/overnight-1109`
3. `docs/plans/2026-11-09-overnight/progress.md`에 `.claude/rules/overnight-loop.md` "진행 기록 형식"으로 항목 하나를 **추가**한다(앞 항목은 고치지 않는다). 작업 메모의 실제 시작·끝 시각, PR 번호·라벨, 실패 목록, 실패로 세지 않은 것, 검증 줄(명령별 종료 코드·개수·axe·Codex 판정·스크린샷 링크 여부·패턴 검사 0건), 배포, 결정을 옮긴다. 마지막 줄은 `.claude/rules/overnight-loop.md` 형식 그대로 `토큰: 실제 입력/출력 또는 '미측정', 예상 대비 %`(이 밤은 예상을 적지 않았으므로 `예상 대비 미측정`). 추가로 적는 줄: `시작 HH:MM <방법>`(3.1의 2), `호출: luna N장(누계 N/500), Upstage N장(누계 N/500), Groq qwen N회(누계 N), Groq gpt-oss N회(누계 N/200)`(luna·Upstage는 조각 1장 = 호출 1회, 3.6 돈), **`다음 블록: M`**(필수. 블록 1~3은 N+1, 블록 4 항목은 이 항목을 쓰는 시각 t에서 **T = t + 10분(3.5 완료 예상)**으로 잡아 `06:50 − T ≥ 60분`이면 5, 아니면 6을(3.6), 블록 6 항목은 `없음`을 적는다. **단, 이 항목을 쓰는 시각이 06:50(블록 4·5 작업 멈춤)을 넘겼으면 어느 블록이든 `다음 블록: 6`**. 안전망이 이 줄을 읽는다), `시작 브랜치 분기 근거`, 블록 1은 `결과표 위치: <브랜치>`(AI 병합됐으면 `stage/demo4`, 보류면 `feat/demo4/experiment`. 병합되면 head 브랜치가 지워진다, 2절 `delete_branch_on_merge`). 그리고 **모든 항목에 고정 줄 4개를 블록 0 기록 그대로 옮겨 적는다**. 라벨 글자는 여기서 확정하며 다른 절·블록 0 기록·블록 6은 이 글자를 그대로 쓴다: `이어 달리기 명령: <블록 0 그대로>`, `훅 수정 허락: 예|아니오`, `db push 허락: 예|아니오`, `통합 배포 푸시 허락: 예|아니오`(다음 세션은 마지막 항목만 읽기 때문이다. 0절 3).
4. `git add docs/plans/2026-11-09-overnight/progress.md && git commit -m "docs: 11/9 밤 블록 N 진행 기록" && git push github docs/overnight-1109`. 푸시 직후 `date > test-results/overnight-1109/block-<N>.finished`를 만든다(안전망이 "이 블록은 3.5를 끝냈다"를 이 파일로 본다).
5. `bd close <id> --reason "…"`(있을 때). 후속 일은 `bd create`(없으면 progress.md "다음 할 일").
6. **다음 블록 M(3의 `다음 블록:` 줄) 세션을 시작한다.** 먼저 `ls test-results/overnight-1109/`에 `block-<M>.started`가 **이미 있으면**(안전망이 먼저 띄움) 시작하지 않고 8로 간다. 없으면 progress.md 항목 끝에 `다음 블록 시작 시도 HH:MM <방법>` 줄을 **자식을 띄우기 전에** 추가 커밋·푸시한다(4와 같은 명령. 고정 줄 4개가 항목 끝이 아니게 되므로 다음 세션은 라벨로 찾는다, 0절 3). 그다음 **자식을 띄우기 직전에 `date > test-results/overnight-1109/block-<M>.started`를 부모가 직접 만든다**(안전망과 같은 규칙. 자식이 읽기를 끝내기 전에 안전망이 깨어나 같은 블록을 또 띄우는 것을 막는다). 방법은 progress.md의 `이어 달리기 명령:` 줄(블록 0 기록 그대로)을 쓴다(이 파일은 방법을 확정하지 않는다. 2절 미확인). 넘기는 프롬프트의 첫 문장은 `먼저 echo "시작 $(date +%H:%M) 앞 블록 직접 시작" >> test-results/overnight-1109/block-<M>.started 를 실행한 뒤 읽기 시작한다.`이고 이어서 `LightHouse 11/9 밤샘 블록 <M>. CLAUDE.md, docs/plans/2026-11-09-overnight/ai.md의 0~3절과 4절 블록 <M>, progress.md 마지막 항목(브랜치 docs/overnight-1109)을 읽고 시작한다.` 프롬프트는 파일 `test-results/overnight-1109/block-<M>-prompt.txt`에 써 두고 스폰 명령에는 파일 경로나 `"$(cat …)"`로 넣는다(블록 0 할 일 6의 주의). 블록 4 뒤는 3.6의 조건으로 5 또는 6을 고른다(이미 3에서 적었다). 블록 6은 다음을 시작하지 않고 안전망을 해제한다. **이 순간부터 git 명령 금지**(머리 문단).
7. 자식이 `block-<M>.started`에 자식 줄(`시작 HH:MM`)을 덧붙일 때까지 **최대 10분** 기다린다(`cat test-results/overnight-1109/block-<M>.started`만. 자식은 읽기 전에 첫 명령으로 덧붙이므로 보통 1분 안이다. git은 쓰지 않는다). 안 생기면 `.started`를 지우고 같은 명령으로 **한 번만** 더 띄우고(지우고 다시 만든다) 10분 더 기다린다. 그래도 없으면(자식이 뜨지 않아 작업 트리가 그대로이므로 안전하다) `.started`를 지우고 progress.md 항목 끝에 `다음 블록 시작 실패 HH:MM`을 한 줄 추가 커밋·푸시한다(안전망이 본다). 성공 기록은 부모가 적지 않는다. 자식이 3.1의 2에서 `시작 HH:MM <방법>`을 자기 항목에 넣는다. **06:50 이후에 하는 3.5(블록 4 또는 5)에서는 이 대기·재시도를 합쳐 15분으로 줄여 07:05 전에 종료한다.** 못 띄우면 같은 `다음 블록 시작 실패 HH:MM` 줄을 남기고 종료하며 07:15 안전망 규칙(아래)이 잇는다.
8. 종료. 작업 멈춤 시각에 미완료여도 1~7을 한다(`.claude/rules/success-criteria.md` "막혔을 때"). 원인·시도·다음 할 일을 적는다.

안전망(블록 0이 걸어 둔다, 방법 미확인): 약 30분마다 `git fetch github && git show github/docs/overnight-1109:docs/plans/2026-11-09-overnight/progress.md | tail -60`으로 마지막 항목의 **`다음 블록: M` 줄**을 읽는다(블록 번호 +1이 아니다. 블록 4 뒤는 5 또는 6이라 +1이 틀릴 수 있다). 판단은 블록 0 종료 시각부터 08:00까지의 밤 창 안에서 하고, 자정을 넘기는 시각 비교는 날짜를 붙여 센다(23:40은 06:50 "전"이 아니라 밤 창 밖이다. 00:00 전에는 아무것도 하지 않는다). 판단 순서:
- `다음 블록: 없음`이거나 마지막 항목에 `다음 블록` 줄이 없으면 아무것도 하지 않는다.
- `test-results/overnight-1109/block-<M>.started`가 없고 지금이 06:50 전이면(M이 6이면 08:00 전이면) `.started`를 먼저 만들고(중복 방지) 블록 M 세션을 시작한다(프롬프트는 3.5의 6과 같되 방법은 `안전망`).
- `.started`가 있고 자식 줄(`시작 HH:MM`)이 있으면 시작된 것이다. 자식 줄이 없어도 파일이 **10분 이내**면 시작 중으로 보고 아무것도 하지 않는다. 자식 줄 없이 10분이 지났고 마지막 항목에 `다음 블록 시작 실패` 줄이 있으면(부모가 포기하고 종료했다) `.started`를 지우고 다시 띄운다. 실패 줄이 없으면 부모가 재시도 중일 수 있으니 다음 주기에 다시 본다.
- 자식 줄이 있는데 블록 M의 progress.md 항목이 없고 지금이 블록 M의 표 상한 + 15분을 지났으면 세션이 죽은 것으로 본다(human.md:40 "마지막 블록 세션 상태"). 작업 트리 충돌 위험이 있으므로 새 세션을 띄우지 않고(블록 0에서 세션 생존 확인 방법이 확인됐을 때만 띄운다) progress.md 대신 `test-results/overnight-1109/watchdog.log`에 `블록 M 응답 없음 HH:MM`을 적는다. 블록 6 규칙은 그대로다.
- **07:15 이후**: 마지막으로 시작된 블록의 `block-<N>.finished`가 있고 `block-6.started`가 없을 때만 블록 6을 시작한다(06:50에 멈춘 블록이 3.5를 끝냈다는 표시). `.finished`가 없으면 10분 뒤 다시 본다(07:45까지). 07:45에도 없으면 블록 6을 시작하되 프롬프트 첫 줄에 `앞 블록 미종료 가능성, git status 먼저 확인`을 넣는다(같은 작업 트리 충돌 위험을 자식이 안다). 08:00 이후에는 아무것도 하지 않는다.

### 3.6 시간 규칙과 토큰

**시간**(human.md:23, 37-41). 표의 시각은 모든 블록이 배정 시간을 다 썼을 때의 상한이고, 3.5까지 마치는 시각이다.

- 각 블록의 끝 상한 = min(실제 시작 + 배정, 표 상한). 작업 멈춤 = 끝 상한 − 10분. 앞 블록이 일찍 끝나면 다음 블록을 바로 시작한다.
- 배정 합계는 블록 1~4가 120+150+70+110 = 450분(7시간 30분)으로 00:00~07:00(7시간)보다 30분 길다. human.md도 "8시간을 넘는다, 넘치면 버리는 순서대로 줄인다"고 적었다(human.md:139, 100, 88). 그래서 블록 4의 배정 110분은 앞 블록들이 합쳐서 30분 이상 일찍 끝날 때만 다 쓸 수 있다. 11/4 기능 블록이 실제 25~35분이었으므로(human.md:83) 가능성은 있지만 약속이 아니다. 블록 4는 시작 때 남은 시간 R로 포기 순서를 먼저 적용한다(4절 블록 4 "시작 때 시간 산수". 포기 순서는 human.md:88의 두 단계뿐이고 Supabase 구현은 빼지 않는다).
- **3.5(기록·커밋·푸시·자식 시작, 약 10분)는 배정 안의 마지막 10분이다.** 배정 = 구현 + 검증 15 + 끝 10. 표의 상한은 3.5까지 마치는 시각이고, **작업 멈춤 시각 = 상한 − 10분**이다. 각 블록은 작업 멈춤 시각에 작업을 멈추고 3.5를 한다. 그래서 **블록 4·5의 표 상한은 07:00, 작업 멈춤은 06:50**이고, 07:00에 블록 6이 시작된다(4절 표). 블록 4의 R도 06:50(작업 멈춤) 기준이다.
- **06:35 동결**: 블록 4·5는 06:35 이후 새 파일·새 시험을 시작하지 않고 커밋·기록·PR만 한다(06:50 작업 멈춤까지 15분).
- 블록 5(③)는 블록 4가 3.5의 3(progress.md 항목)을 쓰는 시각 t에서 **T = t + 10분(3.5 완료 예상)**으로 잡고 `06:50 − T ≥ 60분`(human.md:139 "1시간 넘게"를 블록 5의 작업 멈춤 06:50 기준으로 센다)일 때만 시작한다(`다음 블록: 5`). 블록 5의 끝 상한은 `min(T + 60분, 07:00)`, 작업 멈춤은 그 10분 전이다. 배정 60분은 구현 35 + 검증 15 + 끝 10이다(human.md:128 "약 1시간"). 아니면 건너뛰고 progress.md에 "블록 5 건너뜀(남은 N분)"과 `다음 블록: 6`을 적고 블록 6으로 간다.
- 블록 6은 늦어도 07:00에 시작한다. 06:50에 진행 중인 블록은 그 자리에서 작업을 멈추고 3.5를 한 뒤 블록 6을 시작한다. **블록 6은 min 규칙의 예외로 끝 상한이 항상 08:00이다**(보고가 최우선. 일찍 시작하면 남는 시간을 통합·재완주에 쓴다). 08:00 종료는 지킨다.
- 작업 멈춤 시각을 넘기면 멈춘다(`.claude/rules/success-criteria.md` "막혔을 때"의 블록 끝 시각이 이것이다). 미완료여도 3.5를 한다.

**토큰**: human.md:57은 11/4 토큰을 재지 못해 숫자를 내지 않았다. 이 파일도 블록별 토큰 예상을 적지 않는다. 시간 기준만 적용하고 progress.md에 `미측정`(잴 수 있으면 실제 값)으로 적는다(`.claude/rules/overnight-loop.md` "시간과 토큰"). 사용량 한도에 걸리면 기록하고 멈춘다.

**돈**(human.md:142): luna·Upstage는 엔진당 **조각(API 호출) 500장 이하** = 상품 50개분(상품 1개 ≈ 조각 10장) ≈ 최대 약 2천 원. 단위 해석 근거: human.md:142의 산수(50 × 37원 ≈ 2천 원)는 1번 = 상품 1개(조각 10장)일 때만 맞는다. human.md:58의 "모델당 50회"는 폐기된 정해 줄 것 1의 문장이다(1.5의 1). 아침에 사람이 더 낮추면 상수와 `--budget`만 바꾼다. 실험 서버가 상수 `MAX_PAID_CALLS_PER_ENGINE = 500`에서 코드로 거부한다. **코드 거부는 블록 1 실험 서버 한 번 실행 안에서만 유효하다.** 카운터는 서버 메모리라 재시작하면 0이 되므로 `run.mjs`가 `--budget`를 직전 결과 JSON(`test-results/vision/*.json`)의 누계로 이어 받고, 재시작 때는 `--budget`에서 직전 누계를 뺀 값을 준다. 블록 2·6의 공개 완주는 Next 앱(`extract.ts`, Vercel)이 호출하므로 코드 카운터가 없고(분당 60회 제한뿐) progress.md 수기 누계로만 센다: `test:public` 출력의 조각 수를 누계에 더하고, 돌리기 전에 `누계 + 예상 조각 수 ≤ 500`을 확인한다. 공개 완주 2회분(블록 2·6, 조각 약 100장) 몫을 미리 빼서 **블록 1 실험은 엔진당 조각 400장**까지 쓴다(실행기 `--budget 400`). 블록 6 재완주는 누계가 남을 때만 ④ 사례를 포함하고, 모자라면 `-g`로 뺀다(블록 6 할 일 3). 500장에 닿으면 그 엔진의 실제 호출을 멈추고 가짜 응답으로 계속한다. Groq는 무료 범위로 보되 호출 수를 센다(`gpt-oss-120b` 누계 200 상한은 11/4 기준 유지. 429는 6절 Groq 429 행대로). OpenAI 크레딧 소모도 예산으로 센다. 콘솔의 결제·요금제 화면은 열지 않는다.

### 3.7 비밀·키·원본 이미지가 어디에도 남지 않게 하는 장치

| 대상 | 장치 | 확인 |
|---|---|---|
| 키 값(`GROQ_API_KEY`, `OPENAI_API_KEY`, `UPSTAGE_API_KEY`, Supabase 키) | `.env*`는 열지 않는다(훅 차단, `node -e` 안의 `.env` 이름도 차단). 존재 확인은 실험 서버 `/api/status`의 불리언과 `vercel env ls`(이름만)로만 | 명령 출력에 `true/false`와 이름만 나온다 |
| 기록 파일(`test-results/*.txt`, `codex-*.md`, PR 본문, progress.md, results-vision.md) | 커밋·Codex 전에 3.3의 4 패턴 검사 → 0건 | 0건을 PR 본문 "검증" 줄에 적는다 |
| 접근 코드·시연 주소 | 루트 `.demo-access.local`(git 제외, 두 줄)에만. 보고에는 파일 위치만. 값은 `grep -f <(head -1 …)`로만 쓴다 | `git status --short`에 없음 |
| 실험용 캡처·정답 메모·공개 완주용 캡처 | 저장소 루트 `test-results/vision-samples/<상품>/{이미지, answer.md}`, `test-results/vision-samples/public/sample.jpg`에만 둔다. `test-results/`는 `.gitignore`와 `apps/web/.vercelignore`에 있고 `apps/web` 밖이라 배포 업로드에도 들어가지 않는다(human.md:45). 저장소·evidence 브랜치·Vercel에 올리지 않는다 | `git status`, PR diff에 이미지 파일 0개, `git ls-files test-results` 비어 있음 |
| 실험 원문 출력(모델이 읽은 글자) | 루트 `test-results/vision/<시각>-<상품>-<방법>-<엔진>.json`(git 제외, `run.mjs`가 쓴다)에만. `results-vision.md`에는 채점·시간·호출 수·비고만 넣고 읽은 글자 원문과 이미지는 넣지 않는다 | 결과표 diff 확인 |
| 스크린샷 | ④ 화면(블록 1·2)은 합성 이미지(`index.html` "예시 이미지 만들기"와 e2e 합성 이미지)로 만든 화면만 올리고 파일 이름에 `synthetic`을 넣는다. 실제 캡처가 보이는 화면은 올리지 않는다. 이용자 화면(블록 3·4)은 캡처가 보이지 않으므로 그대로 올린다 | ④ evidence 파일 이름에 `synthetic` |
| 서버 쪽 원본·원문 | `extract-text`·`summarize`는 이미지를 엔진에 넘긴 뒤 버린다(TSD:356). 파일 쓰기·Storage·DB 저장 코드를 넣지 않는다. 로그는 상태 코드·소요 시간·조각 번호만(TSD:229) | C10 grep 0건, Codex 확인 |
| 이용자 답 원문 | `requests` 표에는 저장한다(설계). 로그에는 남기지 않는다. 이름·연락처는 받지 않는다 | 라우트 시험 "로그에 답 없음"(notes C6) |
| 실험 코드 배포 | `apps/web/.vercelignore`에 `experiments` 줄을 더한다(블록 1 PR, CLAUDE.md:15 "배포하지 않음") | 배포 출력, `vercel inspect` |
| 외부 발송·결제 | 하지 않는다 | `.claude/rules/overnight-loop.md` "금지선" |

## 4. 단계별 작업

### 블록 한눈에 보기

| 블록 | 표의 상한(3.5까지 마치는 시각. 작업 멈춤 = 상한 − 10분, 3.6) | 배정(구현 + 검증 15 + 끝 10) | 브랜치(base) | 내용 | 앞 블록 의존 |
|---|---|---|---|---|---|
| 0 | 자기 전 | AI 약 50분(점검 25 + 훅 패치·PR 10(허락 시) + 이어 달리기 시험 15), 사람 약 60분 + 추가 약 15분(블록 0 "예상") | `docs/overnight-1109` ← `github/main`(PR 없음), `stage/demo4`·`feat/demo4/experiment`(키 플래그 1커밋, PR은 블록 1) | 키 존재 확인, 캡처·정답 메모 수령, 검사 기준선, 이어 달리기 방법 시험·안전망, 세 가지 허락 확인, progress.md 블록 0 항목(낮 문서 세션 항목 뒤) | - |
| 1 | 00:00~02:00(작업 멈춤 01:50) | 120(구현 95 + 검증 15 + 끝 10) | `feat/demo4/experiment` ← `stage/demo4` ← `github/main` | 비전 실험: luna·Upstage·요약 단계 추가, 실행기, 통째/타일 × 엔진, `results-vision.md`, 입문 메모 초안 | 0(키, 캡처) |
| 2 | 02:00~04:30(작업 멈춤 04:20) | 150(구현 125 + 검증 15 + 끝 10) | `feat/demo4/upload-summary` ← `stage/demo4`(1의 코드에 의존하지 않음, 아래) | ④ 올리기 → 자르기 → extract-text → summarize → 항목별 값+근거, 입력창 대체, 공개 완주 1회 | 1(결과표의 1위 엔진, 데이터만) |
| 3 | 04:30~05:40(작업 멈춤 05:30) | 70(구현 45 + 검증 15 + 끝 10) | `feat/demo1/questions` ← `stage/demo1` ← `github/main` | 플로우 A PR 1 질문 3개(notes C1~C3, C5, C6) | 없음 |
| 4 | 05:40~07:00(작업 멈춤 06:50, 동결 06:35) | 110(구현 85 + 검증 15 + 끝 10. 3.6) | `feat/demo2/queue` ← `stage/demo2` ← `github/main`(3이 main에 없으면 블록 4 분기 표) | 플로우 A PR 2 대기열 접수(Supabase), 공개 완주, 지연 측정 | 3(코드) |
| 5 | 조건부(표 상한 07:00, 작업 멈춤 06:50) | 블록 4의 3.5 완료 예상 T(항목 작성 시각 + 10분)에서 06:50까지 60분 이상 남을 때만(3.6). 60(구현 35 + 검증 15 + 끝 10) | `feat/demo3/search-advice` ← `stage/demo3` ← `github/main` | ③ 당겨 시작(결정 10). `volunteer/page.tsx` 안 고침. 배포 없음 | 없음 |
| 6 | 07:00~08:00(늦어도 07:00 시작. min 규칙의 예외, 끝 상한 항상 08:00) | 60 | `docs/overnight-1109` | 마무리: 통합 배포(25분 상한), 재완주, 단계 PR 정리(남은 시간), `morning-report.md`, 안전망 해제 | 1~5 |

- 블록 사이는 **순차**다. 각 블록은 새 세션이다(`.claude/rules/overnight-loop.md` "세션").
- 블록 2가 블록 1에 "쌓이지 않는" 이유: 블록 1은 `apps/web/experiments/vision/`, `apps/web/package.json`(`openai`를 `dependencies`에), `apps/web/.vercelignore`, `docs/plans/…/results-vision.md`, `CLAUDE.md` 한 줄만 바꾸고 **`apps/web/src`·`tests`를 건드리지 않는다**(블록 1 "할 일" 2). 그래서 블록 2는 실험 PR이 보류여도 `stage/demo4` 끝에서 시작한다(`.claude/rules/pr-flow.md` "보류 PR 위에 쌓기": 의존하지 않으면 단계 브랜치 끝). 블록 1이 이 규칙을 어겼다고 progress.md에 적혀 있을 때만 블록 2는 `feat/demo4/experiment`에서 따고 base를 그 브랜치로 둔다. `package.json`의 `openai` 의존성은 블록 2가 **같은 섹션(`dependencies`)·같은 버전**으로 다시 추가한다(블록 2 `extract.ts`가 서버에서 쓰므로 devDependency가 아니다). 그래도 `package-lock.json`은 블록 1·2·4(`@supabase/supabase-js`)가 모두 고치므로 통합 때 충돌이 거의 확실하고 `npm install`로 재생성해야 한다(블록 6 할 일 2).

---

### 블록 0. 사전 점검 (자기 전, AI 약 50분 + 사람 약 60분 + 추가 약 15분)

human.md:24, 39-42, 125. 사람이 깨어 있는 유일한 블록이다. 밤에 물을 수 없는 것을 여기서 모두 묻는다. 사람이 캡처·정답 메모를 두고 OpenAI 키(선택 Upstage)를 등록한 **뒤** 시작한다.

- **입력**: human.md 5절 "자기 전" 표의 사람 준비 완료 여부.
- **읽을 TSD**: §5(TSD:140-155), §11(TSD:430-438).
- **할 일**
  1. 점검(약 25분, 값은 출력하지 않고 있음/없음만). 결과를 표로 progress.md 블록 0 항목에 적는다. `npm ci`·`playwright install`은 사람이 캡처를 준비하는 동안 먼저 돌린다.
     - 셸·원격·브랜치: 셸 종류. `git remote -v`에 `github`가 있다(없으면 **사람에게** 알리고 사람이 추가한다. AI가 PC의 git 설정을 바꾸지 않는다). `git fetch github && git log github/main -1 --oneline`. `git log github/main -1 -- docs/plans/2026-11-09-overnight/ai.md`가 비어 있으면 ai.md가 main에 없는 것이다(2026-11-09 기준 `github/main`의 계획 폴더에는 `tsd-review.md`만 있다) → 사람이 자기 전에 문서 PR을 병합한다(5절). 병합되지 않았으면 할 일 5의 사본 커밋(ai.md·human.md·notes-flow-a.md·research-vision.md·progress.md 모두)이 필수다. `stage/*`가 원격에 없음을 확인한다. `CLAUDE.md` 지도에 `experiments/vision` 줄이 `github/main`에 있는지(`git show github/main:CLAUDE.md | grep -c experiments/vision`).
     - 로그인·도구: `gh auth status`, `gh pr list --state all --limit 1`(GraphQL 가용 여부. 실패하면 "gh GraphQL 불가"로 기록하고 이후 PR 조회는 `gh api`, PR 열기·라벨·댓글은 3.3의 2의 REST 명령으로. 그 명령 형식을 여기서 1회 확인해 기록한다(`gh api --help`의 `-f`·`-F key=@파일` 설명으로. 실제 PR·라벨·댓글은 만들지 않는다)), `gh label list | grep hold-morning`(GraphQL이라 실패할 수 있다. 실패하면 `gh api repos/IBORY-PURPLE/Lighthouse_Dev/labels --jq ".[].name"`), `vercel whoami`, `codex --help`(로그인 확인 명령은 미확인), `supabase --version`과 `supabase projects list`(비밀번호 없이 로그인만 확인. `migration list --linked`는 저장소에 `supabase/`가 없어 쓰지 않는다), `supabase init --help`·`supabase link --help`(비대화형 플래그가 있는지. 블록 4가 무인으로 돌리므로 TTY 질문을 끄는 플래그 이름을 기록한다), `bd --version`. `ls apps/web/.vercel`(링크 존재).
     - 검사 기준선: `cd apps/web && npm ci && npm run check`(HEAD에서 통과하는지, `eslint .`이 `experiments/`를 검사하는지). 실패면 실패로 세지 않고(코드를 고치기 전) 원인만 기록한다. `npx playwright install webkit`(e2e는 iPhone 15 = WebKit, 11/4에 WebKit으로 통과. 이미 있으면 바로 끝난다. chromium은 설치하지 않는다).
     - **키 존재**(human.md:24 "자기 전에 실험 프로그램에서 키가 보이는지 확인"): `git checkout -b stage/demo4 github/main && git push github stage/demo4 && git checkout -b feat/demo4/experiment`. `server.mjs`에 두 가지를 고쳐 1커밋: ① `/api/status`에 `openaiKeyConfigured: !!process.env.OPENAI_API_KEY`, `upstageKeyConfigured: !!process.env.UPSTAGE_API_KEY` 추가, ② env 파일 읽기 조건(`server.mjs:14-25`, 지금은 `GROQ_API_KEY`가 비어 있을 때만 읽어서 셸에 GROQ 키가 있거나 두 키가 다른 파일에 있으면 OpenAI·Upstage 플래그가 거짓으로 false가 된다)을 두 파일을 조건 없이 차례로 `loadEnvFile`하도록 바꾼다(`loadEnvFile`은 이미 있는 변수를 덮지 않는다. 값은 출력하지 않는다). `git add apps/web/experiments/vision/server.mjs && git commit -m "experiment: /api/status 키 플래그·env 읽기" && git push github feat/demo4/experiment`(PR은 블록 1이 연다. 커밋 없이 푸시하면 `stage/demo4`와 같은 커밋이 올라가고 수정이 작업 트리에 남아 할 일 5의 브랜치까지 따라간다). `cd apps/web && node experiments/vision/server.mjs &`(또는 루트에서 `node apps/web/experiments/vision/server.mjs &`. `server.mjs:2` "apps/web 에서") → `curl -s http://127.0.0.1:4310/api/status`로 세 불리언을 본다. 세 불리언이 모두 false면 사람에게 키 파일 이름을 되묻는다(2절 미확인: `apps/web/.env.local`·`apps/web/.env`·루트 `.env` 중 어디인지 저장소에 근거가 없다. 사람이 안다). 서버는 끝나면 종료한다. Vercel 쪽은 `cd apps/web && vercel env ls`에서 `OPENAI_API_KEY`, `UPSTAGE_API_KEY`, `GROQ_API_KEY`, `DEMO_ACCESS_CODE`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` **이름**과 target(production, preview)을 본다. `.env` 파일은 열지 않는다(훅 차단, 2절).
     - 캡처·정답 메모: 사람이 저장소 루트 `test-results/vision-samples/<상품>/`에 이미지 파일과 `answer.md`(상품명·모델명, 옵션, 핵심 사양 3~5개, 구성품, 주의사항, 가격(채점용). 없는 항목은 `없음`)를 두고, 공개 완주용 캡처 1장을 `test-results/vision-samples/public/sample.jpg`에 둔다. 확인: `ls test-results/vision-samples/*/answer.md | wc -l` ≥ 3, 각 폴더에 이미지 1장 이상(이미지는 열지 않는다). 이름·주소가 보이는 화면이 없는지는 사람이 보증한다(human.md:24). 폴더는 `.gitignore`의 `test-results/` 아래라 `git status`에 보이지 않는다.
     - 접근 코드 파일: `test -f .demo-access.local && wc -l < .demo-access.local` → 2(열지 않는다).
  2. **훅 수정 허락**을 묻는다. 2절 사실대로 `guard.js:158`은 base가 `main`이 아닌 PR의 `gh pr merge`를 막아 `pr-flow.md` "병합" 표의 "기능 PR을 AI가 단계 브랜치에 squash 병합"이 불가능하고, `guard.js:198`은 AI가 훅 파일을 편집하는 것도 막는다. 사람이 **명시적으로 허락하면**: AI가 바꿀 내용(`checkMerge`가 base `^stage/demo[0-9]+$`도 허용, `guard.test.js`에 stage base ALLOW·`hold-morning` BLOCK·다른 base BLOCK 케이스)을 `test-results/guard-patch.diff`로 써 두고 **사람이 직접 편집한다**(AI는 Bash로 `.claude/hooks`를 쓰지 않는다. 우회다). `checkMerge`는 실제 `gh pr view`를 실행하므로(`guard.js:154`) 네트워크 없이 도는 지금 시험(`guard.test.js:3`)에 그대로 넣을 수 없다. 새 케이스는 임시 PATH에 가짜 `gh` 스크립트(`pr view` 인자에 따라 `baseRefName`·`labels` JSON을 출력)를 두고 돌리는 방식으로 쓴다. 가짜 `gh`를 만들지 못하면 기존 `--squash` 없음 BLOCK(`guard.test.js:125`)만 유지하고 stage base 허용은 사람이 실제 PR에서 1회 확인한다. AI는 `node .claude/hooks/guard.test.js` 통과를 확인하고 브랜치 `chore/guard-stage-merge`(`github/main`에서, 선례 `chore/beads-setup`)로 커밋·푸시·PR(base main)을 열며 사람이 자기 전에 병합한다. 훅 PR이 병합되면 `git fetch github` 뒤 자기 커밋이 없는 `stage/demo4`는 `git merge --ff-only github/main`, 자기 커밋이 있는 `feat/demo4/experiment`(할 일 1의 플래그 커밋)·`docs/overnight-1109`(할 일 5의 progress.md 커밋)는 `git merge --no-edit github/main`(병합 커밋. `--ff-only`는 "Not possible to fast-forward"로 실패한다. rebase·강제 푸시 금지)으로 넣고 각각 `git push github <브랜치>`한다(훅은 체크아웃된 작업 트리의 파일로 실행되므로, 옛 guard.js가 남은 브랜치에서는 `gh pr merge`가 여전히 막힌다. 기본 경로는 detached `github/main`에서 실행, 3.3의 8). 허락이 없으면 고치지 않고 "훅 미수정 → 모든 기능 PR hold-morning, 단계 PR 없음"으로 기록한다. progress.md 블록 0 항목에 `훅 수정 허락: 예/아니오`. 이 항목은 사람이 직접 편집·시험·병합하므로 사람 시간 약 10분이 더 든다(human.md에 없는 추가 시간. 먼저 알린다).
  3. **db push 허락**을 묻는다. human.md:86은 "표 만들기는 AI가 Supabase CLI로 한다"이고 docs/human_tsd.md:31·TSD:434는 원격 적용을 사람 승인 항목으로 둔다. 사람이 "밤에 블록 4가 `supabase db push --linked`를 실행해도 된다"고 하면 `db push 허락: 예`, 아니면 `아니오`(블록 4는 마이그레이션 파일만 PR에 넣고 메모리 흉내로 완주)로 적는다.
  4. **통합 배포 푸시 허락**(블록 6): 단계 PR이 main에 들어가지 못했을 때 블록 6이 최신 통과 브랜치들을 합친 `deploy/overnight-1109`를 만들어 배포하고 `git push github deploy/overnight-1109`로 올려 두는 것(PR 없음, 아침 뒤 삭제)을 허락하는지 묻는다. 허락이 없으면 푸시하지 않고 병합 커밋 해시와 구성 브랜치·커밋만 보고에 적는다. 기록 라벨은 3.5의 3 그대로 `통합 배포 푸시 허락: 예|아니오`. 공개 주소가 `https://lighthouse-web-five.vercel.app`이 맞는지도 함께 확인한다.
  5. 문서 브랜치: 사람이 문서 PR을 병합한 것을 `git fetch github && git log github/main -1 -- docs/plans/2026-11-09-overnight/ai.md`로 확인한 **뒤** `git checkout -b docs/overnight-1109 github/main`. 병합을 못 했으면(출력이 비어 있음) 그래도 `github/main`에서 만들되 문서 브랜치의 계획 폴더를 먼저 가져와 커밋한다(필수. ai.md·human.md·notes-flow-a.md·research-vision.md·progress.md가 모두 들어온다): `git checkout github/claude/cloud-brief-ai-plan-pim0gp -- docs/plans/2026-11-09-overnight && git add docs/plans/2026-11-09-overnight && git commit -m "docs: 11/9 밤 계획 사본(문서 PR 미병합)"`. 문서 PR 브랜치는 `claude/cloud-brief-ai-plan-pim0gp`(2026-11-09 기준. ai.md·human.md·notes-flow-a.md·research-vision.md·tsd-review.md·progress.md가 모두 있다. PR이 열리면 그 head 브랜치. `gh api "repos/IBORY-PURPLE/Lighthouse_Dev/pulls?state=open" --jq '.[]|{number,head:.head.ref}'`로 확인한다. `docs/1109-ai-plan`에는 ai.md가 없다). 이때 각 블록은 ai.md를 이 브랜치에서 `git show github/docs/overnight-1109:docs/plans/2026-11-09-overnight/ai.md`로 읽고(0절 3), 블록 6은 문서 PR 병합 뒤 `github/main`을 병합해 맞춘다(블록 6 할 일 4). 그다음 `docs/plans/2026-11-09-overnight/progress.md`가 있으면(낮 문서 세션 항목 1개. 문서 PR 병합 또는 위 사본 커밋으로 들어온다) 그 끝에, 없으면 만들어 블록 0 항목(점검 표, 세 허락, 캡처 수, 고정 줄 4개)을 쓴다. `git add docs/plans/2026-11-09-overnight/progress.md && git commit -m "docs: 11/9 밤 블록 0 사전 점검" && git push github docs/overnight-1109`.
  6. **블록 이어 달리기 시험**(human.md:39, 약 15분). 후보를 차례로 1회씩 시험하고 되는 것 하나를 명령 그대로 progress.md 블록 0 항목 "블록 이어 달리기 방법"에 적는다.
     - (a) 블록 세션이 Bash로 Claude Code CLI를 새 프로세스로 띄우기. 명령 형식과 비대화형·권한 모드 옵션은 `claude --help`로 확인한다(이 파일은 플래그를 적지 않는다). 시험 세션에 주는 일: "`test-results/overnight-1109/block-test.started`를 만들고, `node .claude/hooks/guard.test.js`로 `122/122`를 확인하고, `printenv HOME`을 실행해 `[guard] 차단: 환경 변수 전체 출력`이 나오는지 stdout으로 보고한 뒤 끝내라. git 명령은 쓰지 마라". 탐침은 훅이 막지만(`guard.js:173`) 훅이 없어도 값 하나만 출력될 뿐 되돌릴 수 없는 일이 없는 명령이어야 한다. **`git push`류·`.env`류는 시험에 쓰지 않는다**(훅이 자식에 안 걸리면 금지선을 실제로 넘는다). 시험 세션은 progress.md를 건드리지 않는다(부모와 같은 작업 트리라 3.5 머리 문단의 충돌이 나고, 마지막 항목이 블록 번호 없는 시험 줄이 된다). **프롬프트 전달**: 프롬프트는 파일 `test-results/overnight-1109/block-test-prompt.txt`에 써 두고 스폰 명령에는 그 파일 경로만 넘기거나 `"$(cat …)"`로 넣는다. 스폰 명령에 `bash -c`·`node -e`·`python` 같은 해석기 토큰을 쓰지 않는다(해석기가 섞이면 훅이 따옴표 안까지 그대로 검사해 부모 쪽에서 `printenv`로 막힌다. `guard.js:162-166, 173`. 해석기가 없으면 따옴표 안을 지우고 검사하므로 통과한다). 확인할 것: 자식 세션이 실제로 떴는가(`.started` 파일), 부모 창을 닫아도 사는가, 훅이 자식에서도 걸리는가(차단 메시지), 권한 질문 없이 끝났는가.
     - (b) 앱의 예약 작업을 1회성으로 걸어 다음 블록 프롬프트를 보내기(2분 뒤). 확인할 것: 같은 세션으로 가는지 새 세션인지, 예약 시각에 실제로 시작되는지, PC가 잠들어도 되는지.
     - 안전망: 약 30분 주기 예약 작업(3.5 끝 문단의 판단 절차를 프롬프트로). 첫 실행이 "아무것도 안 함"을 기록하는지 본다. 걸 수 있으면 `안전망: 예(방법, 예약 ID)`, 아니면 `안전망: 아니오`.
     - 기록 형식(라벨은 3.5의 3과 같은 글자): `확인된 방법: (a)|(b)|없음`, `이어 달리기 명령: <그대로>`, `안전망: 예(방법, 예약 ID)|아니오`, `자식 생존: 됨|안 됨`, `훅 적용: 됨|안 됨`. 셋 다 안 되면 `블록 이어 달리기: 확인된 방법 없음`으로 적고(`이어 달리기 명령: 없음`) 사람에게 "밤에 끊기면 아침 재개"임을 알린다. 확인되지 않은 기능을 되는 것처럼 적지 않는다.
  7. progress.md 블록 0 항목(여전히 마지막 항목이다. 시험 세션은 progress.md를 건드리지 않았다)에 이어 달리기 결과와 `다음 블록: 1`을 덧붙여 커밋·푸시하고, 사람에게 점검 결과(없는 키·파일, 이어 달리기 결과)를 알린다. 사람이 "지금 시작"을 말하면 **이 세션이** 6의 방법으로 블록 1을 시작한다(human.md:23 "밤 시각 가정"). "00:00 시작"이면 (b) 예약 작업을 00:00 1회로 걸어 블록 1 프롬프트를 보낸다. (b)로 00:00 예약을 걸면 그 자리에서 `date > test-results/overnight-1109/block-1.started`를 미리 만든다(안전망 중복 방지. 3.5의 6과 같은 규칙). 안전망의 첫 실행은 00:00 이후로 건다((b)가 안 되고 (a)만 되는 환경이면 "지금 시작"만 가능하다고 사람에게 말한다. 둘 다 안 되면 안전망의 첫 실행이 시작한다). 6에서 "확인된 방법 없음"이면 사람이 블록 1 세션을 직접 열고(프롬프트는 3.5의 6 문장) 이후 블록은 안전망에 기댄다. 안전망도 없으면 "밤에 끊기면 아침 재개"임을 사람에게 알린다. 사람이 자러 가야 하면 남은 점검은 "미확인"으로 적고 시작한다.
- **도구·명령**: `git`, `gh`, `vercel`, `codex --help`, `supabase`(`init --help`, `link --help` 포함), `bd`, `npm ci`, `npx playwright install webkit`, `cd apps/web && node experiments/vision/server.mjs`, `curl`, `claude --help`.
- **산출물**: `docs/overnight-1109` 브랜치와 `progress.md` 블록 0 항목(점검 표, 세 허락, 이어 달리기 방법, 안전망), `stage/demo4`(원격), `feat/demo4/experiment`(status 플래그 1커밋), (허락 시) `chore/guard-stage-merge` PR.
- **검증**: 점검 표에 빈칸 없음("없음"이 있으면 사람에게 알렸는지), `/api/status` 세 불리언 기록, `npm run check` 결과, 이어 달리기 시험 결과 기록, (훅을 고쳤을 때) `guard.test.js` 통과.
- **합격 기준(Codex용)**: 해당 없음(기능 PR 없음). 훅 PR은 `guard.test.js` 통과 기록을 PR 본문에 넣고 사람이 병합한다.
- **예상**: AI 약 50분(점검 25 + 훅 패치·PR 10(허락 시) + 이어 달리기 시험 15). 사람 약 60분(캡처·정답 메모 45분 + 키 10분 + 시험 확인 5분, human.md:24, 42, 125) **+ 추가 약 15분**(세 허락 답 5분, 훅 허락 시 직접 편집·`guard.test.js`·PR 병합 약 10분, 문서 PR 병합 2분). 추가 시간은 human.md에 없으므로 사람에게 먼저 알린다.
- **병렬**: 1의 점검 항목은 순서 무관, 사람이 준비하는 동안 한다(`npm ci`·`playwright install`부터). 5는 1 뒤. 6은 5 뒤(progress.md가 있어야 안전망이 읽을 것이 있다). 2~4는 사람이 돌아왔을 때. 훅 패치 diff는 허락 전에 미리 써 둘 수 있다(허락이 없으면 버린다).
- **막혔을 때**: 사람이 옆에 있다. 원격·로그인·키·캡처가 없으면 묻는다. OpenAI 키가 없으면 "luna 미실행, Upstage/qwen만"으로 적고 간다. 이어 달리기 시험이 15분 안에 안 끝나면 "확인된 방법 없음"으로 적고 안전망만 시도한다.

---

### 블록 1. 비전 실험 `feat/demo4/experiment` (00:00~02:00, 배정 120분 = 구현 95 + 검증 15 + 끝 10, 작업 멈춤 01:50)

human.md:25, 126, 결정 1·2·9. TSD:97-99, §13(TSD:469-473, 476). 제품 코드를 건드리지 않는다.

- **입력**: progress.md 블록 0(키 유무, 캡처·정답 메모 수, gh GraphQL 가용 여부, 훅 수정 허락, webkit 설치 여부). `test-results/vision-samples/<상품>/{*.jpg|png, answer.md}`.
- **읽을 TSD**: §3 표 ④ 행(TSD:97-99), §8.7·§8.8(TSD:348-391, 블록 2가 받을 모양), ④ 자르기(TSD:393-398), §10 ④ 정확도(TSD:425-426). `research-vision.md` 결론, 미확인 목록(73-85), 구성안 A·B(89-105). `tsd-review.md:76-83`.
- **시작 브랜치**: 블록 0이 만든 `feat/demo4/experiment`(base `stage/demo4`). `git fetch github && git checkout feat/demo4/experiment && git pull --ff-only github feat/demo4/experiment`. 원격에 없으면(블록 0이 키 점검을 건너뛰었거나 "미확인"으로 두고 시작) 3.1의 4 공통 명령으로 `stage/demo4`(← `github/main`)와 `feat/demo4/experiment`를 이 블록이 만들고 블록 0 할 일 1의 `/api/status` 플래그·env 읽기 커밋도 이 블록이 넣는다.
- **할 일**
  1. 첫 커밋: `apps/web/.vercelignore`에 `experiments` 줄 추가(2절 사실: 지금은 배포 업로드에 포함된다. CLAUDE.md:15 "배포하지 않음").
  2. **`apps/web/src`·`tests`를 건드리지 않는다.** 코드 변경은 `apps/web/experiments/vision/` 안과 `package.json`(`openai`를 `dependencies`에)뿐이다(블록 2가 쌓이지 않기 위해, 4절 표 아래 설명). 그래서 이 PR은 `test:e2e`를 돌리지 않고 `check`만 기록한다(C5. PR 본문에 `git diff github/stage/demo4 --stat -- apps/web/src apps/web/tests` → 0을 적는다).
  3. `server.mjs`에 엔진을 더한다. 요청에 `engine: "groq" | "openai" | "upstage"`(기본 groq). 키 없는 엔진은 호출하면 `{error:"not_configured"}`.
     - openai: `openai` SDK(`npm i openai`. **`dependencies`에** 넣는다. 블록 2 `extract.ts`가 서버에서 같은 패키지를 쓰므로 같은 섹션·같은 버전이어야 통합 충돌이 준다. package-lock 고정), 모델 `gpt-5.6-luna`, 이미지 `detail: "original"`, 추론 끔. 정확한 매개변수 이름은 설치된 SDK 타입으로 확인하고 거부되면 기본값으로 보내고 비고에 적는다(2절 미확인). `kind: "ocr"`이면 "보이는 글자를 그대로 받아쓰기, 못 읽는 부분은 [못 읽음]" 지시. 요청당 이미지 1장(Upstage와 조건을 맞춤). 통이미지도 1장.
     - upstage: `fetch` + `FormData`로 `POST https://api.upstage.ai/v1/document-digitization`, `document`(JPEG) + `model=ocr`, `Authorization: Bearer`(research-vision.md:29). 응답에서 전체 텍스트, 단어별 confidence, `usage.pages`를 꺼낸다. 요청당 1장, 순차(3 RPS).
     - 공통: 키는 블록 0이 고친 방식(두 env 파일을 조건 없이 차례로 `process.loadEnvFile`, 블록 0 할 일 1)으로 `OPENAI_API_KEY`, `UPSTAGE_API_KEY`를 읽는다(TSD:145-146. 파일 위치는 블록 0 기록대로, 2절 미확인). 호출 카운터를 서버 메모리에 두고 `/api/status`에 `calls: {openai, upstage, groqQwen, groqOss}`로 노출한다. **상수 `MAX_PAID_CALLS_PER_ENGINE = 500`(엔진당 조각 500장, 3.6 돈)에서 서버가 거부한다**(`{error:"budget"}`). 서버는 파일을 쓰지 않는다.
  4. 요약 단계 `POST /api/summarize-text`: 읽은 글자(조각 순서대로 이어 겹친 줄 제거)를 Groq `openai/gpt-oss-120b`(`llm.ts`와 같은 모델, groq-sdk)에 넣어 항목별 `{key, value, evidence}` JSON을 받고, `evidence`를 공백 정규화해 원문 포함 검사로 대조한다(TSD:386). 항목: 상품명·모델명, 옵션, 핵심 사양(3~5), 구성품, 주의사항, 가격(채점용, 결정 2). 없으면 `null`("이미지에서 못 찾음"). OCR 원문만 주는 Upstage를 항목별로 채점하려면 이 단계가 필요하다. 이 코드는 블록 2 `evidenceCheck.ts`의 초안이다. Groq 429로 호출이 중지되면(6절 Groq 429 행대로: 3회 연속 → 60초 대기 1회 → 재실패면 중지) AI가 OCR 원문을 직접 읽어 채점하고 비고에 적는다.
  5. `index.html`: 엔진 select, 타일 높이 선택(1200, 800), 기본값을 폭 1000·겹침 100으로(TSD:395; 기존 1024·80은 선택지로 남긴다). "통째로"는 폭 1,000px 축소 1장. 결과에 `usage.pages`, 호출 수·누계, 엔진별 ms, `summarize-text` 결과(항목·근거·대조)를 표시한다. "결과 내려받기" 버튼은 사람이 눈으로 볼 때용이다(브라우저 다운로드라 저장 위치는 브라우저 기본 폴더. 서버는 쓰지 않음). 실제 기록은 `run.mjs`가 쓴다(6).
  6. 실행기 `experiments/vision/run.mjs`: `@playwright/test`의 `webkit`(e2e와 같은 브라우저, 블록 0에서 확인; 실패하면 `npx playwright install chromium` 뒤 `chromium`)으로 `index.html`을 열어 `test-results/vision-samples/<상품>/` 이미지를 `setInputFiles`로 넣고 보내기 방식·엔진·타일 높이를 바꿔 가며 돌린 뒤 결과(엔진, 상품, 방식, 조각 수, 각 호출 ms, 요약 ms, 텍스트)를 루트 `test-results/vision/<시각>-<상품>-<방법>-<엔진>.json`에 저장한다(3.7과 같은 위치). 호출 간격 1초(Upstage 3 RPS·Groq 429 회피). `--budget 400`으로 엔진당 유료 호출을 조각 400장에서 멈춘다(3.6 돈: 공개 완주 2회분 약 100장 예약). 서버 카운터는 재시작하면 0이 되므로 `run.mjs`가 시작할 때 `test-results/vision/*.json`의 엔진별 호출 수를 더해 누계로 이어 받고 `--budget`에서 뺀다. 캡처 경로는 로그에 남기지 않는다.
  7. 실험 설계(정답 메모 상품 3~5개. C6은 3개 이상). **비교 엔진 2개**는 C6 표대로 키 유무로 정한다(기본 luna+Upstage. Upstage 없으면 qwen이 두 번째 엔진, 결정 9. luna 없으면 Upstage+qwen). 호출 수 기준은 human.md:142 "상품 1개 = 조각 10장"이고 캡처는 상품당 여러 장(human.md:24)이라 통째도 캡처 장수만큼 호출한다. 정답 메모 상품 모두 × (통째 + 타일 1,200 + 한 상품 타일 800) × 엔진 2개를 다 돌린다. 싼 통째를 먼저, 비싼 타일을 뒤에 둔다. 순서: ① 모든 상품 **통째** × 엔진 2개(캡처 장수만큼 호출. C6·human.md:61 "통째·타일 × 모델별". Upstage 쪽수 과금 확인은 첫 Upstage 통째 응답의 `usage.pages`로) → ② 모든 상품 타일 1,200 × 엔진 2개 → ③ **한 상품만** 타일 800 × 엔진 2개 → ④ 시간·횟수가 남으면 qwen 기준선(타일 1,200, 세 상품, 3장 묶음. Upstage가 있어 qwen이 비교 엔진이 아닐 때만. human.md:25 "모델 2개"라 상시 비교는 AI 추가다, 9절 13). 예상 사용량: 상품당 캡처 3장·조각 10장이면 엔진당 통째 9~15 + 타일 1,200 약 30~50 + 타일 800 약 15 ≈ 60~80장, 400장 안에 넉넉하다. 400장에 닿을 것 같으면 "포기 순서"대로(④ qwen 기준선 → ③ 타일 800 → ② 타일 1,200의 캡처 수 축소) 빼고, 닿으면 멈추고 표에 `미실행(예산 상한)`을 적는다.
  8. **채점 규칙**(`answer.md`가 기준. AI가 출력과 메모를 나란히 읽고 판정, 사람이 아침에 표본 확인):
     - `맞음`: 값이 메모와 같다. 공백·대소문자·단위 표기 차이(`mm`/`밀리미터`)는 같은 것으로 본다. 핵심 사양은 메모의 3~5개 중 3개 이상 맞고 틀린 것이 없으면 `맞음`.
     - `틀림`: 메모에 값이 있고 출력도 값을 냈는데 다르며, 그 글자가 읽은 원문 안에 있다(잘못 읽었거나 잘못 골랐다). 숫자 한 자리만 달라도 `틀림`.
     - `지어냄`: 메모에 `없음`인 항목에 값을 냈거나, 출력 값이 읽은 원문 어디에도 없다. qwen처럼 원문이 모델 출력 자체인 엔진은 "메모에 없음인데 값을 냄"만 `지어냄`으로 세고 나머지 불일치는 `틀림`으로 센다(결과표 각주에 밝힌다).
     - `못 읽음`: 메모에 값이 있는데 출력이 `null`/"이미지에서 못 찾음".
     - `해당 없음`: 메모에도 없고 출력도 없음. 분모에서 뺀다.
     - 정확도 = 맞음 / (맞음+틀림+지어냄+못 읽음). **1위 순서**: 지어냄 합이 적은 엔진 → 정확도 높은 엔진 → 전체 ms 중앙값 짧은 엔진. 같으면 luna(분당 한도가 넉넉하다, human.md:138). 돌린 엔진이 하나뿐이면 결론 줄에 `비교 없음`을 적고 C6은 `미완료`다(human.md:145 "엔진 2개"). 블록 2 엔진 고르기는 그 하나를 쓴다. 가격은 채점만 하고 화면 요약에서는 뺀다(결정 2).
  9. `docs/plans/2026-11-09-overnight/results-vision.md`(이 PR 브랜치에 둔다. Codex가 작업 폴더에서 읽는다. PR이 AI 병합되면 head 브랜치가 지워지므로 블록 끝 progress.md 항목에 `결과표 위치: stage/demo4|feat/demo4/experiment`를 적는다, 3.5의 3). 맨 위 "결론" 한 줄(1위 엔진과 근거, 비교한 두 엔진 이름, 조각 높이 결론. 블록 2가 이 줄을 읽는다). 결과표 행 = 상품 × 보내는 방법(통째/타일 1200/타일 800) × 엔진. 열: `상품 | 방법 | 엔진 | 조각 수 | 상품명·모델명 | 옵션 | 핵심 사양 | 구성품 | 주의사항 | 가격(채점용) | 맞음/전체 | 지어냄 수 | 글자 읽기 ms(합) | 요약 ms | 전체 ms | 호출 수 | 돈(추정, 원) | usage.pages(Upstage) | 비고`. 항목 셀 값은 채점 규칙의 다섯 값 중 하나, 미실행 셀은 `미실행(이유)`. 아래에 엔진별 요약 표(맞음/틀림/지어냄/못 읽음 합, 정확도 vs 90%, 지어냄 vs 0건, 요약 1건 전체 ms 중앙값 vs 2분, 호출 수(조각 수) 합, 돈 추정 = 조각 수·토큰 × tsd-review.md:76 단가, "추정"이라 적음). "확인한 것" 절: research-vision.md 미확인 1·3·5·7(크레딧, 쪽수 과금, 조각 높이, qwen 한도)과 Groq 요약 429 여부(TSD:98). 캡처 이미지와 읽은 원문은 넣지 않는다(3.7).
  10. 입문 메모 초안(human.md:19): `results-vision.md` 끝에 "입문 메모 초안" 절, 쉬운 말 10줄 안팎 — 이미지를 AI에 보내는 법(base64 data URL, 조각), 왜 자르는지(축소·글자 크기·토큰), 엔진 차이(읽기 전용 OCR vs 생성형, 신뢰도 유무), 다음 할 일. 블록 6이 `morning-report.md`로 옮긴다.
  11. `CLAUDE.md` 지도: `experiments/vision` 줄이 있으면 `run.mjs`를 덧붙이고(한 줄만 수정), `github/main`에 없으면(블록 0 기록) 그 줄을 추가한다.
- **도구·명령**: `npm i openai`, `cd apps/web && node experiments/vision/server.mjs`, `cd apps/web && node experiments/vision/run.mjs --budget 400`, `curl`, `npm run check`(실험 폴더가 lint 대상이면 통과시킨다).
- **산출물**: `apps/web/experiments/vision/{server.mjs,index.html,run.mjs}`, `apps/web/package.json`(openai, `dependencies`), `apps/web/.vercelignore`, `docs/plans/2026-11-09-overnight/results-vision.md`, `CLAUDE.md`(1줄), `test-results/vision/*.json`(커밋 안 함), PR(base `stage/demo4`).
- **검증**: `npm run check` 종료 0(기록 `test-results/<PR>-check.txt`). `test:e2e`는 돌리지 않는다(`src`·`tests` 불변, C5). `results-vision.md`가 C6을 채움(행 수 ≥ 3 × 2 × 2, 엔진 2개, 빈 셀 0). 유료 호출 엔진당 조각 ≤400(`/api/status`의 `calls`를 `test-results/<PR>-vision-status.txt`에 저장). 기록 파일·결과표 비밀 검사 0건. `git ls-files test-results` 비어 있음, PR diff에 이미지 0개.
- **합격 기준(Codex용)**: 실험 서버가 OpenAI luna·Upstage OCR·Groq qwen 세 엔진을 키 존재 여부에 따라 선택해 호출하고 키 값을 어떤 응답·로그에도 넣지 않으며 엔진당 유료 호출(조각)을 500장에서 코드로 거부한다. 읽은 글자를 Groq에 넘긴 요약의 각 항목 근거가 원문에 없으면 `null`로 바뀐다. 결과표 `results-vision.md`가 정답 메모 상품 3개 이상 × 통째·타일 × 엔진 2개 이상으로 채워져 있고, 항목 셀이 맞음·틀림·지어냄·못 읽음·해당 없음 중 하나이며 빈 칸에는 이유가 있고, 걸린 시간·호출 수와 1위 엔진·근거가 적혀 있다. 실험용 캡처 파일과 읽은 원문이 커밋에 없다(`git ls-files test-results`가 비어 있다). `apps/web/src`·`apps/web/tests`에 변경이 없다. `.vercelignore`에 `experiments`가 있다. `npm run check`가 통과한다.
- **스크린샷**: 합성 예시 이미지(LH-200) 결과 화면 1장(`synthetic-vision-lab.png`). 실제 캡처가 보이는 화면은 올리지 않는다.
- **예상**: 배정 120분(구현 95 + 검증 15 + 끝 10). 끝 상한 = min(실제 시작 + 120분, 표 상한 02:00), 작업 멈춤 = 끝 상한 − 10분(3.6). 시작 때 작업 메모에 두 값을 적는다. 11/4 기준이면 더 빨리 끝날 수 있지만 외부 API 대기와 채점이 손이 많이 간다. 끝나면 바로 블록 2를 시작한다.
- **병렬**: 3(서버 엔진)과 5·6(화면·실행기)은 독립. 4는 3 뒤. 7은 3~6 뒤. 8~10은 7의 결과가 나오는 대로 상품 단위로 채운다. 10의 뼈대는 7 전에 써 둔다.
- **포기 순서**(시간·조각 400장 상한): ④ qwen 기준선(Upstage가 있을 때만 존재하는 항목) → ③ 타일 800 비교 → 입문 메모 초안(뼈대만, 블록 6이 채움) → ② 타일 1,200의 캡처 수 축소(상품당 3장 → 2장 → 1장). **끝까지 지킴**(C6과 같은 문장): 정답 메모 상품 3 × (통째 + 타일 1,200) × 비교 엔진 2개(C6 표대로 키 유무로 정한 둘)와 결론 줄. 통째는 두 엔진 모두 상품 3개이고 Upstage 통째도 1회로 줄이지 않는다(통째는 캡처당 1회라 싸다). 비교 엔진이 하나뿐이면 C6 `미완료`.
- **막혔을 때**: 한 엔진이 키 없음·402·가입 불가·연속 429 3회면 그 엔진을 빼고 남은 둘로 간다(C6 표: Upstage 빠지면 luna+qwen, luna 빠지면 Upstage+qwen). 둘이 안 남으면 qwen만 돌리고 결과표에 사유를 적고 C6 `미완료`, 결론 줄에 `비교 없음`과 `미정`. 캡처·정답 메모가 없으면 합성 이미지로 절차만 검증하고 결과표에 `정답 메모 없음`, 아침 보고 첫 줄. 모델 id·옵션 오류 3회 → 그 엔진 `미실행(오류 한 줄)`. 같은 오류 3회 또는 작업 메모의 작업 멈춤 시각 → 멈추고 돌린 데까지 결과표를 쓰고 3.5, 블록 2 시작(블록 2는 결과표가 없어도 돈다).

---

### 블록 2. ④ 올리기·요약 `feat/demo4/upload-summary` (02:00~04:30, 배정 150분 = 구현 125 + 검증 15 + 끝 10, 작업 멈춤 04:20)

human.md:26, 120, 127, 132(하는 것), 145(성공 기준). 결정 2·3·9·11.

- **입력**: progress.md 블록 1 항목(결론 줄: 1위 엔진 또는 `미정`, 조각 높이, Groq 요약 429 여부, 각 엔진 호출 누계, 실험 PR 번호·상태). `results-vision.md` 결론 줄: progress.md 블록 1 항목의 `결과표 위치:` 줄대로 `git fetch github && git show github/stage/demo4:docs/plans/2026-11-09-overnight/results-vision.md | head -5`(실험 PR이 AI 병합됐을 때. head 브랜치는 지워진다, 2절) 또는 보류면 `github/feat/demo4/experiment:…`.
- **시작 브랜치**: 실험 PR이 AI 병합됐든 보류든 `git fetch github && git checkout -b feat/demo4/upload-summary github/stage/demo4`. PR base `stage/demo4`. 블록 1이 `apps/web/src`·`tests`를 바꿨다고 기록돼 있을 때만 `github/feat/demo4/experiment`에서 따고 base를 그 브랜치로.
- **엔진 고르기**(결정 9): 공개 완주에 쓸 엔진 = 결론 줄의 1위. `미정`이거나 결과표가 없으면 **OpenAI(luna) → Upstage** 순으로 키가 있는 것(근거 human.md:125). 코드의 우선순위 배열도 같은 순서(`["openai","upstage"]` 또는 반대). `EXTRACT_MODE=mock`(production 아닐 때)이면 mock → 배열 순서로 키가 있는 첫 엔진 → 없으면 `extractEngine: null`, 503 `not_configured`. TSD §8.7에 없는 규칙이라 PR 본문과 9절에 적는다. 새 환경변수 이름은 만들지 않는다(TSD §5의 이름만).
- **읽을 TSD**: §4 ④ 파일(TSD:123-132), §5(TSD:140-155), §7.1 ④ 행(TSD:216-218, 224), §8 공통(TSD:229), §8.1(TSD:234), §8.7(TSD:348-356), §8.8(TSD:358-391), ④ 자르기(TSD:393-398), §10 ④(TSD:425-427), §12(TSD:449, 455).
- **할 일**
  1. `src/lib/imagePieces.ts`(브라우저): `planPieces(width, height, {maxWidth: 1000, pieceHeight: 1200, overlap: 100})` 순수 함수 → 조각 사각형 배열(원본 좌표, 축소 비율). 블록 1 결론이 800이면 상수만 바꾼다. 마지막 조각이 높이의 40% 미만이면 앞 조각에 붙인다(`index.html` 규칙 재사용). 조각 수 30 초과면 조각 높이를 늘려 30에 맞추고 안내한다(TSD:352). `cutPieces(file)`은 `createImageBitmap` → 조각 크기 canvas에 `drawImage` 원본 좌표 → JPEG 0.85 data URL(원본 크기 canvas 없음, TSD:395). 1.5MB 넘는 조각은 품질을 낮춰 재시도.
  2. `src/lib/summaryDraft.ts`: `SummaryDraft` 타입(TSD:366-382), LLM JSON 파싱·검증(모양이 틀리면 `llm_failed`), 항목 키 목록 `productName, option, spec, components, caution`과 라벨. **가격·재고·할인 키는 목록에 없고**, LLM이 다른 키를 내면 버린다.
  3. `src/lib/evidenceCheck.ts`(순수 함수, TSD:385-389): ① `evidence` 공백 정규화 후 원문 포함 검사, 없으면 `value=null`, `check="unverified"`, `reason` ② `lowConfidence` 단어와 겹치면 `needsCheck=true` ③ 가격·재고·할인으로 보이는 키·라벨(`price|가격|재고|할인|stock|discount`) 제거 ④ `source="manual"`도 같은 대조. 블록 1 `summarize-text`의 대조 코드를 옮긴다. 가장 먼저 고정 시험값으로 쓴다.
  4. `src/lib/extract.ts`(`server-only`): 위 "엔진 고르기" 순서. `EXTRACT_MODE=mock`이면 가짜 글자(조각 번호가 들어간 고정 문장, 가짜 헤드셋 LH-200). OpenAI는 `lowConfidence: []`(TSD:354). 블록 1 `server.mjs`의 호출 코드를 옮겨 쓴다. 이미지는 호출 뒤 참조를 버린다(저장 없음). 로그는 상태·ms·조각 번호만(TSD:229).
  5. `src/app/api/volunteer/extract-text/route.ts`(TSD:348-356): 쿠키 401, `X-Demo-Volunteer` 없음·명단 밖 403 `unknown_volunteer`(TSD:229, `volunteers.ts` id), 형식 400 `invalid_request`, `pieceCount` 30 초과 400, 디코드 1.5MB 초과 413 `image_too_large`, `data:image/(jpeg|png)` 아니면 415 `bad_image_format`, 글자 없음 422 `no_text`, 분당 60회(clientKey) 429 `rate_limited` + `Retry-After`, 엔진 실패 502 `extract_failed`, 503 `not_configured`. 실패 본문 `{ok:false, error}`. `runtime='nodejs'`, `maxDuration=60`. 응답 헤더 `Server-Timing: engine;dur=<ms>`(결정 11 측정용. JSON 모양은 TSD 그대로). `storagePath` 대체 경로는 만들지 않는다(human.md:133). 분당 60은 AI 결정(조각 30개를 2분 안에 보낼 수 있어야 한다. `rateLimit.ts`가 인스턴스별임을 주석과 PR 본문에).
  6. `src/app/api/volunteer/summarize/route.ts`(TSD:358-390): 요청 검사(쿠키 401, 봉사자 헤더 403, 400 `empty_text`/`too_long`, 상한 Groq 4,000자), 분당 20회 429, `EXTRACT_MODE=mock`이면 가짜 LLM 출력(고정 JSON. **일부러 한 항목의 근거를 원문에 없는 문장으로** 두고 한 항목은 `missing` → `evidenceCheck`가 `unverified`로 바꾸는지 e2e가 본다), 아니면 Groq `gpt-oss-120b`(`llm.ts`의 클라이언트 재사용, 스트림 없음). JSON 지시문은 `src/lib/prompt.ts`를 건드리지 않고 새 파일 `src/lib/summaryPrompt.ts`에(③ endsWith 시험 보호). 지시문에 "원문에 없으면 null, 항목마다 evidence 원문 인용 200자 이하, 가격·재고·할인 항목 금지". 응답은 `evidenceCheck`를 거친 `SummaryDraft`, 헤더 `Server-Timing: llm;dur=<ms>`. 요약 모델은 Groq로 시작하고, 블록 1에서 Groq 요약 429가 났으면 OpenAI 텍스트 호출(12,000자)로 바꾸고 PR 본문에 적는다(human.md:134 AI 결정). 이어 붙인 글이 4,000자를 넘으면 브라우저가 안내("읽은 글이 길어 앞 4,000자만 요약합니다")를 내고 앞부분만 보낸다(TSD에 없는 결정, 9절).
  7. `src/components/InfoSummary.tsx`: 파일 선택(`<input type="file" accept="image/*" multiple>`, 라벨 "상세 이미지 올리기". 시연·아침 판정이 "캡처 1~3장"이므로 여러 장을 받아 파일 선택 순서대로 조각을 이어 붙인다. `pieceCount`는 전체 합, 30 초과면 안내) → 파일마다 `cutPieces` → 조각을 한 장씩 순서대로 `extract-text`(헤더 `X-Demo-Volunteer`, 429면 `Retry-After` 대기, 같은 조각 3회 실패 → 입력창) → 이어 붙이고 겹친 줄 제거 → `summarize` 1회 → 항목 목록("항목 이름, 값, 확인 필요 여부" 순서, 근거는 항목마다 펼침, TSD:224). `unverified`는 "확인 안 됨", `missing`은 "이미지에서 못 찾음", `unreadable` 조각 번호. 상태 안내는 TSD:216-218 문구 그대로(`StatusRegion`, 시작·끝만). 초안 도착 시 초점은 요약 영역 제목(`tabIndex=-1`). "텍스트 직접 입력" 버튼은 항상 있다(TSD:397) → `<textarea>` → `source: "manual"`. 캡처 올리기부터 초안까지 걸린 시간과 각 응답의 `Server-Timing` 값을 화면 아래 작은 글씨로 보여 준다(human.md:145 마지막 문장, 결정 11). 올린 이미지·글자·초안은 컴포넌트 상태에만 둔다. 항목 수정 UI 없음(결정 3). 44px, axe.
  8. `src/app/volunteer/page.tsx`: `{match && (...)}` 안 `VolunteerChat`(85-89) 뒤에 `<InfoSummary requestId={match.requestId} volunteerId={match.volunteer.id} product={match.request.raw} />`와 h2 "상세 이미지 요약". 다른 줄은 고치지 않는다(③과 충돌 방지, TSD:455). `volunteerRequest.ts`는 만들지 않는다(블록 5 몫, 9절).
  9. `src/app/api/health/route.ts`에 `extractEngine: "openai"|"upstage"|"mock"|null`(TSD:234)을 더하고, 이를 고정하는 기존 시험 두 곳(`tests/e2e/public.spec.ts:57-62` 키 집합, `tests/unit/routes.test.ts:62-66, 74-78` 본문)을 새 키를 포함한 **정확한** 집합·본문으로 바꾼다. 이유를 PR 본문 "시험 변경"에 적는다. `store` 키는 블록 4가 같은 방식으로 더한다(충돌 예상, 블록 6이 손으로 푼다).
  10. `playwright.config.ts` webServer env에 3.2의 두 줄을 넣는다.
  11. 시험(가짜 응답 기준):
      - 단위: `imagePieces.test.ts`(높이 4200 → 조각 수·겹침·마지막 조각 병합, 30 초과 보정), `evidenceCheck.test.ts`(고정 시험값: 일치 → `matched`, 공백만 다른 근거 → `matched`, 원문에 없음 → `unverified`+`value null`, `lowConfidence` 겹침 → `needsCheck`, 가격·재고·할인 키 제거, manual 동일), `summaryDraft.test.ts`(틀린 JSON → `llm_failed`, 모르는 키 버림), `extract.test.ts`(mock 글자, 엔진 순서, 키 없음 → `not_configured`), `extractTextRoute.test.ts`(401/403/400/413/415/422/429+Retry-After/502/503, 로그에 이미지·글자 없음), `summarizeRoute.test.ts`(400 둘, 403, 429, 200 초안, 가짜 LLM의 틀린 근거 → `unverified`), `routes.test.ts` health 갱신.
      - e2e `tests/e2e/summary.spec.ts`(iPhone 15): 봉사자 화면 진입은 **이용자 화면을 거치지 않는다**. `chat.spec.ts:54-76`의 `openVolunteer`는 export되지 않은 파일 안 함수이고 v1 이용자 흐름("눌러서 말하기 → 이대로 요청")으로 들어가므로 블록 3이 질문 3개로 바꾸면 깨진다. 새 도우미 `tests/e2e/helpers/volunteer.ts`의 `openVolunteer(page, match?)`를 만들어 export한다: `/enter?code=`로 쿠키를 받고(Windows WebKit secure 쿠키 처리는 `chat.spec.ts:61-66` 그대로) `page.addInitScript`로 sessionStorage `lh.match.v1`에 `MatchResponse`(`matchHandoff.ts:6-14` 모양, 봉사자 id는 `volunteers.ts:9-17` 명단의 첫 번째)를 심은 뒤 `page.goto("/volunteer")`. `summary.spec.ts`와 `public.spec.ts` ④ 사례는 이것만 쓴다. `chat.spec.ts`는 건드리지 않는다(블록 3·4의 이용자 화면 변경과 독립). 긴 합성 이미지(폭 860, 높이 약 4,500, 글자 포함, 노이즈로 크기를 키움)는 spec이 Node에서 돌아 canvas가 없으므로 **브라우저 `page.evaluate` 안에서** canvas로 그려 `toDataURL('image/png')`의 base64를 돌려받고, Node에서 `Buffer.from(…, 'base64')`로 바꿔 `setInputFiles({name, mimeType, buffer})`에 넣는다. **`buffer.length > 4.5 * 1024 * 1024`를 단언한다**(C8. 실제 쇼핑몰 이미지는 넣지 않는다, TSD:425). 사례: 조각 3개 이상이 순서대로 POST됨(`page.route`로 `pieceIndex` 수집) / 시작·끝 상태 안내 문구 / 초안 도착 안내와 초점이 요약 제목 / `unverified` 항목이 "확인 안 됨" / 초안 어디에도 가격·재고·할인 라벨 없음 / 같은 조각 502 3회(`page.route`) → 입력창·안내·초점 / 입력창 글 → `summarize` `source:"manual"` → 같은 모양 초안 / 413·415 응답 → 안내 / 이용자 화면 코드에서 `/api/volunteer` 호출 없음(역할 분리) / 봉사자 화면 axe 0건. 기존 `chat.spec.ts` 20개 그대로 통과.
  12. `CLAUDE.md` 지도 `apps/web/src/lib/` 줄에 `imagePieces.ts`, `extract.ts`, `summaryDraft.ts`, `evidenceCheck.ts`, `summaryPrompt.ts`, components 줄에 `InfoSummary.tsx`, 시험 도우미 줄에 `helpers/volunteer.ts`.
  13. 배포(3.4) → health로 `extractEngine`이 고른 엔진인지 확인 → 공개 완주 1회: `public.spec.ts`에 사례 "④ 올리기·요약 완주"를 더한다 — 11의 `openVolunteer` 도우미로 `/volunteer`에 들어가(이용자 화면 경유 없음. 기존 완주 사례는 그대로 둔다. 블록 4가 그 사례를 플로우 A로 바꾼다) `test-results/vision-samples/public/sample.jpg`(spec에서 `path.resolve(process.cwd(), "../..", "test-results/vision-samples/public/sample.jpg")`)를 `setInputFiles`로 넣고 실제 요약을 받는다. 파일이 없으면 합성 이미지로 돌리고 출력에 "합성 이미지 기준". 기록(C7·C15의 AI 쪽 시간): 엔진, 조각 수, 조각별 `extract-text` ms(`Server-Timing` engine 값과 클라이언트 왕복)와 중앙값, `summarize` ms(llm), 전체 ms, 항목 수, 확인 안 됨 수, 초안 JSON의 `fields[].key`·`fields[].label` 패턴 검사 0건(C7. spec 안에서 `expect`로 단언하고 key·label 목록을 출력에 적는다. `jq`는 쓰지 않는다. `value`·`evidence`는 검사하지 않는다). 초안 값·근거 원문은 기록에 적지 않는다(항목 이름과 check만). 실행 1회가 엔진 호출 조각 수만큼이라 누계(블록 1 + 조각 수 ≤ 500)를 확인한 뒤 돌린다(production에는 코드 상한이 없다. 3.6 돈). 기록 `test-results/<PR>-test-public.txt`.
- **도구·명령**: `npm run check`, `npm run test:e2e`, `vercel deploy --prod --yes`, `BASE_URL=… npm run test:public`.
- **산출물**: 위 파일들, `tests/unit/*.test.ts` 7개, `tests/e2e/summary.spec.ts`, `tests/e2e/helpers/volunteer.ts`, `public.spec.ts` 갱신, `CLAUDE.md`, PR(base `stage/demo4`), 배포 기록.
- **검증**: `check` 0, `test:e2e` 0(가짜 음성 입력·가짜 응답 기준, 기존 약 72개 + 신규), `test:public` 0(실제 엔진 1회), C10 grep 0건, C7 패턴 검사 0건, 기록 파일 비밀 검사 0건.
- **합격 기준(Codex용)**: 가짜 응답 기준으로 서버 한도(4.5MB)보다 파일 크기가 큰 긴 합성 이미지(시험이 크기를 단언한다)가 브라우저에서 폭 1,000px 이하·높이 약 1,200px·겹침 100px JPEG 조각으로 나뉘어 한 장씩 순서대로 `extract-text`에 보내지고 끝까지 읽힌 뒤 `summarize` 1회로 항목별 값과 근거가 표시된다. 근거가 원문에 없는 항목은 값이 `null`이고 `check`가 `unverified`("확인 안 됨")다. 초안에 가격·재고·할인 항목이 없다. 같은 조각이 3회 실패하면 텍스트 입력창이 열리고 그 글로 같은 모양의 초안을 받는다. `extract-text`·`summarize` 라우트와 `extract.ts`에 이미지·글자·초안을 파일·저장소에 쓰는 코드가 없고 로그에 상태·시간·조각 번호만 남는다. 쿠키 없음 401, 봉사자 헤더 없음 403, 큰 조각 413, 잘못된 형식 415, 횟수 초과 429, 키 없음 503이 작동한다. `/api/health`는 엔진 이름만 돌려주고 키 값은 어디에도 나오지 않는다. 기존 시험은 `/api/health` 키 집합 변경(이유 명시) 외에 바뀌지 않았고 전부 통과하며 봉사자 화면 axe 위반이 0건이다. 공개 주소에서 실제 엔진으로 1회 끝까지 받은 기록(엔진·조각 수·시간)이 있다.
- **스크린샷**: 합성 이미지로 초안이 표시된 봉사자 화면 1장(`synthetic-summary.png`), 입력창 대체 화면 1장(`synthetic-manual.png`).
- **예상**: 배정 150분(구현 125 + 검증 15 + 끝 10). 끝 상한 = min(실제 시작 + 150분, 표 상한 04:30), 작업 멈춤 = 끝 상한 − 10분(3.6). 시작 때 작업 메모에 두 값을 적는다. 11/4 경험(25~35분)보다 범위가 커서 배정을 다 쓸 수 있다.
- **병렬**: 1·2·3(순수 함수)은 서로 독립, 단위 시험과 함께 먼저. 4 → 5 → 6 순서. 7은 2·3 뒤, 5·6과 동시에 해도 된다(`page.route`로 가짜 응답). 8·9·10은 아무 때나. 11의 e2e는 8 뒤. 13은 PR 푸시 뒤.
- **포기 순서**: 근거 펼치기 UI(목록에 근거를 그대로 노출) → 413·415 e2e 사례(단위 시험은 유지) → 공개 완주의 실제 캡처(합성으로, "합성 이미지 기준" 명시. 이 경우 C7은 `미완료`다(human.md:61 "실제 캡처로 실제 요약"). 아침 보고 5절에 적고 블록 6 재완주에서 실제 캡처로 다시 시도) → `Server-Timing` 헤더 읽기(클라이언트 왕복 ms로 대체. 결정 11의 시간 기록 자체는 빼지 않는다). 조각 자르기, 근거 대조, 가격 제외, 3회 실패 → 입력창, 저장 없음은 끝까지 지킨다(human.md:145).
- **막혔을 때**: 1위 엔진 키가 Vercel에 없어 `extractEngine`이 다른 값이면 그 엔진으로 완주하고 기록. `extractEngine: null`이면 공개 완주는 503 → 입력창 경로로 끝까지 가고 `엔진 없음`으로 기록, C7 `미완료`, 아침 보고 첫 줄. `vercel env ls`로 이름만 보고 등록은 하지 않는다. 같은 e2e 실패 3회 → 그 사례를 `미완료`로 적고 나머지로 PR(시험을 빼지 않는다). 배포 실패 3회 → 로컬 시험만으로 PR, 블록 6에서 재배포. 작업 메모의 작업 멈춤 시각에 멈추고 3.5, 블록 3.

---

### 블록 3. 플로우 A PR 1 질문 3개 `feat/demo1/questions` (04:30~05:40, 배정 70분 = 구현 45 + 검증 15 + 끝 10, 작업 멈춤 05:30)

human.md:79, 85, 90-93, 결정 7. notes-flow-a.md C1(PR 1 부분)·C2·C3·C5·C6.

- **입력**: progress.md 블록 2 항목. ④ PR 상태는 이 블록에 영향 없다(다른 단계).
- **시작 브랜치**: `git checkout -b stage/demo1 github/main && git push github stage/demo1`, `git checkout -b feat/demo1/questions`. PR base `stage/demo1`.
- **읽을 TSD**: §8.4(TSD:315-322, PR 2 경계 확인). 나머지는 notes-flow-a.md.
- **할 일**(notes C1 "변경" 중 PR 1, C2 표, C3, C5, C6 단위·e2e의 PR 1 부분)
  1. `src/lib/speech.ts` 추가만: 액션 `{type:"reset", mode}`, `{type:"typed", text}`(입력창 답 → confirming, `fellBack` 유지, status `typedBack`), `{type:"reenter"}`. `matchRejected`는 `fellBack`이면 text. STATUS에 notes C2 표의 신규 문구(`typedBack`, `needProduct`, `answerTooLong`, `summary`)를 **끝에 추가**(기존 문구·순서 불변; 블록 4가 같은 객체 끝에 또 추가하므로 한 줄씩 끝에 붙인다).
  2. `src/components/SpeechInput.tsx` 선택 prop만: `confirmTyped?`, `labels.reenter?`, confirming+fellBack이면 "다시 입력" 버튼. 챗봇(`VolunteerChat.tsx:72-77`)은 prop을 안 넘기므로 동작 동일.
  3. `src/lib/requestFlow.ts`(순수 reducer): 상태 `intro → asking(0|1|2) → summary → matching → connected`(PR 1은 `summary` 다음을 지금의 `requestMatch(제품 답)` → `saveMatch` → `DemoHandoff`로 잇는다, notes C2). `checking/registering/queued`는 PR 2. 질문 1 확인 때 `parseRequest(answer).item`이 없으면 `needProduct`(결정 7), 200자 초과 `answerTooLong`, `inputMode` 이어받기.
  4. `src/app/page.tsx`: notes C2 표의 intro·asking·확인·입력창·summary 행대로 화면·초점·상태 영역. 질문이 바뀔 때 `reset` + `<SpeechInput key={question}>`. 답하는 동안 네트워크 요청 없음.
  5. e2e 도우미 `tests/e2e/helpers/flowA.ts`: `completeFlowA(page, {product, budget, condition})`. `chat.spec.ts:54-76, 412-436`과 `match.spec.ts`의 이용자 화면 경유 부분을 도우미로 바꾼다(챗봇 단언 내용 불변). 블록 2의 `tests/e2e/helpers/volunteer.ts`(④ PR 브랜치에만 있다)는 이용자 화면을 거치지 않으므로 이 블록이 고칠 것이 없다. 통합 때도 그대로 돈다(블록 6). `user-screen.spec.ts`의 기존 시험을 질문 1 기준으로 옮기고 notes C6의 신규 사례(질문 2에서 2회 못 들음 → 입력창 → 질문 3 입력창 시작, 질문 3 버튼 "완료", 요약에 세 답, 질문 1 품목 없음 머묾, 44px·axe를 intro/질문/요약마다)를 더한다. 바꾼 시험과 이유(흐름 변경)를 PR 본문 "시험 변경"에 적는다(3.2).
  6. 단위: `requestFlow.test.ts`, `speech.test.ts` 추가만(기존 케이스 불변 = 챗봇 회귀 방지).
  7. `CLAUDE.md` 지도 lib 줄에 `requestFlow.ts`, 시험 도우미 줄에 `flowA.ts`.
- **도구·명령**: `npm run check`, `npm run test:e2e`.
- **산출물**: 위 파일, PR(base `stage/demo1`).
- **검증**: `check` 0, `test:e2e` 0(가짜 음성 입력 기준; `chat.spec.ts` 20개 통과 수 그대로). `git diff github/main --stat -- apps/web/src/lib/prompt.ts apps/web/src/lib/chat.ts apps/web/src/app/api/chat` → 0(C13).
- **합격 기준(Codex용)**: 가짜 음성 입력으로 시작하기 → 질문 1/3·2/3·3/3이 차례로 나오고, 질문마다 들은 문장 확인("다음 질문"/"완료")과 다시 말하기가 되며, 두 번 못 들으면 입력창으로 바뀌고 입력창 답도 확인 단계를 거친다. 질문 1에서 품목(헤드셋)이 없는 답은 넘어가지 않고 안내가 나온다. 요약 화면에 세 답이 보이고 "봉사자 매칭 요청"을 누르면 기존 매칭 → 연결 → "봉사자 화면으로(시연)"으로 이어진다. 답하는 동안 어떤 네트워크 요청도 없다(`page.route`로 확인). 봉사자 챗봇 시험 20개가 단언 내용 변경 없이(봉사자 화면 진입 경로를 `completeFlowA` 도우미로 바꾼 것뿐이고 PR 본문 "시험 변경"에 명시) 전부 통과하고, `prompt.ts`·`chat.ts`·`api/chat` 코드는 바뀌지 않았으며 각 화면 axe 0건이다. 바뀐 기존 시험은 PR 본문 "시험 변경"에 이유가 있고 느슨해지지 않았다.
- **스크린샷**: 질문 1 화면 1장, 요약 화면 1장.
- **예상**: 배정 70분(구현 45 + 검증 15 + 끝 10. notes C7의 15+15+10+15+15 = 70과 합계가 같고 3.5가 그 안에 들어간다). 끝 상한 = min(실제 시작 + 70분, 표 상한 05:40), 작업 멈춤 = 끝 상한 − 10분(3.6). 시작 때 작업 메모에 두 값을 적는다.
- **병렬**: 1·2(speech)와 3(requestFlow)은 독립. 4는 1~3 뒤. 5·6은 4와 동시에 써도 된다.
- **포기 순서**: `user-screen.spec.ts` 신규 사례 중 44px·axe 반복을 intro·요약 2곳으로 축소 → 스크린샷 1장(질문 1만). 질문 2·3 확인 분기, 입력창 답의 확인 단계, 질문 1 품목 검사는 빼지 않는다(notes C7 "빼지 않음", human.md:91).
- **막혔을 때**: `chat.spec.ts`가 같은 오류로 3회 실패하면 멈춘다(notes C10). 작업 메모의 작업 멈춤 시각에 멈추고 3.5.

---

### 블록 4. 플로우 A PR 2 대기열 접수 `feat/demo2/queue` (05:40~07:00, 배정 110분 = 구현 85 + 검증 15 + 끝 10, 표 상한 07:00, 작업 멈춤 06:50, 동결 06:35)

human.md:80, 86, 88(포기 순서), 결정 5·6·11. notes-flow-a.md C1(PR 2), C2(checking·registering·queued·다시 열기 행), C3, C4는 **129-141·149-155 갱신 절(Supabase)로 대체**, C5, C6(PR 2 부분), C10. TSD §8.3·§8.4.

- **입력**: progress.md 블록 3 항목(PR 1 상태, `stage/demo1` 상태), 블록 0의 `db push 허락`.
- **시작 브랜치 분기**(human.md:32, `.claude/rules/pr-flow.md` "보류 PR 위에 쌓기". 이 PR은 PR 1의 질문 흐름 코드에 의존한다):
  | 블록 3 결과 | 시작 | PR base |
  |---|---|---|
  | `stage/demo1`이 main에 병합됨 | `stage/demo2` ← `github/main`, `feat/demo2/queue` ← `stage/demo2` | `stage/demo2` |
  | PR 1이 `stage/demo1`에 병합됐지만 단계 PR이 main에 아직 없음 | `stage/demo2` ← `github/stage/demo1`, `feat/demo2/queue` ← `stage/demo2` | `stage/demo2`(human.md:32 이용자 결정이 `pr-flow.md` "단계 브랜치는 최신 main에서"보다 우선. 결과: `stage/demo2` → main 단계 PR에 demo1 커밋이 섞이고, `stage/demo1`이 squash로 main에 들어간 뒤 `stage/demo2`가 충돌한다(11/4 morning-report.md:59). 아침에 `stage/demo1` 단계 PR을 먼저 main에 병합한 뒤 `stage/demo2`에 main을 병합(`-X ours` 아님, 손으로)해야 단계 PR이 깨끗하다. 블록 6 보고 3·10절에 적는다. 블록 6 통합 순서에서도 `stage/demo1` → `stage/demo2` 병합은 중복 커밋을 가져오므로 `stage/demo2`만 넣는다) |
  | PR 1이 보류(`stage/demo1`에 코드 없음. 훅 미수정이면 기본 경로) | `stage/demo2`를 만들지 않는다. `feat/demo2/queue` ← `github/feat/demo1/questions` | `feat/demo1/questions`(hold-morning 확정). human.md:32("`stage/demo2`를 `stage/demo1`에서 딴다")와 다른 이유: PR 1 코드가 `stage/demo1`에 없어 거기서 따면 질문 흐름이 없다(`pr-flow.md` "보류 PR 위에 쌓기" 적용). 아침 절차: 사람이 PR 1을 `stage/demo1`에 병합 → `stage/demo2`를 `stage/demo1`에서 만들어 푸시 → PR 2 base를 `stage/demo2`로 변경 → `stage/demo2`를 `feat/demo2/queue`에 병합(`-X ours`, 강제 푸시 금지. pr-flow 셋째 불릿). 블록 6 보고 3과 5절 아침 표에 같은 문장 |
  | 블록 3 미완료로 PR 1 자체가 없음 | 이 블록은 질문 답을 받을 곳이 없다. PR 2를 건너뛰고 블록 3 남은 일(합격 기준)을 이 시간에 한다 | - |
- **시작 때 시간 산수**(3.6): 남은 시간 R = 06:50(작업 멈춤) − 실제 시작(분). R ≥ 110이면 전체. 95 ≤ R < 110이면 포기 ①. 60 ≤ R < 95면 포기 ①로 진행하되 **Supabase 구현은 유지하고**(결정 5·11) 범위를 더 줄이지 않고 작업 멈춤 06:50을 엄수한다(미완료 허용. 표대로 블록 3이 05:40에 끝나면(3.5 포함) R = 70이라 이 구간이 기본 경로다). R < 60이면 포기 ②(PR 2 전체 다음 밤) → 블록 3 남은 일이 있으면 그것을, 없으면 블록 6(또는 3.6 조건의 블록 5)을 바로 시작한다. 결정과 R을 progress.md에 적는다.
- **읽을 TSD**: §4(TSD:111-113, 127), §5(TSD:147-154), §8 공통(TSD:229), §8.1(TSD:234), §8.3 requests 표·register_request(TSD:258-274, 302-313), §8.4(TSD:315-322), §10 저장소(TSD:424), §11 마이그레이션·공유 DB(TSD:434-437).
- **할 일**
  1. 저장소 루트에서 `timeout 60 supabase init </dev/null`(이미 `supabase/`가 있으면 건너뜀. TTY면 VS Code·IntelliJ 설정 생성을 묻는 것으로 알려져 있다(미확인). 그래서 stdin을 닫고 60초 제한을 둔다. 블록 0이 기록한 비대화형 플래그가 있으면 그것을 쓴다. `timeout`은 GNU coreutils 명령이다. Git Bash에 없으면 `timeout 60`을 빼고 `</dev/null`만 붙인다(PowerShell의 `timeout`은 다른 명령이다)) → `timeout 60 supabase link --project-ref zdnlhnzybbuloquzxwkg </dev/null`(비밀번호를 물어 멈추거나 timeout으로 끝나면 중단, "물음" 기록) → `supabase migration new requests`. `supabase init`이 만드는 `supabase/.gitignore`(`.temp/` 제외)도 커밋하고, 같은 PR에서 저장소 루트 `.gitignore`에 `supabase/.temp/` 줄도 추가한다(다른 브랜치에서도 `supabase/.temp/`가 untracked로 보이지 않게. 없으면 3.1의 3이 깨진다). 파일 `supabase/migrations/<시각>_requests.sql`에 TSD:258-274의 `requests` 열 **전부**(플로우 B 열 포함), 인덱스 `(status, created_at)`, RLS 켬·정책 없음, `register_request(...)` 함수(TSD:302-306, 312: `security invoker`, `set search_path=''`, revoke/grant service_role, 같은 `client_request_id`면 `existing`, 아니면 `queue_date = (now() at time zone 'Asia/Seoul')::date`의 다음 번호 삽입(unique 충돌 시 1회 재시도), 반환 열 `out_` 접두, 호출 때 `waiting` 24시간 → `expired`, `expired` 24시간 → 삭제 TSD:300. **human.md:91 "하루 뒤 자동으로 지우고"와 다르다**(생성 48시간 뒤 삭제). TSD대로 만들되 PR 본문과 아침 보고 10절 "결과 보관 기간"에 함께 올린다, 9절). `condition_kind`는 서버가 `새|신품 → new`, `중고 → used`, `상관|아무 → any`, 그 외 null로 정규화(AI 결정, TSD:267). `results` 표와 claim/release/complete는 만들지 않는다(TSD §12 4·6번). `supabase/.temp/`가 `git status --short`에 없음을 확인.
  2. **원격 적용**: `db push 허락: 예`일 때만 `supabase db push --linked`. 비밀번호를 묻거나 실패하면 1회만 더 시도하고 멈춤 조건(6절) → 흉내. 성공하면 `supabase migration list --linked`로 확인. `아니오`면 하지 않고 PR 본문 "사람 판정 대기"에 "마이그레이션 원격 적용"을 적는다. 보류 PR의 표가 운영 DB에 먼저 들어가는 위험은 새 표라 기존 데이터 영향이 없다고 PR 본문에 적는다(TSD:435).
  3. `src/lib/requestStore.ts`(`server-only`): 인터페이스 `register({clientRequestId, product, budget, condition, brand, item, conditionKind}) → {outcome: "created"|"existing", requestId, queueNumber, status}`, `get(requestId) → row | null`, `storeKind(): "supabase"|"memory"`, `persistent: boolean`. 메모리 구현(globalThis Map, 시계 주입, KST 날짜별 번호, 같은 id → 같은 번호, 24h 만료). Supabase 구현(`@supabase/supabase-js` 설치·버전 고정, URL `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`, 키 `SUPABASE_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`, `rpc("register_request", …)`, 반환 배열·0행을 래퍼에서 맞춤 TSD:464). 선택: `STORE_MODE=memory`(production에서는 무시, TSD:153) → 메모리, 아니면 두 변수가 있으면 Supabase, 없으면 메모리(TSD:154). 값은 존재 여부만. **자동 전환(흉내의 실제 장치)**: Supabase 구현의 첫 RPC가 함수·표 없음 오류(PostgREST `PGRST202`, Postgres `42883`·`42P01`)를 돌려주면 그 프로세스는 메모리 구현으로 떨어지고 `/api/health`의 `store`는 `memory`를 돌려준다. 표가 생기면 재배포 없이 다음 인스턴스부터 Supabase로 간다. 이 코드가 없으면 production(변수 16개 있음, `STORE_MODE` 무시)에서 `db push` 전·허락 `아니오`일 때 `POST /api/requests`가 503 `store_unavailable`이 되어 공개 완주가 실패한다. 그래서 **포기 순서에서도 빼지 않는다**. 다른 오류(네트워크, 권한)는 전환하지 않고 503이다.
  4. `src/app/api/requests/route.ts`(POST)와 `src/app/api/requests/[requestId]/route.ts`(GET): notes C4 검사 순서(쿠키 401 → 429+Retry-After → 400 `invalid_request` → 400 `too_long` → 422 `need_item`(`parseRequest` 보조 검사) → 503 `store_unavailable`), 201/200 본문 TSD:319, GET 200/400/404/401/429/503 TSD:320(메모리면 404에 `persistent:false`). 실패 본문 `{ok:false, error}`(TSD:229). Next 16 `params`는 Promise(설치 문서로 확인). 응답 헤더 `Server-Timing: store;dur=<ms>`(결정 11의 Supabase 쪽 시간). 로그는 상태·ms만, 이용자 답은 남기지 않는다.
  5. `src/lib/requestRecord.ts`(localStorage `lh.request.v1`, try/catch, notes C3), `requestFlow.ts`에 `registering/queued/checking` 추가, `page.tsx`에 notes C2 표의 registering·접수 실패·queued·checking·다시 열기 행. 매칭 버튼 → `POST /api/requests`(세 답 + `clientRequestId`, 10초, 실패 시 답·id 유지, 같은 id 재전송). 앱 열 때 기록 있으면 `checking` → GET → `waiting(n)`/`requestGone`/`checkFailed(n)`(결정 6). `DemoHandoff.tsx`: 누르면 `requestMatch(제품 답)` → `saveMatch` → `/volunteer`(notes C1). "새 요청하기"는 기록만 지움. STATUS 신규 문구는 끝에 추가(블록 3과 같은 규칙).
  6. `api/health/route.ts`에 `store: "supabase" | "memory"` 추가(TSD:234). **함께 고칠 시험**: `public.spec.ts:57-62`(키 집합에 `store` 추가), `routes.test.ts:62-66, 74-78`(본문에 `store` 추가). 블록 2가 `extractEngine`을 같은 자리에 더하므로 통합 때 한 줄 충돌이 예상된다(블록 6). 이유를 PR 본문 "시험 변경"에 적는다.
  7. `playwright.config.ts` webServer env에 3.2의 두 줄(이미 있으면 건너뜀). `test:public`에는 적용되지 않음(BASE_URL 경로)을 안다.
  8. 시험(notes C6 PR 2 부분, 가짜 음성 입력·메모리 저장소 기준): 단위 `requestStore.test.ts`(메모리: 번호 증가·같은 id 같은 번호·TTL·날짜 리셋; Supabase: 가짜 RPC 클라이언트 주입으로 함수 이름·인자·배열/0행·오류 TSD:424, **가짜 RPC가 `42883`/`PGRST202`를 내면 memory로 전환하고 `storeKind()`가 `memory`, 다른 오류면 전환하지 않음**), `requestsRoute.test.ts`(POST 201/400×2/422/401/429+Retry-After/503/재전송 같은 번호/로그에 답 없음, GET 200/400/404 `persistent`/401/503), `requestRecord.test.ts`, `requestFlow.test.ts` 추가, health `store`. e2e `match.spec.ts`에 POST 본문·대기번호 낭독·두 번째 +1·`page.route` 500/네트워크 실패 → `registerFailed` → 같은 `clientRequestId`·같은 번호(C12)·401/429 문구·이어 보기 → `/volunteer`; 신규 `resume.spec.ts`(reload → waiting(n), 새 요청하기 → intro, GET 404 → 삭제+requestGone, GET 실패 → checkFailed). `public.spec.ts`의 기존 완주 사례를 플로우 A로 바꾸고(블록 2가 더한 "④ 올리기·요약 완주" 사례는 다른 단계 브랜치라 이 브랜치에 없다. 통합 때 둘 다 살린다, 블록 6) `/api/health` `store` 값을 출력에 적는다(`memory`면 실패 아닌 "흉내"). axe를 queued 화면에도.
  9. `CLAUDE.md` 지도에 `supabase/` 줄(저장소 지도 표)과 lib 줄에 `requestStore.ts`, `requestRecord.ts`.
  10. 배포(3.4) → health `store` 확인(`memory`면 흉내·preview target 되돌아감 의심, 환경 변수는 손대지 않음) → `BASE_URL=… npm run test:public`로 완주 1회. 기록할 것(C14·C15): `store` 값, `POST /api/requests` 1회와 GET 2회(둘째가 웜 값)의 `Server-Timing` store ms와 클라이언트 왕복 ms — **결정 11의 "Supabase 호출 시간"**, 이어 보기 뒤 챗봇 Groq ms. production은 `STORE_MODE`를 무시하므로 표가 있으면 실제 Supabase로 가고, 표가 없으면(허락 `아니오`·`db push` 실패) 할 일 3의 자동 전환으로 `store: memory` 흉내 완주가 된다. 어느 쪽인지 `store` 값으로 기록한다.
- **도구·명령**: `supabase init|link|migration new|db push --linked|migration list --linked`, `npm i @supabase/supabase-js`, `npm run check`, `npm run test:e2e`, `vercel deploy --prod --yes`, `BASE_URL=… npm run test:public`.
- **산출물**: `supabase/{config.toml,.gitignore,migrations/*.sql}`(`git add supabase/config.toml supabase/.gitignore supabase/migrations/*.sql`), 루트 `.gitignore`(`supabase/.temp/` 줄), `src/lib/{requestStore,requestRecord}.ts`, `src/app/api/requests/{route,[requestId]/route}.ts`, `page.tsx`·`requestFlow.ts`·`DemoHandoff.tsx`·`health` 갱신, 시험, `CLAUDE.md`, PR, 배포·완주 기록.
- **검증**: `check` 0, `test:e2e` 0(가짜 음성 입력·메모리 저장소 기준), `test:public` 0(실제 저장소 또는 "흉내" 기록, Groq 1회), C12 사례 이름, `git status`에 `supabase/.temp` 없음, 챗봇 기존 시험 통과(C13).
- **합격 기준(Codex용)**: 가짜 음성 입력 기준으로 세 질문 → 요약 → 봉사자 매칭 요청 → "접수됐습니다. 대기번호 N번" → 앱을 다시 열면(reload) "대기번호 N번, 봉사자를 기다리고 있습니다" → "봉사자 화면으로(시연)" → 봉사자 챗봇까지 시험이 통과한다. 세 답과 `clientRequestId`를 한 번에 보내 201과 대기번호를 받고, 같은 `clientRequestId`를 다시 보내면 200과 같은 번호를 받으며 번호가 둘로 늘지 않는다. 서버 500·네트워크 실패 뒤 답이 그대로 남고 다시 누르면 같은 id로 재전송된다. 404면 기록을 지우고 첫 화면, 조회 실패면 저장 번호로 안내한다. `POST /api/requests`는 401, 400, 422, 429(+`Retry-After`), 503을 돌려주고 이용자 답을 로그에 남기지 않는다. 마이그레이션 SQL이 TSD §8.3의 `requests` 열 전부와 `register_request`(같은 id → `existing`, 날짜별 번호, 서버 키만 실행)를 담는다. `/api/health`가 `store` 종류만 돌려주고 키 값은 어디에도 없다. 봉사자 챗봇 기존 시험은 그대로 통과한다. 공개 주소 완주 기록에 `store` 값과 Supabase·AI 호출 시간이 있다.
- **스크린샷**: 접수 완료(대기번호) 화면 1장, 다시 열기 화면 1장.
- **예상**: 배정 110분(구현 85 + 검증 15 + 끝 10. notes 갱신 140행: Redis안 80분 + 30분). 끝 상한 = min(실제 시작 + 110분, 표 상한 07:00), 작업 멈춤 = 끝 상한 − 10분(늦어도 06:50)(3.6). 시작 때 작업 메모에 두 값과 R을 적는다.
- **병렬**: 1·2(마이그레이션)와 3(store)은 독립. 4는 3 뒤. 5는 3·4와 동시에 화면만. 6·7은 아무 때나. 8은 4·5 뒤. 10은 PR 푸시 뒤.
- **포기 순서**(human.md:88의 두 단계 그대로): ① 다시 열 때 서버 조회 빼기(`checking`·GET 라우트·`resume.spec.ts` 제외, 기록된 번호만 낭독, −15분. human.md:88, notes 갱신 140행) ② PR 2 전체 다음 밤(PR 1만으로 시연 가능. human.md:88). 빼지 않음: **Supabase 구현(결정 5. 결정 11의 Supabase 호출 시간 측정도 여기에 걸린다)**, 실패 시 답 유지, 재시도 같은 번호, 챗봇 기존 시험 통과(notes C7), 할 일 3의 메모리 자동 전환(없으면 production 완주가 503). "Supabase 구현을 빼고 흉내"는 포기 단계가 아니다(9절 10 제안. human.md:96의 흉내는 연결을 못 했을 때의 대체다).
- **막혔을 때**: `db push`가 비밀번호·권한으로 막히면 1회 재시도 뒤 흉내(멈춤 조건). `rpc` 반환 모양이 달라 3회 실패면 흉내. `@supabase/supabase-js` 설치·빌드 실패 → 같은 오류 3회면 멈춤 조건으로 메모리 구현만으로 진행·기록(포기 단계가 아니라 멈춤이다. 6절). "연결함"인데 `store=memory` → 기록, 흉내로 계속, 환경 변수 손대지 않음. 06:35 동결, 06:50(작업 멈춤)에 반드시 멈추고 3.5(자식 대기는 3.5의 7대로 15분 안).

---

### 블록 5. ③ 탐색 조언 `feat/demo3/search-advice` (조건부: 블록 4가 progress.md 항목을 쓰는 시각 t에서 T = t + 10분(3.5 완료 예상)으로 잡고 06:50까지 60분 이상 남을 때(3.6). 배정 60분 = 구현 35 + 검증 15 + 끝 10, 표 상한 07:00, 작업 멈춤 06:50)

human.md:122, 128, 132, 결정 10. TSD §8.2(236-254), §8.6(336-346), §9(400-411), §12 3a(448, 455).

- **입력**: progress.md 블록 4 항목(3.5 완료 예상 T = 항목 작성 시각 + 10분, 06:50 − T ≥ 60 확인(3.6), `다음 블록: 5`). ④ PR이 `volunteer/page.tsx`를 고쳤으므로 이 블록은 **`volunteer/page.tsx`·`VolunteerChat.tsx`·`speech.ts`를 고치지 않는다**(TSD:455).
- **시작 브랜치**: `stage/demo3` ← `github/main`, `feat/demo3/search-advice`. PR base `stage/demo3`.
- **할 일**
  1. `src/lib/volunteerRequest.ts`: `VolunteerRequestView` 타입(TSD:241-251)과 `lh.match.v1` 어댑터(TSD:254). 화면에는 아직 붙이지 않는다.
  2. `src/lib/chat.ts`·`api/chat/route.ts`: 선택 필드 `hasBudget?: boolean`, `condition?: "new"|"used"|"any"|null`(TSD:342), `MAX_BODY_BYTES` 2048 → 4096(TSD:344). 예산 숫자는 받지 않는다(TSD:343).
  3. `src/lib/prompt.ts`: 마지막 줄("이용자 요청의 브랜드와 품목은…") **바로 앞에만** TSD:406-408의 문구 줄을 넣는다(TSD:404). 값이 없으면 v1과 글자 하나 다르지 않음을 단위 시험으로 고정(`endsWith` 시험 유지 + "값 없으면 v1과 같다" 시험 추가).
  4. `tests/chatbot/questions.json`에 hasBudget·used 맥락 질문과 예산 숫자 유도 질문을 더한다(20개 유지 + 3~5개, TSD:411). 가격 정규식은 완화하지 않는다.
  5. `npm run test:chatbot` 실제 Groq(7초 간격, 질문 수만큼 호출, `gpt-oss` 누계에 더한다). 위반이 나오면 지시문 줄을 고치고 다시(실패 1회씩, 같은 위반 3회면 멈춤). 결과 `test-results/chatbot-<시각>.json`을 `test-results/<PR>-test-chatbot.txt`와 함께 기록.
  6. e2e `chat.spec.ts`에 선택 필드 있는 요청·없는 요청 사례 추가(mock). **새 사례는 파일 끝에 새 `describe`로만 추가한다**(블록 3이 같은 파일의 진입 경로 54-76·412-436을 고치므로 통합 충돌을 줄인다. 블록 6 할 일 2). **배포·공개 완주 없음**: 이 블록은 배포하지 않으므로(3.4) 배포 없이 돌리는 `test:public`은 블록 5 코드가 없는 production을 쳐서 ③ 검증이 아니다. 실제 호출은 `test:chatbot`뿐이다. human.md:122의 "공개 주소에서 끝까지 1회 돌린 기록"은 이 블록에서 채우지 못하므로 PR 본문에 `공개 완주 없음(화면 불변. human.md:122 미충족, 블록 6 통합 배포 뒤 또는 다음 밤)`을 적고 C3 판정에 `미완료` 항목으로 반영한다. 블록 6 통합 배포에 이 브랜치가 들어가면 블록 6 할 일 3의 재완주에서 `public.spec.ts` 끝에 더한 사례 "③ 선택 필드 호출"(`openVolunteer` 도우미로 쿠키를 받은 뒤 `page.request.post('/api/chat', {context:{brand,item,hasBudget:true,condition:'used'}})` 1회, Groq 1회를 누계에 더함. 200과 세 항목·가격 0건 확인)을 돌려 기록한다. 그 사례도 이 PR에 파일 끝 `describe`로 넣어 둔다.
- **도구·명령**: `npm run check`, `npm run test:e2e`, `npm run test:chatbot`.
- **산출물**: 위 파일, PR(base `stage/demo3`), `test-results/<PR>-test-chatbot.txt`와 답변 원문.
- **검증**: `check` 0, `test:e2e` 0, `test:chatbot` 전부 통과(`answerRules` 위반 0, 오류 null).
- **합격 기준(Codex용)**: `/api/chat`가 `hasBudget`·`condition` 선택 필드를 받아 지시문에 예산 있음/없음과 새 제품·중고 조건 문구만 넣고 금액은 넣지 않는다. 두 값이 없으면 지시문이 v1과 한 글자도 다르지 않다(단위 시험). 늘린 고정 질문 전부의 답(기록 JSON)에 검색어·확인할 조건·찾는 순서가 있고 가격·재고·없는 모델명이 0건이다. `MAX_BODY_BYTES`는 4096이다. 기존 e2e 챗봇 시험이 그대로 통과한다.
- **스크린샷**: 없음(화면 불변).
- **예상**: 배정 60분(구현 35 + 검증 15 + 끝 10. human.md:128 "약 1시간"). 끝 상한 = min(T + 60분(≈ 실제 시작 + 60분), 표 상한 07:00), 작업 멈춤 = 끝 상한 − 10분(3.6). 구현 35분에 할 일 1~6(`test:chatbot` 23~25문항 × 7초 ≈ 3분, 재시도 포함)이 빠듯하므로 포기 순서를 일찍 적용한다.
- **병렬**: 1·2·3은 독립. 4는 3 뒤. 5는 4 뒤. 6은 2 뒤.
- **포기 순서**: 추가 질문 수 5 → 3(이유를 PR 본문에) → e2e 선택 필드 사례 축소(단위 시험은 유지) → **검증 15분 안에 못 끝나면 PR을 열지 않고 브랜치만 푸시하고 기록한다**(`미완료`, 다음 밤이 PR을 연다). 빼지 않음: "값 없으면 v1과 같다" 단위 시험, 가격 정규식 유지.
- **막혔을 때**: 06:35 동결. 06:50(작업 멈춤)에 멈추고 `미완료`로 PR을 열거나(시험 기록이 있을 때) 브랜치만 푸시하고 기록한다(3.5의 자식 대기는 15분 안, 3.5의 7). Groq 429는 6절 Groq 429 행대로(3회 연속 → 60초 대기 1회 → 재실패면 중지) `test:chatbot`을 멈추고 `미완료`.

---

### 블록 6. 마무리 (07:00~08:00, 늦어도 07:00 시작) — 새 기능 금지

human.md:19-21, 27-28, `.claude/rules/overnight-loop.md` "아침 보고".

- **입력**: progress.md 전체(브랜치 `docs/overnight-1109`), PR 목록(`gh api repos/IBORY-PURPLE/Lighthouse_Dev/pulls?state=all`), 배포 기록, `results-vision.md`(progress.md 블록 1 항목의 `결과표 위치:` 줄대로 `git fetch github && git show github/stage/demo4:docs/plans/2026-11-09-overnight/results-vision.md`(AI 병합됐을 때. head 브랜치는 지워진다) 또는 보류면 `github/feat/demo4/experiment:…`), 블록 0의 `통합 배포 푸시 허락:`과 안전망 예약 ID. 시작 경로는 셋 중 하나다: 앞 블록이 3.5로 직접 시작, 블록 4·5 항목의 `다음 블록: 6`을 읽은 안전망, 또는 **07:15 이후 앞 블록의 `.finished`를 확인한(07:45 뒤에는 확인 없이) 안전망**(3.5 끝 문단). 어느 쪽이든 3.1의 2대로 `.started`에 시작 줄을 먼저 덧붙인다. 프롬프트 첫 줄에 `앞 블록 미종료 가능성`이 있으면 `git status --short`로 앞 블록의 미커밋 파일이 없는지 먼저 보고, 있으면 건드리지 않고 보고 5절에 적는다.
- **할 일**
  1. 단계 PR 정리(3.3의 9)는 **통합 배포(2)와 재완주(3) 뒤 남은 시간에 한다(10분 상한)**: AI 병합된 기능 PR만 있는 단계가 있고 단계 PR이 아직 없으면 연다. 전체 시험(`check`·`test:e2e`)을 `stage/demo<N>`에서 돌려 기록하고 병합 표대로 병합하거나 `hold-morning`. 훅 미수정이면 "단계 PR 미개설(기능 PR이 단계 브랜치에 없음)"로 기록. 열린 기능 PR이 모두 라벨·Codex 댓글을 갖췄는지 확인. 시간이 없으면 열지 않고 보고에 적는다(단계 PR은 아침에 사람이 열어도 된다. 시연은 통합 배포로 된다).
  2. **통합 배포(25분 상한. 병합·`npm install`·`check`까지 15분, `test:e2e`는 배포와 병렬)**. 공개 주소에는 ④와 플로우 A가 함께 있어야 아침 시연이 끝까지 된다(human.md:28, 87). 보고 7~9절은 그동안 쓴다.
     - 단계 PR들이 모두 main에 들어갔으면: `github/main`을 체크아웃해 `check`·`test:e2e` 기록 뒤 배포(3.4).
     - 아니면: `git checkout -b deploy/overnight-1109 github/main` 뒤 시험을 통과한 최신 브랜치를 차례로 `git merge --no-ff`한다. 순서: 단계마다 `stage/demo<N>`을 먼저, 그 뒤 그 단계 브랜치에 들어가지 않은 `feat/demo<N>/*`를 PR 번호 순으로(demo4: `stage/demo4` → `feat/demo4/experiment`(`.vercelignore` 줄이 여기에만 있다) → `feat/demo4/upload-summary`; demo1·demo2: `stage/demo1` → `feat/demo1/questions` → `stage/demo2` → `feat/demo2/queue`(PR 1 위에 쌓였으면 그것 하나로 둘 다 들어온다. `stage/demo2`가 `stage/demo1`에서 따졌으면(블록 4 분기 표 2행) `stage/demo1`은 건너뛰고 `stage/demo2`만 넣는다. 중복 커밋 방지); 있으면 `stage/demo3` → `feat/demo3/search-advice`). 예상 충돌: `api/health/route.ts`와 그 시험 2개(`extractEngine`·`store` 둘 다 살린다), **`apps/web/package.json`·`package-lock.json`**(블록 1·2 `openai`, 블록 4 `@supabase/supabase-js`. package.json은 양쪽 의존성을 모두 두고 `package-lock.json`은 충돌 표식을 풀지 말고 `npm install`로 다시 만든 뒤 `npm run check`), **`tests/e2e/public.spec.ts`**(블록 2의 ④ 사례, 블록 4의 플로우 A 완주, 블록 5가 돌았으면 ③ 사례 모두 살린다), **`tests/e2e/chat.spec.ts`**(블록 5가 돌았을 때: 블록 3의 진입 도우미 교체(54-76·412-436)와 블록 5의 파일 끝 `describe` 추가 둘 다 살린다), **`CLAUDE.md`**(`apps/web/src/lib/` 행 한 줄에 블록 2·3·4가 파일 이름을 덧붙여 충돌이 확실하다. 세 쪽 이름을 모두 살려 한 줄로 합친다), `playwright.config.ts`(같은 두 줄이면 충돌 없음). `speech.ts` STATUS는 블록 3·4가 같은 사슬에서 고쳐 단계 간 충돌이 없다. `tests/e2e/helpers/volunteer.ts`(블록 2)는 이용자 화면을 거치지 않아 블록 3의 변경과 독립이다. 통합 `test:e2e`에서 시험 도우미의 진입 경로가 깨지면 그 수정은 새 기능이 아니므로 상한 안에서 허용한다. **양쪽을 모두 살리는 쪽으로 손으로 푼다. `-X ours`는 쓰지 않는다**(한쪽 기능이 사라진다). 푼 뒤 `git add <푼 파일들> && git commit --no-edit`(비대화형 셸이라 편집기를 열지 않는다). `package-lock.json`은 `npm install`로 다시 만든 뒤 `git add apps/web/package-lock.json`. `npm run check`를 돌려 기록(`test-results/deploy-check.txt`)하고 통과하면 바로 배포(3.4)하며 `npm run test:e2e`는 배포와 **병렬**로 돌려 기록한다(`deploy-test-e2e.txt`. 빌드 포함 4~7분, 11/4 progress.md:112). e2e가 실패해도 배포를 되돌리지 않고 실패 사례를 보고 5절에 적는다(첫 줄 규칙은 아니다). `통합 배포 푸시 허락: 예`면 `git push github deploy/overnight-1109`(PR 없음), 아니면 로컬에만 두고 병합 커밋 해시·부모 해시·`git diff --stat`을 보고에 적는다.
     - 25분 안에 안 되면(충돌 미해결·`check` 실패) **포기**: production은 마지막으로 통과한 배포(블록 4 또는 2)를 그대로 두고, 빠진 쪽 브랜치를 `cd apps/web && vercel deploy --yes`(preview)로 올려 두 주소를 보고에 적는다. preview에 `DEMO_ACCESS_CODE`가 없으면(401) "접근 코드 없음"으로 적는다. 통합 포기는 첫 줄 규칙 대상이다.
  3. 최종 공개 주소에서 `BASE_URL=… npm run test:public` 1회 재통과(Groq 1회, 엔진 조각 수만큼 — ④ 사례는 누계가 남을 때만 포함한다. 누계 + 예상 조각 수 ≤ 500인지 먼저 확인, 넘으면 `-g`로 ④ 사례를 빼고 돌리고 적는다. 3.6 돈). 블록 5 브랜치가 통합 배포에 들어갔으면 ③ 사례 "③ 선택 필드 호출"(블록 5 할 일 6, Groq 1회 더)도 돌려 human.md:122의 기록을 채운다. Supabase·AI 호출 ms를 다시 적는다(C15).
  4. 보고 7~9절 초안은 `test-results/overnight-1109/morning-report-draft.md`(git 무시)에 쓴다. **`deploy-test-e2e.txt`에 `exit` 줄이 생긴 뒤에만** `git checkout docs/overnight-1109 && git pull --ff-only github docs/overnight-1109 && git merge --no-edit github/main`(문서 PR이 밤사이 병합됐으면 ai.md·human.md가 들어온다. 문서 브랜치는 파일 추가만이라 충돌이 없다. 블록 0 할 일 5의 사본과 같은 내용이면 그대로 합쳐진다)을 하고 초안을 `docs/plans/2026-11-09-overnight/morning-report.md`로 옮겨 완성한다(브랜치 `docs/overnight-1109`). `test:e2e`가 도는 동안 체크아웃·병합 금지(Playwright webServer가 작업 트리에서 build·start하므로). **첫 줄 규칙**: 아래 중 하나라도 있으면 맨 첫 줄에 적는다 — 블록 이어 달리기가 끊긴 시각(human.md:69), `groqKeyConfigured: false`, 엔진 키 없음(`extractEngine: null`), 캡처·정답 메모 없음, 통합 배포 포기. 절 순서는 `.claude/rules/overnight-loop.md` "아침 보고" 1~6을 그대로 두고 7~10을 뒤에 붙인다:
     1. 시연 주소(파일 위치 `.demo-access.local`만)와 배포 브랜치·커밋·배포 ID(production. preview가 있으면 함께. 통합 브랜치면 구성 브랜치·커밋도)
     2. 시연 절차: (가) 플로우 A — VoiceOver → 시작하기 → "소니 헤드셋"(결정 7) → 예산 → 새 제품/중고 → 요약 → 봉사자 매칭 요청 → 대기번호 → 앱 닫았다 열기 → 대기번호 낭독 → "봉사자 화면으로(시연)" → 챗봇 질문. (나) ④ — 봉사자 화면에서 "상세 이미지 올리기" → 캡처 1~3장 → 조각 진행 → 초안 → 원본과 대조(human.md:63, 87, 146). 크롬 음성 실패 시 받아쓰기·사파리, 최대 3회(11/4 보고와 같음)
     3. PR 표(번호, 기능, base ← head, 판정, 실패 횟수와 목록, AI 병합/보류와 이유 — 훅 차단으로 사람 병합인 것은 `조건 충족·훅 차단`으로 구분, 사람이 볼 것). 자기 신고와 직접 확인을 구분(11/4 morning-report.md:46-51 방식). 아침 병합 순서 권고: 기능 PR → 단계 브랜치 → 단계 PR → main. 쌓인 PR 2(base `feat/demo1/questions`)는 "PR 1 → `stage/demo1` 병합 뒤 `stage/demo2`를 `stage/demo1`(main 미병합 시) 또는 main에서 만들어 푸시하고 PR 2 base를 `stage/demo2`로 바꾼 뒤, `pr-flow.md` "보류 PR 위에 쌓기"대로 `stage/demo2`를 `feat/demo2/queue`에 병합(`-X ours`, 강제 푸시 금지)"으로 적는다(블록 4 분기 표 3행)
     4. 사람 판정 항목(5절 "사람 판정 대기 항목" + 각 PR의 사람 판정 대기)
     5. 미완료와 막힌 이유(블록별, 블록 5 실행 여부 포함)
     6. 실제 사용량과 예상 차이: 시간(블록별 시작·끝 vs 표), 토큰 `미측정`(잴 수 있으면 실제 값), 주간 사용량 % 전후를 적을 수 있으면
     7. **비전 실험**: `results-vision.md` 링크(`blob/stage/demo4/…`. main에 들어갔으면 `blob/main/…`, 보류면 `blob/feat/demo4/experiment/…`. progress.md 블록 1 `결과표 위치:` 줄대로)와 요약 표 복사, 엔진 비교 결론(1위와 규칙, 표본이 작다는 단서), 참고 지표(정확도 vs 90%, 지어냄 vs 0건, 1건 시간 vs 2분, 캡처→초안 시간), **입문 메모**(블록 1 초안을 다듬어 10~15줄, human.md:19), 아이폰 자르기는 미확인
     8. **서버 지역(결정 11)**: Supabase `store` ms(POST 1회, GET 2회)와 AI(Groq·엔진) ms를 표로. 함수 지역 추정 iad1(미확인 표시). 사람이 정한다
     9. **블록 이어 달리기 결과**(방법, 끊김 여부, 안전망 발동 횟수)와 **유료 호출 수와 돈**(luna 조각 N장·Upstage 조각 N장(엔진당 상한 500장, C16)·Groq qwen·gpt-oss N회, 추정 금액 = 조각 수 × 조각 1장 단가. human.md:142의 "luna 약 14원, Upstage 약 23원"은 **상품 1개 = 조각 10장** 값이므로 조각 1장 ≈ luna 1.4원·Upstage 2.3원(÷10, 추정)으로 쓰거나 tsd-review.md:76 토큰 단가 × 실제 `usage`로 센다. OpenAI 크레딧 소모 포함, "progress.md 기준, 각 콘솔 미조회"), Supabase 마이그레이션 적용 여부와 운영 DB 상태
     10. **아침에 정해 줄 것**: 엔진 확정(실험 1위 수용 여부), 서버 지역, 훅 수정(병합 허용) 여부, db push 적용(미적용이면), Vercel 설정 불일치, 결과 보관 기간(TSD:300), `deploy/overnight-1109` 삭제(푸시했을 때)
  5. 이 파일 10절 진행 기록 표를 채운다(블록당 한 줄). 이 파일도 `docs/overnight-1109`에서 10절만 고친다.
  6. 안전망 예약 해제(블록 0이 건 방법·예약 ID대로). 해제 못 하면 보고에 "안전망 예약이 남아 있다. 사람이 해제"라고 적는다(08:00 이후에는 안전망이 아무것도 하지 않도록 블록 0에서 설계했다). `bd`가 있으면 남은 일을 이슈로, 닫을 것을 닫는다.
  7. `git add docs/plans/2026-11-09-overnight/progress.md docs/plans/2026-11-09-overnight/morning-report.md docs/plans/2026-11-09-overnight/ai.md && git commit -m "docs: 11/9 밤 진행 기록·아침 보고" && git push github docs/overnight-1109`, PR 본문을 `test-results/pr-docs-overnight.md`에 쓰고 `gh pr create --base main --head docs/overnight-1109 --title "docs: 11/9 밤샘 진행 기록·아침 보고" --body-file test-results/pr-docs-overnight.md`(비대화형 셸이라 `--body-file` 없이 열면 편집기를 못 열어 실패한다. `git commit`도 같은 이유로 `-m`), 이어서 `gh pr edit <번호> --add-label hold-morning`. 문서 PR이라 Codex 해당 없음. 사람이 읽고 병합한다. 사람은 PR 브랜치에서 보고를 읽는다.
  8. progress.md 마지막 항목(블록 6, `다음 블록: 없음`), 커밋·푸시, 종료. 08:00을 넘기지 않는다.
- **도구·명령**: `git merge --no-ff`, `git add <푼 파일들> && git commit --no-edit`(충돌 해결 뒤), `git merge --no-edit github/main`, `npm install`(lock 재생성 때), `npm run check`, `npm run test:e2e`, `vercel deploy --prod --yes`, `vercel deploy --yes`(preview), `BASE_URL=… npm run test:public`, `gh pr create --body-file`, `gh pr edit --add-label`.
- **산출물**: `morning-report.md`, ai.md 10절, 배포(또는 두 주소), 단계 PR(있으면), 문서 PR.
- **검증**: `test:public` 종료 0(또는 실패 기록), 보고 절 순서가 규칙 1~6 + 추가 7~10, 첫 줄 규칙 적용, 보고에 접근 코드·키 값·캡처 경로 0건.
- **예상**: 60분.
- **병렬**: 2 → 3 → 1 순서(통합 배포와 재완주가 먼저, 단계 PR 정리는 남은 시간에). 4의 7~9(결과표·입문 메모·지역·호출 수)는 2의 `test:e2e`·배포를 기다리는 동안 `test-results/overnight-1109/morning-report-draft.md`에 쓴다. `deploy-test-e2e.txt`에 `exit` 줄이 생긴 뒤에만 `docs/overnight-1109`로 체크아웃·병합하고 초안을 옮긴다(`test:e2e`가 도는 동안 체크아웃·병합 금지). 완주 결과·배포 커밋만 마지막에 채운다.
- **막혔을 때**: 08:00에 끝낸다(3.6: 블록 6만 min 규칙의 예외). 통합 배포·완주가 실패해도 보고는 쓴다. 보고가 최우선이다.

## 5. 사람 차례

### 자기 전 (약 60분 + 추가 약 15분, human.md:24, 42, 125, 블록 0 "예상". 추가 15분은 human.md에 없는 시간: 세 허락 답 5분, 훅 허락 시 직접 편집·시험·PR 병합 약 10분, 문서 PR 병합 2분)

| 할 일 | AI에게 넘길 것 |
|---|---|
| 11/9 ai.md·human.md 문서 PR(브랜치 `claude/cloud-brief-ai-plan-pim0gp`, 2026-11-09 기준. PR이 열리면 그 head 브랜치)을 main에 병합(블록 0 점검에서 없다고 하면. 약 2분) | 병합 여부 |
| OpenAI 키를 PC의 **`GROQ_API_KEY`가 들어 있는 바로 그 파일**(파일 이름은 사람이 안다. 저장소 문서는 `apps/web/.env.local`·`apps/web/.env`·루트 `.env`로 서로 달라 AI는 위치를 모른다, 2절 미확인. Next가 읽으려면 `apps/web/` 아래 `.env` 또는 `.env.local`이어야 하고 루트 `.env`는 실험 서버만 읽는다)과 Vercel production에 `OPENAI_API_KEY`로 등록. 파일 이름을 AI에게 말해 준다(AI는 열지 않는다). 크레딧 잔액을 한 번 본다. 되면 Upstage 가입 후 `UPSTAGE_API_KEY`도(카드·유료 요구면 중단). AI는 값을 입력·확인하지 않음 | "등록함/못 함" 엔진별, 크레딧 대략 |
| 헤드셋 3~5개 상세 캡처(쿠팡+1곳, 폰 캡처 여러 장, 되면 원본 1장), 그중 3개 정답 메모 `answer.md`를 저장소 루트 `test-results/vision-samples/<상품>/`에, 공개 완주용 캡처 1장을 `test-results/vision-samples/public/sample.jpg`에 둔다. 이름·주소 보이는 화면 제외. `test-results/`는 git·배포 밖이다 | 폴더에 두었음, 상품 수 |
| 훅 `checkMerge`를 `stage/demo<N>` base도 허용하도록 고쳐도 되는지 답한다. 허락하면 AI가 쓴 diff대로 사람이 직접 편집하고 `node .claude/hooks/guard.test.js`를 돌린 뒤 훅 PR을 병합한다(블록 0 할 일 2, 약 10분. 새 시험 케이스는 가짜 `gh` 스크립트로 돈다. 못 만들면 stage base 허용을 사람이 실제 PR에서 1회 확인) | 예/아니오(`훅 수정 허락:`) |
| 밤에 AI가 `supabase db push --linked`를 실행해도 되는지(블록 0 할 일 3) | 예/아니오(`db push 허락:`) |
| 통합 배포 브랜치 `deploy/overnight-1109` 푸시 허용 여부, 공개 주소 확인(블록 0 할 일 4) | 예/아니오(`통합 배포 푸시 허락:`), 주소 맞음 |
| 블록 이어 달리기 시험 세션 확인(human.md:42, 약 5분) | 시험 세션이 떴다/안 떴다 |
| Claude Code 로그인·Opus 5.5, PC 절전 해제 | - |
| AI 점검 통과를 보고 "00:00 시작" 또는 "지금 시작" | - |
| (끝남) Supabase→Vercel 연동, 변수 16개 production+preview(notes-flow-a.md:150, 155). human.md:84의 "자기 전 5분"은 할 일이 아니다 | - |

### 아침 (약 60분: human.md:28 30분 + 87 15분 + 129 15분. TSD 초안 읽기는 끝났으니 엔진 확정·보고 읽기에 쓴다)

| 할 일 | 볼 자료 |
|---|---|
| 보고 읽기: 첫 줄, 입문 메모와 결과표, 엔진 확정(human.md:28) | `morning-report.md` 7절, `results-vision.md` |
| 아이폰 실기기(VoiceOver): 세 질문 → 접수 → 앱 닫았다 열기 → 대기번호 낭독, 낭독이 음성 인식에 섞이는지(human.md:104, notes C9) | 보고 2-(가) |
| 아이폰 실기기: 캡처 1~3장 올려 긴 캡처가 잘려 올라가는지, 초안을 원본과 대조(human.md:63, 146). 결과표 3행을 원본과 표본 대조 | 보고 2-(나) |
| 보류 PR 판단과 병합. 기능 PR → 단계 브랜치, 단계 PR → main 순서. 훅이 미수정이면 모두 사람 병합. 쌓인 PR 2(base `feat/demo1/questions`): PR 1 → `stage/demo1` 병합 뒤 `stage/demo2`를 `stage/demo1`(main 미병합 시) 또는 main에서 만들어 푸시하고 PR 2 base를 `stage/demo2`로 바꾼 뒤, `pr-flow.md` "보류 PR 위에 쌓기"대로 `stage/demo2`를 `feat/demo2/queue`에 병합(`-X ours`, 강제 푸시 금지) | 보고 PR 표(3절), `gh pr list --label hold-morning`, Codex 댓글 |
| 정해 줄 것: 서버 지역(결정 11), 훅 수정, 마이그레이션 원격 적용(밤에 못 했으면), Vercel 설정 불일치, 결과 보관 기간 | 보고 8절, 10절 |
| `deploy/overnight-1109` 브랜치 삭제(푸시했을 때) | 보고 1절 |

### 사람 판정 대기 항목 (AI가 판정하지 않는다. `.claude/rules/success-criteria.md` "사람 판정 항목")

- 실제 아이폰 음성 인식, VoiceOver 낭독 겹침(질문 3개 각각), 질문 사이 초점 낭독 한 번, 요약 두 번 읽힘 여부(notes-flow-a.md C9).
- 실제 아이폰에서 긴 캡처 자르기(canvas 한도, TSD:471), 초안을 원본과 대조한 결과, 결과표 채점의 표본 확인.
- 마이그레이션 원격 적용(허락이 없었거나 실패했을 때), 실제 DB 리허설(시연 전날, TSD:428).
- 가짜 음성·가짜 응답으로 통과한 시험은 모두 `가짜 음성 입력 기준`·`가짜 응답 기준`이라 밝힌다.

## 6. 멈춤 조건

밤사이 사람에게 물을 수 없다. "멈춤"은 기록하고 `미완료`로 둔 채 다음 블록으로 가거나 종료하는 것이다. 다음 블록은 시작한다(human.md:41). 우회하지 않는다.

| 상황 | 처리 | 근거 |
|---|---|---|
| 같은 명령·같은 오류 3회 | 멈추고 원인·시도·다음 할 일 기록, PR은 열어 둔 채 다음 블록 | `.claude/rules/success-criteria.md` "막혔을 때" |
| 작업 멈춤 시각(끝 상한 − 10분, 3.6) 지남 | 같음. 3.5를 하고 다음 블록 시작 | 같음, `.claude/rules/overnight-loop.md` "시간과 토큰" |
| 06:50(블록 4·5 작업 멈춤) | 진행 중 블록 즉시 3.5(약 10분. 자식 대기·재시도는 합쳐 15분, 07:05 전 종료, 3.5의 7), 07:00에 블록 6 시작. 08:00에는 보고가 미완이어도 있는 만큼 커밋·푸시하고 종료 | 3.6, human.md:27 |
| 주간 사용량 한도 도달 | 기록하고 멈춤(추가 요금 없이). 안전망도 멈춘다 | `.claude/rules/overnight-loop.md` "시간과 토큰", human.md:57 |
| `OPENAI_API_KEY` 없음·402·크레딧 소진 | luna 중지. 블록 1은 C6 표대로 Upstage+qwen 둘로 비교(AI 결정, 9절 13. Upstage도 없으면 qwen만 → C6 `미완료`, 결론 줄 `비교 없음`). 블록 2 엔진 고르기는 Upstage. 둘 다 없으면 `extractEngine: null`, 공개 완주는 입력창 경로, 아침 보고 첫 줄 | human.md:68, 151; 결정 9; C6 |
| `UPSTAGE_API_KEY` 없음·가입 불가 | luna·qwen만 비교 | 결정 9 |
| `GROQ_API_KEY` 없음(`groqKeyConfigured: false`) | summarize 503, 챗봇 불가. 공개 완주의 Groq 부분 건너뜀, 아침 보고 첫 줄 | 11/4와 같음 |
| luna 또는 Upstage 조각 누계 500장 도달(블록 1은 400장) | 그 엔진 실제 호출 중지, 남은 칸 `미실행(예산 상한)`, 가짜 응답으로 계속. 코드 거부는 블록 1 실험 서버뿐이고 재시작하면 카운터가 0이 되므로 `--budget`에 직전 누계를 빼고 준다. production(블록 2·6 완주, 아침 시연)에는 총량 상한이 없으므로 `test:public` 전에 메모의 누계 + 예상 조각 수 ≤ 500을 손으로 확인하고, 넘으면 `-g`로 ④ 사례를 뺀다 | human.md:142; 3.6 |
| Groq 429 3회 연속 | 60초 대기 1회, 재실패면 그 블록의 Groq 실제 호출 중지, mock, 기록 | human.md:151 |
| Groq `gpt-oss-120b` 누계 200회 도달 | 실제 호출 중지, 남은 시험 mock | 11/4 상한 유지 |
| 캡처·정답 메모 없음 | 블록 1은 합성 이미지로 절차만, 결과표 `정답 메모 없음`. 아침 보고 첫 줄 | human.md:24, 61 |
| 안전 훅이 막음(`gh pr merge` base stage, `git push origin`, `.env`, `.claude/hooks` 편집 등) | 우회·훅 수정 금지(블록 0에서 사람이 고친 것 제외). 기록. 병합은 `hold-morning` + `조건 충족·훅 차단`. `gh api …/merge`로 우회하지 않음 | `.claude/rules/overnight-loop.md` "금지선", `guard.js:158, 198` |
| `gh pr view`·`gh pr list` 실패(GraphQL) | `gh api` REST로 대체(조회·PR 열기·라벨·댓글, 3.3의 2), 기록. `gh pr merge`는 훅이 어차피 막는다 | 2절 미확인 |
| `supabase link`·`db push --linked`가 비밀번호·승인을 요구, 또는 허락 `아니오` | 입력하지 않고 중단. 메모리 흉내로 공개 완주(블록 4 할 일 3의 자동 전환 때문에 production에서도 가능하다. 전환 코드가 없으면 production 완주는 503으로 끝나므로 전환 코드는 빼지 않는다), 마이그레이션 파일만 PR, 보고에 "흉내"와 "원격 적용 대기" | human.md:96, docs/human_tsd.md:31, TSD:153, 434 |
| `store=memory`인데 연결은 됐다고 들음, Supabase 503·PAUSED | 환경 변수를 손대지 않고 흉내로 계속, 기록 | notes-flow-a.md C10, human.md:109 |
| `@supabase/supabase-js` 설치·빌드 실패(같은 오류 3회) | 멈춤 조건: 메모리 구현만으로 진행·기록, PR 본문과 보고에 "Supabase 구현 미완(설치 실패)". 포기 단계가 아니다(블록 4 포기 순서는 human.md:88의 두 단계뿐) | notes-flow-a.md C10, `.claude/rules/success-criteria.md` "막혔을 때" |
| `github` 원격 없음, 로그인 실패 | 자기 전이면 사람에게(사람이 추가), 밤이면 해당 작업 멈춤. AI가 `git remote add`를 하지 않는다 | 2절 |
| Codex 실행 불가(로그인·한도·`spawn EPERM`류) | `미완료`, `hold-morning`. 건너뛰고 완료로 쓰지 않음 | `.claude/rules/pr-flow.md` "Codex 검증" |
| 시험 기록 해시가 HEAD와 다름·기록 없음 | 다시 돌려 기록 1회. 못 하면 판정 불가=`미완료` | 같음 |
| 배포 실패 3회 | 로컬 시험만으로 PR, 블록 6에서 재시도 | 11/4와 같음 |
| `test:public` 실패 | 원인 1회 수정(15분 안), 안 되면 기록. 실패 1회로 센다 | `.claude/rules/success-criteria.md` |
| 다음 블록 세션 시작 실패 | 1회 재시도, 실패면 `다음 블록 시작 실패 HH:MM` 추가 커밋 후 종료(안전망이 잇는다). 안전망도 없으면 아침 보고 첫 줄 | human.md:69, 3.5 |
| 안전망이 깨어났는데 다음 블록이 이미 돌고 있음 | 마지막 항목의 `다음 블록: M`을 읽어 `block-<M>.started`에 자식 줄이 있거나 파일이 10분 이내면 아무것도 하지 않는다(블록 번호 +1로 판단하지 않는다) | human.md:40, 3.5 |
| 안전망이 보니 `.started`에 자식 줄은 있는데 블록 M 항목이 없고 표 상한 + 15분이 지남(세션이 죽음) | 새 세션을 띄우지 않고(작업 트리 충돌 위험. 블록 0에서 세션 생존 확인 방법이 확인됐을 때만 띄움) `test-results/overnight-1109/watchdog.log`에 `블록 M 응답 없음 HH:MM` 기록. 07:15 블록 6 규칙은 그대로 | human.md:40, 3.5 |
| 통합 배포 충돌·`check`를 25분 안에 못 풂 | 통합 포기. production은 마지막 통과 배포, 빠진 쪽은 preview 주소. 첫 줄 규칙 | 블록 6 |
| 기록·로그·결과표에 키 값·접근 코드·캡처 경로·원문 이미지가 보임 | 그 파일을 지우고 다시 만든다. 커밋하지 않는다. 기록 | 3.7 |
| Vercel 프로젝트 설정·환경 변수를 바꿔야 할 것처럼 보임 | 바꾸지 않음. 기록, 아침 보고 10절 | 11/4 progress.md:33, morning-report.md:76 |
| human.md와 이 파일·TSD가 어긋나서 결정이 필요 | human.md 쪽으로 실행하고 기록, 아침 보고에 올림 | 머리말 |
| 결제, 유료 플랜, 외부 발송, 지정 밖 배포, 샌드박스 넓히기(`danger-full-access`) | 하지 않음, 기록 | `.claude/rules/overnight-loop.md` "금지선", `.claude/rules/pr-flow.md` |
| 실기기·VoiceOver가 필요한 판정 | `사람 판정 대기` | `.claude/rules/success-criteria.md` "사람 판정 항목" |

## 7. 위험과 대응

| 위험 | 대응 | 근거 |
|---|---|---|
| 블록 연결 끊김(11/4 블록 3 뒤 재현) | 블록 0 시험 세션 + 30분 안전망 두 겹, `.started` 파일로 중복 시작 방지, 둘 다 안 되면 보고 첫 줄 | human.md:37-42, 69 |
| 긴 이미지·작은 글씨가 뭉개짐. 조각이 많으면 시간·한도를 더 씀 | 블록 1이 통째 vs 타일(1200/800)을 같은 정답 메모로 재고 결과표에 적음. 블록 2는 조각 30개 상한, 한 장씩 순차 | human.md:66, TSD:395-396 |
| 한국어 상세 이미지를 엔진이 못 읽거나 지어냄. luna가 틀리게 읽으면 근거 대조도 틀린 글자를 근거로 삼음 | 실험을 먼저(결정 4), Upstage(읽기 전용, 신뢰도)와 비교, 근거 대조로 `unverified`, 초안은 봉사자 화면에만, 가격 제외 | human.md:66-67, 149 |
| 유료 호출 초과 | 실험 서버만 엔진당 조각 500장에서 코드로 거부(실험은 `--budget 400`, 재시작 때 직전 누계를 뺌. 통째를 먼저 돌리고 타일을 뒤에, 400장에 닿을 것 같으면 블록 1 포기 순서). production에는 총량 상한이 없어 호출마다 progress.md에 조각 수를 기록하고 `test:public` 전에 누계 + 예상 조각 수 ≤ 500을 손으로 확인, 넘으면 `-g`로 ④ 사례를 뺀다 | human.md:142; 3.6 |
| 실행 환경에서 `OPENAI_API_KEY`·`UPSTAGE_API_KEY`·`GROQ_API_KEY`가 안 보임(11/4 재현), 무료 한도에 걸림 | 블록 0이 실험 서버 `/api/status` 불리언과 `vercel env ls` 이름으로 확인(값 안 봄), 없는 엔진은 빼고 기록, 기능 블록은 가짜 응답으로 계속, 아침 보고 첫 줄 | human.md:68, 151; 6절 |
| 훅과 병합 규칙 충돌로 모든 기능 PR 보류, 블록 4가 쌓인 PR이 됨 | 블록 0에서 허락을 받아 사람이 고치거나, 사람 병합으로 간다. 정상 범위다. 아침 병합 순서를 보고에 | 2절, `.claude/rules/pr-flow.md` "병합" |
| 시간 산수: 배정 합계가 7시간을 30분 넘음 | 3.5(약 10분)는 배정 안의 마지막 10분이고 작업 멈춤 = 끝 상한 − 10분(3.6). 블록 4 시작 때 R(06:50 작업 멈춤 기준)로 human.md:88의 두 단계 포기 순서 적용(Supabase 구현은 유지), 06:35 동결, 블록 4·5 표 상한 07:00·작업 멈춤 06:50, 블록 6은 늦어도 07:00 | 3.6, human.md:88, 139 |
| 세 단계 브랜치가 같은 파일(health와 시험 2개, `package.json`·`package-lock.json`, `tests/e2e/public.spec.ts`, `tests/e2e/chat.spec.ts`(블록 5가 돌 때), `CLAUDE.md`, `playwright.config.ts`)을 고쳐 통합 때 충돌 | `CLAUDE.md` `apps/web/src/lib/` 행은 블록 2·3·4가 같은 한 줄을 고쳐 충돌이 확실하므로 블록 6이 세 쪽 이름을 모두 살려 합침, playwright.config은 같은 두 줄, health는 두 블록이 한 줄씩(블록 6이 손으로 합침), `openai`는 블록 1·2가 같은 섹션·같은 버전, lock 파일은 `npm install`로 재생성, `public.spec.ts`는 ④ 사례·플로우 A 완주·③ 사례 모두 살림, `chat.spec.ts`는 블록 3의 진입 도우미 교체와 블록 5의 파일 끝 `describe` 둘 다 살림, e2e 봉사자 진입 도우미(`helpers/volunteer.ts`)는 이용자 화면을 거치지 않아 독립, `speech.ts` STATUS는 블록 3·4가 같은 사슬이라 끝에 한 줄씩 붙이면 단계 간 충돌 없음, `progress.md`는 문서 브랜치에만. 통합 25분 상한(e2e는 배포와 병렬)과 preview 대체 | notes-flow-a.md:100, 11/4 morning-report.md:59, 블록 6 할 일 2 |
| 공용 부품: `SpeechInput`·`speech.ts`를 ③ 봉사자 챗봇도 쓴다 | 블록 3·4는 액션·prop·STATUS를 **추가만** 하고 기존 케이스 불변 시험으로 챗봇 회귀를 막는다(C13). `chat.spec.ts` 20개가 같은 오류로 3회 실패하면 멈춘다(notes C10) | human.md:108, notes-flow-a.md C10 |
| `rateLimit`이 인스턴스별이라 공개 주소에서 한도가 고르지 않음 | 완화 수단으로만 보고 주석·PR 본문에 적음 | `rateLimit.ts:1-16` |
| Groq 분당 한도를 ③ 챗봇과 ④ 요약이 나눠 씀 | 블록 1이 요약 429를 재고, 블록 2는 요약 LLM을 OpenAI로 바꿀 수 있게 함수 경계를 둔다 | human.md:151, TSD:98 |
| `db push`로 보류 PR의 표가 운영 DB에 먼저 들어감 | 허락 있을 때만, 새 표라 기존 데이터 영향 없음, 적용한 파일은 수정 금지 | TSD:434-435 |
| Supabase 무료 프로젝트 7일 무활동 정지, 운영·시험 DB 공유, 활성 2개 제한 | 밤에는 접수 1건 이상이 들어간다. 시연 전날 확인은 사람 | TSD:435-436, human.md:109 |
| 키·접근 코드·캡처·원문이 저장소·배포·보고에 남음 | 3.7 표 전부, 커밋 전 패턴 검사, `git add` 경로 지정 | human.md:45, TSD:155 |
| 공개 주소 남용으로 유료 엔진 호출 소진 | 접근 코드 쿠키, 봉사자 헤더 403, 분당 60/20 제한 | TSD:229, §8.7 |
| Vercel 설정이 문서와 다름 | 설정을 바꾸지 않고 `apps/web`에서 배포 | 11/4 morning-report.md:76 |
| 아이폰 canvas 한도·VoiceOver 겹침 | 밤에는 판정 못 함. 사람 판정 대기. 대체 경로는 다음 밤 | human.md:107, 150 |
| OpenAI 데이터 보관(최대 30일)과 상세페이지 보관 위험 | 밤에는 판단하지 않는다. TSD:476대로 멘토·이용자 판단 항목으로 보고 | TSD:476 |

## 8. 범위 밖

human.md:46, 92, 133을 따른다. 단 46행의 "유료 모델"은 결정 9(1.5의 1·9, human.md:138 "맨 위 정해 줄 것 1을 대신한다")로 대체돼 luna·Upstage 유료 호출은 엔진당 조각 500장(상품 50개분, 최대 약 2천 원. human.md:142, 3.6 돈) 안에서 한다. 아래는 하지 않는다.

- ⑤ 요약 대조·수정 화면, ⑥⑦ 이용자에게 결과 보내기·결과함, 요약 저장·재사용
- 플로우 B ② 대기열 화면·요청 선택·알림
- 대기열에서 앞에 몇 명 남았는지 알려 주기(결정 6)
- 플로우 A(블록 3·4)는 예산·새 제품·중고 답을 봉사자 화면·챗봇에 넘기지 않는다(human.md:92. `lh.match.v1`에는 brand·item·raw만. 블록 4 `DemoHandoff`는 제품 답만 `requestMatch`에 넘긴다). 예산 "있음/없음"과 조건 종류를 `/api/chat`에 넘기는 것은 ③ 블록 5(조건부)만이고, 예산 금액은 어디에도 넘기지 않는다(human.md:132)
- 생김새 설명(qwen), 아이폰 canvas 실패 때 Storage 대체 경로(`storagePath`), 정답지 10~20개 정확도 측정
- 서버·AI의 쇼핑몰 접속, 원본 이미지·읽은 글자·초안의 서버 저장, 실험 캡처의 저장소 커밋
- 요약에서 답 고치기, 앱이 직접 소리 내 읽기, 품목 사전 넓히기
- `apps/web/vercel.json` `regions` 변경, Vercel 설정·환경 변수 변경, Supabase CLI 업그레이드, `results` 표·claim/release/complete 함수
- 훅 파일을 AI가 편집하는 것, `git remote add`, 사람 실기기 시험의 대체, 다음 밤 우선순위 결정

## 9. 제안 (실행 기준 아님, 사람이 정하면 반영)

1. **훅 `checkMerge`와 `pr-flow.md` 병합 표의 정합**: 규칙은 기능 PR을 AI가 단계 브랜치에 squash 병합하라 하고 훅은 막는다(`guard.js:158`). 블록 0에서 허락을 받아 사람이 고치는 안을 넣었지만, 근본적으로는 `^stage/demo[0-9]+$` 허용과 `guard.test.js` 케이스를 담은 작은 PR을 낮에 미리 병합하는 편이 깨끗하다. 훅 변경 브랜치 이름(`chore/…`)도 `pr-flow.md`에 없다.
2. **`deploy/overnight-1109` 브랜치 이름**: `pr-flow.md`에 배포 전용 브랜치 규칙이 없다. 단계 PR이 모두 main에 들어가지 못하는 밤마다 같은 일이 반복되므로 `deploy/<날짜>` 규칙을 "배포"에 추가하는 안.
3. **블록 2의 엔진 선택 규칙과 4,000자 초과 처리**: TSD §8.7에 두 키가 모두 있을 때의 우선순위가 없어 이 파일이 "결과표 1위 → OpenAI → Upstage"로 정했다. 이어 붙인 글이 4,000자를 넘으면 안내 뒤 앞부분만 보내는 것도 TSD에 없다. 둘 다 TSD §8.7·§8.8에 한 줄씩 넣는 안.
4. **`Server-Timing` 헤더**(결정 11): `extract-text`·`summarize`·`/api/requests`가 `engine|llm|store;dur=<ms>`를 돌려주게 했다. JSON 모양은 TSD 그대로다. TSD §8에 "측정용 헤더" 한 줄을 넣는 안.
5. **`volunteerRequest.ts` 생성 위치**: TSD §12는 3a(③)가 만들고 3b(④)는 공용 타입만 쓴다고 했다. 이번 밤 ④가 먼저이고 ③은 조건부라, ④는 이 파일 없이 `product`·`volunteerId` prop만 받게 했다. ③이 다음 밤이면 TSD §12 표 3b 행의 "공용 타입만 의존"을 "없음"으로 고친다.
6. **progress.md 문서 브랜치 방식**: 블록 끝마다 체크아웃을 바꿔 커밋한다. 다음 밤부터는 `docs/overnight-<날짜>`를 `overnight-loop.md` "진행 기록 형식"에 적어 두면 판단이 줄어든다.
7. **TSD §12 표의 PR 2 위치**(TSD:447, 454)는 승인본 human.md:31·34(`stage/demo2`/`feat/demo2/queue`)와 다르다. 블록 4 PR에서 TSD 표 2·4행을 human.md대로 고치는 1줄 수정을 넣어도 된다.
8. **블록 0의 코드 커밋**: 키 존재 확인을 위해 블록 0이 `feat/demo4/experiment`에 1커밋을 올린다. "블록 0은 PR 없음"과 흐려지지만, 훅이 `.env` 이름이 든 `node -e`를 막아 다른 방법이 없다(2절). 실험 서버에 처음부터 엔진별 플래그를 두면 다음부터 필요 없다.
9. **보관 기간이 두 문서에서 다르다**: human.md:91은 "서버의 요청은 하루 뒤 자동으로 지우고", TSD:300은 "`waiting` 24시간 → `expired`, `expired` 24시간 뒤 삭제"(생성 48시간 뒤 삭제)다. 둘 다 이용자가 승인한 문서다. 블록 4는 TSD대로 만들고(2단계 상태가 "다시 열기" 낭독에 필요하다) PR 본문과 아침 보고 10절 "결과 보관 기간"에 함께 올린다. 아침에 하루로 정하면 상수 두 개만 바꾼다.
10. **블록 4에 "Supabase 구현 빼고 메모리 + 흉내" 포기 단계를 넣는 안**(실행 기준 아님): human.md:88의 포기 순서는 ① 다시 열 때 서버 확인 → ② PR 2 전체 두 단계뿐이고 블록 4는 그대로 따른다. 승인 전 초안(notes C7:98 "Redis 구현 빼기", −15분)에는 중간 단계가 있었다. human.md:96의 흉내는 연결을 못 했을 때의 대체이지 시간 부족 때의 포기가 아니라서 넣지 않았다. 사람이 허락하면 ①과 ② 사이에 넣는다(결정 5·11이 그만큼 약해진다).
11. **블록 2 e2e 봉사자 진입 도우미**(`tests/e2e/helpers/volunteer.ts`, sessionStorage 주입)는 이용자 화면을 거치지 않으므로 플로우 A와 독립이다. 다음 밤부터 ③·④ 시험은 모두 이 도우미로 들어가게 하면 `chat.spec.ts`의 이용자 화면 경유 함수를 없앨 수 있다.
12. **`requestStore` 자동 전환**(블록 4 할 일 3): Supabase 구현이 함수·표 없음 오류(PostgREST `PGRST202`, Postgres `42883`·`42P01`)를 받으면 그 프로세스는 메모리로 전환하고 `/api/health`가 `store=memory`를 돌려준다. 다른 오류(네트워크·권한)는 전환하지 않고 503이다. TSD:154는 "키가 없으면 메모리"만 적고 있어 TSD §5 불릿에 한 줄 추가하는 안. production이 조용히 메모리로 도는 동작이라 다음 밤(플로우 B claim/complete)이 같은 규칙을 알아야 한다. 블록 4 PR 본문에도 같은 문장을 넣는다.
13. **블록 1 엔진 조합의 AI 추가 두 가지**: (가) qwen 기준선을 Upstage가 있을 때도 항상 돌리는 것은 human.md:25 "모델 2개"와 결정 9(qwen은 Upstage 대체)에 없어 "시간·횟수가 남을 때만(④)"으로 내렸다. (나) luna가 없을 때(키 없음·402) Upstage+qwen으로 비교하는 것은 결정 9가 정하지 않은 경우라 AI가 정했다(C6 표). 둘 다 사람이 다르게 정하면 C6과 블록 1 할 일 7을 고친다.

## 10. 진행 기록 표

블록 6이 블록당 한 줄로 채운다. 세부 기록은 `progress.md`(브랜치 `docs/overnight-1109`).

| 날짜 | 단계 | 결과 | 근거 |
|---|---|---|---|
| 11/9 | 블록 0 사전 점검 | 완료(00:17~00:38). 세 허락: 훅 아니오, db push 예, 통합 배포 푸시 예. 캡처 없음 → 합성 이미지. 이어 달리기 워크플로 방식 | progress.md 블록 0 |
| 11/10 | 블록 1 비전 실험 | 미완료(00:53~01:17). PR #21 hold-morning, 실패 3(Codex 3회), 1위 `gpt-6-luna`(합성 1개, C6 미완료) | progress.md 블록 1, PR #21, results-vision.md(`feat/demo4/experiment`) |
| 11/10 | 블록 2 ④ 올리기·요약 | 완료(01:17~02:02, C7 합성 이미지라 미완료). PR #22 hold-morning, 실패 7, Codex 3차 통과 | progress.md 블록 2, PR #22 |
| 11/10 | 블록 3 플로우 A 질문 3개 | 미완료(02:02~02:58). PR #23 hold-morning, 실패 4(Codex 3회 axe 범위) | progress.md 블록 3, PR #23 |
| 11/10 | 블록 4 플로우 A 대기열 접수 | 완료(02:58~03:27). PR #24 hold-morning(#23 위에 쌓임), 실패 1, Codex 1차 통과, db push 적용 | progress.md 블록 4, PR #24 |
| 11/10 | 블록 5 ③ 탐색 조언(조건부) | 실행, 미완료(03:27~03:50). PR #25 hold-morning, 실패 4(실제 Groq v1 질문 위반) | progress.md 블록 5, PR #25 |
| 11/10 | 블록 6 마무리 | 완료(03:50~). 통합 배포 `deploy/overnight-1109` `975d673` → production `dpl_99XdwEoqBP8gk5WgfhbhofMLmBhZ`, check 293/293·e2e 93/93·public 5/5, morning-report.md | progress.md 블록 6, morning-report.md |
