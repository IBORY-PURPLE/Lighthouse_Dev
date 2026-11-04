import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
import type { MatchResponse } from "@/lib/matchHandoff";
import { parseRequest } from "@/lib/parseRequest";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { findVolunteerForItem } from "@/lib/volunteers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 200;
const NO_STORE = { "Cache-Control": "no-store" };

const checkRateLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });

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

async function readText(request: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    const text = (body as { text?: unknown } | null)?.text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

async function handleMatch(request: NextRequest): Promise<NextResponse> {
  if (!hasAccess(request.cookies.get(ACCESS_COOKIE)?.value)) {
    return failure(401, "unauthorized");
  }

  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "rate_limited", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const text = await readText(request);
  if (text === null || !text.trim()) return failure(400, "invalid_request");
  if (text.length > MAX_TEXT_LENGTH) return failure(400, "too_long");

  const { brand, item } = parseRequest(text);
  if (!item) return failure(422, "need_item");

  const volunteer = findVolunteerForItem(item);
  if (!volunteer) return failure(500, "no_volunteer");

  const match: MatchResponse = {
    requestId: randomUUID(),
    volunteer: { id: volunteer.id, displayName: volunteer.displayName },
    request: { brand, item, raw: text.trim() },
  };
  return NextResponse.json(match, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const response = await handleMatch(request);
  // 사용자 문장은 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `POST /api/match ${response.status} ${Date.now() - startedAt}ms`,
  );
  return response;
}
