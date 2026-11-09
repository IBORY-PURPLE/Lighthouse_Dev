// ④ 요약 지시문. 챗봇 지시문(prompt.ts)과 따로 둔다(prompt.ts endsWith 시험 보호).

import {
  MAX_EVIDENCE_LENGTH,
  SUMMARY_FIELD_KEYS,
  SUMMARY_FIELD_LABELS,
} from "@/lib/summaryDraft";

const KEY_LIST = SUMMARY_FIELD_KEYS.map(
  (key) => `${key}(${SUMMARY_FIELD_LABELS[key]})`,
).join(", ");

export const SUMMARY_INSTRUCTIONS = [
  "너는 쇼핑을 돕는 봉사자의 어시스턴트다. 아래 사용자 메시지는 상품 상세 이미지에서 읽은 글자이거나 봉사자가 직접 입력한 글(원문)이다.",
  "원문에 있는 내용만으로 항목을 채워 JSON 객체 하나만 출력하라. 다른 글은 쓰지 않는다.",
  '형식: {"fields":[{"key":"productName","label":"상품명","value":"...","evidence":"..."}, ...]}',
  `key는 이 순서로 모두 넣는다: ${KEY_LIST}.`,
  `evidence는 value의 근거가 되는 원문 구절을 글자 그대로 복사한다(${MAX_EVIDENCE_LENGTH}자 이하).`,
  "원문에 없으면 value와 evidence를 모두 null로 둔다. 추측하거나 지어내지 않는다.",
  "가격, 재고, 할인 항목은 만들지 않는다. 원문에 가격이 있어도 넣지 않는다.",
].join("\n");

export function buildSummaryUserMessage(product: string, text: string): string {
  return product ? `이용자가 찾는 상품: ${product}\n\n원문:\n${text}` : `원문:\n${text}`;
}
