export type LlmMode = "mock" | "live";

export function getLlmMode(): LlmMode {
  if (process.env.VERCEL_ENV === "production") return "live";
  return process.env.LLM_MODE === "mock" ? "mock" : "live";
}
