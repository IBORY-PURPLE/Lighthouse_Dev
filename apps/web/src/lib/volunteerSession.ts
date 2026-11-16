import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// 봉사자 기기 열쇠. 계정 없이 이 기기를 구분한다(와이어프레임 v1 화면 1).
// 쿠키 lh_vol = v1.<열쇠>.<서명>. 서버·DB·로그에는 열쇠에서 뽑은 봉사자 ID(d-+16자리)만 남긴다.

export const VOLUNTEER_COOKIE = "lh_vol";
/** 30일. */
export const VOLUNTEER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const VERSION = "v1";
/** randomBytes(32)를 base64url로 쓴 길이. */
const KEY_LENGTH = 43;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** 입장 코드에서 서명 비밀을 만든다. 코드가 설정되지 않았으면 null(늘 무효). */
function signingSecret(): Buffer | null {
  const code = process.env.DEMO_ACCESS_CODE?.trim();
  if (!code) return null;
  return createHash("sha256")
    .update(`lighthouse/volunteer-device/${VERSION}|${code}`)
    .digest();
}

function sign(secret: Buffer, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 새 기기 열쇠가 든 쿠키 값. 입장 코드가 설정되지 않았으면 null. */
export function issueDeviceCookie(): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  const payload = `${VERSION}.${randomBytes(32).toString("base64url")}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** 쿠키 값이 맞으면 봉사자 ID, 아니면 null. */
export function readVolunteerId(value: string | null | undefined): string | null {
  const secret = signingSecret();
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [version, key, signature] = parts;
  if (version !== VERSION || key.length !== KEY_LENGTH) return null;
  if (!BASE64URL.test(key) || !BASE64URL.test(signature)) return null;
  if (!constantTimeEqual(sign(secret, `${version}.${key}`), signature)) return null;
  return `d-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

/** 쿠키 Secure 값. Vercel(HTTPS)과 https 주소에서만 켠다. 로컬 http 시험에서는 끈다. */
export function cookieSecure(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:" || process.env.VERCEL === "1";
}

/** 요청의 lh_vol이 맞으면 봉사자 ID, 아니면 null(라우트는 401). */
export function requireVolunteer(request: NextRequest): string | null {
  return readVolunteerId(request.cookies.get(VOLUNTEER_COOKIE)?.value);
}
