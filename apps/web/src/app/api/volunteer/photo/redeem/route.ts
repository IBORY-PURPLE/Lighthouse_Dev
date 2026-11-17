import { NextResponse, type NextRequest } from "next/server";
import {
  hashPhotoSecret,
  isPhotoSecret,
  newPhotoSecret,
  PHOTO_COOKIE,
  PHOTO_COOKIE_PATH,
  PHOTO_GRANT_TTL_MS,
} from "@/lib/photoLink";
import { isSameSiteOrigin } from "@/lib/photoLinkApi";
import { createRateLimiter, clientKey } from "@/lib/rateLimit";
import { StoreUnavailableError } from "@/lib/requestStore";
import { readJsonBody } from "@/lib/researchApi";
import { getResearchStore } from "@/lib/researchStore";
import { fail, logLine, succeed } from "@/lib/volunteerApi";
import { cookieSecure } from "@/lib/volunteerSession";

// 휴대폰이 QR 링크를 쓴다(design.md 3.3). 링크(10분)는 한 번만 쓸 수 있고, 쓰면 사진 올리기 열쇠 lh_photo(30분)를 심는다.
// 같은 사이트 Origin과 JSON만 받는다. 모르는·만료·이미 쓴 링크는 모두 410 expired_or_revoked.
// 링크를 맞혀 보는 시도를 막으려고 접속 주소별로 분당 20번까지만 받는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkRedeemLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });
const MAX_BODY_BYTES = 1024;

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isSameSiteOrigin(request)) return fail(403, "bad_origin");
  const limit = checkRedeemLimit(clientKey(request.headers));
  if (!limit.allowed) return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
  const raw = await readJsonBody(request, MAX_BODY_BYTES);
  if (!raw.ok) return fail(raw.status, raw.error);
  const token = (raw.value as { token?: unknown } | null)?.token;
  if (!isPhotoSecret(token)) return fail(400, "invalid_request");
  const grant = newPhotoSecret();
  try {
    const out = await getResearchStore().redeemPhotoLink(hashPhotoSecret(token), hashPhotoSecret(grant));
    if (out.outcome === "gone") return fail(410, "expired_or_revoked");
    if (out.outcome !== "ok") return fail(400, "invalid_request");
    const response = succeed({ ok: true, expiresAt: out.grantExpiresAt });
    response.cookies.set({
      name: PHOTO_COOKIE,
      value: grant,
      httpOnly: true,
      secure: cookieSecure(request),
      sameSite: "strict",
      path: PHOTO_COOKIE_PATH,
      maxAge: Math.floor(PHOTO_GRANT_TTL_MS / 1000),
    });
    return response;
  } catch (error) {
    return error instanceof StoreUnavailableError ? fail(503, "store_unavailable") : fail(500, "internal_error");
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const response = await handle(request);
  logLine("POST", "photo/redeem", response.status, startedAt);
  return response;
}
