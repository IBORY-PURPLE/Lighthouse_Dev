import { NextResponse, type NextRequest } from "next/server";
import {
  isLiveEnabled,
  LIVE_WARN_BEFORE_SEC,
  liveAdvanceMode,
  liveLogMode,
  liveMaxSessionSec,
  liveProductIntake,
  realtimeGate,
} from "@/lib/liveConfig";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";

// /live 화면이 열릴 때 한 번 부르는 설정 확인. 설계서 7.2절.
// 돈이 들지 않는다. 통화 장부나 하루 상한을 보지 않는다(하루 상한은 /api/live/call이 알린다).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const checkRateLimit = createRateLimiter({ limit: 60, windowMs: 60_000 });

function handleConfig(request: NextRequest): Response {
  if (!isLiveEnabled()) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404, headers: NO_STORE });
  }
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.", code: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const gate = realtimeGate();
  const log = liveLogMode();
  const maxSessionSec = liveMaxSessionSec();
  return NextResponse.json(
    {
      enabled: true,
      realtime: gate.ok,
      ...(gate.ok ? {} : { reason: gate.reason }),
      maxSessionSec,
      warnBeforeSec: maxSessionSec > 0 ? LIVE_WARN_BEFORE_SEC : 0,
      ...(liveProductIntake() ? { productIntake: true } : {}),
      ...(liveAdvanceMode() === "manual" ? { advance: "manual" } : {}),
      ...(log ? { log } : {}),
    },
    { headers: NO_STORE },
  );
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const response = handleConfig(request);
  console.info(`GET /api/live/config ${response.status} ${Date.now() - startedAt}ms`);
  return response;
}
