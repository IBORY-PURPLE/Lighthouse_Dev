import "server-only";

// /api/health가 알려 주는 글자 읽기 엔진 이름. 사진 글자 읽기·요약 라우트(extract-text, summarize)는
// 리서치 챗으로 대체되어 없어졌고, 점검용 health 응답의 extractEngine 필드(TSD §8.1)만 남아 있다.

export type ExtractEngine = "openai" | "upstage" | "mock";

const hasKey = (name: string) => Boolean(process.env[name]?.trim());

function isMockMode(): boolean {
  // *_MODE는 운영 환경에서 무시한다(TSD §5).
  return process.env.VERCEL_ENV !== "production" && process.env.EXTRACT_MODE === "mock";
}

/** 지금 쓸 글자 읽기 엔진. 없으면 null. */
export function getExtractEngine(): ExtractEngine | null {
  if (isMockMode()) return "mock";
  if (hasKey("OPENAI_API_KEY")) return "openai";
  if (hasKey("UPSTAGE_API_KEY")) return "upstage";
  return null;
}
