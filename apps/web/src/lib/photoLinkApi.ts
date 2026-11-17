import "server-only";
import type { NextResponse, NextRequest } from "next/server";
import { hashPhotoSecret, isPhotoSecret, PHOTO_COOKIE } from "./photoLink";
import { createRateLimiter } from "./rateLimit";
import { StoreUnavailableError } from "./requestStore";
import { getResearchStore } from "./researchStore";
import { fail, logLine } from "./volunteerApi";

// 휴대폰 사진 라우트 공통 도우미(design.md 3.3). 휴대폰에는 봉사자 쿠키(lh_vol)가 없고 사진 올리기 열쇠(lh_photo)만 있다.
// 실패 본문은 {ok:false, error}, 늘 no-store. 로그에는 "METHOD /api/volunteer/<틀> <상태> <ms>ms"만 남긴다(토큰·열쇠·ID 없음).

/** 열쇠가 가리키는 봉사자 ID별 분당 10회(사진 올리기·열쇠 확인 모두). */
const checkGrantLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });

export interface PhotoGrantContext {
  requestId: string;
  volunteerId: string;
  sessionId: string;
  /** lh_photo 쿠키 값의 sha256. add_photo가 잠근 안에서 다시 확인한다. */
  grantHash: string;
  /** 열쇠가 끝나는 시각(ISO). */
  expiresAt: string;
}

/**
 * lh_photo 확인(없음·만료·끊김은 410 expired_or_revoked) → 봉사자별 횟수 제한(429) → 처리. 저장소 오류는 503 store_unavailable.
 * 410 본문은 이유를 나누지 않는다(끊긴 열쇠인지 처음부터 없던 열쇠인지 알려 주지 않는다).
 */
export async function runPhotoGrantRoute(
  request: NextRequest,
  template: string,
  handler: (context: PhotoGrantContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const response = await (async () => {
    const secret = request.cookies.get(PHOTO_COOKIE)?.value;
    if (!isPhotoSecret(secret)) return fail(410, "expired_or_revoked");
    const grantHash = hashPhotoSecret(secret);
    try {
      const grant = await getResearchStore().checkPhotoGrant(grantHash);
      if (grant.outcome !== "ok") return fail(410, "expired_or_revoked");
      const limit = checkGrantLimit(grant.volunteerId);
      if (!limit.allowed) return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
      return await handler({
        requestId: grant.requestId,
        volunteerId: grant.volunteerId,
        sessionId: grant.sessionId,
        grantHash,
        expiresAt: grant.expiresAt,
      });
    } catch (error) {
      return error instanceof StoreUnavailableError ? fail(503, "store_unavailable") : fail(500, "internal_error");
    }
  })();
  logLine(request.method, template, response.status, startedAt);
  return response;
}

/**
 * 같은 사이트에서 온 요청인가. 브라우저가 보낸 Origin의 호스트가 이 요청이 닿은 호스트와 같을 때만 참이다.
 * Origin이 없거나 "null"이면 거절한다(다른 사이트의 양식 전송·서버 간 호출을 받지 않는다).
 */
export function isSameSiteOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}
