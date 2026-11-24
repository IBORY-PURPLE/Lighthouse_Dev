// '다음' 방식(LIVE_ADVANCE=manual): 이용자가 '다음'이라고 하거나 큰 단추를 누를 때만 모은 말을 AI에게 넘긴다.
import { describe, expect, it } from "vitest";
import { isNextCommand, splitNext } from "@/lib/liveCommands";
import { createInitialLive, liveStep, type LiveEffect, type LiveEvent, type LiveState } from "@/lib/liveMachine";
import {
  createRealtimeTracker, realtimeOp, realtimeStep,
  type RealtimeAction, type RealtimeTracker,
} from "@/lib/liveRealtimeEvents";
import type { EngineEvent } from "@/lib/liveEngine";

// ---------------------------------------------------------------- 도우미

type Run = { state: LiveState; effects: LiveEffect[] };

function run(state: LiveState, ...events: LiveEvent[]): Run {
  let s = state;
  const effects: LiveEffect[] = [];
  for (const e of events) {
    const r = liveStep(s, e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}
const mk = (speechAvailable = true): LiveState =>
  createInitialLive({ cid: "c1", visit: "first", tts: true, speechAvailable });
const speakEnd = (s: LiveState): LiveEvent => ({ type: "SPEAK_END", id: s.speaking as string });
const ofType = <T extends LiveEffect["type"]>(fx: LiveEffect[], type: T) =>
  fx.filter((f): f is Extract<LiveEffect, { type: T }> => f.type === type);
const spoken = (fx: LiveEffect[]) => ofType(fx, "SPEAK").map((f) => f.id);
const responds = (fx: LiveEffect[]) => ofType(fx, "ENGINE_RESPOND").map((f) => f.text);

/** '다음' 방식 안내를 읽는 중인 상태(연결 직후). */
function atManualGuide(engine: "realtime" | "fallback"): Run {
  const realtime = engine === "realtime";
  let r = run(mk(), { type: "CONFIG", realtime, advance: "manual" }, { type: "START" });
  r = run(r.state, speakEnd(r.state));
  if (realtime) r = run(r.state, { type: "MIC_READY" });
  return run(r.state, { type: "READY", engine, inputMode: "voice" });
}
/** 안내가 끝나 첫 차례가 열린 상태. */
function atManualListening(engine: "realtime" | "fallback" = "realtime"): Run {
  const g = atManualGuide(engine);
  return run(g.state, speakEnd(g.state), { type: "LISTEN_STARTED", late: false });
}

const emits = (a: RealtimeAction[]): EngineEvent[] => a.flatMap((x) => ("emit" in x ? [x.emit] : []));
const mics = (a: RealtimeAction[]): boolean[] => a.flatMap((x) => ("mic" in x ? [x.mic] : []));
const sendTypes = (a: RealtimeAction[]) => a.flatMap((x) => ("send" in x ? [(x.send as { type: string }).type] : []));
const committed = (id: string) => ({ type: "input_audio_buffer.committed", item_id: id });
const transcript = (id: string, text: string) => ({
  type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text,
});
function stickyTracker(): RealtimeTracker {
  return realtimeOp(createRealtimeTracker(30), { op: "listen", keep: false, sticky: true }).tracker;
}

// ---------------------------------------------------------------- 말 판정

describe("'다음' 말 판정", () => {
  it("글 전체가 넘어가자는 말이면 참", () => {
    for (const t of ["다음", "다음 단계", "다음 단계요", "다음으로 넘어가 주세요", "넘어가", "다 했어요", "다음.", "이상입니다"]) {
      expect(isNextCommand(t), t).toBe(true);
    }
  });
  it("다른 말은 거짓", () => {
    for (const t of ["다음 달에 나오는 모델", "무선 이어폰", "다음에 살게요", "그만", "네", ""]) {
      expect(isNextCommand(t), t).toBe(false);
    }
  });
  it("끝에 붙은 말은 떼어 내고 앞의 내용을 남긴다", () => {
    expect(splitNext("검은색으로요. 다음")).toEqual({ content: "검은색으로요.", next: true });
    expect(splitNext("배터리가 오래 가면 좋겠어요 다음 단계")).toEqual({ content: "배터리가 오래 가면 좋겠어요", next: true });
    expect(splitNext("다음 단계")).toEqual({ content: "", next: true });
  });
  it("가운데나 앞에 있는 '다음'은 내용이다", () => {
    expect(splitNext("다음 달에 나오는 모델")).toEqual({ content: "다음 달에 나오는 모델", next: false });
    expect(splitNext("무선 이어폰")).toEqual({ content: "무선 이어폰", next: false });
  });
});

// ---------------------------------------------------------------- Realtime 이어 듣기

describe("Realtime 이어 듣기(sticky)", () => {
  it("서버가 commit해도 마이크를 닫지 않고, 전사를 USER_PART로 낸다", () => {
    const t0 = stickyTracker();
    const a = realtimeStep(t0, { type: "input_audio_buffer.speech_started" });
    const b = realtimeStep(a.tracker, committed("i1"));
    expect(mics(b.actions)).toEqual([]);
    const c = realtimeStep(b.tracker, transcript("i1", "무선 이어폰"));
    expect(emits(c.actions)).toEqual([{ type: "USER_PART", text: "무선 이어폰" }]);
    // 둘째 토막도 같은 차례 안에서 온다.
    const d = realtimeStep(realtimeStep(c.tracker, committed("i2")).tracker, transcript("i2", "검은색"));
    expect(emits(d.actions)).toEqual([{ type: "USER_PART", text: "검은색" }]);
  });
  it("빈 전사는 토막으로 내지 않는다", () => {
    const b = realtimeStep(stickyTracker(), committed("i1"));
    expect(emits(realtimeStep(b.tracker, transcript("i1", "  ")).actions)).toEqual([]);
  });
  it("말이 없을 때 submit하면 마이크를 닫고 NO_SPEECH를 낸다", () => {
    const b = realtimeStep(realtimeStep(stickyTracker(), { type: "input_audio_buffer.speech_started" }).tracker, committed("i1"));
    const s = realtimeOp(b.tracker, { op: "submit" });
    expect(mics(s.actions)).toEqual([false]);
    expect(emits(s.actions)).toEqual([{ type: "NO_SPEECH" }]);
    expect(s.tracker.sticky).toBe(false);
  });
  it("말하는 중에 submit하면 commit하고, 그 전사는 보통 차례 끝으로 온다", () => {
    const a = realtimeStep(stickyTracker(), { type: "input_audio_buffer.speech_started" });
    const s = realtimeOp(a.tracker, { op: "submit" });
    expect(sendTypes(s.actions)).toContain("input_audio_buffer.commit");
    const c = realtimeStep(s.tracker, committed("i9"));
    expect(mics(c.actions)).toEqual([false]);
    const d = realtimeStep(c.tracker, transcript("i9", "흰색으로요"));
    expect(emits(d.actions)).toEqual([{ type: "USER_TURN_END", text: "흰색으로요", transcribed: true }]);
  });
  it("cancelListen과 hold는 이어 듣기를 끈다", () => {
    expect(realtimeOp(stickyTracker(), { op: "cancelListen", discard: false }).tracker.sticky).toBe(false);
    expect(realtimeOp(stickyTracker(), { op: "hold" }).tracker.sticky).toBe(false);
  });
  it("sticky 없이 열면 예전과 같다(commit에서 마이크를 닫는다)", () => {
    const t0 = realtimeOp(createRealtimeTracker(30), { op: "listen", keep: false }).tracker;
    expect(t0.sticky).toBe(false);
    expect(mics(realtimeStep(t0, committed("i1")).actions)).toEqual([false]);
  });
});

// ---------------------------------------------------------------- 상태 기계

describe("'다음' 방식: 상태 기계", () => {
  it("연결되면 방식 안내를 한 번 읽고, 끝나면 이어 듣기로 차례를 연다", () => {
    const g = atManualGuide("realtime");
    expect(spoken(g.effects)).toContain("manualGuide");
    expect(g.state.phase).toBe("listening");
    const r = run(g.state, speakEnd(g.state));
    expect(ofType(r.effects, "OPEN_TURN")).toEqual([{ type: "OPEN_TURN", earcon: "turn", settle: true, keep: false, sticky: true }]);
  });
  it("advance가 없으면 안내도 sticky도 없다", () => {
    let r = run(mk(), { type: "CONFIG", realtime: true }, { type: "START" });
    r = run(r.state, speakEnd(r.state));
    r = run(r.state, { type: "MIC_READY" }, { type: "READY", engine: "realtime", inputMode: "voice" });
    expect(spoken(r.effects)).not.toContain("manualGuide");
    expect(ofType(r.effects, "OPEN_TURN")[0]).not.toHaveProperty("sticky");
  });
  it("말이 끊겨도 AI에게 넘기지 않고 모아 둔다", () => {
    const l = atManualListening();
    const r = run(l.state, { type: "USER_SPEECH_START" }, { type: "USER_PART", text: "무선 이어폰이요" });
    expect(responds(r.effects)).toEqual([]);
    expect(r.state.phase).toBe("listening");
    expect(r.state.mic).toBe("on");
    expect(r.state.parts).toEqual(["무선 이어폰이요"]);
    expect(ofType(r.effects, "TIMER_SET").filter((f) => f.id === "more").at(-1)?.ms).toBe(6_000);
  });
  it("'다음'이라고 하면 모은 말을 한 번에 넘긴다", () => {
    const l = atManualListening();
    const r = run(
      l.state,
      { type: "USER_PART", text: "무선 이어폰이요" },
      { type: "USER_PART", text: "배터리가 오래 가면 좋겠어요" },
      { type: "USER_PART", text: "다음 단계" },
    );
    expect(responds(r.effects)).toEqual(["무선 이어폰이요 배터리가 오래 가면 좋겠어요"]);
    expect(r.state.phase).toBe("thinking");
    expect(r.state.parts).toEqual([]);
    expect(ofType(r.effects, "ENGINE_CANCEL_LISTEN").length).toBeGreaterThan(0);
  });
  it("말 끝에 붙은 '다음'도 듣는다", () => {
    const l = atManualListening();
    const r = run(l.state, { type: "USER_PART", text: "검은색으로요. 다음" });
    expect(responds(r.effects)).toEqual(["검은색으로요."]);
  });
  it("모은 말 없이 '다음'만 하면 그 말을 AI에게 넘겨 다음 항목으로 가게 한다", () => {
    const l = atManualListening();
    const r = run(l.state, { type: "USER_PART", text: "다음" });
    expect(responds(r.effects)).toEqual(["다음"]);
  });
  it("조용하면 마이크를 닫고 넘기는 법을 알린 뒤 다시 연다. 모은 말은 남는다", () => {
    const l = atManualListening();
    let r = run(l.state, { type: "USER_PART", text: "무선 이어폰이요" }, { type: "TIMER", id: "more" });
    expect(spoken(r.effects)).toEqual(["manualMore"]);
    expect(r.state.mic).toBe("off");
    r = run(r.state, speakEnd(r.state));
    expect(ofType(r.effects, "OPEN_TURN")[0]).toMatchObject({ sticky: true });
    expect(r.state.parts).toEqual(["무선 이어폰이요"]);
  });
  it("말 명령은 모으지 않고 바로 처리한다", () => {
    const l = atManualListening();
    const r = run(l.state, { type: "USER_PART", text: "무선 이어폰이요" }, { type: "USER_PART", text: "천천히" });
    expect(r.state.rate).toBe("slow");
    expect(responds(r.effects)).toEqual([]);
    expect(r.state.parts).toEqual(["무선 이어폰이요"]);
  });
  it("큰 단추를 누르면 모은 말을 넘긴다(그때 말이 없었어도)", () => {
    const l = atManualListening();
    let r = run(l.state, { type: "USER_PART", text: "무선 이어폰이요" }, { type: "MAIN_BUTTON" });
    expect(ofType(r.effects, "ENGINE_SUBMIT")).toHaveLength(1);
    r = run(r.state, { type: "NO_SPEECH" });
    expect(responds(r.effects)).toEqual(["무선 이어폰이요"]);
    expect(r.state.manualSubmit).toBe(false);
  });
  it("큰 단추를 누를 때 하던 말은 모은 말 뒤에 붙여 넘긴다", () => {
    const l = atManualListening();
    let r = run(l.state, { type: "USER_PART", text: "무선 이어폰이요" }, { type: "MAIN_BUTTON" });
    r = run(r.state, { type: "USER_TURN_END", text: "흰색으로요", transcribed: true });
    expect(responds(r.effects)).toEqual(["무선 이어폰이요 흰색으로요"]);
  });
  it("예비 엔진: 차례가 끝날 때마다 모으고 다시 열며, '다음'에서 넘긴다", () => {
    const l = atManualListening("fallback");
    let r = run(l.state, { type: "USER_TURN_END", text: "무선 이어폰이요", transcribed: true });
    expect(responds(r.effects)).toEqual([]);
    expect(ofType(r.effects, "OPEN_TURN")[0]).toMatchObject({ keep: true, sticky: true });
    r = run(r.state, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "다음", transcribed: true });
    expect(responds(r.effects)).toEqual(["무선 이어폰이요"]);
  });
  it("새 요청을 시작하면 모은 말을 비운다", () => {
    const l = atManualListening();
    const r = run(l.state, { type: "USER_PART", text: "무선 이어폰이요" }, { type: "EXIT" });
    const n = run(r.state, { type: "NEW_REQUEST", cid: "c2" });
    expect(n.state.parts).toEqual([]);
  });
});
