/**
 * OpenAI 대시보드 Logs(platform.openai.com/logs)에 이 호출을 남길지. 서버 전용.
 * 이용자 요청(2026-11-17): 리서치 챗 꼬리 질문(turn)과 리뷰 문단(review) 호출을 대시보드에서 보고 싶다 → 기본으로 남긴다.
 * 남기면 OpenAI가 요청·응답 글을 보관한다(대시보드 기본 보관 기간을 따른다). 끄려면 환경 변수 OPENAI_STORE_LOGS=off.
 * metadata의 feature로 대시보드에서 호출 종류를 거를 수 있다(값에 이용자·봉사자 정보를 넣지 않는다).
 */
export type OpenAiLogFeature = "research_turn" | "research_ask" | "research_review";

export function openAiLog(feature: OpenAiLogFeature): { store: boolean; metadata?: Record<string, string> } {
  if (process.env.OPENAI_STORE_LOGS?.trim().toLowerCase() === "off") return { store: false };
  return { store: true, metadata: { app: "lighthouse", feature } };
}
