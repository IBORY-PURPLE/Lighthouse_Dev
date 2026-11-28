import { after, NextResponse, type NextRequest } from "next/server";
import {
  isLiveEnabled,
  LIVE_MAX_TURNS,
  LIVE_WARN_BEFORE_SEC,
  liveCallIpLimit,
  liveMaxSessionSec,
  liveProductIntake,
  realCallsLeft,
  realCallTail,
  realtimeGate,
  refundRealCalls,
  spendRealCalls,
} from "@/lib/liveConfig";
import {
  buildRealtimeSession,
  createRealtimeCall,
  rememberCall,
  reserveDailyCall,
  scheduleHangup,
  sweepCalls,
  type RealtimeRate,
} from "@/lib/liveRealtimeSession";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { readLimitedText } from "@/lib/readLimited";

// /live Realtime 통화 만들기(SDP 중계). 설계서 7.4절. 브라우저가 보낸 offer SDP를 OpenAI에 넘기고 answer SDP를 돌려준다.
// 검사 순서는 설계서 표 그대로다. 로그에 SDP와 callId를 남기지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 예약 끊기(응답 뒤 세션 상한 + 10초 잠들기) 때문이다. 운영에서 켜기 전 H11.
export const maxDuration = 300;

const MAX_BODY_BYTES = 16_384;
const NO_STORE = { "Cache-Control": "no-store" };

// IP당 3회/10분(LIVE_CALL_IP_LIMIT로 바꾼다. 서버가 뜰 때 한 번 읽는다). 메모리 방식이라 인스턴스마다 따로 센다.
const checkIpLimit = createRateLimiter({ limit: liveCallIpLimit(), windowMs: 10 * 60_000 });

type FallbackReason = "rate_limited" | "disabled" | "mock" | "no_key" | "daily_cap" | "budget" | "upstream";

function failure(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

function fallback(reason: FallbackReason) {
  return NextResponse.json({ engine: "fallback", reason }, { headers: NO_STORE });
}

/** Origin 헤더가 있으면 요청 호스트와 같은 출처여야 한다. 남용 방어가 아니다(헤더는 위조할 수 있다). */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host"), request.nextUrl.host];
  return hosts.some((host) => host !== null && host.split(",")[0].trim() === originHost);
}

function readRate(request: NextRequest): RealtimeRate {
  const rate = request.nextUrl.searchParams.get("rate");
  return rate === "slow" || rate === "fast" ? rate : "normal";
}

/** 응답을 보낸 뒤 할 일. 요청 범위 밖(단위 시험)이라 after가 던지면 바로 돌린다. */
function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
}

async function handleCall(request: NextRequest, note: (text: string) => void) {
  if (!isLiveEnabled()) return failure(404, "disabled");

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/sdp")) {
    return failure(415, "unsupported");
  }
  if (!isSameOrigin(request)) return failure(403, "forbidden");

  if (!checkIpLimit(clientKey(request.headers)).allowed) {
    note(" engine=fallback reason=rate_limited");
    return fallback("rate_limited");
  }

  let offer: string | null;
  try {
    offer = await readLimitedText(request, MAX_BODY_BYTES);
  } catch {
    return failure(400, "invalid_sdp");
  }
  if (offer === null) return failure(413, "too_large");
  if (!offer.startsWith("v=0")) return failure(400, "invalid_sdp");

  const gate = realtimeGate();
  if (!gate.ok) {
    note(` engine=fallback reason=${gate.reason}`);
    return fallback(gate.reason);
  }

  // 같은 인스턴스의 오래된 통화를 끊는다. 응답을 늦추지 않으려고 응답 뒤에 한다.
  afterResponse(async () => {
    await sweepCalls();
  });

  // 하루 자리는 OpenAI를 부르기 전에, await 없이 잡는다(동시 요청이 상한을 넘지 않게).
  const daily = reserveDailyCall();
  if (!daily.ok) {
    note(" engine=fallback reason=daily_cap");
    return fallback("daily_cap");
  }

  // maxTurns는 LIVE_MAX_TURNS와 남은 예산 - 1 가운데 작은 쪽이다. 1보다 작으면 예산 부족이다.
  const left = realCallsLeft();
  const maxTurns = left === null && liveProductIntake()
    ? null
    : left === null ? LIVE_MAX_TURNS : Math.min(LIVE_MAX_TURNS, left - 1);
  const reservedTurns = maxTurns ?? 0;
  const spent = maxTurns === null || maxTurns >= 1 ? spendRealCalls(1 + reservedTurns) : null;
  if (!spent?.ok) {
    daily.release();
    note(` engine=fallback reason=budget${realCallTail()}`);
    return fallback("budget");
  }

  const created = await createRealtimeCall(offer, buildRealtimeSession({ rate: readRate(request) }));
  if (!created.ok) {
    if (created.status === "no_call_id") {
      // 연결은 맺어졌을 수 있어 자리는 쓴 것으로 두고, 예산은 연결 1회만 남긴다. answer SDP는 넘기지 않는다.
      refundRealCalls(reservedTurns);
    } else {
      daily.release();
      refundRealCalls(1 + reservedTurns);
    }
    note(` engine=fallback reason=upstream status=${created.status}${created.detail ?? ""}${realCallTail()}`);
    return fallback("upstream");
  }

  rememberCall(created.callId, reservedTurns);
  scheduleHangup(created.callId);
  const maxSessionSec = liveMaxSessionSec();
  note(` engine=realtime cap=${daily.used}/${daily.cap}${realCallTail()}`);
  return NextResponse.json(
    {
      engine: "realtime",
      sdp: created.sdp,
      callId: created.callId,
      maxSessionSec,
      warnBeforeSec: maxSessionSec > 0 ? LIVE_WARN_BEFORE_SEC : 0,
      maxTurns,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let extra = "";
  const response = await handleCall(request, (text) => {
    extra += text;
  });
  console.info(`POST /api/live/call ${response.status} ${Date.now() - startedAt}ms${extra}`);
  return response;
}
