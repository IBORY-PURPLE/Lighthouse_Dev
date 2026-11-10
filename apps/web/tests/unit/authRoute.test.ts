import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";

import { fakeAccount } from "./helpers/volunteerSession";

// 가짜 계정은 vitest.config.mts의 test.env에서만 정한다.
const {
  phone: PHONE,
  phoneDigits: PHONE_DIGITS,
  password: PASSWORD,
} = fakeAccount();
const WRONG_PASSWORD = "wrong-test-only-password";

let nextClient = 1;
const freshClient = () => `198.51.100.${(nextClient += 1)}`;

function loginRequest(
  body: unknown,
  {
    origin = "http://localhost:3000",
    client,
  }: { origin?: string; client?: string } = {},
) {
  return new NextRequest(`${origin}/api/auth/login`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client ?? freshClient() },
  });
}

const good = { phone: PHONE, password: PASSWORD };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/auth/login 성공과 쿠키", () => {
  it("http://localhost는 Secure 없이 안전한 속성의 쿠키를 준다", async () => {
    const response = await login(loginRequest(good));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^lh_volunteer=v1\.vol-01\.\d+\./);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).not.toMatch(/Secure/i);
    expect(cookie).not.toContain(PHONE_DIGITS);
    expect(cookie).not.toContain(PASSWORD);
  });

  it("https 주소면 Secure다", async () => {
    const response = await login(
      loginRequest(good, { origin: "https://lighthouse.example" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("http://localhost라도 VERCEL=1이면 Secure다", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await login(loginRequest(good));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("하이픈 없는 번호도 받는다", async () => {
    const response = await login(
      loginRequest({ phone: PHONE_DIGITS, password: PASSWORD }),
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /api/auth/login 실패", () => {
  it("틀린 번호와 틀린 비밀번호는 같은 401 본문이고 쿠키가 없다", async () => {
    const wrongPhone = await login(
      loginRequest({ phone: "010-0000-0001", password: PASSWORD }),
    );
    const wrongPassword = await login(
      loginRequest({ phone: PHONE, password: WRONG_PASSWORD }),
    );
    expect(wrongPhone.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    const bodyA = await wrongPhone.text();
    const bodyB = await wrongPassword.text();
    expect(bodyA).toBe(bodyB);
    expect(JSON.parse(bodyA)).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
    expect(wrongPhone.headers.get("set-cookie")).toBeNull();
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
    expect(wrongPhone.headers.get("cache-control")).toBe("no-store");
  });

  it("설정 없음도 같은 401이고 로그에 값이 없다", async () => {
    vi.stubEnv("VOLUNTEER_PASSWORD", "short");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await login(loginRequest(good));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
    expect(response.headers.get("set-cookie")).toBeNull();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe(
      "volunteer-auth not_configured reason=password_short",
    );
    const logged = JSON.stringify([...error.mock.calls, ...info.mock.calls]);
    expect(logged).not.toContain(PHONE_DIGITS);
    expect(logged).not.toContain(PASSWORD);
  });

  const BAD_REQUESTS: Array<[string, () => NextRequest]> = [
    ["JSON이 아님", () => loginRequest("not json")],
    ["문자열이 아님", () => loginRequest({ phone: 1, password: PASSWORD })],
    ["본문이 null", () => loginRequest("null")],
    [
      "번호 32자 초과",
      () => loginRequest({ phone: "1".repeat(33), password: PASSWORD }),
    ],
    [
      "비밀번호 256자 초과",
      () => loginRequest({ phone: PHONE, password: "p".repeat(257) }),
    ],
    [
      "content-length 1024 초과",
      () =>
        new NextRequest("http://localhost:3000/api/auth/login", {
          method: "POST",
          body: JSON.stringify(good),
          headers: { "x-forwarded-for": freshClient(), "content-length": "1200" },
        }),
    ],
  ];
  for (const [name, build] of BAD_REQUESTS) {
    it(`형식 오류(${name})는 400이다`, async () => {
      const response = await login(build());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        error: "invalid_request",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  }

  it("같은 주소의 6번째 시도는 429이고 다른 주소는 영향이 없다", async () => {
    const client = "203.0.113.200";
    for (let i = 0; i < 5; i += 1) {
      const response = await login(
        loginRequest({ phone: PHONE, password: WRONG_PASSWORD }, { client }),
      );
      expect(response.status).toBe(401);
    }
    const limited = await login(loginRequest(good, { client }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(limited.headers.get("set-cookie")).toBeNull();

    expect((await login(loginRequest(good))).status).toBe(200);
  });

  it("모든 콘솔 출력에 번호와 비밀번호가 없다", async () => {
    const spies = [
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];

    await login(loginRequest(good));
    await login(loginRequest({ phone: PHONE, password: WRONG_PASSWORD }));
    await login(loginRequest("not json"));
    vi.stubEnv("VOLUNTEER_PHONE", "");
    await login(loginRequest(good));

    const calls = spies.flatMap((spy) => spy.mock.calls);
    expect(calls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(PHONE_DIGITS);
    expect(logged).not.toContain(PHONE);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(WRONG_PASSWORD);
  });
});

describe("POST /api/auth/logout", () => {
  it("200이고 Max-Age=0인 빈 쿠키를 준다", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await logout(
      new NextRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^lh_volunteer=;/);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("https 주소면 Secure를 붙인다", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await logout(
      new NextRequest("https://lighthouse.example/api/auth/logout", {
        method: "POST",
      }),
    );
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });
});
