import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  hasAccess,
  hasVolunteerEntryCode,
  hashAccessCode,
  isValidAccessCode,
  isValidVolunteerEntryCode,
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

// 입장: 입장 코드와 별명으로 기기 열쇠 쿠키를 심는다.
// VOLUNTEER_ENTRY_CODE가 설정돼 있으면 접근 쿠키(lh_access)가 있든 없든 그 코드를 늘 요구한다.
// 설정돼 있지 않으면 예전처럼 lh_access가 있는 기기는 코드를 생략한다(로컬 개발).
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

  let accessValue: string;
  if (hasVolunteerEntryCode()) {
    // 이용자가 넣은 코드로 접근 쿠키를 만들지 않는다. 서버가 DEMO_ACCESS_CODE에서 직접 만든다.
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code || !isValidVolunteerEntryCode(code)) return fail(401, "invalid_code");
    accessValue = hashAccessCode(process.env.DEMO_ACCESS_CODE!.trim());
  } else {
    const alreadyAccess = hasAccess(request.cookies.get(ACCESS_COOKIE)?.value);
    accessValue = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
    if (!alreadyAccess) {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!code || !isValidAccessCode(code)) return fail(401, "invalid_code");
      accessValue = hashAccessCode(code);
    }
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
