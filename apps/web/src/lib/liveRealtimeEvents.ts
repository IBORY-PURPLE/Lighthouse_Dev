// /live Realtime 프로토콜 판단: 엔진 동작 -> 클라이언트 이벤트(realtimeOp), 서버 이벤트 -> 엔진 이벤트(realtimeStep). 설계서 6.3절.
// 순수 함수만 둔다(연결, 타이머, DOM 없음). 입력 tracker를 바꾸지 않고 새 tracker와 할 일 목록을 돌려준다. 로그는 꼬리표만 남기고 글은 넣지 않는다.
import type { EngineEvent, LiveSlots, LiveTurn } from "@/lib/liveEngine";
import { TRANSCRIPT_WAIT_MS, USER_TURN_MAX } from "@/lib/liveTiming";
import { cutText, decodeAiTurn, readSlots } from "@/lib/liveText";

type Rate = "slow" | "normal" | "fast";

/** 변환기가 들고 다니는 작은 상태(6.3.1절). */
export interface RealtimeTracker {
  awaitingItemId: string | null;         // 전사를 기다리는 이용자 칸
  heard: boolean;                        // 이 차례에 speech_started가 왔다
  committedInTurn: boolean;              // 이 차례에 committed가 왔다
  held: boolean;                         // 단추를 찾느라 붙든 상태
  heldText: string;                      // 붙든 동안 온 전사
  responseActive: boolean;               // response.created부터 response.done까지
  audioPlaying: boolean;                 // output_audio_buffer.started부터 stopped·cleared까지
  audioStarted: boolean;                 // 이 응답에서 소리가 났다
  replyText: string;                     // 모이는 AI 자막
  turnsSent: number;                     // 보낸 response.create 수
  maxTurns: number;                      // 서버가 준 상한
  nextEventId: number;
  ignoreEventIds: string[];              // 오류가 와도 무시할 클라이언트 이벤트 id(commit, cancel, clear)
  logOnlyEventIds: string[];             // 오류가 오면 로그만 남길 id(기록 복원, 빠르기 알림)
  badArgsRetried: boolean;
}

export type EngineOp =
  | { op: "listen"; keep: boolean } | { op: "hold" } | { op: "submit" } | { op: "cancelListen"; discard: boolean }
  | { op: "respond"; text: string; source: "voice" | "text" } | { op: "cancelResponse" }
  | { op: "toolResult"; callId: string; output: object; respond: boolean }
  | { op: "setRate"; rate: Rate }
  | { op: "restore"; history: LiveTurn[] };

export type RealtimeAction =
  | { send: object }                                    // 데이터 채널로 보낼 클라이언트 이벤트
  | { emit: EngineEvent }
  | { mic: boolean }                                    // track.enabled
  | { waitTranscript: { itemId: string; ms: number } }  // 엔진이 타이머를 건다
  | { turnCap: boolean }                                // REALTIME_TURN_MAX_MS 타이머 켜기·끄기
  | { log: string };                                    // 꼬리표만 남긴다(글 없음)

export interface RealtimeResult { tracker: RealtimeTracker; actions: RealtimeAction[] }

/** 이어 넣는 기록 칸 수(6.3.3절). */
export const RESTORE_MAX_TURNS = 12;
const ID_LIST_MAX = 64;                                 // id 목록이 끝없이 자라지 않게 자른다
const SPEAK_WORD: Record<Rate, string> = { slow: "천천히", normal: "보통 빠르기로", fast: "빠르게" };

/** 통화를 만든 뒤 쓸 처음 상태. maxTurns는 /api/live/call이 준 값이다. */
export function createRealtimeTracker(maxTurns: number): RealtimeTracker {
  return {
    awaitingItemId: null, heard: false, committedInTurn: false, held: false, heldText: "",
    responseActive: false, audioPlaying: false, audioStarted: false, replyText: "",
    turnsSent: 0, maxTurns, nextEventId: 1, ignoreEventIds: [], logOnlyEventIds: [], badArgsRetried: false,
  };
}

function fork(t: RealtimeTracker): RealtimeTracker {
  return { ...t, ignoreEventIds: [...t.ignoreEventIds], logOnlyEventIds: [...t.logOnlyEventIds] };
}

type IdKind = "ignore" | "log" | "none";

/** 클라이언트 이벤트에 event_id("lh_" + 일련번호)를 붙여 보낼 목록에 넣는다. */
function pushSend(n: RealtimeTracker, actions: RealtimeAction[], body: Record<string, unknown>, kind: IdKind = "none"): void {
  const id = `lh_${n.nextEventId}`;
  n.nextEventId += 1;
  if (kind === "ignore") n.ignoreEventIds = [...n.ignoreEventIds, id].slice(-ID_LIST_MAX);
  if (kind === "log") n.logOnlyEventIds = [...n.logOnlyEventIds, id].slice(-ID_LIST_MAX);
  actions.push({ send: { ...body, event_id: id } });
}

/** response.create를 보내고 센다. 상한에 닿았으면 아무것도 보내지 않고 false. */
function pushResponseCreate(n: RealtimeTracker, actions: RealtimeAction[]): boolean {
  if (n.turnsSent >= n.maxTurns) {
    actions.push({ emit: { type: "LOST", reason: "budget" } });
    return false;
  }
  pushSend(n, actions, { type: "response.create" });
  n.turnsSent += 1;
  return true;
}

function pushToolResult(n: RealtimeTracker, actions: RealtimeAction[], callId: string, output: object, respond: boolean): void {
  if (respond && n.turnsSent >= n.maxTurns) {
    actions.push({ emit: { type: "LOST", reason: "budget" } });
    return;
  }
  pushSend(n, actions, {
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
  });
  if (respond) pushResponseCreate(n, actions);
}

/** 붙든 글 뒤에 새 글을 잇는다. 둘 다 있으면 공백 하나로 잇는다. */
function joinText(a: string, b: string): string {
  return a && b ? `${a} ${b}` : a || b;
}

/** 엔진 동작을 클라이언트 이벤트와 이벤트로 바꾼다(6.3.1절 표). 세션 설정(session.update)은 어떤 동작도 보내지 않는다. */
export function realtimeOp(t: RealtimeTracker, op: EngineOp): RealtimeResult {
  const n = fork(t);
  const actions: RealtimeAction[] = [];
  switch (op.op) {
    case "listen": {
      if (!op.keep) {
        pushSend(n, actions, { type: "input_audio_buffer.clear" }, "ignore");
        n.heldText = "";
        n.awaitingItemId = null;
      }
      actions.push({ mic: true });
      n.heard = false;
      n.committedInTurn = false;
      n.held = false;
      actions.push({ emit: { type: "LISTEN_STARTED", late: false } });
      break;
    }
    case "hold": {
      actions.push({ mic: false }, { turnCap: false });
      n.held = true;
      break;
    }
    case "submit": {
      actions.push({ mic: false }, { turnCap: false });
      n.held = false;   // 붙들기가 끝났다. 남겨 두면 뒤에 오는 전사가 붙든 글로 삼켜져 차례가 끝나지 않는다.
      if (n.heldText) {
        const text = n.heldText;
        n.heldText = "";
        actions.push({ emit: { type: "USER_TURN_END", text, transcribed: true } });
      } else if (n.committedInTurn) {
        // 서버가 이미 저절로 commit했다. 또 보내면 빈 버퍼 error가 난다. 전사를 기다리는 흐름이 이어진다.
        // 붙든 동안 대기 시간이 지나 타이머가 멎었으면 다시 건다(보내는 것은 없다).
        if (n.awaitingItemId) actions.push({ waitTranscript: { itemId: n.awaitingItemId, ms: TRANSCRIPT_WAIT_MS } });
      } else if (!n.heard) {
        pushSend(n, actions, { type: "input_audio_buffer.clear" }, "ignore");   // 무음을 commit하지 않는다
        actions.push({ emit: { type: "NO_SPEECH" } });
      } else {
        pushSend(n, actions, { type: "input_audio_buffer.commit" }, "ignore");
      }
      break;
    }
    case "cancelListen": {
      actions.push({ mic: false }, { turnCap: false });
      n.held = false;
      if (op.discard) {
        pushSend(n, actions, { type: "input_audio_buffer.clear" }, "ignore");
        n.heldText = "";
        n.awaitingItemId = null;
      }
      break;
    }
    case "respond": {
      if (op.source === "text") {
        if (n.turnsSent >= n.maxTurns) {
          actions.push({ emit: { type: "LOST", reason: "budget" } });
          break;
        }
        pushSend(n, actions, {
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: op.text }] },
        });
      }
      pushResponseCreate(n, actions);
      break;
    }
    case "cancelResponse": {
      // 문서 순서 그대로: response.cancel을 먼저 보내고 소리를 자른다.
      if (n.responseActive) pushSend(n, actions, { type: "response.cancel" }, "ignore");
      if (n.audioPlaying) pushSend(n, actions, { type: "output_audio_buffer.clear" }, "ignore");
      break;
    }
    case "toolResult": {
      pushToolResult(n, actions, op.callId, op.output, op.respond);
      break;
    }
    case "setRate": {
      pushSend(n, actions, {
        type: "conversation.item.create",
        item: {
          type: "message", role: "system",
          content: [{ type: "input_text", text: `이용자가 말을 ${SPEAK_WORD[op.rate]} 해 달라고 했습니다. 이제부터 그렇게 말합니다.` }],
        },
      }, "log");
      break;
    }
    case "restore": {
      for (const turn of op.history.slice(-RESTORE_MAX_TURNS)) {
        if (turn.role === "user") {
          const text = cutText(turn.content, USER_TURN_MAX);
          if (!text) continue;
          pushSend(n, actions, {
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
          }, "log");
        } else {
          // assistant 소리 칸은 만들 수 없어 output_text만 쓴다.
          const reply = decodeAiTurn(turn.content)?.reply ?? "";
          if (!reply) continue;
          pushSend(n, actions, {
            type: "conversation.item.create",
            item: { type: "message", role: "assistant", content: [{ type: "output_text", text: reply }] },
          }, "log");
        }
      }
      break;
    }
  }
  return { tracker: n, actions };
}

// ---------------------------------------------------------------------------------------------
// 서버 이벤트 변환

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 로그 꼬리표에 쓸 수 있게 짧고 안전한 글자만 남긴다(서버가 준 글이 그대로 로그에 가지 않게). */
function tagOf(v: unknown): string {
  return typeof v === "string" ? v.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60) || "unknown" : "unknown";
}

/** response.done의 output에서 함수 호출만 뽑는다. arguments가 깨졌으면 args는 null이다. */
export function parseToolCalls(response: unknown): { name: string; callId: string; args: unknown }[] {
  const r = asRecord(response);
  const output = r && Array.isArray(r.output) ? r.output : [];
  const calls: { name: string; callId: string; args: unknown }[] = [];
  for (const item of output) {
    const o = asRecord(item);
    if (!o || o.type !== "function_call") continue;
    if (typeof o.name !== "string" || typeof o.call_id !== "string") continue;
    let args: unknown = null;
    if (typeof o.arguments === "string") {
      try {
        args = JSON.parse(o.arguments);
      } catch {
        args = null;
      }
    }
    calls.push({ name: o.name, callId: o.call_id, args });
  }
  return calls;
}

function handleResponseDone(n: RealtimeTracker, actions: RealtimeAction[], event: Record<string, unknown>): void {
  const response = asRecord(event.response);
  const status = response && typeof response.status === "string" ? response.status : "completed";
  n.responseActive = false;

  if (status === "cancelled") {
    // 도구 호출을 버린다.
    if (!n.audioStarted) actions.push({ emit: { type: "REPLY_END" } });
    return;
  }
  if (status === "incomplete") {
    // 잘린 arguments일 수 있어 도구 호출을 믿지 않고 닫기만 한다.
    for (const call of parseToolCalls(response)) {
      pushToolResult(n, actions, call.callId, { ok: false, error: "incomplete" }, false);
    }
    if (!n.audioStarted) actions.push({ emit: { type: "FAILED", kind: "failed" } });
    actions.push({ log: "rt=incomplete" });
    return;
  }
  if (status === "failed") {
    actions.push({ emit: { type: "FAILED", kind: "failed" } });
    actions.push({ log: "rt=failed" });
    return;
  }

  // completed: output[] 전체를 본다.
  let endsTurn = false;       // register_request, end_conversation: 다음 상태는 상태 기계가 INTENT로 정한다
  let interrupted = false;    // 다시 시키거나 실패로 끝나 REPLY_END를 내지 않는 경우
  for (const call of parseToolCalls(response)) {
    if (call.name === "confirm_request") {
      const slots: LiveSlots = readSlots(call.args);
      if (slots.product) {
        n.badArgsRetried = false;
        actions.push({ emit: { type: "INTENT", kind: "confirm", slots, callId: call.callId } });
      } else if (!n.badArgsRetried) {
        n.badArgsRetried = true;
        pushToolResult(n, actions, call.callId, { ok: false, error: "bad_arguments" }, true);
        interrupted = true;   // 다시 시킨 응답이 곧 온다
      } else {
        actions.push({ emit: { type: "FAILED", kind: "failed" } });
        interrupted = true;
      }
    } else if (call.name === "register_request") {
      endsTurn = true;
      actions.push({ emit: { type: "INTENT", kind: "register", callId: call.callId } });
    } else if (call.name === "end_conversation") {
      endsTurn = true;
      actions.push({ emit: { type: "INTENT", kind: "end", callId: call.callId } });
    }
  }
  if (!n.audioStarted && !endsTurn && !interrupted) actions.push({ emit: { type: "REPLY_END" } });
}

/** 서버 이벤트 하나를 엔진 이벤트와 클라이언트 동작으로 바꾼다(6.3.2절 표). 모르는 이벤트는 아무것도 하지 않는다. */
export function realtimeStep(t: RealtimeTracker, event: unknown): RealtimeResult {
  const n = fork(t);
  const actions: RealtimeAction[] = [];
  const e = asRecord(event);
  const type = e && typeof e.type === "string" ? e.type : "";
  if (!e) return { tracker: n, actions };

  switch (type) {
    case "input_audio_buffer.speech_started": {
      n.heard = true;
      actions.push({ emit: { type: "USER_SPEECH_START" } }, { turnCap: true });
      break;
    }
    case "input_audio_buffer.committed": {
      const itemId = typeof e.item_id === "string" ? e.item_id : null;
      n.committedInTurn = true;
      actions.push({ mic: false }, { turnCap: false });
      if (itemId) {
        n.awaitingItemId = itemId;
        actions.push({ waitTranscript: { itemId, ms: TRANSCRIPT_WAIT_MS } });
      }
      break;
    }
    case "conversation.item.input_audio_transcription.delta": {
      const delta = typeof e.delta === "string" ? e.delta : "";
      if (delta) actions.push({ emit: { type: "USER_TRANSCRIPT", text: delta, final: false } });
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const itemId = typeof e.item_id === "string" ? e.item_id : null;
      const transcript = typeof e.transcript === "string" ? e.transcript.trim() : "";
      const mine = itemId !== null && itemId === n.awaitingItemId;
      if (n.held) {
        // 붙든 동안 온 전사는 쌓아 두고, 차례는 submit 때 끝낸다.
        // 빈 전사면 기다림을 그대로 둔다(submit이 타이머를 다시 걸어 차례를 끝낸다).
        if (transcript) {
          n.heldText = joinText(n.heldText, transcript);
          if (mine) n.awaitingItemId = null;
        }
      } else if (mine) {
        n.awaitingItemId = null;
        const text = joinText(n.heldText, transcript);
        n.heldText = "";
        actions.push({ emit: text ? { type: "USER_TURN_END", text, transcribed: true } : { type: "NO_SPEECH" } });
      } else if (transcript) {
        actions.push({ emit: { type: "USER_TRANSCRIPT", text: transcript, final: true } });   // 시간이 지나 넘긴 칸
      }
      break;
    }
    case "conversation.item.input_audio_transcription.failed": {
      const itemId = typeof e.item_id === "string" ? e.item_id : null;
      const mine = n.awaitingItemId !== null && (itemId === null || itemId === n.awaitingItemId);
      // 붙든 동안이면 차례를 끝내지 않는다. 기다림을 남겨 두면 submit이 타이머를 다시 건다.
      if (mine && !n.held) {
        n.awaitingItemId = null;
        actions.push({ emit: { type: "USER_TURN_END", text: "", transcribed: false } });
      }
      break;
    }
    case "response.created": {
      n.responseActive = true;
      n.audioStarted = false;
      n.replyText = "";
      break;
    }
    case "output_audio_buffer.started": {
      n.audioPlaying = true;
      n.audioStarted = true;
      actions.push({ emit: { type: "REPLY_START" } });
      break;
    }
    case "response.output_audio_transcript.delta": {
      const delta = typeof e.delta === "string" ? e.delta : "";
      if (delta) {
        n.replyText += delta;
        actions.push({ emit: { type: "REPLY_TEXT", text: n.replyText, final: false } });
      }
      break;
    }
    case "response.output_audio_transcript.done": {
      const text = typeof e.transcript === "string" ? e.transcript : n.replyText;
      n.replyText = text;
      actions.push({ emit: { type: "REPLY_TEXT", text, final: true } });
      break;
    }
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared": {
      // stopped와 cleared가 모두 오면 REPLY_END가 두 번 나가지 않게 한다.
      if (n.audioPlaying) actions.push({ emit: { type: "REPLY_END" } });
      n.audioPlaying = false;
      break;
    }
    case "response.done": {
      handleResponseDone(n, actions, e);
      break;
    }
    case "error": {
      const err = asRecord(e.error);
      const eventId = err && typeof err.event_id === "string" ? err.event_id : null;
      if (eventId !== null && n.ignoreEventIds.includes(eventId)) break;
      const tag = `rt_error=${tagOf(err?.code ?? err?.type)}`;
      actions.push({ log: tag });
      if (eventId === null || !n.logOnlyEventIds.includes(eventId)) {
        actions.push({ emit: { type: "FAILED", kind: "failed" } });
      }
      break;
    }
    default:
      break;
  }
  return { tracker: n, actions };
}

/** 엔진 타이머: 전사를 TRANSCRIPT_WAIT_MS 안에 못 받았다(6.3.2절). 이미 처리된 칸이면 아무것도 하지 않는다. */
export function realtimeTranscriptTimeout(t: RealtimeTracker, itemId: string): RealtimeResult {
  const n = fork(t);
  const actions: RealtimeAction[] = [];
  if (n.awaitingItemId !== itemId) return { tracker: n, actions };
  // 붙든 동안이면 차례를 끝내지 않는다. submit이 타이머를 다시 건다.
  if (n.held) return { tracker: n, actions };
  n.awaitingItemId = null;
  actions.push({ emit: { type: "USER_TURN_END", text: "", transcribed: false } });
  return { tracker: n, actions };
}
