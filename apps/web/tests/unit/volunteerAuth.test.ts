import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVolunteerSession,
  readVolunteerSession,
  verifyVolunteerLogin,
  volunteerCookie,
  VOLUNTEER_SESSION_MAX_AGE_SECONDS,
} from "@/lib/volunteerAuth";
import { REGISTERED_VOLUNTEER } from "@/lib/volunteers";
import { fakeAccount } from "./helpers/volunteerSession";

// 가짜 계정은 vitest.config.mts의 test.env에서만 정한다.
const {
  phone: PHONE,
  phoneDigits: PHONE_DIGITS,
  password: PASSWORD,
} = fakeAccount();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verifyVolunteerLogin", () => {
  it("맞는 번호(하이픈 있음·없음)와 비밀번호면 등록 봉사자를 돌려준다", () => {
    expect(verifyVolunteerLogin(PHONE, PASSWORD)).toEqual({ volunteerId: "vol-01" });
    expect(verifyVolunteerLogin(PHONE_DIGITS, PASSWORD)).toEqual({
      volunteerId: "vol-01",
    });
    expect(verifyVolunteerLogin(` ${PHONE} `, ` ${PASSWORD} `)).toEqual({
      volunteerId: "vol-01",
    });
  });

  it("틀린 번호, 틀린 비밀번호, 빈 값이면 null이다", () => {
    expect(verifyVolunteerLogin("010-0000-0001", PASSWORD)).toBeNull();
    expect(verifyVolunteerLogin(PHONE, "unit-test-only-passworD")).toBeNull();
    expect(verifyVolunteerLogin("", PASSWORD)).toBeNull();
    expect(verifyVolunteerLogin(PHONE, "")).toBeNull();
    expect(verifyVolunteerLogin("", "")).toBeNull();
  });

  const NOT_CONFIGURED: Array<[string, Record<string, string>, string]> = [
    ["번호 없음", { VOLUNTEER_PHONE: "" }, "phone_missing"],
    ["비밀번호 없음", { VOLUNTEER_PASSWORD: "" }, "password_missing"],
    ["비밀번호 11자", { VOLUNTEER_PASSWORD: "elevenchars" }, "password_short"],
  ];
  for (const [name, env, reason] of NOT_CONFIGURED) {
    it(`설정 없음(${name})이면 null이고 값 없는 로그 한 줄을 남긴다`, () => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(verifyVolunteerLogin(PHONE, PASSWORD)).toBeNull();
      expect(verifyVolunteerLogin(PHONE, "elevenchars")).toBeNull();

      expect(error).toHaveBeenCalledTimes(2);
      const line = String(error.mock.calls[0][0]);
      expect(line).toBe(`volunteer-auth not_configured reason=${reason}`);
      expect(line).not.toContain(PHONE_DIGITS);
      expect(line).not.toContain(PASSWORD);
    });
  }
});

describe("봉사자 세션", () => {
  const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

  it("만들고 읽는다", () => {
    const value = createVolunteerSession(REGISTERED_VOLUNTEER.id, NOW);
    expect(value).not.toBeNull();
    expect(readVolunteerSession(value!, NOW + 1000)).toEqual({
      volunteerId: "vol-01",
    });
  });

  it("값이 없으면 null이다", () => {
    expect(readVolunteerSession(undefined)).toBeNull();
    expect(readVolunteerSession("")).toBeNull();
  });

  it("서명 한 글자를 바꾸면 null이다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    const first = value.lastIndexOf(".") + 1;
    for (const index of [first, first + 20, value.length - 1]) {
      const swapped = value[index] === "A" ? "B" : "A";
      const forged = value.slice(0, index) + swapped + value.slice(index + 1);
      expect(readVolunteerSession(forged, NOW)).toBeNull();
    }
  });

  it("만료 시각 + 1초면 null이다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    const expiresMs = NOW + VOLUNTEER_SESSION_MAX_AGE_SECONDS * 1000;
    expect(readVolunteerSession(value, expiresMs - 1000)).not.toBeNull();
    expect(readVolunteerSession(value, expiresMs + 1000)).toBeNull();
  });

  it("조각 수가 틀리면 null이다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    expect(readVolunteerSession(`${value}.extra`, NOW)).toBeNull();
    expect(readVolunteerSession(value.split(".").slice(0, 3).join("."), NOW)).toBeNull();
  });

  it("id가 다르면 null이다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    const [version, , expires, signature] = value.split(".");
    expect(
      readVolunteerSession([version, "vol-02", expires, signature].join("."), NOW),
    ).toBeNull();
    // 다른 id로 서명한 값도 읽을 때 거절한다.
    const other = createVolunteerSession("vol-02", NOW);
    expect(other).not.toBeNull();
    expect(readVolunteerSession(other ?? undefined, NOW)).toBeNull();
  });

  it("비밀번호를 바꾸면 기존 세션이 null이다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    vi.stubEnv("VOLUNTEER_PASSWORD", "another-test-only-password");
    expect(readVolunteerSession(value, NOW)).toBeNull();
    vi.unstubAllEnvs();
    expect(readVolunteerSession(value, NOW)).not.toBeNull();
  });

  it("번호를 바꿔도 기존 세션이 null이다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    vi.stubEnv("VOLUNTEER_PHONE", "010-0000-0001");
    expect(readVolunteerSession(value, NOW)).toBeNull();
  });

  it("설정이 없으면 만들지도 읽지도 못한다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    vi.stubEnv("VOLUNTEER_PASSWORD", "");
    expect(createVolunteerSession("vol-01", NOW)).toBeNull();
    expect(readVolunteerSession(value, NOW)).toBeNull();
  });

  it("세션 값에 번호와 비밀번호 글자가 없다", () => {
    const value = createVolunteerSession("vol-01", NOW)!;
    expect(value).not.toContain(PHONE_DIGITS);
    expect(value).not.toContain(PASSWORD);
    expect(value).toMatch(/^v1\.vol-01\.\d+\.[A-Za-z0-9_-]{43}$/);
  });
});

describe("volunteerCookie", () => {
  it("보안 속성을 고정한다", () => {
    expect(volunteerCookie("value", { secure: true, maxAge: 604800 })).toEqual({
      name: "lh_volunteer",
      value: "value",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
    expect(volunteerCookie("", { secure: false, maxAge: 0 })).toMatchObject({
      secure: false,
      maxAge: 0,
      value: "",
    });
  });
});
