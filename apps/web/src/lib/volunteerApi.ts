import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createRateLimiter } from "./rateLimit";
import { StoreUnavailableError } from "./requestStore";
import { requireVolunteer } from "./volunteerSession";

// 봉사자 서버 함수 공통 도우미. 실패 본문은 {ok:false, error}, 늘 no-store.
// 로그에는 "METHOD /api/volunteer/<틀> <상태> <ms>ms"만 남긴다(요청 id·상품명·봉사자 ID 없음).

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 봉사자 ID별 분당 60회(enter·me는 따로 제한하지 않는다). */
const checkVolunteerLimit = createRateLimiter({ limit: 60, windowMs: 60_000 });

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function fail(
  status: number,
  error: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

export function succeed(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function logLine(
  method: string,
  template: string,
  status: number,
  startedAt: number,
  /** 로그 끝에 덧붙일 글(예: " kind=model ai=ok"). 글·사진·ID는 넣지 않는다. */
  suffix = "",
) {
  console.info(`${method} /api/volunteer/${template} ${status} ${Date.now() - startedAt}ms${suffix}`);
}

export interface VolunteerContext {
  volunteerId: string;
}

/**
 * lh_vol 검사(401) → 봉사자별 횟수 제한(429) → 처리. 저장소 오류는 503 store_unavailable.
 * extraLimit은 더 좁은 제한이 필요한 라우트(시연 다시 채우기)가 넘긴다. logSuffix는 로그 한 줄 끝에 붙일 글을 돌려준다.
 */
export async function runVolunteerRoute(
  request: NextRequest,
  template: string,
  handler: (context: VolunteerContext) => Promise<NextResponse>,
  extraLimit?: (volunteerId: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number },
  logSuffix?: () => string,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const response = await (async () => {
    const volunteerId = requireVolunteer(request);
    if (!volunteerId) return fail(401, "unauthorized");
    for (const check of [checkVolunteerLimit, extraLimit]) {
      const limit = check?.(volunteerId);
      if (limit && !limit.allowed) {
        return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
      }
    }
    try {
      return await handler({ volunteerId });
    } catch (error) {
      return error instanceof StoreUnavailableError
        ? fail(503, "store_unavailable")
        : fail(500, "internal_error");
    }
  })();
  logLine(request.method, template, response.status, startedAt, logSuffix?.());
  return response;
}
