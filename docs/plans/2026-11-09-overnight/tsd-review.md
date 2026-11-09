# TSD 검증: FastAPI 백엔드 방향과 플로우 B 반영

작성 2026-11-09 · 상태: 승인됨(2026-11-09) · 대상: `docs/TSD.md`(11/4 밤샘 범위)
방법: 워크플로 1회(에이전트 7개). 조사 4갈래(호스팅, 현재 코드 적합성, ④ 비전 생태계, 플로우 B 데이터 설계) → 찬반 검증 2개(FastAPI 옹호, 레드팀) → 종합 판정 1개. 웹 문서 조회와 저장소 읽기만 했다. 유료 호출, 가입, 배포, 설정 변경은 없었다.
개정안: 2026-11-09 이용자 승인, `docs/TSD.md`를 v2로 교체함. 사람용 1쪽 요약은 `docs/human_tsd.md`.

## 결론

**FastAPI는 지금 도입하지 않는다.** 11/24 중간 시연 전에는 Python 서버를 두지 않는다. 플로우 B 전체(대기열, 요청 선택, ③ 챗봇, ④ 글자 읽기와 요약, ⑥ 전송)는 지금의 Next.js 서버 함수(TypeScript)와 Supabase SQL 함수로 만든다. 시연 뒤 아래 "재검토 조건" 중 하나가 실측으로 확인되면, 그때 ④만 맡는 별도 서버를 좁게 다시 검토한다.

이유 다섯 가지:

1. **한도상 이득이 없다.** Vercel에서 FastAPI를 돌려도 요청 본문 4.5MB, 무료판 실행 시간 300초, 메모리 2GB 한도는 Node와 같다. Python이 나은 점은 묶음 크기 500MB(Node 250MB)뿐이고, OCR 엔진을 직접 띄울 때만 의미가 있다.
2. **무거운 일이 언어와 무관한 곳에 있다.** "이미 다른 봉사자가 진행 중"은 Postgres 조건부 UPDATE 한 문장이 보장한다. 글자 읽기, 요약, 생김새 설명은 모두 외부 API(OpenAI, Groq, Upstage) 호출이고 셋 다 Node에서 부를 수 있다. 서버 코드는 "검사 → API 한 번 호출"의 얇은 층이다.
3. **두 언어 유지비가 이 프로젝트 규칙과 부딪친다.** PR마다 시험 기록 파일과 커밋 해시를 대조하고(`pr-flow.md:38, 49`) Codex가 코드를 읽어 판정한다. pytest 기록이 하나 더 늘고, Windows에 Python 해석기가 여러 개 섞여 있다. 실패 한 번이면 PR이 보류되는 규칙이라 아침 판정 PR이 쌓일 위험이 커진다.
4. **붙이는 방법마다 시연 전에 풀기 어려운 문제가 있다.** 같은 프로젝트에 두는 공식 방법(Services)은 Beta이고 Root Directory를 저장소 루트로 바꿔야 한다. 별도 프로젝트를 rewrite로 붙이면 접근 쿠키(`lh_access`)가 넘어가는지 문서에 없다. 외부 호스팅(Render 무료)은 15분 동안 요청이 없으면 잠들고 깨는 데 약 1분 걸려, 챗봇 35초 제한에서 첫 요청이 실패한다.
5. **나중에 옮겨도 비용이 거의 늘지 않는다.** ④는 상태 없는 API 두 개(`extract-text`, `summarize`)로 설계했고, 계약(경로, JSON, 오류 형식)은 FastAPI 라우터로 1:1 옮겨진다. 미루는 비용은 작고, 지금 도입하는 위험은 11/24 일정에 바로 걸린다.

## 옹호측 지적 중 받아들인 것

- **11/4의 반대 이유는 Render에만 맞았다.** 11/4 계획(`docs/plans/2026-11-04-overnight/human.md:28`)과 TSD(`docs/TSD.md:71`)는 "Render 무료판은 잠들면 깨는 데 최대 1분"을 이유로 들었다. Vercel 위의 FastAPI에는 해당하지 않는다. 그래서 반대 근거를 "잠든 서버"에서 위 1~5로 바꾼다. 결론은 그대로다.
- **함수 지역은 미확인이 아니다.** Vercel 함수 기본 지역은 미국 동부(iad1)이고, 서울(icn1)을 고를 수 있으며, 무료판은 지역 하나만 쓸 수 있다. DB가 서울이므로 지역을 옮기는 안을 사람 승인 항목으로 둔다(TSD v2 §11).
- **아이폰 canvas 한도는 실제 위험이다.** 대응은 Python이 아니라 대체 경로로 한다. 서버가 Supabase Storage 업로드 주소를 발급하고, 브라우저가 원본을 직접 올리고, 서버가 그 주소를 글자 읽기 API에 넘긴 뒤 파일을 지운다(TSD v2 §8.7과 "④ 자르기와 보내기").

## 레드팀 지적 중 받아들인 것(단일 유지안의 숨은 비용)

"Next 단일 유지안은 추가 비용 0"이 아니다. 아래 다섯 가지는 TSD v2에 대응을 넣었다.

| 위험 | 대응(TSD v2) |
|---|---|
| 함수(미국 동부)와 DB(서울) 사이 왕복 지연 | 지역 이전 전후 실측 뒤 사람이 승인(§11) |
| 운영·미리보기·로컬이 DB 하나를 같이 씀 | 마이그레이션은 추가만, 원격 적용은 병합 때 사람이. 개발용 두 번째 무료 프로젝트는 사람 결정(§11) |
| SQL 함수를 실제 Postgres로 시험할 환경 없음 | 동시 선택 시험 1건을 실제 Postgres에서. 환경은 사람 결정(§10) |
| Groq 분당 토큰 한도(공식 표 8K)를 ③과 ④가 나눠 씀 | 요약 입력 상한을 엔진별로 두고, 요약을 OpenAI로 옮기는 안 검토(§8.8) |
| 예산 숫자와 가격 금지 검사 충돌(`answerRules.ts:17`이 "10만 원"을 가격으로 잡음) | 챗봇에는 예산 "있음/없음"만 넘기고 숫자는 넘기지 않음(§9) |

그 밖에 바로잡은 것:
- 조사안의 `claim_request` SQL은 반환 열 이름이 표 열 이름과 같아 "ambiguous" 오류가 날 가능성이 높다. 반환 이름에 `out_`을 붙이고 열을 별칭으로 한정했다. 실제 Postgres에서 돌려 보기 전까지는 추정이다.
- 플로우 A 메모의 상태 값 `taken`과 플로우 B의 `in_progress`를 `in_progress`로 통일하고, 상태 제약은 플로우 A PR 2에서 한 번에 만든다(마이그레이션이 두 번 바뀌지 않게).
- 요약 입력 상한 20,000자는 Groq 분당 한도를 요청 하나로 넘길 수 있다. 엔진별 상한으로 바꿨다.
- 플로우 A는 답 하나를 200자까지 받는데 챗봇 맥락 상한을 60자로 두면 긴 예산 답에서 챗봇이 실패한다. 숫자를 넘기지 않는 설계로 충돌 자체를 없앴다.

## 대안 비교

| 안 | 고정비 | 첫 요청 지연 | 본문·시간 한도 | 기존 코드 영향 | 시험·Codex 영향 | 11/24 위험 | 초보 난이도 |
|---|---|---|---|---|---|---|---|
| **1. Next 단일 + Supabase SQL 함수(추천)** | 0원. API 사용료만(상품 1개 약 26원, 추정) | Node 함수와 같음. 무료판은 미리 데우기가 없어 오래 쉰 함수는 첫 호출이 1초 이상 느려짐 | 4.5MB(스트리밍 응답 제외), 300초, 2GB. 조각 업로드나 Storage 주소로 우회 | 옮기는 파일 없음. 라우트·lib·마이그레이션 추가, 챗봇 4개 파일 조금 수정 | 지금 체계 그대로. SQL 함수용 실제 Postgres 시험 1건 추가 | 낮음~중간(공유 DB, Groq 한도, 지역 지연). 설계로 대응 | 낮음 |
| 2a. Next + Vercel Python(같은 프로젝트, Services Beta) | 0원 | Python 수치 없음 | 1과 같음(묶음만 500MB) | Root Directory 변경, 루트 `vercel.json` 신설, 프리셋 변경(모두 사람). 틀리면 시연 주소 빌드 전체 실패. 접근 검사를 Python으로 다시 구현 | pytest 기록 추가, 서버 2개 띄우는 화면 시험, Codex가 두 언어를 읽음 | 높음(Beta, 배포 구조 변경) | 높음 |
| 2b. Next + 별도 Vercel 프로젝트(FastAPI) + rewrite | 0원(무료 포함량이 계정 단위인지 미확인) | 2a에 rewrite 한 단계 추가 | 1과 같음 | rewrite 1줄과 캐시 끄기(2026-04-06 이후 프로젝트는 기본 캐시). 새 프로젝트·환경 변수는 사람. 쿠키 전달 미확인이라 비밀 헤더와 Python 접근 검사가 필요할 수 있음 | 2a와 같음 | 중간~높음(쿠키·스트리밍 실측 전) | 중간~높음 |
| 3. Next + FastAPI 외부 호스팅(Render 등) | Render 무료 0원(0.1 CPU, 512MB). Railway·Fly는 카드와 요금, Cloud Run은 결제 계정 필요 | Render는 15분 무요청 후 약 1분 → 첫 요청 실패 | Render 본문 한도 미확인. Cloud Run 32MiB, 60분 | 출처가 달라져 쿠키를 못 씀(vercel.app·onrender.com이 공개 접미사 목록에 있음, Safari 제3자 쿠키 차단). 대리 호출이나 새 인증 필요 | 2b에 외부 배포 경로 추가 | 높음 | 높음 |
| 4. FastAPI로 전면 이전 | 호스팅에 따름 | 호스팅에 따름 | 호스팅에 따름 | 라우트 4개, 서버 전용 lib 5개, 시험 약 830줄 이상 재작성. 스트리밍 오류 처리 회귀 위험이 가장 큼 | 시험 전부 재작성 | 매우 높음(1~2밤 추정) | 매우 높음 |
| 5. Supabase Edge Functions(Deno/TS) | 무료 월 50만 호출 | 미확인 | 메모리 256MB, 요청당 CPU 2초, 150초. 본문 한도 미확인. Python 불가 | 런타임·배포 하나 추가, 다른 출처라 rewrite 필요 | Deno 시험 도구 별도 | 중간 | 중간 |

## 호스팅 후보 사실(2026-11-09 조회)

| 후보 | 핵심 조건 | 출처 |
|---|---|---|
| Vercel Python | FastAPI 정식 지원(앱 하나 = 함수 하나), 스트리밍 지원, Python 3.12 기본. 같은 프로젝트 공존은 Services(Beta), Root Directory를 저장소 루트로 두라고 안내. `api/*.py` 파일 방식은 "기존 프로젝트 지원"으로만 남음 | https://vercel.com/docs/frameworks/backend/fastapi , https://vercel.com/docs/functions/runtimes/python , https://vercel.com/docs/services , https://vercel.com/kb/guide/python-backend-on-vercel , https://vercel.com/docs/functions/runtimes/python/api-directory |
| Vercel 공통 한도 | 본문 4.5MB(넘으면 413, 스트리밍 응답은 제외), 무료판 300초, 2GB/1vCPU, 묶음 Node 250MB·Python 500MB. 무료판 월 Active CPU 4시간, 호출 100만 건, 비상업 용도 | https://vercel.com/docs/functions/limitations , https://vercel.com/docs/plans/hobby |
| Vercel 지역 | 기본 iad1, 서울 icn1 있음, 무료판은 지역 하나 | https://vercel.com/docs/regions , https://vercel.com/docs/functions/configuring-functions/region |
| Vercel rewrite | 외부 rewrite로 여러 백엔드를 한 도메인에 묶을 수 있음. 넘기는 헤더 목록에 Cookie 언급 없음. 2026-04-06 이후 프로젝트는 응답을 기본 캐시, 헤더로 끔 | https://vercel.com/docs/routing/rewrites |
| Render 무료 | 15분 무요청 후 잠듦, 깨는 데 약 1분, 월 750시간, 0.1 CPU·512MB, 아시아는 싱가포르뿐 | https://render.com/docs/free , https://render.com/docs/compute-plans.md , https://render.com/docs/regions |
| Railway | 체험 $5 1회, 이후 월 $1 크레딧, 후불 카드 필요, 잠들면 첫 요청 502 가능 | https://docs.railway.com/reference/pricing/plans , https://docs.railway.com/reference/app-sleeping |
| Fly.io | 새 조직 무료 없음, 최소 머신 월 $2.19, 체험 뒤 카드 | https://docs.fly.io/about/pricing |
| Koyeb | 무료 1개(512MB, 0.1 vCPU), 프랑크푸르트·워싱턴만, 1시간 무요청 후 0으로 | https://www.koyeb.com/docs/reference/instances |
| Cloud Run | 월 200만 요청 무료, 결제 계정 필요, 서울 리전 있음, 본문 32MiB | https://docs.cloud.google.com/free/docs/free-cloud-features , https://docs.cloud.google.com/run/quotas |
| Supabase Edge Functions | 256MB, CPU 2초, 150초(무료), 월 50만 호출, 1주 무활동 정지 | https://supabase.com/docs/guides/functions/limits , https://supabase.com/pricing |

## ④ 비전 생태계: Python이 필요한가

필요 없다. 쓰려는 것이 모두 HTTP API다.

| 할 일 | Node에서 | 근거 |
|---|---|---|
| 긴 스크린샷 자르기 | 브라우저 canvas. 원본 크기 canvas를 만들지 않고 조각 크기 canvas에 원본 좌표로 그림. 아이폰 canvas 면적 한도는 개발자 실측뿐(Apple 공식 없음) | research-vision.md, 조사 결과 |
| 글자 읽기(OpenAI) | 공식 Node SDK. 조사 결과 저가 비전 모델로 `gpt-5.6-luna`(입력 $0.20, 출력 $1.20 /100만 토큰, `detail: original`로 원본 해상도). 860×1200 조각 하나 약 1,232토큰 | https://developers.openai.com/api/docs/models/gpt-5.6-luna , https://developers.openai.com/api/docs/guides/images-vision |
| 글자 읽기(Upstage OCR) | REST(`fetch`+`FormData`). 공식 예시는 Python뿐이지만 Python이 필요하지는 않음. 단어별 신뢰도·좌표를 줌 | research-vision.md |
| 생김새 설명(Groq qwen) | `groq-sdk`, 저장소 실험에서 동작(`apps/web/experiments/vision/server.mjs`). Preview 모델 | 로컬 실험 |
| Python이 필요한 유일한 경우 | OCR 엔진을 직접 띄우기(PaddleOCR·EasyOCR 최고 메모리 1~2GB, RapidOCR ONNX는 더 가벼움). 정확도 미측정 | 조사·옹호측 |

이용자 안(글자=OpenAI 크레딧, 생김새=qwen)의 비용 추정: 상품 1개(조각 10장) 약 26원(luna 받아쓰기 약 14원 + qwen 1회 약 10원 + 요약). 가정: 조각 860×1200, 조각당 출력 600토큰, 추론 끔, 1달러=1,400원. 추정이다.

이용자 안의 약점: GPT 받아쓰기도 생성형이라 단어별 신뢰도가 없다. "근거 원문 대조"의 원문이 모델 출력이 되므로 지어낸 글자를 거르는 힘이 OCR보다 약하다. 그래서 엔진은 luna와 Upstage를 같은 정답지 3~5개로 실측해 고른다.

## 재검토 조건

아래 중 하나가 **실측으로** 확인되면 ④만 맡는 별도 서버를 다시 검토한다. 어느 경우든 11/24 시연 전에는 착수하지 않는다.

1. 정답지 실측에서 API 글자 읽기(luna, Upstage)가 기준에 못 미치고, Python 전용 OCR이 확실히 더 정확하며, Vercel 함수 한도(2GB, 500MB) 안에 들어간다.
2. 아이폰에서 canvas 자르기가 실패하고, Storage 주소 대체 경로도 정확도나 시간 기준에 못 미쳐 서버 자르기가 필수가 됐다.
3. Node로 할 수 없는 Python 전용 라이브러리가 운영 경로에 꼭 필요해졌다.
4. Vercel Services가 Root Directory=`apps/web` 그대로 쓸 수 있고 정식(GA)이 됐다.
5. 별도 프로젝트안(2b)을 볼 때: rewrite가 Cookie, 스트리밍, 오류 코드를 그대로 넘기고 캐시를 끌 수 있음을 먼저 실측했다.
6. Python에 익숙한 사람이 합류하거나 시연 뒤 제품화 단계로 넘어갔다.

## 현 TSD 대비 차이

| 현 TSD | 무엇이 바뀌나 | v2 위치 |
|---|---|---|
| 제목 "11/4 밤샘 범위" | 11/9 결정(Supabase 대기열, 플로우 A·B) 반영 개정판 | 머리말 |
| §1 합격 흐름: 한 문장 → 즉시 매칭 → 한 탭 이어 보기 → 챗봇 | 플로우 A(질문 3개 → 대기열·대기번호)와 플로우 B(대기열 → 선택 → ③ → ④ → ⑤ → ⑥ → 완료)를 기본 흐름으로. 한 탭 이어 보기는 ②가 병합될 때까지 시연 보조 | §1 |
| §2 "저장소와 데이터베이스는 없다" | 서버 상태는 Supabase `requests`·`results` 두 표뿐. ③④⑤의 작업 중 값은 봉사자 브라우저 메모리에만. 서버 라우트만 서버 키로 RPC | §2 |
| §3 71행 "별도 백엔드(FastAPI, Render)와 외부 저장소는 쓰지 않는다" | 외부 저장소는 Supabase를 쓴다. 별도 백엔드는 쓰지 않되 이유를 위 1~5로 바꾸고 재검토 조건을 붙임 | §3 |
| §3 기술 표 | DB(Supabase, `@supabase/supabase-js` 서버 전용), ④ 글자 읽기(OpenAI 또는 Upstage, 실측으로 선택), 생김새(Groq qwen, 선택) 추가 | §3 |
| §4 폴더 | `supabase/migrations`, 봉사자 API 라우트, 요청 상세 화면, ④ 부품·lib 추가 | §4 |
| §5 환경 변수 | Supabase 연동 변수, `OPENAI_API_KEY`, `STORE_MODE`, `EXTRACT_MODE` 추가 | §5 |
| §8 API 5개 | 플로우 A 2개 + 플로우 B 7개 추가. `/api/chat` 맥락에 선택 값 2개 | §8 |
| §9 챗봇 | 예산 있음/없음, 새 제품/중고를 지시문 마지막 줄 앞에 넣음. 값이 없으면 지금과 글자 하나 다르지 않음 | §9 |
| §10 시험 | 가짜 저장소·가짜 추출 모드, 실제 Postgres 동시 선택 시험 1건, 근거 대조 고정 시험값 | §10 |
| §11 배포 | 지역(icn1) 승인 항목, 마이그레이션 규칙, 공유 DB 위험 | §11 |
| §12 블록 표 | 11/4 블록 표는 기록으로 남기고, 데모 단계별 브랜치 표로 바꿈 | §12 |
| §13 미확인 | 아래 미확인 목록 반영 | §13 |

## 미확인 목록

1. Vercel 외부 rewrite가 Cookie(`lh_access`), 스트리밍 응답, 오류 상태 코드를 그대로 넘기는지
2. Vercel Python 함수의 첫 요청 지연(공식 수치 없음)
3. `lighthouse-web` 대시보드의 실제 함수 지역 값. 서울로 옮긴 뒤 DB 왕복이 얼마나 줄고 Groq·OpenAI 호출이 얼마나 느려지는지
4. `claim_request`·`complete_request` 초안 SQL이 실제 Postgres에서 오류 없이 돌고, 동시에 눌렀을 때 하나만 성공하는지. `supabase-js`의 `rpc`가 표 반환을 배열로 주는지
5. 실제 Postgres 시험 환경(로컬 `supabase start`에 Docker 필요 여부, 개발용 두 번째 무료 프로젝트 여부)
6. Supabase 무료판 `pg_cron` 사용 가능 여부
7. Vercel 환경 변수 적용 범위: 메모(`flow-a-ai-plan-notes.md`)는 Supabase 변수가 Production만이라고 적었고, 상위 세션 안내는 Production+Preview라고 했다. 미리보기 배포에서 저장소가 가짜로 떨어지는지 확인 필요(값은 보지 않는다)
8. Groq 계정 등급(무료인지 Developer인지)과 실제 분당 토큰 한도. 실측 7,000이 출력 예약분까지 센 값인지
9. `gpt-5.6-luna`와 Upstage OCR의 한국어 상세페이지 받아쓰기 정확도. 긴 통이미지를 원본 해상도로 한 번에 넣을 때와 조각으로 나눌 때의 차이. 조각당 출력 토큰 수
10. 아이폰 Safari·Chrome의 canvas 면적·메모리 한도(Apple 공식 자료 없음). 조각 30개를 차례로 처리할 때 10분 지표 안에 드는지
11. OpenAI 크레딧 잔액, 구매일(1년 만료), 사용 등급
12. RapidOCR 등 경량 OCR의 한국어 정확도와 메모리(옹호측 제시, 미측정)
13. Vercel 무료 포함량이 프로젝트 단위인지 계정 단위인지(2b안을 다시 볼 때만 필요)
14. 이용자 결정: 결과 보관 기간(7일 추천), 구매 링크 도메인 제한 여부, 결과에 가격 칸을 둘지

## 근거 원문

워크플로 산출 원문(조사 4건, 찬반 2건, 종합 1건)은 세션 임시 폴더에만 있고 저장소에는 넣지 않았다. 이 문서가 그 요약본이다. 저장소 안 근거: `docs/TSD.md:65, 71`, `docs/plans/2026-11-04-overnight/human.md:28`, `apps/web/src/lib/answerRules.ts:17`, `apps/web/src/lib/chat.ts:8, 23-32`, `apps/web/src/lib/llm.ts:13-16`, `apps/web/src/app/api/chat/route.ts:11`, `.claude/rules/pr-flow.md:38, 49`.
