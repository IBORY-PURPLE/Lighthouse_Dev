import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  hasAccess,
  hashAccessCode,
  isValidAccessCode,
} from "@/lib/access";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { fail, logLine } from "@/lib/volunteerApi";
import {
  cookieSecure,
  issueDeviceCookie,
  readVolunteerId,
  VOLUNTEER_COOKIE,
  VOLUNTEER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/volunteerSession";

// 입장: 입장 코드(이미 lh_access가 있으면 생략)와 별명으로 기기 열쇠 쿠키를 심는다.
// 별명은 길이만 검사하고 저장하거나 로그에 남기지 않는다(기기 localStorage에만 둔다).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const MAX_NICKNAME = 12;

/** 주소별 10분 10회. */
const checkEnterLimit = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 });

interface EnterBody {
  code?: unknown;
  nickname?: unknown;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail(400, "invalid_request");

  const limit = checkEnterLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
  }

  // 입장 코드가 설정되지 않은 서버는 누구도 입장시킬 수 없다.
  if (!process.env.DEMO_ACCESS_CODE?.trim()) return fail(503, "not_configured");

  let body: EnterBody;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fail(400, "invalid_request");
    }
    body = parsed as EnterBody;
  } catch {
    return fail(400, "invalid_request");
  }
  if (typeof body.nickname !== "string") return fail(400, "invalid_request");
  if (body.code !== undefined && typeof body.code !== "string") {
    return fail(400, "invalid_request");
  }

  const nicknameLength = [...body.nickname.trim()].length;
  if (nicknameLength < 1 || nicknameLength > MAX_NICKNAME) {
    return fail(400, "invalid_nickname");
  }

  const alreadyAccess = hasAccess(request.cookies.get(ACCESS_COOKIE)?.value);
  let accessValue = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  if (!alreadyAccess) {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code || !isValidAccessCode(code)) return fail(401, "invalid_code");
    accessValue = hashAccessCode(code);
  }

  const secure = cookieSecure(request);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: accessValue,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  // 이미 입장한 기기는 같은 ID를 지킨다(맡은 요청을 잃지 않으려고).
  if (!readVolunteerId(request.cookies.get(VOLUNTEER_COOKIE)?.value)) {
    const device = issueDeviceCookie();
    if (!device) return fail(503, "not_configured");
    response.cookies.set({
      name: VOLUNTEER_COOKIE,
      value: device,
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: VOLUNTEER_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const response = await handle(request);
  logLine("POST", "enter", response.status, startedAt);
  return response;
}
