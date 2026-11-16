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
