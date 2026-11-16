import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as enter } from "@/app/enter/route";

const FAKE_GROQ_KEY = "fake-key-value-must-not-appear";
const FAKE_OPENAI_KEY = "fake-openai-value-must-not-appear";

describe("GET /enter", () => {
  it("옛 링크(/enter?code=...)는 코드를 읽지 않고 쿠키 없이 /로 303 이동한다", () => {
    const response = enter();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", FAKE_GROQ_KEY);
    // 저장소 종류만 돌려준다. 시험은 메모리 저장소로 돈다.
    vi.stubEnv("STORE_MODE", "memory");
    vi.stubEnv("OPENAI_API_KEY", FAKE_OPENAI_KEY);
    vi.stubEnv("UPSTAGE_API_KEY", "");
    vi.stubEnv("EXTRACT_MODE", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("쿠키 없이도 200이다(QA 기간에는 접근 코드가 없다)", async () => {
    const response = health();
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("키 존재 여부만 돌려주고 키 값은 돌려주지 않는다", async () => {
    const response = health();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      llmKeyConfigured: true,
      llmMode: "live",
      store: "memory",
      extractEngine: "openai",
    });
    expect(text).not.toContain(FAKE_GROQ_KEY);
    expect(text).not.toContain(FAKE_OPENAI_KEY);
  });

  it("키가 없으면 false, LLM_MODE=mock이면 mock이다", async () => {
    // 옛 GROQ_API_KEY가 남아 있어도 챗봇·요약 키로 세지 않는다.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("EXTRACT_MODE", "mock");
    const response = health();
    expect(await response.json()).toEqual({
      ok: true,
      llmKeyConfigured: false,
      llmMode: "mock",
      store: "memory",
      extractEngine: "mock",
    });
  });

  it("운영 환경에서는 LLM_MODE=mock을 무시한다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LLM_MODE", "mock");
    const response = health();
    expect((await response.json()).llmMode).toBe("live");
  });

  it("글자 읽기 키가 없으면 extractEngine은 null이다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = health();
    expect((await response.json()).extractEngine).toBeNull();
  });
});
