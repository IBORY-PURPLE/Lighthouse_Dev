import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cookieSecure,
  issueDeviceCookie,
  readVolunteerId,
  requireVolunteer,
  VOLUNTEER_COOKIE,
} from "@/lib/volunteerSession";

const ID_PATTERN = /^d-[0-9a-f]{16}$/;

describe("봉사자 기기 열쇠 쿠키", () => {
  it("만든 쿠키는 v2.<열쇠> 두 조각이고 봉사자 ID가 d-+16자리다", () => {
    const cookie = issueDeviceCookie();
    expect(cookie).toMatch(/^v2\.[A-Za-z0-9_-]{43}$/);
    expect(readVolunteerId(cookie)).toMatch(ID_PATTERN);
  });

  it("같은 쿠키는 늘 같은 ID, 다른 쿠키는 다른 ID", () => {
    const first = issueDeviceCookie();
    const second = issueDeviceCookie();
    expect(readVolunteerId(first)).toBe(readVolunteerId(first));
    expect(readVolunteerId(first)).not.toBe(readVolunteerId(second));
  });

  it("입장 코드 설정과 상관없이 만들고 읽는다(QA 기간에는 코드가 없다)", () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const cookie = issueDeviceCookie();
    expect(readVolunteerId(cookie)).toMatch(ID_PATTERN);
  });

  it("버전·열쇠 모양이 틀리거나 조각 수가 다르면 거절한다", () => {
    const cookie = issueDeviceCookie();
    const [, key] = cookie.split(".");
    for (const forged of [
      `v1.${key}`,
      `v1.${key}.signature`,
      `v3.${key}`,
      `v2.${key.slice(1)}`,
      `v2.${key}A`,
      `v2.${"!".repeat(43)}`,
      `${cookie}.extra`,
      "v2.",
      "v2",
      "",
    ]) {
      expect(readVolunteerId(forged)).toBeNull();
    }
    expect(readVolunteerId(null)).toBeNull();
    expect(readVolunteerId(undefined)).toBeNull();
  });

  it("requireVolunteer는 요청의 lh_vol 쿠키를 읽는다", () => {
    const cookie = issueDeviceCookie();
    const withCookie = new NextRequest("http://localhost/api/volunteer/queue", {
      headers: { cookie: `${VOLUNTEER_COOKIE}=${cookie}` },
    });
    expect(requireVolunteer(withCookie)).toBe(readVolunteerId(cookie));
    expect(requireVolunteer(new NextRequest("http://localhost/api/volunteer/queue"))).toBeNull();
  });
});

describe("cookieSecure", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("https 주소나 Vercel에서만 켠다", () => {
    vi.stubEnv("VERCEL", "");
    expect(cookieSecure(new NextRequest("http://localhost/x"))).toBe(false);
    expect(cookieSecure(new NextRequest("https://example.com/x"))).toBe(true);
    vi.stubEnv("VERCEL", "1");
    expect(cookieSecure(new NextRequest("http://localhost/x"))).toBe(true);
  });
});
