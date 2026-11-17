import { afterEach, describe, expect, it, vi } from "vitest";
import { openAiLog } from "@/lib/openaiLog";

describe("openAiLog(OpenAI 대시보드 Logs 남기기)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("기본은 남기고, 호출 종류를 metadata로 붙인다", () => {
    vi.stubEnv("OPENAI_STORE_LOGS", "");
    expect(openAiLog("research_review")).toEqual({ store: true, metadata: { app: "lighthouse", feature: "research_review" } });
  });

  it("OPENAI_STORE_LOGS=off면 남기지 않는다", () => {
    vi.stubEnv("OPENAI_STORE_LOGS", "off");
    expect(openAiLog("research_turn")).toEqual({ store: false });
  });
});
