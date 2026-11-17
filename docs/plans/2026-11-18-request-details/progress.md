# 이용자 요청 브리핑(request details) 진행 기록

계획: `ai.md`(실행 기준), `human.md`(1쪽 요약). 작업 위치: `.claude/worktrees/request-details`, 브랜치 `feat/demo7/request-details`(github/main 563d5bd에서). 로컬 전용: push·PR·병합·원격 DB·Vercel은 하지 않았다. 승인: 2026-11-18 이용자 말 "추천안으로 진행해줘"(A1~A4 모두 추천안).

## 블록 1 로컬 구현(S0~S6)
상태: 로컬 구현 완료, H2(A5 승인) 앞에서 멈춤
PR: 없음(로컬), 실패 횟수: 아래 실패 목록 참고(세는 것: 검사·시험·빌드 실패)
결정: A1 요약+질문·답 그대로 저장, A2 보냄·만료 때 삭제, A3 리뷰 문단 AI에만(store:false), A4 음성 지시문 불변. 상세는 아래 "계획과 다르게 한 것".
다음 할 일: 이용자가 로컬 보고서(메인 세션이 만든다)를 보고 A5 승인 → `supabase db push --linked --dry-run`에 `20261122000000_request_details.sql` 하나만 나오는지 확인 → 적용 → push → PR(base main) → Codex → 병합 → Vercel READY(ai.md S7)
토큰: 미측정

### 기록
| 날짜 | 단계 | 결과 | 근거 |
|---|---|---|---|
| 2026-11-18 | S0 | `npm install`(apps/web) 완료, 기준선 `npx vitest run` 50파일 1108개 통과 | 이 파일 |
| 2026-11-18 | S1a | 마이그레이션 `20261122000000_request_details.sql`·down·PGlite 시험 12개 통과 | `tests/unit/sql/requestDetailsSql.test.ts` |
| 2026-11-18 | S1b | `requestDetails.ts`(정리·메모리·Supabase)·공용 타입·PHONE을 `researchCheck.ts`로 이동·단위 시험 18개 통과 | `tests/unit/requestDetails.test.ts` |
| 2026-11-18 | S1c | 구매 턴에 표시 메시지(tag `brief`) 1개. 빠른 답·AI 글 두 경로, 이미 정해진 뒤에는 없음 | `researchTurn.ts`, `researchTurn.test.ts` |
| 2026-11-18 | S2a | `voiceDetails`(대화 기록→짝)·voice route가 `request.details`를 실음 | `voiceChat.ts`, `voiceChat.test.ts` |
| 2026-11-18 | S2b | `/api/requests`가 details 받기(32KB·413)·저장·로그 `details=...`. `readLimitedText`를 `readLimited.ts`로 이동 | `requestsRoute.test.ts` |
| 2026-11-18 | S2c | 봉사자 상세 API가 진행 중 요청에만 `details`, 보낸 뒤 null | `volunteerRoutes.test.ts` |
| 2026-11-18 | S2d | 리뷰 문단 AI 자료에 `이용자조건`, 있으면 `store:false` | `researchReviewNeeds.test.ts` |
| 2026-11-18 | S3 | 화면: `RequestBrief.tsx`, `ChatLog`·`ResearchConversation`·`HeroCopy`·`volunteer.css`, `briefSteps`·`holdAfterBrief` | `npm run check` 통과 |
| 2026-11-18 | S4 | `request-brief.spec.ts` 4개 통과, 기존 화면 시험에 `passBrief` 추가 | 아래 시험 결과 |
| 2026-11-18 | S5 | `docs/TSD.md`·`docs/human_tsd.md`·`CLAUDE.md` 지도 갱신 | git diff |
| 2026-11-18 | S6 | 화면 캡처 3장을 scratchpad에 저장(`brief-1-hero`, `brief-2-card`, `brief-3-model-question`). 보고서는 메인 세션이 쓴다 | 최종 보고 |

### 시험 결과(최종)
- `cd apps/web && npm run check`(lint, typecheck, vitest 전체)
- `cd apps/web && npm run check`: lint·typecheck 오류 0, vitest 53파일 1180개 통과(종료 코드 0). 기준선은 50파일 1108개.
- 완료 조건 2의 시험 파일 10개(`researchReviewNeeds.test.ts` 포함): 277개 통과, 종료 코드 0.
- 화면 시험은 가짜 AI·메모리 저장소 운영 빌드 서버(`next start -p 3198`, `LLM_MODE=mock STORE_MODE=memory`)에 `BASE_URL`로 붙여 돌렸다(다른 워크트리가 3199·3200·3201을 쓰고 있어서).
  - `playwright test --project=e2e tests/e2e/request-brief.spec.ts tests/e2e/a-voice-home.spec.ts research-chat research-photo-link`: 8개 통과, 1개 실패(`a-voice-home.spec.ts:168`, 기준선에서도 실패). research-* 파일은 e2e 프로젝트에서 제외되어 이 명령으로는 돌지 않는다.
  - `npm run test:research-cycle`(가짜 AI 서버에 붙임): 1개 통과.
  - `npm run test:e2e:desktop`: 27개 통과, 8개 실패. 8개 모두 기준선(github/main)에서도 같은 줄에서 실패한다(아래).

### 실패 목록(세는 실패)
1. `npx vitest run`: `SyntaxError: Invalid regular expression ... Nothing to repeat` — PHONE 정규식을 옮길 때 내 도구 호출이 역슬래시를 먹어 정규식이 깨졌다. 바로 고침.
2. `researchTurnRoute.test.ts` 2개 실패(`expected [ 'volunteer', 'ai', 'ai' ] to deeply equal [ 'volunteer', 'ai' ]`, 길이 3 ≠ 2) — 구매 턴 메시지가 1개 늘었다. 아래 "바꾼 기존 시험"의 +1 수정.
3. `requestDetails.test.ts`(내가 새로 만든 것) 1개 실패 — 시연 초기화 때 알림이 행 삭제 직전에 와서 지우기가 안 됐다. 알림 처리를 한 박자 늦춰 고침.
4. `voiceChat.test.ts` 1개 실패(`expected { product: ..., (3) } to deeply equal { product: ..., (2) }`) — 응답 `request`에 details가 늘었다. 기대값 수정.
5. 내 새 시험 `researchReview`(지금은 `researchReviewNeeds.test.ts`)의 `hasForbidden(instructions)` 기대가 틀렸다(기존 지시문이 이미 가격 낱말을 가짐) — 새 줄만 검사하도록 고침.
6. 내 시험 파일 문자열의 역슬래시가 도구 호출에서 깨져 `Transform failed with 1 error`(requestsRoute.test.ts 새 시험), 한 번 더 같은 증상(researchReview 새 시험의 `split`) — 직접 고침.
7. 화면(폰 폭) 캡처에서 히어로 안내 문장이 제목 묶음을 위로 밀어 맨 위 알약이 막대에 가려졌다 — 안내를 제목 아래 빈 자리에 띄우도록 CSS를 고침(캡처로 확인).
8. `playwright --project=e2e-desktop` 첫 실행 13개 실패. 그중 9개는 기준선에서도 실패(아래), 4개는 내가 만든 새 단계(이용자 요청 카드) 때문이라 `passBrief`를 더해 고침: 기종 검색이 끝나기 전 새로 고침(386), 한 탭의 혜택 검색이 늦는 사이(487), 턴을 보내지 못하면(584), 움직임 줄이기(680). 두 번째 실행에서 `검색을 기다리는 사이 다른 탭에서…`(462)가 "생각 중" 표시가 카드를 보는 동안 숨겨져서 실패 → `passBrief` 추가로 통과.
9. `npm run test:research-cycle` 첫 실행 실패: `Expected [] / Received ["price:0만 원"]` — 이용자 요청 카드(접수 정보 "30만 원 안쪽")가 AI 말풍선(`.vc-row--ai`) 안에 있어 "AI 문구 금액 검사"가 이용자가 말한 예산을 AI 문구로 셌다. 카드를 AI 말풍선 밖(안내 말풍선 아래 별도 줄)으로 옮겨 고침(검사 기준은 그대로).
10. (기준선 확인용 빌드) `next build` Turbopack이 정션으로 연결한 node_modules를 못 읽어 실패 → `--webpack`으로 다시 빌드. 제품 코드 문제 아님.
11. 가드 훅이 scratchpad 안 `rm -rf` 명령을 막았다(`저장소 밖 삭제`). 우회하지 않고 그 폴더를 그대로 두었다.

### 기준선에서도 실패하는 화면 시험(내 변경과 무관, 2026-11-18 확인)
github/main 563d5bd를 따로 빌드·실행해(`git archive`로 scratchpad에 풀어서) 같은 시험을 돌렸다.
- `a-voice-home.spec.ts:168` "AI 호출이 실패하면 원본처럼 안내하고 다시 듣는다": 기준선에서도 같은 이유로 실패. 원인은 PR #60이 더한 서비스 워커 때문에 `page.route`가 `/api/voice/chat`을 못 가로채는 것(서비스 워커를 막으면 가로채기가 된다, 확인함).
- `research-chat.spec.ts`: "E1 히어로에서 E12까지"(`structuredLine` 글이 화면에 없음, src에서 쓰이지 않음), "히어로 글에 혜택 이야기를 앞질러…", "두 창" 5개(위 막대 `대기열·내 담당` 버튼을 못 찾음), `volunteer-desktop.spec.ts:20`(`.vc-side-toggle:visible`이 2개). 기준선 10개 실패 중 이 9개가 내 변경 뒤에도 같은 줄에서 실패한다. 나머지 하나(`research-photo-link` 190, 기준선에서만 실패)와 `리서치만 경로`(기준선 실패, 내 쪽 통과)는 흔들리는 시험으로 보인다.

- 열려 있는 충돌(메인 세션 결정 필요): `research-chat.spec.ts`의 E1 시험은 [구매했어요] 뒤 `await expect(composer(page)).toBeFocused()`를 기대한다(194줄). 계획 §3.7대로 [다 봤어요] 뒤 초점을 첫 질문으로 옮기므로 이 줄은 앞의 기준선 실패(179줄)가 고쳐지면 걸린다. 임시 사본에서 179줄 검사를 빼고 이 줄을 "첫 질문에 초점"으로 바꿔 돌렸더니 E2~E5(기종 질문·칩·혜택 직전)까지 통과했고 237줄(`직접 확인 필요`, 기준선 화면과 어긋난 글)에서 멈췄다. 임시 사본은 지웠고 실제 시험은 고치지 않았다(§3.10 밖이라서).

### 바꾼 기존 시험 기대값(§3.10 범위, 이유)
1. `tests/unit/voiceChat.test.ts` — "확정(done)이면 접수가 받는 모양의 request를 덧붙인다"와 "done 응답에 접수용 request를 덧붙인다": `toEqual`에 `details`(응답 `request`의 새 필드) 추가. (§3.10 `voiceChat.test.ts:150-159`와 같은 종류. 두 번째는 라이브 경로 시험이라 목록에 없었지만 같은 변경이다.)
2. `tests/unit/researchTurnRoute.test.ts` — 구매 버튼 턴의 메시지 수: `["volunteer","ai"]` → `["volunteer","ai","ai"]`(brief 1개), 같은 `clientTurnId` 재전송 시험의 `messages` 길이 2 → 3. +1만 고쳤다. `researchTurn.test.ts`의 `messages.at(-1)` 시험은 그대로 통과.
3. `tests/e2e/a-voice-home.spec.ts` — 접수 본문 `toEqual`에 `details` 추가.
4. 화면 시험에 새 단계 `passBrief`를 더했다(기준을 낮춘 것이 아니라 카드를 넘기는 단계가 생긴 것): `helpers/volunteerFlow.ts`에 `passBrief` 추가, `research-chat.spec.ts`(`pickBought`, 같은 기기 둘째 탭, 대화로 넘어가는 시험, 리서치만, 글로 구매 여부를 말하는 시험 5곳 — 361·400·504·595·검색을 기다리는 사이, 움직임 줄이기), `research-photo-link.spec.ts`(`toPhotoQuestion`), `research-cycle.spec.ts`(구매했어요 뒤). ai.md §3.10은 8곳이라 했는데 글로 구매 여부를 말하는 경로가 더 있어 추가했다.
- 새로 만든 시험: `requestDetails.test.ts`, `sql/requestDetailsSql.test.ts`, `researchReviewNeeds.test.ts`, `e2e/request-brief.spec.ts`. 기존 `researchReview.test.ts`는 내가 실수로 덮어썼다가 HEAD에서 되돌렸다(차이 없음).

### 계획과 다르게 한 것
- 계획 §3.10의 `researchReview.test.ts`(이용자조건 시험)는 이미 다른 내용의 같은 이름 파일이 있어 새 파일 `researchReviewNeeds.test.ts`에 썼다.
- 이용자 요청 카드는 AI 말풍선(`.vc-row--ai`)이 아니라 안내 말풍선 아래 별도 줄(`.vc-brief-row`)에 그린다(`research-cycle`의 AI 문구 금액 검사 때문, 위 실패 9).
- 카드를 보는 동안 입력창 옆 사진 올리기(+) 버튼도 숨긴다(입력창을 읽기 전용으로 잠그는 것과 함께).
- 히어로 안내 문장은 `HeroCopy`의 `hint` prop이고 제목 아래 빈 자리에 띄운다(폰 폭에서 제목 묶음을 밀어 올리지 않게).
- Supabase 저장은 `upsert(...).select("request_id")`로 새로 들어갔는지(saved)와 이미 있었는지(exists)를 구분한다.
- `ai.md` 완료 조건 3의 `npm run test:research-cycle`은 원래 공개 주소의 실제 AI로 도는 시험이다(유료 호출). 유료 호출 금지라 가짜 AI 서버(`BASE_URL=http://localhost:3198`)에 붙여 돌렸다.

### 확인하지 못한 것
- 실제 OpenAI로 리뷰 문단이 `이용자조건`을 사실처럼 쓰지 않는지(유료 호출 필요, 가짜 모드와 모의 `openai`로만 확인).
- 원격 Supabase에서 upsert(ignoreDuplicates)와 트리거 동작(PGlite로만 확인), `supabase db push --dry-run`.
- 실기기 아이폰·VoiceOver, 실제 음성 대화에서 문답 횟수.
- 클라우드 배포 환경(Vercel).
