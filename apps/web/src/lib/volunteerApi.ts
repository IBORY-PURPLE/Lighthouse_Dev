import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE_SECONDS, hashAccessCode } from "./access";
import { createRateLimiter } from "./rateLimit";
import { StoreUnavailableError } from "./requestStore";
import { cookieSecure, requireVolunteer } from "./volunteerSession";

// 봉사자 서버 함수 공통 도우미. 실패 본문은 {ok:false, error}, 늘 no-store.
// 로그에는 "METHOD /api/volunteer/<틀> <상태> <ms>ms"만 남긴다(요청 id·상품명·봉사자 ID 없음).

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 봉사자 ID별 분당 60회(enter·me는 따로). */
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

/**
 * 입장한 기기(유효한 lh_vol)의 응답에 접근 쿠키(lh_access)를 다시 심는다.
 * lh_vol은 30일, lh_access는 7일이라 그대로 두면 입장 7일 뒤부터 lh_access만 검사하는
 * 기존 서버 함수(/api/chat 등)가 401이 된다. lh_vol의 서명 비밀은 입장 코드에서 나오므로
 * 유효한 lh_vol은 지금 입장 코드를 알던 기기라는 뜻이다. 호출하는 쪽이 lh_vol을 먼저 확인한다.
 */
export function refreshAccessCookie(request: NextRequest, response: NextResponse): void {
  const code = process.env.DEMO_ACCESS_CODE?.trim();
  if (!code) return;
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: hashAccessCode(code),
    httpOnly: true,
    secure: cookieSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
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
    let handled: NextResponse;
    try {
      handled = await handler({ volunteerId });
    } catch (error) {
      handled =
        error instanceof StoreUnavailableError
          ? fail(503, "store_unavailable")
          : fail(500, "internal_error");
    }
    // 봉사자 화면은 열릴 때마다 이 함수들을 부르므로, 여기서 접근 쿠키를 새로 고친다.
    refreshAccessCookie(request, handled);
    return handled;
  })();
  logLine(request.method, template, response.status, startedAt, logSuffix?.());
  return response;
}
