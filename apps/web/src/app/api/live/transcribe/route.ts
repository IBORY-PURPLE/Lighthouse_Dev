import { NextResponse, type NextRequest } from "next/server";
import { isLiveEnabled, liveLocalTranscription, liveMicDiagnostics } from "@/lib/liveConfig";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { readLimitedBytes } from "@/lib/readLimited";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 512 * 1024;
const limit = createRateLimiter({ limit: 40, windowMs: 60_000 });
const diagnosticLimit = createRateLimiter({ limit: 150, windowMs: 60_000 });
const diagnosticEvents = new Set(["screen", "state", "mic_request", "mic_connected", "mic_error", "level", "speech", "upload", "recognition_http", "cancel_capture", "advance", "hold_answer", "echo_filtered"]);
const localService = "http://127.0.0.1:8784";
const response = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function postDiagnostic(request: NextRequest) {
  if (!diagnosticLimit(clientKey(request.headers)).allowed) return new Response(null, { status: 429 });
  const bytes = await readLimitedBytes(request, 512);
  if (!bytes?.length) return new Response(null, { status: 400 });
  let payload: { event?: unknown; detail?: unknown };
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!payload || typeof payload.event !== "string" || !diagnosticEvents.has(payload.event) || typeof payload.detail !== "string") {
    return new Response(null, { status: 400 });
  }
  const result = await fetch(`${localService}/diagnostic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: payload.event, detail: payload.detail.slice(0, 180) }),
    signal: AbortSignal.timeout(2_000),
  });
  return new Response(null, { status: result.ok ? 204 : 503 });
}

export async function POST(request: NextRequest) {
  if (!isLiveEnabled() || !liveLocalTranscription()) return response(404, { error: "disabled" });
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return response(403, { error: "bad_origin" });
  const debug = liveMicDiagnostics() && /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(request.headers.get("host") ?? "");
  const mediaType = request.headers.get("content-type")?.split(";")[0];
  if (mediaType === "application/json") {
    if (!debug) return new Response(null, { status: 404 });
    try {
      return await postDiagnostic(request);
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  if (!limit(clientKey(request.headers)).allowed) return response(429, { error: "busy" });
  if (!mediaType || !["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"].includes(mediaType)) {
    return response(415, { error: "unsupported_audio" });
  }
  try {
    const bytes = await readLimitedBytes(request, MAX_AUDIO_BYTES);
    if (bytes === null) return response(413, { error: "too_large" });
    if (!bytes.length) return response(400, { error: "empty_audio" });
    const result = await fetch(`${localService}/transcribe`, {
      method: "POST",
      body: Uint8Array.from(bytes),
      headers: {
        "Content-Type": "application/octet-stream",
        ...(debug && request.headers.get("x-live-mic-debug") === "1" ? { "x-live-mic-debug": "1" } : {}),
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(11_000)]),
    });
    if (!result.ok) return response(503, { error: "unavailable" });
    const data: unknown = await result.json();
    if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string") {
      return response(503, { error: "unavailable" });
    }
    return response(200, { text: data.text.slice(0, 1_000) });
  } catch {
    return response(503, { error: "unavailable" });
  }
}
