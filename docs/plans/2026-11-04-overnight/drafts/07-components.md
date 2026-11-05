초안. 코드 기준 커밋 870c13c. 앱 동작의 근거는 코드이고 사람 검토 전이다.

# 07 컴포넌트 구성

근거 표기는 `apps/web/` 기준 `파일:줄`이다. 화면 시험은 가짜 음성 입력 기준이며, 실제 아이폰, VoiceOver, 실제 음성 인식 동작은 AI가 확인하지 못했다.

## 1. 화면 → 컴포넌트 트리

```
RootLayout (html lang="ko")                        src/app/layout.tsx:17-23
├─ "/"  HomePage                                   src/app/page.tsx:14-59
│   ├─ h1 "LightHouse 상품 요청"
│   ├─ StatusRegion
│   └─ (state가 matched면) DemoHandoff
│      (아니면)            SpeechInput
└─ "/volunteer"  VolunteerLayout → VolunteerPage   src/app/volunteer/page.tsx:35-95
    ├─ h1 "봉사자 화면(시연)"
    ├─ StatusRegion
    ├─ (match가 있으면) dl.match-summary + VolunteerChat
    │                                └─ SpeechInput (질문용 labels)
    └─ (match가 없으면) Link "이용자 화면으로 돌아가기"
```

두 화면은 합치지 않는다. 공용은 `SpeechInput`, `StatusRegion`, 이어 보기 형식뿐이다(docs/TSD.md:104).

## 2. 컴포넌트

| 컴포넌트 | 역할 | 받는 값(props) | 갖는 상태 | 부르는 것 | 근거 |
|---|---|---|---|---|---|
| `HomePage` | 이용자 화면. 요청을 보내고 결과에 따라 화면을 바꾼다 | 없음 | `useReducer(speechInputReducer)`, 제목 ref | `requestMatch`, `saveMatch`, `/api/match`(간접) | page.tsx:14-44 |
| `VolunteerPage` | 봉사자 화면. 저장된 매칭을 읽어 보여 준다 | 없음 | `useSyncExternalStore`(저장값), `announced`, 초기 모델, `chatModel` | `readStoredMatch`, `parseStoredMatch`, `requestLabel` | volunteer/page.tsx:35-67 |
| `SpeechInput` | 말하기, 확인, 입력창 입력을 맡는 입력 부품 | `model`, `dispatch`, `onSubmit(text)`, `labels?`(기본은 요청용) | `typed`(입력창 값), 버튼·입력 ref 4개, 인식 취소 함수 ref | `getSpeechRecognitionCtor`, `startRecognition`. 서버는 직접 부르지 않는다 | SpeechInput.tsx:27-61, 88-104 |
| `StatusRegion` | 낭독 영역 `<p role="status">`. 빈 값이어도 항상 그린다 | `message` | 없음 | 없음 | StatusRegion.tsx:2-8 |
| `DemoHandoff` | 시연 예외 버튼. 매칭 뒤에만 그린다 | 없음 | 버튼 ref | `router.push("/volunteer")` | DemoHandoff.tsx:6-24 |
| `VolunteerChat` | 봉사자 질문과 답변 표시 | `match`, `model`, `dispatch` | `answer`, `arrivals`, 답변 영역 ref, 중단 컨트롤러 ref | `requestAnswer` → `/api/chat` | VolunteerChat.tsx:21-67 |

`SpeechInput`의 `labels`(요청용 / 질문용):

| 키 | 요청용 (SpeechInput.tsx:27-33) | 질문용 (VolunteerChat.tsx:13-19) |
|---|---|---|
| speak | 눌러서 말하기 | 눌러서 질문하기 |
| confirm | 이대로 요청 | 이대로 질문 |
| retry | 이대로 요청 | 다시 시도 |
| field | 찾는 상품 | 질문 |
| emptyStatus | `STATUS.emptyText` | `STATUS.emptyQuestion` |

`HomePage`는 `matched` 상태에서 `SpeechInput`을 그리지 않는다(page.tsx:52-56). 두 화면 모두 반응 모델은 `lib/speech.ts`의 `speechInputReducer`를 쓴다.

## 3. lib

| 파일 | 역할 | 서버 전용 | 근거 |
|---|---|---|---|
| `speech.ts` | 입력 상태 전환(`speechInputReducer`), 낭독 문구 `STATUS`, 브라우저 음성 인식 실행(`startRecognition`) | 아니오 | speech.ts:19-38, 96-169, 217-296 |
| `matchHandoff.ts` | `/api/match` 호출, 상태 코드→낭독 문구 매핑, 시연 이어 보기 저장·읽기(`lh.match.v1`) | 아니오 | matchHandoff.ts:6-101 |
| `chat.ts` | `/api/chat` 요청 형식·호출·스트림 읽기. 봉사자 화면에서만 쓴다 | 아니오 | chat.ts:1-89 |
| `parseRequest.ts` | 문장에서 브랜드·품목을 사전(정규식)으로 찾는다. AI를 쓰지 않는다 | 라우트에서만 쓴다 | parseRequest.ts:4-5, 19-21 |
| `access.ts` | 접근 코드 해시 비교, 쿠키 이름 `lh_access`, 유효기간 7일 | 예 | access.ts:2, 4-5, 22-32 |
| `volunteers.ts` | 가상 봉사자 3명의 고정 명단과 품목으로 찾기 | 예 | volunteers.ts:1, 9-17 |
| `llm.ts` | Groq 답변 스트림(`streamAnswer`), 모의 답변, 설정 확인 | 예 | llm.ts:1, 9-14, 47-90 |
| `prompt.ts` | 챗봇 지시문. 검색어·확인할 조건·찾는 순서 세 항목을 요구한다 | 아니오 | prompt.ts:8-31 |
| `rateLimit.ts` | 서버 메모리 횟수 제한. 접속 주소는 `x-forwarded-for` 첫 값 | 예 | rateLimit.ts:1-3, 18-54 |

## 4. 서버 함수

공통: 응답에 `Cache-Control: no-store`. 사용자 문장과 답변은 로그에 남기지 않고 상태 코드와 소요 시간만 남긴다(match/route.ts:71-74, chat/route.ts:145-146). 접근 쿠키는 `hasAccess`로 확인한다.

| 메서드·경로 | 입력 | 성공 응답 | 근거 |
|---|---|---|---|
| `GET /enter` | 쿼리 `code` | 303, `Location: /`, 쿠키 `lh_access`(코드의 SHA-256 해시, HttpOnly, Secure, SameSite=Lax, path `/`, 7일) | enter/route.ts:17-43, access.ts:5 |
| `GET /api/health` | 접근 쿠키 | 200 `{ ok, groqKeyConfigured, llmMode }` | health/route.ts:10-25 |
| `POST /api/match` | JSON `{ text }` | 200 `{ requestId, volunteer: { id, displayName }, request: { brand, item, raw } }` | match/route.ts:38-65 |
| `POST /api/chat` | JSON `{ requestId, question, context: { brand, item } }` | 200 `text/plain; charset=utf-8` 스트림(답변 글자) | chat/route.ts:96-137, chat.ts:10-32 |

### 오류 코드

본문은 모두 `{ ok: false, error }`다. `/enter`만 평문이다.

| 경로 | 상태 | `error` | 언제 | 근거 |
|---|---|---|---|---|
| `/enter` | 401 | (평문 "접근 코드가 올바르지 않습니다.") | 코드가 없거나 틀림. 서버에 `DEMO_ACCESS_CODE`가 없을 때도 | enter/route.ts:20-28, access.ts:22-26 |
| `/api/health` | 401 | `unauthorized` | 쿠키 없음·틀림 | health/route.ts:11-16 |
| `/api/match` | 401 | `unauthorized` | 쿠키 없음·틀림 | match/route.ts:39-41 |
| | 429 | `rate_limited` | 분당 30회 초과. `Retry-After` 초 | match/route.ts:15, 43-48 |
| | 400 | `invalid_request` | JSON이 아니거나 `text`가 문자열이 아니거나 공백뿐 | match/route.ts:28-36, 51 |
| | 400 | `too_long` | `text` 200자 초과 | match/route.ts:12, 52 |
| | 422 | `need_item` | 품목을 못 찾음 | match/route.ts:54-55 |
| | 500 | `no_volunteer` | 품목에 맞는 봉사자 없음 | match/route.ts:57-58 |
| `/api/chat` | 401 | `unauthorized` | 쿠키 없음·틀림 | chat/route.ts:100-102 |
| | 429 | `rate_limited` | 분당 20회 초과(`Retry-After` 초), 또는 Groq 429(`Retry-After: 60`) | chat/route.ts:16, 104-109, 132-134 |
| | 400 | `invalid_request` | JSON이 아니거나 형식이 다르거나 질문이 공백뿐 | chat/route.ts:47-62, 112 |
| | 400 | `too_long` | 본문 2048바이트 초과 또는 질문 300자 초과 | chat/route.ts:11, 49-58, chat.ts:6 |
| | 503 | `not_configured` | 모의 모드가 아닌데 `GROQ_API_KEY`가 없음 | chat/route.ts:115, llm.ts:18-20 |
| | 502 | `llm_failed` | 첫 글자 전 실패, 글자 없이 끝남 | chat/route.ts:127-135, llm.ts:85 |

- 첫 글자가 나온 뒤의 실패는 상태 코드를 바꿀 수 없어 스트림 오류로 끝낸다(chat/route.ts:65, 82-86). 서버는 28초 안에 끝낸다(chat/route.ts:13, 123).
- 브라우저는 상태 코드를 낭독 문구로 바꾼다. 매칭은 matchHandoff.ts:36-49, 챗봇은 chat.ts:34-47. 문구는 08-screens.md에 있다.
- 시간 제한: 매칭 10초(matchHandoff.ts:8), 답변 35초(chat.ts:8).

## 5. 아직 없음 (코드에서 확인한 사실)

- 실제 봉사자 대기열, 수락, 알림: 없다. 봉사자는 고정 명단 3명이고 품목이 맞는 첫 명을 돌려준다(volunteers.ts:9-17). `src/`에 알림, 소켓, DB 코드를 찾지 못했다.
- 이용자 요청을 서버에 저장하는 곳: 없다. 요청은 응답으로 돌려주고 브라우저 `sessionStorage`에 넣을 뿐이다(matchHandoff.ts:70-76). 이것은 시연 예외다. `/volunteer`가 같은 탭의 이 값을 읽어 이어 본다(docs/TSD.md:54, 208).
- 로그인: 없다. 공통 접근 쿠키 하나뿐이다(access.ts:4-5).
- `/api/chat`은 `requestId`를 문자열인지만 확인하고 쓰지 않는다. `context`는 브라우저가 보낸 값을 그대로 쓰며 매칭 결과와 대조하지 않는다(chat/route.ts:56-59, chat.ts:23-32).
- 이전 대화는 서버에 보내지 않는다. 질문 한 개와 지시문만 모델에 간다(llm.ts:66-69).
- 화면 쪽 `/api/health` 호출: 없다(`src/`에서 호출 코드를 찾지 못했다).
- 키보드 품목: 명단에는 있으나 `parseRequest`가 "헤드셋"만 알아봐서 지금은 요청으로 닿지 않는다(volunteers.ts:11-12, parseRequest.ts:5). 브랜드도 Sony뿐이다(parseRequest.ts:4).
- 서버 횟수 제한은 메모리 방식이라 재시작이나 서버 분산 때 초기화된다(rateLimit.ts:3).
