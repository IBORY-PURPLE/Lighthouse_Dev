import { createHash, timingSafeEqual } from "node:crypto";
import "server-only";

export const ACCESS_COOKIE = "lh_access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function hashAccessCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function expectedHash(): string | null {
  const code = process.env.DEMO_ACCESS_CODE?.trim();
  return code ? hashAccessCode(code) : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isValidAccessCode(code: string | null | undefined): boolean {
  const expected = expectedHash();
  if (!expected || !code) return false;
  return constantTimeEqual(hashAccessCode(code), expected);
}

export function hasAccess(cookieValue: string | null | undefined): boolean {
  const expected = expectedHash();
  if (!expected || !cookieValue) return false;
  return constantTimeEqual(cookieValue, expected);
}

/** 봉사자 전용 입장 코드(VOLUNTEER_ENTRY_CODE). 설정돼 있지 않으면 null. */
export function volunteerEntryCode(): string | null {
  return process.env.VOLUNTEER_ENTRY_CODE?.trim() || null;
}

/** 봉사자 입장 코드가 따로 설정돼 있는가. 설정되면 접근 쿠키만으로는 봉사자로 입장할 수 없다. */
export function hasVolunteerEntryCode(): boolean {
  return volunteerEntryCode() !== null;
}

export function isValidVolunteerEntryCode(code: string | null | undefined): boolean {
  const entry = volunteerEntryCode();
  if (!entry || !code) return false;
  return constantTimeEqual(hashAccessCode(code), hashAccessCode(entry));
}
