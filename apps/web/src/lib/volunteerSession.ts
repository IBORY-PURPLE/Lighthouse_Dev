import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

// 봉사자 기기 열쇠. 계정 없이 이 기기를 구분한다(와이어프레임 v1 화면 1).
// 쿠키 lh_vol = v2.<열쇠>. 비밀이 아니라 기기마다 자동으로 받는 번호표다(QA 기간에는 입장 코드가 없다).
// 서버·DB·로그에는 열쇠에서 뽑은 봉사자 ID(d-+16자리)만 남긴다.

export const VOLUNTEER_COOKIE = "lh_vol";
/** 30일. */
export const VOLUNTEER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const VERSION = "v2";
/** randomBytes(32)를 base64url로 쓴 길이. */
const KEY_LENGTH = 43;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** 새 기기 열쇠가 든 쿠키 값. */
export function issueDeviceCookie(): string {
  return `${VERSION}.${randomBytes(32).toString("base64url")}`;
}

/** 쿠키 값의 모양이 맞으면 봉사자 ID, 아니면 null. */
export function readVolunteerId(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [version, key] = parts;
  if (version !== VERSION || key.length !== KEY_LENGTH || !BASE64URL.test(key)) return null;
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
