import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";

function limiter(limit: number) {
  let time = 1_000_000;
  const check = createRateLimiter({
    limit,
    windowMs: 60_000,
    now: () => time,
  });
  return {
    check,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("한도까지 허용하고 넘으면 남은 초를 알려 준다", () => {
    const { check, advance } = limiter(2);
    expect(check("a").allowed).toBe(true);
    expect(check("a").allowed).toBe(true);
    advance(15_000);
    expect(check("a")).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it("창이 지나면 다시 허용한다", () => {
    const { check, advance } = limiter(1);
    expect(check("a").allowed).toBe(true);
    expect(check("a").allowed).toBe(false);
    advance(60_000);
    expect(check("a").allowed).toBe(true);
  });

  it("거절된 요청은 창을 늘리지 않는다", () => {
    const { check, advance } = limiter(1);
    check("a");
    advance(59_000);
    expect(check("a").allowed).toBe(false);
    advance(1_000);
    expect(check("a").allowed).toBe(true);
  });

  it("키마다 따로 센다", () => {
    const { check } = limiter(1);
    expect(check("a").allowed).toBe(true);
    expect(check("b").allowed).toBe(true);
    expect(check("a").allowed).toBe(false);
  });

  it("기록이 많아져도 끝난 창을 치운 뒤 계속 동작한다", () => {
    const { check, advance } = limiter(1);
    for (let i = 0; i < 1000; i += 1) check(`old-${i}`);
    advance(60_000);
    expect(check("new").allowed).toBe(true);
    expect(check("new").allowed).toBe(false);
  });
});

describe("clientKey", () => {
  it("x-forwarded-for의 첫 주소를 쓰고 없으면 unknown이다", () => {
    expect(
      clientKey(new Headers({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" })),
    ).toBe("203.0.113.1");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
