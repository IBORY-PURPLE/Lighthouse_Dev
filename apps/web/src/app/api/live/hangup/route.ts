import { NextResponse, type NextRequest } from "next/server";
import { realCallTail, realtimeGate, refundRealCalls } from "@/lib/liveConfig";
import { CALL_ID_PATTERN, hangupRealtimeCall, settleCall } from "@/lib/liveRealtimeSession";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { readLimitedText } from "@/lib/readLimited";

// /live 통화 끊기. 설계서 7.6절. 화면이 닫을 때(sendBeacon 포함) 부른다. 응답은 언제나 204다.
// 장부와 상관없이 모양이 맞는 callId를 끊는다(라우트마다 인스턴스가 다를 수 있다). callId는 로그에 남기지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_BODY_BYTES = 1_024;
const NO_STORE = { "Cache-Control": "no-store" };
const checkIpLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });

const done = () => new NextResponse(null, { status: 204, headers: NO_STORE });

/** 본문 {callId, turns?}에서 값을 읽는다. 모양이 틀리면 null. turns는 0 이상의 정수일 때만 쓴다. */
function readBody(raw: string): { callId: string; turns?: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { callId, turns } = parsed as { callId?: unknown; turns?: unknown };
  if (typeof callId !== "string" || !CALL_ID_PATTERN.test(callId) || callId === "." || callId === "..") return null;
  const validTurns = typeof turns === "number" && Number.isInteger(turns) && turns >= 0;
  return validTurns ? { callId, turns } : { callId };
}

async function handleHangup(request: NextRequest, note: (text: string) => void) {
  if (!checkIpLimit(clientKey(request.headers)).allowed) {
    note(" upstream=skipped reason=rate_limited");
    return done();
  }
  let raw: string | null;
  try {
    raw = await readLimitedText(request, MAX_BODY_BYTES);
  } catch {
    raw = null;
  }
  const body = raw === null ? null : readBody(raw);
  if (!body) {
    note(" upstream=skipped reason=bad_request");
    return done();
  }

  if (realtimeGate().ok) {
    note(` upstream=${await hangupRealtimeCall(body.callId)}`);
  } else {
    note(" upstream=skipped");
  }
  // 쓰지 않은 예산을 돌려준다. 장부에 없으면 0이다.
  refundRealCalls(settleCall(body.callId, body.turns));
  note(realCallTail());
  return done();
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let extra = "";
  const response = await handleHangup(request, (text) => {
    extra += text;
  });
  console.info(`POST /api/live/hangup ${response.status} ${Date.now() - startedAt}ms${extra}`);
  return response;
}
