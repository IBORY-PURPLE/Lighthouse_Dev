import "server-only";
import { getLlmMode } from "@/lib/llm";

// /live 서버 설정: 환경 변수 스위치, 상한, 실호출 예산 세기. 설계서 7.1절, 13절.
// 예산 카운터는 프로세스 메모리다. 서버를 다시 띄우면 0부터 센다.

/** 운영(VERCEL_ENV=production)에서는 LIVE_ENABLED === "on"일 때만 켜진다. 그 밖에서는 "off"가 아니면 켜진다. */
export function isLiveEnabled(): boolean {
  const value = process.env.LIVE_ENABLED?.trim().toLowerCase();
  if (process.env.VERCEL_ENV === "production") return value === "on";
  return value !== "off";
}

export type RealtimeGate = { ok: true } | { ok: false; reason: "disabled" | "mock" | "no_key" };

/** LIVE_REALTIME === "on" 이고 mock이 아니고 키가 있을 때만 Realtime을 쓴다. */
export function realtimeGate(): RealtimeGate {
  if (process.env.LIVE_REALTIME?.trim().toLowerCase() !== "on") return { ok: false, reason: "disabled" };
  if (getLlmMode() === "mock") return { ok: false, reason: "mock" };
  if (!process.env.OPENAI_API_KEY?.trim()) return { ok: false, reason: "no_key" };
  return { ok: true };
}

export const LIVE_REALTIME_MODEL_DEFAULT = "gpt-realtime-2.1-mini";
export const LIVE_VOICE = "marin";
export const LIVE_WARN_BEFORE_SEC = 60;
/** 한 통화에서 보낼 수 있는 response.create 수. */
export const LIVE_MAX_TURNS = 30;
/** 글자 대화 하루 턴 상한(인스턴스별). */
export const LIVE_CHAT_DAILY_CAP = 600;

/** 정수로 읽고 범위로 자른다. 숫자가 아니면 기본값. */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^-?\d+$/.test(raw)) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

/** LIVE_MAX_SESSION_SEC, 기본 270, 60~280으로 자른다. */
export function liveMaxSessionSec(): number {
  return intEnv("LIVE_MAX_SESSION_SEC", 270, 60, 280);
}

/**
 * LIVE_CALL_IP_LIMIT: 주소 하나가 10분 동안 만들 수 있는 Realtime 통화 수. 기본 3, 1~60.
 * 로컬에서 되풀이해 시험할 때만 올린다(로컬은 모든 요청의 주소가 같아 세 번째 대화 뒤로 예비 엔진으로 떨어진다).
 */
export function liveCallIpLimit(): number {
  return intEnv("LIVE_CALL_IP_LIMIT", 3, 1, 60);
}

/** LIVE_DAILY_SESSION_CAP, 기본 10, 0~200. */
export function liveDailySessionCap(): number {
  return intEnv("LIVE_DAILY_SESSION_CAP", 10, 0, 200);
}

/** LIVE_TRANSCRIBE_LANG, 기본 "ko". ""면 language를 뺀다. */
export function liveTranscribeLang(): string {
  const value = process.env.LIVE_TRANSCRIBE_LANG;
  return value === undefined ? "ko" : value.trim();
}

/** LIVE_REALTIME_VAD, 기본 "server"(server_vad, 침묵 1.2초). "semantic"이면 semantic_vad. */
export function liveVadMode(): "semantic" | "server" {
  // 기본은 server(침묵 1.2초 뒤에 차례를 넘긴다). 실호출(2026-11-24)에서 semantic은 두 문장 사이의 쉼에서 차례를 끊어
  // 뒷말이 버려지는 일이 있었다. 말하다 잠깐 쉬는 이용자를 기다리는 쪽을 기본으로 둔다.
  return process.env.LIVE_REALTIME_VAD?.trim().toLowerCase() === "semantic" ? "semantic" : "server";
}

/**
 * LIVE_ADVANCE: 차례를 누가 넘기나. 기본 "auto"(말이 멎으면 앱이 AI에게 넘긴다).
 * "manual"이면 이용자가 '다음'이라고 하거나 큰 단추를 누를 때만 넘긴다(말이 잠깐 끊겨도 계속 듣는다).
 */
export function liveAdvanceMode(): "auto" | "manual" {
  return process.env.LIVE_ADVANCE?.trim().toLowerCase() === "manual" ? "manual" : "auto";
}

/** LIVE_REALTIME_REASONING, 기본 "minimal". "off"면 null(필드를 뺀다). */
export function liveReasoningEffort(): string | null {
  const value = process.env.LIVE_REALTIME_REASONING?.trim();
  if (!value) return "minimal";
  return value.toLowerCase() === "off" ? null : value;
}

// ---------- 실호출 예산(로컬 강제 상한) ----------

let realCallsUsed = 0;

/** LIVE_REAL_CALL_BUDGET이 0 이상의 정수일 때만 상한이다. 없거나 틀리면 제한하지 않는다(null). */
function realCallLimit(): number | null {
  const raw = process.env.LIVE_REAL_CALL_BUDGET?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** 유료 호출 n회를 미리 쓴다. 상한을 넘기면 쓰지 않고 ok:false. 제한이 없으면 세기만 한다. */
export function spendRealCalls(n: number): { ok: boolean; used: number; limit: number | null } {
  const limit = realCallLimit();
  if (limit !== null && realCallsUsed + n > limit) return { ok: false, used: realCallsUsed, limit };
  realCallsUsed += n;
  return { ok: true, used: realCallsUsed, limit };
}

/** 쓰지 않은 호출을 돌려준다. 0 밑으로는 내려가지 않는다. */
export function refundRealCalls(n: number): void {
  realCallsUsed = Math.max(0, realCallsUsed - n);
}

/** 남은 호출 수. 제한이 없으면 null. */
export function realCallsLeft(): number | null {
  const limit = realCallLimit();
  return limit === null ? null : Math.max(0, limit - realCallsUsed);
}

/** 로그 꼬리표 " budget=<쓴 수>/<상한>". 제한이 없으면 "". */
export function realCallTail(): string {
  const limit = realCallLimit();
  return limit === null ? "" : ` budget=${realCallsUsed}/${limit}`;
}
