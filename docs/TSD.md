# LightHouse 기술 설계서(TSD): 11/4 밤샘 범위

작성일: 2026-11-04. 상태: 초안(`docs/plans/2026-11-04-overnight/human.md` 승인 대기).
적용 범위: 밤샘 계획의 0~7블록. 이후 범위가 늘면 이 문서를 고친다.

일정, 토큰, 포기 순서는 `docs/plans/2026-11-04-overnight/human.md`를, 개발 절차와 금지선은 `.claude/rules/`를 따른다. 이 문서는 무엇을 어떻게 만드는지만 정한다.

## 1. 합격 흐름

역할은 처음부터 분리한다. 이용자는 이용자 화면만, 봉사자는 봉사자 화면만 본다. 챗봇은 봉사자의 어시스턴트다. 서버와 AI는 쇼핑몰에 접속하지 않는다.

오늘 밤샘은 개발자 한 명이 아이폰 하나로 A~Z를 시연하므로, **시연용 한 탭 이어 보기**만 예외로 둔다. 제품 기본 흐름이 아니다.

1. 사람이 아이폰에서 VoiceOver를 켜고 이용자 주소(`/`)를 연다.
2. "sony껄로 헤드셋 사고싶어"라고 말하거나 입력창에 받아쓴다.
3. 서버가 등록된 가상 봉사자 명단에서 봉사자를 정해 돌려준다.
4. (시연 예외) 이용자 화면에만 보이는 "봉사자 화면으로(시연)"로 같은 탭에서 `/volunteer`로 이동한다. 역할이 바뀌었다는 안내를 읽는다.
5. 봉사자 화면에서 "sony 헤드셋 제품을 찾는 가이드 알려줘"라고 물으면 찾는 방법을 답한다.

이후 두 기기·두 역할로 나눌 때는 4번 예외를 끄거나 숨기고, 세션(요청·상태·답변)만 공용으로 남긴다.

## 2. 구조

```
아이폰 브라우저 (역할별 라우트)
  /            이용자 전용: 음성 입력 또는 입력창 → 확인 → 매칭 → 대기/상태
  /volunteer   봉사자 전용: 요청 표시 → 음성 입력 또는 입력창 → 챗봇 답변
      │
      │  [시연 예외] 한 탭 이어 보기: sessionStorage(lh.match.v1)로 매칭 결과 전달
      │  UI에 "시연"이라고 표시. 제품의 정보 교환 채널이 아니다.
      ▼
Vercel 서버 함수
  GET  /enter?code=  접근 코드 확인, 쿠키 발급
  GET  /api/health   키 설정 여부만 반환
  POST /api/match    요청 분석, 가상 봉사자 지정
  POST /api/chat     Groq 호출, 답변 스트리밍 (봉사자 화면에서만 호출)
      ▼
Groq API (openai/gpt-oss-120b)
```

### 역할 분리 (기본)

| 역할 | 라우트 | 보이는 것 | 하지 않는 것 |
|---|---|---|---|
| 이용자 | `/` | 요청 입력, 매칭·대기 안내, (시연 예외) 이어 보기 버튼 | AI 챗봇, 봉사자용 안내 UI |
| 봉사자 | `/volunteer` | 이용자 요청, 챗봇 질문·답변 | 이용자 요청 작성 UI를 기본으로 두지 않음 |
| 공용(이후) | 세션 데이터 | 요청·상태·답변·링크 | 양쪽 UI를 한 화면에 합치지 않음 |

권한: 접근 쿠키(`lh_access`)는 시연 입장용으로 공통이다. `/api/chat`은 봉사자 화면 흐름에서만 쓰고, 이용자 화면은 `/api/match`까지만 호출한다. 클라이언트에서도 역할별 페이지에 챗봇·매칭 UI를 섞지 않는다.

### 시연 예외: 한 탭 이어 보기

- 이유: 오늘·당분간 개발자가 폰 하나로 이용자→봉사자 순서를 이어서 확인해야 한다.
- 동작: 매칭 응답을 `sessionStorage`의 `lh.match.v1`에 넣고, 이용자 화면의 "봉사자 화면으로(시연)"만으로 `/volunteer`에 넘긴다.
- 표시: 버튼·상태 안내·`document.title`에 시연임을 드러낸다. 일반 이용자 대기 UX와 섞어 쓰지 않는다.
- 한계: 다른 기기·다른 탭으로는 요청이 넘어가지 않는다. 저장소와 데이터베이스는 없다. 서버는 요청을 저장하지 않고, 상태는 브라우저 탭 안에만 있다.
- 이후: 외부 저장소로 세션을 공용화하면 이 예외는 끄거나 개발 전용 플래그 뒤로 숨긴다.

## 3. 기술 선택

| 영역 | 선택 | 이유·근거 |
|---|---|---|
| 웹 | Next.js 16.4.5, App Router, TypeScript, React 19 | 화면과 서버 함수를 한 프로젝트로 배포. 11/4 npm 최신판 |
| 런타임 | Node 22, 서버 함수 `runtime = 'nodejs'` | 로컬 22.18.0. Next 요구는 20.9 이상 |
| 배포 | Vercel 무료판, Root Directory=`apps/web`, CLI 배포 | 웹만 이 프로젝트. 이후 `apps/api` 등은 같은 저장소에 두고 별도 연결. 함수 시간 기본 300초 |
| 챗봇 | `groq-sdk` 1.6.0, `openai/gpt-oss-120b` | 무료. 실측 답변 약 1.3초, 답변당 약 500토큰 |
| 음성 입력 | Web Speech API, 대체는 입력창과 iOS 키보드 받아쓰기 | 별도 비용 없음. 아이폰 크롬 동작은 0블록에서 확인 |
| 단위 시험 | Vitest | 매칭 분석, 답변 금지 규칙, 제한 로직 |
| 화면 시험 | `@playwright/test` 1.64.1, `@axe-core/playwright` 4.14.0 | 아이폰 크기 WebKit 자동 조작과 접근성 검사 |

별도 백엔드(FastAPI, Render)와 외부 저장소는 쓰지 않는다. 외부 저장소는 다른 기기 연결 작업에서 추가한다.

## 4. 폴더

저장소는 앱 단위로 나눈다. Vercel 웹 배포의 Root Directory는 `apps/web`이다. 루트에 Next를 두지 않는다.

```
apps/web/                         Vercel Root Directory
  index.html                      0블록: / → speech-probe로 안내(1블록 Next 도입 때 제거)
  speech-probe/index.html         0블록 음성 시험 페이지
  vercel.json                     정적 배포 설정(1블록 이후 Next가 대체·정리)
  package.json                    @lighthouse/web
  src/app/page.tsx                이용자 전용(`/`) — 1블록~
  src/app/volunteer/page.tsx      봉사자 전용(`/volunteer`)
  src/app/enter/route.ts          접근 코드 확인
  src/app/api/{health,match,chat}/route.ts
  src/components/SpeechInput.tsx  큰 음성 버튼 + 입력창 + 확인
  src/components/StatusRegion.tsx VoiceOver 상태 안내
  src/components/DemoHandoff.tsx  시연 전용 이어 보기(이용자 화면에만)
  src/lib/speech.ts               음성 인식 감싸기
  src/lib/parseRequest.ts         브랜드·품목 분석
  src/lib/volunteers.ts           가상 봉사자 명단(서버 전용)
  src/lib/matchHandoff.ts         lh.match.v1 (시연 예외)
  src/lib/access.ts               쿠키 확인
  src/lib/rateLimit.ts            서버 메모리 횟수 제한
  src/lib/llm.ts                  Groq 호출과 가짜 응답 전환
  src/lib/prompt.ts               챗봇 지시문
  src/lib/answerRules.ts          답변 금지 규칙 검사(시험 전용)
  public/speech-probe/            1블록~: 정적 시험 페이지를 여기로 옮김(선택)
apps/api/                         (없음) 이후 별도 백이 필요하면 여기. 지금 만들지 않음
tests/unit/  tests/e2e/  tests/chatbot/questions.json   저장소 루트 또는 apps/web — 1블록에서 정함
```

- `/`와 `/volunteer`는 서로 화면을 합치지 않는다. 공용은 `SpeechInput`·`StatusRegion`·handoff 형식뿐이다.
- `DemoHandoff`와 `matchHandoff`는 시연 예외다. 이후 세션 저장소가 생기면 대체하거나 플래그로 끈다.
- 1블록에서 Next.js를 `apps/web`에 만들 때, 0블록 루트 정적 HTML(`index.html`, `speech-probe/`)은 `public/`으로 옮기거나 제거하고 앱 라우트가 대신한다.

새 최상위 폴더(`apps`, `tests`)를 만드는 PR에서 `CLAUDE.md`의 저장소 지도를 함께 고친다.

## 5. 환경 변수

| 이름 | 위치 | 내용 |
|---|---|---|
| `GROQ_API_KEY` | `apps/web/.env`, Vercel(사람이 등록) | Groq 키. AI는 읽거나 출력하지 않는다 |
| `DEMO_ACCESS_CODE` | Vercel, 로컬은 시험 설정 | AI가 무작위 생성. 시연 주소에만 쓴다 |
| `LLM_MODE` | 시험 설정 | `mock`이면 가짜 응답. `VERCEL_ENV=production`에서는 무시 |

- Next.js는 `apps/web`을 루트로 쓰므로 로컬 키는 `apps/web/.env`에 둔다. AI가 파일을 열 필요는 없다.
- 저장소 루트에 `.env`가 남아 있으면 사람이 `apps/web/.env`로 옮기거나 같은 값을 둔다. 커밋하지 않는다.
- `.gitignore`에는 `.env`가 이미 있다. `.demo-access.local`을 추가한다.
- `apps/web/.vercelignore`에 `.env*`, `.demo-access.local`을 둔다.
- 시연 주소 전체는 `.demo-access.local`에만 적는다. 아침 보고에는 파일 위치만 쓴다.

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

`apps/web/speech-probe/index.html` 정적 HTML 1개다. 공개 주소는 `/speech-probe/`. 버튼 2개(즉시 시작, 1초 뒤 시작)로 VoiceOver의 버튼 낭독이 인식에 섞이는지 비교한다. 화면에 API 유무, 이벤트 순서, 오류 코드, 인식 문장을 표시하고 아무것도 전송하지 않는다.

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

## 8. API

공통: 접근 쿠키가 없으면 401. 사용자 문장은 로그에 남기지 않고 상태 코드와 소요 시간만 남긴다.

### `GET /enter?code=...`

코드가 맞으면 쿠키를 주고 `/`로 303 이동해 주소에서 코드를 지운다. 틀리면 401.
쿠키: `lh_access`, 값은 코드의 SHA-256, `HttpOnly`, `Secure`, `SameSite=Lax`, 7일. 비교는 상수 시간으로 한다.
사람이 눈을 가리기 전에 시연 주소를 한 번 열면 이후 일반 주소로 쓸 수 있다.

### `GET /api/health`

`{ "ok": true, "groqKeyConfigured": true, "llmMode": "live" }`. 키 값은 반환하지 않는다.

### `POST /api/match`

요청 `{ "text": "sony껄로 헤드셋 사고싶어" }`, 200자 이하.

```json
{
  "requestId": "uuid",
  "volunteer": { "id": "v-01", "displayName": "가상 봉사자 A" },
  "request": { "brand": "Sony", "item": "헤드셋", "raw": "sony껄로 헤드셋 사고싶어" }
}
```

오류: 400 형식 오류, 401, 422 `need_item`(품목을 못 찾음), 429.

분석은 AI 없이 사전으로 한다(`parseRequest`).
- 브랜드: `sony`, `Sony`, `SONY`, `소니`, `쏘니` → `Sony`. `소니껄로`처럼 조사가 붙어도 찾는다. 없으면 `null`.
- 품목: `헤드셋`, `헤드폰` → `헤드셋`. 없으면 `need_item`.

봉사자 지정은 서버 전용 명단에서 품목을 맡는 첫 봉사자로 한다. 명단은 코드의 상수 3명이고 모두 "가상 봉사자"로 표시한다. 실명과 연락처를 넣지 않는다.

**시연 예외 handoff**: 이용자 화면만 응답을 `sessionStorage`의 `lh.match.v1`에 넣는다(`matchHandoff`). `/volunteer`는 이 값을 읽어 요청을 표시한다. 값이 없으면 "매칭 정보가 없습니다"와 이용자 화면(`/`) 링크를 보여 준다. 이 경로는 한 탭 이어 보기용이며, 이후 세션 저장소가 제품 경로가 된다.

### `POST /api/chat`

봉사자 화면(`/volunteer`)에서만 호출한다. 이용자 화면 코드에 이 API 호출을 넣지 않는다.

요청 `{ "requestId": "uuid", "question": "...", "context": { "brand": "Sony", "item": "헤드셋" } }`, 질문 300자 이하, 본문 2KB 이하. 대화 기록은 보내지 않는다.

응답: `text/plain; charset=utf-8` 스트리밍(Web `ReadableStream`). 첫 글자 전 오류는 상태 코드로, 도중 오류는 스트림 오류로 처리한다. 포기 순서에 따라 한 번에 표시로 바꿔도 브라우저 코드는 그대로 동작한다.

설정: `export const runtime = 'nodejs'`, `export const maxDuration = 30`.

| 코드 | 상황 | 안내 문구 |
|---|---|---|
| 400 | 형식, 길이 초과 | 질문이 너무 깁니다. 짧게 다시 말해 주세요. |
| 401 | 쿠키 없음 | 접근 코드가 필요합니다. 시연 주소로 다시 열어 주세요. |
| 429 | 앱 또는 Groq 제한 | 요청이 많습니다. 1분 뒤 다시 시도해 주세요. |
| 502 | Groq 오류, 시간 초과 | 답변 서버에 연결하지 못했습니다. 다시 시도해 주세요. |
| 503 | 키 미설정 | 챗봇 설정이 끝나지 않았습니다. |

## 9. 챗봇

호출값: `model: 'openai/gpt-oss-120b'`, `stream: true`, `max_completion_tokens: 800`. 클라이언트: `maxRetries: 1`, `timeout: 20_000`. 스트림 글자는 `chunk.choices[0].delta.content`에서 꺼낸다. `finish_reason`이 `length`면 "답변이 길어 일부가 잘렸습니다."를 덧붙인다. SDK 형식은 구현 때 패키지 타입으로 확인한다.

지시문(`apps/web/src/lib/prompt.ts`, 시험 전 초안):

```
너는 시각장애인 대신 상품을 찾는 자원봉사자를 돕는 어시스턴트다.
상품을 찾는 방법만 한국어로 짧게 답한다.
쇼핑몰에 접속할 수 없으므로 실제 상품 정보를 알지 못한다.

반드시 아래 세 항목을 이 순서와 이름으로 쓴다.
검색어:
확인할 조건:
찾는 순서:

금지: 금액과 예산 숫자, 재고 유무 단정, 구체적인 모델명, 할인 정보, 특정 상품 추천.
가격이나 재고를 물으면 값을 말하지 말고, 봉사자가 상품 페이지에서 확인할 방법을 알려 준다.
마크다운 기호를 쓰지 않고 줄바꿈과 번호만 쓴다.
이용자 요청의 브랜드와 품목은 다음과 같다: {brand} {item}
```

횟수 제한(서버 메모리, 완화 수단): `/api/match` 분당 30회, `/api/chat` 분당 20회. 재시작이나 서버 분산 때 초기화된다. Groq 한도(하루 1,000회, 분당 8,000토큰)를 넘으면 429로 처리한다.

## 10. 시험

| 명령 | 내용 | 모델 호출 |
|---|---|---|
| `npm run check` | ESLint, `tsc --noEmit`, Vitest | 없음 |
| `npm run test:e2e` | 로컬 서버 전체 흐름, 접근성 | 가짜(`LLM_MODE=mock`) |
| `npm run test:chatbot` | 고정 질문 20개 품질 | 실제 Groq, 7초 간격 |
| `BASE_URL=... npm run test:public` | 공개 주소 1회 완주 | 실제 Groq 1회 |

**가짜 음성 입력**: Playwright `addInitScript`로 `window.SpeechRecognition`과 `webkitSpeechRecognition`을 가짜로 바꾼다. 가짜는 `say(문장)`, `fail(오류코드)`, `never()`를 제공한다. 통과 보고에는 "가짜 음성 입력 기준"이라고 적는다.

**화면 시험 환경**: `devices['iPhone 15']`와 WebKit. 실패가 환경 문제면 같은 크기의 Chromium으로 돌리고 기록한다.

**필수 사례**
- 합격 문장, 표기 변형(`sony`, `소니`, `쏘니`, `소니껄로`)
- 품목 없는 문장 → 다시 요청
- 음성 API 없음, `not-allowed`, `never()` → 입력창 전환과 초점
- 인식 결과 확인, 다시 말하기
- 매칭 완료 후 초점, 시연 이어 보기 전환 후 초점과 "시연" 안내
- 이용자 화면에 챗봇 UI 없음, 봉사자 화면에 이용자 요청 작성 UI 없음(역할 분리)
- `sessionStorage` 없이 `/volunteer` 진입
- 쿠키 없는 API 요청 401, 길이 초과 400, 횟수 초과 429, 키 없음 503
- Groq 실패 때 안내와 다시 시도
- axe의 `critical`, `serious` 위반 0건(`wcag2a`, `wcag2aa`, `wcag21aa`)

**챗봇 품질**(`.claude/rules/chatbot-quality.md`): `tests/chatbot/questions.json` 20개. 표기 변형과 가격·재고 유도 질문을 넣는다. `answerRules`가 답변마다 검사한다.
- 필수: `검색어:`, `확인할 조건:`, `찾는 순서:`
- 금액 금지: 숫자 뒤의 `원`, `만원`, `달러`, `$`
- 재고 단정 금지: `재고가 있`, `재고가 없`, `품절입니다`, `개 남`
- 모델명 금지: 영문과 숫자가 섞인 모델 형식(예: 영문 2자 이상 + 숫자 3자리 이상)

자동 규칙은 놓칠 수 있으므로 Codex 검증 때 답변 원문도 함께 본다.

**공개 주소 완주**: `/enter` → 이용자 `/` → 가짜 음성 → 매칭 → (시연) 한 탭 이어 보기 → `/volunteer` → 실제 Groq 답변 수신. 답변 첫 줄과 소요 시간을 기록하고 키와 접근 코드는 기록하지 않는다.

## 11. 배포

- 사람이 지정한 Vercel 프로젝트에만 배포한다. 프로젝트 설정에서 **Root Directory = `apps/web`**.
- CLI는 `apps/web`에서 링크·배포한다(`cd apps/web` 후 `vercel deploy --prod`). 저장소 루트에서 배포하지 않는다.
- 검사·시험을 통과한 최신 브랜치를 배포한다. 보류 PR이어도 된다. 배포한 브랜치와 커밋을 아침 보고에 적는다(`.claude/rules/pr-flow.md`).
- 0블록: 같은 프로젝트에 정적 `speech-probe`를 올린다. 1블록 Next 배포가 앱 루트를 덮어쓰되, 시험 URL `/speech-probe/`는 필요하면 `public/`으로 유지한다.
- 1블록 이후 배포 뒤 `/api/health`에서 `groqKeyConfigured: true`를 확인한다. `false`면 챗봇 시험을 건너뛰고 아침 보고 첫 줄에 적는다.
- `DEMO_ACCESS_CODE`는 1블록에서 만들어 Vercel에 등록하고 `.demo-access.local`에 시연 주소를 적는다. 사람은 아침에 이 주소를 아이폰으로 옮겨 눈을 가리기 전에 연다.
- 브랜치, PR, Codex 검증, 병합은 `.claude/rules/pr-flow.md`를 따른다. 원격은 `github`만 쓴다.

## 12. 블록별 구현 범위

| 블록 | PR | 만드는 것 | 통과 조건 |
|---|---|---|---|
| 0 | PR #2, `docs/overnight-plan` | 규칙·훅 PR 병합, 문서 PR(TSD, 계획), `apps/web`+speech-probe, `evidence` 브랜치 | 사람이 병합, Root Directory=`apps/web` 배포, 입력 방식·지연값 결정 |
| 1 | `feat/skeleton` | `apps/web`에 Next.js, 검사 명령, `/api/health`, `/enter`, 명단, 배포 | `check` 통과, 공개 주소와 health 확인 |
| 2 | `feat/user-screen` | `SpeechInput`, `StatusRegion`, 이용자 전용 `/` | 입력 관련 E2E, axe, 챗봇 UI 없음 |
| 3 | `feat/match` | `parseRequest`, `/api/match`, `matchHandoff`, `DemoHandoff`, 봉사자 뼈대 | 매칭·시연 이어 보기·역할 분리 E2E |
| 4 | `feat/volunteer-chat` | `/api/chat`, `llm`, `prompt`, 제한, 봉사자 챗봇만, 질문 20개 | `test:chatbot`, 보호 장치 E2E |
| 5 | `feat/integration`(코드 수정 시) | 통합 수정, 스크린샷 | `test:e2e`, `test:public` |
| 6 | 지적별 | 보류·지적 수정, 남으면 문서 초안 | 재시험 통과 |
| 7 | 없음 | 최종 배포, 아침 보고 | `test:public` 재통과 |

PR마다 Codex 판정이 필요하다(`.claude/rules/pr-flow.md`). Cursor Bugbot은 쓰지 않는다(2026-11-05 이용자 결정).

## 13. 확인되지 않은 것

| 항목 | 확인 시점 | 실패 때 |
|---|---|---|
| 아이폰 크롬의 음성 인식 동작 | 0블록 | 입력창 받아쓰기 우선 |
| VoiceOver 낭독이 인식에 섞이는지 | 0블록, 아침 | 지연 시작, 확인 단계로 수정 |
| 지연 시작 때 사용자 동작 인정 여부 | 0블록 | 즉시 시작 |
| 실제 초점 이동과 낭독 | 아침 | 다음 밤 수정 |
| Groq 스트리밍 SDK 형식, 지시문 품질 | 4블록 | 형식 수정, 지시문 조정 |
| Playwright WebKit의 Windows 동작 | 1블록 | Chromium 모바일 크기 |
| Groq 학습 사용 여부 | 미확인 | 개인정보를 넣지 않음 |
