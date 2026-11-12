import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExtractEngine } from "@/lib/extract";

function clearKeys() {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("UPSTAGE_API_KEY", "");
  vi.stubEnv("EXTRACT_MODE", "");
  vi.stubEnv("LLM_MODE", "");
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

  it("OpenAI 키가 있으면 OpenAI, 없으면 null이다(Upstage 키는 사진 설명에 쓰이지 않는다)", () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    vi.stubEnv("UPSTAGE_API_KEY", "fake-upstage");
    expect(getExtractEngine()).toBe("openai");
    vi.stubEnv("OPENAI_API_KEY", "  ");
    expect(getExtractEngine()).toBeNull();
  });

  it("LLM_MODE=mock이면 사진 설명도 가짜라 mock이다", () => {
    vi.stubEnv("LLM_MODE", "mock");
    expect(getExtractEngine()).toBe("mock");
  });
});
