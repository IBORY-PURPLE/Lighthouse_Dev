# LightHouse 기술 설계서(TSD) v2: 봉사자 흐름(플로우 A·B) 반영

작성일: 2026-11-09. 상태: **확정(2026-11-09 이용자 승인)**. 사람용 1쪽 요약은 `docs/human_tsd.md`.
v2.2(2026-11-17, **초안: 이용자 승인(A39) 전**): 리서치 챗을 대화형으로 바꾸면서 서버가 대화 상태를 갖는다. 바뀐 곳은 핵심 결정 2·3, §2 데이터 표, §8.3(대화 표 6개·함수 9개·보관 규칙)이다. 공식 페이지 사진 읽기 원칙 예외(TSD 원칙 줄), 화면 절(D안 E1~E12), 결과 guide = 검증 리뷰 문단은 해당 PR(PR 3~5)에서 이 문서에 더한다. 설계 근거는 `docs/plans/2026-11-16-research-chat-backend/design.md`다.
v2.1(2026-11-13): 봉사자 ③④⑤를 리서치 챗 한 화면으로 합침. 바뀐 곳은 핵심 결정 3, §1 플로우 B·시연 예외, §2, §3, §4, §5, §7.1, §8 공통, §8.1, §8.2, §8.3, §8.7·§8.8·사진 축소, §9·§9.1, §10, §12, §13이다(v2.1 문서는 이용자 승인 전. 설계 근거는 2026-11-12 이용자 지시).
이전 판: v1(11/4 밤샘 범위)은 git 기록(`f8b77c6`)에 있다. 바뀐 점과 근거는 `docs/plans/2026-11-09-overnight/tsd-review.md`.
적용 범위: 11/24 중간 시연까지의 데모 시나리오 V2(① 음성 요청 ② 요청 전달 ③ 탐색 조언 ④ 정보 요약 ⑤ 사람 검증 ⑥ 결과 전달 ⑦ 듣고 열기). v2.1부터 ③④⑤는 리서치 챗 한 화면에서 한다. 설계 출처는 FigJam의 "MVP 플로우 A · 사용자 요청"과 "MVP 플로우 B · 봉사자 수행"이다.

일정, 시간, 포기 순서는 그날 계획(`docs/plans/<날짜>/human.md`, `ai.md`)을, 개발 절차와 금지선은 `.claude/rules/`를 따른다. 이 문서는 무엇을 어떻게 만드는지만 정한다.

**v2의 핵심 결정**
1. 백엔드는 Next.js 서버 함수(TypeScript) 하나다. FastAPI 등 별도 서버는 11/24 시연 전에는 두지 않는다(§3, 재검토 조건은 `tsd-review.md`).
2. 서버 상태는 Supabase Postgres의 `requests`(대기열)와 `results`(결과함)에, v2.2부터 리서치 챗 대화 표 6개(`research_sessions`, `research_messages`, `research_turns`, `research_photos`, `research_usage`, `ai_usage_daily`)가 더해진다. 동시 선택은 SQL 함수의 조건부 UPDATE로 막고, 대화 표는 요청 행을 먼저 잠그는 SQL 함수로만 바꾼다(§2, §8.3). *(v2.2 초안)*
3. ③④⑤의 작업 중 값(대화, 칸, 구매 인증 사진 작은 썸네일 최대 3장)은 v2.2부터 서버 DB의 대화 표에 둔다. 서버는 이미지 원본과 원문, 상세 페이지를 저장하지 않는다(§2). 보관은 보내기·내려놓기 때 즉시 삭제하고, 6시간 동안 활동이 없으면 요청을 대기열로 돌리며 대화도 지운다(§8.3). v2에서는 탭 메모리, v2.1에서는 기기 `localStorage`였다. *(v2.2 초안)*
4. 데모 단계마다 브랜치 하나다(§12).

## 1. 합격 흐름

역할은 처음부터 분리한다. 이용자는 이용자 화면만, 봉사자는 봉사자 화면만 본다. 챗봇은 봉사자의 어시스턴트다. 서버와 AI는 쇼핑몰에 접속하지 않는다. 이용자와 봉사자는 실시간으로 통신하지 않고, 대기열과 결과함을 거쳐서만 만난다.

### 플로우 A: 이용자 요청(①②)

1. 이용자가 아이폰에서 VoiceOver를 켜고 이용자 주소(`/`)를 연다.
2. `/`는 apps/user-voice-ui(동료 작성)의 음성 대화 화면이다(§8.9). "상품 요청"을 누르면 AI가 한 번에 질문 하나씩 구매 조건을 묻고, 이용자는 말로 답한다. AI가 요청을 1~2문장으로 정리해 "이 내용으로 구매 요청을 등록할까요?"라고 물으면 이용자가 동의한다(동의 전에는 등록하지 않는다). 답할 때마다 대화 내용이 AI 서버로 간다. 고정 질문 3개(제품, 예산, 새 제품·중고) 화면은 `/classic`으로 옮겨 남아 있다. 답마다 확인을 거치고, 답하는 동안 기기 밖으로 아무것도 보내지 않는다.
3. 동의(`done`)하면 요청이 대기열에 들어간다(`POST /api/requests`). `/classic`에서는 요약을 듣고 "봉사자 매칭 요청"을 누르면 들어가고 대기번호를 듣는다(`waiting`). `/`의 음성 대화 화면은 대기번호를 읽어 주지 않고 기기 안 목록에만 카드를 보인다. 접수한 기기는 서버가 심은 기기 쿠키(`lh_device`)로 구분되어, 기기마다 자기 요청만 목록에 보인다(§8.4).
4. 앱을 닫았다 다시 열면 대기번호와 상태를 다시 듣는다.

### 플로우 B: 봉사자 수행(②~⑥)

"10분 지표"는 봉사자가 요청을 고른 시각부터 결과를 보낸 시각까지다(대기 시간 제외).

1. ② 봉사자가 대기열 화면(`/volunteer`)에서 대기 중 요청 목록을 본다.
2. ② 요청을 고르면 상태가 `waiting → in_progress`로 바뀐다. 다른 봉사자가 먼저 골랐으면 "이미 다른 봉사자가 진행 중"을 듣고 목록으로 돌아간다.
3. ③④⑤ 요청을 맡으면 `/volunteer/requests/{id}`에서 리서치 챗이 열린다. 맨 위에 이용자가 한 말(제품·예산·조건)이 보인다.
4. 질문 카드 7장에 한 장씩 답한다. 순서는 기종 찾기, 장점, 사진, 같이 고민한 제품, 고민한 이유, 혜택, 참고 글이다. 1~5번은 필수, 6·7번은 건너뛸 수 있다. "이전"으로 돌아가 답을 고칠 수 있다.
5. 카드마다 AI가 기종 후보, 질문 문장과 힌트, 혜택·참고 링크, 사진 설명 초안을 "AI 제안 · 확인 필요"로 보인다. 봉사자는 쇼핑몰에서 직접 확인하고 고르거나 쓴다. AI가 실패해도 기본 질문과 쇼핑몰·검색 바로가기로 카드가 진행된다.
6. 1번 카드에서 구매 여부를 고른다("구매했어요" / "구매하지 않았어요 (리서치만)"). 구매했고 착샷이 1장 이상이면 결과에 "구매 인증됨", 아니면 "리서치만"이 들어간다. 봉사시간 가산은 표시만 한다.
7. "보내기 전 확인"에서 후보 목록(추천 기종 1 + 같이 고민한 제품 최대 2), 핵심 정리 글, 사진 장수, 구매 인증을 확인한다. 필수 카드가 비어 있으면 보낼 수 없고, 빠진 카드 이름을 눌러 그 카드로 간다.
8. ⑥ 보내면 결과함에 저장되고 상태가 `done`이 된다. 전송이 실패하면 안내를 듣고 다시 보낸다. 쇼핑 앱에 다녀오거나 새로 고쳐도 같은 카드에서 이어진다(§2 데이터 위치).
9. 플로우 C(⑦): 이용자가 나중에 앱을 열어 결과를 듣고 구매 링크를 연다.

WBS #8 확정 전 가정(③은 챗봇 대화, ④는 스크린샷 업로드만)과 v2의 ③ 챗봇 → ④ 캡처 글자 읽기·요약 초안 → ⑤ 요약 확인·수정 흐름은 v2.1에서 없앴다. 요청 확인 화면, 요약 확인 화면(`/volunteer/requests/{id}/summary`)도 없다.

### 시연 예외: 한 탭 이어 보기(②가 병합될 때까지)

②(대기열 화면·선택)가 main에 들어가기 전에는 개발자가 폰 하나로 ③을 보여 주려고 v1의 한 탭 이어 보기(`sessionStorage`의 `lh.match.v1`)를 남긴다. v2.1부터 봉사자 요청 화면의 ③④⑤는 리서치 챗이고, 이어 보기 화면(`/volunteer/demo`)에는 챗봇(`VolunteerChat`)만 남아 있다. 이 화면은 `matchHandoff.ts`로 `lh.match.v1`을 직접 읽는다. v2의 `VolunteerRequestView` 어댑터와 "요청 확인 화면에서 시작" 계획은 v2.1에서 없앴다.

## 2. 구조

```
아이폰 브라우저 (역할별 라우트)
  /                              이용자: 질문 3개 → 요약 → 매칭 요청 → 대기번호 / 다시 열기 / (⑦ 결과 듣기)
  /volunteer                     봉사자: 대기열 목록(새로 읽기 버튼)
  /volunteer/requests/{id}       봉사자: 리서치 챗(③④⑤ 질문 카드 7장 → 보내기 전 확인) → ⑥ 전송. 완료면 보낸 결과
      │   작업 중 값(답, AI 도움, 작은 썸네일)은 기기 localStorage에만 있다
      ▼
Vercel 서버 함수 (Next.js, Node 22, 기본 지역 iad1 — §11에서 icn1 검토)
  /enter(옛 링크 이동만), /api/health, /api/match(시연 이어 보기)
  /api/requests, /api/requests/{id}                         플로우 A
  /api/volunteer/queue, /api/volunteer/requests/{id}[/claim|/release]   플로우 B ②⑥
  /api/volunteer/requests/{id}/research[/turn|/search|/photos|/review|/send]   ③④⑤ 대화형 리서치 챗(v2.2 초안, 서버가 대화 상태를 가짐. 옛 /api/volunteer/research·/result는 지움)
  /api/chat                                                 시연 이어 보기 화면(/volunteer/demo)의 챗봇 (스트리밍)
      │                       │
      ▼                       ▼
Supabase Postgres (서울)   OpenAI (gpt-6-luna)
  requests, results          리서치 AI(웹 검색·질문·사진 설명), 챗봇
  SQL 함수(RPC)만 호출
```

v2의 `/api/volunteer/extract-text`, `/api/volunteer/summarize`, `/api/volunteer/requests/{id}/candidates`와 Upstage 글자 읽기는 v2.1에서 없앴다.

### 역할 분리

| 역할 | 라우트 | 보이는 것 | 하지 않는 것 |
|---|---|---|---|
| 이용자 | `/` | 질문, 요약, 대기번호, (⑦) 결과 | 챗봇, 봉사자 UI, 대기열 목록 |
| 봉사자 | `/volunteer`, `/volunteer/requests/{id}` | 대기열, 리서치 챗(질문 카드 7장, 보내기 전 확인), 결과 전송, 보낸 결과 | 이용자 요청 작성 UI |

### 데이터가 어디 있나

| 값 | 위치 | 보관 |
|---|---|---|
| 이용자의 세 답(제품·예산·새/중고), 대기번호, 상태 | Supabase `requests` | §8.3 보관 규칙 |
| 결과(후보명, 구매 링크, 가이드, 확정 요약) | Supabase `results` | 완료 뒤 7일(이용자 결정 대기) |
| 이용자 기기의 지난 요청 표시 | 이용자 `localStorage` `lh.request.v1` | "새 요청하기"까지 |
| 리서치 챗 대화, 칸 7개 값, 구매 여부, 추가 답, 검수한 리뷰 문단, 구매 인증 사진 작은 썸네일(JPEG, 최대 3장) | Supabase `research_sessions`·`research_messages`·`research_turns`·`research_photos`(v2.2 초안) | 보내기·내려놓기 때 즉시 삭제(DB 트리거). 6시간 활동이 없으면 요청을 대기열로 돌리고 같이 삭제. §8.3 |
| 보낸 요청의 대화 이력(글만, 사진은 "사진을 올렸어요" 글로) | 보낸 봉사자 기기 `localStorage` `lh.vol.sentHistory.v1` | 보낸 날부터 30일 뒤 화면이 지움(A8 이용자 결정 2026-11-17). 다른 기기에서는 보이지 않는다 |
| 리서치 챗 AI 호출 기록(대화 턴·추가 질문·리뷰 문단의 요청·응답 글) | OpenAI 대시보드 Logs(`store: true`, `metadata.feature` = research_turn·research_ask·research_review, `src/lib/openaiLog.ts`) | OpenAI 보관 기간을 따른다. `OPENAI_STORE_LOGS=off`면 남기지 않는다(이용자 요청 2026-11-17). 웹 검색·이용자 음성 대화는 `store: false` 그대로. 이용자 질문·답(`이용자조건`)이 든 리뷰 문단 호출은 `OPENAI_STORE_LOGS`와 상관없이 `store: false`(대화 턴 AI에는 넘기지 않는다) |
| 이용자 리뷰 도착 알림 구독(웹 푸시 endpoint·p256dh·auth) | Supabase `push_subscriptions`(요청 하나에 하나, 마이그레이션 20261120000000) | 리뷰를 보내 알림을 한 번 보내면 지운다. 요청이 지워지면 같이 지워진다(A13 이용자 결정 2026-11-17). 키 `VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY`가 없으면 기능이 꺼진다 |
| 이용자가 확인한 요약과 질문·답(봉사자 브리핑, 이용자가 말한 그대로. 요약 300자·질문 150자·답 200자·12짝 이하, 전화번호 모양은 "(전화번호 가림)") | Supabase `request_details`(요청 하나에 하나, 마이그레이션 20261122000000. 없으면 메모리) | 맡은 봉사자 1명에게만, 그 요청이 진행 중인 동안만 내보낸다. 요청이 `done`·`expired`가 되면 DB 트리거가 지우고 요청이 지워지면 함께 지워진다. 내려놓기·6시간 반환 때는 남긴다(다음 봉사자가 봐야 한다). 이용자 상태 조회·대기열·로그·봉사자 기기(`sentHistory`)에는 나가지 않는다. 이름·주소 같은 말은 가리지 못한다(이용자가 말한 그대로이므로 시연에서는 개인정보를 말하지 않는다) |
| 이용자 기기의 요청 기록(대화 id·요청 번호·상태·리뷰) | 이용자 `localStorage` `lh-requests`, 알림 켬 여부 `lh-push` | 최근 20건의 캐시일 뿐이다. 서버가 이 기기(`lh_device`)에 준 목록(`GET /api/requests`)이 기준이고, 목록을 열면 그 응답으로 상태·리뷰를 갱신한다. 번호를 못 받은 기록(접수 중·실패)은 남기고, 서버가 주지 않은 번호의 기록은 서버가 전체 목록(`complete:true`, 저장소가 DB일 때)이라고 알릴 때만 지운다(아니면 그대로 둔다). 그래서 끝난 요청은 `done_at` 7일 뒤, 만료는 생성 48시간 뒤 서버에서 지워지면 목록에서도 사라진다(2026-11-18 사람 판정 대기: 리뷰를 계속 보이게 할지). 접수 중에는 목록 병합을 미루고, 화면을 열 때 한 번 조회해 기기 쿠키를 먼저 받은 뒤 접수한다(쿠키 없는 새 기기의 접수와 조회가 겹쳐 서로 다른 쿠키를 받는 경합을 막는다) |
| 요청당·하루 AI 사용 횟수 | Supabase `research_usage`·`ai_usage_daily`(v2.2 초안) | 사용량은 세션이 지워져도 남고, 요청이 지워질 때 함께 지워진다. 하루 표는 날짜 한 줄씩 |
| (v2.1) 리서치 챗 진행 단계·카드별 답 | 봉사자 기기 `localStorage` `lh.vol.research.v1.<requestId>` | 대화형 화면(PR 5)이 들어가면 쓰지 않는다. 그때 대화 화면이 열 때 지운다 |
| 서버로 보내는 축소 사진(사진 설명용) | 봉사자 탭 메모리 | 새로 고치면 사라짐. 서버는 AI에 넘긴 뒤 버림 |
| 시연 이어 보기 화면의 챗봇 대화 | 봉사자 탭 메모리 | 탭을 닫으면 사라짐 |

- v2의 "이미지 조각·글자 읽기 원문·요약 초안·근거 원문은 탭 메모리"와 "대체 경로 이미지는 Storage 비공개 버킷" 행은 v2.1에서 없앴다.
- 이미지와 상세페이지 원문을 서버에 남기지 않는 이유: 상세페이지 보관은 멘토가 지적한 법적 위험이다. v2.2의 사진은 구매 인증용(착샷·실제 소유 사진)뿐이고 상세 페이지 캡처는 받지 않는다. 서버는 원본을 저장하지 않고 브라우저가 줄인 작은 JPEG 썸네일(60,000자 이하)만 대화가 살아 있는 동안 둔다. 결과에는 사진이 들어가지 않는다. *(v2.2 초안)*
- 구매 인증 사진 확인(P2, A12 이용자 결정 2026-11-17): 사진을 올리면 AI가 원본 이미지를 한 번 보고(`checkPurchasePhoto`, `store: true` feature `research_photo`) 사진 종류(photo·screenshot·unclear), 대체 텍스트(200자 이하, 가격·주문번호·얼굴·이름 없음), 인쇄된 기종을 `research_photos`에 남긴다. 착샷이 아니거나 불분명하거나(AI 실패 포함) 기종 칸과 다르면 `pending.shotCheck`·`mismatch`로 구매 인증을 보류하고, 봉사자가 [직접 찍은 사진이 맞아요](`photo.yes`)를 누르거나 사진을 모두 지우면 풀린다. 대체 텍스트는 사진 대체 글·확인 말풍선·리뷰 자료(`사진설명`)에 쓴다.
- DB는 서버 라우트만 서버 키(secret 또는 service_role)로 SQL 함수(RPC)를 호출해 다룬다. 표는 RLS를 켜고 정책을 두지 않아 브라우저 직접 접근을 막는다. 브라우저에는 Supabase 키를 내보내지 않고 Realtime도 쓰지 않는다.
- 이용자 기기 식별(2026-11-18): 접수(`POST /api/requests`)와 목록(`GET /api/requests`) 응답에서 쿠키가 없거나 서명이 틀리면 기기 쿠키 `lh_device`를 새로 심는다. 값은 `v1.<무작위 열쇠>.<서명>`이고 봉사자 쿠키와 같은 서명 방식(`volunteerSession.ts`의 `issueSignedKey`·`readSignedKey`)에 비밀만 다르다(`DEMO_ACCESS_CODE`에서 용도별로 만든다. 그래서 `lh_vol` 값을 `lh_device` 자리에 넣어도 통하지 않는다). 속성은 봉사자 쿠키와 같다: `httpOnly`, `sameSite=lax`, `path=/`, Vercel·https에서만 `secure`. 수명은 1년이다. 서버와 DB(`requests.device_id`)에는 열쇠에서 뽑은 기기 ID(`u-`+32자리)만 남고 로그에는 남기지 않는다. 이용자는 코드를 입력하지 않는다. 서명 비밀이 없으면 쿠키 없이 접수만 되고(기기 없음) 목록은 비어 있다. 쿠키를 지우거나 다른 브라우저로 열면 새 기기가 되어 이전 요청은 보이지 않는다(계정이 없는 대가).
- 봉사자 식별: 입장하면 기기 열쇠 쿠키(`lh_vol`)를 받고, 서버는 그 열쇠에서 뽑은 봉사자 ID를 쓴다(`volunteerSession.ts`). 실제 로그인은 범위 밖이다. QA 기간에는 접근 코드와 입장 코드가 없고 `lh_access` 쿠키도 없다. 링크만 있으면 이용자·봉사자 화면 모두 바로 쓰고, 봉사자 화면은 처음 열 때 스스로 `POST /api/volunteer/enter`를 불러 `lh_vol`을 받는다(쿠키는 비밀이 아니라 기기 번호표다). `DEMO_ACCESS_CODE`는 코드 입력용이 아니라 이 쿠키의 서명 비밀이다. 값을 바꾸면 모든 봉사자 기기의 입장이 풀리고(다시 열면 새로 받는다), 맡은 요청은 새 ID로 바뀌어 이어 보지 못한다. 없으면 입장이 503 `not_configured`다. 되돌리려면 이 변경(PR)을 revert한다.

## 3. 기술 선택

| 영역 | 선택 | 이유·근거 |
|---|---|---|
| 웹·서버 | Next.js 16(App Router, TypeScript, React 19), 서버 함수 `runtime = 'nodejs'` | 화면과 서버를 한 프로젝트로 배포. v1 그대로 |
| 런타임 | Node 22 | v1 그대로 |
| 배포 | Vercel 무료판, Root Directory=`apps/web` | v1 그대로. 함수 시간 최대 300초, 본문 4.5MB |
| DB | Supabase Postgres(프로젝트 `lighthouse`, 서울, 무료), `@supabase/supabase-js`(서버 전용, RPC), 마이그레이션은 저장소 루트 `supabase/migrations` | 11/9 이용자 결정. 동시 선택을 SQL 함수로 보장 |
| 챗봇(시연 이어 보기 화면) | `openai` SDK, `gpt-6-luna`, `reasoning_effort: "none"` | 2026-11-12 Groq에서 바꿈(공개 주소의 Groq 키가 무효 401). 모델의 JSON 모드·응답 시간은 미확인, 배포 뒤 실측 |
| 리서치 AI: 검색(카드 1·4·6·7) | `openai` SDK Responses API(`responses.create`) + `web_search` 도구, `gpt-6-luna` | 기종 후보·혜택·참고 링크는 출처 주소가 있어야 해서 웹 검색을 쓴다. 검색 1회 약 0.01달러(추정)에 토큰 값이 더 든다. luna가 `web_search`를 받는지는 미확인(§13). 실패하면 fallback |
| 리서치 AI: 질문·정리(카드 2·5, 핵심 정리) | Chat Completions JSON 모드, `reasoning_effort: "none"`, `temperature: 0` | v2 요약 호출과 같은 방식 |
| 리서치 AI: 사진 설명(카드 3) | Chat Completions에 `image_url`, 출력은 글 | 선택 기능. 봉사자가 확인하고 고친다 |
| 사진 축소 | 브라우저 canvas(`researchPhoto.ts`). 서버용 JPEG 1.5MB 이하, 기기 저장용 작은 썸네일 | 서버 이미지 처리 라이브러리 없이 본문 한도를 지킨다 |
| 음성 입력 | Web Speech API, 대체는 입력창과 iOS 받아쓰기 | v1 그대로 |
| 시험 | Vitest, `@playwright/test`, `@axe-core/playwright` | v1 그대로 |

v2의 ④ 글자 읽기(OpenAI 또는 Upstage Document OCR), ④ 요약, ④ 생김새 설명(Groq qwen), 긴 이미지 자르기 행은 v2.1에서 없앴다. 화면이 리서치 챗으로 바뀌어 쓰는 곳이 없다.

**별도 백엔드(FastAPI 등)는 두지 않는다.** v1은 "Render 무료판이 잠들면 깨는 데 최대 1분"을 이유로 들었지만, 그 이유는 Render에만 해당한다. v2의 이유는 다음과 같다. Vercel에서 Python을 돌려도 한도(4.5MB, 300초, 2GB)가 같아 이득이 없다. ④는 모두 외부 HTTP API 호출이라 Python이 필요 없다. 두 언어면 시험 기록·Codex 검증 부담이 늘어난다. 같은 프로젝트 공존(Vercel Services)은 Beta이고 Root Directory 변경이 필요하며, 별도 프로젝트를 rewrite로 붙이면 쿠키 전달이 미확인이다. 재검토 조건(정답지 실측에서 Python 전용 OCR이 확실히 낫다 등)이 실측으로 확인되면 시연 뒤 ④만 별도 Vercel 프로젝트(`apps/api`)와 rewrite(캐시 끔)로 다시 검토한다. 상세는 `tsd-review.md`. ④·OCR을 든 이유와 재검토 조건은 v2 기준이다. v2.1에서 ④ 글자 읽기를 없앴다.

## 4. 폴더

저장소는 앱 단위로 나눈다. Vercel 웹 배포의 Root Directory는 `apps/web`이다.

```
supabase/                                   Supabase CLI 설정, link됨(.temp/는 git 제외)
  config.toml
  migrations/<시각>_<이름>.sql              표, SQL 함수. 추가만 한다(§11)
apps/web/                                   Vercel Root Directory
  public/voice/index.html                   이용자(플로우 A, ⑦). apps/user-voice-ui 화면. next.config.ts가 /를 여기로 보낸다(§8.9)
  src/app/classic/page.tsx                  고정 질문 3개 이용자 화면(옛 /)
  src/app/api/voice/chat/route.ts           이용자 AI 대화 한 턴(§8.9)
  src/app/volunteer/page.tsx                봉사자 대기열(②). ② 전에는 v1 시연 화면
  src/app/volunteer/requests/[requestId]/page.tsx   리서치 챗(③④⑤) → ⑥, 완료면 보낸 결과
  src/app/enter/route.ts
  src/app/api/{health,match,chat}/route.ts
  src/app/api/requests/route.ts, [requestId]/route.ts                 플로우 A(접수·기기별 목록·소유 조회)
  src/lib/deviceSession.ts                                              이용자 기기 쿠키 lh_device
  src/app/api/volunteer/queue/route.ts
  src/app/api/volunteer/requests/[requestId]/{route,claim/route,release/route}.ts
  src/app/api/volunteer/requests/[requestId]/research/{route,turn/route,search/route,photos/route,photos/[photoId]/route,review/route,send/route}.ts   대화형 리서치 챗(§8.3). 옛 카드형 research·result 라우트는 지움
  src/components/{SpeechInput,StatusRegion,DemoHandoff,VolunteerChat}.tsx
  src/components/{SentView}.tsx, src/components/research/*.tsx   보낸 결과, 대화형 리서치 챗 화면(`ResearchConversation.tsx`와 부품). 옛 ResearchChat·ResearchCards·ResearchSummary는 지움
  src/lib/{rateLimit,llm,prompt,chat,speech,parseRequest,matchHandoff,volunteers,answerRules}.ts
  src/lib/{voiceChat,voiceInstructions}.ts  서버 전용. 이용자 음성 대화: 요청 검사, OpenAI 호출, 접수 변환, 가짜 대화 / 지시문 원문(§8.9)
  src/lib/requestStore.ts                   서버 전용. 저장소 인터페이스, 메모리 구현, Supabase 구현
  src/lib/volunteerView.ts                  화면·서버 공용 타입(VolunteerRequestView 등)
  src/lib/research.ts                       화면·서버 공용. 카드 순서·필수 여부 상수, 상태, 구매 인증, 화면 문구
  src/lib/researchResult.ts                 화면에서 씀(server-only 아님). 상태 → 결과 본문 변환
  src/lib/researchPhoto.ts                  브라우저 사진 축소·썸네일
  src/lib/research{Ai,Check,Prompt,Request,Mock}.ts   서버 전용. AI 호출, 출력 검사, 카드별 지시문, 본문 검사, 가짜 응답
  src/lib/extract.ts                        서버 전용. /api/health의 extractEngine 판정만 남음(정리 여부 미정)
  tests/{unit,e2e,chatbot}/
  experiments/vision/                       로컬 실험(배포·시험 대상 아님)
```

- 새 lib 파일은 처음 만드는 브랜치에서 `CLAUDE.md` 지도에 추가한다.
- (v2 설계) ③과 ④ 브랜치가 같은 파일을 고치지 않게 공용 타입(`volunteerRequest.ts`, `summaryDraft.ts`)을 먼저 만들고, 각 단계는 자기 부품 파일만 추가한다(§12). v2.1에서 ③④⑤를 한 브랜치로 합쳐 두 파일 모두 없다.
- v2.1에서 없앤 파일: 부품 `RequestDetail`·`AgentSheet`·`CaptureUpload`·`CandidateList`·`SummaryEditor`, 화면 `volunteer/requests/[requestId]/summary/`, 라우트 `extract-text`·`summarize`·`candidates`, lib `candidateDraft`·`summaryEdit`·`captureRead`·`imagePieces`·`summaryDraft`·`evidenceCheck`·`summaryPrompt`와 그 시험.

## 5. 환경 변수

| 이름 | 위치 | 내용 |
|---|---|---|
| `OPENAI_API_KEY` | `apps/web/.env`, Vercel(사람이 등록) | OpenAI 키. 챗봇과 리서치 AI가 함께 쓴다. AI는 읽거나 출력하지 않는다 |
| `GROQ_API_KEY` | 같음(로컬만) | 로컬 실험 서버(`apps/web/experiments/vision/`) 전용. 제품 코드는 읽지 않는다 |
| `UPSTAGE_API_KEY` | 같음(사람이 등록, 선택) | v2.1에서 글자 읽기를 없앴다. 코드는 더 이상 이 키를 읽지 않는다(Vercel에 남아 있으면 지워도 된다) |
| Supabase 연동 변수 | Vercel(Supabase 연동이 넣음) | 코드는 URL `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`, 키 `SUPABASE_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`를 읽는다. 값은 보지 않는다 |
| `DEMO_ACCESS_CODE` | Vercel, 로컬은 시험 설정 | 코드 입력용이 아니라 봉사자 기기 쿠키(`lh_vol`)와 이용자 기기 쿠키(`lh_device`)의 서명 비밀(용도별로 달리 만든다). 값을 바꾸면 모든 봉사자 기기의 입장이 풀리고 이용자 기기는 새 기기가 되어 이전 요청이 목록에서 사라진다. 없으면 봉사자 입장이 503이고, 이용자 접수는 기기 없이 된다 |
| `LLM_MODE` | 시험 설정 | `mock`이면 가짜 응답 |
| `STORE_MODE` | 시험 설정 | `memory`면 서버 메모리 가짜 저장소 |
| `EXTRACT_MODE` | 시험 설정 | v2에서는 글자 읽기·요약 가짜 응답. v2.1부터는 `/api/health`의 `extractEngine` 값에만 영향. 리서치 AI의 가짜 응답은 `LLM_MODE=mock`이다 |

- 세 `*_MODE`는 모두 `VERCEL_ENV=production`에서 무시하고 실제로 동작한다(v1 `llm.ts:13-16`과 같은 규칙).
- Supabase 키가 없으면 저장소는 메모리로 떨어지고, `/api/health`의 `store`가 `memory`라고 알린다.
- 키 파일 규칙(`.env` 미커밋, `.vercelignore`)은 v1 그대로다. `.demo-access.local`은 더 이상 읽지 않는다.

## 6. 음성 입력

```ts
const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
recognition.lang = 'ko-KR';
recognition.continuous = false;
recognition.interimResults = false;
recognition.maxAlternatives = 1;
```

- 버튼을 누를 때만 시작한다. 결과는 바로 보내지 않고 확인 단계를 거친다.
- 입력 상태: `idle → starting → listening → confirming → submitting`. 실패하면 `text`(입력창)로 간다.
- 입력창 전환 조건: 음성 인식 API 없음, `start()`가 예외, 3초 안에 `start` 이벤트 없음, `not-allowed`, `service-not-allowed`, `audio-capture`, `network` 오류.
- `no-speech`와 `nomatch`는 "못 들었습니다"를 안내하고 다시 시도하게 한다. 2회 연속이면 입력창으로 간다.
- 입력창은 일반 `<input type="text" lang="ko">`다. iOS 키보드 받아쓰기를 그대로 쓴다.
- 기본 입력 방식은 `apps/web/src/lib/speech.ts`의 상수 `PRIMARY_INPUT`(`speech` 또는 `text`)이다. 0블록 결과로 정한다.
- 크롬의 음성 인식은 오디오를 서버 인식 엔진으로 보낼 수 있다(MDN). 시연에서 개인정보를 말하지 않는다.

### 0블록 음성 시험 페이지

`apps/web/public/speech-probe/` 정적 HTML 1개다. 공개 주소는 `/speech-probe/`. 버튼 2개(즉시 시작, 1초 뒤 시작)로 VoiceOver의 버튼 낭독이 인식에 섞이는지 비교한다. 화면에 API 유무, 이벤트 순서, 오류 코드, 인식 문장을 표시하고 아무것도 전송하지 않는다.

결과에 따라 정한다.
- `PRIMARY_INPUT` 값
- 시작 지연 `SPEECH_START_DELAY_MS`: 즉시 시작이 깨끗하면 0, 낭독이 섞이고 지연 시작이 동작하면 1000

## 7. 접근성 동작

| 시점 | 상태 안내(`role="status"`) | 초점 이동 |
|---|---|---|
| 이용자 화면 열림 | 없음 | 제목(`h1`) |
| 듣기 시작 | "듣고 있습니다. 말씀하세요." | 유지 |
| 인식 완료 | "이렇게 들었습니다: {문장}" | "이대로 요청" 버튼 |
| 인식 실패, 입력창 전환 | "음성 인식을 쓸 수 없습니다. 입력창에 받아쓰기로 입력하세요." | 입력창 |
| 매칭 중 | "봉사자를 찾고 있습니다." | 유지 |
| 매칭 완료 | "{봉사자}와 연결됐습니다." | (시연) "봉사자 화면으로(시연)" 버튼 |
| 봉사자 화면 열림 | "시연: 봉사자 화면으로 바뀌었습니다. 이용자 요청: {브랜드} {품목}." | 제목(`h1`) |
| 답변 생성 중 | "답변을 만들고 있습니다." | 유지 |
| 답변 완료 | "답변이 도착했습니다." | 답변 영역(`tabIndex={-1}`) |
| 오류 | 오류 표 문구 | 다시 시도 버튼 |

- 답변이 도착하는 동안 답변 영역을 낭독 영역으로 두지 않는다. 끝난 뒤 초점을 옮겨 한 번에 읽게 한다.
- 답변은 줄바꿈이 있는 일반 글자로 표시한다. 마크다운 기호를 읽지 않게 하기 위해서다.
- `<html lang="ko">`, 화면 확대 허용, 페이지별 `document.title`, 눌림 영역 44px 이상, 색 대비 4.5:1 이상.
- 음성 버튼은 이용자 첫 화면의 제목 아래 남는 영역을 모두 채운다.
- 앱은 소리를 직접 내지 않는다. 모든 안내는 VoiceOver가 읽는다.
- 이용자 화면에는 챗봇 UI를 두지 않는다. 봉사자 화면에는 이용자 요청 작성 UI를 기본으로 두지 않는다.
- 시연 이어 보기 버튼은 매칭 완료 후에만 나타나며, 접근 가능한 이름에 "시연"을 포함한다.
- 실제 낭독과 초점 이동은 AI가 판정하지 못한다. 자동 시험은 DOM과 `document.activeElement`까지 본다.


### 7.1 봉사자 화면(플로우 B) 추가 동작

| 시점 | 상태 안내(`role="status"`) | 초점 이동 |
|---|---|---|
| 대기열 열림 | "대기 중인 요청 {n}건입니다." / "대기 중인 요청이 없습니다." | 제목(`h1`) |
| 요청 선택 성공 | 없음(리서치 챗으로 이동) | 리서치 챗 제목(`h1`). 이미 다른 곳에 초점이 있으면 옮기지 않는다 |
| 이미 진행 중 | "이미 다른 봉사자가 진행 중입니다. 목록으로 돌아갑니다." | 목록 제목 |
| 카드가 바뀜(다음, 이전, 빠진 카드로 가기) | 없음 | 새 질문(`h2`). 보내기 전 확인 단계면 그 제목(`h2`) |
| AI 검색 시작·끝(카드 1·4·6·7) | 찾는 중 안내, 끝나면 찾은 개수와 "확인 필요" 또는 못 찾았다는 안내 | 유지 |
| 필수 답 없이 "다음" | 카드별로 무엇이 빠졌는지 | 유지 |
| 사진 올림·지움, 사진 설명 초안 | 올린 장수, 구매 인증이 된 순간의 배지 문구, 설명 초안 도착·실패 | 유지 |
| 필수 카드가 빈 채 "완료하고 보내기" | 아직 답하지 않은 필수 질문 이름 | 유지 |
| ⑥ 전송 성공 | 전송 성공 안내 | 제목 |
| ⑥ 전송 실패 | 전송 실패 안내(입력은 그대로 둔다) | 다시 보내기 버튼 |
| "내려놓기"를 처음 누름 | 확인 안내(내려놓으면 이 기기의 답과 사진이 지워지고 요청이 대기열로 돌아간다). 브라우저 확인 창은 쓰지 않는다 | 확인 안내 |
| 내려놓기 취소(취소 버튼, Esc, 카드 이동) | 없음 | "내려놓기" 버튼(카드 이동이면 새 질문) |

- 화면 구조: 위 띠(제목·구매 인증 배지·진행 점·현재 질문)는 고정이라, 답을 쓰는 동안에도 현재 질문이 화면 위에 보인다(이용자 기획 설계원칙 4). "이용자가 한 말" 상자와 보조 문구는 스크롤 본문에 둔다. 화면이 아주 작거나 글자를 크게 키워 두 띠가 화면을 너무 많이 차지할 때만 고정을 풀어 입력 칸이 가려지지 않게 한다(조건은 `ResearchChat.tsx`). 초점 받은 칸은 띠 밖으로 스크롤된다.
- 리서치 챗의 안내 글자는 `research.ts`의 `RESEARCH_COPY`와 `ResearchConversation.tsx`(`COPY`)에, 대기열·전송 안내는 `volunteerView.ts`의 `VOLUNTEER_MESSAGES`에 있다. 이 표는 시점과 초점만 정한다.
- 상태 안내는 화면마다 `StatusRegion`(`role="status"`) 하나로 한다.
- 진행 점 7개는 그림(`role="img"`)으로 묶고 몇 번째 질문인지 글 이름을 준다(`RESEARCH_COPY.progressAlt`). 눈에 보이는 진행 글자는 낭독에서 숨긴다.
- 막힌 버튼은 `disabled` 대신 `aria-disabled`로 둔다. 초점이 버튼에 남고, 막힌 "다음"·"완료하고 보내기"를 누르면 이유를 안내한다.
- 하나를 고르는 버튼(구매 여부, 사진 종류, 후보 칩)은 `aria-pressed`로 선택 상태를 알린다. 구매 여부는 `fieldset`·`legend`로 묶는다.
- AI 제안 상자는 제목이 연결된 `section`이다. 글 칸은 모두 `label`과 연결한다. 올린 사진에는 순번이 든 대체 글자와 지우기 버튼 이름을 준다.
- 대기열은 자동으로 새로 읽지 않는다(폴링 없음). "새로 읽기" 버튼과 화면에 초점이 돌아올 때만 읽는다. 목록이 저절로 바뀌어 낭독이 끊기지 않게 하기 위해서다.
- v2의 ③ 답변 실패, ④ 조각 읽기·요약 초안·글자 읽기 실패, ⑤ "요약이 맞나요?" 행과 "요약 항목·근거 원문 펼치기" 규칙은 v2.1에서 없앴다.
- 봉사자 화면은 시각장애인 전용이 아니지만, 같은 접근성 기준(44px, 대비 4.5:1, axe 위반 0건)을 지킨다.

## 8. API

공통: QA 기간에는 접근 코드가 없어 이용자 쪽 라우트(`/api/requests`, `/api/match`, `/api/chat`, `/api/health`)는 쿠키 없이 열리고, 남은 보호는 접속 주소별 횟수 제한뿐이다. 사용자 문장, 이미지, 봉사자가 쓴 글은 로그에 남기지 않고 상태 코드, 소요 시간과 라우트별 짧은 분류 값만 남긴다(리서치는 §8.7). 새 라우트의 실패 본문은 `{ "ok": false, "error": "<코드>" }`다. 봉사자 API(`/api/volunteer/*`)는 봉사자 쿠키(`lh_vol`)가 없거나 맞지 않으면 401 `unauthorized`, 경로의 id가 UUID가 아니면 400 `invalid_request`, 저장소 오류는 503 `store_unavailable`, 횟수 초과는 429 `rate_limited`(+`Retry-After`)다.

### 8.1 v1에서 이어지는 것

- `GET /enter?code=...`: 코드를 읽지 않고 쿠키 없이 `/`로 303 이동만 한다(퍼진 옛 링크 유지). `POST /api/match`: v1 그대로. `/api/match`와 `lh.match.v1`은 ②가 병합될 때까지 시연 이어 보기용이다.
- `GET /api/health`: v1 응답에 `store: "supabase" | "memory"`, `extractEngine: "openai" | "mock" | null`을 더한다. 키 값은 반환하지 않는다. v2.1에서 글자 읽기를 없앴지만 `extractEngine` 필드와 `extract.ts`의 `getExtractEngine`은 남아 있고, 값은 리서치 챗 사진 설명이 실제로 쓰는 조건(OpenAI 키, `LLM_MODE`·`EXTRACT_MODE`의 mock)을 따른다(`upstage` 값은 없앴다). 필드를 없앨지는 정하지 않았다.

### 8.2 공용 요청 모양

봉사자 화면(리서치 챗, ⑥)은 `src/lib/volunteerView.ts`의 `VolunteerRequestView` 하나로 요청을 다룬다. 필드는 그 파일을 따른다.

- v2 설계의 `lib/volunteerRequest.ts` 타입 블록(`queueNumber` 포함)과 `lh.match.v1` 어댑터는 v2.1에서 없앴다. 리서치 챗은 `lh.match.v1`을 읽지 않는다.

### 8.3 Supabase 표와 SQL 함수

**`requests`** (플로우 A PR 2에서 아래 열을 모두 만든다. 플로우 B가 열을 다시 바꾸지 않게 하기 위해서다)

| 열 | 형 | 비고 |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `client_request_id` | uuid unique | 중복 접수 방지 |
| `queue_date`, `queue_number` | date, int | unique(queue_date, queue_number). 날마다 1번부터 |
| `product`, `budget`, `condition` | text | 이용자 답 원문, 각 200자 이하 |
| `brand`, `item` | text | `parseRequest` 결과 |
| `condition_kind` | text null, check in ('new','used','any') | 서버 정규화, 실패하면 null |
| `status` | text not null default 'waiting', check in ('waiting','in_progress','done','expired') | |
| `volunteer_id` | text null, check `^v-[0-9]{2}$` | |
| `device_id` | text null | 접수한 이용자 기기 ID(`u-`+32자리, `lh_device`에서 뽑음). 처음 만들 때만 저장하고 같은 `client_request_id`를 다시 보내도 덮어쓰지 않는다. 옛 요청·시연 요청은 null(번호만 알면 조회되고 어느 기기 목록에도 안 나온다). 마이그레이션 `20261123000000_request_device.sql`, 되돌리기 `supabase/rollback/20261123000000_request_device_down.sql` |
| `claimed_at`, `done_at` | timestamptz null | 10분 지표 |
| `release_count` | int default 0 | 반납 기록 |
| `created_at`, `updated_at` | timestamptz default now() | |

인덱스 (status, created_at), (device_id, created_at desc) where device_id is not null. RLS 켬, 정책 없음.

**`results`**

| 열 | 형 | 비고 |
|---|---|---|
| `request_id` | uuid pk references requests(id) on delete cascade | 요청 하나에 결과 하나 |
| `volunteer_id` | text not null | |
| `candidate_name` | text not null, 100자 이하 | |
| `purchase_url` | text not null, `^https://`, 2048자 이하 | 서버는 저장만 하고 열지 않는다 |
| `guide` | text not null, 1000자 이하 | |
| `summary` | jsonb not null | 확정 요약 `[{key,label,value}]` 최대 12개 |
| `summary_source` | text check in ('ocr','manual') | |
| `summary_edited` | boolean | ⑤에서 고쳤는지 |
| `sent_at` | timestamptz not null | 지표 = sent_at − claimed_at |

저장하지 않는 것: 이미지 원본, 글자 읽기 원문, 요약 초안, 근거 원문, 생김새 설명 원본. v2.1부터는 리서치 챗의 사진·썸네일과 AI 도움 원본도 저장하지 않는다. 결과에는 봉사자가 고르거나 확인한 것만 기존 결과 형식으로 들어간다.

**상태**

```
waiting --claim(먼저 누른 1명)--> in_progress --complete(맡은 봉사자)--> done
waiting --24시간--> expired
in_progress --release(맡은 봉사자, 선택 기능)--> waiting (release_count+1)
```

**보관**: `waiting`이 24시간을 넘으면 `expired`(시연 요청 `is_demo`는 제외: 시간이 지나도 `waiting`으로 남아 봉사자 대기열에 계속 보인다. 메모리 저장소, Supabase 대기열 조회 `created_at > 24시간 전 or is_demo`, `register_request`의 정리, 맡기 `claim_request`의 24시간 조건 `is_demo or created_at > 24시간 전`이 모두 같다), `expired`는 24시간 뒤 삭제, `done`은 `done_at` 기준 7일 뒤 삭제(기간은 이용자 결정 대기). 정리는 SQL 함수가 호출될 때 함께 한다. `pg_cron`은 무료판 사용 가능 여부가 미확인이라 쓰지 않는다. 플로우 A 초안의 "24시간 뒤 삭제"를 이것으로 바꾼다.

**SQL 함수**(서버 키로만 실행. `revoke execute ... from public, anon, authenticated`, `grant ... to service_role`, `security invoker`, `set search_path = ''`)

| 함수 | 하는 일 | 결과(`out_outcome`) |
|---|---|---|
| `register_request(..., p_device_id text default null)` | 플로우 A 접수. 같은 `client_request_id`면 기존 행(기기 ID는 덮어쓰지 않음), 아니면 날짜별 다음 번호로 삽입하며 기기 ID를 저장. 마지막 인자가 기본값이라 7개 인자 호출(마이그레이션 전 앱)도 된다. 앱은 마이그레이션 전에 8번째 인자를 모르는 DB를 만나면 빼고 다시 보내고, 60초 뒤 다시 8인자로 시도해 스스로 돌아온다. 같은 마이그레이션이 `claim_request`도 다시 정의한다(시연 요청은 24시간이 지나도 맡을 수 있다). **적용 순서: 원격 마이그레이션 `20261123000000`을 먼저 적용하고 그 뒤에 main에 병합·배포한다.** 앱이 먼저 나가면 그 사이 접수에는 기기 ID가 붙지 않고(목록에 안 나옴), 열이 없는 동안 목록은 503이다 | `created` / `existing` |
| `claim_request(p_request_id, p_volunteer_id)` | `update ... set status='in_progress' ... where id=$1 and status='waiting' returning ...` 한 문장. 실패하면 현재 상태를 보고 판정 | `claimed` / `already_mine` / `taken` / `done` / `expired` / `not_found` |
| `release_request(p_request_id, p_volunteer_id)` | 맡은 본인일 때만 `waiting`으로, `volunteer_id`·`claimed_at` null, `release_count+1` | `released` / `not_yours` / `not_in_progress` / `not_found` |
| `complete_request(p_request_id, p_volunteer_id, 결과 필드)` | 한 트랜잭션에서 `results` 삽입과 `status='done', done_at=now()`. 이미 `done`이고 본인 결과면 기존 행을 돌려줌(재전송해도 같은 결과) | `completed` / `existing` / `not_yours` / `not_in_progress` / `not_found` |

**`request_details`** (마이그레이션 `20261122000000_request_details.sql`, 되돌리기 `supabase/rollback/20261122000000_request_details_down.sql`. 추가형이라 기존 표·함수를 바꾸지 않는다)

| 열 | 형 | 비고 |
|---|---|---|
| `request_id` | uuid pk references requests(id) on delete cascade | 요청 하나에 하나. 서버는 처음 저장한 것을 지킨다(`ignoreDuplicates`) |
| `summary` | text not null default '', 300자 이하 | 이용자가 확인한 요약 |
| `qa` | jsonb not null default '[]', 배열·12짝 이하·16,000바이트 이하 | `[{q, a}]` 질문과 이용자 답 |
| `created_at` | timestamptz default now() | |

RLS 켬, 정책 없음, `anon`·`authenticated` 권한 회수, `service_role`만 select·insert·delete. 트리거 `request_details_drop_on_close`(`requests.status`가 `done`·`expired`로 바뀔 때 그 행을 지운다, `security invoker`)가 보관을 맡는다.

- 동시 선택은 Postgres Read Committed에서 UPDATE의 WHERE를 다시 평가하는 성질로 막는다(먼저 누른 사람만 성공). advisory lock이나 SKIP LOCKED는 쓰지 않는다. 근거: https://www.postgresql.org/docs/current/transaction-iso.html
- 반환 열 이름은 `out_`으로 시작하고 표 열은 별칭으로 한정한다. 반환 이름이 열 이름과 같으면 PL/pgSQL에서 "ambiguous" 오류가 난다.
- 초안 SQL은 `tsd-review.md`의 근거 문서와 워크플로 산출물에 있다. 실제 Postgres에서 돌려 보기 전까지는 추정이다(§10, §13).

### 8.3.1 리서치 챗 대화 표와 SQL 함수(v2.2 초안, 마이그레이션 `20261117000000_research_conversation.sql`)

추가형이다. 위 표 2개와 함수 5개는 바꾸지 않는다. 모든 표는 RLS를 켜고 정책이 없으며 `revoke all from anon, authenticated`다.

| 표 | 내용 | 지워지는 때 |
|---|---|---|
| `research_sessions` | 요청당 세션 1개. 구매 여부, 칸 7개(`slots`), 추가 답, 질문 횟수(`counters`), 확인 필요(`pending`), 리뷰(`review`), 검색 캐시, `version`, `next_seq` | 요청이 in_progress에서 벗어나거나 봉사자가 바뀔 때(트리거), 요청 삭제(cascade) |
| `research_messages` / `research_turns` | 대화 메시지(≤8,192바이트), 같은 `clientTurnId` 중복 방지와 처리 중 자리 | 세션과 함께 |
| `research_photos` | 구매 인증 사진 JPEG 썸네일(≤60,000자), 설명·표기 기종·촬영 종류는 null 허용 | 세션과 함께 |
| `research_usage` | 요청당 AI 턴·웹 검색·사진·리뷰 횟수 | 요청이 지워질 때만(세션이 지워져도 남음) |
| `ai_usage_daily` | 서울 날짜별 웹 검색·AI 호출 횟수 | 없음(날짜당 한 줄) |

| 함수 | 하는 일 |
|---|---|
| `research_open(p_request_id, p_volunteer_id, p_after)` | `p_after`가 없으면 6시간 정리 뒤 소유를 확인하고 세션을 만들어 전부 돌려준다. 있으면 읽기만(폴링) |
| `research_begin(...)` | 소유·`session_id` 확인, 중복 턴·처리 중, stale(세지 않음), 검색 캐시, 요청당·하루 상한 확인, 스냅숏 |
| `research_apply(...)` | 중복이면 저장된 응답(stale보다 먼저), stale, patch 반영, 칸이 바뀌면 `version+1`이고 확정 리뷰는 draft로, 다음 질문 후보 중 첫 유효 후보를 메시지로 |
| `research_add_message` / `research_add_photo` / `research_remove_photo` | 검색 결과 저장, 사진(3장, 리서치만이면 거부) 넣기·지우기와 같은 처리에서 다음 질문 |
| `research_set_review` / `research_send` | 리뷰 draft·confirmed 저장, 보내기(필수 칸·확정 리뷰·`version` 확인 뒤 요청 done과 `results` 삽입. 다시 보내면 existing) |
| `research_sweep(p_idle)` | 6시간 넘게 활동이 없는 in_progress 요청을 `release_request`와 같은 값으로 대기열에 돌린다 |
| 트리거 `research_drop_on_leave` | `requests`가 in_progress에서 벗어나거나 봉사자가 바뀌면 그 세션을 지운다 |

- 필수 칸: 기종, 장점, 대안 대신 고른 이유, 구매함이면 사진, 구매 여부 정해짐. 리서치만이면 사진 칸이 없다.
- 잠금 순서는 언제나 `requests` → `research_sessions` → `research_usage` → `ai_usage_daily`다. 세션을 쓰는 함수는 요청 행을 `for share`로, 요청을 바꾸는 `research_send`·`research_sweep`은 `for no key update`·`skip locked`로 먼저 잠근다. 그래서 내려놓기·보내기·정리와 교착이 없고, 소유 확인 뒤 내려놓기가 끝나 세션이 남는 경합도 없다.
- 상한: 요청당 AI 턴 40, 웹 검색 12, 사진 올리기 6, 리뷰 3. 하루 웹 검색 380, AI 호출 1500(QA 1회 2.5만 원 기준, 환경변수 `RESEARCH_DAILY_SEARCH_CAP`·`RESEARCH_DAILY_AI_CAP`로 바꿈).
- 함수는 모두 `security invoker`, `set search_path = ''`, `revoke execute from public, anon, authenticated`, `grant to service_role`다. 시험은 PGlite(`tests/unit/sql/researchSql.test.ts`).
- 되돌리기: `supabase/rollback/20261117000000_research_conversation_down.sql`을 사람이 실행하고 `supabase migration repair --status reverted 20261117000000 --linked`를 실행한다.
- 휴대폰 사진 링크(`photo_links`)는 11/18 뒤 마이그레이션 2(`20261119000000_photo_links.sql`)에서 더한다.

### 8.4 플로우 A(①②)

| 경로 | 성공 | 실패 |
|---|---|---|
| `POST /api/requests` `{clientRequestId, product, budget, condition, details?}` | 201 `{requestId, queueNumber, status:"waiting"}`, 같은 `clientRequestId` 재전송은 200 같은 본문 | 400 `invalid_request`/`too_long`, 413 `too_large`(본문 32KB 초과), 401, 429, 503. 품목 사전(헤드셋)에 없는 물건도 받고 `item`은 null로 둔다(2026-11-18 A6, 전에는 422 `need_item`) |
| `GET /api/requests` | 200 `{items:[{requestId, queueNumber, status, product, createdAt, review?, sentAt?}]}`: 쿠키 `lh_device`의 기기가 접수한 요청만, 최신순 최대 20건. `done`이면 `review`(리뷰 문단)와 `sentAt`을 붙인다. `complete`는 이 목록이 이 기기의 요청 전부일 때(저장소가 DB일 때)만 true. 쿠키가 없거나 틀리면 새로 심고 빈 목록. 서명 비밀이 없으면 503 `not_configured`, 기기 열이 없는 동안(마이그레이션 전)에도 503(화면이 기록을 지키게). `Cache-Control: no-store`. 다른 기기의 요청은 담기지 않는다. `POST`에서 이미 있는 접수 id(`existing`)를 다른 기기가 다시 보내면 409 `conflict` | 429(분당 60), 503 |
| `GET /api/requests/{id}` | 200 `{requestId, queueNumber, status, product}`. `status="done"`이면 `result:{candidateName, purchaseUrl, guide, summary}`를 덧붙임(플로우 C 경계). 요청에 기기 ID가 있으면 같은 기기 쿠키여야 한다(아니면 없는 요청처럼 404). 기기 ID가 없는 행(옛 요청·시연)은 그대로 조회 | 400, 404 `not_found`, 401, 429, 503 |
| `POST /api/requests/{id}/push` | 푸시 구독 붙이기. `GET {id}`와 같은 소유 규칙(다른 기기·쿠키 없음은 404) | 400, 404, 409, 429, 503 |

- `details`는 선택이다: `{summary, qa:[{q, a}]}`(이용자 음성 대화가 확정할 때 서버가 `request`에 실어 주고 화면은 그대로 접수로 보낸다). 서버가 길이·개수·제어 문자·전화번호 모양을 거르고, 쓸 수 없는 `details`는 무시한 채 접수는 그대로 된다. 처음 접수된 대기 요청에만 `request_details`에 저장하며, 표가 없거나(마이그레이션 전) 저장이 실패해도 접수는 성공한다. 로그에는 ` details=saved|exists|none|ignored|unavailable|failed`만 남기고 글은 남기지 않는다. 이용자 상태 조회(`GET /api/requests/{id}`)와 대기열에는 `details`를 내보내지 않는다.

세부(검사 순서, 낭독 문구, 다시 열기)는 플로우 A 계획(`docs/plans/2026-11-09-overnight/`)을 따른다.

### 8.5 플로우 B ②⑥ 봉사자 API

| # | 경로 | 성공 | 실패 |
|---|---|---|---|
| 1 | `GET /api/volunteer/queue` | 200 `{items:[{requestId, queueNumber, product, budget, condition, createdAt, waitingMinutes}], mine:[내가 맡은 in_progress]}`, 오래된 순 최대 20개 | 공통 |
| 2 | `POST /api/volunteer/requests/{id}/claim` | 200 `{requestId, status:"in_progress", claimedAt, alreadyMine, request: VolunteerRequestView}` | 409 `already_claimed` / `already_done` / `expired`, 404 |
| 3 | `GET /api/volunteer/requests/{id}` | 200 `{request: VolunteerRequestView, result, details}` + `status`. `details`(`{summary, qa}` 또는 null)는 내가 진행 중인 요청에만 오고 보낸 뒤·저장된 글이 없을 때는 null | 403 `not_yours`, 404 |
| 4 | `POST /api/volunteer/requests/{id}/release` (선택) | 200 `{requestId, status:"waiting"}` | 403 `not_yours`, 409 `not_in_progress` |
| 5 | *(v2.2 초안에서 `POST /api/volunteer/requests/{id}/research/send`로 대체됨. 이 줄의 `/result`는 지웠다)* `POST /api/volunteer/requests/{id}/result` `{candidateName, purchaseUrl, guide, summary, summarySource, summaryEdited}` | 201 `{requestId, status:"done", sentAt, durationSeconds}`, 같은 봉사자 재전송은 200 같은 본문 | 400 `invalid_request`/`too_long`/`invalid_url`, 403 `not_yours`, 409 `not_in_progress`, 404 |

Next 16의 동적 경로 `params`는 Promise라 `await`한다(구현 때 설치된 Next 타입으로 확인).

### 8.6 ③ `POST /api/chat`

v1 계약에 선택 필드만 더한다. 봉사자 화면에서만 호출한다.

요청 `{ "requestId": "uuid", "question": "...", "context": { "brand": "Sony", "item": "헤드셋", "hasBudget": true, "condition": "used" } }`

- `hasBudget?: boolean`, `condition?: "new" | "used" | "any" | null`. 둘 다 없어도 된다. 없으면 v1과 같은 지시문이 나간다.
- **예산 숫자는 넘기지 않는다.** 지시문에 "10만 원"이 들어가면 답에 되풀이될 수 있고, 가격 금지 검사(`answerRules.ts:17`)가 이를 위반으로 잡는다. 예산 원문은 봉사자 화면에만 보인다.
- 질문 300자 이하, 본문 상한 `MAX_BODY_BYTES` 2048 → 4096.
- 응답, 오류 표, `runtime`, `maxDuration`은 v1 그대로.
- 대화 기록은 보내지 않는다(v1 그대로). 대화는 봉사자 탭 메모리에만 있다.

### 8.7 ③④⑤ `POST /api/volunteer/research` (v2.1, v2.2 초안에서 지움: 대화형 `research/*` 라우트로 대체, §8.3)

리서치 챗의 AI 도움 한 번을 돌려준다. 상태가 없다. 요청·응답 필드, 로그 형식, 검사 패턴 같은 세부 계약은 `apps/web/src/lib/research.ts`·`researchImage.ts`·`researchCheck.ts`를 따른다(옛 라우트 파일은 지웠다).

- 설정: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`. 응답은 래퍼 없는 JSON, `Cache-Control: no-store`. 봉사자 쿠키가 있어야 한다.
- 요청 `{ requestId, kind, ... }`. `kind`는 8종이다: 카드용 `model`·`pros`·`alts`·`altReason`·`benefits`·`refs`, 사진 설명 `photo`, 핵심 정리 초안 `summary`. kind에 필요한 답(기종, 같이 고민한 제품 등)을 함께 보낸다.
- 서버는 저장소에서 요청을 읽어 "내가 맡은 진행 중 요청"인지 확인한다. 브랜드·품목·요청 문장은 저장소 값만 쓴다.
- 응답 200 `{ kind, ai: "ok" | "fallback", ... }`. kind에 따라 기종 후보(최대 5), 질문 문장과 힌트(최대 3), 링크(최대 4)와 쇼핑몰·검색 바로가기, 참고 글 요약(최대 4줄), 사진 설명(200자 이내), 핵심 정리(600자 이내)를 준다. 링크 주소는 항상 https다.
- AI 호출이 실패하거나 시간이 넘어도 200 + `ai: "fallback"`으로 답한다. 기본 질문, 시연 품목이면 고정 후보(`demoCandidates.ts`), 바로가기, 답을 이은 기본 글을 준다. 본문 오류와 권한 오류만 4xx다.
- 실패: 400 `invalid_request`/`too_long`, 401 `unauthorized`, 403 `not_yours`, 404 `not_found`, 409 `not_in_progress`(내 요청이지만 이미 보냄), 413 `image_too_large`, 415 `bad_image_format`, 429 `rate_limited`(+`Retry-After`), 503 `store_unavailable`, 500 `internal_error`(예상 못 한 예외).
- 한도(봉사자별): 라우트 전체 30회/분, 검색 kind(`model`·`alts`·`benefits`·`refs`)는 따로 8회/분. 서버 메모리 기준이라 인스턴스마다 따로 센다. 화면은 받은 AI 도움을 기기 상태에 넣어 두고, 입력이 그대로면 다시 부르지 않는다("다시 찾기"를 누를 때만 다시 부른다).
- 사진(`kind: "photo"`): `image`는 `data:image/jpeg` 또는 `data:image/png` base64이고, 디코드 후 1.5MB 이하다. 서버는 사진을 AI에 넘긴 뒤 버리고 저장하지 않는다.
- 서버는 화면이 준 주소를 열지 않는다. 웹 페이지는 OpenAI의 `web_search` 도구가 읽는다.
- 로그에는 상태 코드, 소요 시간, kind, AI 결과(ok·fallback), 상위 호출 결과만 남긴다. 글·사진·키·봉사자 ID는 남기지 않는다.

### 8.8 (v2.1에서 없앰) ④ `extract-text`, ④⑤ `summarize`

v2의 §8.7 `POST /api/volunteer/extract-text`(이미지 조각 하나의 글자 읽기)와 §8.8 `POST /api/volunteer/summarize`(`SummaryDraft` 요약 초안, `evidenceCheck` 근거 대조), `GET /api/volunteer/requests/{id}/candidates`는 v2.1에서 없앴다. 계약 원문은 이 파일의 v2.1 이전 판(git 기록)에 있다. 그중 "가격·재고·할인은 AI 출력에 넣지 않는다"(11/9 계획 정해 줄 것 2의 추천안)는 리서치 AI 출력 검사(§9.1)로 이어진다.

### 8.9 플로우 A 음성 대화(`/`)와 `POST /api/voice/chat`

이용자 화면(`/`)은 동료가 만든 apps/user-voice-ui(PR #40)의 화면이다. 화면(`public/voice/index.html`)과 서버 계약은 원본 그대로 옮겼고, 아래 둘만 바꿨다. apps/user-voice-ui는 그대로 두고 읽기만 한다. 봉사자용 `/api/chat`과 경로가 겹쳐 서버는 `/api/voice/chat`이다.

- 서버는 대화를 저장하지 않는다(무상태). 서버리스는 인스턴스가 바뀌면 메모리 세션이 사라지므로 화면이 대화 기록(`history`)을 한 턴마다 함께 보낸다.
- 확정(`done`)하면 화면이 `POST /api/requests`를 불러 봉사자 대기열에 올린다. 대화 id(`sessionId`)가 `clientRequestId`라 다시 보내도 번호가 늘지 않는다. 접수가 실패해도 화면 흐름(기기 안 목록)은 그대로다. 접수·목록 응답이 `lh_device`를 심으므로(같은 출처 요청이라 쿠키가 자동으로 간다) 화면은 코드를 다루지 않는다.

| 항목 | 값 |
|---|---|
| 요청 | `{sessionId, message, reset, history}`. 원본 `{sessionId, message, reset}`에 `history: [{role, content}]`만 더했다. `reset`이면 history는 무시한다 |
| 응답 | 200 `{reply, status, summary, product, request?}`. `status`는 `asking`·`confirming`·`done`. `request`는 `done`이고 `product`나 `summary`에 글이 있을 때 `{product, budget, condition, details?}`(접수 본문 모양). 둘 다 비면 없다(로그 `queue=skipped`). `details`는 서버가 받은 `history`에서 질문(AI가 묻거나 확인한 `asking`·`confirming` 답)과 바로 다음 이용자 말을 짝지어 만든 `{summary, qa}`이고, 마지막 동의 짝과 시작 문장은 뺀다 |
| 실패 | 원본 메시지 그대로: 400(세션 식별자·메시지 길이·답변 비어 있음·대화가 길어짐), 503(키 없음), 500(AI 실패·시간 초과). 새로 더한 것: 400 `대화 기록 오류`·`요청이 너무 큽니다`, 429(주소당 분당 20회) |
| 호출 | OpenAI Responses API. 모델 `OPENAI_MODEL`(없으면 `gpt-4.1-mini`), `max_output_tokens: 450`, JSON 모드, `store: false`, 25초 마감. 키는 `OPENAI_API_KEY` |
| 상한 | 기록 36칸 미만(원본과 같다), 기록 한 칸 2000자, 이용자 문장 1000자, 본문 64KB |
| 지시문 | `voiceInstructions.ts`. 원본 `instructions` 원문이고 시험이 원본 파일과 글자 단위로 같은지 확인한다 |
| 가짜 | `LLM_MODE=mock`이면 `voiceChat.ts`의 고정 대화(운영 `VERCEL_ENV=production`에서는 꺼진다) |

- 접수 변환(`toQueueRequest`): `product`나 `summary`에 품목 사전의 품목(헤드셋·헤드폰)이 있으면 그 글을 product로 쓰고, 없으면(예: 밥솥) `product`(비었으면 `summary`)를 그대로 써서 대기열에 올린다(2026-11-18 이용자 결정 A6, 전에는 기기 안 목록에만 남겼다). 둘 다 비었을 때만 request를 주지 않는다. 예산은 요약에서 금액 표현을 찾고, 조건은 "중고"·"새 제품"을 찾으며, 없으면 "정하지 않음"이다.
- 이 서버 계약에는 가격·재고·모델명 금지 검사가 없다(원본 지시문에 맡긴다). 봉사자 챗봇의 `answerRules`와 달리 이 화면의 AI 답은 검사하지 않는다.
- 로그에는 상태 코드와 소요 시간, 오류 종류만 남긴다(이용자 문장·AI 답 제외).
- 확인하지 못한 것: 실제 `gpt-4.1-mini` 호출 결과, 실기기 음성 인식·읽어 주기·VoiceOver 동작.

### 리서치 챗 사진 축소(브라우저)

- 봉사자가 고른 사진을 canvas로 줄여 서버용 JPEG(디코드 후 1.5MB 이하)와 기기 저장용 작은 썸네일을 만든다(`researchPhoto.ts`). 원본은 어디에도 저장하지 않는다.
- 사진은 1~3장이다. 서버용 사진은 탭 메모리에만 두고, 봉사자가 사진 설명 버튼을 누를 때만 `kind: "photo"`로 보낸다. 새로 고친 뒤에는 썸네일로 설명을 만든다.
- v2의 긴 이미지 조각 자르기, 조각 차례 보내기, 3회 실패 시 입력창, Supabase Storage 대체 경로는 v2.1에서 없앴다.

## 9. 챗봇

호출값, 클라이언트 설정, 스트림 처리, 횟수 제한은 v1 그대로다(`stream: true`, `max_completion_tokens: 800`, `maxRetries: 1`, `timeout: 20_000`, 분당 20회). 모델은 2026-11-12에 `gpt-6-luna`(OpenAI `openai` SDK)로 바꿨고 `reasoning_effort: "none"`을 더했다(기본 추론이 켜져 있으면 추론 토큰이 `max_completion_tokens`를 먼저 써서 글자 없이 끝날 수 있다). 스트림 반복이 끝난 뒤 요청 신호가 이미 끊겨 있으면 완성된 답으로 치지 않고 실패(`llm_failed`)로 처리한다.

지시문(`prompt.ts`)은 v1 본문을 그대로 두고, 마지막 줄("이용자 요청의 브랜드와 품목은 다음과 같다: …") **바로 앞에** 필요한 줄만 넣는다. 마지막 줄이 그대로라 기존 `endsWith` 시험이 유지된다.

- `hasBudget=true`: "이용자가 예산을 정했다. 금액 숫자를 쓰지 말고 '예산 이하로 가격 필터를 건다'처럼만 쓴다."
- `condition="used"`: "이용자는 중고를 원한다. 중고 탭, 판매자 평점, 상태 표기를 확인할 조건과 찾는 순서에 넣는다."
- `condition="new"`: "이용자는 새 제품을 원한다. 새 상품 필터와 판매자 정보를 확인할 조건에 넣는다."
- 값이 없으면 v1과 글자 하나 다르지 않다.

고정 질문 20개(`tests/chatbot/questions.json`)는 v1 묶음을 유지하고, `hasBudget`·`condition="used"` 맥락이 붙은 질문과 봉사자가 질문에 예산 숫자를 쓰는 유도 질문을 더한다. 가격 정규식은 완화하지 않는다.

v2.1부터 이 챗봇(`/api/chat`, `VolunteerChat`, `prompt.ts`)은 시연 이어 보기 화면(`/volunteer/demo`)에서만 쓴다. 봉사자 요청 화면의 AI는 §9.1의 리서치 AI다.

### 9.1 리서치 AI(v2.1)

AI는 봉사자의 리서치를 돕기만 한다. 경계는 코드로 고정한다.

1. 카드 순서와 필수 여부는 코드 상수(`research.ts`의 `RESEARCH_CARDS`)다. AI는 다음 카드를 정하지 못한다.
2. 카드마다 "이 카드에서 AI가 할 일"을 적은 지시문을 서버 전용 파일(`researchPrompt.ts`)에 둔다. 화면은 지시문을 보지도 바꾸지도 못한다.
3. AI 출력은 서버가 모양·길이·금지 표현을 검사한 뒤에만 화면에 보낸다(`researchCheck.ts`). 가격·재고·할인 금액처럼 보이는 문장은 버리고, 그런 링크 제목은 사이트 이름으로 바꾼다. 웹 검색으로 받은 후보와 링크는 출처 주소가 검색 결과에 있는 것만 남긴다. 검사 패턴은 바뀔 수 있으니 코드를 본다.
4. 화면은 AI 제안을 "AI 제안 · 확인 필요" 상자로 봉사자 입력과 구분한다. 봉사자가 고르거나 "확인했어요"를 체크한 것만 결과에 들어간다. 핵심 정리 초안은 보내기 전 확인 화면의 글 칸에 채워지고, 봉사자가 읽고 고친 뒤 보낸다.
5. 요청 문장, 봉사자 글, 웹 페이지 내용은 AI에게 자료로만 준다. 그 안의 지시는 따르지 않게 지시문에 적는다. 서버는 화면이 준 주소를 열지 않는다.
6. AI가 실패하거나 느려도 카드는 진행된다(§8.7의 fallback).

- 모델은 챗봇과 같은 `LLM_MODEL`(`gpt-6-luna`)이고, 호출 3종은 §3에 있다. `LLM_MODE=mock`이면 kind별로 정해진 가짜 응답(`researchMock.ts`)을 준다. 운영에서는 무시된다.
- 출처 검사는 주소 단위다. 지어낸 이름에 검색 결과의 진짜 주소가 붙으면 통과할 수 있다. 서버는 페이지 본문이 없어 이름과 주소의 관계를 확인하지 못하므로, 봉사자 확인(4번)이 마지막 관문이다.
- 결과는 기존 결과 형식에 싣는다(DB 스키마 그대로). 후보 1은 추천 기종, 후보 2~3은 같이 고민한 제품(최대 2)이고, 핵심 정리 글이 가이드가 된다. 구매 인증은 "구매 인증됨" 또는 "리서치만" 둘 중 하나만 들어간다. 변환은 `researchResult.ts`의 순수 함수다. (§2 데이터 표, §8.3 `results` 표, §8.5 #5 본문은 v2 설계로 남아 있고, 실제는 `resultInput.ts`와 마이그레이션 `20261112010000_volunteer_flow.sql`을 따른다)

## 10. 시험

| 명령 | 내용 | 외부 호출 |
|---|---|---|
| `npm run check` | ESLint, `tsc --noEmit`, Vitest | 없음 |
| `npm run test:e2e` | 로컬 서버 전체 흐름, 접근성 | 없음(`LLM_MODE=mock`, `STORE_MODE=memory`, `EXTRACT_MODE=mock`) |
| `npm run test:chatbot` | 고정 질문 품질(`tests/chatbot/questions.test.ts` 20문항만. 리서치 사례는 아래 `test:research-ai`로 따로 돈다) | 실제 OpenAI(7초 간격) |
| `npm run test:research-ai`(`tests/chatbot/research-ai.test.ts`, 사례 `research-cases.json`) | 리서치 AI 출력에 금지 표현이 없고, 웹 후보·링크가 https이고, 자료에 없는 기종이 없는지 | 실제 OpenAI. 키가 없으면 건너뛴다(통과가 아니다). 실행 방법은 파일 머리 주석 |
| `BASE_URL=... npm run test:public` | 공개 주소 1회 완주 | 실제 OpenAI(챗봇)·저장소 각 1회 |
| (새) 실제 Postgres 시험 | `claim_request` 동시 호출에서 하나만 `claimed`, `complete_request` 재전송 같은 결과 | 로컬 `supabase start` 또는 개발용 프로젝트(사람 결정) |

- v1의 가짜 음성 입력, 화면 시험 환경(iPhone 15·WebKit), 필수 사례, 챗봇 품질 규칙은 그대로다. 통과 보고에는 "가짜 음성 입력 기준"을 밝힌다.
- 저장소: `requestStore`는 인터페이스 하나에 메모리 구현과 Supabase 구현을 둔다. Supabase 구현은 가짜 RPC 클라이언트를 주입해 단위 시험한다.
- 리서치 챗 단위 시험: `tests/unit/research*.test.ts`(카드 상태·구매 인증, 출력 검사, 사진 축소 계산, 결과 변환, 라우트). 라우트 시험은 가짜 OpenAI로 fallback과 오류 코드를 본다.
- 리서치 챗 화면 시험: `tests/e2e/research-chat.spec.ts`(`e2e-desktop` 프로젝트, 노트북 1440·1024). 실제 Next 서버를 `LLM_MODE=mock` 가짜 AI로 띄워 붙고, 응답은 꾸미지 않는다(실패 시험만 `page.route`로 요청을 끊는다). 실제 AI 한 사이클은 `research-cycle.spec.ts`(`npm run test:research-cycle`, 공개 주소). 보고에는 "가짜 AI 응답 기준"을 밝힌다.
- v2.1에서 화면이 바뀌어 대상이 없어진 시험(요청 상세·캡처·전송 화면 시험, `extract-text`·`summarize` 라우트 시험, `candidateDraft`·`captureRead`·`evidenceCheck`·`imagePieces`·`summaryDraft`·`summaryEdit` 단위 시험)은 리서치 챗 시험으로 바꿨다. 기준을 낮춘 것이 아니다.
- (v2.1에서 없앰) ④ 합성 이미지 조각과 `EXTRACT_MODE=mock`으로 자르기·보내기·텍스트 입력 경로 시험, `evidenceCheck` 고정 시험값, ④ 엔진 정확도 정답지 비교.
- 필수 사례 추가: 대기열 빈 목록, 이미 진행 중(409) → 목록 복귀와 낭독, 남의 요청 상세(403), 사진 413·415, 필수 카드가 빈 채 보내기 막힘, AI fallback에서도 카드 진행, ⑥ 실패 → 입력 유지·재전송 같은 결과, 봉사자 화면 axe 위반 0건.
- 시연 전날 실제 DB로 플로우 A → B 리허설 1회(사람 판정 항목).

## 11. 배포

- v1 규칙 그대로: 지정한 Vercel 프로젝트(`lighthouse-web`, Root Directory=`apps/web`)에만, 검사·시험을 통과한 최신 브랜치를, 배포한 브랜치와 커밋은 아침 보고에. 원격은 `github`만.
- **함수 지역**: 기본은 미국 동부(iad1)이고 DB는 서울이다. `apps/web/vercel.json`에 `"regions": ["icn1"]`을 넣는 안은 사람 승인 항목이다. 옮기기 전후로 저장소 왕복과 OpenAI 호출 지연을 실측해 판단한다. 무료판은 지역 하나만 쓰므로 라우트마다 지역을 다르게 주지 않는다. 근거: https://vercel.com/docs/regions , https://vercel.com/docs/functions/configuring-functions/region
- **마이그레이션**: 브랜치에서는 `supabase/migrations`에 파일을 추가만 한다. 원격 적용(`supabase db push --linked`)은 병합 때 사람이 하거나 사람이 허락한 블록에서 한다. 이미 적용한 마이그레이션은 고치지 않고 새 파일로 바꾼다.
- **공유 DB 위험**: 운영·미리보기·로컬이 `lighthouse` DB 하나를 쓴다. 보류 PR의 마이그레이션이 운영 DB에 먼저 들어가지 않게 한다. 개발용 두 번째 무료 프로젝트는 사람 결정이다(무료 조직은 활성 프로젝트 2개 제한).
- **무료 프로젝트 정지**: 1주 동안 DB 활동이 없으면 멈춘다. 시연 전날 켜져 있는지 보고 리허설한다.
- **환경 변수 범위**: Supabase 변수가 Preview에도 있는지 확인한다(값은 보지 않는다). 없으면 미리보기 배포는 `store=memory`로 돈다.
- 별도 백엔드 배포는 없다.

## 12. 단계별 브랜치

데모 단계마다 단계 브랜치 `stage/demo<N>` 하나를 최신 main에서 따고, 그 아래 기능 브랜치 `feat/demo<N>/<기능>`에서 작업한다. 기능 PR은 단계 브랜치로, 단계가 끝나면 `stage/demo<N>` → main PR을 하나 연다. 이름, 쌓기, PR·Codex·병합은 `.claude/rules/pr-flow.md`(PR #18 규칙)를 따른다.

| 순서 | 단계 브랜치 | 기능 브랜치 | 만드는 것 | 의존 |
|---|---|---|---|---|
| 1 | `stage/demo1` | `feat/demo1/questions` | 플로우 A 질문 3개 | 없음 |
| 2 | `stage/demo1` | `feat/demo1/queue` | `requests` 표 전체(§8.3), `register_request`, 플로우 A API, 대기번호 | 1 |
| 3a | `stage/demo3` | `feat/demo3/search-advice` | `volunteerRequest.ts`(어댑터 포함), `/api/chat` 선택 필드, 지시문 줄, 고정 질문 추가 | 없음 |
| 3b | `stage/demo4` | `feat/demo4/experiment`, `feat/demo4/upload-summary` | 엔진 비교 실험, `imagePieces`, `extract`, `summaryDraft`, `evidenceCheck`, 두 API, `InfoSummary` 부품. (v2.1에서 없앰. `extract`는 health 판정만 남음) | 공용 타입만(3a와 같은 파일을 고치지 않음) |
| 4 | `stage/demo2` | `feat/demo2/volunteer-queue` | `claim`/`release` 함수, 대기열·선택·상세 API, `/volunteer` 목록, `/volunteer/requests/[id]` 뼈대, 3a·3b 부품을 이 화면에 연결 | 2가 main에 병합된 뒤 |
| 5 | `stage/demo5` | `feat/demo5/research-chat` | 리서치 챗 한 화면(③④⑤ 합침): 질문 카드 7장, 구매 인증, 보내기 전 확인, `POST /api/volunteer/research`, `ResearchChat`·`ResearchCards`·`ResearchSummary`. 옛 ③④⑤ 화면·라우트·lib를 없앰. v2 계획의 `feat/demo5/verify`(⑤ 요약 확인·수정 화면)는 v2.1에서 이것으로 바꿈 | 4, 6(결과 API·`SentView`) |
| 6 | `stage/demo6` | `feat/demo6/send-result` | `results` 표, `complete_request`, 결과 API, `ResultForm`, 플로우 C 응답(v2 계획. `ResultForm`·`SummaryDraft`는 v2.1에 없음) | 3b의 `SummaryDraft` 타입, 4 |

- 11/9 밤 계획은 ①②를 `stage/demo1` 하나로 묶는 안을 이용자 확인 대기로 두었다. 묶으면 4번도 `feat/demo1/volunteer-queue`가 된다.
- (v2 계획. v2.1에서 요청 확인 화면은 없앴다) 3a·3b는 v1 시연 화면(`/volunteer`)에 붙여 먼저 동작시키고, 4에서 요청 확인 화면으로 옮긴다. 3a·3b가 `volunteer/page.tsx`를 함께 고치면 충돌하므로 한 브랜치만 페이지에 붙이고 다른 쪽은 부품과 시험만 넣는다(그날 계획에서 정한다).
- 11/4 블록 표(v1 §12)는 기록으로 v1에 남긴다.

## 13. 확인되지 않은 것

| 항목 | 확인 시점 | 실패 때 |
|---|---|---|
| 아이폰 실기기 음성 인식, VoiceOver 낭독 섞임, 초점 이동 | 아침 사람 판정 | v1 대응 그대로 |
| 리서치 챗의 실제 아이폰 동작과 VoiceOver 낭독(카드 이동 때 초점, 진행 점 이름, 사진 고르기·축소, 쇼핑 앱에 다녀온 뒤 이어하기) | 아침 사람 판정 | 화면 수정. 자동 시험은 가짜 AI 응답 기준이다 |
| `gpt-6-luna`가 Responses API `web_search` 도구를 받는지, 받으면 출처 주소가 붙는지 | 2026-11-13 로컬 실호출로 확인: 받는다. 검색 결과 출처(`sources`)는 붙고 글 인용(`url_citation`)은 0개였다. 검색 kind 지연 5~16초. 공개 주소에서 배포 뒤 다시 확인 | 검색 4종이 fallback(기본 문구·고정 후보·바로가기)으로 돈다. 로그의 상위 호출 결과로 판정 |
| `claim_request`·`complete_request` SQL이 실제 Postgres에서 돌고 동시 선택에서 하나만 성공하는지 | 4·5번 브랜치 | 함수 수정, 시험 추가 |
| `supabase-js` `rpc`의 표 반환 모양(배열, 0행) | 2번 브랜치 | 래퍼에서 맞춤 |
| 실제 Postgres 시험 환경(Docker 필요 여부, 개발용 프로젝트) | 2번 브랜치 전 | 사람 결정 |
| Supabase 무료판 `pg_cron` | 필요할 때 | 함수 호출 때 정리(현 설계) |
| Supabase 변수의 Preview 적용 여부 | 다음 배포 | 미리보기는 memory, 공개 완주는 production |
| 함수 지역(iad1↔icn1)과 지연 | 시연 전 실측 | 사람 승인 뒤 변경 |
| OpenAI `gpt-6-luna`의 챗봇·리서치 AI 응답 시간, JSON 모드·`temperature` 수용 | 2026-11-13 로컬 실호출: JSON 모드·사진 입력을 받는다. 질문 kind 2~4초, 요약·사진 설명 약 2초, 챗봇 평균 약 2초. 공개 주소 지연은 배포 뒤 실측 | 호출값 조정. 리서치 AI는 fallback으로 진행 |
| (v2.1에서 없앰) `gpt-6-luna`·Upstage OCR의 한국어 상세 이미지 정확도, 통이미지 대 조각 | - | - |
| 아이폰 canvas 면적·메모리 한도(v2.1부터는 사진 축소에만 쓴다) | 아침 실기기 | 사진 읽기 실패 안내 |
| (v2.1에서 없앰) 조각 30개 처리 시간이 10분 지표 안에 드는지 | - | - |
| OpenAI 크레딧 잔액·만료·등급, 키 등록 | 3b 전 | 챗봇·리서치 AI는 다른 공급자(v2의 Upstage 대안은 v2.1에서 없앰) |
| Vercel 외부 rewrite의 Cookie·스트리밍 전달 | 별도 서버 재검토 때만 | 재검토 보류 |
| 결과 보관 기간, 구매 링크 도메인 제한, 결과에 가격 칸 | 5번 브랜치 전 | 이용자 결정 |
| OpenAI가 요청 데이터를 남용 감시용으로 보관하는 기간(조사상 최대 30일)과 상세페이지 보관 위험의 관계(v2.1부터는 사진 설명용 사진이 해당) | 3b 전 | 멘토·이용자 판단(v2의 "Upstage 우선" 대안은 v2.1에서 없앰) |
| Groq 학습 사용 여부 | 미확인 | 개인정보를 넣지 않음 |
