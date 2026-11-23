// /live 상태 기계: 순수 함수 liveStep(상태, 사건 → 상태, 효과)과 접수 관문 canRegister. 설계서 5절, 12.2절.
// 시계, DOM, 네트워크, 난수를 쓰지 않는다. 시간은 TIMER_SET 효과와 TIMER 사건으로만 다룬다.
import {
  BUTTONS,
  hasQuestion,
  isCardEcho,
  isClearConsent,
  isPlausibleConsent,
  isScreenReaderEcho,
  matchLocalCommand,
  type LocalCommand,
} from "@/lib/liveCommands";
import type {
  EarconName,
  EngineEvent,
  EngineKind,
  InputMode,
  LiveDraft,
  LiveErrorKind,
  LiveTurn,
} from "@/lib/liveEngine";
import { errorScriptFor, guideFor, script, type ScriptId } from "@/lib/liveScripts";
import {
  CONNECT_SAY_MS,
  CONNECT_TIMEOUT_MS,
  CONTROL_HOLD_MS,
  MAX_AI_FAILURES,
  MAX_LATE_REOPENS,
  MAX_RATE_RETRIES,
  MAX_RECONNECTS,
  MIC_WAIT_MS,
  PAUSED_END_MS,
  PAUSED_WARN_MS,
  REALTIME_IDLE_CLOSE_MS,
  REGISTER_SAY_MS,
  RELISTEN_DELAYS_MS,
  RETRY_AFTER_CAP_MS,
  SILENCE_STEPS_MS,
  SPEAK_GUARD_MAX_MS,
  THINK_TIMEOUT_MS,
  USER_TURN_MAX,
  WAIT_SAY1_MS,
  WAIT_SAY2_MS,
} from "@/lib/liveTiming";
import { cutText, EMPTY_SLOTS, encodeAiTurn, toDraft } from "@/lib/liveText";

export type LivePhase =
  | "idle" | "guiding" | "connecting" | "listening" | "thinking" | "speaking"
  | "confirming" | "registering" | "done" | "error" | "paused" | "ended";

export interface LiveState {
  phase: LivePhase;
  engine: EngineKind | null;          // READY를 준 엔진. 없으면 null
  engineReady: boolean;               // 엔진이 READY를 주었고 닫히지 않았다
  realtimeHint: boolean;              // /api/live/config가 realtime:true라고 했다(CONFIG 사건)
  fallbackOnly: boolean;              // 참이면 이 대화에서는 Realtime을 다시 쓰지 않는다
  speechAvailable: boolean;           // 브라우저 음성 인식 생성자가 있다
  inputMode: InputMode;               // "voice" | "text"
  tts: boolean;                       // speechSynthesis를 쓸 수 있다
  speaking: string | null;            // 지금 기기 목소리로 읽는 대본 id
  mic: "off" | "on" | "held";         // held: 단추를 찾는 동안 잠시 닫음
  micOnce: boolean;                   // 이 페이지에서 듣기가 한 번이라도 실제로 시작됐다
  hidden: boolean;                    // 화면이 숨겨져 있다(HIDDEN·VISIBLE)
  cid: string;                        // 대화 id = 접수 clientRequestId
  visit: "first" | "returning";
  history: LiveTurn[];                // 엔진을 바꿔도 이어지는 기록
  draft: LiveDraft | null;            // 확인받을(받은) 내용. summary는 앱이 만든다(6.4절)
  pendingConfirm: boolean;            // 확인 문장을 읽고 나면 confirming으로 간다
  awaitingConsent: boolean;           // 방금 확인 문장을 읽어 주었고 동의를 기다린다
  consentText: string | null;         // awaitingConsent가 켜진 뒤에 받은 이용자 말. 아직 없으면 null
  pendingTurn: { text: string; source: "voice" | "text" } | null;  // 답을 기다리는 이용자 차례(다시 보낼 때 쓴다)
  ask: null | "end" | "extend";       // 앱이 예·아니오를 물어 둔 것
  lastReply: string;                  // 다시 듣기용
  resumeTo: "listening" | "confirming" | null;  // connecting·paused·ended에서 돌아갈 곳
  settleNext: boolean;                // 다음 차례 열기에 1초 뜸을 들인다
  sessionWarnPending: boolean;        // 다음 차례 열기 전에 세션 예고를 읽는다
  error: LiveErrorKind | null;
  silenceStep: 0 | 1 | 2 | 3;
  silenceArmed: boolean;              // 침묵 타이머가 걸려 있다
  relistens: number;                  // 이 차례에서 말 없이 다시 들은 횟수
  lateReopens: number;                // 허용 창 때문에 차례를 다시 연 횟수(페이지 단위)
  aiFailures: number;
  rateRetries: number;                // 429 뒤 저절로 다시 보낸 횟수
  reconnects: number;                 // Realtime 재연결 횟수
  helpDepth: 0 | 1;                   // 도움말을 이어서 두 번 청하면 자세한 도움말
  rate: "slow" | "normal" | "fast";
  sendPending: boolean;               // 접수 요청이 가는 중이다
  requestId: string | null;
  queueNumber: number | null;
  resultUnspoken: boolean;            // 화면이 숨겨진 동안 접수 결과가 왔다
}

export type LiveEvent =
  | { type: "CONFIG"; realtime: boolean }              // /api/live/config 응답
  | { type: "START" }
  | EngineEvent                                        // 6절
  | { type: "MIC_READY" } | { type: "MIC_DENIED" }     // Realtime용 마이크 요청 결과(실행기가 넣는다)
  | { type: "SPEAK_END"; id: string }                  // 기기 목소리 읽기가 끝남
  | { type: "MAIN_BUTTON" } | { type: "CONSENT_BUTTON" } | { type: "EDIT_BUTTON" }
  | { type: "REPEAT" } | { type: "HELP" } | { type: "PAUSE" } | { type: "RESUME" } | { type: "RATE_BUTTON" }
  | { type: "EXIT" } | { type: "CONTINUE" } | { type: "NEW_REQUEST"; cid: string } | { type: "RETRY" }
  | { type: "TEXT_SUBMIT"; text: string }              // 글자 입력
  | { type: "HOLD_ACTIVATE" } | { type: "HOLD_SUBMIT" } | { type: "HOLD_CANCEL" }
  | { type: "CONTROL_TOUCH" }                          // 듣는 중에 단추로 초점·접촉이 옴
  | { type: "TIMER"; id: TimerId }
  | { type: "HIDDEN" } | { type: "VISIBLE" }
  | { type: "REGISTER_BUSY" }                          // 접수가 429를 받아 잠시 뒤 다시 보낸다
  | { type: "REGISTER_OK"; requestId: string; queueNumber: number; status: string }
  | { type: "REGISTER_FAIL"; kind: "retryable" | "unknown" | "rejected" | "conflict" };

export type LiveEffect =
  | { type: "EARCON"; name: EarconName }
  | { type: "WAIT_PULSE"; on: boolean }                // 대기 펄스 반복 켜기·끄기
  | { type: "SPEAK"; id: string; text: string }        // 기기 목소리. 끝나면 SPEAK_END{id}
  | { type: "STOP_SPEAK" }
  | { type: "ANNOUNCE"; channel: "status" | "alert"; text: string; endId?: string }
  | { type: "OPEN_TURN"; earcon: "turn" | "confirm"; settle: boolean; keep: boolean }  // (뜸) → 신호음 → 150ms → 마이크
  | { type: "RELISTEN" }                               // 신호음 없이 인식만 다시 시작
  | { type: "ENGINE_START"; kind: EngineKind }         // realtime이면 실행기가 마이크부터 받는다
  | { type: "ENGINE_HOLD" } | { type: "ENGINE_SUBMIT" }
  | { type: "ENGINE_CANCEL_LISTEN"; discard: boolean }
  | { type: "ENGINE_RESPOND"; text: string; source: "voice" | "text"; history: LiveTurn[] }
  | { type: "ENGINE_CANCEL_RESPONSE" }
  | { type: "ENGINE_TOOL_RESULT"; callId: string; output: object; respond: boolean }
  | { type: "ENGINE_SET_RATE"; rate: "slow" | "normal" | "fast" }
  | { type: "ENGINE_CLOSE" }
  | { type: "TIMER_SET"; id: TimerId; ms: number } | { type: "TIMER_CLEAR"; id: TimerId }
  | { type: "REGISTER" }                               // 지금 draft와 cid로 접수
  | { type: "SAVE_RECORD" } | { type: "ATTACH_PUSH" }
  | { type: "VISIT_MARK" }
  | { type: "FOCUS"; target: "main" | "listLink" | "textInput" }
  | { type: "RELEASE_MIC" } | { type: "WAKE_LOCK"; on: boolean };

export type TimerId =
  | "micWait" | "connect" | "connectSay" | "relisten" | "silence" | "controlHold"
  | "waitSay1" | "waitSay2" | "think" | "retryAfter" | "speakGuard"
  | "registerSay" | "pausedWarn" | "pausedEnd" | "idleClose";

const ALL_TIMERS: TimerId[] = [
  "micWait", "connect", "connectSay", "relisten", "silence", "controlHold",
  "waitSay1", "waitSay2", "think", "retryAfter", "speakGuard",
  "registerSay", "pausedWarn", "pausedEnd", "idleClose",
];

// 설계서가 값을 주지 않은 곳(429에 Retry-After가 없을 때)의 기본 대기. 직접 정했다.
const DEFAULT_RETRY_AFTER_MS = 3_000;

export function createInitialLive(o: {
  cid: string; visit: "first" | "returning"; tts: boolean; speechAvailable: boolean;
}): LiveState {
  return {
    phase: "idle",
    engine: null,
    engineReady: false,
    realtimeHint: false,
    fallbackOnly: false,
    speechAvailable: o.speechAvailable,
    inputMode: o.speechAvailable ? "voice" : "text",
    tts: o.tts,
    speaking: null,
    mic: "off",
    micOnce: false,
    hidden: false,
    cid: o.cid,
    visit: o.visit,
    history: [],
    draft: null,
    pendingConfirm: false,
    awaitingConsent: false,
    consentText: null,
    pendingTurn: null,
    ask: null,
    lastReply: "",
    resumeTo: null,
    settleNext: false,
    sessionWarnPending: false,
    error: null,
    silenceStep: 0,
    silenceArmed: false,
    relistens: 0,
    lateReopens: 0,
    aiFailures: 0,
    rateRetries: 0,
    reconnects: 0,
    helpDepth: 0,
    rate: "normal",
    sendPending: false,
    requestId: null,
    queueNumber: null,
    resultUnspoken: false,
  };
}

/** 접수해도 되는가(12.2절). text는 source가 "speech"일 때 이용자 말이다. */
export function canRegister(state: LiveState, source: "button" | "speech" | "model", text?: string): boolean {
  if (!state.draft || state.draft.product.trim() === "") return false;
  if (!state.awaitingConsent) return false;
  if (state.sendPending || state.requestId !== null) return false;
  if (source === "button") return true;
  if (source === "speech") return text !== undefined && isClearConsent(text);
  const consent = state.consentText;
  return consent !== null && (isClearConsent(consent) || isPlausibleConsent(consent));
}

// ---------------------------------------------------------------------------
// 내부 도우미. 상태는 복사본(c.s)만 고치고, 효과는 c.fx에 쌓는다.

interface Cx { s: LiveState; fx: LiveEffect[] }

const isListenPhase = (p: LivePhase) => p === "listening" || p === "confirming";
const isRunning = (p: LivePhase) => p === "listening" || p === "thinking" || p === "speaking" || p === "confirming";
const isActive = (p: LivePhase) => p === "guiding" || p === "connecting" || isRunning(p);

const userCell = (text: string): LiveTurn => ({ role: "user", content: cutText(text, USER_TURN_MAX) });
const aiCell = (reply: string, status: "asking" | "confirming", slots: LiveDraft | typeof EMPTY_SLOTS): LiveTurn => ({
  role: "assistant",
  content: encodeAiTurn({ reply, status, slots }),
});

function setTimer(c: Cx, id: TimerId, ms: number): void {
  c.fx.push({ type: "TIMER_SET", id, ms });
}
function clearTimers(c: Cx, ...ids: TimerId[]): void {
  for (const id of ids) c.fx.push({ type: "TIMER_CLEAR", id });
}

/** 기기 목소리로 읽는다. 목소리를 못 쓰면 같은 글을 ANNOUNCE로 내고 endId를 싣는다. */
function say(c: Cx, id: string, text: string, channel: "status" | "alert" = "status"): void {
  if (c.s.tts) c.fx.push({ type: "SPEAK", id, text });
  else c.fx.push({ type: "ANNOUNCE", channel, text, endId: id });
  c.s.speaking = id;
}
function sayScript(c: Cx, id: ScriptId, vars?: { n?: number; s?: number; summary?: string }): void {
  say(c, id, script(id, vars));
}
const confirmText = (s: LiveState, id: "confirmAgain" | "confirmRetell") =>
  script(id, { summary: s.draft?.summary ?? "" });

function stopSpeak(c: Cx): void {
  c.fx.push({ type: "STOP_SPEAK" });
  c.s.speaking = null;
}

/** 시작한 엔진 종류. 시작 때 정해진 두 값으로 다시 구한다. */
const startedKind = (s: LiveState): EngineKind => (s.fallbackOnly || !s.realtimeHint ? "fallback" : "realtime");

/**
 * 도착 상태로 옮긴다. 듣기(listening, confirming)를 떠나면 타이머와 마이크를 정리한다(5.5절 "듣기를 떠날 때").
 * handled: 호출한 쪽이 이미 듣기 닫기와 타이머를 처리했다.
 */
function go(
  c: Cx,
  to: LivePhase,
  o: { engineEnded?: boolean; discard?: boolean; handled?: boolean } = {},
): void {
  const s = c.s;
  if (isListenPhase(s.phase) && s.phase !== to) {
    if (!o.handled) {
      clearTimers(c, "silence", "relisten", "controlHold");
      if (!o.engineEnded) c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: o.discard ?? false });
    }
    s.mic = "off";
    s.silenceArmed = false;
  }
  if (!isListenPhase(to)) {
    s.mic = "off";
    s.silenceArmed = false;
  }
  s.phase = to;
  if (to === "listening") {
    s.awaitingConsent = false;
    s.consentText = null;
  }
}

/** 앱이 대본을 읽기 전에 마이크를 닫는다(5.5절 "말한 뒤 다시 열기 규칙"). 상태는 그대로 둔다. */
function closeMic(c: Cx): void {
  const s = c.s;
  if (s.mic !== "off") c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: false });
  s.mic = "off";
  clearTimers(c, "silence", "relisten", "controlHold");
  s.silenceArmed = false;
}

/** 차례 열기(listening) 또는 확인 열기(confirming). 글자 모드는 신호음과 입력 칸 초점만 낸다. */
function openTurn(c: Cx, o: { settle?: boolean; keep?: boolean; noWarn?: boolean } = {}): void {
  const s = c.s;
  const kind: "turn" | "confirm" = s.phase === "confirming" ? "confirm" : "turn";
  if (s.sessionWarnPending && !o.noWarn) {
    s.sessionWarnPending = false;
    closeMic(c);
    sayScript(c, "sessionWarn");
    return;
  }
  clearTimers(c, "silence", "relisten", "controlHold");
  const settle = (o.settle ?? false) || s.settleNext;
  s.settleNext = false;
  s.silenceArmed = false;
  s.relistens = 0;
  if (s.inputMode === "text") {
    s.mic = "off";
    c.fx.push({ type: "EARCON", name: kind });
    c.fx.push({ type: "FOCUS", target: "textInput" });
    return;
  }
  s.mic = "on";
  c.fx.push({ type: "OPEN_TURN", earcon: kind, settle, keep: o.keep ?? false });
}

/** 답 받기(5.5절). */
function receiveAnswer(c: Cx, success: boolean): void {
  const s = c.s;
  c.fx.push({ type: "WAIT_PULSE", on: false });
  stopSpeak(c);
  clearTimers(c, "waitSay1", "waitSay2", "think", "retryAfter");
  s.pendingTurn = null;
  if (success) {
    s.aiFailures = 0;
    s.rateRetries = 0;
  }
}

/** 답을 기다리던 이용자 칸을 기록에서 뺀다(AI가 그 말을 받지 못했으므로 다시 말하면 다시 들어간다). */
function dropPending(c: Cx): void {
  const s = c.s;
  const pt = s.pendingTurn;
  if (!pt || pt.text === "") return;
  const last = s.history[s.history.length - 1];
  if (last && last.role === "user" && last.content === userCell(pt.text).content) {
    s.history = s.history.slice(0, -1);
  }
}

/** 다시 보낼 때 쓰는 기록. 이번 이용자 칸은 뺀다. */
function historyForRespond(s: LiveState): LiveTurn[] {
  const pt = s.pendingTurn;
  const last = s.history[s.history.length - 1];
  if (pt && pt.text !== "" && last && last.role === "user" && last.content === userCell(pt.text).content) {
    return s.history.slice(0, -1);
  }
  return s.history;
}

function startEngine(c: Cx): void {
  const s = c.s;
  s.engineReady = false;
  s.engine = null;
  if (startedKind(s) === "fallback") {
    c.fx.push({ type: "ENGINE_START", kind: "fallback" });
    setTimer(c, "connect", CONNECT_TIMEOUT_MS);
    // 연결이 CONNECT_SAY_MS를 넘길 때만 "연결하고 있어요"를 알린다(READY가 지운다).
    setTimer(c, "connectSay", CONNECT_SAY_MS);
  } else {
    c.fx.push({ type: "ENGINE_START", kind: "realtime" });
    setTimer(c, "micWait", MIC_WAIT_MS);
  }
}

/** Realtime을 포기하고 fallback으로 다시 시작한다(connecting 안). */
function switchToFallback(c: Cx): void {
  const s = c.s;
  s.fallbackOnly = true;
  c.fx.push({ type: "WAIT_PULSE", on: false });
  clearTimers(c, "micWait", "connect", "connectSay");
  c.fx.push({ type: "ENGINE_CLOSE" });
  c.fx.push({ type: "RELEASE_MIC" });
  startEngine(c);
}

function afterConnect(c: Cx): void {
  const s = c.s;
  const resume = s.resumeTo;
  s.resumeTo = null;
  if (resume === "confirming" && s.draft) {
    go(c, "speaking");
    s.pendingConfirm = true;
    say(c, "confirm", confirmText(s, "confirmAgain"));
  } else {
    go(c, "listening");
    openTurn(c);
  }
}

function skipGuide(c: Cx): void {
  const s = c.s;
  stopSpeak(c);
  c.fx.push({ type: "VISIT_MARK" });
  s.resumeTo = "listening";
  s.settleNext = true;
  go(c, "connecting");
  startEngine(c);
}

function beginGuide(c: Cx, visit: "first" | "returning" | "new"): void {
  const s = c.s;
  c.fx.push({ type: "WAKE_LOCK", on: true });
  const voice = s.speechAvailable || (s.realtimeHint && !s.fallbackOnly);
  s.inputMode = voice ? "voice" : "text";
  const gid = guideFor(visit, s.inputMode);
  const text = script(gid) + (s.inputMode === "voice" && !s.micOnce ? ` ${script("micHint")}` : "");
  if (s.history.length === 0) s.history = [aiCell(text, "asking", EMPTY_SLOTS)];
  go(c, "guiding");
  say(c, gid, text);
}

// ----- 큰 전이: paused, ended, error, registering, thinking -----

function enterPaused(c: Cx, o: { read?: ScriptId; silent?: boolean } = {}): void {
  const s = c.s;
  const from = s.phase;
  if (from === "guiding") c.fx.push({ type: "VISIT_MARK" });
  s.resumeTo = from === "confirming" ? "confirming" : from === "connecting" && s.resumeTo ? s.resumeTo : "listening";
  clearTimers(c, ...ALL_TIMERS);
  c.fx.push({ type: "WAIT_PULSE", on: false });
  c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: false });
  c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
  stopSpeak(c);
  if (from === "connecting") {
    // 연결 중에 멈추면 늦게 오는 엔진을 닫는다. 이어 갈 때 새로 연결한다.
    c.fx.push({ type: "ENGINE_CLOSE" });
    s.engine = null;
    s.engineReady = false;
  }
  dropPending(c);
  s.pendingConfirm = false;
  s.awaitingConsent = false;
  s.consentText = null;
  s.pendingTurn = null;
  go(c, "paused", { handled: true });
  if (!o.silent) {
    c.fx.push({ type: "EARCON", name: "pause" });
    if (o.read) sayScript(c, o.read);
  }
  setTimer(c, "pausedWarn", PAUSED_WARN_MS);
  setTimer(c, "pausedEnd", PAUSED_END_MS);
  if (s.engine === "realtime" && s.engineReady) setTimer(c, "idleClose", REALTIME_IDLE_CLOSE_MS);
}

function enterEnded(c: Cx, o: { script?: ScriptId } = {}): void {
  const s = c.s;
  const from = s.phase;
  if ((from === "paused" || from === "connecting") && s.resumeTo !== null) {
    // 이미 정해 둔 돌아갈 곳을 지킨다.
  } else {
    s.resumeTo = from === "confirming" || from === "registering" ? "confirming" : "listening";
  }
  clearTimers(c, ...ALL_TIMERS);
  c.fx.push({ type: "WAIT_PULSE", on: false });
  stopSpeak(c);
  c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: false });
  c.fx.push({ type: "ENGINE_CLOSE" });
  c.fx.push({ type: "RELEASE_MIC" });
  c.fx.push({ type: "WAKE_LOCK", on: false });
  dropPending(c);
  s.engineReady = false;
  s.engine = null;
  s.pendingConfirm = false;
  s.awaitingConsent = false;
  s.consentText = null;
  s.pendingTurn = null;
  s.ask = null;
  s.sessionWarnPending = false;
  go(c, "ended", { handled: true });
  c.fx.push({ type: "EARCON", name: "end" });
  let id: ScriptId;
  if (o.script) id = o.script;
  else if (s.sendPending) id = "endedSending";
  else if (s.requestId !== null) id = "endedRegistered";
  else if (s.history.some((t) => t.role === "user")) id = "endedUnregistered";
  else id = "endedEmpty";
  sayScript(c, id);
}

function enterError(c: Cx, kind: LiveErrorKind): void {
  const s = c.s;
  dropPending(c);
  clearTimers(c, ...ALL_TIMERS);
  c.fx.push({ type: "WAIT_PULSE", on: false });
  stopSpeak(c);
  c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: false });
  c.fx.push({ type: "ENGINE_CLOSE" });
  c.fx.push({ type: "RELEASE_MIC" });
  c.fx.push({ type: "WAKE_LOCK", on: false });
  s.engineReady = false;
  s.engine = null;
  s.pendingConfirm = false;
  s.awaitingConsent = false;
  s.consentText = null;
  s.pendingTurn = null;
  s.ask = null;
  s.sendPending = false;
  s.error = kind;
  go(c, "error", { handled: true });
  c.fx.push({ type: "EARCON", name: "error" });
  const id = errorScriptFor(kind, true);
  say(c, id, script(id), "alert");
}

function enterThinking(c: Cx, o: { engineEnded: boolean }): void {
  if (c.s.speaking !== null) stopSpeak(c);
  go(c, "thinking", { engineEnded: o.engineEnded });
  c.fx.push({ type: "EARCON", name: "sent" });
  c.fx.push({ type: "WAIT_PULSE", on: true });
  setTimer(c, "waitSay1", WAIT_SAY1_MS);
  setTimer(c, "waitSay2", WAIT_SAY2_MS);
  setTimer(c, "think", THINK_TIMEOUT_MS);
}

/** registering으로 들어간다(5.5절 접수 표). callId가 있으면 Realtime 도구 호출을 닫는다. */
function startRegister(c: Cx, callId?: string): void {
  const s = c.s;
  clearTimers(c, "waitSay1", "waitSay2", "think", "retryAfter", "speakGuard", "silence", "relisten", "controlHold");
  go(c, "registering", { handled: true });
  s.sendPending = true;
  s.ask = null;
  s.awaitingConsent = false;
  s.pendingConfirm = false;
  s.pendingTurn = null;
  c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: false });
  c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
  if (callId !== undefined) c.fx.push({ type: "ENGINE_TOOL_RESULT", callId, output: { ok: true }, respond: false });
  stopSpeak(c);
  c.fx.push({ type: "EARCON", name: "sent" });
  c.fx.push({ type: "WAIT_PULSE", on: true });
  c.fx.push({ type: "REGISTER" });
  setTimer(c, "registerSay", REGISTER_SAY_MS);
}

/** 확인 문장을 읽는다(TURN_RESULT confirming, Realtime의 확인 요청이 끝났을 때). 기록에 AI 칸(confirming)을 넣는다. */
function speakConfirm(c: Cx): void {
  const s = c.s;
  receiveAnswer(c, true);
  clearTimers(c, "speakGuard");
  const text = confirmText(s, "confirmAgain");
  if (s.draft) s.history = [...s.history, aiCell(text, "confirming", s.draft)];
  s.lastReply = text;
  go(c, "speaking");
  say(c, "confirm", text);
}

/** AI 답을 다 읽은 뒤 이용자 차례로 간다(speaking → listening). */
function afterAnswer(c: Cx): void {
  const s = c.s;
  s.awaitingConsent = false;
  s.consentText = null;
  s.silenceStep = 0;
  clearTimers(c, "speakGuard");
  if (s.speaking !== null) stopSpeak(c);
  go(c, "listening");
  openTurn(c);
}

/** 모델이 접수를 요청했다(INTENT register 또는 fallback의 done). */
function onRegisterIntent(c: Cx, callId?: string): void {
  const s = c.s;
  if (canRegister(s, "model")) {
    startRegister(c, callId);
    return;
  }
  clearTimers(c, "speakGuard");
  receiveAnswer(c, true);
  c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
  if (s.draft && s.draft.product.trim() !== "") {
    s.pendingConfirm = true;
    go(c, "speaking");
    say(c, "confirm", confirmText(s, "confirmRetell"));
  } else {
    s.awaitingConsent = false;
    s.consentText = null;
    go(c, "listening");
    sayScript(c, "failed");
  }
  if (callId !== undefined) {
    c.fx.push({ type: "ENGINE_TOOL_RESULT", callId, output: { ok: false, error: "need_consent" }, respond: false });
  }
}

/** 모델이 끝내기를 요청했다(INTENT end 또는 fallback의 ended). */
function onEndIntent(c: Cx, callId?: string): void {
  const s = c.s;
  clearTimers(c, "speakGuard");
  receiveAnswer(c, true);
  c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
  s.awaitingConsent = false;
  s.consentText = null;
  s.pendingConfirm = false;
  s.ask = "end";
  go(c, "listening");
  sayScript(c, "endAsk");
  if (callId !== undefined) c.fx.push({ type: "ENGINE_TOOL_RESULT", callId, output: { ok: true }, respond: false });
}

/** 말과 인식을 멈춘다(HELP, REPEAT, 빠르기 바꾸기가 쓴다). thinking·speaking에서 왔으면 listening으로 간다. */
function interrupt(c: Cx): void {
  const s = c.s;
  if (s.phase === "thinking" || s.phase === "speaking") {
    dropPending(c);
    stopSpeak(c);
    c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
    receiveAnswer(c, false);
    clearTimers(c, "speakGuard");
    s.pendingConfirm = false;
    s.awaitingConsent = false;
    s.consentText = null;
    go(c, "listening");
  } else if (isListenPhase(s.phase)) {
    closeMic(c);
  }
}

function doHelp(c: Cx): void {
  const s = c.s;
  if (s.phase === "guiding") skipGuide(c);
  else if (isRunning(s.phase)) interrupt(c);
  else return;
  const voice = s.inputMode === "voice";
  if (s.helpDepth === 0) {
    s.helpDepth = 1;
    sayScript(c, voice ? "helpVoice" : "helpText");
  } else {
    s.helpDepth = 0;
    sayScript(c, voice ? "helpMoreVoice" : "helpText");
  }
}

/** 다시 듣기. lastReply가 없으면 false. */
function doRepeat(c: Cx): boolean {
  const s = c.s;
  if (!isRunning(s.phase) || s.lastReply === "") return false;
  s.helpDepth = 0;
  interrupt(c);
  if (s.phase === "confirming") sayScript(c, "confirmAgain", { summary: s.draft?.summary ?? "" });
  else say(c, "repeat", s.lastReply);
  return true;
}

function applyRate(c: Cx, rate: "slow" | "normal" | "fast"): void {
  const s = c.s;
  s.helpDepth = 0;
  s.rate = rate;
  const id: ScriptId = rate === "slow" ? "rateSlow" : rate === "fast" ? "rateFast" : "rateNormal";
  if (s.phase === "guiding") {
    skipGuide(c);
    c.fx.push({ type: "ENGINE_SET_RATE", rate });
    sayScript(c, id);
  } else if (isRunning(s.phase)) {
    interrupt(c);
    c.fx.push({ type: "ENGINE_SET_RATE", rate });
    sayScript(c, id);
  }
}

function noSpeech(c: Cx): void {
  const s = c.s;
  if (s.mic !== "on") return;
  const delay = RELISTEN_DELAYS_MS[Math.min(s.relistens, RELISTEN_DELAYS_MS.length - 1)];
  s.relistens += 1;
  setTimer(c, "relisten", delay);
}

function runCommand(c: Cx, cmd: LocalCommand): void {
  const s = c.s;
  if (cmd === "help") {
    doHelp(c);
    return;
  }
  s.helpDepth = 0;
  switch (cmd) {
    case "repeat":
      if (!doRepeat(c)) openTurn(c);
      return;
    case "pause":
      enterPaused(c, { read: "pausedByUser" });
      return;
    case "slow":
      applyRate(c, "slow");
      return;
    case "fast":
      applyRate(c, "fast");
      return;
    case "normal":
      applyRate(c, "normal");
      return;
    case "end":
      closeMic(c);
      s.ask = "end";
      sayScript(c, "endAsk");
      return;
  }
}

/** 이용자 말이 끝났을 때의 판정 순서(5.8절). */
function onUtterance(c: Cx, raw: string, source: "voice" | "text", engineEnded: boolean): void {
  const s = c.s;
  const text = cutText(raw.trim(), USER_TURN_MAX);
  if (text === "") {
    if (source === "voice") noSpeech(c);
    return;
  }
  // 1. 메아리 거르기(음성 입력만)
  if (source === "voice" && (isScreenReaderEcho(text) || (s.phase === "confirming" && isCardEcho(text, s.draft)))) {
    noSpeech(c);
    return;
  }
  // 2. 계속 들을까요?에 대한 답
  if (s.ask === "extend") {
    s.ask = null;
    s.silenceStep = 0;
    if (isClearConsent(text)) {
      openTurn(c);
      return;
    }
  }
  // 3. 끝낼까요?에 대한 답
  if (s.ask === "end") {
    if (isClearConsent(text)) {
      enterEnded(c);
      return;
    }
    s.ask = null;
  }
  // 4. 말 명령
  const cmd = matchLocalCommand(text);
  if (cmd !== null) {
    runCommand(c, cmd);
    return;
  }
  // 5. 확인 상태의 되묻는 말과 분명한 동의
  if (s.phase === "confirming") {
    if (hasQuestion(text) && isClearConsent(text.replace(/[?？]/g, ""))) {
      closeMic(c);
      sayScript(c, "confirmAgain", { summary: s.draft?.summary ?? "" });
      return;
    }
    if (canRegister(s, "speech", text)) {
      startRegister(c);
      return;
    }
  }
  // 6. 그 밖: AI에게 보낸다
  s.helpDepth = 0;
  if (s.awaitingConsent) s.consentText = text;
  const before = s.history;
  s.history = [...before, userCell(text)];
  s.pendingTurn = { text, source };
  enterThinking(c, { engineEnded });
  c.fx.push({ type: "ENGINE_RESPOND", text, source, history: before });
}

// ----- 사건별 처리 -----

function onListenStarted(c: Cx, late: boolean): void {
  const s = c.s;
  if (!isListenPhase(s.phase) || s.mic !== "on") return;
  s.micOnce = true;
  if (late && s.lateReopens < MAX_LATE_REOPENS) {
    s.lateReopens += 1;
    c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: true });
    openTurn(c, { settle: true });
    return;
  }
  if (!s.silenceArmed) {
    setTimer(c, "silence", SILENCE_STEPS_MS[s.silenceStep]);
    s.silenceArmed = true;
  }
}

function onSilenceTimer(c: Cx): void {
  const s = c.s;
  if (!isListenPhase(s.phase) || !s.silenceArmed) return;
  s.silenceArmed = false;
  if (s.silenceStep === 0 || s.silenceStep === 1) {
    const id: ScriptId = s.silenceStep === 0 ? "silence1" : "silence2";
    s.silenceStep = (s.silenceStep + 1) as 1 | 2;
    closeMic(c);
    if (s.phase === "confirming") sayScript(c, "confirmAgain", { summary: s.draft?.summary ?? "" });
    else sayScript(c, id);
  } else if (s.silenceStep === 2) {
    s.silenceStep = 3;
    s.ask = "extend";
    closeMic(c);
    sayScript(c, "extendAsk");
  } else {
    enterPaused(c, { read: "pausedBySilence" });
  }
}

function onMainButton(c: Cx, kind: "main" | "hold"): void {
  const s = c.s;
  s.helpDepth = 0;
  switch (s.phase) {
    case "guiding":
      skipGuide(c);
      return;
    case "listening":
    case "confirming":
      if (s.inputMode === "text") {
        if (kind === "main" && s.speaking !== null) {
          stopSpeak(c);
          openTurn(c);
        }
        return;
      }
      if (s.mic === "off") {
        stopSpeak(c);
        openTurn(c, { settle: true });
      } else if (kind === "main") {
        c.fx.push({ type: "ENGINE_SUBMIT" });
      }
      return;
    case "thinking":
      if (s.inputMode === "text") {
        stopSpeak(c);
        return;
      }
      dropPending(c);
      receiveAnswer(c, false);
      c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
      s.awaitingConsent = false;
      s.consentText = null;
      go(c, "listening");
      openTurn(c, { settle: true });
      return;
    case "speaking":
      c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
      stopSpeak(c);
      clearTimers(c, "speakGuard");
      s.pendingConfirm = false;
      s.awaitingConsent = false;
      s.consentText = null;
      go(c, "listening");
      openTurn(c, { settle: true });
      return;
    default:
      return;
  }
}

function onTimer(c: Cx, id: TimerId): void {
  const s = c.s;
  switch (id) {
    case "micWait":
      if (s.phase === "connecting" && startedKind(s) === "realtime" && !s.engineReady) switchToFallback(c);
      return;
    case "connect":
      if (s.phase !== "connecting" || s.engineReady) return;
      if (startedKind(s) === "realtime") switchToFallback(c);
      else enterError(c, "connect_failed");
      return;
    case "connectSay":
      if (s.phase === "connecting" && s.speaking === null) {
        c.fx.push({ type: "ANNOUNCE", channel: "status", text: "연결하고 있어요" });
      }
      return;
    case "relisten":
      if (isListenPhase(s.phase) && s.mic === "on") c.fx.push({ type: "RELISTEN" });
      return;
    case "silence":
      onSilenceTimer(c);
      return;
    case "controlHold":
      if (isListenPhase(s.phase) && s.mic === "held") openTurn(c, { keep: true, noWarn: true });
      return;
    case "waitSay1":
      if (s.phase === "thinking") sayScript(c, "waiting1");
      return;
    case "waitSay2":
      if (s.phase === "thinking") sayScript(c, "waiting2");
      return;
    case "think":
      if (s.phase === "thinking") aiFailure(c, "timeout");
      return;
    case "retryAfter":
      if (s.phase === "thinking" && s.pendingTurn) {
        c.fx.push({ type: "WAIT_PULSE", on: true });
        setTimer(c, "think", THINK_TIMEOUT_MS);
        c.fx.push({
          type: "ENGINE_RESPOND",
          text: s.pendingTurn.text,
          source: s.pendingTurn.source,
          history: historyForRespond(s),
        });
      }
      return;
    case "speakGuard":
      if (s.phase !== "speaking") return;
      if (!s.pendingConfirm) afterAnswer(c);
      else if (s.speaking !== "confirm") speakConfirm(c);
      return;
    case "registerSay":
      if (s.phase === "registering") sayScript(c, "registering");
      return;
    case "pausedWarn":
      if (s.phase === "paused") sayScript(c, "pausedWarn");
      return;
    case "pausedEnd":
      if (s.phase === "paused") enterEnded(c);
      return;
    case "idleClose":
      if (s.phase === "paused") {
        c.fx.push({ type: "ENGINE_CLOSE" });
        c.fx.push({ type: "RELEASE_MIC" });
        s.engineReady = false;
        s.engine = null;
      }
      return;
  }
}

/** AI 실패 한 번(timeout, failed, bad_request). 3회째면 error로 주차한다. */
function aiFailure(c: Cx, kind: "timeout" | "failed" | "bad_request"): void {
  const s = c.s;
  const n = s.aiFailures + 1;
  if (n >= MAX_AI_FAILURES) {
    s.aiFailures = n;
    enterError(c, kind === "bad_request" ? "bad_request" : "failed");
    return;
  }
  s.aiFailures = n;
  dropPending(c);
  receiveAnswer(c, false);
  c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
  s.awaitingConsent = false;
  s.consentText = null;
  go(c, "listening");
  c.fx.push({ type: "EARCON", name: "error" });
  let id = errorScriptFor(kind, false);
  if (id === "tooLong" && s.inputMode === "text") id = "tooLongText";
  sayScript(c, id);
}

function onFailed(c: Cx, e: Extract<EngineEvent, { type: "FAILED" }>): void {
  const s = c.s;
  switch (s.phase) {
    case "connecting": {
      if (e.kind === "mic_blocked" || e.kind === "mic_denied" || e.kind === "speech_unavailable") return;
      if (startedKind(s) === "realtime") switchToFallback(c);
      else enterError(c, e.kind);
      return;
    }
    case "listening":
    case "confirming": {
      if (e.kind === "mic_blocked") {
        closeMic(c);
        sayScript(c, "micRetry");
      } else if (e.kind === "mic_denied" || e.kind === "speech_unavailable") {
        closeMic(c);
        s.inputMode = "text";
        sayScript(c, e.kind === "mic_denied" ? "micDenied" : "speechUnavailable");
      }
      return;
    }
    case "thinking": {
      switch (e.kind) {
        case "rate_limited": {
          if (s.rateRetries >= MAX_RATE_RETRIES) {
            aiFailure(c, "failed");
            return;
          }
          s.rateRetries += 1;
          c.fx.push({ type: "WAIT_PULSE", on: false });
          clearTimers(c, "waitSay1", "waitSay2", "think");
          const ms = Math.max(0, Math.min(e.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, RETRY_AFTER_CAP_MS));
          sayScript(c, "rateLimited", { s: Math.max(1, Math.ceil(ms / 1000)) });
          setTimer(c, "retryAfter", ms);
          return;
        }
        case "timeout":
        case "failed":
        case "bad_request":
          aiFailure(c, e.kind);
          return;
        case "offline":
        case "not_configured":
        case "unavailable_today":
          enterError(c, e.kind);
          return;
        default:
          return;
      }
    }
    default:
      return;
  }
}

function onLost(c: Cx, e: Extract<EngineEvent, { type: "LOST" }>): void {
  const s = c.s;
  if (s.phase === "connecting") {
    if (startedKind(s) === "realtime") switchToFallback(c);
    return;
  }
  if (!isRunning(s.phase)) return;
  const resumeTo = s.phase === "confirming" ? "confirming" : "listening";
  if (e.reason === "session_limit") {
    if (s.reconnects >= MAX_RECONNECTS) {
      s.fallbackOnly = true;
      enterEnded(c, { script: "sessionOver" });
      return;
    }
    s.reconnects += 1;
    dropPending(c);
    clearTimers(c, ...ALL_TIMERS);
    receiveAnswer(c, false);
    s.engineReady = false;
    s.awaitingConsent = false;
    s.consentText = null;
    s.pendingConfirm = false;
    c.fx.push({ type: "ENGINE_CLOSE" });
    s.engine = null;
    s.resumeTo = resumeTo;
    go(c, "connecting", { handled: true });
    sayScript(c, "sessionRenewed");
    startEngine(c);
    return;
  }
  if (s.engine !== "realtime") return;
  s.fallbackOnly = true;
  dropPending(c);
  clearTimers(c, ...ALL_TIMERS);
  receiveAnswer(c, false);
  s.engineReady = false;
  s.awaitingConsent = false;
  s.consentText = null;
  s.pendingConfirm = false;
  c.fx.push({ type: "ENGINE_CLOSE" });
  c.fx.push({ type: "RELEASE_MIC" });
  s.engine = null;
  s.resumeTo = resumeTo;
  if (!s.speechAvailable) s.inputMode = "text";
  go(c, "connecting", { handled: true });
  sayScript(c, s.inputMode === "voice" ? "engineSwitchedVoice" : "engineSwitchedText");
  startEngine(c);
}

function onReplyStart(c: Cx): void {
  receiveAnswer(c, true);
  go(c, "speaking");
  setTimer(c, "speakGuard", SPEAK_GUARD_MAX_MS);
}

function onReplyText(c: Cx, e: Extract<EngineEvent, { type: "REPLY_TEXT" }>): void {
  const s = c.s;
  if (!e.final || e.text.trim() === "") return;
  if (s.pendingConfirm) return;   // 확인으로 가는 응답의 말은 기록하지 않는다. 앱이 확인 문장을 읽는다.
  s.lastReply = e.text;
  s.history = [...s.history, aiCell(e.text, "asking", s.draft ?? EMPTY_SLOTS)];
  setTimer(c, "speakGuard", Math.min(e.text.length * 250 + 3000, SPEAK_GUARD_MAX_MS));
}

function onTurnResult(c: Cx, e: Extract<EngineEvent, { type: "TURN_RESULT" }>): void {
  const s = c.s;
  if (s.phase !== "thinking") return;
  const asAsking = () => {
    receiveAnswer(c, true);
    s.awaitingConsent = false;
    s.consentText = null;
    s.history = [...s.history, aiCell(e.reply, "asking", s.draft ?? EMPTY_SLOTS)];
    s.lastReply = e.reply;
    go(c, "speaking");
    if (e.reply.trim() === "") {
      afterAnswer(c);
      return;
    }
    say(c, "ai", e.reply);
  };
  switch (e.status) {
    case "asking":
      asAsking();
      return;
    case "confirming": {
      const draft = toDraft(e.slots);
      if (!draft) {
        asAsking();   // 서버가 이미 낮춰 보내므로 올 수 없는 방어 줄
        return;
      }
      s.draft = draft;
      s.pendingConfirm = true;
      s.awaitingConsent = false;
      s.consentText = null;
      speakConfirm(c);
      return;
    }
    case "done":
      onRegisterIntent(c);
      return;
    case "ended":
      onEndIntent(c);
      return;
  }
}

function onIntent(c: Cx, e: Extract<EngineEvent, { type: "INTENT" }>): void {
  const s = c.s;
  if (s.phase !== "thinking" && s.phase !== "speaking") return;
  if (e.kind === "confirm") {
    const draft = toDraft(e.slots);
    if (!draft) return;   // 엔진이 bad_arguments로 되돌린다
    s.draft = draft;
    s.pendingConfirm = true;
    s.awaitingConsent = false;   // 내용이 바뀌었으므로 앞의 동의는 쓰지 않는다
    s.consentText = null;
    c.fx.push({ type: "ENGINE_TOOL_RESULT", callId: e.callId, output: { ok: true }, respond: false });
  } else if (e.kind === "register") {
    onRegisterIntent(c, e.callId);
  } else {
    onEndIntent(c, e.callId);
  }
}

function onReplyEnd(c: Cx): void {
  const s = c.s;
  if (s.phase === "thinking") {
    if (s.pendingConfirm) {
      speakConfirm(c);
    } else {
      receiveAnswer(c, true);
      go(c, "listening");
      openTurn(c);
    }
  } else if (s.phase === "speaking") {
    if (!s.pendingConfirm) afterAnswer(c);
    else if (s.speaking !== "confirm") speakConfirm(c);
  }
}

function onSpeakEnd(c: Cx, id: string): void {
  const s = c.s;
  if (id !== s.speaking) return;   // 낡은 SPEAK_END는 버린다
  s.speaking = null;
  switch (s.phase) {
    case "guiding":
      c.fx.push({ type: "VISIT_MARK" });
      s.resumeTo = "listening";
      go(c, "connecting");
      startEngine(c);
      return;
    case "connecting":
      if (s.engineReady) afterConnect(c);
      return;
    case "listening":
    case "confirming":
      if (id !== "micRetry" && s.mic === "off") openTurn(c);
      return;
    case "speaking":
      if (id === "confirm") {
        s.pendingConfirm = false;
        if (s.draft && s.draft.product.trim() !== "") {
          go(c, "confirming");
          s.awaitingConsent = true;
          s.consentText = null;
          s.silenceStep = 0;
          openTurn(c);
        } else {
          s.awaitingConsent = false;
          go(c, "listening");
          openTurn(c);
        }
      } else if (id === "ai" && !s.pendingConfirm) {
        afterAnswer(c);
      }
      return;
    case "done":
      if (id === "registered") c.fx.push({ type: "FOCUS", target: "listLink" });
      return;
    case "error":
    case "ended":
      c.fx.push({ type: "FOCUS", target: "main" });
      return;
    default:
      return;
  }
}

function onResume(c: Cx): void {
  const s = c.s;
  if (s.phase !== "paused") return;
  clearTimers(c, "pausedWarn", "pausedEnd", "idleClose");
  s.silenceStep = 0;
  s.relistens = 0;
  s.ask = null;
  s.helpDepth = 0;
  s.settleNext = true;
  if (!s.engineReady) {
    go(c, "connecting");
    c.fx.push({ type: "EARCON", name: "start" });
    sayScript(c, "resumed");
    startEngine(c);
    return;
  }
  const resume = s.resumeTo;
  s.resumeTo = null;
  if (resume === "confirming" && s.draft) {
    go(c, "speaking");
    s.pendingConfirm = true;
    say(c, "confirm", confirmText(s, "confirmAgain"));
  } else {
    go(c, "listening");
    openTurn(c);
  }
}

/** 새 대화(NEW_REQUEST)로 비운다. 횟수 가운데 페이지 단위인 것(micOnce, lateReopens)은 지킨다. */
function resetForNewRequest(c: Cx, cid: string): void {
  const s = c.s;
  clearTimers(c, ...ALL_TIMERS);
  s.cid = cid;
  s.visit = "returning";
  s.history = [];
  s.draft = null;
  s.requestId = null;
  s.queueNumber = null;
  s.lastReply = "";
  s.engine = null;
  s.engineReady = false;
  s.pendingConfirm = false;
  s.awaitingConsent = false;
  s.consentText = null;
  s.pendingTurn = null;
  s.ask = null;
  s.resumeTo = null;
  s.settleNext = false;
  s.sessionWarnPending = false;
  s.error = null;
  s.silenceStep = 0;
  s.silenceArmed = false;
  s.relistens = 0;
  s.aiFailures = 0;
  s.rateRetries = 0;
  s.reconnects = 0;
  s.helpDepth = 0;
  s.sendPending = false;
  s.resultUnspoken = false;
  s.speaking = null;
}

function onRegisterFail(c: Cx, kind: "retryable" | "unknown" | "rejected" | "conflict"): void {
  const s = c.s;
  if (s.phase === "registering") {
    s.sendPending = false;
    if (kind === "rejected" || kind === "conflict") {
      enterError(c, kind === "rejected" ? "register_rejected" : "register_conflict");
      return;
    }
    c.fx.push({ type: "WAIT_PULSE", on: false });
    stopSpeak(c);
    clearTimers(c, "registerSay");
    go(c, "confirming", { handled: true });
    s.silenceStep = 0;
    c.fx.push({ type: "EARCON", name: "error" });
    s.awaitingConsent = true;
    s.consentText = null;
    const text = s.inputMode === "text";
    if (kind === "retryable") sayScript(c, text ? "registerRetryText" : "registerRetry");
    else sayScript(c, text ? "registerUnknownText" : "registerUnknown");
    return;
  }
  if (s.phase === "ended") {
    s.sendPending = false;
    stopSpeak(c);
    if (kind === "conflict") {
      sayScript(c, "registerConflict");
      s.history = [];
      s.draft = null;
    } else if (kind === "rejected") {
      sayScript(c, "registerRejected");
      s.history = [];
      s.draft = null;
    } else {
      sayScript(c, "endedSendFailed");
    }
  }
}

function onRegisterOk(c: Cx, e: Extract<LiveEvent, { type: "REGISTER_OK" }>): void {
  const s = c.s;
  if (s.phase === "registering") {
    s.sendPending = false;
    s.requestId = e.requestId;
    s.queueNumber = e.queueNumber;
    stopSpeak(c);
    c.fx.push({ type: "WAIT_PULSE", on: false });
    clearTimers(c, "registerSay");
    c.fx.push({ type: "SAVE_RECORD" });
    c.fx.push({ type: "ATTACH_PUSH" });
    c.fx.push({ type: "ENGINE_CLOSE" });
    c.fx.push({ type: "RELEASE_MIC" });
    c.fx.push({ type: "WAKE_LOCK", on: false });
    s.engineReady = false;
    s.engine = null;
    go(c, "done");
    c.fx.push({ type: "EARCON", name: "done" });
    if (!s.hidden) sayScript(c, "registered", { n: e.queueNumber });
    else s.resultUnspoken = true;
    return;
  }
  if (s.phase === "ended") {
    s.sendPending = false;
    s.requestId = e.requestId;
    s.queueNumber = e.queueNumber;
    c.fx.push({ type: "SAVE_RECORD" });
    c.fx.push({ type: "ATTACH_PUSH" });
    if (!s.hidden) {
      stopSpeak(c);
      sayScript(c, "registered", { n: e.queueNumber });
    } else {
      s.resultUnspoken = true;
    }
  }
}

function step(c: Cx, e: LiveEvent): void {
  const s = c.s;
  switch (e.type) {
    case "CONFIG":
      s.realtimeHint = e.realtime;
      return;

    case "START":
      if (s.phase === "idle") beginGuide(c, s.visit);
      return;

    case "READY": {
      if (s.phase !== "connecting") return;
      s.engine = e.engine;
      s.engineReady = true;
      clearTimers(c, "micWait", "connect", "connectSay");
      c.fx.push({ type: "WAIT_PULSE", on: false });
      if (e.inputMode === "text" && s.inputMode === "voice") {
        s.inputMode = "text";
        sayScript(c, e.textReason === "speech_unavailable" ? "speechUnavailable" : "micDenied");
      }
      if (s.speaking === null) afterConnect(c);
      return;
    }

    case "MIC_READY":
      if (s.phase === "connecting" && startedKind(s) === "realtime" && !s.engineReady) {
        clearTimers(c, "micWait");
        setTimer(c, "connect", CONNECT_TIMEOUT_MS);
        setTimer(c, "connectSay", CONNECT_SAY_MS);
        c.fx.push({ type: "WAIT_PULSE", on: true });
        s.settleNext = true;
      }
      return;

    case "MIC_DENIED":
      if (s.phase === "connecting" && startedKind(s) === "realtime" && !s.engineReady) switchToFallback(c);
      return;

    case "LISTEN_STARTED":
      onListenStarted(c, e.late);
      return;

    case "USER_SPEECH_START":
      if (isListenPhase(s.phase)) {
        clearTimers(c, "silence");
        s.silenceArmed = false;
      }
      return;

    case "NO_SPEECH":
      if (isListenPhase(s.phase)) noSpeech(c);
      return;

    case "USER_TURN_END": {
      if (!isListenPhase(s.phase)) return;
      if (!e.transcribed) {
        // Realtime 전사가 늦다. 명령과 동의 판정을 건너뛰고 답을 청한다.
        s.helpDepth = 0;
        s.ask = null;
        s.consentText = null;
        s.pendingTurn = { text: "", source: "voice" };
        enterThinking(c, { engineEnded: true });
        c.fx.push({ type: "ENGINE_RESPOND", text: "", source: "voice", history: s.history });
        return;
      }
      onUtterance(c, e.text, "voice", true);
      return;
    }

    case "TEXT_SUBMIT":
      if (isListenPhase(s.phase)) onUtterance(c, e.text, "text", false);
      return;

    case "USER_TRANSCRIPT": {
      if (!isActive(s.phase) || !e.final) return;
      const text = cutText(e.text.trim(), USER_TURN_MAX);
      if (text === "") return;
      if (s.pendingTurn && s.pendingTurn.text === "") {
        s.pendingTurn = { text, source: s.pendingTurn.source };
        s.history = [...s.history, userCell(text)];
      }
      if (s.awaitingConsent && s.consentText === null) s.consentText = text;
      return;
    }

    case "TURN_RESULT":
      onTurnResult(c, e);
      return;

    case "REPLY_START":
      if (s.phase === "thinking") onReplyStart(c);
      return;

    case "REPLY_TEXT":
      if (s.phase === "thinking") onReplyStart(c);
      if (s.phase === "speaking") onReplyText(c, e);
      return;

    case "REPLY_END":
      onReplyEnd(c);
      return;

    case "INTENT":
      onIntent(c, e);
      return;

    case "FAILED":
      onFailed(c, e);
      return;

    case "SESSION_WARN":
      if (isListenPhase(s.phase)) {
        closeMic(c);
        sayScript(c, "sessionWarn");
      } else if (s.phase === "guiding" || s.phase === "connecting" || s.phase === "thinking" || s.phase === "speaking") {
        s.sessionWarnPending = true;
      }
      return;

    case "LOST":
      onLost(c, e);
      return;

    case "SPEAK_END":
      onSpeakEnd(c, e.id);
      return;

    case "MAIN_BUTTON":
      onMainButton(c, "main");
      return;

    case "HOLD_ACTIVATE":
      if (s.phase === "paused") onResume(c);
      else onMainButton(c, "hold");
      return;

    case "HOLD_SUBMIT":
      if (isListenPhase(s.phase)) c.fx.push({ type: "ENGINE_SUBMIT" });
      return;

    case "HOLD_CANCEL":
      if (isListenPhase(s.phase)) {
        c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: true });
        c.fx.push({ type: "EARCON", name: "cancel" });
        openTurn(c);
      }
      return;

    case "CONTROL_TOUCH":
      if (!isListenPhase(s.phase)) return;
      if (s.mic === "on") {
        s.mic = "held";
        c.fx.push({ type: "ENGINE_HOLD" });
        clearTimers(c, "silence", "relisten");
        s.silenceArmed = false;
        setTimer(c, "controlHold", CONTROL_HOLD_MS);
      } else if (s.mic === "held") {
        setTimer(c, "controlHold", CONTROL_HOLD_MS);
      }
      return;

    case "CONSENT_BUTTON":
      if (s.phase !== "confirming") return;
      s.helpDepth = 0;
      if (canRegister(s, "button")) startRegister(c);
      else {
        closeMic(c);
        sayScript(c, "confirmRetell", { summary: s.draft?.summary ?? "" });
      }
      return;

    case "EDIT_BUTTON":
      if (s.phase !== "confirming") return;
      s.helpDepth = 0;
      s.awaitingConsent = false;
      s.consentText = null;
      go(c, "listening", { discard: true });
      sayScript(c, s.inputMode === "text" ? "editPromptText" : "editPrompt");
      return;

    case "REPEAT":
      doRepeat(c);
      return;

    case "HELP":
      doHelp(c);
      return;

    case "PAUSE":
      if (isActive(s.phase)) {
        s.helpDepth = 0;
        enterPaused(c, { read: "pausedByUser" });
      }
      return;

    case "RESUME":
      onResume(c);
      return;

    case "RATE_BUTTON": {
      const next = s.rate === "normal" ? "slow" : s.rate === "slow" ? "fast" : "normal";
      if (isActive(s.phase)) applyRate(c, next);
      else {
        s.helpDepth = 0;
        s.rate = next;
      }
      return;
    }

    case "EXIT":
      if (s.phase !== "idle" && s.phase !== "ended") enterEnded(c);
      return;

    case "CONTINUE":
      if (s.phase === "ended" && s.requestId === null && !s.sendPending) {
        s.silenceStep = 0;
        s.relistens = 0;
        s.ask = null;
        s.helpDepth = 0;
        s.settleNext = true;
        c.fx.push({ type: "WAKE_LOCK", on: true });
        go(c, "connecting");
        c.fx.push({ type: "EARCON", name: "start" });
        sayScript(c, "resumed");
        startEngine(c);
      }
      return;

    case "NEW_REQUEST":
      if (s.phase === "done" || s.phase === "error" || (s.phase === "ended" && !s.sendPending)) {
        resetForNewRequest(c, e.cid);
        beginGuide(c, "new");
      }
      return;

    case "RETRY":
      if (s.phase === "error") {
        s.error = null;
        s.aiFailures = 0;
        s.rateRetries = 0;
        s.settleNext = true;
        s.resumeTo = "listening";
        c.fx.push({ type: "WAKE_LOCK", on: true });
        go(c, "connecting");
        c.fx.push({ type: "EARCON", name: "start" });
        sayScript(c, "resumed");
        startEngine(c);
      }
      return;

    case "TIMER":
      onTimer(c, e.id);
      return;

    case "HIDDEN":
      s.hidden = true;
      if (isActive(s.phase)) enterPaused(c, { silent: true });
      return;

    case "VISIBLE":
      s.hidden = false;
      if (s.phase === "paused") {
        c.fx.push({
          type: "ANNOUNCE",
          channel: "status",
          text: `멈춰 있어요. '${BUTTONS.resume}' 단추를 누르면 이어서 해요.`,
        });
      }
      if (s.resultUnspoken) {
        s.resultUnspoken = false;
        c.fx.push({
          type: "ANNOUNCE",
          channel: "status",
          text: `요청이 등록됐어요. 접수 번호 ${s.queueNumber ?? ""}번.`,
        });
      }
      return;

    case "REGISTER_BUSY":
      if (s.phase === "registering") sayScript(c, "registerBusy");
      return;

    case "REGISTER_OK":
      onRegisterOk(c, e);
      return;

    case "REGISTER_FAIL":
      onRegisterFail(c, e.kind);
      return;
  }
}

export function liveStep(state: LiveState, event: LiveEvent): { state: LiveState; effects: LiveEffect[] } {
  const c: Cx = { s: { ...state }, fx: [] };
  step(c, event);
  return { state: c.s, effects: c.fx };
}
