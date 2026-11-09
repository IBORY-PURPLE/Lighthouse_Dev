# 상품 상세 이미지 요약용 비전 AI 후보 비교

작성 2026-11-09 · 문서 조사만 함(유료 호출·가입·실측 없음) · 환율은 1 USD = 1,400원으로 **가정** · 가격은 2026-11-09 조회값이고 Upstage는 VAT 10% 별도

## 결론 5줄

1. **추천안: Upstage Document OCR → 기존 Groq 텍스트 LLM(`gpt-oss-120b`)으로 항목 추출 → 서버에서 근거 원문 대조.** 호스팅 REST API라 GPU가 필요 없다. 한글을 공식 지원하고, 쪽당 $0.0015(약 2원)로 가장 싸다. 유료 동기 호출은 저장하지 않고 학습에도 쓰지 않는다고 밝힌다.
2. **대안: Groq `qwen/qwen3.8-27b` 비전에 자른 조각을 직접 넣기.** 새 가입 없이 기존 키와 `groq-sdk`로 바로 해 볼 수 있다. 다만 한국어 OCR 품질, 무료 한도, 해상도 한도가 문서에 없다. Upstage 가입이 막히거나 정확도를 비교할 기준선이 필요할 때 쓴다.
3. **Baidu Unlimited-OCR은 이번 데모에는 쓰지 않는다.** MIT 오픈 모델이지만 한국어 지원이 공식 확인되지 않았다(Baidu 직원이 "다국어는 다음 릴리스"라고 답함). 서버리스 호스팅은 HF에 없고 베타 게이트웨이뿐이라, 초보가 하룻밤에 하기에는 난이도 '상'이다.
4. **어느 후보든 긴 이미지는 잘라서 보내야 한다.** 비전 LLM은 큰 이미지를 줄여서 처리하고, Upstage도 "가장 작은 글자가 이미지 높이의 2.5% 이상"을 권한다. 폭은 그대로 두고 높이 약 1,200px, 겹침 100px로 자르는 것을 출발점으로 한다. Vercel 함수 요청 본문은 4.5MB까지라서, 브라우저에서 조각을 만들어 보내는 편이 안전하다.
5. **비용은 예산 안에 넉넉히 든다.** 상품 1개를 30조각으로 잡아도 Upstage OCR은 약 $0.05(70원)다. 정답지 20개를 5번 돌려도 약 7,000원이고, 가입 크레딧 $10이 지금도 주어지면 사실상 0원이다(크레딧 제공 여부는 콘솔에서 확인 필요).

## 후보 비교표

| 기준 | Upstage Document OCR / Parse | Upstage Information Extract | Baidu Unlimited-OCR | (기준선) Groq qwen3.8-27b 비전 | (기준선) Gemini Flash | (기준선) Claude Haiku |
|---|---|---|---|---|---|---|
| 1. 무엇인가 | OCR은 글자·좌표·신뢰도만 준다. Parse는 레이아웃을 HTML·Markdown으로 정리한다. 요약하려면 **2단 구성이 필요하다** | 이미지를 받아 JSON 스키마대로 항목을 뽑는다. 근거 좌표와 high/low 신뢰도를 옵션으로 준다. 요약 문장은 따로 만들어야 한다 | 순수 OCR·문서 파싱(Markdown과 블록 좌표). 요약이나 항목 추출은 하지 않아 **2단 구성이 필요하다** | 범용 비전 LLM이라 요약까지 한 번에 한다 | 범용 비전 LLM | 범용 비전 LLM |
| 2. 사용 방법 | 호스팅 REST(`POST /v1/document-digitization`, multipart). Node `fetch`·`FormData`로 호출할 수 있고 GPU가 필요 없다 | 호스팅 API이고 OpenAI 호환이다(`openai` SDK에서 baseURL만 바꾼다). 요청 하나에 이미지 하나 | HF Inference Providers에 없다. 방법은 셋이다: ① vLLM 전용 컨테이너를 직접 띄우기(VRAM 8GB 이상, HF Endpoints L4 $0.80/시간) ② VLM Run Gateway 베타(OpenAI 호환, 단가 미확인) ③ Baidu Cloud 비동기 API(가입 장벽 있음) | 기존 Groq 키와 `groq-sdk`. 요청당 이미지 3장 | REST·SDK(조사 범위 밖) | REST·SDK(조사 범위 밖) |
| 3. 한국어와 긴 이미지 | 한글을 공식 지원한다. 2026년 독립 한국어 벤치마크는 없다. 한도는 100MB·100쪽·쪽당 2억 픽셀이고, 글자 높이 2.5% 권장 때문에 **잘라 보내야 한다** | 한글 지원. 50MB, WEBP 미지원. 모델 설명에 "숨겨지거나 함축된 정보 추출"이 있어 **지어낸 값 위험이 있다** | 한국어 **미확인**이고 위험이 높다. 다국어는 "다음 릴리스"라고 했고, 베트남어 오인식 보고가 있다. Baidu Cloud판은 긴 변 8192px 이하 | 한국어 OCR 점수가 없다. 이미지당 2,048토큰이라 축소된다. 해상도 한도는 문서에 없다 | 이미지당 기본 1,120토큰(Gemini 3). 한국어 공개 점수가 가장 많다 | 이미지당 최대 8000px라 860×20000은 한 장으로 보낼 수 없다. 긴 변 1,568px로 축소된다 |
| 4. 가격·무료·한도 | OCR $0.0015/쪽(2원), Parse Standard $0.01(14원), Enhanced $0.03. 가입 $10 크레딧(공식 문서에 있으나 현재 제공 여부와 유효기간은 미확인). Tier 0 동기 3 RPS | Standard $0.04/쪽(56원), Enhanced $0.06. Tier 0 동기 **1 RPS** | 모델은 무료(MIT)이고 GPU 시간만 든다. L4는 시간당 약 1,120원이라 켜 두면 하루 약 2.7만 원 | 무료 한도 미확인 | 무료 한도 비공개 | Haiku 5.5는 입력 $0.10·출력 $0.50/MTok. Haiku 4.5는 $1/$5 |
| 5. 라이선스·데이터 | 상용 API. FAQ: 동기 API 입출력은 저장하지 않고 학습에도 쓰지 않는다. 약관 제22조: 유료 데이터는 동의 없이 학습에 쓰지 않는다. **무료 서비스 데이터는 R&D에 쓸 수 있다**(가입 크레딧이 여기 해당하는지는 불명). Playground 업로드는 R&D에 쓰일 수 있다 | 왼쪽과 같음 | MIT. 직접 띄우면 데이터가 밖으로 나가지 않는다. Baidu Cloud판은 결과 링크 30일, 원본 정책은 미확인 | 조사 범위 밖 | 조사 범위 밖 | 조사 범위 밖 |
| 6. 초보 하룻밤 난이도 | **하~중.** 호출은 쉽다. 자르기, 조각 합치기, 2단 프롬프트가 일이다 | **하~중.** 스키마만 주면 된다. 지어낸 값 검증 설계가 필요하다 | **상.** GPU 컨테이너, 전용 옵션, 한국어 불확실 | **하.** 코드 경로가 이미 있다 | 하 | 중하(자르기 필수) |

## 후보별 근거

### Upstage Document OCR / Document Parse (추천안의 1단계)

- **종류**: OCR은 전체 텍스트, 단어별 글자와 신뢰도(confidence), 좌표를 준다. 현재 모델은 `ocr-260930`(2026-09-30)이다. Parse는 요소별 분류(paragraph, table 등)와 HTML·Markdown 결과를 읽기 순서대로 준다. Parse의 enhanced 모드는 260930부터 생성형 VLM이라 지어낸 글자 위험이 있을 수 있다(추론). 그래서 standard나 OCR을 먼저 쓴다. 근거: https://console.upstage.ai/docs/models/document-ocr.md , https://console.upstage.ai/docs/models/document-parse.md
- **호출**: `POST https://api.upstage.ai/v1/document-digitization`에 `Authorization: Bearer` 헤더를 붙이고, multipart로 `document`(파일)와 `model`(`ocr` 또는 `document-parse`)을 보낸다. 서버 시간 제한은 5분이고, 200단어 이하 문서는 약 3초 걸린다. 근거: https://console.upstage.ai/docs/getting-started.md , https://console.upstage.ai/api/parse/document-parsing.md
- **한도**: 100MB, 동기 100쪽, 쪽당 2억 픽셀, 최소 폭 640px 권장, 가장 작은 글자가 이미지 높이의 2.5% 이상 권장. OCR은 "글자가 페이지의 약 30% 이하일 때 최적화"됐다. WEBP는 문서끼리 표기가 엇갈리므로 PNG나 JPEG로 보낸다. 근거: https://console.upstage.ai/docs/capabilities/parse/input-requirements.md
- **한국어**: Hangul과 Hanja를 공식 지원한다. 정확도 근거는 회사 발표뿐이다(DP-Bench에서 주요 OCR보다 5% 이상 높다고 주장, 2024-10). 근거: https://byline.network/2024/10/241017_002/
- **긴 이미지**: Upstage 블로그(2025-04)는 한·중·일 이커머스의 "수천 px" 상품 설명 이미지를 사용 사례로 직접 든다. 하지만 이는 옛 모델 `document-parse-250404` 기준이고, 현재 모델 문서에는 긴 이미지 언급이 없다. 근거: https://www.upstage.ai/blog/en/struggling-to-process-loooooooong-document-images-with-generative-ai
- **가격·한도**: 앞의 표와 같다. Tier 0은 OCR·Parse 동기 3 RPS, 분당 500쪽이다. 근거: https://www.upstage.ai/pricing , https://console.upstage.ai/docs/guides/rate-limits.md
- **데이터**: 동기 API 입출력은 메모리에서만 처리하고 저장하지 않는다. 비동기는 입력을 최대 3일, 출력을 30일 보관한다. API 데이터는 학습에 쓰지 않는다(FAQ). 약관 제22조 ⑥은 무료 서비스 데이터를 R&D에 쓸 수 있다고 하고, 개인정보처리방침은 "Free Tier API"를 서비스 종료 때까지 보관한다고 적는다. 한국 리전 `kr.api.upstage.ai`(국내 처리)는 Closed Beta라 승인이 필요하다. Vercel 함수가 기본으로 미국 동부(iad1)에서 실행된다는 점도 함께 고려해야 한다. 근거: https://console.upstage.ai/docs/resources/faq.md , https://www.upstage.ai/terms-of-service , https://www.upstage.ai/privacy-policy , https://console.upstage.ai/docs/guides/region-usage.md
- **비영리 지원**: 가격 페이지에 교육·공익 기관용 "AI support program"(Solar Pro와 Document Parse 최대 1년 무료)이 있다. 지금 신청을 받는지와 심사 기간은 미확인이고, 하룻밤 실험에는 맞지 않는다.

### Upstage Information Extract (추천안의 비교 실험용)

- 이미지에서 JSON 스키마대로 바로 항목을 뽑는다. `location: true`를 주면 값마다 쪽 번호와 상대 좌표가, `confidence: true`를 주면 high/low가 붙는다. 근거: https://console.upstage.ai/docs/capabilities/information-extraction/universal-information-extraction , https://console.upstage.ai/docs/capabilities/extract/location-coordinates.md
- **주의**: 모델 페이지가 "숨겨지거나 함축된 정보 추출"을 기능으로 내세운다. 지어낸 정보 0건 기준과 부딪치므로, 쓰더라도 OCR 원문 대조가 필수다. 값이 없을 때 null을 주는지는 문서에 없다. 근거: https://console.upstage.ai/docs/models/information-extract.md
- 비용은 OCR의 27배($0.04/쪽)이고 Tier 0 한도가 1 RPS라, 10조각이면 최소 10초를 기다린다.
- Solar Pro 4와 Solar Mini 4는 이미지 입력이 확인되지 않은 텍스트 LLM이다. Solar Pro 2·3과 구 Mini는 2026-10-30에 종료됐다. 우리는 이미 Groq 텍스트 LLM이 있으니 Solar는 필요 없다.

### Baidu Unlimited-OCR

- **실재 확인**: MIT 라이선스, 3B MoE(활성 0.5B), 2026-06-22 공개. 후속 Unlimited-OCR-2는 2026-10-27에 나왔다. 근거: https://huggingface.co/baidu/Unlimited-OCR , https://arxiv.org/abs/2606.23050 , https://huggingface.co/baidu/Unlimited-OCR-2
- **종류**: 고정 프롬프트(`<image>document parsing.`)를 넣으면 Markdown과 블록 좌표 태그를 돌려준다. 항목 추출과 요약은 하지 않는다.
- **호스팅**: HF 모델 페이지에 "Inference Provider 없음"이라고 적혀 있다(v1, v2 모두). 직접 띄우려면 vLLM 전용 이미지 `vllm/vllm-openai:unlimited-ocr`에 trust-remote-code, NGram 로짓 프로세서, `skip_special_tokens:false` 같은 전용 옵션을 맞춰야 한다. 근거: https://recipes.vllm.ai/baidu/Unlimited-OCR
- HF Inference Endpoints 시간당 가격은 T4 $0.50, L4 $0.80, A10G $1.00이다. scale-to-zero 상태에서도 과금되는지 불분명하므로 pause를 써야 한다. 근거: https://huggingface.co/docs/inference-endpoints/en/pricing
- VLM Run Gateway(베타)가 `baidu/unlimited-ocr`를 OpenAI 호환으로 제공한다. 키 없이 IP당 하루 100회까지 쓸 수 있고, 입출력을 저장하거나 학습하지 않는다고 밝힌다. 다만 이 모델의 개별 페이지는 404이고 단가는 미확인이다. 근거: https://docs.vlm.run/gateway/models , https://docs.vlm.run/gateway/faq.md
- **한국어**: 근거가 없다. Baidu 직원이 다국어 지원은 다음 릴리스라고 답했고(토론 #8), 베트남어 사용자는 반복·오인식을 보고했다(토론 #14). 논문은 학습 데이터의 언어 구성을 밝히지 않는다. 근거: https://huggingface.co/baidu/Unlimited-OCR/discussions/8 , https://huggingface.co/baidu/Unlimited-OCR/discussions/14
- **긴 이미지**: 이 모델의 강점은 "수십 쪽 문서를 한 번에" 처리하는 것이다. 그런데 여러 장을 넣는 base 모드(1024×1024)는 논문 스스로 작은 글씨 오류를 한계로 적었다. 쿠팡 성분표 같은 작은 글씨에 불리하다. Baidu Cloud판은 이미지 10MB 이하, 긴 변 8192px 이하다. 근거: https://arxiv.org/html/2606.23050 , https://cloud.baidu.com/doc/OCR/s/fmr1p39gb
- **무료로 눈으로 확인하는 방법**: HF Space 데모(ZeroGPU)는 로그인 없이 하루 GPU 2분까지 쓸 수 있다. Space가 v1인지 v2인지는 표시가 없다. 근거: https://huggingface.co/spaces/baidu/Unlimited-OCR , https://huggingface.co/docs/hub/spaces-zerogpu

### 덧붙임: 같은 Baidu 계열의 PaddleOCR-VL

조사 중 발견한 후보라 이번 비교 대상은 아니다. MDPBench(2026-03) 한국어 열에서 PaddleOCR-VL-1.5가 86.0으로 Gemini-3-pro-preview 85.5와 비슷했고, Claude-Sonnet-4.6 64.3보다 높았다. 검증 단계에서 원문 Table 2로 열을 바로잡은 값이다. 공식 무료 API(하루 20,000쪽)가 있다지만 엔드포인트와 데이터 조건은 미확인이다. Unlimited-OCR보다 한국어 근거가 훨씬 강하므로, 다음 OCR 후보로 남긴다. 근거: https://arxiv.org/html/2603.28130v1 , https://www.paddleocr.ai/v3.6.0/en/index.html

### 한국어 벤치마크 요약(참고)

- **KOCRBench**(2025-10, 250문항, 상품 이미지 포함): 이미지만 넣었을 때 총점은 Qwen2.5-VL-7B 198, Gemini 2.5 Flash 182였다. **OCR 텍스트를 함께 넣으면** 둘 다 212로 올랐고, Gemini 2.5 Flash의 핵심정보 추출은 71에서 102(129문항 중)로 올랐다. 그러니 "OCR 텍스트를 LLM에 같이 준다"는 구성에 근거가 있다. 근거: https://arxiv.org/html/2510.02543v1
- **KO-VLM-Benchmark**(2026-02): KO-VQA 점수는 Gemini-2.5-flash 85.73, Qwen3-VL-8B 53.87이다. Claude와 Upstage는 표에 없다. 근거: https://github.com/Marker-Inc-Korea/KO-VLM-Benchmark
- Upstage, Claude Haiku, Unlimited-OCR을 같은 한국어 시험지로 비교한 독립 자료는 없다. 쿠팡 상세페이지를 직접 다룬 공개 사례도 없다.
- **가까운 사례로 코오롱몰**(AWS 블로그, 2025-08)이 있다. 긴 상세 이미지를 자르고 Claude로 사이즈표를 추출해 정확도를 82.9%에서 99.6%로 올렸다. 다만 향상분의 대부분은 프롬프트·용어 개선 덕분이라고 적혀 있다. 근거: https://aws.amazon.com/ko/blogs/tech/convert-visible-data-into-usable-data-with-kolon-mall

### 긴 이미지와 배포 환경

- Claude는 이미지당 최대 8000px이고 긴 변 1,568px로 축소된다(4.7 이상은 2,576px). Haiku 5.5가 고해상도 등급에 드는지는 미확인이다. 근거: https://platform.claude.com/docs/en/build-with-claude/vision
- Gemini 3은 이미지 기본 1,120토큰이고, 세로로 긴 이미지의 비율 처리는 문서에 없다. 근거: https://aistudio.google.com/docs/media-resolution
- Vercel 함수 요청·응답 본문은 4.5MB까지이고, 넘으면 413이다. 근거: https://vercel.com/docs/functions/limitations
- sharp는 Vercel Node 런타임에서 동작한다. Next.js 16.2.x + Turbopack에서 나던 `ERR_DLOPEN_FAILED`는 16.3에서 고쳐졌다. LightHouse는 `next ^16.4.5`라 해당하지 않는다. 근거: https://github.com/lovell/sharp/issues/4567

## 미확인 목록

1. Upstage 가입 크레딧 $10을 지금도 주는지, 유효기간과 카드 등록 필요 여부. 공식 문서 두 곳에는 있지만 가격 페이지에는 없다.
2. 가입 크레딧으로 한 호출이 약관 제22조 ⑥의 "무료 서비스"(R&D 사용 가능)에 해당하는지.
3. 세로로 긴 이미지 1장(또는 조각 1장)이 Upstage에서 몇 쪽으로 과금되는지. 첫 응답의 `usage.pages`로 실측해야 한다.
4. Upstage OCR의 실제 한국어 정확도. 독립 벤치마크가 없다.
5. 조각 높이의 최적값. 2.5% 권장을 엄격히 지키면 16px 글자 기준 약 640px다.
6. Information Extract가 이미지에 없는 항목에 null을 주는지, 값을 지어내는지.
7. Groq `qwen/qwen3.8-27b`의 무료 한도, 최대 해상도, base64 한도, 한국어 OCR 품질.
8. Gemini Flash 무료 한도, 그리고 무료 등급 데이터의 학습 사용 정책(이번 조사 범위 밖).
9. Baidu Unlimited-OCR의 한국어 품질, VLM Run Gateway 단가와 이미지 한도, Baidu Cloud 가격과 데이터 정책.
10. Upstage OCR 응답 예시의 `"stored": true` 필드가 무슨 뜻인지(문서에 설명 없음).
11. PaddleOCR-VL 무료 API의 엔드포인트, 토큰 절차, 데이터 조건.

## LightHouse에 붙인다면

### 구성안 A (추천): Upstage OCR → Groq 텍스트 LLM → 근거 대조

1. **브라우저에서 자르기**: 봉사자가 캡처 이미지를 고르면 브라우저 canvas로 폭을 1000px 이하로 맞추고, 높이 약 1,200px·겹침 100px 조각을 JPEG로 만든다. 이렇게 하면 조각마다 4.5MB 한도 안에 들고 sharp도 필요 없다. 서버에서 자르고 싶으면 Vercel Blob에 올린 뒤 sharp를 쓴다.
2. **새 서버 함수**(예: `apps/web/src/app/api/detail-extract/route.ts`, Node 런타임): 조각을 순서대로 Upstage `model=ocr`에 `fetch`로 보낸다. Tier 0은 3 RPS이므로 순차로 보내고, 429가 나면 재시도한다. 키는 `UPSTAGE_API_KEY` 환경 변수로 둔다.
3. **텍스트 합치기**: 조각 텍스트를 순번대로 잇고, 겹친 구간의 중복 줄은 문자열 비교로 지운다. 신뢰도가 낮은 단어는 표시해 둔다.
4. **항목 추출**: 합친 원문을 기존 `lib/llm.ts`의 Groq `gpt-oss-120b`에 넣는다. 출력은 JSON `{상품명, 용량, 성분, 사용법, 주의사항}`이고, 항목마다 `근거 원문`을 함께 받는다. 지시문에는 "원문에 없으면 null"을 넣는다.
5. **지어낸 정보 차단**: 서버에서 `근거 원문`이 OCR 텍스트에 실제로 있는지 공백을 정규화한 뒤 포함 검사를 한다. 없으면 그 항목을 "확인 불가"로 바꾼다.
6. **화면**: 요약과 근거를 함께 보여 주고, 봉사자가 원본과 대조해 고친다(데모 5단계).
7. **시험**: 개발 시험에서는 Upstage와 Groq 응답을 가짜로 바꾼다. 정답지 10~20개를 돌릴 때만 실제로 호출한다. 실험은 Playground가 아니라 API로 한다(Playground 업로드는 R&D에 쓰일 수 있다).

하룻밤 첫 실험 순서는 이렇다. 사람이 Upstage 가입과 키 발급을 한다. 상세 이미지 3~5장으로 정답을 적는다. 통째 1장과 1,200px 조각, 800px 조각을 OCR로 비교해 조각 높이를 정한다. 그다음 Groq 추출과 근거 대조를 붙여 정답지와 비교한다.

### 구성안 B (대안·비교용): Groq qwen3.8-27b 비전에 조각을 직접 넣기

1~2단계 자르기는 A와 같다. 조각을 3장씩 묶어 `groq-sdk`로 `qwen/qwen3.8-27b`에 보내, 조각별 원문 받아쓰기를 시킨다. 이후 3~6단계는 A와 같다(원문 → `gpt-oss-120b` 추출 → 근거 대조).

새 가입 없이 오늘 바로 해 볼 수 있다는 것이 장점이다. 단점은 이미지당 2,048토큰으로 축소돼 작은 글씨가 뭉개질 수 있고, 한국어 OCR 품질 근거가 없다는 것이다. A와 같은 정답지로 정확도를 비교하는 기준선으로 쓴다.

여유가 있으면 KOCRBench 근거대로 "Upstage OCR 원문 + 조각 이미지"를 함께 비전 모델에 넣는 혼합안도 비교해 볼 수 있다.
