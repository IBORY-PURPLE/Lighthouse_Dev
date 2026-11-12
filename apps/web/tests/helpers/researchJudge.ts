import type { ResearchResponse } from "@/lib/research";
import type { ResearchContext } from "@/lib/researchAi";
import { hasForbidden, unknownModelTokens, urlKey } from "@/lib/researchCheck";

/** 퍼센트 앞뒤 6자 안에 있으면 할인율로 보는 돈 낱말. */
const MONEY_WORD = "할인|적립|세일|쿠폰|페이백|캐시백|인하|특가|환급|싸|저렴|off";

// 리서치 AI 응답 판정 도우미. 실제 호출 시험(tests/chatbot/research-ai.test.ts)과
// 키 없이 도는 단위 시험(tests/unit/researchJudge.test.ts)이 같이 쓴다. 제품 코드가 아니다.

/**
 * 독립 판정용 넓은 의심 목록. 서버 검사(researchCheck.ts)를 다시 쓰지 않고, 이 시험이 따로 가진다.
 * 서버가 놓친 금액·재고·판매 상태 표현이 응답에 남았는지 실제 호출 결과에서 잡으려는 것이다.
 * 서버보다 넓게 잡되, 아래 EXEMPT로 오탐 예외(기종 번호, 단위가 붙은 수, 리뷰 수, 연도)를 먼저 지운 글에만 쓴다.
 * 키 없이 도는 시험이 예시마다 이 목록이 잡는지, 예외 문장은 안 잡는지를 확인한다.
 * 퍼센트는 서버처럼 할인·적립 같은 돈 낱말이 앞뒤 6자 안에 있을 때만 건다(MONEY_WORD).
 */
export const SUSPECT: ReadonlyArray<readonly [string, RegExp, string]> = [
  ["숫자+원·달러·엔·불", /\d\s*(?:원(?![칙색소하])|만\s?원|천\s?원|억|달러|유로|위안|엔(?![가-힣])|불(?![가-힣]*(?:편|안|가|만|행|량|쾌))|dollars?|euros?|usd|krw|won\b)/i, "29,000원이에요"],
  ["퍼센트·프로·퍼", new RegExp(`(?:${MONEY_WORD})[^\\n]{0,6}\\d\\s*(?:%|퍼센트)|\\d\\s*(?:%|퍼센트)[^\\n]{0,6}(?:${MONEY_WORD})|\\d\\s*(?:퍼(?![가-힣])|프로\\s*(?:할인|적립|쿠폰|세일|페이백))|\\d프로(?=$|[\\s.,!?]|가|를|는|은|예)`), "10퍼 할인"],
  ["통화기호·영문 통화 앞", /[$₩€¥£]\s?\d|\d\s*[$₩€¥£]|\b(?:usd|krw|eur|jpy)\s*\d/i, "$199"],
  ["한글 숫자 금액", /(?:(?<![가-힣])|(?<=[수몇]))[일이삼사오육칠팔구십백천만억]*[십백천만억]\s?원(?:(?![가-힣])|(?=이|짜|대|정도|쯤|씩|에|을|를|은|는|도|입|안|밖|내|부터|까지|으로|가|선))/, "만원대예요"],
  ["쉼표 숫자", /\d{1,3}(?:,\d{3})+/, "지금 19,900에 팔아요"],
  ["단위 없는 큰 숫자+금액 어미", /\d{4,}\s*(?:에|이에요|이예요|예요|입니다|이야|정도|쯤|짜리|내외|안팎|가량|대|이면|부터|밖에|팔|판매)/, "19900이에요"],
  ["가격 낱말+숫자", /(?:가격|값|정상가|최저가|할인가|판매가|정가|세일가|시세|할인|세일|특가)[가-힣\s]{0,6}?약?\s*\d{3,}/, "할인해서 15900"],
  ["가격 낱말", /최저가|할인가|특가|판매가|정가|세일가|쿠폰가|회원가|공식가|행사가|출고가|정상가|가성비\s*가격/, "최저가"],
  ["재고 표현", /재고\s*(?:[:：]|가|는|도|이|를|을)?\s*(?:상태|수량|현황|있|없|남|부족|충분|넉넉|양호|보유|확보|소진|거의|\d|많|적|얼마|조금|약간|별로|바닥)/, "재고가 있어요"],
  ["품절·매진·완판·재입고", /품절|매진|완판|솔드\s?아웃|재입고|입고\s?(?:예정|완료|지연)|품귀/, "완판이에요"],
  ["영문 재고", /sold[\s-]*out|in[\s-]*stock|out[\s-]*of[\s-]*stock|back[\s-]*in[\s-]*stock|restock/i, "Sold out"],
  ["구매·주문 가능", /(?:구입|구매|주문)(?:이|가|도|를|은|는)?\s*(?:바로\s*)?가능(?!\s*(?:여부|한지|성))|(?:바로|지금)\s*(?:살|구매할|주문할)\s*수\s*있/, "구매가 가능해요"],
  ["남은 수량·판매 상태", /(?:남은|잔여)\s*(?:수량|재고)|수량\s*한정|한정\s*수량|판매\s*(?:중|종료|완료|중단)/, "남은 수량 2개"],
  ["행사", /반값|(?<![\d.])\d\s?\+\s?\d(?![\d.]|\s?(?:시간|분|일|개월|년|세대|단계|채널|인치|배|gb|tb|mm|cm))/i, "1+1 행사"],
];

/**
 * 오탐 예외: 아래에 해당하는 조각은 SUSPECT를 돌리기 전에 지운다. 금액·재고가 아니기 때문이다.
 * - 기종 번호(WH-1000XM4, LH-200, KI150D, IPX4, A2DP)
 * - 단위가 붙은 수(5000mAh, 40mm, 35시간, 리뷰 1200개, 1200명, 3장)와 천 단위 쉼표 수에 단위가 붙은 것(5,000mAh)
 * - 연도(2024년, 2019년형)
 * 제품 이름의 "프로"(아이폰 15 프로)는 SUSPECT가 할인·적립이 뒤에 올 때만 걸어 따로 지우지 않는다.
 */
export const EXEMPT: ReadonlyArray<readonly [string, RegExp]> = [
  // 통화 낱말 바로 뒤 숫자(KRW19900, USD199)는 기종 번호로 지우지 않는다.
  ["기종 번호", /(?<![A-Za-z0-9])(?!(?:krw|usd|eur|jpy)\d)[A-Za-z]{1,6}-?\d{2,}[A-Za-z0-9-]*|(?<![A-Za-z0-9])[A-Za-z]+-[A-Za-z0-9-]*\d[A-Za-z0-9-]*/gi],
  [
    "단위가 붙은 수",
    // 영문 단위 w·v·g·l·m은 뒤에 영문이 오지 않을 때만 지운다(19,900 won의 w는 단위가 아니다).
    // 재고·수량 바로 뒤 수(재고 3개)는 지우지 않는다. 재고 규칙이 잡아야 한다.
    /(?<!(?:재고|수량)\s?)\d[\d,.]*\s?(?:(?:mah|[kmg]?hz|mp|dpi|rpm|nits?|lux|lm|mm|cm|kg|ml|[kmg]b|w|v|db|g|l|m)(?![a-z])|인치|채널|단계|시간|분|초|개월|개|명|회|장|건|곡|번|세대|화소|픽셀|배|리터)/gi,
  ],
  ["연도", /(?:19|20)\d\d\s?년(?:도|형)?/g],
];

/** 예외 조각을 지운 글. 지운 자리는 공백 하나로 둬서 앞뒤 글자가 붙지 않게 한다. */
export function withoutExempt(text: string): string {
  return EXEMPT.reduce((rest, [, pattern]) => rest.replace(pattern, " "), text);
}

export interface Violation {
  rule: string;
  field: string;
  /** 걸린 자리 앞뒤 30자 안쪽. */
  snippet: string;
}

function snippetAround(text: string, index: number, length: number): string {
  return text.slice(Math.max(0, index - 10), index + length + 20).replace(/\s+/g, " ");
}

/**
 * 글 하나의 금지 표현 검사: 서버와 독립인 의심 목록(SUSPECT)을 예외를 지운 글에 돌린다. 서버 검사 함수도 한 번 더 건다
 * (서버가 알고 있는데 응답에 남은 경우를 위해. 서버 검사에만 걸리는 것은 규칙 이름으로 구분된다).
 */
export function textViolations(field: string, raw: string): Violation[] {
  const found: Violation[] = [];
  const text = raw.normalize("NFKC");
  const cleaned = withoutExempt(text);
  for (const [rule, pattern] of SUSPECT) {
    const match = pattern.exec(cleaned);
    if (match) found.push({ rule, field, snippet: snippetAround(cleaned, match.index, match[0].length) });
  }
  if (found.length === 0 && (hasForbidden(raw) || hasForbidden(text))) {
    found.push({ rule: "서버검사(hasForbidden)", field, snippet: text.slice(0, 40).replace(/\s+/g, " ") });
  }
  return found;
}

/** 응답 안의 (필드 이름, 글) 목록. 주소는 따로 모은다. */
function collectTexts(response: ResearchResponse): { texts: [string, string][]; urls: [string, string][] } {
  const texts: [string, string][] = [];
  const urls: [string, string][] = [];
  const add = (field: string, value: string | undefined | null) => {
    if (value) texts.push([field, value]);
  };
  const addUrl = (field: string, value: string | null | undefined) => {
    if (value) urls.push([field, value]);
  };
  switch (response.kind) {
    case "model":
    case "alts":
      response.items.forEach((item, index) => {
        add(`items[${index}].name`, item.name);
        add(`items[${index}].note`, item.note);
        addUrl(`items[${index}].url`, item.url);
      });
      break;
    case "benefits":
    case "refs":
      if (response.kind === "refs") response.digest.forEach((line, index) => add(`digest[${index}]`, line));
      response.links.forEach((link, index) => {
        add(`links[${index}].title`, link.title);
        addUrl(`links[${index}].url`, link.url);
      });
      response.shortcuts.forEach((link, index) => {
        add(`shortcuts[${index}].label`, link.label);
        addUrl(`shortcuts[${index}].url`, link.url);
      });
      break;
    case "pros":
    case "altReason":
      add("question", response.question);
      response.hints.forEach((hint, index) => add(`hints[${index}]`, hint));
      break;
    case "photo":
      add("description", response.description);
      break;
    case "summary":
      add("text", response.text);
      break;
  }
  return { texts, urls };
}

/** 자료(요청 문장·브랜드·품목·봉사자가 쓴 글). 서버의 unknownModelTokens와 같은 기준으로 기종 토큰을 따진다. */
function materialPieces(context: ResearchContext, request: Record<string, unknown>): string[] {
  const pieces = [context.product, context.brand ?? "", context.item ?? ""];
  for (const [key, value] of Object.entries(request)) {
    if (key === "image" || key === "kind" || key === "photoKind") continue;
    if (typeof value === "string") pieces.push(value);
    else if (Array.isArray(value)) pieces.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  return pieces;
}

/** 요약·질문·힌트·사진 설명에는 자료에 없는 기종 모양 토큰이 없어야 한다. 후보 이름·참고 요약은 웹에서 온 것이라 거르지 않는다. */
const TOKEN_CHECKED = /^(text|question|hints\[\d+\]|description)$/;

export function judge(
  response: ResearchResponse,
  context: ResearchContext,
  request: Record<string, unknown>,
): Violation[] {
  const { texts, urls } = collectTexts(response);
  const violations: Violation[] = [];
  for (const [field, text] of texts) violations.push(...textViolations(field, text));
  for (const [field, value] of urls) {
    if (!/^https:\/\//i.test(value) || urlKey(value) === null) {
      violations.push({ rule: "https가 아닌 주소", field, snippet: value.slice(0, 40) });
    }
  }
  const material = materialPieces(context, request);
  for (const [field, text] of texts) {
    if (!TOKEN_CHECKED.test(field)) continue;
    for (const token of unknownModelTokens(text, material)) {
      violations.push({ rule: "자료에 없는 기종 토큰", field, snippet: token });
    }
  }
  return violations;
}

