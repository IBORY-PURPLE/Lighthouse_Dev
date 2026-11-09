# 플로우 A(사용자 요청) — ai.md용 세부 메모 (2026-11-09, 승인 전 초안)

1쪽 요약: `C:\Users\chewo\Lighthouse_Dev\docs\plans\2026-11-09-overnight\human.md`의 "데모 1·2단계 개선 (플로우 A 스윔레인 반영)" 섹션. 승인 뒤 이 메모를 바탕으로 ai.md 블록을 쓴다. planner(opus) 초안을 메인 세션이 일부 사실 확인함(chat.ts item 필수, main/github/main 해시, 11/4 블록 시간).

## C0. 확인한 사실
- 로컬 `main`=12ebc00(#6), `github/main`=48b38ea(#17)=현재 HEAD. 블록은 `git fetch github` 뒤 `github/main`에서 시작.
- `apps/web/src/lib/speech.ts`: STATUS 19-38, 상태 48-55, 모델 57-68, 액션 70-82, reducer 96-169. matchRejected/matchFailed(153-167)는 transcript 유무로 음성/입력창 경로 구분. reset 액션 없음.
- `SpeechInput.tsx`: typed 상태는 부품 내부(48) → 질문 바뀔 때 `key`로 재마운트. 마운트 때 음성 API 없으면 unavailable(63-66). 입력창 제출은 확인 없이 onSubmit(106-116). 입력창 상태에서 말하기 버튼 없음(138-177) → "confirming+fellBack" 조합은 새로 써도 챗봇 무영향. "다시 말하기" 문구 152 고정.
- 봉사자 챗봇이 같은 부품 사용(`VolunteerChat.tsx:4-18`, `volunteer/page.tsx:22,48`).
- `lib/chat.ts:28-30`: context.item 비어 있지 않은 문자열 필수(확인함) → 정해 줄 것 7 근거.
- `parseRequest.ts`: import 없는 순수 함수, 브라우저에서 사용 가능. 사전 Sony·헤드셋뿐.
- `api/match/route.ts`: 200자(12), 분당 30(15), 422(54-55), 로그 문장 미기록(68-76). 새 라우트도 같은 구조.
- `api/health/route.ts:18-23`: 비밀 아닌 설정 상태 반환 → `store` 추가.
- `playwright.config.ts:36-39`: webServer env `LLM_MODE: "mock"` → 같은 방식으로 `STORE_MODE: "memory"`.
- `chat.spec.ts:58-71, 421-431`은 이용자 화면을 거쳐 봉사자 화면으로 감 → 흐름 변경 시 깨짐. 옛 문구 등장 횟수: user-screen 3, match 7, public 3, chat 6.
- 11/4 progress.md:33 `vercel env add`가 권한 분류기에 막힘 → 저장소 연결은 사람. progress.md:64(00:58~01:22), 92(01:23~01:55).
- TSD.md 56-57, 71, 105, 208: 저장소 없음/다른 기기 연결 때 추가/DemoHandoff·matchHandoff 대체 또는 플래그 → PR 2에서 갱신.

## C1. 차이 목록 (apps/web 기준)
유지: api/match/route.ts, matchHandoff.ts, volunteers.ts(시연 이어 보기 전용, 플로우 B 때 삭제), volunteer/page.tsx, VolunteerChat.tsx, api/chat, chat/llm/prompt.ts, access/rateLimit/parseRequest.ts(사전 확장 안 함), StatusRegion.tsx, fakeSpeech.ts.
변경:
- speech.ts(PR 1, 추가만): `{type:"reset",mode}`, `{type:"typed",text}`(입력창 답 → confirming, transcript=text, fellBack 유지, status=typedBack), `{type:"reenter"}`(입력창 확인에서 다시 입력 → text), matchRejected는 fellBack이면 text. STATUS 문구 추가(기존 문구 불변).
- SpeechInput.tsx(PR 1, 선택 prop만): `confirmTyped?`, confirming+fellBack이면 보조 버튼 "다시 입력", labels.reenter?. 챗봇은 안 넘기므로 동작 동일.
- page.tsx: PR 1 질문 흐름·요약·매칭 버튼(아직 requestMatch(제품 답)). PR 2 매칭 버튼 → /api/requests, 대기번호 화면, 다시 열기.
- DemoHandoff.tsx(PR 2): 누르면 requestMatch(제품 답) → saveMatch → /volunteer. 실패는 STATUS.matchFailed.
- api/health(PR 2): `store: "redis"|"memory"`(종류만).
- package.json(PR 2): @upstash/redis(설치 때 버전 고정).
- playwright.config.ts(PR 2): STORE_MODE memory.
- docs/TSD.md, CLAUDE.md 지도 lib 줄.
신규: lib/requestFlow.ts(PR 1, 순수 reducer), lib/requestRecord.ts(PR 2, localStorage `lh.request.v1`, try/catch), lib/requestStore.ts(PR 2, server-only, 인터페이스+메모리+Redis+선택 함수), api/requests/route.ts(POST), api/requests/[requestId]/route.ts(GET), tests/e2e/helpers/flowA.ts(`completeFlowA(page, answers)`), 단위 시험들.
삭제: 파일 없음. PR 2에서 이용자 화면의 즉시 매칭 경로가 사라짐(STATUS.connected·needItem은 다른 곳에서 쓰므로 유지).

## C2. 상태와 낭독 문구
requestFlow 상태: checking, intro, asking(0|1|2), summary, registering, queued. 모델: answers{product,budget,condition}, inputMode(앞 질문이 입력창이면 다음도 text로 시작), clientRequestId(요약 진입 때 생성, 재시도 때 재사용), queued{requestId,queueNumber}, status. asking일 때만 상태 영역에 음성 모델 status, 나머지는 흐름 status.

| 상태 | 화면 | 초점 | 상태 영역 |
|---|---|---|---|
| intro | h1, 안내 "질문 3개에 답하면 봉사자에게 요청을 보냅니다. 답하는 동안에는 아무것도 보내지 않습니다.", "시작하기" | h1 | "" |
| asking·idle | h2 "질문 1/3. 어떤 제품을 찾으세요?" / "질문 2/3. 예산은 얼마인가요?" / "질문 3/3. 새 제품과 중고 중 무엇을 원하세요?", "눌러서 말하기" | 질문 h2(tabIndex -1) | "" |
| listening | 같음 | 말하기 버튼 | 기존 listening |
| 확인(음성) | 들은 문장, "다음 질문"(질문 3은 "완료"), "다시 말하기" | 확인 버튼 | 기존 heard |
| 못 들음 1회 | 말하기 버튼 | 말하기 버튼 | 기존 missed |
| 입력창 | 입력창(이름 "찾는 제품"/"예산"/"새 제품 또는 중고"), "다음 질문"/"완료" | 입력창 | 기존 fallback |
| 확인(입력창) | 입력 문장, "다음 질문"/"완료", "다시 입력" | 확인 버튼 | 신규 typedBack "입력한 내용: {문장}" |
| 질문 1 품목 없음 | 질문 1 | 말하기 버튼/입력창 | 신규 needProduct "어떤 제품인지 알아듣지 못했습니다. 제품 이름을 넣어 다시 말씀하세요." |
| 200자 초과 | 같은 질문 | 같음 | 신규 answerTooLong "답이 너무 깁니다. 짧게 다시 말씀하세요." |
| 빈 입력 | 같은 질문 | 입력창 | "입력창에 {찾는 제품/예산/새 제품 또는 중고}을(를) 입력하세요." |
| summary | h2 "요청 내용", 목록, "봉사자 매칭 요청" | h2 | 신규 summary "요청 내용입니다. 제품 {p}. 예산 {b}. {c}. 맞으면 봉사자 매칭 요청 버튼을 누르세요." |
| registering | 버튼 aria-disabled | 버튼 | "요청을 접수하고 있습니다." |
| 접수 실패 | summary | 매칭 버튼 | registerFailed "접수하지 못했습니다. 답은 그대로 있습니다. 봉사자 매칭 요청 버튼을 다시 누르세요." (401 noAccess, 429 tooMany) |
| queued | h2 "접수 완료", "대기번호 N번", "앱을 닫아도 됩니다. 다시 열면 대기번호를 알려 드립니다.", "봉사자 화면으로(시연)", "새 요청하기" | h2 | queued(n) "접수됐습니다. 대기번호 {n}번입니다. 앱을 닫아도 됩니다. 다시 열면 대기번호를 알려 드립니다." |
| checking | h1 | h1 | "지난 요청을 확인하고 있습니다." |
| 다시 열기 성공 | queued | h2 | waiting(n) "대기번호 {n}번, 봉사자를 기다리고 있습니다." |
| 다시 열기 404 | intro | h1 | requestGone "지난 요청을 찾지 못했습니다. 새로 요청하려면 시작하기를 누르세요." 기록 삭제 |
| 다시 열기 실패 | 저장 번호로 queued | h2 | checkFailed(n) "대기번호 {n}번입니다. 지금은 상태를 확인하지 못했습니다." 기록 유지 |

PR 1의 요약 다음은 지금처럼 matching → connected → DemoHandoff.
주의: text 모드로 시작한 질문에서 음성 API 없을 때 unavailable 재발송 → 폴백 문구 재낭독. 이미 text+fellBack이면 무시. 질문 바뀔 때 reset + `<SpeechInput key={question}>`. 요약이 h2 초점과 상태 영역에서 두 번 읽히는지는 사람 확인.

## C3. 기기 안 답 보관
- 질문 중: requestFlow React 상태(메모리)만. 통신 없음. 새로고침·닫기 시 사라짐(human.md에 명시).
- 매칭 버튼: 세 답+clientRequestId를 한 번에 POST. 실패 시 상태 유지, 같은 id로 재전송.
- 접수 성공: localStorage `lh.request.v1` = {v:1, requestId, queueNumber, product, savedAt}. 저장 막히면 화면은 정상, 다시 열면 intro.
- 앱 열 때: 기록 있으면 checking → GET, 없거나 깨지면 intro. "새 요청하기"는 기록만 지움.
- 시연 이어 보기는 기존 sessionStorage `lh.match.v1`.

## C4. 대기열 API (PR 2)
POST /api/requests `{clientRequestId: UUID, product, budget, condition}`. 검사 순서: 쿠키 401 → 분당 30 429+Retry-After → 형식 400 invalid_request → 200자 초과 400 too_long → parseRequest(product).item 없음 422 need_item(보조) → 저장소 예외 503 store_unavailable. 성공 201 `{requestId, queueNumber, status:"waiting"}`, 같은 clientRequestId 재전송은 200 같은 본문. 로그는 상태·ms만.
GET /api/requests/[requestId]: 401, 429(분당 60), 400(UUID 아님), 404 not_found(메모리면 `persistent:false` → 클라이언트는 기록 유지·checkFailed), 503. 성공 200 `{requestId, queueNumber, status:"waiting", product}`. Next 16 params Promise 여부는 설치된 next 문서로 확인.
저장소 선택: STORE_MODE=memory → 메모리. 아니면 URL `UPSTASH_REDIS_REST_URL ?? KV_REST_API_URL`, 토큰 `UPSTASH_REDIS_REST_TOKEN ?? KV_REST_API_TOKEN` 쌍이 있으면 `new Redis({url, token})`. 없으면 메모리. 값은 존재 여부만 다룸.
Redis 키(`lh:v1:`): `seq:{YYYYMMDD KST}` INCR, EXPIRE 172800(날마다 1번부터). `req:{id}` HASH {queueNumber, product, budget, condition, brand, item, status, createdAt} EXPIRE 86400. `client:{clientRequestId}` SET NX EX 86400(중복 접수 방지; req 만료 시 새로). `waiting` ZSET score=createdAt, member=requestId; POST마다 24h 지난 것 ZREMRANGEBYSCORE. 플로우 B는 ZRANGE+ZREM 성공 여부로 원자적 가져가기(오늘 미구현). multi/pipeline 지원은 설치 타입으로 확인. 접수 1건 약 7~8 명령, 조회 약 2.
메모리 구현: globalThis Map+만료 시각, 시계 주입. Redis는 가짜 클라이언트 주입으로 단위 시험.

## C5. 실패 분기
| 상황 | 감지 | 결과 | 이어서 |
|---|---|---|---|
| 못 들음 1회 | no-speech/nomatch/15초 | missed | 같은 질문 |
| 못 들음 2회 | MAX_CONSECUTIVE_MISSES | 입력창+fallback | typed 확인 → 다음, 남은 질문도 입력창 |
| 음성 불가 | not-allowed 등/API 없음/3초 | 입력창+fallback | 위와 같음 |
| 확인 "아니요" | 다시 말하기/다시 입력 | 같은 질문 | — |
| 질문 1 품목 없음 | 기기 parseRequest | needProduct | 질문 1 |
| 200자 초과 | 기기 | answerTooLong | 같은 질문 |
| 접수 422/400 | 서버 | 422 질문 1로+needProduct, 400 registerFailed | — |
| 접수 401/429 | 서버 | noAccess/tooMany, 답 유지 | 매칭 버튼 |
| 접수 5xx/네트워크/10초/모양 이상 | 클라이언트 | registerFailed, 답·id 유지 | 재시도 같은 번호 |
| 다시 열기 200/404/기타 | GET | waiting/requestGone(삭제)/checkFailed(유지) | — |
| localStorage 막힘 | try/catch | 화면 정상 | 다시 열면 intro |
| 시연 이어 보기 실패 | /api/match | matchFailed | queued 유지 |

## C6. 시험 (가짜 음성 입력 기준)
단위: 신규 requestFlow.test(전이·id·실패 유지·다시 열기·입력창 모드 이어받기), speech.test 추가만(reset/typed/reenter/fellBack matchRejected; 기존 케이스 불변 = 챗봇 회귀 방지), 신규 requestStore.test(메모리 번호·중복·TTL·날짜 리셋, Redis 가짜 클라이언트 키·EXPIRE·ZADD, 선택 함수), 신규 requestsRoute.test(POST 201/400×3/too_long/422/401/429+Retry-After/503/재전송 같은 번호/로그에 답 없음, GET 200/400/404 persistent/401/503), 신규 requestRecord.test, health 시험에 store.
e2e(LLM_MODE=mock, STORE_MODE=memory): helper flowA.ts. user-screen.spec: 첫 화면 시작하기, 기존 확인·다시 말하기·폴백 4종·3초·못 들음 1·2회·입력창 시험을 질문 1 기준으로 옮김, 신규 질문 2에서 2회 못 들음→입력창→"입력한 내용"→질문 3 입력창 시작, 질문 3 버튼 "완료", 요약에 세 답, 질문 1 품목 없음 머묾, 44px·axe를 intro/질문/요약/queued마다. match.spec: PR 1 요약→매칭→연결→이어 보기; PR 2 POST 본문·대기번호 낭독·두 번째 +1, page.route로 500·네트워크 실패→registerFailed→같은 clientRequestId, 401·429 문구, 이어 보기 → /volunteer, 역할 분리·/api/match 계약 시험 유지. 신규 resume.spec: reload→waiting(n), 새 요청하기→intro, GET 404→삭제+requestGone, GET 실패→checkFailed. chat.spec 58-71·421-431을 completeFlowA+이어 보기로(챗봇 내용 불변). public.spec: 완주를 flow A로, /api/health store 기록(memory면 실패 아닌 "흉내"), 실제 호출은 POST·GET 각 1회+기존 Groq 1회.
기존 시험 문구 변경 이유(흐름 변경)를 PR 본문에 적고 Codex가 보게 함(success-criteria "시험을 고칠 때").

## C7. 블록 시간 (기존 자리 약 2.5h)
- PR 1 `feat/flow-a-questions` 약 70분: speech/SpeechInput 15, requestFlow+단위 15, page 10, e2e 15, 검사·PR·스크린샷·Codex 15. 시작점은 최신 github/main(이미지 PR이 AI 병합됐으면 포함).
- PR 2 `feat/flow-a-queue` 약 80분, base=PR 1: requestStore+단위 20, 라우트 2개+단위 15, page·requestRecord·DemoHandoff 15, e2e 15, 배포·공개 완주·PR·Codex 15.
- 포기 순서: 1) 다시 열 때 서버 조회 빼기(−15분) 2) Redis 구현 빼고 메모리+"흉내"(−15분) 3) PR 2 전체 다음 밤.
- 빼지 않음: 질문 2·3 확인 분기, 실패 시 답 유지, 챗봇 기존 시험 통과.
- 배포: PR 2 공개 완주 배포는 이미지 기능 없는 코드로 잠시 공개 주소를 덮음 → 마무리 블록에서 이미지·flow A 브랜치를 통합 브랜치로 합쳐 재배포, 아침 보고에 브랜치·커밋. 예상 충돌: speech.ts STATUS, progress.md, CLAUDE.md(11/4 morning-report.md:59 참고).
- 다른 답: 5=Neon +30~40분(포기 1 거의 확정), 5=흉내 −15분, 6=저장만 −15분, 7=원문 그대로면 이어 보기는 사전 품목일 때만 보임(챗봇 코드 불변).

## C8. 사람 차례
자기 전(약 15분, 5=Upstash일 때): Vercel 대시보드 Integrations → Marketplace(또는 프로젝트 Storage) → Upstash Redis → Install → Free → 지역(함수 지역과 같거나 가까이; 함수 지역 미확인, AI가 Vercel MCP get_project로 읽기만 확인 가능) → 이름(예: lighthouse-queue) Create → Connect Project에서 apps/web 프로젝트, Production·Preview, Custom Prefix 비움. 카드·유료 요구 시 중단. 값 복사·`vercel env pull` 하지 않음. AI에게 "연결함/못 함"만 알림. 기존 배포는 새 변수를 못 받으므로 AI가 재배포. 판정은 /api/health store. 변수 이름만 필요하면 `vercel env ls` 시도, 막히면 우회 안 함.
아침(약 15분): C9.

## C9. 사람 판정 항목 (실기기 iPhone Safari + VoiceOver)
1. 시작하기 뒤 질문 1 낭독, 질문 사이 초점이 질문 제목으로 가서 한 번만 읽힘 2. "이렇게 들었습니다"/"입력한 내용" 낭독, 확인 버튼 초점 3. 낭독이 음성 인식에 섞이지 않음(질문 3개 각각) 4. 예산("10만 원 이하")·"중고"/"새 제품" 실제 인식 결과 꼴 5. 요약이 끊기거나 두 번 읽히지 않음 6. 대기번호 낭독, 탭 닫거나 홈 나갔다 다시 열면 "대기번호 N번, 기다리고 있습니다" 7. 이어 보기 → 봉사자 챗봇 8. 질문 문구 자연스러움.

## C10. 멈춤 조건
챗봇 기존 시험이 같은 오류로 3회 실패 / /api/chat·prompt.ts·parseRequest 사전을 고쳐야만 진행 / @upstash/redis 설치·빌드 실패 → 메모리로 진행·기록 / "연결함"인데 store=memory → 기록, 흉내로 계속, 환경변수 손대지 않음 / 저장소 연결·요금제·결제·환경변수 쓰기 필요 → 사람 일.

## C11. 후속 일(bd 후보)
플로우 B(꺼내기·알림), 봉사자 화면·챗봇에 예산·새/중고 전달, 품목 사전 확장 또는 원문 접수, 요약에서 답 고치기, rateLimit을 Redis로, /api/match·DemoHandoff 정리.

## C12. 외부 사실 (2026-11-09 조회, planner)
- Upstash Redis Free https://upstash.com/pricing/redis : 월 50만 명령, 250MB(본문)/256MB(표), 월 대역폭 10GB, 무료 DB 1개, 요청 최대 10MB, 초당 1만 명령. 무활동 삭제 정책 미확인.
- Vercel KV 종료, 2024-12 Marketplace Upstash Redis로 이전 https://vercel.com/docs/redis
- Native Integration https://vercel.com/docs/integrations/install-an-integration/product-integration : 모든 요금제, Install→요금제→Create→Connect Project, 환경 선택, 기존 배포는 새 변수 미반영, Custom Prefix. CLI `vercel integration add`는 요금제·약관 때문에 AI 사용 안 함.
- 주입 변수 이름 미확인: Marketplace 예시 `KV_REST_API_URL/TOKEN` https://vercel.com/marketplace/upstash/upstash-kv , 제3자는 `UPSTASH_REDIS_REST_*`. → 두 쌍 직접 읽기.
- Neon Free https://neon.com/pricing : 1GB/프로젝트, 월 100 CU-시간, 5분 무활동 잠듦.
- 미확인: Upstash 무료 연결 시 카드 요구, 기존 Upstash 계정 관계, 함수 지역, @upstash/redis 최신 버전·transaction API, Next 16 params 형식.

## human.md에서 함께 고치면 좋을 곳(이번 세션은 섹션 밖이라 손대지 않음)
- human.md:13 "1·2단계 개선 PR(스윔레인이 나오면)" → "1·2단계 개선 PR 2개(질문 3개, 대기열 접수, 아래 섹션)"
- human.md:19 "(스윔레인이 없으면 버퍼)" → "(아래 섹션)"
- human.md:34 "1·2단계 몫은 스윔레인이 나온 뒤 더한다" → "1·2단계 몫은 자기 전 약 15분, 아침 약 15분"

## 갱신(2026-11-09 낮): 저장소 = Supabase (이용자 결정) — C4의 Redis 설계를 이것으로 대체
- 프로젝트: `lighthouse`, ref `zdnlhnzybbuloquzxwkg`, 조직 SongChaewoo-Org(`hrhanroharhviahsrzrd`), 지역 ap-northeast-2(서울), 크기 기본값(지정 안 함). 대시보드 https://supabase.com/dashboard/project/zdnlhnzybbuloquzxwkg
- DB 비밀번호: 무작위 생성 후 저장하지 않음(필요하면 대시보드에서 재설정). CLI는 로그인 토큰으로 비밀번호 없이 `supabase link`·`migration list --linked` 성공(저장소 밖 scratchpad에서 확인) → 밤에 `supabase db push --linked`로 표를 만들 수 있을 것으로 봄(push 자체는 미확인).
- 저장소 `supabase/` 폴더(init/link)는 아직 저장소에 만들지 않음. 밤 PR 2 브랜치에서 `supabase init` 후 마이그레이션 추가. 위치(저장소 루트 vs apps/web)는 AI 결정, CLAUDE.md 지도 갱신.
- Vercel 함수 지역: vercel.json에 regions 없음 → 기본(미국 동부 iad1로 알고 있음, 미확인). DB는 서울이라 호출당 왕복 지연이 있음. 요청 1건에 RPC 1회라 오늘은 그대로 두고, 바꿀지는 후속 일.
- 표 초안: `requests(id uuid pk default gen_random_uuid(), client_request_id uuid unique, queue_date date, queue_number int, product text, budget text, condition text, brand text, item text, status text default 'waiting', created_at timestamptz default now())`, unique(queue_date, queue_number). 날짜별 번호와 중복 접수 방지는 SQL 함수 `register_request(...)` 하나로(같은 client_request_id면 기존 행 반환, 아니면 pg_advisory_xact_lock(날짜) 후 max+1 삽입). 24시간 지난 행은 함수 안에서 삭제(또는 pg_cron, 무료에서 가능 여부 미확인).
- 접근: RLS 켜고 정책 없음(브라우저 직접 접근 차단). 서버 라우트만 secret/service_role 키로 `@supabase/supabase-js` RPC 호출. 브라우저에 키를 내보내지 않음.
- 환경변수 이름: Supabase의 Vercel 연동이 넣는 이름 미확인 → 코드에서 URL `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`, 키 `SUPABASE_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`를 직접 읽음. 연결 뒤 Vercel MCP `filter_project_envs`로 이름만 확인 가능(값 보지 않음).
- 플로우 B 꺼내기: `update requests set status='taken' where id = (select id from requests where status='waiting' order by created_at for update skip locked limit 1) returning *` (오늘 미구현).
- 단위 시험: RequestStore 인터페이스는 그대로, Supabase 구현은 가짜 RPC 클라이언트 주입. e2e는 STORE_MODE=memory.
- health `store` 값: "supabase" | "memory".
- 시간: PR 2 약 110분(Redis안보다 +30분). 블록 2.5h를 넘으면 포기 1(다시 열 때 서버 확인)부터.
- 위험: 무료 프로젝트 7일 무활동 시 멈춤(같은 조직 moyeo PAUSING, 여러 개 INACTIVE 확인), 무료 조직 활성 2개 제한(현재 Experii + lighthouse).

## 갱신(2026-11-09): 1쪽 요약 이용자 승인
- 정해 줄 것 5 Supabase, 6 다시 열면 낭독, 7 질문 1에서 품목 검사. ai.md는 아직 쓰지 않음.
- 플로우 A 출처: https://www.figma.com/board/GkGAU5McOSlxujEpQnZAHc/?node-id=48-1245 (보드 "LightHouse 사용자 플로우 1. 시각장애인 이용자")
- 주의: 상위 세션이 봉사자 수행 플로우(플로우 B)와 TSD·FastAPI 백엔드 검증을 이어서 할 예정. 백엔드 방향이 바뀌면 대기열 API 위치(Next.js 라우트 vs FastAPI)와 Supabase 접근 방식을 ai.md 작성 전에 다시 맞출 것.
- 레포 루트에 CLI가 남긴 `supabase/.temp/`(프로젝트 ref만 담김)는 지움. 밤 PR 2에서 `supabase init`부터 다시.

## 갱신(2026-11-09 낮): Supabase 환경 세팅 완료(이용자 관찰 하에 터미널 패널에서)
- 이용자가 Supabase→Vercel 연동 완료. Vercel `lighthouse-web` 환경변수(이름만 확인, 값 안 봄): SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, POSTGRES_* 7개. **target은 production만**(preview·development 없음) → 미리보기 배포에서는 store가 memory로 떨어짐. 공개 완주는 production 배포로 하거나 이용자에게 preview 추가를 요청.
- 저장소 루트에서 `supabase init`(config.toml, .gitignore: .branches/.temp/.env.local 등 제외) → `supabase link --project-ref zdnlhnzybbuloquzxwkg` → `supabase migration list --linked`가 "Initialising login role..."로 비밀번호 없이 원격 접속 성공. 마이그레이션은 아직 0개.
- `supabase/`는 미커밋(현재 브랜치 docs/overnight-1109-plan). 밤 PR 2 브랜치로 가져가 첫 마이그레이션과 함께 커밋. CLAUDE.md 지도에 `supabase/` 줄 추가(미커밋).
- config.toml의 db.major_version=17. 원격 버전은 supabase/.temp/postgres-version에 있음(로컬 Docker `supabase start`는 쓰지 않음).
- CLI v2.98.2(v3.0.0 나옴). 밤에 업그레이드하지 않음.
- (정정) Supabase 연동 환경변수는 16개(SUPABASE_URL 포함). 이용자 요청으로 16개 모두 target에 preview 추가(Vercel MCP edit_project_env, 값은 건드리지 않고 target만 변경, 응답에서 production+preview 확인). development는 여전히 없음 → 로컬은 STORE_MODE=memory. 연동(configurationId icfg_VL5JXXADO6e5knpbiBH1aBHM)이 다시 동기화하면 target이 되돌아갈 수 있음 — 밤에 preview 배포 뒤 /api/health store로 확인.
