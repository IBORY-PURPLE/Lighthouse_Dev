import { urlKey } from "@/lib/researchCheck";
import {
  benefitMessages,
  isAiClosedHost,
  productsMessages,
  type BenefitGroup,
  type ProductItem,
  type SearchRun,
} from "@/lib/researchSearch";
import { textViolations, type Violation } from "./researchJudge";

// 같이 고민한 제품 목록·혜택 1회차(researchSearch.ts)의 응답 판정. 실제 호출 시험(tests/chatbot/research-ai.test.ts)이 쓴다.
// 가격·재고·할인 표현은 researchJudge.ts의 독립 의심 목록(textViolations)으로 보고, 주소·링크 상태·메시지 크기를 더 본다.
// 제품 코드가 아니다.

const MESSAGE_BYTES_MAX = 8192;
const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * 혜택 글 전용 독립 의심 목록(서버 hasBenefitForbidden과 따로 가진다). 혜택 카드는 종류와 조건만 말하므로
 * 퍼센트 기호는 낱말과 상관없이 모두, 천·만 단위 수와 포인트 수량도 의심한다. 전화번호·이메일·메신저 연락처도 본다.
 */
const BENEFIT_SUSPECT: ReadonlyArray<readonly [string, RegExp]> = [
  ["혜택 글의 퍼센트", /[%％]|퍼센트|percent/i],
  ["혜택 글의 프로 수", /(?:\d|(?<![가-힣])[일이삼사오육칠팔구]?[십백][일이삼사오육칠팔구]?)\s?프로(?!모|그|젝|필|세)/],
  ["혜택 글의 천·만 단위 수", /\d\s*[천만]/],
  ["혜택 글의 포인트 수량", /\d[\d,.]*\s*(?:p(?![a-z])|포인트)|(?<![가-힣])[일이삼사오육칠팔구]?[십백천만][일이삼사오육칠팔구십백천만]*\s?(?:p(?![a-z])|포인트)/i],
  // 한글 수사(오·십·이십·하나·두 …) 바로 뒤의 프로·퍼센트·퍼·포인트·P·원. 숫자 한 글자("오 프로 혜택", "오 포인트 적립")도 수량이다.
  [
    "혜택 글의 한글 수사 단위",
    /(?<![가-힣])(?:[일이삼사오육칠팔구십백천만억]+|하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|열)\s?(?:프로(?![모그젝필세])|퍼센트|퍼(?![가-힣])|포인트|p(?![a-z])|원(?![가-힣]|칙|색|소))/i,
  ],
  ["혜택 글의 포인트 뒤 수량", /포인트\s?(?:약\s?)?(?:\d|[일이삼사오육칠팔구]?[십백천만억][일이삼사오육칠팔구십백천만억]*(?![가-힣]))/],
  ["연락처", /(?<!\d)0\d{1,2}[\s.)-]+\d{3,4}[\s.-]+\d{4}(?!\d)|(?<!\d)01\d[\s.-]?\d{7,8}(?!\d)|[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}|카카오\s?톡|카톡|오픈\s?채팅|텔레그램|open\.kakao/i],
];

/** 혜택 카드 글 하나의 판정: 일반 의심 목록에 혜택 전용 목록을 더한다. */
export function benefitTextViolations(field: string, raw: string): Violation[] {
  const found = textViolations(field, raw);
  const text = raw.normalize("NFKC");
  for (const [rule, pattern] of BENEFIT_SUSPECT) {
    const match = pattern.exec(text);
    if (match) found.push({ rule, field, snippet: text.slice(Math.max(0, match.index - 10), match.index + match[0].length + 20).replace(/\s+/g, " ") });
  }
  return found;
}

/** 주소가 https이고 검색 결과(인용·소스)에 있던 것인가. */
function urlViolations(field: string, value: string, citations: readonly string[]): Violation[] {
  const key = urlKey(value);
  if (!/^https:\/\//i.test(value) || key === null) return [{ rule: "https가 아닌 주소", field, snippet: value.slice(0, 40) }];
  if (!citations.some((cited) => urlKey(cited) === key)) {
    return [{ rule: "인용에 없는 주소", field, snippet: value.slice(0, 40) }];
  }
  return [];
}

/** 제품 목록 판정: 가격·재고 표현 0, 주소는 인용에 있음(비어 있으면 통과), 3~5개(AI 응답일 때). 없는 기종 이름은 서버 검사가 거른다. */
export function judgeProducts(run: SearchRun<ProductItem[]>): Violation[] {
  const violations: Violation[] = [];
  const fixed = run.ai === "fallback";
  run.data.forEach((item, index) => {
    violations.push(...textViolations(`items[${index}].name`, item.name));
    violations.push(...textViolations(`items[${index}].feature`, item.feature));
    // 고정 후보는 확인된 제품 페이지가 없으므로 pageUrl이 없어야 한다(만든 쇼핑몰 검색 주소를 [공식 페이지]로 보이면 안 된다).
    if (fixed && item.pageUrl !== null) {
      violations.push({ rule: "고정 후보 pageUrl", field: `items[${index}].pageUrl`, snippet: String(item.pageUrl).slice(0, 40) });
    }
    // AI 응답의 제품은 검색 결과에 있던 주소를 가져야 한다.
    if (!fixed) {
      if (item.pageUrl === null || item.pageUrl === "") {
        violations.push({ rule: "제품 주소 없음", field: `items[${index}].pageUrl`, snippet: "" });
      } else {
        violations.push(...urlViolations(`items[${index}].pageUrl`, item.pageUrl, run.citations));
      }
    }
  });
  if (run.ai === "ok" && (run.data.length < 1 || run.data.length > 5)) {
    violations.push({ rule: "제품 수", field: "items", snippet: String(run.data.length) });
  }
  for (const message of productsMessages(run.data, run.ai)) {
    if (bytesOf(message.body) > MESSAGE_BYTES_MAX) violations.push({ rule: "메시지 크기", field: "body", snippet: String(bytesOf(message.body)) });
  }
  return violations;
}

/** 혜택 판정: 금액·할인율·최저가 0, 링크는 인용에 있음, 링크 상태(열 수 없는 곳이면 check), 메시지는 8,192바이트 안. */
export function judgeBenefits(run: SearchRun<BenefitGroup[]>, request: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const group of run.data) {
    if (group.items.length > 3) violations.push({ rule: "갈래당 항목 수", field: group.branch, snippet: String(group.items.length) });
    group.items.forEach((item, index) => {
      const field = `${group.branch}[${index}]`;
      for (const key of ["title", "kind", "condition", "compare"] as const) {
        violations.push(...benefitTextViolations(`${field}.${key}`, item[key]));
      }
      violations.push(...urlViolations(`${field}.url`, item.url, run.citations));
      const key = urlKey(item.url);
      if (key !== null && seen.has(key)) violations.push({ rule: "같은 주소가 두 번", field: `${field}.url`, snippet: item.url.slice(0, 40) });
      if (key !== null) seen.add(key);
      const expected = isAiClosedHost(item.url) ? "check" : "ai";
      if (item.mode !== expected) violations.push({ rule: "링크 상태", field: `${field}.mode`, snippet: `${item.mode}≠${expected}` });
      if (item.compare.trim() === "") violations.push({ rule: "비교 줄이 비었음", field: `${field}.compare`, snippet: "" });
    });
  }
  const experience = typeof request.experience === "string" ? request.experience : "";
  for (const message of benefitMessages(run.data, experience, "소니 헤드셋", run.ai)) {
    if (bytesOf(message.body) > MESSAGE_BYTES_MAX) violations.push({ rule: "메시지 크기", field: "body", snippet: String(bytesOf(message.body)) });
    const headline = typeof message.body.headline === "string" ? message.body.headline : "";
    violations.push(...benefitTextViolations("headline", headline));
  }
  return violations;
}
