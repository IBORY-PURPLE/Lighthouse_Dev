import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cookieSecure,
  issueDeviceCookie,
  readVolunteerId,
  requireVolunteer,
  VOLUNTEER_COOKIE,
} from "@/lib/volunteerSession";

const ID_PATTERN = /^d-[0-9a-f]{16}$/;

describe("봉사자 기기 열쇠 쿠키", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_CODE", "right-code");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("만든 쿠키는 v1.<열쇠>.<서명> 세 조각이고 봉사자 ID가 d-+16자리다", () => {
    const cookie = issueDeviceCookie();
    expect(cookie).toMatch(/^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/);
    expect(readVolunteerId(cookie)).toMatch(ID_PATTERN);
  });

  it("같은 쿠키는 늘 같은 ID, 다른 쿠키는 다른 ID", () => {
    const first = issueDeviceCookie();
    const second = issueDeviceCookie();
    expect(readVolunteerId(first)).toBe(readVolunteerId(first));
    expect(readVolunteerId(first)).not.toBe(readVolunteerId(second));
  });

  it("서명·열쇠·버전을 바꾸거나 조각이 모자라면 거절한다", () => {
    const cookie = issueDeviceCookie() as string;
    const [version, key, signature] = cookie.split(".");
    const flip = (text: string) => `${text.slice(0, -1)}${text.endsWith("A") ? "B" : "A"}`;
    for (const forged of [
      `${version}.${key}.${flip(signature)}`,
      `${version}.${flip(key)}.${signature}`,
      `v2.${key}.${signature}`,
      `${version}.${key}`,
      `${cookie}.extra`,
      `${version}.${key.slice(1)}.${signature}`,
      `${version}.${key}.`,
      "",
      "v1..",
    ]) {
      expect(readVolunteerId(forged)).toBeNull();
    }
    expect(readVolunteerId(null)).toBeNull();
    expect(readVolunteerId(undefined)).toBeNull();
  });

  it("다른 입장 코드로 만든 쿠키는 거절한다(코드가 바뀌면 열쇠가 모두 무효)", () => {
    const cookie = issueDeviceCookie();
    vi.stubEnv("DEMO_ACCESS_CODE", "another-code");
    expect(readVolunteerId(cookie)).toBeNull();
  });

  it("입장 코드가 없거나 비었으면 만들지도 읽지도 못한다", () => {
    const cookie = issueDeviceCookie();
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    expect(issueDeviceCookie()).toBeNull();
    expect(readVolunteerId(cookie)).toBeNull();
    vi.stubEnv("DEMO_ACCESS_CODE", "   ");
    expect(issueDeviceCookie()).toBeNull();
  });

  it("requireVolunteer는 요청의 lh_vol 쿠키를 읽는다", () => {
    const cookie = issueDeviceCookie() as string;
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
