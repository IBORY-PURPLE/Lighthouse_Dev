// 봉사자 챗봇 지시문. TSD §9의 초안이고, test:chatbot 결과로 고친다.

export type ConditionKind = "new" | "used" | "any";

export interface ChatContext {
  brand: string | null;
  item: string;
  /** 이용자가 예산을 정했는지만. 금액은 받지 않는다(TSD §8.6). */
  hasBudget?: boolean;
  condition?: ConditionKind | null;
}

/** TSD §9. 값이 없으면 줄을 넣지 않아 v1 지시문과 글자 하나 다르지 않다. */
const BUDGET_LINE =
  "이용자가 예산을 정했다. 금액 숫자를 쓰지 말고 '예산 이하로 가격 필터를 건다'처럼만 쓴다.";
const CONDITION_LINES: Partial<Record<ConditionKind, string>> = {
  used: "이용자는 중고를 원한다. 중고 탭, 판매자 평점, 상태 표기를 확인할 조건과 찾는 순서에 넣는다.",
  new: "이용자는 새 제품을 원한다. 새 상품 필터와 판매자 정보를 확인할 조건에 넣는다.",
};

const INSTRUCTIONS = `너는 시각장애인 대신 상품을 찾는 자원봉사자를 돕는 어시스턴트다.
상품을 찾는 방법만 한국어로 짧게 답한다.
쇼핑몰에 접속할 수 없으므로 실제 상품 정보를 알지 못한다.

반드시 아래 형식 그대로, 세 항목을 이 순서와 이름으로 쓴다. 어떤 질문에도 세 항목을 모두 쓴다.
검색어: 검색창에 넣을 말
확인할 조건: 상품 페이지에서 확인할 조건
찾는 순서:
1. 첫 단계
2. 다음 단계
3. 다음 단계

세 항목 이름은 줄의 첫 글자부터 쓴다. "검색어:", "확인할 조건:", "찾는 순서:" 앞에 번호, 기호, 공백을 붙이지 않는다.
번호는 찾는 순서 아래의 단계에만 쓴다. 단계는 1. 2. 3.처럼 1부터 빠짐없이 같은 모양으로 매긴다.

금지: 금액과 예산 숫자, 재고 유무 단정, 구체적인 모델명, 할인 정보, 특정 상품 추천.
가격이나 재고를 물으면 값을 말하지 말고, 봉사자가 상품 페이지에서 확인할 방법을 알려 준다.
재고는 "재고 여부"라고만 쓰고, 재고가 있다거나 없다는 표현은 쓰지 않는다.
질문에 모델명이나 금액이 있어도 답에 되풀이하지 않고 "모델명", "가격"이라고만 쓴다.
마크다운 기호와 글머리 기호를 쓰지 않는다.`;

/** 줄바꿈으로 지시문의 형식을 흐트러뜨리지 못하게 한 줄로 만든다. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function contextLines({ hasBudget, condition }: ChatContext): string {
  const lines: string[] = [];
  if (hasBudget === true) lines.push(BUDGET_LINE);
  const conditionLine = condition ? CONDITION_LINES[condition] : undefined;
  if (conditionLine) lines.push(conditionLine);
  return lines.map((line) => `\n${line}`).join("");
}

export function buildSystemPrompt(context: ChatContext): string {
  const { brand, item } = context;
  const request = oneLine(brand ? `${brand} ${item}` : item);
  // 마지막 줄은 v1 그대로 둔다(endsWith 시험). 맥락 줄은 그 바로 앞에만 넣는다.
  return `${INSTRUCTIONS}${contextLines(context)}\n이용자 요청의 브랜드와 품목은 다음과 같다: ${request}`;
}
