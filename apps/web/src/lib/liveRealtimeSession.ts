import "server-only";
import { after } from "next/server";
import { LIVE_REALTIME_INSTRUCTIONS, LIVE_TOOLS } from "@/lib/liveInstructions";
import {
  LIVE_REALTIME_MODEL_DEFAULT,
  LIVE_VOICE,
  liveDailySessionCap,
  liveMaxSessionSec,
  liveReasoningEffort,
  liveTranscribeLang,
  liveVadMode,
} from "@/lib/liveConfig";

// /live Realtime 서버 쪽 부품: 세션 설정 만들기, 통화 만들기·끊기(OpenAI), 하루 자리, 통화 장부, 예약 끊기.
// 설계서 7.5절, 13절. 장부와 하루 자리는 인스턴스 메모리라 정확한 상한이 아니다(13.1절).

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const CREATE_TIMEOUT_MS = 8_000;
const HANGUP_TIMEOUT_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 장부의 통화가 세션 상한을 이만큼 넘기면 sweepCalls가 끊는다. */
const SWEEP_GRACE_MS = 15_000;
/** 예약 끊기는 세션 상한보다 이만큼 늦게 끊는다. */
const SCHEDULE_GRACE_SEC = 10;
/** Location에서 꺼낸 call_id를 받아들이는 모양. hangup 라우트도 같은 모양을 쓴다. */
export const CALL_ID_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

export type RealtimeRate = "slow" | "normal" | "fast";
const SPEED: Record<RealtimeRate, number> = { slow: 0.85, normal: 1.0, fast: 1.2 };

/** Realtime 세션 설정(7.5절 JSON). 필드 이름은 GA 표기다. */
export function buildRealtimeSession(o?: { rate?: RealtimeRate }): object {
  const model = process.env.LIVE_REALTIME_MODEL?.trim() || LIVE_REALTIME_MODEL_DEFAULT;
  const language = liveTranscribeLang();
  const effort = liveReasoningEffort();
  const turnDetection =
    liveVadMode() === "server"
      ? {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200,
          create_response: false,
          interrupt_response: false,
        }
      : { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false };
  return {
    type: "realtime",
    model,
    instructions: LIVE_REALTIME_INSTRUCTIONS,
    output_modalities: ["audio"],
    ...(effort === null ? {} : { reasoning: { effort } }),
    audio: {
      input: {
        transcription: { model: "gpt-transcribe", ...(language ? { language } : {}) },
        noise_reduction: { type: "near_field" },
        turn_detection: turnDetection,
      },
      output: { voice: LIVE_VOICE, speed: SPEED[o?.rate ?? "normal"] },
    },
    tools: LIVE_TOOLS,
    tool_choice: "auto",
    max_output_tokens: 400,
    truncation: "auto",
  };
}

/** 응답 Location 헤더에서 call_id를 꺼낸다. 전체 URL과 상대 경로 둘 다 된다. 모양이 틀리면 null. */
export function parseCallId(location: string | null): string | null {
  if (!location) return null;
  let pathname: string;
  try {
    pathname = new URL(location, "https://api.openai.com").pathname;
  } catch {
    return null;
  }
  const last = pathname.split("/").filter(Boolean).pop();
  if (!last) return null;
  return CALL_ID_PATTERN.test(last) && last !== "." && last !== ".." ? last : null;
}

/** 통화를 만든다(SDP 중계). 응답 본문이 answer SDP다. 실패해도 던지지 않는다. */
export async function createRealtimeCall(
  offerSdp: string,
  session: object,
): Promise<{ ok: true; sdp: string; callId: string } | { ok: false; status: number | "timeout" | "network" | "no_call_id" }> {
  const form = new FormData();
  form.set("sdp", offerSdp);
  form.set("session", JSON.stringify(session));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  try {
    const response = await fetch(CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim() ?? ""}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    const sdp = await response.text();
    const callId = parseCallId(response.headers.get("location"));
    if (!callId) return { ok: false, status: "no_call_id" };
    return { ok: true, sdp, callId };
  } catch (error) {
    return { ok: false, status: error instanceof Error && error.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** 통화를 끊는다. 받은 HTTP 코드를 돌려준다(문서에 응답 코드가 없어 로그에 남긴다). 던지지 않는다. */
export async function hangupRealtimeCall(callId: string): Promise<number | "timeout" | "network"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HANGUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${CALLS_URL}/${encodeURIComponent(callId)}/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim() ?? ""}` },
      signal: controller.signal,
    });
    void response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 하루 자리 ----------

// 첫 통화부터 재는 고정 24시간 창이다. rateLimit.ts에는 되돌리는 함수가 없어 작은 카운터를 따로 둔다.
type DailyWindow = { startedAt: number; count: number };
let dailyWindow: DailyWindow | null = null;

/** 하루 자리를 잡는다. OpenAI를 부르기 전에, await 없이 끝난다. 실패하면 release()로 되돌린다(한 번만 듣는다). */
export function reserveDailyCall(
  now: number = Date.now(),
): { ok: true; used: number; cap: number; release(): void } | { ok: false; retryAfterSec: number } {
  if (dailyWindow && now - dailyWindow.startedAt >= DAY_MS) dailyWindow = null;
  const cap = liveDailySessionCap();
  if (cap <= 0 || (dailyWindow && dailyWindow.count >= cap)) {
    const left = dailyWindow ? DAY_MS - (now - dailyWindow.startedAt) : DAY_MS;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(left / 1000)) };
  }
  const window = (dailyWindow ??= { startedAt: now, count: 0 });
  window.count += 1;
  let released = false;
  return {
    ok: true,
    used: window.count,
    cap,
    release() {
      if (released) return;
      released = true;
      window.count = Math.max(0, window.count - 1);
    },
  };
}

// ---------- 통화 장부 ----------

const ledger = new Map<string, { maxTurns: number; at: number }>();

/** 만든 통화를 장부에 적는다. maxTurns는 미리 쓴 예산 계산에 쓴다. */
export function rememberCall(callId: string, maxTurns: number, now: number = Date.now()): void {
  ledger.set(callId, { maxTurns, at: now });
}

/**
 * 장부에서 지우고, 돌려줄 예산 수를 준다. 미리 쓴 것은 1 + maxTurns이고 실제로는 1 + turns를 썼다.
 * turns를 모르면(0 이상의 정수가 아니면) 돌려주지 않는다. 장부에 없으면 0이다.
 */
export function settleCall(callId: string, turns?: number): number {
  const entry = ledger.get(callId);
  if (!entry) return 0;
  ledger.delete(callId);
  if (turns === undefined || !Number.isInteger(turns) || turns < 0) return 0;
  return Math.max(0, entry.maxTurns - Math.min(turns, entry.maxTurns));
}

/** 세션 상한 + 15초가 지난 통화를 끊고 장부에서 지운다. 끊으려 한 통화 수를 돌려준다. */
export async function sweepCalls(now: number = Date.now()): Promise<number> {
  const limitMs = liveMaxSessionSec() * 1000 + SWEEP_GRACE_MS;
  const stale: string[] = [];
  for (const [callId, entry] of ledger) {
    if (now - entry.at > limitMs) stale.push(callId);
  }
  // 동시에 두 번 끊지 않게 await 전에 먼저 지운다.
  for (const callId of stale) ledger.delete(callId);
  await Promise.all(stale.map((callId) => hangupRealtimeCall(callId)));
  return stale.length;
}

// ---------- 예약 끊기 ----------

/** 응답을 보낸 뒤 할 일. 요청 범위 밖(단위 시험)이라 after가 던지면 바로 돌린다. */
function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
}

/** 응답 뒤에 (세션 상한 + 10초) 잠들었다가 통화를 끊고 장부에서 지운다. 같은 인스턴스가 살아 있을 때만 믿을 수 있다. */
export function scheduleHangup(
  callId: string,
  schedule: (task: () => Promise<void>) => void = afterResponse,
): void {
  schedule(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, (liveMaxSessionSec() + SCHEDULE_GRACE_SEC) * 1000));
    await hangupRealtimeCall(callId);
    settleCall(callId);
  });
}
