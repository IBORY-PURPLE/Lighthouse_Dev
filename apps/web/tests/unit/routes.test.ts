import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as enter } from "@/app/enter/route";
import { ACCESS_COOKIE, hashAccessCode } from "@/lib/access";

const ORIGIN = "http://localhost:3000";
const FAKE_GROQ_KEY = "fake-key-value-must-not-appear";
const FAKE_OPENAI_KEY = "fake-openai-value-must-not-appear";

function healthRequest(cookie?: string) {
  return new NextRequest(`${ORIGIN}/api/health`, {
    headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : undefined,
  });
}

describe("GET /enter", () => {
  beforeEach(() => vi.stubEnv("DEMO_ACCESS_CODE", "right-code"));
  afterEach(() => vi.unstubAllEnvs());

  it("틀린 코드와 빠진 코드는 쿠키 없이 401이다", () => {
    for (const query of ["?code=wrong-code", ""]) {
      const response = enter(new NextRequest(`${ORIGIN}/enter${query}`));
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("맞는 코드는 안전한 쿠키를 주고 코드 없는 /로 303 이동한다", () => {
    const response = enter(new NextRequest(`${ORIGIN}/enter?code=right-code`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ACCESS_COOKIE}=${hashAccessCode("right-code")}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
    expect(cookie).not.toContain("right-code");
  });
});

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_CODE", "right-code");
    vi.stubEnv("GROQ_API_KEY", FAKE_GROQ_KEY);
    // 저장소 종류만 돌려준다. 시험은 메모리 저장소로 돈다.
    vi.stubEnv("STORE_MODE", "memory");
    vi.stubEnv("OPENAI_API_KEY", FAKE_OPENAI_KEY);
    vi.stubEnv("UPSTAGE_API_KEY", "");
    vi.stubEnv("EXTRACT_MODE", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("쿠키가 없거나 틀리면 401이다", async () => {
    for (const cookie of [undefined, "wrong"]) {
      const response = health(healthRequest(cookie));
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(FAKE_GROQ_KEY);
    }
  });

  it("키 존재 여부만 돌려주고 키 값은 돌려주지 않는다", async () => {
    const response = health(healthRequest(hashAccessCode("right-code")));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      groqKeyConfigured: true,
      llmMode: "live",
      store: "memory",
      extractEngine: "openai",
    });
    expect(text).not.toContain(FAKE_GROQ_KEY);
    expect(text).not.toContain(FAKE_OPENAI_KEY);
  });

  it("키가 없으면 false, LLM_MODE=mock이면 mock이다", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("EXTRACT_MODE", "mock");
    const response = health(healthRequest(hashAccessCode("right-code")));
    expect(await response.json()).toEqual({
      ok: true,
      groqKeyConfigured: false,
      llmMode: "mock",
      store: "memory",
      extractEngine: "mock",
    });
  });

  it("운영 환경에서는 LLM_MODE=mock을 무시한다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LLM_MODE", "mock");
    const response = health(healthRequest(hashAccessCode("right-code")));
    expect((await response.json()).llmMode).toBe("live");
  });

  it("글자 읽기 키가 없으면 extractEngine은 null이다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = health(healthRequest(hashAccessCode("right-code")));
    expect((await response.json()).extractEngine).toBeNull();
  });
});
