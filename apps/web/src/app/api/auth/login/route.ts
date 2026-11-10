import { NextResponse, type NextRequest } from "next/server";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import {
  createVolunteerSession,
  VOLUNTEER_SESSION_MAX_AGE_SECONDS,
  verifyVolunteerLogin,
  volunteerCookie,
} from "@/lib/volunteerAuth";

// 봉사자 로그인. TSD §8.9.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const MAX_PHONE_LENGTH = 32;
const MAX_PASSWORD_LENGTH = 256;
const NO_STORE = { "Cache-Control": "no-store" };

// 성공도 센다. 같은 주소에서 10분에 5번까지.
const checkRateLimit = createRateLimiter({ limit: 5, windowMs: 600_000 });

function failure(
  status: number,
  error: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

async function readCredentials(
  request: NextRequest,
): Promise<{ phone: string; password: string } | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    const { phone, password } = (body ?? {}) as {
      phone?: unknown;
      password?: unknown;
    };
    if (typeof phone !== "string" || typeof password !== "string") return null;
    if (phone.length > MAX_PHONE_LENGTH) return null;
    if (password.length > MAX_PASSWORD_LENGTH) return null;
    return { phone, password };
  } catch {
    return null;
  }
}

async function handleLogin(request: NextRequest): Promise<NextResponse> {
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "rate_limited", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const credentials = await readCredentials(request);
  if (!credentials) return failure(400, "invalid_request");

  const verified = verifyVolunteerLogin(credentials.phone, credentials.password);
  const session = verified ? createVolunteerSession(verified.volunteerId) : null;
  if (!session) return failure(401, "invalid_credentials");

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.cookies.set(
    volunteerCookie(session, {
      // 운영과 미리보기(Vercel)는 항상 Secure. http 개발·시험에서는 쿠키가 저장돼야 한다.
      secure:
        request.nextUrl.protocol === "https:" || process.env.VERCEL === "1",
      maxAge: VOLUNTEER_SESSION_MAX_AGE_SECONDS,
    }),
  );
  return response;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const response = await handleLogin(request);
  // 번호와 비밀번호는 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `POST /api/auth/login ${response.status} ${Date.now() - startedAt}ms`,
  );
  return response;
}
