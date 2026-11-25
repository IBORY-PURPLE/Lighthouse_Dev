import { NextResponse, type NextRequest } from "next/server";
import { currentDeviceId } from "@/lib/deviceSession";
import { isLiveEnabled, liveLogStatus } from "@/lib/liveConfig";
import { cleanLiveLogEntries, saveLiveEvents } from "@/lib/liveLogStore";
import { LIVE_LOG_LABEL, LIVE_LOG_MAX_BYTES, type LiveLogReason, type LiveLogResponse } from "@/lib/liveLogWire";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { readLimitedText } from "@/lib/readLimited";

// /live 대화 기록 저장(QA 분석용). 화면이 묶음으로 보낸 줄을 live_events 표에 덧붙인다. 약속은 liveLogWire.ts의 주석이다.
// 스위치는 LIVE_LOG(on/all)와 LIVE_LOG_UNTIL. 꺼져 있으면 DB를 부르지 않는다.
// 기기 ID는 쿠키에서 읽기만 한다. 이 라우트는 쿠키를 심지 않는다(/api/requests가 심은 쿠키와 기기 번호가 어긋나지 않게).
// 로그에는 상태, 시간, 줄 수, 저장 결과 낱말만 남긴다. 글, cid, 기기 ID, 표지는 남기지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const NO_STORE = { "Cache-Control": "no-store" };
// 같은 와이파이의 QA 참가자가 한 주소로 보이므로 넉넉하게 둔다.
const checkIpLimit = createRateLimiter({ limit: 1200, windowMs: 60_000 });
const checkDeviceLimit = createRateLimiter({ limit: 120, windowMs: 60_000 });

function respond(reason: LiveLogReason, stored = 0, status = 200): NextResponse {
  const body: LiveLogResponse = { stored, reason };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.", code: "rate_limited" },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) } },
  );
}

/** Origin 헤더가 있으면 요청 호스트와 같은 출처여야 한다. 남용 방어가 아니다(헤더는 위조할 수 있다). call 라우트와 같은 내용이다. */
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

interface Note {
  lines: number;
  store: string;
  device: "ok" | "none";
}

async function handleLog(request: NextRequest, note: Note): Promise<NextResponse> {
  if (!isLiveEnabled()) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404, headers: NO_STORE });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const status = liveLogStatus();
  if (!status.mode) {
    note.store = status.reason;
    return respond(status.reason);
  }

  const ip = checkIpLimit(clientKey(request.headers));
  if (!ip.allowed) {
    note.store = "rate_limited";
    return tooMany(ip.retryAfterSeconds);
  }

  let raw: string | null;
  try {
    raw = await readLimitedText(request, LIVE_LOG_MAX_BYTES);
  } catch {
    raw = null;
  }
  let body: unknown = null;
  if (raw !== null) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !Array.isArray((body as { entries?: unknown }).entries)) {
    note.store = "empty";
    return respond("empty");
  }
  const { label: rawLabel, entries } = body as { label?: unknown; entries: unknown[] };
  note.lines = entries.length;

  const label = typeof rawLabel === "string" && LIVE_LOG_LABEL.test(rawLabel) ? rawLabel : "";
  if (status.mode === "label" && label === "") {
    note.store = "no_label";
    return respond("no_label");
  }

  const deviceId = currentDeviceId(request);
  if (!deviceId) {
    note.store = "no_device";
    return respond("no_device");
  }
  note.device = "ok";

  const device = checkDeviceLimit(deviceId);
  if (!device.allowed) {
    note.store = "rate_limited";
    return tooMany(device.retryAfterSeconds);
  }

  const rows = cleanLiveLogEntries(entries, { deviceId, label });
  if (rows.length === 0) {
    note.store = "empty";
    return respond("empty");
  }

  const out = { stored: 0 };
  const result = await saveLiveEvents(rows, out);
  note.store = result;
  switch (result) {
    case "saved":
      return respond("saved", out.stored);
    case "retry":
      return NextResponse.json({ ok: false, error: "unavailable", code: "store_busy" }, { status: 503, headers: NO_STORE });
    default:
      return respond(result);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const note: Note = { lines: 0, store: "none", device: "none" };
  let response: NextResponse;
  try {
    response = await handleLog(request, note);
  } catch {
    // 던져도 대화는 끊기지 않게 503으로 답한다(화면이 나중에 다시 보낸다). 오류 객체는 찍지 않는다.
    note.store = "error";
    response = NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  console.info(
    `POST /api/live/log ${response.status} ${Date.now() - startedAt}ms n=${note.lines} store=${note.store} device=${note.device}`,
  );
  return response;
}
