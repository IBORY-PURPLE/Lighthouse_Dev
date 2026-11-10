import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { VOLUNTEER_SESSION_COOKIE } from "@/lib/volunteerAuth";
import { sessionCookieHeader } from "./helpers/volunteerSession";

const ORIGIN = "http://localhost:3000";
const FAKE_GROQ_KEY = "fake-key-value-must-not-appear";

function healthRequest(cookie?: string) {
  return new NextRequest(`${ORIGIN}/api/health`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", FAKE_GROQ_KEY);
    // 저장소 종류만 돌려준다. 시험은 메모리 저장소로 돈다.
    vi.stubEnv("STORE_MODE", "memory");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("쿠키가 없거나 틀리면 401이다", async () => {
    for (const cookie of [undefined, `${VOLUNTEER_SESSION_COOKIE}=wrong`]) {
      const response = health(healthRequest(cookie));
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(FAKE_GROQ_KEY);
    }
  });

  it("키 존재 여부만 돌려주고 키 값은 돌려주지 않는다", async () => {
    const response = health(healthRequest(sessionCookieHeader()));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      groqKeyConfigured: true,
      llmMode: "live",
      store: "memory",
    });
    expect(text).not.toContain(FAKE_GROQ_KEY);
  });

  it("키가 없으면 false, LLM_MODE=mock이면 mock이다", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LLM_MODE", "mock");
    const response = health(healthRequest(sessionCookieHeader()));
    expect(await response.json()).toEqual({
      ok: true,
      groqKeyConfigured: false,
      llmMode: "mock",
      store: "memory",
    });
  });

  it("운영 환경에서는 LLM_MODE=mock을 무시한다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LLM_MODE", "mock");
    const response = health(healthRequest(sessionCookieHeader()));
    expect((await response.json()).llmMode).toBe("live");
  });
});
