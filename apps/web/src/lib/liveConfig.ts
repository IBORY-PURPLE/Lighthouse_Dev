import "server-only";
import { getLlmMode } from "@/lib/llm";
import type { LiveLogMode } from "@/lib/liveLogWire";

// /live 서버 설정: 환경 변수 스위치, 상한, 실호출 예산 세기. 설계서 7.1절, 13절.
// 예산 카운터는 프로세스 메모리다. 서버를 다시 띄우면 0부터 센다.

/** 운영(VERCEL_ENV=production)에서는 LIVE_ENABLED === "on"일 때만 켜진다. 그 밖에서는 "off"가 아니면 켜진다. */
export function isLiveEnabled(): boolean {
  const value = process.env.LIVE_ENABLED?.trim().toLowerCase();
  if (process.env.VERCEL_ENV === "production") return value === "on";
  return value !== "off";
}

/** 제품별 질문과 음성 끼어들기를 켠다. 로컬 체험에서 사용한다. */
export function liveProductIntake(): boolean {
  return process.env.LIVE_PRODUCT_INTAKE?.trim().toLowerCase() === "on";
}

export function liveLocalTranscription(): boolean {
  return process.env.VERCEL !== "1" && process.env.LIVE_LOCAL_TRANSCRIPTION?.trim() === "on";
}

export function liveMicDiagnostics(): boolean {
  return liveLocalTranscription() && process.env.LIVE_MIC_DIAGNOSTICS === "on";
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

/** 상품 대화는 앱의 통화 제한이 없다. 이전 플로우는 60~280초 설정을 사용한다. */
export function liveMaxSessionSec(): number {
  if (liveProductIntake()) return 0;
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
 * LIVE_UI: /live 화면 구성. 기본 "minimal"(메인 단추 하나만. 2026-11-25 이용자 결정 "메인 단추만 남기고 다른 컴포넌트를 다 삭제").
 * "full"이면 예전 화면(큰 글자, 작은 단추 줄, 요약 카드, 대화 기록, 말 명령 안내)을 보여 준다. 화면 시험이 이 값을 쓴다.
 * 주소의 ?ui=full, ?ui=minimal이 이 값보다 먼저다.
 */
export function liveUiMode(): "minimal" | "full" {
  return process.env.LIVE_UI?.trim().toLowerCase() === "full" ? "full" : "minimal";
}

/**
 * LIVE_ADVANCE: 차례를 누가 넘기나. 기본 "auto"(말이 멎으면 앱이 AI에게 넘긴다).
 * "manual"이면 이용자가 '다음'이라고 하거나 큰 단추를 누를 때만 넘긴다(말이 잠깐 끊겨도 계속 듣는다).
 */
export function liveAdvanceMode(): "auto" | "manual" {
  return process.env.LIVE_ADVANCE?.trim().toLowerCase() === "manual" ? "manual" : "auto";
}

/**
 * LIVE_ASK_NAME: "on"이면 AI가 대화 첫 답에서 저장 사실을 알리고 성함을 한 번 여쭙는다(QA 기간에 대화 기록을 사람별로 가르는 용도).
 * 기본은 꺼짐이다. 성함은 대화 기록에만 남고 요청 항목에는 들어가지 않는다.
 */
export function liveAskName(): boolean {
  return process.env.LIVE_ASK_NAME?.trim().toLowerCase() === "on";
}

/** LIVE_REALTIME_REASONING, 기본 "minimal". "off"면 null(필드를 뺀다). */
export function liveReasoningEffort(): string | null {
  const value = process.env.LIVE_REALTIME_REASONING?.trim();
  if (!value) return "minimal";
  return value.toLowerCase() === "off" ? null : value;
}

// ---------- 대화 기록(QA 분석용) ----------

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * LIVE_LOG_UNTIL(예: 2026-12-03)의 끝 시각(ms). 한국 시간으로 그 날짜의 23:59:59.999다.
 * 환경 변수가 아예 없으면 null(끝 날짜 없음). 있는데 모양이 틀리거나(빈 값·공백 포함) 없는 날짜(2026-02-30)면 "bad".
 */
function liveLogEndMs(): number | null | "bad" {
  const value = process.env.LIVE_LOG_UNTIL;
  if (value === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return "bad";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const startUtc = Date.UTC(year, month - 1, day);
  const check = new Date(startUtc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "bad";
  return startUtc + DAY_MS - KST_OFFSET_MS - 1;
}

/** 저장이 켜져 있는지와 이유. off: 스위치 꺼짐, ended: 끝 날짜가 지남. */
export type LiveLogStatus =
  | { mode: LiveLogMode; reason: "on" }
  | { mode: null; reason: "off" | "ended" };

/**
 * LIVE_LOG: on = 참가자 표지가 있는 화면만 저장, all = 모든 화면 저장, 그 밖 = 꺼짐.
 * LIVE_LOG_UNTIL이 있으면 한국 시간으로 그 날짜의 끝까지만 저장한다.
 * LIVE_LOG_UNTIL의 모양이 틀리면 꺼짐으로 본다(오타 때문에 약속한 날짜 뒤에도 계속 저장되는 일을 막는다. 꺼지면 화면에 '기록 중'이 뜨지 않아 바로 알 수 있다).
 */
export function liveLogStatus(now: number = Date.now()): LiveLogStatus {
  const value = process.env.LIVE_LOG?.trim().toLowerCase();
  const mode: LiveLogMode | null = value === "on" ? "label" : value === "all" ? "all" : null;
  if (!mode) return { mode: null, reason: "off" };
  const end = liveLogEndMs();
  if (end === "bad") return { mode: null, reason: "off" };
  if (end !== null && now > end) return { mode: null, reason: "ended" };
  return { mode, reason: "on" };
}

/** 저장 방식. 꺼져 있거나 끝 날짜가 지났으면 null. */
export function liveLogMode(now: number = Date.now()): LiveLogMode | null {
  return liveLogStatus(now).mode;
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
