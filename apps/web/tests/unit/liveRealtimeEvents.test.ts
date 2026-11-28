// liveRealtimeEvents 단위 시험(설계서 6.3절, 16.1절). realtimeOp와 realtimeStep이 정한 보내기·내보내기를 JSON 예시로 본다.
import { describe, expect, it } from "vitest";
import type { EngineEvent } from "@/lib/liveEngine";
import { encodeAiTurn } from "@/lib/liveText";
import {
  createRealtimeTracker, parseToolCalls, realtimeOp, realtimeStep, realtimeTranscriptTimeout,
  type EngineOp, type RealtimeAction, type RealtimeTracker,
} from "@/lib/liveRealtimeEvents";

const SLOTS = { product: "무선 이어폰", info: "배터리", options: "흰색", budget: "" };

function tr(patch: Partial<RealtimeTracker> = {}, maxTurns = 30): RealtimeTracker {
  return { ...createRealtimeTracker(maxTurns), ...patch };
}
const emits = (a: RealtimeAction[]): EngineEvent[] => a.flatMap((x) => ("emit" in x ? [x.emit] : []));
const sends = (a: RealtimeAction[]): Record<string, unknown>[] => a.flatMap((x) => ("send" in x ? [x.send as Record<string, unknown>] : []));
const sendTypes = (a: RealtimeAction[]) => sends(a).map((s) => s.type);
const logs = (a: RealtimeAction[]) => a.flatMap((x) => ("log" in x ? [x.log] : []));

function op(t: RealtimeTracker, o: EngineOp) { return realtimeOp(t, o); }
function step(t: RealtimeTracker, e: unknown) { return realtimeStep(t, e); }
/** 서버 이벤트를 차례로 먹여 마지막 tracker와 모든 동작을 모은다. */
function run(t: RealtimeTracker, events: unknown[]) {
  const all: RealtimeAction[] = [];
  let cur = t;
  for (const e of events) {
    const r = step(cur, e);
    cur = r.tracker;
    all.push(...r.actions);
  }
  return { tracker: cur, actions: all };
}

const fc = (name: string, callId: string, args: unknown) => ({
  type: "function_call", name, call_id: callId, arguments: typeof args === "string" ? args : JSON.stringify(args),
});
const done = (status: string, output: unknown[] = []) => ({ type: "response.done", response: { status, output } });

describe("realtimeStep 서버 이벤트 표", () => {
  it("speech_started는 heard를 켜고 USER_SPEECH_START와 turnCap 켜기를 낸다", () => {
    const r = step(tr(), { type: "input_audio_buffer.speech_started" });
    expect(r.tracker.heard).toBe(true);
    expect(emits(r.actions)).toEqual([{ type: "USER_SPEECH_START" }]);
    expect(r.actions).toContainEqual({ turnCap: true });
  });

  it("committed는 마이크를 끄고 turnCap을 끄고 전사 대기를 건다", () => {
    const r = step(tr(), { type: "input_audio_buffer.committed", item_id: "item_1" });
    expect(r.tracker.committedInTurn).toBe(true);
    expect(r.tracker.awaitingItemId).toBe("item_1");
    expect(r.actions).toContainEqual({ mic: false });
    expect(r.actions).toContainEqual({ turnCap: false });
    expect(r.actions).toContainEqual({ waitTranscript: { itemId: "item_1", ms: 1500 } });
  });

  it("전사 delta는 USER_TRANSCRIPT final=false", () => {
    const r = step(tr(), { type: "conversation.item.input_audio_transcription.delta", delta: "안녕" });
    expect(emits(r.actions)).toEqual([{ type: "USER_TRANSCRIPT", text: "안녕", final: false }]);
  });

  it("기다리던 칸의 전사 완료는 USER_TURN_END(transcribed)", () => {
    const t = tr({ awaitingItemId: "item_1", committedInTurn: true });
    const r = step(t, { type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: " 이어폰 찾아 줘 " });
    expect(emits(r.actions)).toEqual([{ type: "USER_TURN_END", text: "이어폰 찾아 줘", transcribed: true }]);
    expect(r.tracker.awaitingItemId).toBeNull();
  });

  it("전사가 늦게 오는 순서: 1500ms 타이머 뒤 완료는 USER_TRANSCRIPT final=true", () => {
    let t = tr({ awaitingItemId: "item_1", committedInTurn: true });
    const timeout = realtimeTranscriptTimeout(t, "item_1");
    expect(emits(timeout.actions)).toEqual([{ type: "USER_TURN_END", text: "", transcribed: false }]);
    t = timeout.tracker;
    const late = step(t, { type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "검정색" });
    expect(emits(late.actions)).toEqual([{ type: "USER_TRANSCRIPT", text: "검정색", final: true }]);
  });

  it("이미 처리된 칸의 타이머는 아무것도 하지 않는다", () => {
    expect(realtimeTranscriptTimeout(tr(), "item_9").actions).toEqual([]);
  });

  it("빈 전사는 NO_SPEECH", () => {
    const t = tr({ awaitingItemId: "item_1" });
    const r = step(t, { type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "  " });
    expect(emits(r.actions)).toEqual([{ type: "NO_SPEECH" }]);
  });

  it("전사 실패는 기다리던 칸이면 USER_TURN_END 빈 글 transcribed=false", () => {
    const t = tr({ awaitingItemId: "item_1" });
    const r = step(t, { type: "conversation.item.input_audio_transcription.failed", item_id: "item_1" });
    expect(emits(r.actions)).toEqual([{ type: "USER_TURN_END", text: "", transcribed: false }]);
    const other = step(tr({ awaitingItemId: "item_1" }), { type: "conversation.item.input_audio_transcription.failed", item_id: "item_2" });
    expect(emits(other.actions)).toEqual([]);
  });

  it("response.created는 응답 상태를 새로 연다", () => {
    const r = step(tr({ audioStarted: true, replyText: "앞" }), { type: "response.created" });
    expect(r.tracker).toMatchObject({ responseActive: true, audioStarted: false, replyText: "" });
  });

  it("소리 시작, 자막 모으기, 자막 끝, 소리 끝", () => {
    const r = run(tr(), [
      { type: "response.created" },
      { type: "output_audio_buffer.started" },
      { type: "response.output_audio_transcript.delta", delta: "무엇을 " },
      { type: "response.output_audio_transcript.delta", delta: "찾으세요?" },
      { type: "response.output_audio_transcript.done", transcript: "무엇을 찾으세요?" },
      { type: "output_audio_buffer.stopped" },
    ]);
    expect(emits(r.actions)).toEqual([
      { type: "REPLY_START" },
      { type: "REPLY_TEXT", text: "무엇을 ", final: false },
      { type: "REPLY_TEXT", text: "무엇을 찾으세요?", final: false },
      { type: "REPLY_TEXT", text: "무엇을 찾으세요?", final: true },
      { type: "REPLY_END" },
    ]);
    expect(r.tracker.audioPlaying).toBe(false);
  });

  it("stopped와 cleared가 모두 와도 REPLY_END는 한 번", () => {
    const r = run(tr({ audioPlaying: true, audioStarted: true }), [
      { type: "output_audio_buffer.cleared" }, { type: "output_audio_buffer.stopped" },
    ]);
    expect(emits(r.actions)).toEqual([{ type: "REPLY_END" }]);
  });

  it("모르는 이벤트와 timeout_triggered는 아무것도 내지 않는다", () => {
    expect(step(tr(), { type: "something.new" }).actions).toEqual([]);
    expect(step(tr(), { type: "input_audio_buffer.timeout_triggered" }).actions).toEqual([]);
    expect(step(tr(), "문자열").actions).toEqual([]);
    expect(step(tr(), null).actions).toEqual([]);
  });
});

describe("realtimeStep response.done", () => {
  it("cancelled: 도구 호출을 버리고, 소리가 없었으면 REPLY_END", () => {
    const r = step(tr({ responseActive: true }), done("cancelled", [fc("register_request", "c1", {})]));
    expect(r.tracker.responseActive).toBe(false);
    expect(emits(r.actions)).toEqual([{ type: "REPLY_END" }]);
    expect(sends(r.actions)).toEqual([]);
  });

  it("cancelled: 소리가 났으면 REPLY_END를 내지 않는다(소리 끝 이벤트가 낸다)", () => {
    const r = step(tr({ responseActive: true, audioStarted: true }), done("cancelled"));
    expect(emits(r.actions)).toEqual([]);
  });

  it("incomplete: 도구 호출이 있어도 INTENT가 나오지 않고 호출마다 incomplete로 닫는다", () => {
    const r = step(tr(), done("incomplete", [fc("confirm_request", "c1", SLOTS), fc("register_request", "c2", {})]));
    const e = emits(r.actions);
    expect(e.some((x) => x.type === "INTENT")).toBe(false);
    expect(e).toEqual([{ type: "FAILED", kind: "failed" }]);
    const s = sends(r.actions);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: JSON.stringify({ ok: false, error: "incomplete" }) } });
    expect(s[1]).toMatchObject({ item: { call_id: "c2" } });
    expect(sendTypes(r.actions)).not.toContain("response.create");
    expect(logs(r.actions)).toEqual(["rt=incomplete"]);
  });

  it("failed: FAILED failed와 로그", () => {
    const r = step(tr(), done("failed"));
    expect(emits(r.actions)).toEqual([{ type: "FAILED", kind: "failed" }]);
    expect(logs(r.actions)).toEqual(["rt=failed"]);
  });

  it("completed 소리 없는 confirm_request는 INTENT만 내고 상태 기계가 다음 동작을 정한다", () => {
    const r = step(tr(), done("completed", [fc("confirm_request", "c1", SLOTS)]));
    expect(emits(r.actions)).toEqual([
      { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c1" },
    ]);
  });

  it("completed confirm_request에서 소리가 아직 나고 있으면 상태 기계에 알린다", () => {
    const r = step(tr({ audioStarted: true, audioPlaying: true }), done("completed", [fc("confirm_request", "c1", SLOTS)]));
    expect(emits(r.actions)).toEqual([{ type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c1", audioPending: true }]);
  });

  it("completed register_request와 end_conversation은 REPLY_END를 내지 않는다", () => {
    const reg = step(tr(), done("completed", [fc("register_request", "c1", {})]));
    expect(emits(reg.actions)).toEqual([{ type: "INTENT", kind: "register", callId: "c1" }]);
    const end = step(tr(), done("completed", [fc("end_conversation", "c2", {})]));
    expect(emits(end.actions)).toEqual([{ type: "INTENT", kind: "end", callId: "c2" }]);
  });

  it("completed 도구 호출 없음: 소리가 없으면 REPLY_END", () => {
    const r = step(tr(), done("completed", [{ type: "message" }]));
    expect(emits(r.actions)).toEqual([{ type: "REPLY_END" }]);
  });

  it("function_call 두 개가 든 응답은 둘 다 INTENT가 된다", () => {
    const r = step(tr(), done("completed", [fc("confirm_request", "c1", SLOTS), fc("end_conversation", "c2", {})]));
    expect(emits(r.actions)).toEqual([
      { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c1" },
      { type: "INTENT", kind: "end", callId: "c2" },
    ]);
  });

  it("깨진 arguments: bad_arguments로 한 번 다시 시키고, 두 번째는 FAILED", () => {
    const first = step(tr(), done("completed", [fc("confirm_request", "c1", "{깨진")]));
    expect(first.tracker.badArgsRetried).toBe(true);
    expect(sends(first.actions)[0]).toMatchObject({ item: { call_id: "c1", output: JSON.stringify({ ok: false, error: "bad_arguments" }) } });
    expect(sendTypes(first.actions)).toContain("response.create");
    expect(first.tracker.turnsSent).toBe(1);
    expect(emits(first.actions)).toEqual([]);
    const second = step(first.tracker, done("completed", [fc("confirm_request", "c2", { product: "" })]));
    expect(emits(second.actions)).toEqual([{ type: "FAILED", kind: "failed" }]);
    expect(sendTypes(second.actions)).not.toContain("response.create");
  });

  it("제품이 있는 confirm_request가 오면 다시 시킨 표시를 지운다", () => {
    const t = tr({ badArgsRetried: true });
    const r = step(t, done("completed", [fc("confirm_request", "c1", SLOTS)]));
    expect(r.tracker.badArgsRetried).toBe(false);
  });

  it("parseToolCalls는 function_call만 뽑고 깨진 arguments는 null", () => {
    const calls = parseToolCalls({ output: [{ type: "message" }, fc("a", "1", { x: 1 }), fc("b", "2", "{x")] });
    expect(calls).toEqual([{ name: "a", callId: "1", args: { x: 1 } }, { name: "b", callId: "2", args: null }]);
    expect(parseToolCalls(null)).toEqual([]);
  });
});

describe("realtimeStep error", () => {
  it("ignoreEventIds에 있는 error는 무시한다", () => {
    const t = tr({ ignoreEventIds: ["lh_3"] });
    const r = step(t, { type: "error", error: { type: "invalid_request_error", code: "x", event_id: "lh_3" } });
    expect(r.actions).toEqual([]);
  });

  it("logOnlyEventIds에 있는 error는 로그만 남긴다", () => {
    const t = tr({ logOnlyEventIds: ["lh_4"] });
    const r = step(t, { type: "error", error: { type: "invalid_request_error", code: "bad_item", event_id: "lh_4" } });
    expect(logs(r.actions)).toEqual(["rt_error=bad_item"]);
    expect(emits(r.actions)).toEqual([]);
  });

  it("그 밖의 error는 로그와 FAILED. 글자는 꼬리표로 걸러진다", () => {
    const r = step(tr(), { type: "error", error: { type: "server_error", message: "이용자 말 노출 금지" } });
    expect(logs(r.actions)).toEqual(["rt_error=server_error"]);
    expect(emits(r.actions)).toEqual([{ type: "FAILED", kind: "failed" }]);
    const odd = step(tr(), { type: "error", error: { code: "한글 코드!" } });
    expect(logs(odd.actions)).toEqual(["rt_error=unknown"]);
  });
});

describe("realtimeOp", () => {
  it("모든 이벤트에 lh_ 일련번호 event_id가 붙는다", () => {
    const r = op(tr(), { op: "listen", keep: false });
    expect(sends(r.actions)[0]).toMatchObject({ type: "input_audio_buffer.clear", event_id: "lh_1" });
    expect(r.tracker.nextEventId).toBe(2);
    expect(r.tracker.ignoreEventIds).toEqual(["lh_1"]);
  });

  it("listen(keep 거짓): clear, 마이크 켬, LISTEN_STARTED", () => {
    const t = tr({ heard: true, committedInTurn: true, held: true, heldText: "앞 말" });
    const r = op(t, { op: "listen", keep: false });
    expect(sendTypes(r.actions)).toEqual(["input_audio_buffer.clear"]);
    expect(r.actions).toContainEqual({ mic: true });
    expect(emits(r.actions)).toEqual([{ type: "LISTEN_STARTED", late: false }]);
    expect(r.tracker).toMatchObject({ heard: false, committedInTurn: false, held: false, heldText: "" });
  });

  it("listen(keep)은 clear를 보내지 않고 붙든 글을 남긴다", () => {
    const r = op(tr({ held: true, heldText: "앞 말" }), { op: "listen", keep: true });
    expect(sends(r.actions)).toEqual([]);
    expect(r.actions).toContainEqual({ mic: true });
    expect(r.tracker.heldText).toBe("앞 말");
    expect(r.tracker.held).toBe(false);
  });

  it("hold는 마이크를 끄고 held를 켠다", () => {
    const r = op(tr(), { op: "hold" });
    expect(r.actions).toContainEqual({ mic: false });
    expect(r.tracker.held).toBe(true);
  });

  it("submit: 붙든 글이 있으면 그 글로 USER_TURN_END", () => {
    const r = op(tr({ held: true, heldText: "검정색으로" }), { op: "submit" });
    expect(emits(r.actions)).toEqual([{ type: "USER_TURN_END", text: "검정색으로", transcribed: true }]);
    expect(sends(r.actions)).toEqual([]);
    expect(r.tracker.heldText).toBe("");
    expect(r.tracker.held).toBe(false);
  });

  it("자동 commit 직후의 submit은 아무것도 보내지 않는다", () => {
    const r = op(tr({ committedInTurn: true, heard: true }), { op: "submit" });
    expect(sends(r.actions)).toEqual([]);
    expect(emits(r.actions)).toEqual([]);
    expect(r.actions).toContainEqual({ mic: false });
  });

  it("들은 말이 없는 submit은 clear와 NO_SPEECH(commit 없음)", () => {
    const r = op(tr({ heard: false }), { op: "submit" });
    expect(sendTypes(r.actions)).toEqual(["input_audio_buffer.clear"]);
    expect(emits(r.actions)).toEqual([{ type: "NO_SPEECH" }]);
  });

  it("말하는 중 submit은 commit", () => {
    const r = op(tr({ heard: true }), { op: "submit" });
    expect(sendTypes(r.actions)).toEqual(["input_audio_buffer.commit"]);
    expect(r.tracker.ignoreEventIds).toHaveLength(1);
  });

  it("붙든 동안 온 전사는 쌓이고, 다음 USER_TURN_END에 이어 붙는다", () => {
    let t = tr({ heard: true });
    t = op(t, { op: "hold" }).tracker;
    t = step(t, { type: "input_audio_buffer.committed", item_id: "i1" }).tracker;
    const completed = step(t, { type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "검정색" });
    expect(emits(completed.actions)).toEqual([]);
    expect(completed.tracker.heldText).toBe("검정색");
    t = completed.tracker;
    t = op(t, { op: "listen", keep: true }).tracker;
    // 붙든 글이 남은 채 새 전사가 오면 앞 글에 이어진다
    t = step(t, { type: "input_audio_buffer.committed", item_id: "i2" }).tracker;
    const next = step(t, { type: "conversation.item.input_audio_transcription.completed", item_id: "i2", transcript: "으로 해 주세요" });
    expect(emits(next.actions)).toEqual([{ type: "USER_TURN_END", text: "검정색 으로 해 주세요", transcribed: true }]);
  });

  it("붙든 동안 전사 시간이 지나도 차례를 끝내지 않고, submit이 대기를 다시 건다", () => {
    let t = tr({ heard: true });
    t = op(t, { op: "hold" }).tracker;
    t = step(t, { type: "input_audio_buffer.committed", item_id: "i1" }).tracker;
    const timeout = realtimeTranscriptTimeout(t, "i1");
    expect(timeout.actions).toEqual([]);
    const submit = op(timeout.tracker, { op: "submit" });
    expect(submit.actions).toContainEqual({ waitTranscript: { itemId: "i1", ms: 1500 } });
    const again = realtimeTranscriptTimeout(submit.tracker, "i1");
    expect(emits(again.actions)).toEqual([{ type: "USER_TURN_END", text: "", transcribed: false }]);
  });

  it("cancelListen: discard면 clear, 아니면 마이크만 끈다", () => {
    const discard = op(tr({ heldText: "글" }), { op: "cancelListen", discard: true });
    expect(sendTypes(discard.actions)).toEqual(["input_audio_buffer.clear"]);
    expect(discard.tracker.heldText).toBe("");
    const keep = op(tr({ heldText: "글" }), { op: "cancelListen", discard: false });
    expect(sends(keep.actions)).toEqual([]);
    expect(keep.tracker.heldText).toBe("글");
    expect(keep.actions).toContainEqual({ mic: false });
  });

  it("respond(voice)는 response.create를 보내고 센다", () => {
    const r = op(tr(), { op: "respond", text: "", source: "voice" });
    expect(sendTypes(r.actions)).toEqual(["response.create"]);
    expect(r.tracker.turnsSent).toBe(1);
  });

  it("respond(text)는 input_text 칸을 만든 뒤 response.create", () => {
    const r = op(tr(), { op: "respond", text: "이어폰 찾아 줘", source: "text" });
    expect(sends(r.actions)[0]).toMatchObject({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: "이어폰 찾아 줘" }] },
    });
    expect(sendTypes(r.actions)).toEqual(["conversation.item.create", "response.create"]);
    expect(r.tracker.turnsSent).toBe(1);
  });

  it("maxTurns에 닿으면 LOST budget이고 아무것도 보내지 않는다", () => {
    const voice = op(tr({ turnsSent: 2 }, 2), { op: "respond", text: "", source: "voice" });
    expect(emits(voice.actions)).toEqual([{ type: "LOST", reason: "budget" }]);
    expect(sends(voice.actions)).toEqual([]);
    const text = op(tr({ turnsSent: 2 }, 2), { op: "respond", text: "글", source: "text" });
    expect(emits(text.actions)).toEqual([{ type: "LOST", reason: "budget" }]);
    expect(sends(text.actions)).toEqual([]);
    const tool = op(tr({ turnsSent: 2 }, 2), { op: "toolResult", callId: "c1", output: {}, respond: true });
    expect(emits(tool.actions)).toEqual([{ type: "LOST", reason: "budget" }]);
  });

  it("cancelResponse는 response.cancel을 output_audio_buffer.clear보다 먼저 보낸다", () => {
    const r = op(tr({ responseActive: true, audioPlaying: true }), { op: "cancelResponse" });
    expect(sendTypes(r.actions)).toEqual(["response.cancel", "output_audio_buffer.clear"]);
    expect(r.tracker.ignoreEventIds).toHaveLength(2);
  });

  it("cancelResponse: 응답만 있으면 cancel만, 소리만 있으면 clear만, 둘 다 없으면 아무것도 안 보낸다", () => {
    expect(sendTypes(op(tr({ responseActive: true }), { op: "cancelResponse" }).actions)).toEqual(["response.cancel"]);
    expect(sendTypes(op(tr({ audioPlaying: true }), { op: "cancelResponse" }).actions)).toEqual(["output_audio_buffer.clear"]);
    expect(op(tr(), { op: "cancelResponse" }).actions).toEqual([]);
  });

  it("toolResult는 function_call_output을 보내고, respond면 response.create도 센다", () => {
    const quiet = op(tr(), { op: "toolResult", callId: "c1", output: { ok: true }, respond: false });
    expect(sends(quiet.actions)).toHaveLength(1);
    expect(sends(quiet.actions)[0]).toMatchObject({ item: { type: "function_call_output", call_id: "c1", output: "{\"ok\":true}" } });
    expect(quiet.tracker.turnsSent).toBe(0);
    const loud = op(tr(), { op: "toolResult", callId: "c1", output: { ok: true }, respond: true });
    expect(sendTypes(loud.actions)).toEqual(["conversation.item.create", "response.create"]);
    expect(loud.tracker.turnsSent).toBe(1);
  });

  it("보완 질문은 모델이 도구를 다시 부르지 않고, 이전 소리의 끝도 기다림을 풀지 않는다", () => {
    const result = op(tr({ audioPlaying: true }), {
      op: "toolResult", callId: "c1", output: { error: "intake_incomplete" }, respond: "clarify",
    });
    expect(sends(result.actions).at(-1)).toMatchObject({ type: "response.create", response: { tool_choice: "none" } });
    expect(result.tracker.turnsSent).toBe(1);
    const stale = step(result.tracker, { type: "output_audio_buffer.cleared" });
    expect(emits(stale.actions)).toEqual([]);
    const created = step(stale.tracker, { type: "response.created" });
    const started = step(created.tracker, { type: "output_audio_buffer.started" });
    expect(emits(started.actions)).toEqual([{ type: "REPLY_START" }]);
  });

  it("낭독할 대본은 지시문과 분리하고 일반 대화에 추가하지 않는다", () => {
    const text = "다 말씀하신 뒤 '다음'이라고 해 주세요.";
    const result = op(tr(), { op: "narrate", text });
    const request = sends(result.actions).at(-1);
    expect(request).toMatchObject({
      type: "response.create",
      response: {
        conversation: "none",
        tool_choice: "none",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
      },
    });
    expect(JSON.stringify(request)).not.toContain("지금 할 일");
    expect(request).toMatchObject({ response: { instructions: expect.not.stringContaining(text) } });
  });

  it("setRate는 system 칸으로 말투를 부탁하고 id를 logOnly에 넣는다", () => {
    const slow = op(tr(), { op: "setRate", rate: "slow" });
    expect(sends(slow.actions)[0]).toMatchObject({
      item: { role: "system", content: [{ type: "input_text", text: "이용자가 말을 천천히 해 달라고 했습니다. 이제부터 그렇게 말합니다." }] },
    });
    expect(slow.tracker.logOnlyEventIds).toHaveLength(1);
    const normal = op(tr(), { op: "setRate", rate: "normal" });
    expect(JSON.stringify(sends(normal.actions)[0])).toContain("보통 빠르기로");
    const fast = op(tr(), { op: "setRate", rate: "fast" });
    expect(JSON.stringify(sends(fast.actions)[0])).toContain("빠르게");
  });

  it("restore는 마지막 12칸을 넣고 assistant 칸은 output_text로 넣는다", () => {
    const history = [] as { role: "user" | "assistant"; content: string }[];
    for (let i = 0; i < 8; i += 1) {
      history.push({ role: "user", content: `이용자 ${i}` });
      history.push({ role: "assistant", content: encodeAiTurn({ reply: `답 ${i}`, status: "asking", slots: SLOTS }) });
    }
    const r = op(tr(), { op: "restore", history });
    const s = sends(r.actions);
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ item: { role: "user", content: [{ type: "input_text", text: "이용자 2" }] } });
    expect(s[1]).toMatchObject({ item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "답 2" }] } });
    expect(r.tracker.logOnlyEventIds).toHaveLength(12);
    expect(sendTypes(r.actions).every((x) => x === "conversation.item.create")).toBe(true);
  });

  it("restore는 깨진 assistant 칸을 건너뛴다", () => {
    const r = op(tr(), { op: "restore", history: [{ role: "assistant", content: "{깨짐" }, { role: "user", content: "안녕" }] });
    expect(sends(r.actions)).toHaveLength(1);
  });

  it("어떤 동작도 session.update를 내지 않는다", () => {
    const ops: EngineOp[] = [
      { op: "listen", keep: false }, { op: "listen", keep: true }, { op: "hold" }, { op: "submit" },
      { op: "cancelListen", discard: true }, { op: "respond", text: "글", source: "text" },
      { op: "respond", text: "", source: "voice" }, { op: "cancelResponse" },
      { op: "toolResult", callId: "c", output: {}, respond: true }, { op: "setRate", rate: "slow" },
      { op: "restore", history: [{ role: "user", content: "안녕" }] },
    ];
    for (const o of ops) {
      const t = tr({ responseActive: true, audioPlaying: true, heard: true });
      const types = sendTypes(op(t, o).actions);
      expect(types).not.toContain("session.update");
    }
  });

  it("입력 tracker를 바꾸지 않는다", () => {
    const t = tr({ responseActive: true });
    const before = JSON.stringify(t);
    op(t, { op: "cancelResponse" });
    step(t, { type: "response.created" });
    expect(JSON.stringify(t)).toBe(before);
  });
});
