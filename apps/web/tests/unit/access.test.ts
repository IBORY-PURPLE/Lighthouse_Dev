import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasAccess, hashAccessCode, isValidAccessCode } from "@/lib/access";

describe("access", () => {
  beforeEach(() => vi.stubEnv("DEMO_ACCESS_CODE", "right-code"));
  afterEach(() => vi.unstubAllEnvs());

  it("맞는 코드만 통과시킨다", () => {
    expect(isValidAccessCode("right-code")).toBe(true);
    expect(isValidAccessCode("wrong-code")).toBe(false);
    expect(isValidAccessCode("")).toBe(false);
    expect(isValidAccessCode(null)).toBe(false);
  });

  it("쿠키 값은 코드의 SHA-256이어야 한다", () => {
    expect(hasAccess(hashAccessCode("right-code"))).toBe(true);
    expect(hasAccess("right-code")).toBe(false);
    expect(hasAccess(hashAccessCode("wrong-code"))).toBe(false);
    expect(hasAccess(undefined)).toBe(false);
  });

  it("서버에 코드가 없으면 아무것도 통과시키지 않는다", () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    expect(isValidAccessCode("")).toBe(false);
    expect(isValidAccessCode("right-code")).toBe(false);
    expect(hasAccess(hashAccessCode(""))).toBe(false);
  });
});
