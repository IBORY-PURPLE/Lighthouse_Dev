# LightHouse 기술 설계서(TSD) v2: 봉사자 흐름(플로우 A·B) 반영

작성일: 2026-11-09. 상태: **확정(2026-11-09 이용자 승인)**. 사람용 1쪽 요약은 `docs/human_tsd.md`.
이전 판: v1(11/4 밤샘 범위)은 git 기록(`f8b77c6`)에 있다. 바뀐 점과 근거는 `docs/plans/2026-11-09-overnight/tsd-review.md`.
적용 범위: 11/24 중간 시연까지의 데모 시나리오 V2(① 음성 요청 ② 요청 전달 ③ 탐색 조언 ④ 정보 요약 ⑤ 사람 검증 ⑥ 결과 전달 ⑦ 듣고 열기). 설계 출처는 FigJam의 "MVP 플로우 A · 사용자 요청"과 "MVP 플로우 B · 봉사자 수행"이다.

일정, 시간, 포기 순서는 그날 계획(`docs/plans/<날짜>/human.md`, `ai.md`)을, 개발 절차와 금지선은 `.claude/rules/`를 따른다. 이 문서는 무엇을 어떻게 만드는지만 정한다.

**v2의 핵심 결정**
1. 백엔드는 Next.js 서버 함수(TypeScript) 하나다. FastAPI 등 별도 서버는 11/24 시연 전에는 두지 않는다(§3, 재검토 조건은 `tsd-review.md`).
2. 서버 상태는 Supabase Postgres의 `requests`(대기열)와 `results`(결과함) 두 표뿐이다. 동시 선택은 SQL 함수의 조건부 UPDATE로 막는다(§2, §8.3).
3. ③④⑤의 작업 중 값(대화, 이미지 조각, 글자 읽기 원문, 요약 초안)은 봉사자 브라우저 메모리에만 있다. 서버는 이미지와 원문을 저장하지 않는다(§2).
4. 데모 단계마다 브랜치 하나다(§12).

## 1. 합격 흐름

역할은 처음부터 분리한다. 이용자는 이용자 화면만, 봉사자는 봉사자 화면만 본다. 챗봇은 봉사자의 어시스턴트다. 서버와 AI는 쇼핑몰에 접속하지 않는다. 이용자와 봉사자는 실시간으로 통신하지 않고, 대기열과 결과함을 거쳐서만 만난다.

### 플로우 A: 이용자 요청(①②)

1. 이용자가 아이폰에서 VoiceOver를 켜고 이용자 주소(`/`)를 연다.
2. 질문 3개(제품, 예산, 새 제품·중고)에 차례로 말하거나 입력창에 받아쓴다. 답마다 확인을 거친다. 답하는 동안 기기 밖으로 아무것도 보내지 않는다.
3. 요약을 듣고 "봉사자 매칭 요청"을 누르면 요청이 대기열에 들어가고 대기번호를 듣는다(`waiting`).
4. 앱을 닫았다 다시 열면 대기번호와 상태를 다시 듣는다.

### 플로우 B: 봉사자 수행(②~⑥)

"10분 지표"는 봉사자가 요청을 고른 시각부터 결과를 보낸 시각까지다(대기 시간 제외).

1. ② 봉사자가 대기열 화면(`/volunteer`)에서 대기 중 요청 목록을 본다.
2. ② 요청을 고르면 상태가 `waiting → in_progress`로 바뀐다. 다른 봉사자가 먼저 골랐으면 "이미 다른 봉사자가 진행 중"을 듣고 목록으로 돌아간다.
3. ② 요청 확인 화면(`/volunteer/requests/{id}`)에서 제품·예산·새 제품/중고를 본다.
4. ③ AI에게 질문하면 검색어·확인할 조건·찾는 순서를 받는다. 답변이 실패하면 안내를 듣고 다시 묻는다. 봉사자는 이를 참고해 쇼핑몰에서 직접 찾는다.
5. ④ 후보 상품의 상세 이미지를 캡처해 올리면 AI가 글자를 읽고 요약 초안을 만든다. 글자 읽기가 실패하면 봉사자가 텍스트를 직접 입력하고 같은 요약을 받는다.
6. ⑤ "요약이 맞나요?"에 아니요면 봉사자가 항목을 고친다. 예면 후보 1개를 확정한다.
7. ⑥ 후보·구매 링크·가이드를 보내면 결과함에 저장되고 상태가 `done`이 된다. 전송이 실패하면 안내를 듣고 다시 보낸다.
8. 플로우 C(⑦): 이용자가 나중에 앱을 열어 결과를 듣고 구매 링크를 연다.

WBS #8 확정 전 가정: ③은 챗봇 대화, ④는 스크린샷 업로드만이다.

### 시연 예외: 한 탭 이어 보기(②가 병합될 때까지)

②(대기열 화면·선택)가 main에 들어가기 전에는 개발자가 폰 하나로 ③을 보여 주려고 v1의 한 탭 이어 보기(`sessionStorage`의 `lh.match.v1`)를 남긴다. ③④ 화면은 이 값을 §8.2의 `VolunteerRequestView` 모양으로 바꾸는 어댑터로 읽는다(예산 없음, 새 제품/중고 없음). ②가 병합되면 이어 보기 버튼은 개발 전용 플래그 뒤로 숨기고 ③④는 요청 확인 화면에서 시작한다.

## 2. 구조

```
아이폰 브라우저 (역할별 라우트)
  /                              이용자: 질문 3개 → 요약 → 매칭 요청 → 대기번호 / 다시 열기 / (⑦ 결과 듣기)
  /volunteer                     봉사자: 대기열 목록(새로 읽기 버튼)
  /volunteer/requests/{id}       봉사자: 요청 확인 → ③ 챗봇 → ④ 이미지 요약 → ⑤ 대조·수정 → ⑥ 전송
      │   작업 중 값(대화, 이미지 조각, 읽은 글자, 요약 초안)은 이 탭의 메모리에만 있다
      ▼
Vercel 서버 함수 (Next.js, Node 22, 기본 지역 iad1 — §11에서 icn1 검토)
  /enter, /api/health, /api/match(시연 이어 보기)
  /api/requests, /api/requests/{id}                         플로우 A
  /api/volunteer/queue, /api/volunteer/requests/{id}[/claim|/release|/result]   플로우 B ②⑥
  /api/chat                                                 ③ (스트리밍)
  /api/volunteer/extract-text, /api/volunteer/summarize     ④⑤ (상태 없음)
      │                       │                         │
      ▼                       ▼                         ▼
Supabase Postgres (서울)   OpenAI (gpt-6-luna)               OpenAI 또는 Upstage (글자 읽기)
  requests, results          ③ 챗봇, ④ 요약                   ④ 글자 읽기
  SQL 함수(RPC)만 호출
```

### 역할 분리

| 역할 | 라우트 | 보이는 것 | 하지 않는 것 |
|---|---|---|---|
| 이용자 | `/` | 질문, 요약, 대기번호, (⑦) 결과 | 챗봇, 봉사자 UI, 대기열 목록 |
| 봉사자 | `/volunteer`, `/volunteer/requests/{id}` | 대기열, 요청 확인, 챗봇, 이미지 요약, 결과 전송 | 이용자 요청 작성 UI |

### 데이터가 어디 있나

| 값 | 위치 | 보관 |
|---|---|---|
| 이용자의 세 답(제품·예산·새/중고), 대기번호, 상태 | Supabase `requests` | §8.3 보관 규칙 |
| 결과(후보명, 구매 링크, 가이드, 확정 요약) | Supabase `results` | 완료 뒤 7일(이용자 결정 대기) |
| 이용자 기기의 지난 요청 표시 | 이용자 `localStorage` `lh.request.v1` | "새 요청하기"까지 |
| 챗봇 대화, 이미지 원본·조각, 글자 읽기 원문, 요약 초안, 근거 원문 | 봉사자 탭 메모리 | 탭을 닫으면 사라짐. 서버 저장 안 함 |
| 이미지 원본(대체 경로일 때만) | Supabase Storage 비공개 버킷 | 글자 읽기 직후 서버가 삭제 |

- 이미지와 상세페이지 원문을 서버에 남기지 않는 이유: 상세페이지 보관은 멘토가 지적한 법적 위험이다.
- DB는 서버 라우트만 서버 키(secret 또는 service_role)로 SQL 함수(RPC)를 호출해 다룬다. 표는 RLS를 켜고 정책을 두지 않아 브라우저 직접 접근을 막는다. 브라우저에는 Supabase 키를 내보내지 않고 Realtime도 쓰지 않는다.
- 봉사자 식별: 시연에서는 가상 봉사자 명단(`volunteers.ts`의 id·이름, `v-01` 형식)을 쓰고, 화면에서 고른 id를 `X-Demo-Volunteer` 헤더로 보낸다. 실제 로그인은 범위 밖이다.

## 3. 기술 선택

| 영역 | 선택 | 이유·근거 |
|---|---|---|
| 웹·서버 | Next.js 16(App Router, TypeScript, React 19), 서버 함수 `runtime = 'nodejs'` | 화면과 서버를 한 프로젝트로 배포. v1 그대로 |
| 런타임 | Node 22 | v1 그대로 |
| 배포 | Vercel 무료판, Root Directory=`apps/web` | v1 그대로. 함수 시간 최대 300초, 본문 4.5MB |
| DB | Supabase Postgres(프로젝트 `lighthouse`, 서울, 무료), `@supabase/supabase-js`(서버 전용, RPC), 마이그레이션은 저장소 루트 `supabase/migrations` | 11/9 이용자 결정. 동시 선택을 SQL 함수로 보장 |
| ③ 챗봇 | `openai` SDK, `gpt-6-luna`, `reasoning_effort: "none"` | 2026-11-12 Groq에서 바꿈(공개 주소의 Groq 키가 무효 401). 모델의 JSON 모드·응답 시간은 미확인, 배포 뒤 실측 |
| ④ 글자 읽기 | OpenAI(`openai` SDK, `gpt-6-luna`, `detail: original`, 추론 끔) 또는 Upstage Document OCR(`fetch`) | 정답지 3~5개로 실측해 고른다. 이용자 OpenAI 크레딧 활용 안 |
| ④ 요약 | `openai` SDK, `gpt-6-luna`, `reasoning_effort: "none"`, JSON 모드, `temperature: 0` | 2026-11-12 Groq에서 바꿈. luna가 JSON 모드와 `temperature`를 받아들이는지, 응답 시간은 미확인, 배포 뒤 실측 |
| ④ 생김새 설명 | Groq `qwen/qwen3.8-27b` 비전(Preview). 제품 코드에는 아직 없다 | 선택 기능, 뒤로 미룸. 원문과 대조할 수 없어 ⑤ 확인 필수 |
| 긴 이미지 자르기 | 브라우저 canvas | 서버 이미지 처리 라이브러리 없이 4.5MB 한도를 지킨다 |
| 음성 입력 | Web Speech API, 대체는 입력창과 iOS 받아쓰기 | v1 그대로 |
| 시험 | Vitest, `@playwright/test`, `@axe-core/playwright` | v1 그대로 |

**별도 백엔드(FastAPI 등)는 두지 않는다.** v1은 "Render 무료판이 잠들면 깨는 데 최대 1분"을 이유로 들었지만, 그 이유는 Render에만 해당한다. v2의 이유는 다음과 같다. Vercel에서 Python을 돌려도 한도(4.5MB, 300초, 2GB)가 같아 이득이 없다. ④는 모두 외부 HTTP API 호출이라 Python이 필요 없다. 두 언어면 시험 기록·Codex 검증 부담이 늘어난다. 같은 프로젝트 공존(Vercel Services)은 Beta이고 Root Directory 변경이 필요하며, 별도 프로젝트를 rewrite로 붙이면 쿠키 전달이 미확인이다. 재검토 조건(정답지 실측에서 Python 전용 OCR이 확실히 낫다 등)이 실측으로 확인되면 시연 뒤 ④만 별도 Vercel 프로젝트(`apps/api`)와 rewrite(캐시 끔)로 다시 검토한다. 상세는 `tsd-review.md`.

## 4. 폴더

저장소는 앱 단위로 나눈다. Vercel 웹 배포의 Root Directory는 `apps/web`이다.

```
supabase/                                   Supabase CLI 설정, link됨(.temp/는 git 제외)
  config.toml
  migrations/<시각>_<이름>.sql              표, SQL 함수. 추가만 한다(§11)
apps/web/                                   Vercel Root Directory
  src/app/page.tsx                          이용자(플로우 A, ⑦)
  src/app/volunteer/page.tsx                봉사자 대기열(②). ② 전에는 v1 시연 화면
  src/app/volunteer/requests/[requestId]/page.tsx   요청 확인 → ③④⑤⑥
  src/app/enter/route.ts
  src/app/api/{health,match,chat}/route.ts
  src/app/api/requests/route.ts, [requestId]/route.ts                 플로우 A
  src/app/api/volunteer/queue/route.ts
  src/app/api/volunteer/requests/[requestId]/{route,claim/route,release/route,result/route}.ts
  src/app/api/volunteer/{extract-text,summarize}/route.ts
  src/components/{SpeechInput,StatusRegion,DemoHandoff,VolunteerChat}.tsx
  src/components/{InfoSummary,ResultForm}.tsx       ④⑤, ⑥
  src/lib/{access,rateLimit,llm,prompt,chat,speech,parseRequest,matchHandoff,volunteers,answerRules}.ts
  src/lib/requestStore.ts                   서버 전용. 저장소 인터페이스, 메모리 구현, Supabase 구현
  src/lib/volunteerRequest.ts               ③④⑤⑥ 공용 요청 모양과 lh.match.v1 어댑터
  src/lib/imagePieces.ts                    브라우저 canvas 자르기
  src/lib/extract.ts                        서버 전용. 글자 읽기 엔진 호출과 가짜 모드
  src/lib/summaryDraft.ts                   SummaryDraft 타입과 검사
  src/lib/evidenceCheck.ts                  근거 원문 대조(순수 함수)
  tests/{unit,e2e,chatbot}/
  experiments/vision/                       로컬 실험(배포·시험 대상 아님)
```

- 새 lib 파일은 처음 만드는 브랜치에서 `CLAUDE.md` 지도에 추가한다.
- ③과 ④ 브랜치가 같은 파일을 고치지 않게 공용 타입(`volunteerRequest.ts`, `summaryDraft.ts`)을 먼저 만들고, 각 단계는 자기 부품 파일만 추가한다(§12).

## 5. 환경 변수

| 이름 | 위치 | 내용 |
|---|---|---|
| `OPENAI_API_KEY` | `apps/web/.env`, Vercel(사람이 등록) | OpenAI 키. ③ 챗봇, ④ 요약, ④ 글자 읽기가 함께 쓴다. AI는 읽거나 출력하지 않는다 |
| `GROQ_API_KEY` | 같음(로컬만) | 로컬 실험 서버(`apps/web/experiments/vision/`) 전용. 제품 코드는 읽지 않는다 |
| `UPSTAGE_API_KEY` | 같음(사람이 등록, 선택) | ④ 글자 읽기를 Upstage로 할 때 |
| Supabase 연동 변수 | Vercel(Supabase 연동이 넣음) | 코드는 URL `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`, 키 `SUPABASE_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`를 읽는다. 값은 보지 않는다 |
| `DEMO_ACCESS_CODE` | Vercel, 로컬은 시험 설정 | v1 그대로 |
| `LLM_MODE` | 시험 설정 | `mock`이면 가짜 응답 |
| `STORE_MODE` | 시험 설정 | `memory`면 서버 메모리 가짜 저장소 |
| `EXTRACT_MODE` | 시험 설정 | `mock`이면 글자 읽기·요약 가짜 응답 |

- 세 `*_MODE`는 모두 `VERCEL_ENV=production`에서 무시하고 실제로 동작한다(v1 `llm.ts:13-16`과 같은 규칙).
- Supabase 키가 없으면 저장소는 메모리로 떨어지고, `/api/health`의 `store`가 `memory`라고 알린다.
- 키 파일 규칙(`.env` 미커밋, `.vercelignore`, `.demo-access.local`)은 v1 그대로다.

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
| 요청 선택 성공 | "요청을 맡았습니다. {제품}." | 요청 확인 화면 제목 |
| 이미 진행 중 | "이미 다른 봉사자가 진행 중입니다. 목록으로 돌아갑니다." | 목록 제목 |
| ③ 답변 실패 | v1 오류 표 문구 | 다시 시도 버튼 |
| ④ 조각 보내는 중 | "이미지 {i}/{n}을 읽고 있습니다." (조각마다 갱신하지 않고 시작·끝만) | 유지 |
| ④ 요약 초안 도착 | "요약 초안이 도착했습니다. 항목 {n}개, 확인 필요 {k}개." | 요약 영역 제목 |
| ④ 글자 읽기 실패 | "이미지에서 글자를 읽지 못했습니다. 상세 내용을 직접 입력하세요." | 입력창 |
| ⑤ "요약이 맞나요?" 아니요 | "고칠 항목을 고르세요." | 첫 항목 입력창 |
| ⑥ 전송 성공 | "결과를 보냈습니다. 걸린 시간 {m}분." | 제목 |
| ⑥ 전송 실패 | "보내지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 보내기를 누르세요." | 다시 보내기 버튼 |

- 대기열은 자동으로 새로 읽지 않는다(폴링 없음). "새로 읽기" 버튼과 화면에 초점이 돌아올 때만 읽는다. 목록이 저절로 바뀌어 낭독이 끊기지 않게 하기 위해서다.
- 요약 항목은 "항목 이름, 값, 확인 필요 여부" 순서로 읽히는 목록으로 둔다. 근거 원문은 항목마다 펼쳐 볼 수 있게 한다.
- 봉사자 화면은 시각장애인 전용이 아니지만, 같은 접근성 기준(44px, 대비 4.5:1, axe 위반 0건)을 지킨다.

## 8. API

공통: 접근 쿠키가 없으면 401. 사용자 문장, 이미지, 읽은 글자는 로그에 남기지 않고 상태 코드, 소요 시간, 조각 번호만 남긴다. 새 라우트의 실패 본문은 `{ "ok": false, "error": "<코드>" }`다. 봉사자 API(`/api/volunteer/*`)는 `X-Demo-Volunteer` 헤더가 없거나 명단 밖이면 403 `unknown_volunteer`, 경로의 id가 UUID가 아니면 400 `invalid_request`, 저장소 오류는 503 `store_unavailable`, 횟수 초과는 429 `rate_limited`(+`Retry-After`)다.

### 8.1 v1에서 이어지는 것

- `GET /enter?code=...`, `POST /api/match`: v1 그대로. `/api/match`와 `lh.match.v1`은 ②가 병합될 때까지 시연 이어 보기용이다.
- `GET /api/health`: v1 응답에 `store: "supabase" | "memory"`, `extractEngine: "openai" | "upstage" | "mock" | null`을 더한다. 키 값은 반환하지 않는다.

### 8.2 공용 요청 모양

③④⑤⑥ 화면은 아래 모양 하나로 요청을 다룬다(`lib/volunteerRequest.ts`).

```ts
type VolunteerRequestView = {
  requestId: string;
  queueNumber: number | null;      // 시연 어댑터면 null
  product: string;                 // 이용자 답 원문(≤200자). 화면에만 표시
  brand: string | null;            // parseRequest 결과
  item: string;                    // parseRequest 결과(필수)
  budget: string | null;           // 이용자 답 원문. 화면에만 표시, LLM에 넘기지 않음
  condition: string | null;        // 이용자 답 원문
  conditionKind: "new" | "used" | "any" | null;  // 서버가 정규화
  claimedAt: string | null;        // 10분 지표 시작
};
```

`lh.match.v1` 어댑터는 `{brand, item, raw}`를 `product=raw, budget=null, condition=null, conditionKind=null, queueNumber=null`로 바꾼다.

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
| `claimed_at`, `done_at` | timestamptz null | 10분 지표 |
| `release_count` | int default 0 | 반납 기록 |
| `created_at`, `updated_at` | timestamptz default now() | |

인덱스 (status, created_at). RLS 켬, 정책 없음.

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

저장하지 않는 것: 이미지 원본, 글자 읽기 원문, 요약 초안, 근거 원문, 생김새 설명 원본.

**상태**

```
waiting --claim(먼저 누른 1명)--> in_progress --complete(맡은 봉사자)--> done
waiting --24시간--> expired
in_progress --release(맡은 봉사자, 선택 기능)--> waiting (release_count+1)
```

**보관**: `waiting`이 24시간을 넘으면 `expired`, `expired`는 24시간 뒤 삭제, `done`은 `done_at` 기준 7일 뒤 삭제(기간은 이용자 결정 대기). 정리는 SQL 함수가 호출될 때 함께 한다. `pg_cron`은 무료판 사용 가능 여부가 미확인이라 쓰지 않는다. 플로우 A 초안의 "24시간 뒤 삭제"를 이것으로 바꾼다.

**SQL 함수**(서버 키로만 실행. `revoke execute ... from public, anon, authenticated`, `grant ... to service_role`, `security invoker`, `set search_path = ''`)

| 함수 | 하는 일 | 결과(`out_outcome`) |
|---|---|---|
| `register_request(...)` | 플로우 A 접수. 같은 `client_request_id`면 기존 행, 아니면 날짜별 다음 번호로 삽입 | `created` / `existing` |
| `claim_request(p_request_id, p_volunteer_id)` | `update ... set status='in_progress' ... where id=$1 and status='waiting' returning ...` 한 문장. 실패하면 현재 상태를 보고 판정 | `claimed` / `already_mine` / `taken` / `done` / `expired` / `not_found` |
| `release_request(p_request_id, p_volunteer_id)` | 맡은 본인일 때만 `waiting`으로, `volunteer_id`·`claimed_at` null, `release_count+1` | `released` / `not_yours` / `not_in_progress` / `not_found` |
| `complete_request(p_request_id, p_volunteer_id, 결과 필드)` | 한 트랜잭션에서 `results` 삽입과 `status='done', done_at=now()`. 이미 `done`이고 본인 결과면 기존 행을 돌려줌(재전송해도 같은 결과) | `completed` / `existing` / `not_yours` / `not_in_progress` / `not_found` |

- 동시 선택은 Postgres Read Committed에서 UPDATE의 WHERE를 다시 평가하는 성질로 막는다(먼저 누른 사람만 성공). advisory lock이나 SKIP LOCKED는 쓰지 않는다. 근거: https://www.postgresql.org/docs/current/transaction-iso.html
- 반환 열 이름은 `out_`으로 시작하고 표 열은 별칭으로 한정한다. 반환 이름이 열 이름과 같으면 PL/pgSQL에서 "ambiguous" 오류가 난다.
- 초안 SQL은 `tsd-review.md`의 근거 문서와 워크플로 산출물에 있다. 실제 Postgres에서 돌려 보기 전까지는 추정이다(§10, §13).

### 8.4 플로우 A(①②)

| 경로 | 성공 | 실패 |
|---|---|---|
| `POST /api/requests` `{clientRequestId, product, budget, condition}` | 201 `{requestId, queueNumber, status:"waiting"}`, 같은 `clientRequestId` 재전송은 200 같은 본문 | 400 `invalid_request`/`too_long`, 422 `need_item`, 401, 429, 503 |
| `GET /api/requests/{id}` | 200 `{requestId, queueNumber, status, product}`. `status="done"`이면 `result:{candidateName, purchaseUrl, guide, summary}`를 덧붙임(플로우 C 경계) | 400, 404 `not_found`, 401, 429, 503 |

세부(검사 순서, 낭독 문구, 다시 열기)는 플로우 A 계획(`docs/plans/2026-11-09-overnight/`)을 따른다.

### 8.5 플로우 B ②⑥ 봉사자 API

| # | 경로 | 성공 | 실패 |
|---|---|---|---|
| 1 | `GET /api/volunteer/queue` | 200 `{items:[{requestId, queueNumber, product, budget, condition, createdAt, waitingMinutes}], mine:[내가 맡은 in_progress]}`, 오래된 순 최대 20개 | 공통 |
| 2 | `POST /api/volunteer/requests/{id}/claim` | 200 `{requestId, status:"in_progress", claimedAt, alreadyMine, request: VolunteerRequestView}` | 409 `already_claimed` / `already_done` / `expired`, 404 |
| 3 | `GET /api/volunteer/requests/{id}` | 200 `VolunteerRequestView` + `status` | 403 `not_yours`, 404 |
| 4 | `POST /api/volunteer/requests/{id}/release` (선택) | 200 `{requestId, status:"waiting"}` | 403 `not_yours`, 409 `not_in_progress` |
| 5 | `POST /api/volunteer/requests/{id}/result` `{candidateName, purchaseUrl, guide, summary, summarySource, summaryEdited}` | 201 `{requestId, status:"done", sentAt, durationSeconds}`, 같은 봉사자 재전송은 200 같은 본문 | 400 `invalid_request`/`too_long`/`invalid_url`, 403 `not_yours`, 409 `not_in_progress`, 404 |

Next 16의 동적 경로 `params`는 Promise라 `await`한다(구현 때 설치된 Next 타입으로 확인).

### 8.6 ③ `POST /api/chat`

v1 계약에 선택 필드만 더한다. 봉사자 화면에서만 호출한다.

요청 `{ "requestId": "uuid", "question": "...", "context": { "brand": "Sony", "item": "헤드셋", "hasBudget": true, "condition": "used" } }`

- `hasBudget?: boolean`, `condition?: "new" | "used" | "any" | null`. 둘 다 없어도 된다. 없으면 v1과 같은 지시문이 나간다.
- **예산 숫자는 넘기지 않는다.** 지시문에 "10만 원"이 들어가면 답에 되풀이될 수 있고, 가격 금지 검사(`answerRules.ts:17`)가 이를 위반으로 잡는다. 예산 원문은 봉사자 화면에만 보인다.
- 질문 300자 이하, 본문 상한 `MAX_BODY_BYTES` 2048 → 4096.
- 응답, 오류 표, `runtime`, `maxDuration`은 v1 그대로.
- 대화 기록은 보내지 않는다(v1 그대로). 대화는 봉사자 탭 메모리에만 있다.

### 8.7 ④ `POST /api/volunteer/extract-text`

조각 하나의 글자를 읽는다. 상태가 없다.

- 요청 `{ "requestId": "uuid", "pieceIndex": 0, "pieceCount": 8, "image": "data:image/jpeg;base64,..." }`, `pieceCount` 30 이하, 조각 디코드 후 1.5MB 이하(본문 4.5MB 한도 안).
- 대체 경로 요청 `{ "requestId", "storagePath" }`: 서버가 서명 읽기 주소를 엔진에 넘긴 뒤 파일을 지운다(아래 "④ 자르기와 보내기").
- 응답 200 `{ pieceIndex, text, lowConfidence: string[], engine: "openai" | "upstage" | "mock" }`. OpenAI 엔진은 단어 신뢰도가 없으므로 `lowConfidence`가 빈 배열이다.
- 실패: 413 `image_too_large`, 415 `bad_image_format`, 422 `no_text`, 429, 502 `extract_failed`, 503 `not_configured`.
- 설정: `runtime = 'nodejs'`, `maxDuration = 60`. 서버는 이미지를 엔진에 넘긴 뒤 버린다.

### 8.8 ④⑤ `POST /api/volunteer/summarize`

읽은 글자(또는 봉사자가 직접 입력한 글)로 요약 초안을 만든다. 상태가 없다.

- 요청 `{ "requestId": "uuid", "context": { "product": "...", "hasBudget": true, "conditionKind": "used" }, "source": "ocr" | "manual", "text": "..." }`
- `text` 상한은 4,000자다(`SUMMARY_TEXT_LIMIT`). 요약 엔진이 OpenAI `gpt-6-luna`로 바뀌었어도, 입력이 길어졌을 때 응답 시간이 28초 예산 안에 드는지 재 보지 못해 올리지 않았다(미확인, 배포 뒤 실측).
- 응답 200 `SummaryDraft`:

```ts
type SummaryDraft = {
  draftVersion: 1;
  source: "ocr" | "manual";
  fields: Array<{
    key: string;                 // productName, option, spec, components, caution ...
    label: string;               // 화면·낭독용 이름
    value: string | null;
    evidence: string | null;     // 원문 인용, 200자 이하
    check: "matched" | "unverified" | "missing";
    needsCheck: boolean;
    reason: string | null;
  }>;
  missing: string[];             // 원문에서 못 찾은 항목
  unreadable: number[];          // 글자를 못 읽은 조각 번호
  appearance?: { text: string; aiGenerated: true; needsCheck: true };  // 생김새(선택 기능)
};
```

- 서버 규칙(`lib/evidenceCheck.ts`, 순수 함수):
  1. `evidence`를 공백 정규화한 뒤 원문에 들어 있는지 검사한다. 없으면 `value=null`, `check="unverified"`.
  2. `lowConfidence` 단어와 겹치면 `needsCheck=true`.
  3. 가격·재고·할인 항목은 초안에 넣지 않는다(11/9 계획 정해 줄 것 2의 추천안).
  4. `source="manual"`이면 원문이 봉사자 입력이므로 같은 대조를 그대로 한다.
- 실패: 400 `empty_text`/`too_long`, 429, 502 `llm_failed`, 503.
- ⑤ 화면은 이 초안을 받아 항목마다 확인·수정한다. 봉사자가 고친 항목은 `evidence`를 버리고 `value`만 확정본으로 ⑥에 넘긴다.

### ④ 자르기와 보내기(브라우저)

- 기본: 브라우저 canvas로 폭 1000px 이하, 높이 약 1,200px, 겹침 100px, JPEG 조각을 만든다. 원본 크기 canvas를 만들지 않고, 조각 크기 canvas에 `drawImage`의 원본 좌표를 지정해 그린다(아이폰 canvas 면적 한도 회피).
- 조각은 한 장씩 차례로 `extract-text`에 보낸다. 429면 `Retry-After`만큼 기다린다. 다 읽으면 조각 순서대로 잇고 겹친 줄을 지운 뒤 `summarize`를 한 번 부른다.
- 같은 조각이 3회 실패하거나 봉사자가 고르면 텍스트 입력창을 연다("추출 실패 → 텍스트 직접 입력").
- 대체 경로(아이폰에서 canvas가 실패할 때): 서버가 Supabase Storage 비공개 버킷의 서명 업로드 주소를 발급하고, 브라우저가 원본을 올리고, `extract-text`가 서명 읽기 주소를 엔진에 넘긴 뒤 파일을 지운다. Python 없이 4.5MB 한도와 canvas 한도를 함께 피한다. 통이미지 정확도는 미확인이라 기본 경로가 아니다.

## 9. 챗봇

호출값, 클라이언트 설정, 스트림 처리, 횟수 제한은 v1 그대로다(`stream: true`, `max_completion_tokens: 800`, `maxRetries: 1`, `timeout: 20_000`, 분당 20회). 모델은 2026-11-12에 `gpt-6-luna`(OpenAI `openai` SDK)로 바꿨고 `reasoning_effort: "none"`을 더했다(기본 추론이 켜져 있으면 추론 토큰이 `max_completion_tokens`를 먼저 써서 글자 없이 끝날 수 있다). 스트림 반복이 끝난 뒤 요청 신호가 이미 끊겨 있으면 완성된 답으로 치지 않고 실패(`llm_failed`)로 처리한다.

지시문(`prompt.ts`)은 v1 본문을 그대로 두고, 마지막 줄("이용자 요청의 브랜드와 품목은 다음과 같다: …") **바로 앞에** 필요한 줄만 넣는다. 마지막 줄이 그대로라 기존 `endsWith` 시험이 유지된다.

- `hasBudget=true`: "이용자가 예산을 정했다. 금액 숫자를 쓰지 말고 '예산 이하로 가격 필터를 건다'처럼만 쓴다."
- `condition="used"`: "이용자는 중고를 원한다. 중고 탭, 판매자 평점, 상태 표기를 확인할 조건과 찾는 순서에 넣는다."
- `condition="new"`: "이용자는 새 제품을 원한다. 새 상품 필터와 판매자 정보를 확인할 조건에 넣는다."
- 값이 없으면 v1과 글자 하나 다르지 않다.

고정 질문 20개(`tests/chatbot/questions.json`)는 v1 묶음을 유지하고, `hasBudget`·`condition="used"` 맥락이 붙은 질문과 봉사자가 질문에 예산 숫자를 쓰는 유도 질문을 더한다. 가격 정규식은 완화하지 않는다.

## 10. 시험

| 명령 | 내용 | 외부 호출 |
|---|---|---|
| `npm run check` | ESLint, `tsc --noEmit`, Vitest | 없음 |
| `npm run test:e2e` | 로컬 서버 전체 흐름, 접근성 | 없음(`LLM_MODE=mock`, `STORE_MODE=memory`, `EXTRACT_MODE=mock`) |
| `npm run test:chatbot` | 고정 질문 품질 | 실제 OpenAI, 7초 간격 |
| `BASE_URL=... npm run test:public` | 공개 주소 1회 완주 | 실제 OpenAI(챗봇)·저장소·글자 읽기 각 1회 |
| (새) 실제 Postgres 시험 | `claim_request` 동시 호출에서 하나만 `claimed`, `complete_request` 재전송 같은 결과 | 로컬 `supabase start` 또는 개발용 프로젝트(사람 결정) |

- v1의 가짜 음성 입력, 화면 시험 환경(iPhone 15·WebKit), 필수 사례, 챗봇 품질 규칙은 그대로다. 통과 보고에는 "가짜 음성 입력 기준"을 밝힌다.
- 저장소: `requestStore`는 인터페이스 하나에 메모리 구현과 Supabase 구현을 둔다. Supabase 구현은 가짜 RPC 클라이언트를 주입해 단위 시험한다.
- ④: 직접 만든 합성 이미지 조각(실제 쇼핑몰 이미지를 저장소에 넣지 않는다)과 `EXTRACT_MODE=mock`으로 자르기, 보내기 순서, 실패 → 텍스트 입력 경로를 시험한다. `evidenceCheck`는 고정 시험값(원문, LLM 출력, 기대 `check`)으로 시험한다. 다른 언어로 옮겨도 같은 시험값을 쓸 수 있다.
- ④ 정확도: 정답지(상품 3~5개로 시작, 이후 10~20개)로 엔진을 비교한다. 채점은 항목별 맞음·틀림·지어냄·못 읽음이다. 개발 시험에서는 돌리지 않고 그날 계획의 돈 상한 안에서만 돌린다.
- 필수 사례 추가: 대기열 빈 목록, 이미 진행 중(409) → 목록 복귀와 낭독, 남의 요청 상세(403), 조각 413·415, 글자 읽기 3회 실패 → 입력창, 요약 근거 불일치 → `unverified`, ⑥ 실패 → 입력 유지·재전송 같은 결과, 봉사자 화면 axe 위반 0건.
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
| 3b | `stage/demo4` | `feat/demo4/experiment`, `feat/demo4/upload-summary` | 엔진 비교 실험, `imagePieces`, `extract`, `summaryDraft`, `evidenceCheck`, 두 API, `InfoSummary` 부품 | 공용 타입만(3a와 같은 파일을 고치지 않음) |
| 4 | `stage/demo2` | `feat/demo2/volunteer-queue` | `claim`/`release` 함수, 대기열·선택·상세 API, `/volunteer` 목록, `/volunteer/requests/[id]` 뼈대, 3a·3b 부품을 이 화면에 연결 | 2가 main에 병합된 뒤 |
| 5 | `stage/demo5` | `feat/demo5/verify` | ⑤ 요약 확인·수정 화면(3b에 넣을지는 그날 계획) | 3b |
| 6 | `stage/demo6` | `feat/demo6/send-result` | `results` 표, `complete_request`, 결과 API, `ResultForm`, 플로우 C 응답 | 3b의 `SummaryDraft` 타입, 4 |

- 11/9 밤 계획은 ①②를 `stage/demo1` 하나로 묶는 안을 이용자 확인 대기로 두었다. 묶으면 4번도 `feat/demo1/volunteer-queue`가 된다.
- 3a·3b는 v1 시연 화면(`/volunteer`)에 붙여 먼저 동작시키고, 4에서 요청 확인 화면으로 옮긴다. 3a·3b가 `volunteer/page.tsx`를 함께 고치면 충돌하므로 한 브랜치만 페이지에 붙이고 다른 쪽은 부품과 시험만 넣는다(그날 계획에서 정한다).
- 11/4 블록 표(v1 §12)는 기록으로 v1에 남긴다.

## 13. 확인되지 않은 것

| 항목 | 확인 시점 | 실패 때 |
|---|---|---|
| 아이폰 실기기 음성 인식, VoiceOver 낭독 섞임, 초점 이동 | 아침 사람 판정 | v1 대응 그대로 |
| `claim_request`·`complete_request` SQL이 실제 Postgres에서 돌고 동시 선택에서 하나만 성공하는지 | 4·5번 브랜치 | 함수 수정, 시험 추가 |
| `supabase-js` `rpc`의 표 반환 모양(배열, 0행) | 2번 브랜치 | 래퍼에서 맞춤 |
| 실제 Postgres 시험 환경(Docker 필요 여부, 개발용 프로젝트) | 2번 브랜치 전 | 사람 결정 |
| Supabase 무료판 `pg_cron` | 필요할 때 | 함수 호출 때 정리(현 설계) |
| Supabase 변수의 Preview 적용 여부 | 다음 배포 | 미리보기는 memory, 공개 완주는 production |
| 함수 지역(iad1↔icn1)과 지연 | 시연 전 실측 | 사람 승인 뒤 변경 |
| OpenAI `gpt-6-luna`의 챗봇·요약 응답 시간, JSON 모드·`temperature` 수용 | 배포 뒤 실측 | 요약 호출값 조정, 글 상한 유지 |
| `gpt-6-luna`·Upstage OCR의 한국어 상세 이미지 정확도, 통이미지 대 조각 | 3b 실험(정답지) | 다른 엔진, 조각 크기 조정 |
| 아이폰 canvas 면적·메모리 한도 | 3b 아침 실기기 | Storage 대체 경로 |
| 조각 30개 처리 시간이 10분 지표 안에 드는지 | 3b 실험 | 조각 수 상한, 병렬 2개 |
| OpenAI 크레딧 잔액·만료·등급, 키 등록 | 3b 전 | Upstage(글자 읽기), 챗봇·요약은 다른 공급자 |
| Vercel 외부 rewrite의 Cookie·스트리밍 전달 | 별도 서버 재검토 때만 | 재검토 보류 |
| 결과 보관 기간, 구매 링크 도메인 제한, 결과에 가격 칸 | 5번 브랜치 전 | 이용자 결정 |
| OpenAI가 요청 데이터를 남용 감시용으로 보관하는 기간(조사상 최대 30일)과 상세페이지 보관 위험의 관계 | 3b 전 | 멘토·이용자 판단, 필요하면 Upstage 우선 |
| Groq 학습 사용 여부 | 미확인 | 개인정보를 넣지 않음 |
