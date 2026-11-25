import "server-only";
import { createHash, randomBytes } from "node:crypto";

// 휴대폰 사진 링크의 토큰·열쇠(design.md 3.3). 원문은 응답·쿠키에만 있고, 저장소에는 sha256(소문자 16진수 64자)만 둔다.
// 링크 토큰 = QR 주소의 #t= 뒤 값(10분, 한 번만). grant = 쓴 뒤 휴대폰 쿠키 lh_photo에 심는 사진 올리기 열쇠(30분).

export const PHOTO_LINK_TTL_MS = 10 * 60_000;
export const PHOTO_GRANT_TTL_MS = 30 * 60_000;
export const PHOTO_COOKIE = "lh_photo";
export const PHOTO_COOKIE_PATH = "/api/volunteer/photo";

/** randomBytes(32)를 base64url로 쓴 길이. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function newPhotoSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function isPhotoSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET.test(value);
}

export function hashPhotoSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
