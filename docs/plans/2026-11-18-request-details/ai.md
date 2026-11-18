# 이용자 요청 브리핑(request details) — AI용 계획

- 작성 2026-11-18(planner 초안, 메인 세션이 `voiceChat.ts:36-40`·`voice/chat/route.ts:75-83`·`index.html` registerQueue를 직접 확인). 1쪽 요약: `docs/plans/2026-11-18-request-details/human.md`. **사람이 본 것은 1쪽 요약이고 이 파일이 실행 기준이다.**
- 승인: 2026-11-18 이용자 말 "추천안으로 진행해줘" — A1~A4 모두 추천안(A), 로컬 개발까지 승인. 원격 DB 적용·push·PR·병합은 로컬 확인 뒤 A5(H2) 승인을 받는다. 이 계획은 추천안 기준이며, 다른 안을 고르면 §3.9를 따른다.
- 진행 기록은 같은 폴더 `progress.md`에 쓴다(`overnight-loop.md`). 사람 액션은 같은 폴더 `action-log.md`에 쓴다(git 제외).
- 작업 위치: 새 워크트리 `.claude/worktrees/request-details`, 브랜치 `feat/demo7/request-details`(github/main에서). `live`(다른 세션이 쓰는 중)와 `temp`(온도 작업 c40c0b8, 아직 push 안 함)는 쓰지 않는다.

## 1. 목표와 완료 조건

목표: 이용자 음성 요청의 확인 요약과 질문·답을 접수 때 저장한다. 요청을 맡은 봉사자가 [구매했어요]나 [리서치만] 다음, 기종 질문 전에 그 내용을 한 장씩 확인하게 한다. 리뷰 문단 AI는 그 조건을 참고한다.

완료 조건(명령으로 판정):
1. `cd apps/web && npm run check` 종료 코드 0(lint, typecheck, vitest 전체).
2. 아래 단위 시험이 있고 통과: `npx vitest run tests/unit/requestDetails.test.ts tests/unit/sql/requestDetailsSql.test.ts tests/unit/voiceChat.test.ts tests/unit/requestsRoute.test.ts tests/unit/volunteerRoutes.test.ts tests/unit/researchTurn.test.ts tests/unit/researchChatView.test.ts tests/unit/volunteerView.test.ts tests/unit/researchReview.test.ts`
3. 화면 시험 통과(가짜 AI·메모리 저장소. `playwright.config.ts:45-51`이 `LLM_MODE=mock`, `STORE_MODE=memory`를 넣는다):
   - `npx playwright test --project=e2e tests/e2e/request-brief.spec.ts tests/e2e/a-voice-home.spec.ts tests/e2e/research-chat.spec.ts tests/e2e/research-photo-link.spec.ts`
   - `npm run test:research-cycle`
   - `npm run test:e2e:desktop`
4. `git diff github/main --stat -- apps/web/public/voice/index.html apps/user-voice-ui apps/web/src/lib/voiceInstructions.ts` 출력이 없다(이용자 화면과 지시문을 바꾸지 않음).
5. `/api/requests`의 console.info에 이용자 답 글자가 없다는 단위 시험이 있고 통과한다.
6. 로컬 확인용 HTML 보고서(`briefing-html.md`)를 만들고 H2 앞에서 멈춘다. 원격 DB 적용, push, PR, 병합은 하지 않은 상태다.
7. (H2 뒤) Codex 판정 `통과`, `pr-flow.md`대로 병합, Vercel 배포 READY.

## 2. 확인된 사실

### 2.1 지금 저장되는 것과 안 되는 것
- 음성 대화 서버는 대화를 저장하지 않고 화면이 보낸 `history`로 이어 간다(`apps/web/src/app/api/voice/chat/route.ts:11-12`, `:75`). OpenAI 호출은 `store:false`(`apps/web/src/lib/voiceChat.ts:135`). 로그는 상태와 시간만(route.ts:85-87, 103-105).
- done 응답의 `request`는 `{product, budget, condition}`뿐이다(`voiceChat.ts:36-40`, `toQueueRequest` :168-183). 예산은 요약 글에서 금액 표현을 찾고, 조건은 "중고"·"새 제품"만 찾으며 없으면 "정하지 않음". 쓰는 곳 route.ts:77-80.
- 음성 지시문은 상품 종류, 사용 목적, 예산, 유무선, 가장 중요한 기능, 기타 조건을 묻고(`voiceInstructions.ts:33-41`), 마지막에 1~2문장 요약(:53-59, :97-99). "궁금한 점"은 따로 묻지 않는다. 지시문은 원본과 글자 단위로 같아야 한다(`tests/unit/voiceChat.test.ts:55-61`).
- 이용자 화면(`apps/web/public/voice/index.html`): `history`는 메모리에만(:12), `ask()`가 매 턴 쌓고(:25), 새 대화에서 비움(:28). done이면 `saveRequest(product, summary, cid)`로 휴대폰 localStorage `lh-requests`에 요약. `registerQueue`는 `{clientRequestId, ...request}`를 그대로 POST(:27) → **서버가 `request`에 `details`를 붙이면 스크립트를 고치지 않아도 접수에 실린다.** 마크업(`</main><script>` 앞)은 원본과 같아야 한다(voiceChat.test.ts:63-70).
- `POST /api/requests`는 product·budget·condition만 받는다(각 200자, `apps/web/src/app/api/requests/route.ts:14,32-62,77`). `request.json()`을 쓰고 content-type은 검사하지 않는다(:42). 로그는 상태와 시간만(:119-123).
- `requests` 표의 열과 `register_request` 인자는 그 세 값 + brand·item·condition_kind(`supabase/migrations/20261109175932_requests.sql:5-25,36-44`). 보관: waiting 24시간 → expired, expired는 생성 48시간 뒤 삭제, done은 7일 뒤 삭제(:60-65). RLS로 anon·authenticated를 막음(:29-31).

### 2.2 원격 DB(2026-11-18, SELECT 전용, project zdnlhnzybbuloquzxwkg)
- 최근 시연용이 아닌 요청: 2026-11-17 14:09 UTC, product "소니 무선 헤드셋", budget "십만 원 정도", condition "정하지 않음", brand "Sony", item "헤드셋", condition_kind null, status done. 그 앞 요청("sony껄로 헤드셋 사고싶어", "10만 원 이하", "새 제품")도 같은 세 값뿐.
- public 표: ai_usage_daily, photo_links, push_subscriptions, requests, research_messages, research_photos, research_sessions, research_turns, research_usage, results. 질문·답을 담는 표는 없다. `volunteer_feedback`(온도)은 아직 적용 전.

### 2.3 봉사자가 지금 보는 것과 AI가 받는 것
- 대기열·내 담당 카드는 `quoteOf(product, budget)`(`apps/web/src/components/SidePane.tsx:120,161,191`, `apps/web/src/lib/volunteerView.ts:89-91`). `structuredLine`(품목·브랜드·예산·조건, volunteerView.ts:100-117)은 src에서 쓰이지 않는다(시험만).
- 리서치 챗 히어로는 `요청을 맡았어요 · 이용자: “product”`(`ResearchConversation.tsx:1290`). 구매 여부 미정이면 [구매했어요]·[리서치만](:79-80, :1242). 요청 상세는 `fetchRequest` → `setRequest`(:316).
- AI 문맥 `ResearchContext`는 `{product, brand, item}`뿐(`researchAi.ts:60-64`). 글 턴은 getForVolunteer로 채움(`research/turn/route.ts:212-216`), 빠른 답 등 로컬 턴은 빈 문맥(:100). 리뷰는 `requestText`(`researchReviewApi.ts:54-61`). 예산·조건은 AI에 가지 않는다.

### 2.4 대화 엔진
- 빠른 답 `purchase.bought/research`는 `researchTurn.ts:931-938`에서 purchase를 정한다. 다음 후보는 `buildCandidates`(:535-616), 기종 질문 문구는 `researchTurnText.ts:8-11`. AI가 글에서 구매 여부를 읽으면 `purchaseFillMessage`(researchTurn.ts:804-807).
- 메시지에 기종 질문이 있으면 `followUpOf`가 기종 검색을 이어 부른다(`researchApi.ts:158-165`).
- `research_messages.tag`는 자유 글자, body는 8192바이트 이하(`20261117000000_research_conversation.sql:31-40`). `research_push_messages`는 tag를 검사하지 않는다(:227-250) → 새 tag "brief"에 SQL 변경이 필요 없다.
- 화면이 메시지를 잠시 숨기는 선례: `arrangeMessages`(`researchChatView.ts:397-407`). 꼬리표는 `tagLabel`(:275-289).
- 보낸 대화는 봉사자 기기 `lh.vol.sentHistory.v1`에 글로 30일 남는다(`sentHistory.ts:4-14`) → 대화 메시지에 이용자 말을 넣지 않는다.

### 2.5 개인정보·로그 선례
- 리서치 턴과 리뷰 호출은 기본값 `store:true`로 OpenAI 대시보드에 남는다(`openaiLog.ts:9-12`, `researchAi.ts:210`, `researchReview.ts:296`, `docs/TSD.md:88`). 이용자 음성 후기는 `store:false`(`feedbackAi.ts:9,99`, temp 워크트리).
- 리뷰 문단과 자료는 금액 금지(`researchCheck.ts:20-42`). 자료는 `safeFact`가 주소·전화번호·금지 문장을 뺀다(`researchReview.ts:54-66`, PHONE :59).
- 요청에 딸린 별도 표의 선례: push_subscriptions(request_id PK·FK cascade, RLS, service_role만, `20261120000000_push_subscriptions.sql:7-17`). 저장 모듈은 표 클라이언트 + 메모리 맵(`apps/web/src/lib/webPush.ts:40-71`).
- 상태가 바뀔 때 지우는 트리거 선례: `research_drop_on_leave`(research_conversation.sql:336-349). 기존 SQL 함수는 모두 `security invoker`(`20261112010000_volunteer_flow.sql:23,51,67,92`).
- 표가 없을 때의 오류 코드는 `isMissingSchema`(42P01, PGRST205 등, `requestStore.ts:657-668`).

### 2.6 시험 제약
- `readJsonBody`는 content-type이 json이 아니면 415(`researchApi.ts:34-36`). `voiceChat.test.ts:188-194`는 content-type 없이 `/api/requests`를 부른다 → `/api/requests`에 쓰지 않는다.
- 구매 버튼을 누르는 화면 시험: `research-chat.spec.ts`의 `pickBought`(:105-108)와 :636·:667·:685·:704·:1024, `research-cycle.spec.ts:90`, `research-photo-link.spec.ts:85`. 단위 시험 `researchTurn.test.ts:293-296`은 `messages.at(-1)`로 기종 질문을 본다.
- `a-voice-home.spec.ts:102-107`과 `voiceChat.test.ts:150-159`는 접수 본문과 request를 `toEqual`로 본다.
- SQL은 PGlite 시험 틀(`tests/unit/sql/feedbackSql.test.ts:1-40`, temp 워크트리; main에는 `photoLinksSql.test.ts`).

### 2.7 브랜치·병합 관행
- demo7 PR은 base main(`gh pr view 60` → base main, head feat/demo7/push).
- 온도 계획의 H2 순서: 로컬 확인 → 승인 → DB 적용 → push → PR → Codex → 병합. "DB를 먼저 적용하지 않고 병합하지 않는다"(`docs/plans/2026-11-17-volunteer-temperature/ai.md` 5장).

### 2.8 확인하지 못한 것
- 실험 대화의 실제 문답 횟수(데이터 없음, 이용자 말 기준).
- 구매 턴의 메시지 수·seq를 정확히 맞추는 단위 시험이 몇 개인지(실행해 보고 목록화).
- `user-screen.spec.ts:294-303`이 /classic 시험인지.
- 실제 모델이 `이용자조건`을 사실처럼 쓰지 않는지(유료 호출 필요).
- 원격 DB에서 upsert(ignoreDuplicates)와 트리거 동작(PGlite로만 확인).
- 실기기와 VoiceOver.

## 3. 설계(추천안 A1~A4 기준)

### 3.1 데이터 모양
- 공용 타입(`apps/web/src/lib/volunteerView.ts`, server-only 아님): `export interface RequestQa { q: string; a: string }`, `export interface RequestDetailsView { summary: string; qa: RequestQa[] }`.
- 상한: summary 300자, q 150자, a 200자, 짝 12개, POST 본문 32KB.
- 정리 규칙 `cleanRequestDetails(value: unknown): RequestDetailsView | null`(서버 전용 `requestDetails.ts`): 객체가 아니면 null. 제어 문자 제거, 공백 한 칸, trim, 글자(code point) 단위로 자르고 끝에 "…". 전화번호 모양은 "(전화번호 가림)"(PHONE 정규식은 `researchReview.ts:59`에서 `researchCheck.ts`로 옮겨 export, 두 곳이 같이 씀). 잘못된 짝(문자열 아님, 답이 빔)은 버리고 앞에서 12개까지. summary와 qa가 모두 비면 null.

### 3.2 DB: `supabase/migrations/20261122000000_request_details.sql`(추가형) + `supabase/rollback/20261122000000_request_details_down.sql`

```sql
-- 이용자 음성 요청의 확인 요약과 질문·답(봉사자 브리핑). 추가형: 기존 표·함수를 바꾸지 않는다.
-- 맡은 봉사자에게만 서버가 내보낸다. 요청이 done·expired가 되면 트리거가 지우고(A2), 요청이 지워지면 cascade.
create table public.request_details (
  request_id uuid primary key references public.requests (id) on delete cascade,
  summary text not null default '' check (char_length(summary) <= 300),
  qa jsonb not null default '[]'::jsonb
    check (jsonb_typeof(qa) = 'array' and jsonb_array_length(qa) <= 12 and octet_length(qa::text) <= 16000),
  created_at timestamptz not null default now()
);
alter table public.request_details enable row level security;
revoke all on table public.request_details from anon, authenticated;
grant select, insert, delete on table public.request_details to service_role;

create or replace function public.request_details_drop_on_close()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.request_details as d where d.request_id = new.id;
  return null;
end;
$$;

create trigger request_details_drop_on_close
  after update of status on public.requests
  for each row
  when (new.status in ('done', 'expired') and new.status is distinct from old.status)
  execute function public.request_details_drop_on_close();
```
- 되돌리기: trigger → function → table 순서로 `drop ... if exists`.
- 내려놓기(in_progress → waiting)와 6시간 반환 때는 지우지 않는다(다음 봉사자가 봐야 한다).
- 파일 이름 20261122는 온도의 20261121 뒤다. 원격 적용 순서는 §6·§7.

### 3.3 저장 모듈 `apps/web/src/lib/requestDetails.ts`(server-only, webPush.ts의 꼴)
- `saveRequestDetails(requestId, details): Promise<"saved"|"exists"|"unavailable"|"failed">`(던지지 않음). `getRequestStore().storeKind() === "supabase"`이면 `getSupabaseRpcClient()`로 `from("request_details").upsert(row, { onConflict: "request_id", ignoreDuplicates: true })`(처음 것 유지). `isMissingSchema` 오류면 "unavailable", 그 밖 "failed". 메모리면 globalThis 맵(`__lhRequestDetails`).
- `readRequestDetails(requestId): Promise<RequestDetailsView | null>`(오류는 null, 읽은 값도 `cleanRequestDetails`로 다시 거름).
- 메모리의 지우기: `onRequestLeave`(`requestStore.ts:148-160`)를 구독해 알림이 오면 `getRequestStore().get(id)`가 null이거나 done·expired일 때 맵에서 지운다. 내려놓기(waiting)는 남긴다. 메모리의 waiting → expired는 알림이 없으므로 읽기 쪽이 in_progress에서만 내보내는 것으로 막는다.
- `resetRequestDetailsForTest()`.
- `RequestStore` 인터페이스는 넓히지 않는다(시험용 `PartialRequestStore`가 깨지지 않게).

### 3.4 API
- `POST /api/voice/chat`(route.ts:75-83): done이고 queue가 있으면 `voiceDetails(next, result.summary)`를 `request.details`로 붙인다. `voiceDetails(turns, summary)`는 `voiceChat.ts`에: assistant 칸(JSON)의 reply·status가 asking·confirming이고 바로 다음이 user 칸이면 한 짝. 마지막 짝(최종 동의)은 뺀다. 시작 문장(`VOICE_START_MESSAGE`)은 짝이 아니다. 깨진 JSON 칸은 건너뜀. `cleanRequestDetails`로 거름. 확인 중 고친 말은 남긴다. 가짜 대화 기준 결과 `{summary: "<상품>, 예산 <예산>", qa: [{q:"어떤 상품을 찾으세요?", a:<상품>}, {q:"예산은 얼마인가요?", a:<예산>}]}`.
- `POST /api/requests`: 본문을 32KB 안에서 읽는다(voice route의 `readLimitedText`(:29-44)를 `apps/web/src/lib/readLimited.ts`로 옮겨 같이 씀, 넘으면 413 `too_large`, content-type 검사 안 함). 세 값 검사는 그대로. `details = value.details === undefined ? null : cleanRequestDetails(value.details)`(잘못된 details는 무시하고 접수 정상). register 뒤 `result.status === "waiting"`이고 details가 있으면 `saveRequestDetails`. 응답 모양 그대로, 로그 줄에 ` details=saved|exists|none|ignored|unavailable|failed`만(글은 남기지 않음).
- `GET /api/volunteer/requests/{id}`: 응답에 `details`(`outcome.request.status === "in_progress"`일 때만 `readRequestDetails`, 아니면 null). `volunteerClient.ts:30-33` `DetailResponse`에 `details: RequestDetailsView | null`.
- 바꾸지 않는 것: `GET /api/requests/{id}`(이용자 상태 조회 — 이용자에게 답을 돌려주지 않음), 대기열·큐 라우트(맡기 전에는 안 보임), `/classic`(details 없이 접수).

### 3.5 이용자 화면
- `apps/web/public/voice/index.html`은 바꾸지 않는다(§2.1, `...request`에 details가 실린다).

### 3.6 대화 엔진: 브리핑 표시 메시지 1개
- `researchTurnText.ts`에 `BRIEF_NOTE = "기종을 묻기 전에 이용자가 말한 요청을 하나씩 확인해요."`(hasForbidden 0건).
- `researchTurn.ts`: `briefMessage(): NextMessage = { role:"ai", tag:"brief", slot:null, body: textBody(BRIEF_NOTE, { kind:"brief" }), ai:"none" }`(body에 이용자 말을 넣지 않음 — sentHistory 보호). 넣는 자리: 빠른 답에서 purchase가 unset → 정해질 때(:931-934, 봉사자 말풍선 다음), AI가 글에서 purchase를 읽을 때(:804-807, purchaseFillMessage 다음). 이미 정해진 뒤의 구매 버튼(PURCHASE_FIXED)에는 넣지 않는다. 다음 질문 후보와 SQL 규칙은 바꾸지 않는다(기종 질문·기종 검색은 같은 턴에 그대로 — 카드를 읽는 동안 검색이 끝난다).

### 3.7 봉사자 화면 흐름
- `researchChatView.ts`: `tagLabel` case "brief" → `{ chip: "이용자 요청", note: "기종 질문 전에 확인" }`, `hasBrief(messages)`, `holdAfterBrief(messages, done)`(done이 아니면 첫 brief 메시지까지만).
- `volunteerView.ts`: `briefSteps(request, details)` — 1장 "이용자가 확인한 요청" = details.summary(없으면 request.product) + `structuredLine(request)`, 2장부터 "질문 k/n"(q와 a). details가 없으면 1장만 + "질문·답 기록이 없는 요청이에요"(/classic, DB 적용 전).
- 새 부품 `apps/web/src/components/research/RequestBrief.tsx`: 연 장을 쌓아 보임. [다음](마지막 전), [다 봤어요 · 질문 이어 가기](마지막), [한 번에 모두 보기]. 다 본 뒤 버튼 없이 전부 펼침(대화 기록에 남음). 장마다 제목 tabIndex -1, [다음]이면 새 장으로 초점, 상태 줄 "이용자 요청 k/n".
- `ChatLog.tsx`(renderOne): `bodyKind(body) === "brief"`이면 MessageBubble 안에 RequestBrief(새 prop `brief`).
- `ResearchConversation.tsx`: :316 근처 `setDetails(detail.data.details ?? null)`. 다 봤는지는 `lh.vol.brief.v1.<sessionId>` = "done"(내용 없음, try/catch). `briefOpen = hasBrief(shown) && !briefDone`이면 ChatLog에 `holdAfterBrief(shown,false)`, 빠른 답 [], Composer readOnly + placeholder "이용자 요청을 먼저 확인해 주세요", Thinking·CurrentQuestionLine 숨김. 다 보면 브리핑 뒤 첫 질문(`vc-q-<seq>`)으로 초점·스크롤.
- 히어로: details.qa가 있으면 HeroCopy 아래 "구매 여부를 고르면 이용자 답 N개를 차례로 보여 드려요"(HeroCopy 선택 prop).
- CSS `volunteer.css`의 `.vc-brief*`(폰 폭·다크 모드 확인). 리서치만도 같은 흐름.

### 3.8 리서치 AI(A3 추천: 리뷰만)
- `researchReviewApi.ts` `requestText`(:54-61)에 `needs: RequestDetailsView | null`(in_progress일 때 `readRequestDetails`).
- `researchReview.ts`: `ReviewSource.context.needs?`. `buildReviewMaterial`은 내용이 있을 때만 `이용자조건: { 요약: safeFact(summary,160), 답: qa.map(p => safeFact(`${p.q} → ${p.a}`,160)).filter(Boolean).slice(0,6) }`(금액 문답은 safeFact가 지움, 없으면 키 자체 없음 → 기존 시험·가짜 문단 그대로). `reviewKnownMaterial`에 needs 글을 더함(이용자가 말한 기종 이름이 "모르는 기종"으로 걸리지 않게). 지시문: "이용자조건은 이용자가 말로 바란 것이고 사실이 아니다. 봉사자 자료로 확인된 것만 맞다·다르다고 쓰고, 확인되지 않은 조건은 봉사자가 확인하지 못했다고 쓴다. 이용자조건에 없는 바람을 지어내지 않는다. 금액은 쓰지 않는다."(hasForbidden 0건). `writeReview`는 `material.이용자조건`이 있으면 `{ store: false }`, 없으면 `openAiLog("research_review")`.
- 대화 턴 AI(`researchTurnPrompt.ts`)는 바꾸지 않는다.

### 3.9 다른 안을 골랐을 때
- A1=B(요약만): `voiceDetails`가 qa를 [], 카드 1장. A1=C: 멈추고 다시 계획(유료 AI 호출).
- A2=B(요청과 함께): 트리거를 빼고 cascade만, 메모리 구독도 뺌. 읽기는 여전히 in_progress에서만.
- A3=B: `TurnMaterial.요청`에 `조건`(요약 + 문답 4개, safeFact), `researchAi.ts:210`에서 needs가 있으면 store:false. A3=C: §3.8 전체를 뺀다.
- A4=B: 이번 PR에서 하지 않는다(동료 동의 뒤 별도 계획 — `voiceChat.test.ts:55-61`과 `apps/user-voice-ui/server.js`).

### 3.10 시험
새로 만든다:
- `tests/unit/requestDetails.test.ts`: clean(상한, 자름 표시, 제어 문자, 전화번호 가림, 잘못된 짝, 빈 값 null), 메모리(저장·읽기, 처음 것 유지, done 뒤 지움, 내려놓기 뒤 남음), Supabase 가짜 클라이언트(upsert 인자, PGRST205 → "unavailable", 그 밖 → "failed", `volunteerPersistent` 그대로).
- `tests/unit/sql/requestDetailsSql.test.ts`(PGlite): 마이그레이션 20261109~20261120 + 새 파일(온도 20261121에 기대지 않음). 13짝·301자·배열 아님 거절, 요청 삭제 cascade, done·expired 전환 시 삭제, waiting↔in_progress에선 남음, register_request의 24시간 만료가 details도 지움, anon·authenticated 권한 없음(`has_table_privilege`), down 파일이 깨끗이 지움, 기존 함수 정의 그대로.
- `tests/e2e/request-brief.spec.ts`: `page.request.post('/api/requests', {data:{clientRequestId, product, budget, condition, details}})` → 봉사자 입장 → 맡기 → [구매했어요] → 1장 요약, 기종 질문 아직 없음 → [다음]×n → [다 봤어요] → 기종 질문·입력칸 열림. 다른 기기 상세 403, 이용자 `GET /api/requests/{id}`에 details 없음, axe 막힘 0. [리서치만]도 한 번. 스크린샷.

바꾼다(이유를 PR 본문에):
- `voiceChat.test.ts:150-159`: `toEqual`에 details(응답에 새 필드). `voiceDetails` 단위 시험(시작 문장 제외, 마지막 동의 제외, 고친 말 유지, 깨진 JSON 건너뜀, 12짝 상한).
- `a-voice-home.spec.ts:102-107`: 접수 본문 `toEqual`에 details.
- `requestsRoute.test.ts`: details 저장, 잘못된 details 무시하고 201, 32KB 초과 413, 로그에 답 글자 없음(console.info spy).
- `volunteerRoutes.test.ts`: 내 in_progress에는 details, 보낸 뒤 null, 남의 요청 403.
- `researchTurn.test.ts`: 표시 메시지가 구매 턴(빠른 답·AI 글 두 경로)에 한 번, body에 이용자 글 없음, 이미 정해진 뒤엔 없음. 구매 턴 메시지 수·seq를 정확히 보는 기존 시험이 깨지면 +1만 고치고 목록을 progress.md에(`researchTurnRoute.test.ts`도 같다).
- `researchChatView.test.ts`(holdAfterBrief, tagLabel), `volunteerView.test.ts`(briefSteps), `sentHistory.test.ts`(brief 줄에 이용자 글 없음).
- `researchReview.test.ts`: 이용자조건 자료, 금액·전화·주소 제거, needs가 있으면 params `store:false`.
- 화면 시험: `tests/e2e/helpers/volunteerFlow.ts`에 `passBrief(page)`를 더하고 §2.6의 8곳에서 구매 클릭 뒤에 부른다(새 단계를 거치는 것이지 기준을 낮추는 것이 아니다).

### 3.11 문서
- `docs/TSD.md`: §2 데이터 표에 request_details 행, §8.3 보관, §8.4 접수 본문 details·413, §8.9 응답 request.details, 봉사자 상세 API details, OpenAI 기록 행에 "이용자조건이 든 리뷰 호출은 store:false". `docs/human_tsd.md`도. `CLAUDE.md` 지도 lib 줄에 `requestDetails.ts`, components 줄에 `RequestBrief.tsx`.

## 4. 단계별 작업
- S0(순차, 준비): `git fetch github` → `git worktree add .claude/worktrees/request-details -b feat/demo7/request-details github/main` → `cd apps/web && npm install`. progress.md. bd는 메인 세션.
- S1(병렬): S1a 마이그레이션·되돌리기·PGlite 시험 / S1b `requestDetails.ts`·공용 타입·PHONE 이동·단위 시험 / S1c 대화 엔진 표시 메시지·단위 시험.
- S2(S1b 뒤, 서로 병렬): S2a `voiceDetails`·voice route·시험 / S2b `/api/requests`·readLimited 이동·시험 / S2c 봉사자 상세 route·`DetailResponse`·시험 / S2d 리뷰 AI(§3.8)·시험.
- S3(S1c·S2c 뒤): 화면(§3.7), `npm run check`.
- S4(S3 뒤): 새 화면 시험·`passBrief`, §1-3 화면 시험 전부, 스크린샷.
- S5: 문서(§3.11).
- S6: 로컬 보고서(스크린샷·확인한 것·못 한 것·정해 줄 것 = action-log 대기 항목). 여기서 멈춘다(H2).
- S7(H2 승인 뒤, 순차): DB(§5 H2) → `git push github feat/demo7/request-details` → PR(base main, 본문 7항목) → 최종 커밋에서 시험 기록 `test-results/<PR번호>-<명령>.txt` → `codex exec -s workspace-write ...`(기록 판정) → 병합 표대로 병합 → Vercel READY → `evidence` 브랜치 `demo7/volunteer-request-brief.png`.
- S8(H3 뒤): 리뷰를 보낸 요청의 details가 지워졌는지 SELECT로 확인(`select count(*) from public.request_details where request_id = '<id>'`, 읽기만).

## 5. 사람 차례
- H1(A1~A4): 답한다(human.md, HTML 보고서). 끝나면 S0부터.
- H2(A5): 로컬 보고서와 스크린샷을 보고 승인 → ① `supabase db push --linked --dry-run`에 **20261122000000_request_details.sql 하나만** 나오는지 ② 적용(사람 또는 명시 허락 시 AI) ③ push, PR, Codex, 병합, Vercel READY. DB를 먼저 적용한 뒤 병합.
- H3(B1): 배포 뒤 아이폰에서 음성으로 요청(4번 이상 답) → 노트북 봉사자 화면에서 맡고 [구매했어요] → 카드 확인 → 리뷰 보내기 → VoiceOver로 리뷰 듣기.

## 6. 멈춤 조건
- 이용자 화면 `index.html`, 지시문 `voiceInstructions.ts`, `apps/user-voice-ui`를 바꿔야 할 것 같다.
- 대화 규칙 SQL(`research_next_valid`·`research_apply` 등)이나 기존 마이그레이션을 바꿔야 한다.
- §3.10에 없는 기존 시험의 기대값을 바꾸거나 기준을 낮춰야 한다.
- 유료 AI 호출이 필요하다(실제 리뷰 확인은 이용자가 허락하면 3회까지).
- 원격 DB 적용, push, PR, 병합, Vercel 환경 변수 변경이 필요하다(H2 전).
- dry-run에 다른 마이그레이션(예: 온도 20261121)이 같이 나오거나 순서 경고("inserted before the last migration")가 나온다. `--include-all`을 임의로 쓰지 않는다.
- 대기열, 이용자 상태 조회, 로그, sentHistory, OpenAI store:true 호출에 이용자 답이 나가는 경로를 발견했다.
- 같은 실패 3회, Codex 심각한 지적 3회.

## 7. 위험과 대응, 범위 밖
- 개인정보: 이용자가 말한 그대로 저장된다 → 전화번호 모양 가림, 맡은 봉사자 1명만 in_progress 동안 봄, done·expired에 지움, 로그·OpenAI 기록·봉사자 기기에 남기지 않음. 남는 위험: 이름·주소 같은 말은 못 가림(TSD에 적고, 시연에서는 개인정보를 말하지 않음).
- 온도 작업과 겹침: `voiceChat.test.ts`, TSD, human_tsd, CLAUDE.md는 다른 부분을 고치므로 병합할 때 git merge로 푼다(rebase·강제 푸시 금지). 마이그레이션 적용 순서는 §6.
- DB 적용 전 배포: details는 조용히 "unavailable", 카드는 1장(기본 정보)만. 봉사자 기능은 메모리로 떨어지지 않는다(시험으로 보장).
- 카드 넘기기의 번거로움: [한 번에 모두 보기]로 줄임. 실사용 뒤 이용자 판단.
- 범위 밖: 대기열 카드에 답·요약 보이기, 지난 요청 복구, 음성 지시문에 "궁금한 점" 질문 추가(A4=B, 별도 PR), AI 항목 정리, 대화 턴 AI에 조건 넘기기(A3=B일 때만), 이용자 화면에서 자기 답 다시 보기.

## 8. 진행 기록
progress.md(`overnight-loop.md` 형식). 요약 표:

| 날짜 | 단계 | 결과 | 근거 |
|---|---|---|---|
