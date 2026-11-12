import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExtractEngine } from "@/lib/extract";

function clearKeys() {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("UPSTAGE_API_KEY", "");
  vi.stubEnv("EXTRACT_MODE", "");
  vi.stubEnv("VERCEL_ENV", "");
}

describe("getExtractEngine", () => {
  beforeEach(clearKeys);
  afterEach(() => vi.unstubAllEnvs());

  it("EXTRACT_MODE=mock이면 mock이다", () => {
    vi.stubEnv("EXTRACT_MODE", "mock");
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    expect(getExtractEngine()).toBe("mock");
  });

  it("운영 환경에서는 EXTRACT_MODE=mock을 무시한다", () => {
    vi.stubEnv("EXTRACT_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getExtractEngine()).toBeNull();
  });

  it("키가 둘 다 있으면 OpenAI, Upstage만 있으면 Upstage, 없으면 null이다", () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    vi.stubEnv("UPSTAGE_API_KEY", "fake-upstage");
    expect(getExtractEngine()).toBe("openai");
    vi.stubEnv("OPENAI_API_KEY", "  ");
    expect(getExtractEngine()).toBe("upstage");
    vi.stubEnv("UPSTAGE_API_KEY", "");
    expect(getExtractEngine()).toBeNull();
  });
});
