import {
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import "server-only";
import { REGISTERED_VOLUNTEER } from "@/lib/volunteers";

// 봉사자 로그인. 계정은 환경 변수 VOLUNTEER_PHONE, VOLUNTEER_PASSWORD 한 쌍이다. TSD §8.9.
// 세션은 서버에 저장하지 않는 서명 쿠키다. 서명 키는 번호와 비밀번호에서 나오므로
// 둘 중 하나를 바꾸면 모든 기기의 세션이 무효가 된다.

export const VOLUNTEER_SESSION_COOKIE = "lh_volunteer";
export const VOLUNTEER_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const MIN_PASSWORD_LENGTH = 12;

const SESSION_VERSION = "v1";
const KEY_SALT_PREFIX = "lighthouse/volunteer-session/v1|";

type NotConfiguredReason = "phone_missing" | "password_missing" | "password_short";

interface Config {
  phoneDigits: string;
  password: string;
  key: Buffer;
}

let cached: { rawPhone: string; rawPassword: string; config: Config } | null =
  null;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function readConfig(): { config: Config } | { reason: NotConfiguredReason } {
  const rawPhone = process.env.VOLUNTEER_PHONE ?? "";
  const rawPassword = process.env.VOLUNTEER_PASSWORD ?? "";

  const phoneDigits = digitsOnly(rawPhone);
  if (!phoneDigits) return { reason: "phone_missing" };
  const password = rawPassword.trim();
  if (!password) return { reason: "password_missing" };
  if (password.length < MIN_PASSWORD_LENGTH) return { reason: "password_short" };

  if (
    cached &&
    cached.rawPhone === rawPhone &&
    cached.rawPassword === rawPassword
  ) {
    return { config: cached.config };
  }
  const key = scryptSync(password, KEY_SALT_PREFIX + phoneDigits, 32, {
    N: 16384,
    r: 8,
    p: 1,
  });
  const config = { phoneDigits, password, key };
  cached = { rawPhone, rawPassword, config };
  return { config };
}

function hashEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** 번호와 비밀번호가 등록 계정과 같으면 봉사자 id를 돌려준다. 설정이 없으면 로그 한 줄을 남기고 null. */
export function verifyVolunteerLogin(
  phone: string,
  password: string,
): { volunteerId: string } | null {
  const loaded = readConfig();
  if ("reason" in loaded) {
    // 값은 남기지 않는다. 이유 이름만.
    console.error(`volunteer-auth not_configured reason=${loaded.reason}`);
    return null;
  }
  const { config } = loaded;
  // 두 비교를 모두 계산하고 마지막에 합쳐 어느 쪽이 틀렸는지 시간으로 드러나지 않게 한다.
  const phoneOk = hashEqual(digitsOnly(phone), config.phoneDigits);
  const passwordOk = hashEqual(password.trim(), config.password);
  return phoneOk && passwordOk ? { volunteerId: REGISTERED_VOLUNTEER.id } : null;
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createVolunteerSession(
  volunteerId: string,
  nowMs = Date.now(),
): string | null {
  const loaded = readConfig();
  if ("reason" in loaded) return null;
  const expires =
    Math.floor(nowMs / 1000) + VOLUNTEER_SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VERSION}.${volunteerId}.${expires}`;
  return `${payload}.${sign(loaded.config.key, payload)}`;
}

export function readVolunteerSession(
  value: string | undefined,
  nowMs = Date.now(),
): { volunteerId: string } | null {
  if (!value) return null;
  const loaded = readConfig();
  if ("reason" in loaded) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, volunteerId, expires, signature] = parts;
  if (version !== SESSION_VERSION) return null;
  if (volunteerId !== REGISTERED_VOLUNTEER.id) return null;
  if (!/^\d{1,12}$/.test(expires) || Number(expires) * 1000 <= nowMs) {
    return null;
  }

  const expected = Buffer.from(
    sign(loaded.config.key, `${version}.${volunteerId}.${expires}`),
  );
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  return { volunteerId };
}

export function volunteerCookie(
  value: string,
  { secure, maxAge }: { secure: boolean; maxAge: number },
) {
  return {
    name: VOLUNTEER_SESSION_COOKIE,
    value,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
