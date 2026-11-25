// /live 상태 기계: 순수 함수 liveStep(상태, 사건 → 상태, 효과)과 접수 관문 canRegister. 설계서 5절, 12.2절.
// 시계, DOM, 네트워크, 난수를 쓰지 않는다. 시간은 TIMER_SET 효과와 TIMER 사건으로만 다룬다.
import {
  hasQuestion,
  isCardEcho,
  isClearConsent,
  isDecline,
  isPlausibleConsent,
  isScreenReaderEcho,
  matchLocalCommand,
  type LocalCommand,
  splitNext,
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
  MIC_SAY_FIRST_MS,
  MIC_SAY_MAX,
  MIC_SAY_REPEAT_MS,
  MIC_WAIT_MS,
  PAUSED_END_MS,
  PAUSED_WARN_MS,
  REALTIME_IDLE_CLOSE_MS,
  REGISTER_SAY_MS,
  RELISTEN_DELAYS_MS,
  RETRY_AFTER_CAP_MS,
  SILENCE_STEPS_MS,
  SPEAK_GUARD_MAX_MS,
  THINK_GRACE_MS,
  THINK_TIMEOUT_MS,
  USER_TURN_MAX,
  WAIT_SAY1_MS,
  WAIT_SAY2_MS,
} from "@/lib/liveTiming";
import { cutText, EMPTY_SLOTS, encodeAiTurn, groundSlots, toDraft } from "@/lib/liveText";

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
  speakingText: string | null;        // 기기 목소리로 읽는 글. 읽지 못하면 화면 낭독기 알림으로 대신 전한다
  speakRetried: boolean;              // 이 글을 기기 목소리로 한 번 더 읽어 보았다
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
  thinkFresh: boolean;                // 말을 보낸 직후 THINK_GRACE_MS 안이다(이때의 큰 단추 누름은 말을 취소하지 않는다)
  micSays: number;                    // 예비 엔진의 첫 듣기에서 마이크 허용 기다림 안내를 읽은 횟수
  manual: boolean;                    // '다음' 방식: 이용자가 '다음'이라고 하거나 큰 단추를 눌러야 AI에게 넘긴다(CONFIG의 advance)
  parts: string[];                    // '다음' 방식에서 아직 AI에게 넘기지 않고 모아 둔 이용자 말
  manualSubmit: boolean;              // 큰 단추로 넘기기를 눌렀다. 다음에 오는 차례 끝(또는 말 없음)에서 모은 말을 넘긴다
  manualTold: boolean;                // 이 페이지에서 '다음' 방식 안내를 읽었다
}

export type LiveEvent =
  | { type: "CONFIG"; realtime: boolean; advance?: "manual" }   // /api/live/config 응답. advance가 없으면 저절로 넘긴다
  | { type: "START" }
  | EngineEvent                                        // 6절
  | { type: "MIC_READY" } | { type: "MIC_DENIED" }     // Realtime용 마이크 요청 결과(실행기가 넣는다)
  | { type: "SPEAK_END"; id: string; failed?: boolean }                  // 기기 목소리 읽기가 끝남
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
  | { type: "OPEN_TURN"; earcon: "turn" | "confirm"; settle: boolean; keep: boolean; sticky?: boolean }  // (뜸) → 신호음 → 150ms → 마이크. sticky: 말이 끊겨도 닫지 않는다
  | { type: "RELISTEN"; sticky?: boolean }             // 신호음 없이 인식만 다시 시작
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
  | "registerSay" | "pausedWarn" | "pausedEnd" | "idleClose" | "thinkGrace" | "micSay" | "more";

const ALL_TIMERS: TimerId[] = [
  "micWait", "connect", "connectSay", "relisten", "silence", "controlHold",
  "waitSay1", "waitSay2", "think", "retryAfter", "speakGuard",
  "registerSay", "pausedWarn", "pausedEnd", "idleClose", "thinkGrace", "micSay",
];

// '다음' 방식: 말 한 토막을 들은 뒤 이만큼 조용하면 "더 말씀하셔도 돼요…"를 읽는다. 말소리가 시작됐는데 글이 오지 않을 때는 더 길게 기다린다.
const MANUAL_MORE_MS = 6_000;
const MANUAL_MORE_GUARD_MS = 30_000;

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
    speakingText: null,
    speakRetried: false,
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
    thinkFresh: false,
    micSays: 0,
    manual: false,
    parts: [],
    manualSubmit: false,
    manualTold: false,
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
/** 이용자가 지금까지 한 말. 칸의 근거 검사(groundSlots)에 쓴다. */
const userTexts = (s: LiveState): string[] => s.history.filter((t) => t.role === "user").map((t) => t.content);
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
  c.s.speakingText = c.s.tts ? text : null;
  c.s.speakRetried = false;
}
function sayScript(c: Cx, id: ScriptId, vars?: { n?: number; s?: number; summary?: string }): void {
  say(c, id, script(id, vars));
}
const confirmText = (s: LiveState, id: "confirmAgain" | "confirmRetell") =>
  script(id, { summary: s.draft?.summary ?? "" });

function stopSpeak(c: Cx): void {
  c.fx.push({ type: "STOP_SPEAK" });
  c.s.speaking = null;
  c.s.speakingText = null;
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
      clearTimers(c, "silence", "relisten", "controlHold", "micSay");
      if (!o.engineEnded) c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: o.discard ?? false });
    }
    s.mic = "off";
    s.silenceArmed = false;
  }
  if (!isListenPhase(to)) {
    s.mic = "off";
    s.silenceArmed = false;
  }
  if (to !== "thinking") s.thinkFresh = false;
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
  clearTimers(c, "silence", "relisten", "controlHold", "micSay");
  if (s.manual) clearTimers(c, "more");
  s.silenceArmed = false;
}

/** '다음' 방식이 지금 차례에 걸리는가. 확인 단계, 글자 입력, 앱이 예·아니오를 물어 둔 차례에는 걸지 않는다. */
const manualTurn = (s: LiveState): boolean => s.manual && s.phase === "listening" && s.inputMode === "voice" && s.ask === null;
const stickyFx = (s: LiveState): { sticky?: boolean } => (manualTurn(s) ? { sticky: true } : {});

/** 세션 예고 대본. 이미 한 번 다시 연결했으면 다음 예고는 연결을 새로 하는 것이 아니라 잠시 멈춘다는 말이다. */
const sessionWarnId = (s: LiveState): ScriptId => (s.reconnects >= MAX_RECONNECTS ? "sessionWarnLast" : "sessionWarn");

/** 차례 열기(listening) 또는 확인 열기(confirming). 글자 모드는 신호음과 입력 칸 초점만 낸다. */
function openTurn(c: Cx, o: { settle?: boolean; keep?: boolean; noWarn?: boolean } = {}): void {
  const s = c.s;
  const kind: "turn" | "confirm" = s.phase === "confirming" ? "confirm" : "turn";
  if (s.sessionWarnPending && !o.noWarn) {
    s.sessionWarnPending = false;
    closeMic(c);
    sayScript(c, sessionWarnId(s));
    return;
  }
  clearTimers(c, "silence", "relisten", "controlHold", "micSay");
  if (s.manual) clearTimers(c, "more");
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
  c.fx.push({ type: "OPEN_TURN", earcon: kind, settle, keep: o.keep ?? false, ...stickyFx(s) });
  // 이 페이지에서 듣기가 한 번도 시작되지 않았다면 마이크 허용 창을 기다리는 중일 수 있다. 소리 안내를 되풀이한다(onTimer micSay).
  if (!s.micOnce && s.engine === "fallback" && s.micSays <= MIC_SAY_MAX) setTimer(c, "micSay", s.micSays === 0 ? MIC_SAY_FIRST_MS : MIC_SAY_REPEAT_MS);
}

/** 답 받기(5.5절). */
function receiveAnswer(c: Cx, success: boolean): void {
  const s = c.s;
  c.fx.push({ type: "WAIT_PULSE", on: false });
  stopSpeak(c);
  clearTimers(c, "waitSay1", "waitSay2", "think", "retryAfter", "thinkGrace");
  s.thinkFresh = false;
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
    // 마이크 허용 창을 기다리는 동안 아무 소리가 없지 않게 한다. 대기 펄스는 앱이 말하는 동안 실행기가 쉰다.
    c.fx.push({ type: "WAIT_PULSE", on: true });
    setTimer(c, "micSay", MIC_SAY_FIRST_MS);
  }
}

/** Realtime을 포기하고 fallback으로 다시 시작한다(connecting 안). */
function switchToFallback(c: Cx): void {
  const s = c.s;
  s.fallbackOnly = true;
  c.fx.push({ type: "WAIT_PULSE", on: false });
  clearTimers(c, "micWait", "connect", "connectSay", "micSay");
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
    if (s.manual && s.inputMode === "voice" && !s.manualTold) {
      // '다음' 방식은 처음 한 번 말로 알린다. 읽기가 끝나면 onSpeakEnd가 차례를 연다.
      s.manualTold = true;
      sayScript(c, "manualGuide");
      return;
    }
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
  s.lastReply = script(gid);   // 첫 AI 답이 오기 전에도 [다시 듣기]와 '다시'가 안내를 다시 읽는다
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
  // 말 끝을 엔진이 먼저 잡은 직후의 큰 단추는 '다 말했어요'라는 뜻일 수 있다. 잠깐은 취소로 읽지 않는다.
  c.s.thinkFresh = true;
  setTimer(c, "thinkGrace", THINK_GRACE_MS);
}

/** registering으로 들어간다(5.5절 접수 표). callId가 있으면 Realtime 도구 호출을 닫는다. */
function startRegister(c: Cx, callId?: string): void {
  const s = c.s;
  clearTimers(c, "waitSay1", "waitSay2", "think", "retryAfter", "speakGuard", "silence", "relisten", "controlHold", "thinkGrace", "micSay");
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
  // 바로 끝내거나 되묻지 않고, 끝내는 말('끝내기')을 알려 준다.
  s.ask = null;
  go(c, "listening");
  sayScript(c, "endGuide");
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
      // 끝내고 싶다는 말: 끝내는 말을 알려 주고 차례를 다시 연다.
      closeMic(c);
      s.ask = null;
      sayScript(c, "endGuide");
      return;
    case "exit":
      endToHome(c);
      return;
  }
}

/** 말로 끝냈다('끝내기'). 보내는 중이 아니면 마침 안내 뒤 화면이 /live 처음 상태로 돌아간다(화면이 이 대본 id를 보고 돌아간다). */
function endToHome(c: Cx): void {
  const s = c.s;
  if (s.sendPending) enterEnded(c);
  else if (s.requestId !== null) enterEnded(c, { script: "endedHomeRegistered" });
  else if (s.history.some((t) => t.role === "user")) enterEnded(c, { script: "endedHomeUnsent" });
  else enterEnded(c, { script: "endedHome" });
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
      endToHome(c);
      return;
    }
    s.ask = null;
    if (isDecline(text)) {
      // 끝내지 않는다. AI에게 보내지 않고 "계속할게요"와 함께 방금 하던 말을 다시 읽는다.
      s.helpDepth = 0;
      closeMic(c);
      const again = s.phase === "confirming" ? confirmText(s, "confirmAgain") : s.lastReply;
      say(c, "repeat", again === "" ? script("endCancelled") : `${script("endCancelled")} ${again}`);
      return;
    }
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
  // 6. 그 밖: AI에게 보낸다. '다음' 방식의 음성 차례는 모아 두었다가 이용자가 넘길 때 보낸다.
  if (source === "voice" && s.manual && s.phase === "listening") {
    manualTake(c, text, engineEnded);
    return;
  }
  sendToAi(c, text, source, engineEnded);
}

function sendToAi(c: Cx, text: string, source: "voice" | "text", engineEnded: boolean): void {
  const s = c.s;
  s.helpDepth = 0;
  if (s.awaitingConsent) s.consentText = text;
  const before = s.history;
  s.history = [...before, userCell(text)];
  s.pendingTurn = { text, source };
  enterThinking(c, { engineEnded });
  c.fx.push({ type: "ENGINE_RESPOND", text, source, history: before });
}

/** '다음' 방식: 말 한 토막을 모은다. 끝에 '다음'이 있거나 큰 단추로 넘기는 중이면 모은 말을 AI에게 넘긴다. engineEnded: 엔진이 이미 마이크를 닫았다. */
function manualTake(c: Cx, text: string, engineEnded: boolean): void {
  const s = c.s;
  const { content, next } = splitNext(text);
  if (content !== "") s.parts = [...s.parts, content];
  if (next || s.manualSubmit) {
    manualFinish(c, engineEnded, next && content === "" ? text : "");
    return;
  }
  s.helpDepth = 0;
  if (engineEnded) openTurn(c, { keep: true });   // 예비 엔진이나 물음 뒤처럼 마이크가 닫혀 있으면 다시 연다
  setTimer(c, "more", MANUAL_MORE_MS);
}

/** 모은 말을 AI에게 넘긴다. 모은 말이 없으면 bare('다음'이라는 말 자체)를 넘겨 다음 항목으로 가게 한다. */
function manualFinish(c: Cx, engineEnded: boolean, bare: string): void {
  const s = c.s;
  const text = cutText(s.parts.join(" ").trim(), USER_TURN_MAX) || bare;
  s.parts = [];
  s.manualSubmit = false;
  clearTimers(c, "more");
  if (text === "") {
    if (engineEnded) openTurn(c);
    return;
  }
  sendToAi(c, text, "voice", engineEnded);
}

/** '다음' 방식의 이어 듣기 중에 말 한 토막이 왔다(마이크는 열려 있다). 말 명령은 마이크를 닫고 보통 판정으로 넘긴다. */
function onPart(c: Cx, raw: string): void {
  const s = c.s;
  const text = cutText(raw.trim(), USER_TURN_MAX);
  if (text === "" || isScreenReaderEcho(text)) return;
  if (s.phase !== "listening" || s.mic !== "on") {
    // 마이크를 닫은 뒤에 늦게 온 토막이다. 버리지 않고 모아 둔다.
    if (s.manual && s.phase === "listening" && !splitNext(text).next) s.parts = [...s.parts, text];
    return;
  }
  if (matchLocalCommand(text) !== null) {
    closeMic(c);
    onUtterance(c, text, "voice", true);
    return;
  }
  manualTake(c, text, false);
}

// ----- 사건별 처리 -----

function onListenStarted(c: Cx, late: boolean): void {
  const s = c.s;
  if (!isListenPhase(s.phase) || s.mic !== "on") return;
  s.micOnce = true;
  s.micSays = 0;
  clearTimers(c, "micSay");
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
    // 확인 카드를 화면 낭독기로 읽는 중일 수 있으므로 요약 전체를 다시 읽지 않고 짧은 안내만 한다. 요약은 '다시'나 [다시 듣기]로 듣는다.
    if (s.phase === "confirming") sayScript(c, "confirmHint");
    else sayScript(c, s.manual && s.parts.length > 0 ? "manualMore" : id);
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
        // 허용을 기다리다 안내가 끝난 뒤 이용자가 '말하기'로 다시 열면 안내를 처음부터 다시 되풀이한다.
        if (!s.micOnce) s.micSays = 0;
        openTurn(c, { settle: true });
      } else if (kind === "main") {
        if (manualTurn(s)) s.manualSubmit = true;
        c.fx.push({ type: "ENGINE_SUBMIT" });
      }
      return;
    case "thinking":
      if (s.inputMode === "text") {
        stopSpeak(c);
        return;
      }
      if (s.thinkFresh) {
        // 방금 보낸 말이다. 지우지 않고, 이미 보냈다는 신호음을 한 번 더 들려 준다.
        c.fx.push({ type: "EARCON", name: "sent" });
        return;
      }
      dropPending(c);
      receiveAnswer(c, false);
      c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
      s.awaitingConsent = false;
      s.consentText = null;
      go(c, "listening");
      // 말이 취소됐다는 것을 소리로 알린다. 읽기가 끝나면 onSpeakEnd가 차례를 연다.
      c.fx.push({ type: "EARCON", name: "cancel" });
      sayScript(c, "turnCancelled");
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

/** 마이크 허용을 기다리는 동안의 소리 안내. 마이크가 닫혀 있을 때만 읽는다(자기 목소리가 인식에 섞이지 않게). */
function onMicSayTimer(c: Cx): void {
  const s = c.s;
  if (s.phase === "connecting" && startedKind(s) === "realtime" && !s.engineReady) {
    // Realtime: 마이크를 받기 전에는 인식이 돌지 않는다. 앞 말이 아직 끝나지 않았으면 조금 뒤에 다시 본다.
    if (s.speaking === null) {
      sayScript(c, "micWaiting");
      setTimer(c, "micSay", MIC_SAY_REPEAT_MS);
    } else {
      setTimer(c, "micSay", 4_000);
    }
    return;
  }
  if (isListenPhase(s.phase) && s.mic === "on" && !s.micOnce && s.engine === "fallback") {
    // 예비 엔진: 인식을 끊고(허용 전이라 이용자 말이 없다) 읽은 뒤, 읽기가 끝나면 차례를 다시 연다.
    s.micSays += 1;
    c.fx.push({ type: "ENGINE_CANCEL_LISTEN", discard: true });
    s.mic = "off";
    clearTimers(c, "silence", "relisten", "controlHold");
    s.silenceArmed = false;
    // 안내를 MIC_SAY_MAX번 읽고도 허용이 안 됐으면 더 되풀이하지 않는다. 차례를 다시 열지 않고(onSpeakEnd) '말하기'로 이용자가 다시 열게 한다.
    // 다시 열어 두면 첫 시작 감시(60초×2)가 소리 없이 이어져 마지막에 틀린 이유("음성 인식을 쓸 수 없어요")를 읽게 된다.
    sayScript(c, s.micSays > MIC_SAY_MAX ? "micGiveUp" : "micWaiting");
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
    case "thinkGrace":
      s.thinkFresh = false;
      return;
    case "micSay":
      onMicSayTimer(c);
      return;
    case "connectSay":
      if (s.phase === "connecting" && s.speaking === null) {
        c.fx.push({ type: "ANNOUNCE", channel: "status", text: "연결하고 있어요" });
      }
      return;
    case "relisten":
      if (isListenPhase(s.phase) && s.mic === "on") c.fx.push({ type: "RELISTEN", ...stickyFx(s) });
      return;
    case "more":
      // '다음' 방식: 말이 멎은 채 조용하다. 마이크를 닫고 넘기는 법을 알린 뒤(읽기가 끝나면 onSpeakEnd가) 차례를 다시 연다.
      if (!manualTurn(s) || s.mic !== "on") return;
      closeMic(c);
      sayScript(c, s.parts.length > 0 ? "manualMore" : "silence1");
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
      const draft = toDraft(groundSlots(e.slots, userTexts(s)));
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
    const draft = toDraft(groundSlots(e.slots, userTexts(s)));
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

function onSpeakEnd(c: Cx, id: string, failed = false): void {
  const s = c.s;
  if (id !== s.speaking) return;   // 낡은 SPEAK_END는 버린다
  // 기기 목소리가 읽지 못했다(낭독 오류, 끝남 신호 없음). 들은 것으로 치지 않는다(Codex 3차 지적 4).
  // 동의 관문 앞의 요약은 기기 목소리로 한 번 더 읽어 본다. 그래도 안 되거나 다른 글이면 취소음을 내고
  // 같은 글을 화면 낭독기 알림으로 전한 뒤 그 길이만큼 기다린다. 그 알림이 끝나면 SPEAK_END가 다시 온다(이때는 failed가 아니다).
  if (failed) {
    const text = s.speakingText;
    if (text === null) return;   // 이미 알림으로 전하는 중이다. 그 알림의 끝을 기다린다(실패 신호로는 관문을 열지 않는다).
    if (id === "confirm" && !s.speakRetried) {
      s.speakRetried = true;
      c.fx.push({ type: "SPEAK", id, text });
      return;
    }
    s.speakingText = null;
    c.fx.push({ type: "EARCON", name: "cancel" });
    c.fx.push({ type: "ANNOUNCE", channel: "status", text, endId: id });
    return;
  }
  s.speaking = null;
  s.speakingText = null;
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
      if (id !== "micRetry" && id !== "micGiveUp" && s.mic === "off") openTurn(c);
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
      if (id === "registered" || id === "registeredLate") c.fx.push({ type: "FOCUS", target: "listLink" });
      return;
    case "paused":
      // 멈춤 안내가 끝나면 초점을 큰 단추([계속하기])로 옮긴다. 100초 경고(pausedWarn)는 이용자가 둔 읽기 위치를 빼앗지 않으려고 제외한다.
      if (id === "pausedByUser" || id === "pausedBySilence" || id === "pausedReturn") c.fx.push({ type: "FOCUS", target: "main" });
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
  // 멈춤 안내를 읽는 중에 이어 가면 그 낭독이 뜸·신호음·마이크 위로 겹치지 않게 먼저 멈춘다.
  if (s.speaking !== null) stopSpeak(c);
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
  s.parts = [];
  s.manualSubmit = false;
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
      // 마친 화면에는 [요청 목록 보기]가 없으므로 목록 단추를 가리키지 않는 대본을 읽는다.
      sayScript(c, "registeredEnded", { n: e.queueNumber });
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
      s.manual = e.advance === "manual";
      return;

    case "START":
      if (s.phase === "idle") beginGuide(c, s.visit);
      return;

    case "READY": {
      if (s.phase !== "connecting") return;
      s.engine = e.engine;
      s.engineReady = true;
      clearTimers(c, "micWait", "connect", "connectSay", "micSay");
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
        clearTimers(c, "micWait", "micSay");
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
        // '다음' 방식: 말하는 동안에는 넘기는 법 안내를 미룬다. 글이 끝내 오지 않을 때를 대비해 길게 걸어 둔다.
        if (manualTurn(s) && s.mic === "on") setTimer(c, "more", MANUAL_MORE_GUARD_MS);
      }
      return;

    case "NO_SPEECH":
      if (!isListenPhase(s.phase)) return;
      if (s.manualSubmit) {
        // 큰 단추로 넘겼는데 지금은 말이 없었다. 모아 둔 말이 있으면 그것을 넘긴다.
        s.manualSubmit = false;
        if (s.parts.length > 0) {
          manualFinish(c, true, "");
          return;
        }
      }
      noSpeech(c);
      return;

    case "USER_PART":
      onPart(c, e.text);
      return;

    case "USER_TURN_END": {
      if (!isListenPhase(s.phase)) return;
      if (!e.transcribed && s.manual && s.phase === "listening" && s.parts.length > 0) {
        // '다음' 방식: 마지막 토막의 전사가 늦다. 모아 둔 말로 넘긴다.
        manualFinish(c, true, "");
        return;
      }
      if (!e.transcribed) {
        // Realtime 전사가 늦다. 명령과 동의 판정을 건너뛰고 답을 청한다.
        s.manualSubmit = false;
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
      if (s.phase === "speaking" && s.inputMode === "text" && !s.pendingConfirm && e.text.trim() !== "") {
        // 글자 모드 끼어들기: 읽던 AI 말을 끊고 이 글을 받는다. 요약 확인(pendingConfirm)은 동의 관문 때문에 제외한다.
        c.fx.push({ type: "ENGINE_CANCEL_RESPONSE" });
        stopSpeak(c);
        clearTimers(c, "speakGuard");
        s.awaitingConsent = false;
        s.consentText = null;
        go(c, "listening");
      }
      if (isListenPhase(s.phase)) onUtterance(c, e.text, "text", false);
      else if (isActive(s.phase)) c.fx.push({ type: "EARCON", name: "cancel" });   // 받지 못했다는 것을 소리로 알린다. 글은 화면이 칸에 남긴다.
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
        sayScript(c, sessionWarnId(s));
      } else if (s.phase === "guiding" || s.phase === "connecting" || s.phase === "thinking" || s.phase === "speaking") {
        s.sessionWarnPending = true;
      }
      return;

    case "LOST":
      onLost(c, e);
      return;

    case "SPEAK_END":
      onSpeakEnd(c, e.id, e.failed === true);
      return;

    case "MAIN_BUTTON":
      onMainButton(c, "main");
      return;

    case "HOLD_ACTIVATE":
      if (s.phase === "paused") onResume(c);
      else onMainButton(c, "hold");
      return;

    case "HOLD_SUBMIT":
      if (isListenPhase(s.phase)) {
        if (manualTurn(s)) s.manualSubmit = true;
        c.fx.push({ type: "ENGINE_SUBMIT" });
      }
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
      // 접수 번호를 읽는 중의 누름은 새 요청이 아니다. 끝까지 들은 뒤의 누름만 새 요청을 시작한다.
      if (s.speaking === "registered" || s.speaking === "registeredEnded" || s.speaking === "registeredLate") return;
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
      // 돌아오면 기기 목소리로 알린다(화면 낭독기 없이 쓰는 이용자도 듣도록). say()는 목소리를 못 쓸 때만 ANNOUNCE를 내므로 낭독기와 겹치지 않는다.
      if (s.resultUnspoken) {
        s.resultUnspoken = false;
        if (s.speaking !== null) stopSpeak(c);
        const id: ScriptId = s.phase === "ended" ? "registeredEnded" : "registered";
        say(c, "registeredLate", script(id, { n: s.queueNumber ?? undefined }));
      } else if (s.phase === "paused" && s.speaking === null) {
        c.fx.push({ type: "EARCON", name: "pause" });
        sayScript(c, "pausedReturn");
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
