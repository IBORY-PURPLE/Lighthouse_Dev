import type { ChatTurn } from "@/lib/converse";

// 시험용 가짜 AI 대화(LLM_MODE=mock). 이용자 문장 수로 단계를 정한다: 상품 → 예산 → 새 제품/중고 → 확인 → 동의.
// 실제 모델이 내는 것과 같은 JSON 글을 돌려주므로 서버의 해석·검사 경로를 그대로 지난다.

const CONSENT = /네|예|응|좋아|맞아|등록/;

export function mockConverseText(turns: ChatTurn[]): string {
  const said = turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const [product = "", budget = "", condition = ""] = said;
  const fields = { product, budget, condition };

  if (said.length === 0) {
    return JSON.stringify({ reply: "어떤 제품을 찾으세요?", status: "asking", ...fields });
  }
  if (said.length === 1) {
    return JSON.stringify({ reply: "예산은 얼마인가요?", status: "asking", ...fields });
  }
  if (said.length === 2) {
    return JSON.stringify({
      reply: "새 제품과 중고 중 무엇을 원하세요?",
      status: "asking",
      ...fields,
    });
  }
  const confirm = (lead: string) =>
    JSON.stringify({
      reply: `${lead}${product}, 예산 ${budget}, ${condition}. 이 내용으로 구매 요청을 등록할까요?`,
      status: "confirming",
      ...fields,
    });
  if (said.length === 3) return confirm("");
  if (CONSENT.test(said[said.length - 1])) {
    return JSON.stringify({ reply: "요청을 등록합니다.", status: "done", ...fields });
  }
  return confirm("고쳐서 다시 확인합니다. ");
}
