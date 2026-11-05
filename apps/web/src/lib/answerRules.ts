// 챗봇 답변 자동 검사(시험 전용). TSD §10, .claude/rules/chatbot-quality.md.
// 자동 규칙은 놓칠 수 있으므로 Codex가 답변 원문도 함께 본다.

export const REQUIRED_SECTIONS = ["검색어:", "확인할 조건:", "찾는 순서:"];

export type AnswerViolation =
  | { rule: "section"; detail: string }
  | { rule: "price"; detail: string }
  | { rule: "stock"; detail: string }
  | { rule: "model"; detail: string };

/**
 * 숫자 뒤의 원, 만원, 달러, $. 번호 목록의 "1. 원하는"을 금액으로 잡지 않도록
 * 숫자와 원 사이에는 공백만 허용하고 "원하는", "원래" 같은 낱말은 뺀다.
 */
const PRICE_PATTERNS = [
  /\d\s*(?:[십백천]\s*)?(?:만\s*)?(?:[십백천]\s*)?원(?![하래인본단형리산])/g,
  /\d\s*달러/g,
  /\d\s*\$|\$\s*\d/g,
  /[일이삼사오육칠팔구십백천]\s*만\s*원(?![하래인본단형리산])/g,
  /(?:^|[^가-힣])만\s*원(?![하래인본단형리산])/gm,
];
const STOCK_PATTERN = /재고가 있|재고가 없|품절입니다|개 남/g;
const MODEL_PATTERN = /[A-Za-z]{2,}[-\s]?\d{3,}/g;

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0].trim());
}

/** 세 항목이 줄 맨 앞에 순서대로 있고 내용이 비어 있지 않아야 한다. */
function sectionViolations(answer: string): AnswerViolation[] {
  const starts = REQUIRED_SECTIONS.map((section) =>
    answer.search(new RegExp(`^${section}`, "m")),
  );
  const violations: AnswerViolation[] = [];

  REQUIRED_SECTIONS.forEach((section, index) => {
    if (starts[index] < 0) {
      violations.push({ rule: "section", detail: `${section} 없음` });
      return;
    }
    const later = starts.slice(index + 1).filter((start) => start >= 0);
    if (later.some((start) => start < starts[index])) {
      violations.push({ rule: "section", detail: `${section} 순서 틀림` });
    }
    const bodyStart = starts[index] + section.length;
    const nextStart = Math.min(
      answer.length,
      ...starts.filter((start) => start > starts[index]),
    );
    if (!answer.slice(bodyStart, nextStart).trim()) {
      violations.push({ rule: "section", detail: `${section} 내용 없음` });
    }
  });
  return violations;
}

export function checkAnswer(answer: string): AnswerViolation[] {
  return [
    ...sectionViolations(answer),
    ...PRICE_PATTERNS.flatMap((pattern) => matches(answer, pattern)).map(
      (detail): AnswerViolation => ({ rule: "price", detail }),
    ),
    ...matches(answer, STOCK_PATTERN).map(
      (detail): AnswerViolation => ({ rule: "stock", detail }),
    ),
    ...matches(answer, MODEL_PATTERN).map(
      (detail): AnswerViolation => ({ rule: "model", detail }),
    ),
  ];
}
