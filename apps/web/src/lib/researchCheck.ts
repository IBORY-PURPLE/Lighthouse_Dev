import "server-only";
import { RESEARCH_LIMITS, siteNameOf, type ResearchItem, type ResearchLink } from "./research";

// AI가 만든 리서치 출력의 검사(설계 지침 3절). 화면에 보내기 전에 서버가 모양·길이·금지 패턴을 거른다.
// - 가격·재고·할인 금액처럼 보이는 표현이 든 문장은 버린다(링크 제목은 도메인 이름으로 바꾼다).
// - 웹 검색으로 받은 후보와 링크는 출처 주소가 검색 결과(인용·소스 목록)에 있는 것만 남긴다.
// 기종 이름 모양(WH-1000 등)은 정상 출력이라 거르지 않는다(answerRules.ts의 model 규칙과 다르다).

// 리뷰 수·판매량 바로 앞(리뷰 1,234 / 리뷰 수는 1,234 / 판매량 10만)이면 금액이 아니다. 뒤 정규식의 부정 후방 탐색에 쓴다.
// 조사(가·도)나 '구매자'까지 넣으면 "구매자가 19,900에 샀대요", "후기도 19,900이 적당"이 빠져나가므로 넣지 않는다.
const REVIEW_BEFORE = "(?:리뷰|후기|평가|판매량|조회수|팔로워|별점|평점)\\s?(?:수\\s?(?:는|은)?)?\\s?[\\d,.]*";
// 사양 낱말 바로 뒤의 큰 수(높이 1200이에요, 해상도 1920에 맞춰)는 금액이 아니다.
const SPEC_BEFORE = "(?:높이|크기|폭|너비|길이|두께|해상도|무게|용량|출력|속도|밝기|주파수|감도)\\s?(?:는|은|가|이|도)?\\s?";
// 퍼센트 앞뒤 6자 안에 있으면 할인율로 보는 돈 낱말.
const MONEY_WORD = "할인|적립|세일|쿠폰|페이백|캐시백|인하|특가|환급|싸|저렴|off";
// "5000에서 6000mAh"처럼 범위 뒤에 오는 사양 단위. 뒤에 영문이 더 오면(won) 단위가 아니다.
const SPEC_UNIT = "(?:mah|dpi|[kmg]?hz|w|v|mm|cm|kg|g|ml|l|rpm|nits?|lux|lm|mp|db|와트|헤르츠|시간|분|초|화소)(?![a-z])";

// 비교 전에 NFKC로 정규화한다(전각 숫자·기호 ２９，０００원, １０％ 를 반각으로).
const FORBIDDEN: readonly RegExp[] = [
  // 금액: 숫자 + 원·달러·유로. 단위가 숫자 뒤에 오는 통화(199불, 1990엔)도 건다.
  /\d\s*(?:원(?!칙|색|소|하)|만\s?원(?!하)|천\s?원(?!하)|억|달러|위안|유로)/,
  /\d\s*(?:불|엔)(?=$|[^가-힣]|이|은|는|에|로|짜리|도|입)/,
  // 단위 없는 금액: 천 단위 쉼표 숫자(19,900), 1만 9900, 3.9만
  // 쉼표 숫자 뒤에 단위(5,000mAh, 20,000Hz, 3,000개)가 오면 금액이 아니다.
  // 리뷰·후기·평가·판매량 바로 뒤의 수(리뷰 1,234)는 금액이 아니다.
  new RegExp(`(?<![\\d,])(?<!${REVIEW_BEFORE})\\d{1,3}(?:,\\d{3})+(?!\\s?(?:mah|[kmg]?hz|mp|dpi|rpm|nits?|lux|lm|mm|cm|kg|ml|[a-z]|개|명|회|장|시간|분|번|건|곡))`, "i"),
  // 숫자 만 (10만 화소, 3만 명은 금액이 아니다)
  // "1만 이상의 후기"처럼 뒤에 후기·리뷰·판매 낱말이 오거나 앞에 리뷰·판매량이 있으면 사람 수·횟수다.
  new RegExp(`(?<!${REVIEW_BEFORE})\\d\\s*만(?!큼|약|일|들|족|나|지|두|\\s?(?:화소|픽셀|명|개|장|회|번|건|대|곡|시간|분|년|배|km|mm|mah|hz)|\\s?(?:이상|이하|넘는|넘게|가까운)?\\s?(?:의\\s?)?(?:후기|리뷰|평가|판매|구매자|조회|팔로워))`, "i"),
  // 쉼표 없는 큰 숫자 + 금액 어미(19900에 팔아요, 19900이에요, 19900 정도예요). 기종 번호(WH-1000XM4, 5000mAh)와
  // 단위가 바로 붙는 수(리뷰 1200개, 35시간)는 뒤에 어미가 없어 걸리지 않는다.
  // 연도 모양(1990, 2024)은 뒤에 년·년도가 올 때만 뺀다. 다만 "2024에 나왔어요"처럼 에 뒤가 출시 이야기면 통과시킨다.
  // "5000에서 6000mAh 사이"처럼 에서 뒤에 숫자+단위가 오는 범위 표현은 사양이다(20000에서 시작해요는 금액이다).
  new RegExp(`(?<![A-Za-z0-9.,-])(?<!${SPEC_BEFORE})(?!(?:19|20)\\d\\d(?!\\d))\\d{4,}(?![A-Za-z0-9-])\\s*(?:에(?!서\\s*\\d[\\d,.]*\\s*(?:[가-힣]{1,3}\\s*)?${SPEC_UNIT})|짜리|이면|이에요|이예요|예요|입니다|이야|이고|이라|이네|이죠|정도|쯤|내외|안팎|가량|대|밖에|부터)`, "i"),
  new RegExp(`(?<![A-Za-z0-9.,-])(?<!${SPEC_BEFORE})(?:19|20)\\d\\d(?![A-Za-z0-9-])(?!\\s?년)\\s*(?:에(?!서|\\s*(?:나[왔온와]|출시|발매|발표|공개|만들|생산|등장|처음|시작|설립|창업))|짜리|이면|이에요|이예요|예요|입니다|이야|이고|이라|이네|이죠|정도|쯤|내외|안팎|가량|밖에)`),
  // 가격·할인 낱말 바로 뒤 큰 숫자: 할인해서 15900, 값은 19900. 단위가 붙은 수(쿠폰 1200명)와 연도(2024년)는 뺀다.
  /(?:할인|세일|특가|인하|쿠폰|적립|가격|값|비용|금액|최저|정가|시세)[가-힣\s]{0,6}?약?\s*(?<![A-Za-z0-9.,-])\d{4,}(?![A-Za-z0-9-])(?!\s?(?:년|개|명|회|장|시간|분|번|건|곡|세|화소|픽셀|배))/,
  // 한글 숫자 금액: 삼만 원, 오만원대, 만원대, 천원짜리, 만 원이에요
  // 한글 앞글자가 붙은 만(블루투스만 원하시면, 만원권)은 낱말이라 뺀다. 수만 원, 몇천 원은 금액이다.
  // 뒤에 한글이 바로 붙으면 "만 원하시면"(원하다)일 수 있어 금액 어미가 올 때만 건다.
  /(?:(?<![가-힣])|(?<=[수몇]))[일이삼사오육칠팔구십백천만억]*[십백천만억]\s?원(?:(?![가-힣])|(?=이|짜|대|정도|쯤|씩|에|을|를|은|는|도|입|안|밖|내|부터|까지|으로|가|선))/,
  // 퍼센트는 할인·적립 같은 돈 낱말이 앞뒤 6자 안에 있을 때만 건다(배터리 80% 충전, 습도 50%, 효율 95%는 통과).
  // 프로는 단독 숫자 바로 뒤일 때만(에어팟 프로, 버즈2프로, 아이폰15프로는 통과)
  new RegExp(`(?:${MONEY_WORD})[^\\n]{0,6}\\d\\s*(?:%|퍼센트|percent)|\\d\\s*(?:%|퍼센트|percent)[^\\n]{0,6}(?:${MONEY_WORD})`, "i"),
  // 10퍼 할인, 10퍼예요(퍼즐 같은 낱말은 뺀다)
  /(?<![가-힣A-Za-z\d.])\d{1,3}\s?퍼(?=$|[\s.,!?]|가|를|는|은|예|이에요|야|로|에|도|만|쯤|씩)/,
  /(?<![가-힣A-Za-z\d.])\d{1,3}\s?프로\s*(?:할인|적립|쿠폰|페이백|세일)|(?<![가-힣A-Za-z\d.])\d{1,3}프로(?=$|[\s.,!?]|가|를|는|은|예|이에요|야)/,
  // 한글 숫자 퍼센트: 삼십 프로 할인, 오 프로 적립, 이십 퍼센트
  /[일이삼사오육칠팔구십백]*[십백][일이삼사오육칠팔구]?\s?(?:프로|퍼센트)(?![가-힣])/,
  /[일이삼사오육칠팔구십백]+\s?퍼센트|[일이삼사오육칠팔구십백]+\s?프로\s*(?:할인|적립|쿠폰|페이백|세일)/,
  // 통화 기호·영문: $199, 39,000₩, 19,900 won
  /[$₩€¥£]\s?\d/,
  /\d\s*(?:[$₩€¥£]|won|usd|krw|eur|jpy)(?![A-Za-z])/i,
  // 영문 통화: USD 199, 199 dollars, 29.99 euros, price is 199
  /\b(?:usd|krw|eur|jpy)\s*\d/i,
  /\d\s*(?:dollars?|euros?|yen|bucks)\b/i,
  /\bprice\s*(?:is|of|:)?\s*[$₩€¥£]?\d/i,
  // 가격 낱말 뒤 숫자: 가격은 19900, 정상가 39,000
  /(?:가격|정상가|판매가|최저가|특가|할인가|정가|세일가|시세)\s*(?:은|는|이|가|도|:)?\s*약?\s*\d/,
  /최저가|할인가|특가|판매가|정가|세일가|쿠폰가|회원가|공식가|행사가|출고가/,
  // 재고·판매 상태
  /재고\s*(?:[:：]|가|는|도|이|를|을|상태|수량|량|현황|있|없|남|부족|충분|넉넉|양호|보유|확보|소진|거의|\d|많|적|얼마|조금|약간|별로|바닥)/,
  /품절|매진|완판|솔드\s?아웃|재입고|입고\s?(?:예정|완료|지연)/,
  /(?:남은|잔여)\s*(?:수량|재고)|수량\s*한정/,
  // 구매 가능 여부·가능한지는 방법을 묻는 말이라 통과한다.
  /(?:구입|구매|주문)(?:이|가|도|를|은|는)?\s*가능(?!\s*(?:여부|한지|성))/,
  /판매\s*(?:중|종료|완료)/,
  /\b(?:sold[\s-]?out|in[\s-]?stock|out[\s-]?of[\s-]?stock)\b/i,
  // 할인 행사: 반값, 1+1
  // 6+6시간, 2+1단계처럼 단위가 붙은 합은 행사가 아니다.
  /반값|(?<![\d.])\d\s?\+\s?\d(?![\d.]|\s?(?:시간|분|일|개월|년|세대|단계|채널|인치|배|gb|tb|mm|cm))/i,
];

/** 가격·재고·할인 금액처럼 보이는 표현이 있나(전각 글자는 반각으로 바꿔 본다). */
export function hasForbidden(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return FORBIDDEN.some((pattern) => pattern.test(normalized));
}

// ---- 자료에 없는 기종 이름 -------------------------------------------------------------
// 영문+숫자로 된 기종 모양 토큰(WH-1000XM5, QC45, LH-200)이 자료(기종, 대안, 봉사자가 쓴 글, 요청)에 없으면
// AI가 지어냈거나 다른 제품을 끌어온 것이므로 그 문장을 버린다.

const MODEL_TOKEN = /(?<![A-Za-z0-9])(?:[A-Za-z]{1,6}-?\d{2,}[A-Za-z0-9-]*|[A-Za-z]+-[A-Za-z0-9-]*\d[A-Za-z0-9-]*)/g;
const compact = (value: string) => value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9가-힣]/g, "");

/** 글에서 기종 모양 토큰을 뽑는다. */
export function modelTokens(text: string): string[] {
  return text.normalize("NFKC").match(MODEL_TOKEN) ?? [];
}

/** 글에 든 기종 모양 토큰 가운데 자료에 없는 것. */
export function unknownModelTokens(text: string, material: readonly string[]): string[] {
  const known = compact(material.join(" "));
  return modelTokens(text).filter((token) => !known.includes(compact(token)));
}

const hasUnknownModel = (text: string, material: readonly string[] | undefined) =>
  material !== undefined && unknownModelTokens(text, material).length > 0;

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** 줄 단위로, 줄 안에서는 문장 단위로 버릴 문장을 걸러 낸다. 남은 글이 없으면 빈 글자. */
function dropSentences(text: string, drop: (sentence: string) => boolean): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/(?<=[.!?。])\s+/)
        .filter((sentence) => !drop(sentence))
        .join(" ")
        .trim(),
    )
    .filter((line) => line !== "")
    .join("\n");
}

/** 금지 표현이 든 문장을 버린다. */
export function dropForbiddenSentences(text: string): string {
  return dropSentences(text, hasForbidden);
}

/**
 * 주소 비교용 키: 호스트(소문자, 앞 www. 제외)+경로(끝 슬래시 제외)+쿼리(utm_* 등 추적 값 제외).
 * 프로토콜과 # 뒤는 무시한다. https가 아니면 null.
 */
export function urlKey(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    const kept = [...url.searchParams].filter(([name]) => !/^(?:utm_.*|fbclid|gclid|srsltid)$/i.test(name));
    const query = kept.length ? `?${kept.map(([name, val]) => `${name}=${val}`).join("&")}` : "";
    return `${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${query}`;
  } catch {
    return null;
  }
}

/** 검색 결과(소스·인용)에 나온 주소: 비교 키 → 검색 결과에 있던 그대로의 주소. */
export type AllowedUrls = ReadonlyMap<string, string>;

const asObjects = (raw: unknown): Record<string, unknown>[] =>
  Array.isArray(raw)
    ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];

/** 모델이 낸 배열의 객체 칸 수(검사 전 개수). 로그에 숫자만 남기는 데 쓴다. */
export function countObjects(raw: unknown): number {
  return asObjects(raw).length;
}

/**
 * 기종·대안 후보. 출처 주소가 allowed(검색 결과)에 있는 것만, 이름에 금지 표현이 없는 것만 남긴다. 최대 5개.
 * 화면에 보내는 주소는 검색 결과에 있던 주소다. 이미 앞 후보가 쓴 주소(분류 페이지 하나로 몰린 경우)는
 * 그 기종의 페이지가 아니므로 첫 후보만 주소를 갖고 나머지는 주소 없이(url null) 남긴다.
 * exclude는 후보에서 뺄 이름(대안 후보에서 이미 정한 기종).
 */
export function cleanItems(raw: unknown, allowed: AllowedUrls, exclude?: string): ResearchItem[] {
  const seen = new Set<string>(exclude ? [exclude.trim().toLowerCase()] : []);
  const usedUrls = new Set<string>();
  const items: ResearchItem[] = [];
  for (const entry of asObjects(raw)) {
    if (items.length >= RESEARCH_LIMITS.maxItems) break;
    const name = typeof entry.name === "string" ? oneLine(entry.name) : "";
    const key = typeof entry.url === "string" ? urlKey(entry.url) : null;
    if (name.length < 2 || [...name].length > RESEARCH_LIMITS.nameMax || hasForbidden(name)) continue;
    const source = key === null ? undefined : allowed.get(key);
    if (key === null || source === undefined || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const note = typeof entry.note === "string" ? oneLine(entry.note) : "";
    const shared = usedUrls.has(key);
    usedUrls.add(key);
    items.push({
      name,
      note: note === "" || hasForbidden(note) ? "" : clip(note, RESEARCH_LIMITS.noteMax),
      url: shared ? null : source,
      origin: "web",
    });
  }
  return items;
}

/** 링크. 출처 주소가 allowed에 있는 것만(화면에는 검색 결과의 주소). 제목이 비었거나 금지 표현이 있으면 도메인 이름으로 바꾼다. 최대 4개. */
export function cleanLinks(raw: unknown, allowed: AllowedUrls): ResearchLink[] {
  const seen = new Set<string>();
  const links: ResearchLink[] = [];
  for (const entry of asObjects(raw)) {
    if (links.length >= RESEARCH_LIMITS.maxLinks) break;
    const key = typeof entry.url === "string" ? urlKey(entry.url) : null;
    const url = key === null ? undefined : allowed.get(key);
    if (key === null || url === undefined || seen.has(key)) continue;
    seen.add(key);
    const title = typeof entry.title === "string" ? oneLine(entry.title) : "";
    const safe = title === "" || hasForbidden(title) || [...title].length > RESEARCH_LIMITS.nameMax;
    links.push({ title: safe ? siteNameOf(url) : title, url, origin: "web" });
  }
  return links;
}

/**
 * 짧은 줄 목록(힌트·읽은 내용). 금지 표현이 든 줄은 버리고 긴 줄은 자른다.
 * material을 주면 자료에 없는 기종 이름이 든 줄도 버린다.
 */
export function cleanLines(
  raw: unknown,
  maxCount: number,
  maxLength: number,
  material?: readonly string[],
): string[] {
  if (!Array.isArray(raw)) return [];
  const lines: string[] = [];
  for (const entry of raw) {
    if (lines.length >= maxCount) break;
    const text = typeof entry === "string" ? oneLine(entry) : "";
    if (text === "" || hasForbidden(text) || hasUnknownModel(text, material) || lines.includes(text)) continue;
    lines.push(clip(text, maxLength));
  }
  return lines;
}

/**
 * AI 질문 문장. 길이·금지 표현을 넘거나, mustInclude(기종·대안 이름)가 하나라도 빠졌거나,
 * 자료에 없는 기종 이름이 들었으면 기본 문구를 쓴다.
 * 대안 이름이 질문에 그대로 들어 있어야 AI가 없는 제품을 지어내지 못한다.
 */
export function cleanQuestion(
  raw: unknown,
  fallback: string,
  mustInclude: readonly string[] = [],
  material?: readonly string[],
): string {
  const text = typeof raw === "string" ? oneLine(raw) : "";
  if (text === "" || [...text].length > RESEARCH_LIMITS.questionMax || hasForbidden(text)) return fallback;
  if (hasUnknownModel(text, material)) return fallback;
  const lower = text.toLowerCase();
  return mustInclude.every((name) => lower.includes(name.trim().toLowerCase())) ? text : fallback;
}

/**
 * 긴 글(사진 설명·핵심 정리). 금지 표현이 든 문장을 버리고 max자로 자른다. 줄바꿈은 남긴다.
 * material을 주면 자료에 없는 기종 이름이 든 문장도 버린다.
 */
export function cleanText(raw: unknown, max: number, material?: readonly string[]): string {
  if (typeof raw !== "string") return "";
  const kept = dropSentences(raw.trim(), (sentence) => hasForbidden(sentence) || hasUnknownModel(sentence, material));
  return clip(kept, max);
}
