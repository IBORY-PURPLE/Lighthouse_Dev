// /live 상태 기계 시험: 5.5절 전이 표의 줄마다 한 사례, 5.11절 불변식 12개, 16.1절 이름 붙은 사례.
import { describe, expect, it } from "vitest";
import {
  canRegister,
  createInitialLive,
  liveStep,
  type LiveEffect,
  type LiveEvent,
  type LiveState,
  type TimerId,
} from "@/lib/liveMachine";
import { BUTTONS } from "@/lib/liveCommands";
import { script } from "@/lib/liveScripts";
import { cutText, decodeAiTurn, EMPTY_SLOTS, summaryOf, toDraft } from "@/lib/liveText";
import type { LiveSlots } from "@/lib/liveEngine";
import { RELISTEN_DELAYS_MS, SILENCE_STEPS_MS } from "@/lib/liveTiming";

// ---------------------------------------------------------------- 도우미

type Run = { state: LiveState; effects: LiveEffect[] };
type Opts = Partial<{ tts: boolean; speechAvailable: boolean; visit: "first" | "returning" }>;

const mk = (o: Opts = {}): LiveState =>
  createInitialLive({ cid: "c1", visit: "first", tts: true, speechAvailable: true, ...o });

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
const speakEnd = (s: LiveState): LiveEvent => ({ type: "SPEAK_END", id: s.speaking as string });
const timer = (id: TimerId): LiveEvent => ({ type: "TIMER", id });
const ev = <T extends LiveEvent>(e: T) => e;

const SLOTS: LiveSlots = { product: "전기밥솥", info: "할인 혜택", options: "흰색", budget: "" };
const CONFIRM = script("confirmAgain", { summary: summaryOf(SLOTS) });

const ofType = <T extends LiveEffect["type"]>(fx: LiveEffect[], type: T) =>
  fx.filter((f): f is Extract<LiveEffect, { type: T }> => f.type === type);
const types = (fx: LiveEffect[]) => fx.map((f) => f.type);
const spoken = (fx: LiveEffect[]) => ofType(fx, "SPEAK").map((f) => f.id);
const timerSet = (fx: LiveEffect[], id: TimerId) => ofType(fx, "TIMER_SET").find((f) => f.id === id);
const timerCleared = (fx: LiveEffect[], id: TimerId) => ofType(fx, "TIMER_CLEAR").some((f) => f.id === id);

/** 안내를 건너뛰는 대신 끝까지 듣고 엔진이 시작되는 connecting. */
function atConnecting(o: Opts = {}, realtime = false): Run {
  const r = run(mk(o), { type: "CONFIG", realtime }, { type: "START" });
  return run(r.state, speakEnd(r.state));
}
function atListening(o: Opts = {}): Run {
  const r = atConnecting(o);
  return run(r.state, { type: "READY", engine: "fallback", inputMode: o.speechAvailable === false ? "text" : "voice" });
}
/** 듣기가 실제로 시작돼 침묵 타이머가 걸린 listening. */
function atArmed(o: Opts = {}): Run {
  const r = atListening(o);
  return run(r.state, { type: "LISTEN_STARTED", late: false });
}
function atThinking(text = "전기밥솥", o: Opts = {}): Run {
  const r = atArmed(o);
  return run(r.state, { type: "USER_TURN_END", text, transcribed: true });
}
function atSpeakingAsking(): Run {
  const r = atThinking();
  return run(r.state, { type: "TURN_RESULT", reply: "어떤 정보가 궁금하세요?", status: "asking", slots: { ...SLOTS, info: "" } });
}
function atSpeakingConfirm(): Run {
  const r = atThinking();
  return run(r.state, { type: "TURN_RESULT", reply: "AI의 말", status: "confirming", slots: SLOTS });
}
function atConfirming(): Run {
  const r = atSpeakingConfirm();
  return run(r.state, speakEnd(r.state));
}
function atRegistering(): Run {
  const r = atConfirming();
  return run(r.state, { type: "CONSENT_BUTTON" });
}
function atPaused(): Run {
  const r = atListening();
  return run(r.state, { type: "PAUSE" });
}
function atDone(): Run {
  const r = atRegistering();
  return run(r.state, { type: "REGISTER_OK", requestId: "r1", queueNumber: 7, status: "queued" });
}
/** Realtime 엔진으로 listening까지 간 상태. */
function atRealtimeListening(): Run {
  let r = atConnecting({}, true);
  r = run(r.state, { type: "MIC_READY" }, { type: "READY", engine: "realtime", inputMode: "voice" });
  return r;
}

// ---------------------------------------------------------------- 시작과 연결

describe("순수성", () => {
  it("입력 상태를 고치지 않고 같은 입력에는 같은 결과를 준다", () => {
    const s = atConfirming().state;
    const frozen = JSON.stringify(s);
    const a = liveStep(s, { type: "TEXT_SUBMIT", text: "옵션은 검정" });
    const b = liveStep(s, { type: "TEXT_SUBMIT", text: "옵션은 검정" });
    expect(JSON.stringify(s)).toBe(frozen);
    expect(a).toEqual(b);
  });
});

describe("시작(idle → guiding)", () => {
  it("START는 안내를 읽고 ENGINE_START를 내지 않는다. 기록의 첫 칸이 안내 칸이다", () => {
    const r = run(mk(), { type: "START" });
    expect(r.state.phase).toBe("guiding");
    expect(types(r.effects)).not.toContain("ENGINE_START");
    expect(ofType(r.effects, "WAKE_LOCK")).toEqual([{ type: "WAKE_LOCK", on: true }]);
    const speak = ofType(r.effects, "SPEAK")[0];
    expect(speak.id).toBe("guideFirstVoice");
    expect(speak.text).toBe(`${script("guideFirstVoice")} ${script("micHint")}`);
    expect(r.state.history).toHaveLength(1);
    const cell = decodeAiTurn(r.state.history[0].content);
    expect(cell?.status).toBe("asking");
    expect(cell?.reply).toBe(speak.text);
  });
  it("재방문은 guideReturnVoice, micOnce면 micHint가 없다", () => {
    const base = mk({ visit: "returning" });
    const r = run({ ...base, micOnce: true }, { type: "START" });
    expect(ofType(r.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "guideReturnVoice", text: script("guideReturnVoice") });
  });
  it("음성 인식이 없고 Realtime도 없으면 글자 안내와 글자 모드", () => {
    const r = run(mk({ speechAvailable: false }), { type: "START" });
    expect(r.state.inputMode).toBe("text");
    expect(spoken(r.effects)).toEqual(["guideFirstText"]);
  });
  it("음성 인식이 없어도 Realtime 힌트가 있으면 음성 안내", () => {
    const r = run(mk({ speechAvailable: false }), { type: "CONFIG", realtime: true }, { type: "START" });
    expect(r.state.inputMode).toBe("voice");
  });
  it("Realtime 힌트가 있어도 fallbackOnly면 글자 안내", () => {
    const base = { ...mk({ speechAvailable: false }), realtimeHint: true, fallbackOnly: true };
    const r = run(base, { type: "START" });
    expect(r.state.inputMode).toBe("text");
  });
  it("idle에서는 EXIT가 아무 일도 하지 않는다", () => {
    const s = mk();
    const r = run(s, { type: "EXIT" });
    expect(r.state).toEqual(s);
    expect(r.effects).toEqual([]);
  });
});

describe("연결(guiding → connecting)", () => {
  it("안내 SPEAK_END → fallback 엔진 시작, VISIT_MARK, connect 타이머", () => {
    const g = run(mk(), { type: "CONFIG", realtime: false }, { type: "START" });
    const r = run(g.state, speakEnd(g.state));
    expect(r.state.phase).toBe("connecting");
    expect(r.state.resumeTo).toBe("listening");
    expect(r.effects).toContainEqual({ type: "VISIT_MARK" });
    expect(r.effects).toContainEqual({ type: "ENGINE_START", kind: "fallback" });
    expect(timerSet(r.effects, "connect")?.ms).toBe(12_000);
  });
  it("안내 중 MAIN_BUTTON과 HOLD_ACTIVATE는 안내를 끊고 연결한다. 첫 차례는 뜸을 들인다", () => {
    for (const e of [ev({ type: "MAIN_BUTTON" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const g = run(mk(), { type: "CONFIG", realtime: false }, { type: "START" });
      const r = run(g.state, e);
      expect(r.state.phase).toBe("connecting");
      expect(r.state.settleNext).toBe(true);
      expect(types(r.effects)).toEqual(expect.arrayContaining(["STOP_SPEAK", "VISIT_MARK", "ENGINE_START"]));
      const l = run(r.state, { type: "READY", engine: "fallback", inputMode: "voice" });
      expect(ofType(l.effects, "OPEN_TURN")[0]).toMatchObject({ earcon: "turn", settle: true });
      expect(l.state.settleNext).toBe(false);
    }
  });
  it("안내에서 오면 fallback READY가 바로 listening으로 보낸다. 차례 열기는 뜸이 없다", () => {
    const r = atListening();
    expect(r.state.phase).toBe("listening");
    expect(r.state.mic).toBe("on");
    expect(r.state.engine).toBe("fallback");
    expect(r.state.engineReady).toBe(true);
    expect(r.state.resumeTo).toBeNull();
    expect(ofType(r.effects, "OPEN_TURN")[0]).toEqual({ type: "OPEN_TURN", earcon: "turn", settle: false, keep: false });
    expect(timerCleared(r.effects, "connect")).toBe(true);
  });
  it("fallback 시작에서는 ANNOUNCE status가 나오지 않고, 연결이 1.5초를 넘길 때만 알린다", () => {
    const c = atConnecting();
    expect(types(c.effects)).not.toContain("ANNOUNCE");
    expect(timerSet(c.effects, "connectSay")?.ms).toBe(1_500);
    const r = run(c.state, timer("connectSay"));
    expect(r.effects).toEqual([{ type: "ANNOUNCE", channel: "status", text: "연결하고 있어요" }]);
    const ready = atListening();
    expect(types(ready.effects)).not.toContain("ANNOUNCE");
  });
  it("connectSay는 읽는 중이면 알리지 않는다", () => {
    const c = atConnecting();
    const r = run({ ...c.state, speaking: "resumed" }, timer("connectSay"));
    expect(r.effects).toEqual([]);
  });
  it("connecting의 MAIN_BUTTON과 HOLD_ACTIVATE는 아무 일도 하지 않는다", () => {
    const c = atConnecting();
    for (const e of [ev({ type: "MAIN_BUTTON" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const r = run(c.state, e);
      expect(r.effects).toEqual([]);
      expect(r.state).toEqual(c.state);
    }
  });
  it("fallback 연결 시간 초과와 FAILED는 connect_failed 또는 받은 종류로 error", () => {
    const c = atConnecting();
    const a = run(c.state, timer("connect"));
    expect(a.state.phase).toBe("error");
    expect(a.state.error).toBe("connect_failed");
    const b = run(c.state, { type: "FAILED", kind: "not_configured" });
    expect(b.state.error).toBe("not_configured");
    const m = run(c.state, { type: "FAILED", kind: "mic_denied" });
    expect(m.state.phase).toBe("connecting");
  });
  it("READY의 inputMode가 text면 글자 모드로 바꾸고 안내를 읽은 뒤 SPEAK_END에서 listening", () => {
    const c = atConnecting();
    const r = run(c.state, { type: "READY", engine: "fallback", inputMode: "text", textReason: "speech_unavailable" });
    expect(r.state.inputMode).toBe("text");
    expect(r.state.phase).toBe("connecting");
    expect(spoken(r.effects)).toEqual(["speechUnavailable"]);
    const l = run(r.state, speakEnd(r.state));
    expect(l.state.phase).toBe("listening");
    expect(l.effects).toContainEqual({ type: "FOCUS", target: "textInput" });
    const d = run(c.state, { type: "READY", engine: "fallback", inputMode: "text", textReason: "mic_denied" });
    expect(spoken(d.effects)).toEqual(["micDenied"]);
  });
  it("engineReady가 거짓이면 SPEAK_END는 READY를 기다린다", () => {
    const c = atConnecting();
    const r = run({ ...c.state, speaking: "x" }, { type: "SPEAK_END", id: "x" });
    expect(r.state.phase).toBe("connecting");
    expect(r.effects).toEqual([]);
  });
  it("낡은 SPEAK_END는 버린다", () => {
    const g = run(mk(), { type: "START" });
    const r = run(g.state, { type: "SPEAK_END", id: "다른 것" });
    expect(r.state).toEqual(g.state);
    expect(r.effects).toEqual([]);
  });
});

describe("Realtime 연결", () => {
  it("START 뒤 안내가 끝나야 엔진이 시작되고 마이크 대기 타이머만 걸린다", () => {
    const g = run(mk(), { type: "CONFIG", realtime: true }, { type: "START" });
    expect(types(g.effects)).not.toContain("ENGINE_START");
    const r = run(g.state, speakEnd(g.state));
    expect(r.effects).toContainEqual({ type: "ENGINE_START", kind: "realtime" });
    expect(timerSet(r.effects, "micWait")?.ms).toBe(60_000);
    expect(timerSet(r.effects, "connect")).toBeUndefined();
  });
  it("MIC_READY 뒤에야 connect 타이머가 걸린다. 허용 창이 오래 걸려도 connect_failed가 없다", () => {
    const c = atConnecting({}, true);
    const r = run(c.state, { type: "MIC_READY" });
    expect(timerSet(r.effects, "connect")?.ms).toBe(12_000);
    expect(timerSet(r.effects, "connectSay")?.ms).toBe(1_500);
    expect(timerCleared(r.effects, "micWait")).toBe(true);
    expect(r.effects).toContainEqual({ type: "WAIT_PULSE", on: true });
    expect(r.state.settleNext).toBe(true);
    // 허용 창 동안에는 connect 타이머가 없으므로 connect_failed가 나올 수 없다. connect가 오면 fallback으로 간다.
    const t = run(r.state, timer("connect"));
    expect(t.state.phase).toBe("connecting");
    expect(t.state.fallbackOnly).toBe(true);
  });
  it("MIC_DENIED와 micWait 만료는 fallback으로 간다", () => {
    for (const e of [ev({ type: "MIC_DENIED" }), ev(timer("micWait"))]) {
      const c = atConnecting({}, true);
      const r = run(c.state, e);
      expect(r.state.fallbackOnly).toBe(true);
      expect(types(r.effects)).toEqual(expect.arrayContaining(["ENGINE_CLOSE", "RELEASE_MIC"]));
      expect(r.effects).toContainEqual({ type: "ENGINE_START", kind: "fallback" });
      expect(timerSet(r.effects, "connect")).toBeDefined();
      expect(r.state.phase).toBe("connecting");
    }
  });
  it("Realtime LOST와 FAILED는 fallback으로, 늦은 MIC_READY는 무시", () => {
    const c = atConnecting({}, true);
    const l = run(c.state, { type: "LOST", reason: "connect" });
    expect(l.state.fallbackOnly).toBe(true);
    expect(timerCleared(l.effects, "connect")).toBe(true);
    expect(timerCleared(l.effects, "connectSay")).toBe(true);
    const late = run(l.state, { type: "MIC_READY" });
    expect(late.effects).toEqual([]);
    const f = run(c.state, { type: "FAILED", kind: "failed" });
    expect(f.state.phase).toBe("connecting");
    expect(f.state.fallbackOnly).toBe(true);
  });
  it("READY(realtime) → listening, 뜸 있는 차례", () => {
    const r = atRealtimeListening();
    expect(r.state.phase).toBe("listening");
    expect(r.state.engine).toBe("realtime");
    expect(ofType(r.effects, "OPEN_TURN")[0].settle).toBe(true);
    expect(r.effects).toContainEqual({ type: "WAIT_PULSE", on: false });
  });
});

// ---------------------------------------------------------------- 듣기

describe("듣기: LISTEN_STARTED와 침묵", () => {
  it("LISTEN_STARTED 전에는 silence 타이머가 없다", () => {
    const r = atListening();
    expect(timerSet(r.effects, "silence")).toBeUndefined();
    expect(r.state.silenceArmed).toBe(false);
  });
  it("LISTEN_STARTED(late 거짓)가 침묵 타이머를 한 번만 건다", () => {
    const r = atArmed();
    expect(r.state.micOnce).toBe(true);
    expect(r.state.silenceArmed).toBe(true);
    expect(timerSet(r.effects, "silence")?.ms).toBe(10_000);
    const again = run(r.state, { type: "LISTEN_STARTED", late: false });
    expect(timerSet(again.effects, "silence")).toBeUndefined();
  });
  it("late면 차례를 다시 열고(2회까지) 그 뒤로는 그대로 듣는다", () => {
    let s = atListening().state;
    for (let i = 1; i <= 2; i++) {
      const r = run(s, { type: "LISTEN_STARTED", late: true });
      expect(r.state.lateReopens).toBe(i);
      expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: true });
      expect(ofType(r.effects, "OPEN_TURN")[0]).toMatchObject({ earcon: "turn", settle: true });
      expect(timerSet(r.effects, "silence")).toBeUndefined();
      s = r.state;
    }
    const third = run(s, { type: "LISTEN_STARTED", late: true });
    expect(types(third.effects)).not.toContain("OPEN_TURN");
    expect(timerSet(third.effects, "silence")?.ms).toBe(10_000);
    expect(third.state.lateReopens).toBe(2);
  });
  it("confirming의 late도 확인 열기로 다시 연다", () => {
    const c = atConfirming();
    const r = run(c.state, { type: "LISTEN_STARTED", late: true });
    expect(ofType(r.effects, "OPEN_TURN")[0]).toMatchObject({ earcon: "confirm", settle: true });
  });
  it("USER_SPEECH_START는 침묵 타이머를 지운다", () => {
    const a = atArmed();
    const r = run(a.state, { type: "USER_SPEECH_START" });
    expect(timerCleared(r.effects, "silence")).toBe(true);
    expect(r.state.silenceArmed).toBe(false);
  });
  it("침묵 단계가 10·15·15·20초로 흘러 paused가 된다", () => {
    let r = atArmed();
    expect(timerSet(r.effects, "silence")?.ms).toBe(SILENCE_STEPS_MS[0]);
    const expected: [ScriptName, number][] = [["silence1", 15_000], ["silence2", 15_000], ["extendAsk", 20_000]];
    for (const [id, nextMs] of expected) {
      r = run(r.state, timer("silence"));
      expect(spoken(r.effects)).toEqual([id]);
      expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: false });
      expect(r.state.mic).toBe("off");
      expect(r.state.phase).toBe("listening");
      r = run(r.state, speakEnd(r.state));
      expect(ofType(r.effects, "OPEN_TURN")).toHaveLength(1);
      r = run(r.state, { type: "LISTEN_STARTED", late: false });
      expect(timerSet(r.effects, "silence")?.ms).toBe(nextMs);
    }
    expect(r.state.ask).toBe("extend");
    r = run(r.state, timer("silence"));
    expect(r.state.phase).toBe("paused");
    expect(spoken(r.effects)).toEqual(["pausedBySilence"]);
  });
  it("confirming의 침묵 힌트는 요약 전체가 아니라 짧은 안내다(A13: 화면 낭독기와 겹치지 않게)", () => {
    const c = atConfirming();
    const a = run(c.state, { type: "LISTEN_STARTED", late: false });
    const r = run(a.state, timer("silence"));
    expect(ofType(r.effects, "SPEAK")[0].text).toBe(script("confirmHint"));
    expect(ofType(r.effects, "SPEAK")[0].text).not.toContain("전기밥솥");
    expect(r.state.silenceStep).toBe(1);
    const reopen = run(r.state, speakEnd(r.state));
    expect(ofType(reopen.effects, "OPEN_TURN")[0].earcon).toBe("confirm");
  });
  it("NO_SPEECH가 되풀이돼도 침묵 타이머를 다시 걸지 않고 RELISTEN에 신호음이 없다. 간격은 300·600·1200·2000ms", () => {
    let s = atArmed().state;
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const n = run(s, { type: "NO_SPEECH" });
      delays.push(timerSet(n.effects, "relisten")!.ms);
      expect(timerSet(n.effects, "silence")).toBeUndefined();
      const t = run(n.state, timer("relisten"));
      expect(t.effects).toEqual([{ type: "RELISTEN" }]);
      s = t.state;
    }
    expect(delays).toEqual([...RELISTEN_DELAYS_MS, 2_000, 2_000]);
    // 새 차례를 열면 횟수가 0으로 돌아간다
    const reopen = run(s, { type: "HOLD_CANCEL" });
    expect(reopen.state.relistens).toBe(0);
  });
  it("mic가 held인 동안에는 60초가 지나도 silence1이 읽히지 않는다. controlHold 뒤 침묵 타이머가 처음부터 다시 걸린다", () => {
    const a = atArmed();
    const t = run(a.state, { type: "CONTROL_TOUCH" });
    expect(t.state.mic).toBe("held");
    expect(t.effects).toContainEqual({ type: "ENGINE_HOLD" });
    expect(timerCleared(t.effects, "silence")).toBe(true);
    expect(timerSet(t.effects, "controlHold")?.ms).toBe(4_000);
    const again = run(t.state, { type: "CONTROL_TOUCH" });
    expect(timerSet(again.effects, "controlHold")?.ms).toBe(4_000);
    const late = run(t.state, timer("silence"), timer("relisten"));
    expect(late.effects).toEqual([]);
    const hold = run(t.state, timer("controlHold"));
    expect(ofType(hold.effects, "OPEN_TURN")[0]).toMatchObject({ earcon: "turn", keep: true });
    expect(hold.state.mic).toBe("on");
    const started = run(hold.state, { type: "LISTEN_STARTED", late: false });
    expect(timerSet(started.effects, "silence")?.ms).toBe(10_000);
  });
  it("mic가 off일 때 CONTROL_TOUCH는 아무 일도 하지 않는다", () => {
    const l = atListening();
    const off = run({ ...l.state, mic: "off" }, { type: "CONTROL_TOUCH" });
    expect(off.effects).toEqual([]);
  });
});

describe("듣기: 단추와 길게 누르기", () => {
  it("MAIN_BUTTON(mic on)과 HOLD_SUBMIT은 ENGINE_SUBMIT", () => {
    const a = atArmed();
    expect(run(a.state, { type: "MAIN_BUTTON" }).effects).toEqual([{ type: "ENGINE_SUBMIT" }]);
    expect(run(a.state, { type: "HOLD_SUBMIT" }).effects).toEqual([{ type: "ENGINE_SUBMIT" }]);
    const held = run(a.state, { type: "CONTROL_TOUCH" });
    expect(run(held.state, { type: "MAIN_BUTTON" }).effects).toEqual([{ type: "ENGINE_SUBMIT" }]);
  });
  it("MAIN_BUTTON과 HOLD_ACTIVATE(mic off)는 말을 끊고 뜸을 들여 차례를 연다", () => {
    const a = atArmed();
    const closed = run(a.state, timer("silence")).state;   // 힌트를 읽는 중, 마이크 닫힘
    for (const e of [ev({ type: "MAIN_BUTTON" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const r = run(closed, e);
      expect(r.effects[0]).toEqual({ type: "STOP_SPEAK" });
      expect(ofType(r.effects, "OPEN_TURN")[0]).toMatchObject({ earcon: "turn", settle: true });
      expect(r.state.mic).toBe("on");
      // 끊은 읽기의 SPEAK_END는 낡은 것으로 버려진다
      expect(run(r.state, { type: "SPEAK_END", id: "silence1" }).effects).toEqual([]);
    }
  });
  it("HOLD_ACTIVATE(mic on)는 아무 일도 하지 않는다", () => {
    expect(run(atArmed().state, { type: "HOLD_ACTIVATE" }).effects).toEqual([]);
  });
  it("HOLD_CANCEL은 듣기를 버리고 취소음을 낸 뒤 차례를 다시 연다", () => {
    const r = run(atArmed().state, { type: "HOLD_CANCEL" });
    expect(r.effects).toEqual([
      { type: "ENGINE_CANCEL_LISTEN", discard: true },
      { type: "EARCON", name: "cancel" },
      { type: "TIMER_CLEAR", id: "silence" },
      { type: "TIMER_CLEAR", id: "relisten" },
      { type: "TIMER_CLEAR", id: "controlHold" },
      { type: "TIMER_CLEAR", id: "micSay" },
      { type: "OPEN_TURN", earcon: "turn", settle: false, keep: false },
    ]);
  });
  it("FAILED mic_blocked는 읽고 다시 열지 않는다. 말하기 단추가 다시 연다", () => {
    const a = atArmed();
    const f = run(a.state, { type: "FAILED", kind: "mic_blocked" });
    expect(f.state.mic).toBe("off");
    expect(spoken(f.effects)).toEqual(["micRetry"]);
    const end = run(f.state, speakEnd(f.state));
    expect(types(end.effects)).not.toContain("OPEN_TURN");
    const again = run(f.state, { type: "MAIN_BUTTON" });
    expect(ofType(again.effects, "OPEN_TURN")).toHaveLength(1);
  });
  it("FAILED mic_denied, speech_unavailable는 글자 모드로 바꾸고 입력 칸에 초점", () => {
    for (const [kind, id] of [["mic_denied", "micDenied"], ["speech_unavailable", "speechUnavailable"]] as const) {
      const f = run(atArmed().state, { type: "FAILED", kind });
      expect(f.state.inputMode).toBe("text");
      expect(f.state.phase).toBe("listening");
      expect(spoken(f.effects)).toEqual([id]);
      const end = run(f.state, speakEnd(f.state));
      expect(end.effects).toContainEqual({ type: "FOCUS", target: "textInput" });
      expect(types(end.effects)).not.toContain("OPEN_TURN");
    }
  });
  it("글자 모드: 차례 열기는 신호음과 FOCUS textInput만 내고 마이크와 침묵 타이머가 없다", () => {
    const r = atListening({ speechAvailable: false });
    expect(r.state.inputMode).toBe("text");
    expect(r.state.mic).toBe("off");
    expect(types(r.effects)).not.toContain("OPEN_TURN");
    expect(r.effects).toEqual(expect.arrayContaining([{ type: "EARCON", name: "turn" }, { type: "FOCUS", target: "textInput" }]));
    expect(types(r.effects)).not.toContain("TIMER_SET");
  });
  it("글자 모드의 큰 단추: 읽던 말이 있을 때만 끊고 차례를 연다", () => {
    const l = atListening({ speechAvailable: false });
    expect(run(l.state, { type: "MAIN_BUTTON" }).effects).toEqual([]);
    const reading = run(l.state, { type: "HELP" });
    expect(reading.state.speaking).toBe("helpText");
    const r = run(reading.state, { type: "MAIN_BUTTON" });
    expect(r.effects[0]).toEqual({ type: "STOP_SPEAK" });
    expect(r.effects).toContainEqual({ type: "FOCUS", target: "textInput" });
  });
});

// ---------------------------------------------------------------- 이용자 말 판정(5.8절)

describe("이용자 말이 끝났을 때", () => {
  it("USER_TURN_END(글 있음)은 thinking, ENGINE_RESPOND의 history에 이번 글이 없다", () => {
    const r = run(atArmed().state, { type: "USER_TURN_END", text: "전기밥솥 찾아 줘", transcribed: true });
    expect(r.state.phase).toBe("thinking");
    expect(r.state.mic).toBe("off");
    const respond = ofType(r.effects, "ENGINE_RESPOND")[0];
    expect(respond.text).toBe("전기밥솥 찾아 줘");
    expect(respond.source).toBe("voice");
    expect(respond.history).toHaveLength(1);   // 안내 칸뿐
    expect(respond.history.some((t) => t.role === "user")).toBe(false);
    expect(r.state.history).toHaveLength(2);
    expect(r.state.history[1]).toEqual({ role: "user", content: "전기밥솥 찾아 줘" });
    expect(r.state.pendingTurn).toEqual({ text: "전기밥솥 찾아 줘", source: "voice" });
    expect(r.effects).toEqual(
      expect.arrayContaining([
        { type: "EARCON", name: "sent" },
        { type: "WAIT_PULSE", on: true },
        { type: "TIMER_SET", id: "waitSay1", ms: 4_000 },
        { type: "TIMER_SET", id: "waitSay2", ms: 12_000 },
        { type: "TIMER_SET", id: "think", ms: 30_000 },
      ]),
    );
    // 엔진이 스스로 차례를 끝냈으므로 듣기 닫기를 내지 않는다
    expect(types(r.effects)).not.toContain("ENGINE_CANCEL_LISTEN");
  });
  it("TEXT_SUBMIT은 듣기를 닫고 보낸다. 빈 글은 무시한다", () => {
    const l = atListening({ speechAvailable: false });
    const r = run(l.state, { type: "TEXT_SUBMIT", text: "  전기밥솥  " });
    expect(r.state.phase).toBe("thinking");
    expect(ofType(r.effects, "ENGINE_RESPOND")[0]).toMatchObject({ text: "전기밥솥", source: "text" });
    expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: false });
    const empty = run(l.state, { type: "TEXT_SUBMIT", text: "   " });
    expect(empty.effects).toEqual([]);
  });
  it("메아리('말하기 버튼')는 서버를 부르지 않고 NO_SPEECH처럼 처리한다", () => {
    const r = run(atArmed().state, { type: "USER_TURN_END", text: "말하기 버튼", transcribed: true });
    expect(r.state.phase).toBe("listening");
    expect(types(r.effects)).not.toContain("ENGINE_RESPOND");
    expect(timerSet(r.effects, "relisten")?.ms).toBe(300);
  });
  it("글 없음(transcribed)도 NO_SPEECH처럼 처리한다", () => {
    const r = run(atArmed().state, { type: "USER_TURN_END", text: "  ", transcribed: true });
    expect(timerSet(r.effects, "relisten")?.ms).toBe(300);
    expect(r.state.phase).toBe("listening");
  });
  it("글자 입력의 메아리 판정은 하지 않는다", () => {
    const r = run(atListening({ speechAvailable: false }).state, { type: "TEXT_SUBMIT", text: "말하기 버튼" });
    expect(r.state.phase).toBe("thinking");
  });
  it("transcribed 거짓: 판정을 건너뛰고 빈 글로 ENGINE_RESPOND, 이용자 칸은 전사가 올 때 넣는다", () => {
    const a = atArmed();
    const r = run(a.state, { type: "USER_TURN_END", text: "", transcribed: false });
    expect(r.state.phase).toBe("thinking");
    expect(r.state.pendingTurn).toEqual({ text: "", source: "voice" });
    expect(r.state.consentText).toBeNull();
    expect(ofType(r.effects, "ENGINE_RESPOND")[0]).toMatchObject({ text: "" });
    expect(r.state.history).toHaveLength(1);
    const tr = run(r.state, { type: "USER_TRANSCRIPT", text: "전기밥솥", final: true });
    expect(tr.state.history[1]).toEqual({ role: "user", content: "전기밥솥" });
    expect(tr.state.pendingTurn?.text).toBe("전기밥솥");
    const dup = run(tr.state, { type: "USER_TRANSCRIPT", text: "전기밥솥", final: true });
    expect(dup.state.history).toHaveLength(2);
  });
  it("ask extend: 분명한 동의는 말 없이 차례를 다시 연다. 아니면 계속 판정한다", () => {
    let s = atArmed().state;
    for (let i = 0; i < 3; i++) {
      s = run(s, timer("silence")).state;
      s = run(s, speakEnd(s), { type: "LISTEN_STARTED", late: false }).state;
    }
    expect(s.ask).toBe("extend");
    const yes = run(s, { type: "USER_TURN_END", text: "네", transcribed: true });
    expect(yes.state.ask).toBeNull();
    expect(yes.state.silenceStep).toBe(0);
    expect(yes.state.phase).toBe("listening");
    expect(types(yes.effects)).toContain("OPEN_TURN");
    expect(types(yes.effects)).not.toContain("SPEAK");
    const other = run(s, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    expect(other.state.phase).toBe("thinking");
    expect(other.state.silenceStep).toBe(0);
  });
  it("끝내고 싶다는 말은 되묻지 않고 끝내는 말('끝내기')을 알려 준다. '끝내기'는 바로 끝내고, 다른 말은 계속 판정한다", () => {
    const base = run(atArmed().state, { type: "USER_TURN_END", text: "그만해", transcribed: true });
    expect(base.state.ask).toBeNull();
    expect(base.state.phase).toBe("listening");
    expect(spoken(base.effects)).toEqual(["endGuide"]);
    const exit = run(base.state, speakEnd(base.state), { type: "USER_TURN_END", text: "끝내기", transcribed: true });
    expect(exit.state.phase).toBe("ended");
    const no = run(base.state, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    expect(no.state.ask).toBeNull();
    expect(no.state.phase).toBe("thinking");
  });
  it("말 명령은 서버를 부르지 않는다", () => {
    const say = (text: string) => run(atArmed().state, { type: "USER_TURN_END", text, transcribed: true });
    const help = say("도움말");
    expect(spoken(help.effects)).toEqual(["helpVoice"]);
    expect(help.state.helpDepth).toBe(1);
    const repeat = run(
      atSpeakingAsking().state,
      { type: "MAIN_BUTTON" },
    );
    const again = run(repeat.state, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "다시 말해 줘", transcribed: true });
    expect(ofType(again.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "repeat", text: "어떤 정보가 궁금하세요?" });
    const pause = say("잠깐만요");
    expect(pause.state.phase).toBe("paused");
    expect(spoken(pause.effects)).toEqual(["pausedByUser"]);
    const slow = say("천천히 말해 주세요");
    expect(slow.state.rate).toBe("slow");
    expect(slow.effects).toContainEqual({ type: "ENGINE_SET_RATE", rate: "slow" });
    expect(spoken(slow.effects)).toEqual(["rateSlow"]);
    expect(spoken(say("빠르게 말해 줘").effects)).toEqual(["rateFast"]);
    const normal = run(slow.state, speakEnd(slow.state), { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "보통 속도로", transcribed: true });
    expect(spoken(normal.effects)).toEqual(["rateNormal"]);
    for (const text of ["도움말", "잠깐만요", "천천히 말해 주세요", "그만해"]) {
      expect(types(say(text).effects)).not.toContain("ENGINE_RESPOND");
    }
    // 명령이 아닌 말
    for (const text of ["다시마 과자 찾아 줘", "끝이 둥근 가위"]) {
      expect(say(text).state.phase).toBe("thinking");
    }
  });
  it("lastReply가 없을 때 '다시'는 차례를 다시 연다", () => {
    const r = run({ ...atArmed().state, lastReply: "" }, { type: "USER_TURN_END", text: "다시", transcribed: true });
    expect(r.state.phase).toBe("listening");
    expect(types(r.effects)).toContain("OPEN_TURN");
  });
  it("첫 AI 답 전에도 '다시'는 처음 안내를 다시 읽는다(A20)", () => {
    const r = run(atArmed().state, { type: "USER_TURN_END", text: "다시", transcribed: true });
    expect(r.state.phase).toBe("listening");
    expect(ofType(r.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "repeat", text: script("guideFirstVoice") });
    expect(types(r.effects)).not.toContain("OPEN_TURN");
  });
  it("긴 글은 기록과 요청 모두 USER_TURN_MAX로 자른다", () => {
    const long = "가".repeat(1500);
    const r = run(atArmed().state, { type: "USER_TURN_END", text: long, transcribed: true });
    expect(r.state.history[1].content).toBe(cutText(long, 1000));
    expect(ofType(r.effects, "ENGINE_RESPOND")[0].text.length).toBeLessThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------- 답 기다리기

describe("thinking", () => {
  it("대기 낭독 타이머", () => {
    const t = atThinking();
    expect(spoken(run(t.state, timer("waitSay1")).effects)).toEqual(["waiting1"]);
    expect(spoken(run(t.state, timer("waitSay2")).effects)).toEqual(["waiting2"]);
  });
  it("TURN_RESULT asking → speaking, 답 받기, AI 칸과 lastReply", () => {
    const r = atSpeakingAsking();
    expect(r.state.phase).toBe("speaking");
    expect(spoken(r.effects)).toEqual(["ai"]);
    expect(ofType(r.effects, "SPEAK")[0].text).toBe("어떤 정보가 궁금하세요?");
    expect(r.state.lastReply).toBe("어떤 정보가 궁금하세요?");
    expect(r.state.pendingTurn).toBeNull();
    expect(r.state.aiFailures).toBe(0);
    expect(r.effects).toEqual(
      expect.arrayContaining([
        { type: "WAIT_PULSE", on: false },
        { type: "STOP_SPEAK" },
        { type: "TIMER_CLEAR", id: "waitSay1" },
        { type: "TIMER_CLEAR", id: "waitSay2" },
        { type: "TIMER_CLEAR", id: "think" },
        { type: "TIMER_CLEAR", id: "retryAfter" },
      ]),
    );
    const last = decodeAiTurn(r.state.history[r.state.history.length - 1].content);
    expect(last).toMatchObject({ status: "asking", reply: "어떤 정보가 궁금하세요?" });
  });
  it("SPEAK_END(ai) → listening, awaitingConsent 거짓, 차례 열기", () => {
    const s = atSpeakingAsking();
    const r = run(s.state, speakEnd(s.state));
    expect(r.state.phase).toBe("listening");
    expect(r.state.awaitingConsent).toBe(false);
    expect(r.state.silenceStep).toBe(0);
    expect(ofType(r.effects, "OPEN_TURN")).toHaveLength(1);
  });
  it("TURN_RESULT confirming: 읽는 글은 confirmAgain(summaryOf(slots))이고 AI의 reply가 아니다. 기록의 AI 칸은 confirming", () => {
    const r = atSpeakingConfirm();
    expect(r.state.phase).toBe("speaking");
    expect(spoken(r.effects)).toEqual(["confirm"]);
    expect(ofType(r.effects, "SPEAK")[0].text).toBe(CONFIRM);
    expect(ofType(r.effects, "SPEAK")[0].text).not.toContain("AI의 말");
    expect(r.state.pendingConfirm).toBe(true);
    expect(r.state.draft).toEqual(toDraft(SLOTS));
    expect(r.state.lastReply).toBe(CONFIRM);
    const cell = decodeAiTurn(r.state.history[r.state.history.length - 1].content);
    expect(cell?.status).toBe("confirming");
    expect(cell?.reply).toBe(CONFIRM);
  });
  it("SPEAK_END(confirm) → confirming, 동의 대기, 확인 열기", () => {
    const s = atSpeakingConfirm();
    const r = run(s.state, speakEnd(s.state));
    expect(r.state.phase).toBe("confirming");
    expect(r.state.pendingConfirm).toBe(false);
    expect(r.state.awaitingConsent).toBe(true);
    expect(r.state.consentText).toBeNull();
    expect(ofType(r.effects, "OPEN_TURN")[0]).toMatchObject({ earcon: "confirm" });
  });
  it("제품이 빈 confirming은 asking으로 처리한다", () => {
    const t = atThinking();
    const r = run(t.state, { type: "TURN_RESULT", reply: "무엇을 찾으세요?", status: "confirming", slots: { product: "", info: "", options: "", budget: "" } });
    expect(spoken(r.effects)).toEqual(["ai"]);
    expect(r.state.pendingConfirm).toBe(false);
  });
  it("TURN_RESULT ended → 끝내는 말을 알려 준다", () => {
    const r = run(atThinking().state, { type: "TURN_RESULT", reply: "", status: "ended", slots: SLOTS });
    expect(r.state.phase).toBe("listening");
    expect(r.state.ask).toBeNull();
    expect(spoken(r.effects)).toEqual(["endGuide"]);
    expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_RESPONSE" });
  });
  it("TURN_RESULT done: 동의가 없으면 접수하지 않는다(draft 없음 → failed, draft 있음 → confirmRetell)", () => {
    const none = run(atThinking().state, { type: "TURN_RESULT", reply: "", status: "done", slots: SLOTS });
    expect(none.state.phase).toBe("listening");
    expect(spoken(none.effects)).toEqual(["failed"]);
    expect(types(none.effects)).not.toContain("REGISTER");
    // 확인 상태에서 고치는 말을 하고 done이 오면 consentText가 그럴듯하지 않다
    const c = atConfirming();
    const edit = run(c.state, { type: "USER_TURN_END", text: "예산은 5만 원", transcribed: true });
    expect(edit.state.consentText).toBe("예산은 5만 원");
    const done = run(edit.state, { type: "TURN_RESULT", reply: "", status: "done", slots: SLOTS });
    expect(types(done.effects)).not.toContain("REGISTER");
    expect(done.state.phase).toBe("speaking");
    expect(done.state.pendingConfirm).toBe(true);
    expect(spoken(done.effects)).toEqual(["confirm"]);
    expect(ofType(done.effects, "SPEAK")[0].text).toBe(script("confirmRetell", { summary: summaryOf(SLOTS) }));
  });
  it("TURN_RESULT done + 그럴듯한 동의 → AI를 거쳐 REGISTER(AI를 거치는 접수)", () => {
    const c = atConfirming();
    const say = run(c.state, { type: "USER_TURN_END", text: "네 그렇게 보내 주시면 돼요", transcribed: true });
    expect(say.state.phase).toBe("thinking");
    expect(say.state.consentText).toBe("네 그렇게 보내 주시면 돼요");
    expect(say.state.awaitingConsent).toBe(true);
    const done = run(say.state, { type: "TURN_RESULT", reply: "", status: "done", slots: SLOTS });
    expect(done.state.phase).toBe("registering");
    expect(types(done.effects)).toContain("REGISTER");
  });
  it("rate_limited: 2회까지 저절로 다시 보내고, 기다리는 동안 think·대기 낭독 타이머가 없다. 3번째는 실패", () => {
    let s = atThinking().state;
    for (let i = 1; i <= 2; i++) {
      const r = run(s, { type: "FAILED", kind: "rate_limited", retryAfterMs: 4_000 });
      expect(r.state.rateRetries).toBe(i);
      expect(r.state.phase).toBe("thinking");
      expect(spoken(r.effects)).toEqual(["rateLimited"]);
      expect(ofType(r.effects, "SPEAK")[0].text).toBe(script("rateLimited", { s: 4 }));
      expect(timerSet(r.effects, "retryAfter")?.ms).toBe(4_000);
      expect(r.effects).toEqual(
        expect.arrayContaining([
          { type: "WAIT_PULSE", on: false },
          { type: "TIMER_CLEAR", id: "waitSay1" },
          { type: "TIMER_CLEAR", id: "waitSay2" },
          { type: "TIMER_CLEAR", id: "think" },
        ]),
      );
      expect(timerSet(r.effects, "think")).toBeUndefined();
      const retry = run(r.state, timer("retryAfter"));
      expect(retry.effects).toContainEqual({ type: "WAIT_PULSE", on: true });
      expect(timerSet(retry.effects, "think")?.ms).toBe(30_000);
      const respond = ofType(retry.effects, "ENGINE_RESPOND")[0];
      expect(respond.text).toBe("전기밥솥");
      expect(respond.history.some((t) => t.role === "user")).toBe(false);
      s = retry.state;
    }
    const third = run(s, { type: "FAILED", kind: "rate_limited", retryAfterMs: 4_000 });
    expect(third.state.phase).toBe("listening");
    expect(third.state.aiFailures).toBe(1);
    expect(spoken(third.effects)).toEqual(["failed"]);
  });
  it("rate_limited의 대기는 30초를 넘지 않는다. Retry-After가 없으면 기본값", () => {
    const t = atThinking();
    const big = run(t.state, { type: "FAILED", kind: "rate_limited", retryAfterMs: 90_000 });
    expect(timerSet(big.effects, "retryAfter")?.ms).toBe(30_000);
    expect(ofType(big.effects, "SPEAK")[0].text).toBe(script("rateLimited", { s: 30 }));
    const none = run(t.state, { type: "FAILED", kind: "rate_limited" });
    expect(timerSet(none.effects, "retryAfter")?.ms).toBe(3_000);
  });
  it("timeout, failed, bad_request: 1~2회는 말로 알리고 listening, 기록의 마지막 이용자 칸을 뺀다. 3회째는 error", () => {
    const cases = [["timeout", "timeout"], ["failed", "failed"], ["bad_request", "tooLong"]] as const;
    for (const [kind, id] of cases) {
      const t = atThinking();
      const r = run(t.state, { type: "FAILED", kind });
      expect(r.state.phase).toBe("listening");
      expect(r.state.aiFailures).toBe(1);
      expect(spoken(r.effects)).toEqual([id]);
      expect(r.effects).toEqual(expect.arrayContaining([{ type: "EARCON", name: "error" }, { type: "ENGINE_CANCEL_RESPONSE" }]));
      expect(r.state.history.some((h) => h.role === "user")).toBe(false);
      expect(r.state.pendingTurn).toBeNull();
    }
    let s = atThinking().state;
    for (let i = 0; i < 2; i++) {
      s = run(s, { type: "FAILED", kind: "failed" }, speakEnd(run(s, { type: "FAILED", kind: "failed" }).state)).state;
      s = run(s, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true }).state;
    }
    const third = run(s, { type: "FAILED", kind: "failed" });
    expect(third.state.phase).toBe("error");
    expect(third.state.error).toBe("failed");
    const broken = run(s, { type: "FAILED", kind: "bad_request" });
    expect(broken.state.error).toBe("bad_request");
    expect(spoken(broken.effects)).toEqual(["conversationBroken"]);
  });
  it("TIMER think는 timeout으로 센다", () => {
    const r = run(atThinking().state, timer("think"));
    expect(r.state.phase).toBe("listening");
    expect(spoken(r.effects)).toEqual(["timeout"]);
  });
  it("offline, not_configured, unavailable_today는 바로 error", () => {
    const ids = { offline: "offline", not_configured: "notConfigured", unavailable_today: "dailyCap" } as const;
    for (const kind of ["offline", "not_configured", "unavailable_today"] as const) {
      const r = run(atThinking().state, { type: "FAILED", kind });
      expect(r.state.phase).toBe("error");
      expect(r.state.error).toBe(kind);
      expect(spoken(r.effects)).toEqual([ids[kind]]);
    }
  });
  it("보낸 직후(THINK_GRACE_MS 안)의 MAIN_BUTTON과 HOLD_ACTIVATE는 말을 지우지 않는다. 보냈다는 신호음만 다시 낸다(A24·A31)", () => {
    const t = atThinking();
    expect(t.state.thinkFresh).toBe(true);
    expect(timerSet(t.effects, "thinkGrace")?.ms).toBe(1_500);
    for (const e of [ev({ type: "MAIN_BUTTON" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const r = run(t.state, e);
      expect(r.state.phase).toBe("thinking");
      expect(r.effects).toEqual([{ type: "EARCON", name: "sent" }]);
      expect(r.state.pendingTurn).toEqual(t.state.pendingTurn);
      expect(r.state.history).toEqual(t.state.history);
    }
  });
  it("보낸 지 THINK_GRACE_MS가 지나면 MAIN_BUTTON과 HOLD_ACTIVATE는 기다리기를 그만두고, 취소음과 안내를 읽은 뒤 차례를 연다", () => {
    for (const e of [ev({ type: "MAIN_BUTTON" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const graced = run(atThinking().state, timer("thinkGrace"));
      expect(graced.state.thinkFresh).toBe(false);
      const r = run(graced.state, e);
      expect(r.state.phase).toBe("listening");
      expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_RESPONSE" });
      expect(r.effects).toContainEqual({ type: "EARCON", name: "cancel" });
      expect(spoken(r.effects)).toEqual(["turnCancelled"]);
      expect(types(r.effects)).not.toContain("OPEN_TURN");   // 안내를 다 읽은 뒤에 연다
      expect(r.state.pendingTurn).toBeNull();
      expect(r.state.history.some((t) => t.role === "user")).toBe(false);
      expect(r.state.mic).toBe("off");
      // 읽기가 끝나면 차례를 연다
      const open = run(r.state, speakEnd(r.state));
      expect(ofType(open.effects, "OPEN_TURN")).toHaveLength(1);
      expect(types(open.effects)).not.toContain("SPEAK");
    }
  });
  it("답이 오면 thinkFresh와 thinkGrace를 정리한다", () => {
    const r = run(atThinking().state, { type: "TURN_RESULT", reply: "어떤 정보가 궁금하세요?", status: "asking", slots: SLOTS });
    expect(r.state.thinkFresh).toBe(false);
    expect(timerCleared(r.effects, "thinkGrace")).toBe(true);
  });
  it("글자 모드의 thinking 큰 단추는 말만 멈추고 답을 계속 기다린다", () => {
    const t = atThinking("전기밥솥", { speechAvailable: false });
    const r = run({ ...t.state, speaking: "waiting1" }, { type: "MAIN_BUTTON" });
    expect(r.effects).toEqual([{ type: "STOP_SPEAK" }]);
    expect(r.state.phase).toBe("thinking");
  });
});

describe("Realtime 응답", () => {
  const thinking = () => {
    const l = atRealtimeListening();
    return run(l.state, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
  };
  it("REPLY_START → speaking, speakGuard 30초. REPLY_TEXT가 먼저 와도 같다", () => {
    const a = run(thinking().state, { type: "REPLY_START" });
    expect(a.state.phase).toBe("speaking");
    expect(timerSet(a.effects, "speakGuard")?.ms).toBe(30_000);
    const b = run(thinking().state, { type: "REPLY_TEXT", text: "어떤 정보가", final: false });
    expect(b.state.phase).toBe("speaking");
    expect(timerSet(b.effects, "speakGuard")?.ms).toBe(30_000);
    const fin = run(a.state, { type: "REPLY_TEXT", text: "어떤 정보가 궁금하세요?", final: true });
    expect(fin.state.lastReply).toBe("어떤 정보가 궁금하세요?");
    expect(timerSet(fin.effects, "speakGuard")?.ms).toBe("어떤 정보가 궁금하세요?".length * 250 + 3_000);
    const cell = decodeAiTurn(fin.state.history[fin.state.history.length - 1].content);
    expect(cell).toMatchObject({ status: "asking", reply: "어떤 정보가 궁금하세요?" });
  });
  it("REPLY_END, speakGuard 만료는 listening으로 보낸다. 늦은 REPLY_END는 무시한다", () => {
    const sp = run(thinking().state, { type: "REPLY_START" });
    for (const e of [ev({ type: "REPLY_END" }), ev(timer("speakGuard"))]) {
      const r = run(sp.state, e);
      expect(r.state.phase).toBe("listening");
      expect(timerCleared(r.effects, "speakGuard")).toBe(true);
      expect(ofType(r.effects, "OPEN_TURN")).toHaveLength(1);
      expect(r.state.awaitingConsent).toBe(false);
    }
    const listening = run(sp.state, { type: "REPLY_END" });
    const late = run(listening.state, { type: "REPLY_END" });
    expect(late.effects).toEqual([]);
    expect(late.state).toEqual(listening.state);
  });
  it("소리 없이 끝난 응답(REPLY_END, pendingConfirm 거짓)은 thinking에서 바로 listening", () => {
    const r = run(thinking().state, { type: "REPLY_END" });
    expect(r.state.phase).toBe("listening");
    expect(ofType(r.effects, "OPEN_TURN")).toHaveLength(1);
  });
  it("소리 재생 중 INTENT confirm → draft, pendingConfirm, 도구 결과. REPLY_END에서 확인 문장을 읽는다", () => {
    const t = thinking();
    const i = run(t.state, { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "call1", audioPending: true });
    expect(i.state.phase).toBe("thinking");
    expect(i.state.draft).toEqual(toDraft(SLOTS));
    expect(i.state.pendingConfirm).toBe(true);
    expect(i.effects).toEqual([{ type: "ENGINE_TOOL_RESULT", callId: "call1", output: { ok: true }, respond: false }]);
    const end = run(i.state, { type: "REPLY_END" });
    expect(end.state.phase).toBe("speaking");
    expect(ofType(end.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "confirm", text: CONFIRM });
    expect(decodeAiTurn(end.state.history[end.state.history.length - 1].content)?.status).toBe("confirming");
    // 확인 문장을 읽는 중 늦게 온 REPLY_END와 speakGuard는 무시
    expect(run(end.state, { type: "REPLY_END" }).effects).toEqual([]);
    expect(run(end.state, timer("speakGuard")).effects).toEqual([]);
    const conf = run(end.state, speakEnd(end.state));
    expect(conf.state.phase).toBe("confirming");
  });
  it("speaking 중 INTENT confirm 뒤 speakGuard가 오면 확인 문장을 읽는다", () => {
    const sp = run(thinking().state, { type: "REPLY_START" }, { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c", audioPending: true });
    const r = run(sp.state, timer("speakGuard"));
    expect(spoken(r.effects)).toEqual(["confirm"]);
  });
  it("소리 없는 확인 요청은 요약을 읽고, 조건이 부족하면 같은 모델에 보완 질문을 맡긴다", () => {
    const t = thinking();
    const confirmed = run(t.state, { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "complete" });
    expect(spoken(confirmed.effects)).toEqual(["confirm"]);
    const state = {
      ...t.state,
      productIntake: true,
      history: [{ role: "user" as const, content: "노트북이 필요하고 애플을 선호해요" }],
    };
    const conditions = [{ label: "브랜드", answer: "애플" }];
    const missing = run(state, {
      type: "INTENT", kind: "confirm", callId: "missing",
      slots: { ...EMPTY_SLOTS, product: "노트북", conditions },
    });
    expect(missing.state.phase).toBe("thinking");
    expect(spoken(missing.effects)).toEqual([]);
    expect(ofType(missing.effects, "OPEN_TURN")).toEqual([]);
    expect(ofType(missing.effects, "ENGINE_TOOL_RESULT")).toMatchObject([{
      callId: "missing", respond: "clarify",
      output: { error: "intake_incomplete", question: expect.stringContaining("어떤 일"), verified: { conditions } },
    }]);
  });
  it("제품이 빈 INTENT confirm은 무시한다(엔진이 bad_arguments로 되돌린다)", () => {
    const t = thinking();
    const r = run(t.state, { type: "INTENT", kind: "confirm", slots: { ...SLOTS, product: "" }, callId: "c" });
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(t.state);
  });
  it("INTENT register: 동의 판정이 없으면 need_consent로 닫고 확인 문장을 다시 읽는다", () => {
    const t = thinking();
    const d = run(t.state, { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c1" }, { type: "REPLY_END" });
    const c = run(d.state, speakEnd(d.state));
    // transcribed=false 차례 뒤의 INTENT register
    const said = run(c.state, { type: "USER_TURN_END", text: "", transcribed: false });
    expect(said.state.consentText).toBeNull();
    const r = run(said.state, { type: "INTENT", kind: "register", callId: "c2" });
    expect(types(r.effects)).not.toContain("REGISTER");
    expect(r.state.phase).toBe("speaking");
    expect(ofType(r.effects, "SPEAK")[0].text).toBe(script("confirmRetell", { summary: summaryOf(SLOTS) }));
    expect(r.effects).toContainEqual({ type: "ENGINE_TOOL_RESULT", callId: "c2", output: { ok: false, error: "need_consent" }, respond: false });
    expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_RESPONSE" });
    // 전사가 늦게 와도(consentText가 채워지면) 접수된다
    const late = run(said.state, { type: "USER_TRANSCRIPT", text: "네 그렇게 보내 주시면 돼요", final: true });
    expect(late.state.consentText).toBe("네 그렇게 보내 주시면 돼요");
    const ok = run(late.state, { type: "INTENT", kind: "register", callId: "c3" });
    expect(ok.state.phase).toBe("registering");
    expect(types(ok.effects)).toContain("REGISTER");
    expect(ok.effects).toContainEqual({ type: "ENGINE_TOOL_RESULT", callId: "c3", output: { ok: true }, respond: false });
  });
  it("INTENT register(draft 없음)은 listening으로 가서 failed를 읽는다", () => {
    const r = run(thinking().state, { type: "INTENT", kind: "register", callId: "c" });
    expect(r.state.phase).toBe("listening");
    expect(spoken(r.effects)).toEqual(["failed"]);
    expect(r.effects).toContainEqual({ type: "ENGINE_TOOL_RESULT", callId: "c", output: { ok: false, error: "need_consent" }, respond: false });
  });
  it("INTENT end → 끝내는 말을 알려 주고 도구 결과를 닫는다", () => {
    const r = run(thinking().state, { type: "INTENT", kind: "end", callId: "e" });
    expect(r.state.ask).toBeNull();
    expect(spoken(r.effects)).toEqual(["endGuide"]);
    expect(r.effects).toContainEqual({ type: "ENGINE_TOOL_RESULT", callId: "e", output: { ok: true }, respond: false });
  });
});

// ---------------------------------------------------------------- 말하기와 확인

describe("speaking", () => {
  it("MAIN_BUTTON과 HOLD_ACTIVATE: 말을 끊고 듣는다. 확인 문장을 끊으면 동의 대기가 꺼진다", () => {
    for (const e of [ev({ type: "MAIN_BUTTON" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const s = atSpeakingConfirm();
      const r = run(s.state, e);
      expect(r.state.phase).toBe("listening");
      expect(r.state.pendingConfirm).toBe(false);
      expect(r.state.awaitingConsent).toBe(false);
      expect(r.state.consentText).toBeNull();
      expect(r.effects).toEqual(expect.arrayContaining([{ type: "ENGINE_CANCEL_RESPONSE" }, { type: "STOP_SPEAK" }, { type: "TIMER_CLEAR", id: "speakGuard" }]));
      expect(ofType(r.effects, "OPEN_TURN")[0].settle).toBe(true);
      // 끊긴 확인 문장의 SPEAK_END는 낡은 것
      expect(run(r.state, { type: "SPEAK_END", id: "confirm" }).effects).toEqual([]);
    }
  });
  it("글자 모드의 speaking 큰 단추도 같다", () => {
    const t = atThinking("전기밥솥", { speechAvailable: false });
    const s = run(t.state, { type: "TURN_RESULT", reply: "무엇이 궁금하세요?", status: "asking", slots: SLOTS });
    const r = run(s.state, { type: "MAIN_BUTTON" });
    expect(r.state.phase).toBe("listening");
    expect(r.effects).toContainEqual({ type: "FOCUS", target: "textInput" });
  });
});

describe("confirming", () => {
  it("CONSENT_BUTTON → registering(5.5절 접수 표의 들어올 때 효과)", () => {
    const r = atRegistering();
    expect(r.state.phase).toBe("registering");
    expect(r.state.sendPending).toBe(true);
    expect(r.state.awaitingConsent).toBe(false);
    expect(r.state.mic).toBe("off");
    const fx = r.effects.slice(r.effects.findIndex((f) => f.type === "TIMER_CLEAR"));
    expect(types(fx)).toEqual(
      expect.arrayContaining(["ENGINE_CANCEL_LISTEN", "ENGINE_CANCEL_RESPONSE", "STOP_SPEAK", "EARCON", "WAIT_PULSE", "REGISTER", "TIMER_SET"]),
    );
    expect(timerSet(r.effects, "registerSay")?.ms).toBe(1_500);
    expect(types(r.effects.filter((f) => f.type === "REGISTER"))).toHaveLength(1);
  });
  it("CONSENT_BUTTON인데 동의 관문이 거짓이면 confirmRetell(방어 줄)", () => {
    const c = atConfirming();
    const r = run({ ...c.state, awaitingConsent: false }, { type: "CONSENT_BUTTON" });
    expect(types(r.effects)).not.toContain("REGISTER");
    expect(spoken(r.effects)).toEqual(["confirmRetell"]);
  });
  it("EDIT_BUTTON → listening, 고칠 내용을 묻고 듣기를 버린다", () => {
    const c = atConfirming();
    const r = run(c.state, { type: "EDIT_BUTTON" });
    expect(r.state.phase).toBe("listening");
    expect(r.state.awaitingConsent).toBe(false);
    expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: true });
    expect(spoken(r.effects)).toEqual(["editPrompt"]);
    const reopen = run(r.state, speakEnd(r.state));
    expect(ofType(reopen.effects, "OPEN_TURN")[0].earcon).toBe("turn");
  });
  it("확인 상태에서 '네'는 ENGINE_RESPOND 없이 REGISTER", () => {
    const r = run(atConfirming().state, { type: "USER_TURN_END", text: "네", transcribed: true });
    expect(r.state.phase).toBe("registering");
    expect(types(r.effects)).toContain("REGISTER");
    expect(types(r.effects)).not.toContain("ENGINE_RESPOND");
    // 엔진이 스스로 끝낸 차례가 아닌 듣기 닫기는 접수 표가 따로 낸다
    expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: false });
  });
  it("'네?'는 접수 없이 confirmAgain", () => {
    const r = run(atConfirming().state, { type: "USER_TURN_END", text: "네?", transcribed: true });
    expect(r.state.phase).toBe("confirming");
    expect(types(r.effects)).not.toContain("REGISTER");
    expect(types(r.effects)).not.toContain("ENGINE_RESPOND");
    expect(ofType(r.effects, "SPEAK")[0].text).toBe(CONFIRM);
  });
  it("'이대로 보내기 버튼'(낭독 메아리)은 NO_SPEECH처럼 처리, 서버 호출 없음", () => {
    const a = run(atConfirming().state, { type: "LISTEN_STARTED", late: false });
    const r = run(a.state, { type: "USER_TURN_END", text: "이대로 보내기 버튼", transcribed: true });
    expect(r.state.phase).toBe("confirming");
    expect(types(r.effects)).not.toContain("REGISTER");
    expect(types(r.effects)).not.toContain("ENGINE_RESPOND");
    expect(timerSet(r.effects, "relisten")).toBeDefined();
  });
  it("카드 낭독 메아리도 거른다", () => {
    // 요약 글의 이어진 한 구간을 그대로 읽은 소리만 메아리다(설계서 26절 1번).
    const a = run(atConfirming().state, { type: "LISTEN_STARTED", late: false });
    const r = run(a.state, { type: "USER_TURN_END", text: "제품은 전기밥솥 알고 싶은 정보는 할인 혜택", transcribed: true });
    expect(types(r.effects)).not.toContain("ENGINE_RESPOND");
    expect(timerSet(r.effects, "relisten")).toBeDefined();
  });
  it("요약의 중간을 건너뛰거나 값을 바꾼 말은 메아리로 버리지 않고 AI로 보낸다", () => {
    const skipped = run(atConfirming().state, { type: "USER_TURN_END", text: "제품은 전기밥솥 옵션은 흰색", transcribed: true });
    expect(types(skipped.effects)).toContain("ENGINE_RESPOND");
    const changed = run(atConfirming().state, { type: "USER_TURN_END", text: "제품은 전기밥솥 알고 싶은 정보는 할인 혜택 옵션은 검정색", transcribed: true });
    expect(types(changed.effects)).toContain("ENGINE_RESPOND");
    expect(changed.state.consentText).toBe("제품은 전기밥솥 알고 싶은 정보는 할인 혜택 옵션은 검정색");
  });
  it("고치는 말은 AI로 보내고 consentText에 담는다. thinking에서도 동의 대기가 유지된다", () => {
    const r = run(atConfirming().state, { type: "USER_TURN_END", text: "옵션은 흰색 말고 검정색으로", transcribed: true });
    expect(r.state.phase).toBe("thinking");
    expect(r.state.awaitingConsent).toBe(true);
    expect(r.state.consentText).toBe("옵션은 흰색 말고 검정색으로");
    expect(types(r.effects)).toContain("ENGINE_RESPOND");
  });
  it("확인 → 고치는 말 → AI가 asking으로 답함 → listening → INTENT register는 접수하지 않는다", () => {
    const edit = run(atConfirming().state, { type: "USER_TURN_END", text: "옵션은 검정색으로", transcribed: true });
    const asked = run(edit.state, { type: "TURN_RESULT", reply: "무엇이 더 궁금하세요?", status: "asking", slots: SLOTS });
    expect(asked.state.awaitingConsent).toBe(false);
    expect(asked.state.consentText).toBeNull();
    expect(canRegister(asked.state, "model")).toBe(false);
    const done = run(asked.state, { type: "INTENT", kind: "register", callId: "x" });
    expect(types(done.effects)).not.toContain("REGISTER");
    const back = run(asked.state, speakEnd(asked.state));
    expect(back.state.phase).toBe("listening");
    expect(canRegister(back.state, "model")).toBe(false);
  });
  it("transcribed=false 차례 뒤의 INTENT register는 앞 차례 글이 '응 검정색으로'였어도 접수하지 않는다", () => {
    const c = atConfirming();
    const first = run(c.state, { type: "USER_TURN_END", text: "응 검정색으로", transcribed: true });
    expect(first.state.consentText).toBe("응 검정색으로");
    const asked = run(first.state, { type: "TURN_RESULT", reply: "더 있나요?", status: "asking", slots: SLOTS });
    const l = run(asked.state, speakEnd(asked.state), { type: "LISTEN_STARTED", late: false });
    const untranscribed = run(l.state, { type: "USER_TURN_END", text: "", transcribed: false });
    const r = run(untranscribed.state, { type: "INTENT", kind: "register", callId: "x" });
    expect(types(r.effects)).not.toContain("REGISTER");
  });
  it("확인 중 새 확인 결과가 오면 앞 동의를 쓰지 않는다", () => {
    const edit = run(atConfirming().state, { type: "USER_TURN_END", text: "옵션은 검정색으로", transcribed: true });
    const r = run(edit.state, { type: "TURN_RESULT", reply: "", status: "confirming", slots: { ...SLOTS, options: "검정색" } });
    expect(r.state.awaitingConsent).toBe(false);
    expect(r.state.consentText).toBeNull();
    expect(r.state.draft?.options).toBe("검정색");
    const c = run(r.state, speakEnd(r.state));
    expect(c.state.awaitingConsent).toBe(true);
  });
  it("TEXT_SUBMIT '네'는 REGISTER, MAIN_BUTTON과 HOLD_SUBMIT은 ENGINE_SUBMIT", () => {
    const c = atConfirming();
    expect(types(run(c.state, { type: "TEXT_SUBMIT", text: "네" }).effects)).toContain("REGISTER");
    const a = run(c.state, { type: "LISTEN_STARTED", late: false });
    expect(run(a.state, { type: "MAIN_BUTTON" }).effects).toEqual([{ type: "ENGINE_SUBMIT" }]);
    expect(run(a.state, { type: "HOLD_SUBMIT" }).effects).toEqual([{ type: "ENGINE_SUBMIT" }]);
  });
  it("확인 문장을 끝까지 읽기 전에는 동의를 받지 않는다(speaking에서 '네'는 접수가 아니다)", () => {
    const s = atSpeakingConfirm();
    expect(canRegister(s.state, "speech", "네")).toBe(false);
    expect(canRegister(s.state, "button")).toBe(false);
  });
});

describe("canRegister", () => {
  const base = atConfirming().state;
  it("요약(draft) 없음, awaitingConsent 거짓, 보내는 중, 이미 접수는 거짓", () => {
    expect(canRegister({ ...base, draft: null }, "button")).toBe(false);
    expect(canRegister({ ...base, draft: { ...toDraft(SLOTS)!, product: "  " } }, "button")).toBe(false);
    expect(canRegister({ ...base, awaitingConsent: false }, "button")).toBe(false);
    expect(canRegister({ ...base, sendPending: true }, "button")).toBe(false);
    expect(canRegister({ ...base, requestId: "r" }, "button")).toBe(false);
  });
  it("단추와 분명한 동의", () => {
    expect(canRegister(base, "button")).toBe(true);
    expect(canRegister(base, "speech", "네")).toBe(true);
    expect(canRegister(base, "speech", "네 그렇게 보내 줘")).toBe(true);
    expect(canRegister(base, "speech", "네?")).toBe(false);
    expect(canRegister(base, "speech", "이대로 보내기 버튼")).toBe(false);
    expect(canRegister(base, "speech", "네 그런데 옵션은 검정")).toBe(false);
    expect(canRegister(base, "speech")).toBe(false);
  });
  it("AI 요청은 consentText가 있고 그럴듯한 동의일 때만", () => {
    expect(canRegister({ ...base, consentText: "네 그렇게 보내 주시면 돼요" }, "model")).toBe(true);
    expect(canRegister({ ...base, consentText: "예산은 5만 원" }, "model")).toBe(false);
    expect(canRegister({ ...base, consentText: null }, "model")).toBe(false);
    expect(canRegister({ ...base, consentText: "네" }, "model")).toBe(true);
  });
});

// ---------------------------------------------------------------- 접수

describe("registering", () => {
  it("registerSay, REGISTER_BUSY", () => {
    const r = atRegistering();
    expect(spoken(run(r.state, timer("registerSay")).effects)).toEqual(["registering"]);
    expect(spoken(run(r.state, { type: "REGISTER_BUSY" }).effects)).toEqual(["registerBusy"]);
  });
  it("PAUSE는 무시, HIDDEN은 hidden만", () => {
    const r = atRegistering();
    expect(run(r.state, { type: "PAUSE" }).effects).toEqual([]);
    const h = run(r.state, { type: "HIDDEN" });
    expect(h.state.phase).toBe("registering");
    expect(h.state.hidden).toBe(true);
    expect(h.effects).toEqual([]);
  });
  it("REGISTER_OK → done: 저장, 닫기, 완료음, 접수 번호 낭독, SPEAK_END 뒤 목록 링크에 초점", () => {
    const r = atDone();
    expect(r.state.phase).toBe("done");
    expect(r.state.requestId).toBe("r1");
    expect(r.state.queueNumber).toBe(7);
    expect(r.state.sendPending).toBe(false);
    expect(r.effects).toEqual(
      expect.arrayContaining([
        { type: "SAVE_RECORD" },
        { type: "ATTACH_PUSH" },
        { type: "ENGINE_CLOSE" },
        { type: "RELEASE_MIC" },
        { type: "WAKE_LOCK", on: false },
        { type: "EARCON", name: "done" },
        { type: "WAIT_PULSE", on: false },
      ]),
    );
    expect(ofType(r.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "registered", text: script("registered", { n: 7 }) });
    const end = run(r.state, speakEnd(r.state));
    expect(end.effects).toEqual([{ type: "FOCUS", target: "listLink" }]);
  });
  it("화면이 숨겨진 동안의 REGISTER_OK는 낭독 없이 resultUnspoken. VISIBLE이 알린다", () => {
    const reg = atRegistering();
    const hidden = run(reg.state, { type: "HIDDEN" });
    const r = run(hidden.state, { type: "REGISTER_OK", requestId: "r1", queueNumber: 3, status: "queued" });
    expect(r.state.resultUnspoken).toBe(true);
    expect(types(r.effects)).not.toContain("SPEAK");
    const v = run(r.state, { type: "VISIBLE" });
    expect(v.state.resultUnspoken).toBe(false);
    // 돌아오면 기기 목소리로 접수 결과를 읽는다(A4·A29·A34). 화면 낭독기용 ANNOUNCE는 목소리가 없을 때만 낸다.
    expect(v.effects).toEqual([{ type: "SPEAK", id: "registeredLate", text: script("registered", { n: 3 }) }]);
    // 목소리를 못 쓰면 같은 글을 ANNOUNCE로 내고 endId를 싣는다
    const t = run(
      run(run({ ...atRegistering().state, tts: false }, { type: "HIDDEN" }).state, { type: "REGISTER_OK", requestId: "r1", queueNumber: 3, status: "queued" }).state,
      { type: "VISIBLE" },
    );
    expect(t.effects).toEqual([{ type: "ANNOUNCE", channel: "status", text: script("registered", { n: 3 }), endId: "registeredLate" }]);
    // 늦게 읽은 번호가 끝나도 초점은 목록 링크로 간다
    expect(run(v.state, speakEnd(v.state)).effects).toEqual([{ type: "FOCUS", target: "listLink" }]);
  });
  it("REGISTER_FAIL retryable·unknown → confirming, cid와 draft는 그대로. '다시 보내'로 같은 cid 재접수", () => {
    for (const [kind, id] of [["retryable", "registerRetry"], ["unknown", "registerUnknown"]] as const) {
      const reg = atRegistering();
      const r = run(reg.state, { type: "REGISTER_FAIL", kind });
      expect(r.state.phase).toBe("confirming");
      expect(r.state.sendPending).toBe(false);
      expect(r.state.awaitingConsent).toBe(true);
      expect(r.state.consentText).toBeNull();
      expect(r.state.cid).toBe("c1");
      expect(r.state.draft).toEqual(reg.state.draft);
      expect(spoken(r.effects)).toEqual([id]);
      expect(r.effects).toEqual(expect.arrayContaining([{ type: "EARCON", name: "error" }, { type: "WAIT_PULSE", on: false }]));
      const reopen = run(r.state, speakEnd(r.state));
      expect(ofType(reopen.effects, "OPEN_TURN")[0].earcon).toBe("confirm");
      const again = run(reopen.state, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "다시 보내", transcribed: true });
      expect(again.state.phase).toBe("registering");
      expect(types(again.effects)).toContain("REGISTER");
    }
  });
  it("글자 모드의 실패 안내는 Text 대본", () => {
    const t = atThinking("전기밥솥", { speechAvailable: false });
    const s = run(t.state, { type: "TURN_RESULT", reply: "", status: "confirming", slots: SLOTS });
    const c = run(s.state, speakEnd(s.state), { type: "TEXT_SUBMIT", text: "네" });
    expect(c.state.phase).toBe("registering");
    const f = run(c.state, { type: "REGISTER_FAIL", kind: "retryable" });
    expect(spoken(f.effects)).toEqual(["registerRetryText"]);
  });
  it("REGISTER_FAIL rejected·conflict → error", () => {
    const rej = run(atRegistering().state, { type: "REGISTER_FAIL", kind: "rejected" });
    expect(rej.state.phase).toBe("error");
    expect(rej.state.error).toBe("register_rejected");
    expect(rej.state.sendPending).toBe(false);
    expect(spoken(rej.effects)).toEqual(["registerRejected"]);
    const con = run(atRegistering().state, { type: "REGISTER_FAIL", kind: "conflict" });
    expect(con.state.error).toBe("register_conflict");
    expect(spoken(con.effects)).toEqual(["registerConflict"]);
  });
  it("registering 중 EXIT → endedSending. 이어 REGISTER_OK → STOP_SPEAK와 registered 낭독(ANNOUNCE 아님). CONTINUE는 무시", () => {
    const reg = atRegistering();
    const ex = run(reg.state, { type: "EXIT" });
    expect(ex.state.phase).toBe("ended");
    expect(ex.state.sendPending).toBe(true);
    expect(spoken(ex.effects)).toEqual(["endedSending"]);
    expect(ex.state.resumeTo).toBe("confirming");
    expect(types(ex.effects)).not.toContain("REGISTER");
    expect(run(ex.state, { type: "CONTINUE" }).effects).toEqual([]);
    expect(run(ex.state, { type: "NEW_REQUEST", cid: "n" }).effects).toEqual([]);
    const ok = run(ex.state, { type: "REGISTER_OK", requestId: "r9", queueNumber: 2, status: "queued" });
    expect(ok.state.requestId).toBe("r9");
    expect(ok.effects[0]).toEqual({ type: "SAVE_RECORD" });
    expect(types(ok.effects)).toEqual(expect.arrayContaining(["STOP_SPEAK", "SPEAK", "ATTACH_PUSH"]));
    expect(types(ok.effects)).not.toContain("ANNOUNCE");
    // 마친 화면에는 [요청 목록 보기]가 없으므로 목록 단추를 가리키지 않는 대본을 읽는다(A9)
    expect(spoken(ok.effects)).toEqual(["registeredEnded"]);
    expect(ofType(ok.effects, "SPEAK")[0].text).not.toContain(BUTTONS.list);
    const fail = run(ex.state, { type: "REGISTER_FAIL", kind: "unknown" });
    expect(spoken(fail.effects)).toEqual(["endedSendFailed"]);
    expect(fail.state.sendPending).toBe(false);
    expect(fail.state.draft).not.toBeNull();
    const cont = run(fail.state, { type: "CONTINUE" });
    expect(cont.state.phase).toBe("connecting");
    expect(cont.state.history).toEqual(fail.state.history);
  });
  it("ended 중 REGISTER_FAIL rejected·conflict는 기록과 draft를 비운다. 숨겨진 REGISTER_OK는 낭독하지 않는다", () => {
    const ex = run(atRegistering().state, { type: "EXIT" });
    const rej = run(ex.state, { type: "REGISTER_FAIL", kind: "rejected" });
    expect(spoken(rej.effects)).toEqual(["registerRejected"]);
    expect(rej.state.history).toEqual([]);
    expect(rej.state.draft).toBeNull();
    const con = run(ex.state, { type: "REGISTER_FAIL", kind: "conflict" });
    expect(spoken(con.effects)).toEqual(["registerConflict"]);
    const hidden = run(ex.state, { type: "HIDDEN" });
    const ok = run(hidden.state, { type: "REGISTER_OK", requestId: "r", queueNumber: 1, status: "queued" });
    expect(ok.state.resultUnspoken).toBe(true);
    expect(types(ok.effects)).not.toContain("SPEAK");
  });
});

// ---------------------------------------------------------------- 끝난 상태와 멈춘 상태

describe("done과 NEW_REQUEST", () => {
  it("접수 번호를 읽는 중의 NEW_REQUEST는 무시한다. 끝까지 들은 뒤의 NEW_REQUEST만 새 요청이다(A25)", () => {
    const d = atDone();
    expect(d.state.speaking).toBe("registered");
    const early = run(d.state, { type: "NEW_REQUEST", cid: "c2" });
    expect(early.effects).toEqual([]);
    expect(early.state).toEqual(d.state);
    const heard = run(d.state, speakEnd(d.state));
    expect(run(heard.state, { type: "NEW_REQUEST", cid: "c2" }).state.phase).toBe("guiding");
  });
  it("done에서 NEW_REQUEST → guiding, 새 cid, 기록 비움, guideNewVoice", () => {
    const done = atDone();
    const r = run(run(done.state, speakEnd(done.state)).state, { type: "NEW_REQUEST", cid: "c2" });
    expect(r.state.phase).toBe("guiding");
    expect(r.state.cid).toBe("c2");
    expect(r.state.visit).toBe("returning");
    expect(r.state.requestId).toBeNull();
    expect(r.state.queueNumber).toBeNull();
    expect(r.state.draft).toBeNull();
    expect(r.state.lastReply).toBe(script("guideNewVoice"));   // 안내도 다시 들을 수 있다(A20)
    expect(r.state.history).toHaveLength(1);
    expect(spoken(r.effects)).toEqual(["guideNewVoice"]);
    expect(ofType(r.effects, "SPEAK")[0].text).toBe(script("guideNewVoice"));
    expect(r.effects).toContainEqual({ type: "WAKE_LOCK", on: true });
    // 안내 뒤 다시 연결한다
    const next = run(r.state, speakEnd(r.state));
    expect(next.state.phase).toBe("connecting");
    expect(next.effects).toContainEqual({ type: "ENGINE_START", kind: "fallback" });
  });
  it("글자 모드는 guideNewText", () => {
    const l = atListening({ speechAvailable: false });
    const e = run(l.state, { type: "EXIT" });
    const r = run(e.state, { type: "NEW_REQUEST", cid: "c2" });
    expect(spoken(r.effects)).toEqual(["guideNewText"]);
  });
  it("done의 EXIT는 endedRegistered", () => {
    const r = run(atDone().state, { type: "EXIT" });
    expect(r.state.phase).toBe("ended");
    expect(spoken(r.effects)).toEqual(["endedRegistered"]);
  });
});

describe("error", () => {
  it("들어올 때: 타이머 정리, 엔진과 마이크 닫기, 오류음, 낭독. SPEAK_END 뒤 FOCUS main", () => {
    const r = run(atThinking().state, { type: "FAILED", kind: "offline" });
    expect(r.state.phase).toBe("error");
    expect(r.state.engineReady).toBe(false);
    expect(r.state.mic).toBe("off");
    expect(r.effects).toEqual(
      expect.arrayContaining([
        { type: "WAIT_PULSE", on: false },
        { type: "STOP_SPEAK" },
        { type: "ENGINE_CANCEL_LISTEN", discard: false },
        { type: "ENGINE_CLOSE" },
        { type: "RELEASE_MIC" },
        { type: "WAKE_LOCK", on: false },
        { type: "EARCON", name: "error" },
      ]),
    );
    expect(ofType(r.effects, "TIMER_CLEAR")).toHaveLength(18);   // ALL_TIMERS 전부
    const end = run(r.state, speakEnd(r.state));
    expect(end.effects).toEqual([{ type: "FOCUS", target: "main" }]);
  });
  it("오류 종류별 대본(5.6절 표)", () => {
    const table: [string, string][] = [
      ["connect_failed", "connectFailed"],
      ["offline", "offline"],
      ["not_configured", "notConfigured"],
      ["unavailable_today", "dailyCap"],
      ["register_rejected", "registerRejected"],
      ["register_conflict", "registerConflict"],
    ];
    for (const [kind, id] of table) {
      const s = { ...atConnecting().state };
      const r = run(s, { type: "FAILED", kind: kind as never });
      if (kind.startsWith("register")) continue;   // 접수 오류는 registering 시험에서 본다
      expect(spoken(r.effects)).toEqual([id]);
    }
  });
  it("RETRY → connecting: 새 엔진으로 처음부터, 기록은 그대로", () => {
    const e = run(atThinking().state, { type: "FAILED", kind: "offline" });
    const r = run(e.state, { type: "RETRY" });
    expect(r.state.phase).toBe("connecting");
    expect(r.state.error).toBeNull();
    expect(r.state.aiFailures).toBe(0);
    expect(r.state.resumeTo).toBe("listening");
    expect(r.state.settleNext).toBe(true);
    expect(r.state.history).toEqual(e.state.history);
    expect(r.effects).toEqual(expect.arrayContaining([{ type: "WAKE_LOCK", on: true }, { type: "EARCON", name: "start" }, { type: "ENGINE_START", kind: "fallback" }]));
    expect(spoken(r.effects)).toEqual(["resumed"]);
    // 읽는 중에 READY가 와도 읽기가 끝난 뒤에야 listening
    const ready = run(r.state, { type: "READY", engine: "fallback", inputMode: "voice" });
    expect(ready.state.phase).toBe("connecting");
    const l = run(ready.state, speakEnd(ready.state));
    expect(l.state.phase).toBe("listening");
    expect(ofType(l.effects, "OPEN_TURN")[0].settle).toBe(true);
  });
  it("error에서 NEW_REQUEST와 EXIT", () => {
    const e = run(atThinking().state, { type: "FAILED", kind: "offline" });
    expect(run(e.state, { type: "NEW_REQUEST", cid: "n" }).state.phase).toBe("guiding");
    expect(run(e.state, { type: "EXIT" }).state.phase).toBe("ended");
  });
  it("글자 모드가 아닌데 기기 목소리를 못 쓰면 alert로 알린다", () => {
    const r = run(atThinking("전기밥솥", { tts: false }).state, { type: "FAILED", kind: "offline" });
    const a = ofType(r.effects, "ANNOUNCE")[0];
    expect(a).toMatchObject({ channel: "alert", endId: "offline" });
    expect(types(r.effects)).not.toContain("SPEAK");
  });
});

describe("paused", () => {
  it("PAUSE: resumeTo, 모든 타이머 지움, 취소들, 멈춤음과 낭독, pausedWarn·pausedEnd", () => {
    const r = atPaused();
    expect(r.state.phase).toBe("paused");
    expect(r.state.resumeTo).toBe("listening");
    expect(r.state.mic).toBe("off");
    const fx = run(atListening().state, { type: "PAUSE" }).effects;
    expect(ofType(fx, "TIMER_CLEAR")).toHaveLength(18);   // ALL_TIMERS 전부
    expect(fx).toEqual(
      expect.arrayContaining([
        { type: "WAIT_PULSE", on: false },
        { type: "ENGINE_CANCEL_LISTEN", discard: false },
        { type: "ENGINE_CANCEL_RESPONSE" },
        { type: "STOP_SPEAK" },
        { type: "EARCON", name: "pause" },
      ]),
    );
    expect(spoken(fx)).toEqual(["pausedByUser"]);
    expect(timerSet(fx, "pausedWarn")?.ms).toBe(100_000);
    expect(timerSet(fx, "pausedEnd")?.ms).toBe(120_000);
    expect(timerSet(fx, "idleClose")).toBeUndefined();   // fallback은 닫을 연결이 없다
  });
  it("guiding에서 멈추면 VISIT_MARK", () => {
    const g = run(mk(), { type: "START" });
    const r = run(g.state, { type: "PAUSE" });
    expect(r.effects).toContainEqual({ type: "VISIT_MARK" });
  });
  it("confirming에서 멈추면 resumeTo confirming, 동의 대기가 꺼진다. 돌아오면 확인 문장을 처음부터 다시 읽는다", () => {
    const p = run(atConfirming().state, { type: "PAUSE" });
    expect(p.state.resumeTo).toBe("confirming");
    expect(p.state.awaitingConsent).toBe(false);
    for (const e of [ev({ type: "RESUME" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const r = run(p.state, e);
      expect(r.state.phase).toBe("speaking");
      expect(r.state.pendingConfirm).toBe(true);
      expect(spoken(r.effects)).toEqual(["confirm"]);
      expect(ofType(r.effects, "SPEAK")[0].text).toBe(CONFIRM);
      expect(r.state.awaitingConsent).toBe(false);
    }
  });
  it("RESUME(engineReady 참, resumeTo listening) → listening, 뜸 있는 차례", () => {
    const r = run(atPaused().state, { type: "RESUME" });
    expect(r.state.phase).toBe("listening");
    expect(ofType(r.effects, "OPEN_TURN")[0].settle).toBe(true);
    expect(r.state.silenceStep).toBe(0);
    expect(timerCleared(r.effects, "pausedEnd")).toBe(true);
  });
  it("멈춤 → 계속 → 계속 조용함 → silence1부터 다시 → paused → 120초 → ended", () => {
    let s = atArmed().state;
    s = run(s, timer("silence")).state;           // silence1
    s = run(s, speakEnd(s), { type: "LISTEN_STARTED", late: false }).state;
    const p = run(s, { type: "PAUSE" });
    const r = run(p.state, { type: "RESUME" });
    const a = run(r.state, { type: "LISTEN_STARTED", late: false });
    expect(r.state.silenceStep).toBe(0);
    expect(timerSet(a.effects, "silence")?.ms).toBe(10_000);
    const h = run(a.state, timer("silence"));
    expect(spoken(h.effects)).toEqual(["silence1"]);
    let t = h.state;
    for (let i = 0; i < 3; i++) {
      t = run(t, speakEnd(t), { type: "LISTEN_STARTED", late: false }).state;
      t = run(t, timer("silence")).state;
    }
    expect(t.phase).toBe("paused");
    const warn = run(t, timer("pausedWarn"));
    expect(spoken(warn.effects)).toEqual(["pausedWarn"]);
    const end = run(t, timer("pausedEnd"));
    expect(end.state.phase).toBe("ended");
    expect(end.state.resumeTo).toBe("listening");
  });
  it("engineReady가 거짓인 RESUME은 connecting으로, resumeTo를 지킨다", () => {
    const p = run(atConfirming().state, { type: "PAUSE" });
    const closed = { ...p.state, engineReady: false, engine: null };
    const r = run(closed, { type: "RESUME" });
    expect(r.state.phase).toBe("connecting");
    expect(r.state.resumeTo).toBe("confirming");
    expect(spoken(r.effects)).toEqual(["resumed"]);
    expect(r.effects).toEqual(expect.arrayContaining([{ type: "EARCON", name: "start" }, { type: "ENGINE_START", kind: "fallback" }]));
    const ready = run(r.state, { type: "READY", engine: "fallback", inputMode: "voice" }, speakEnd(run(r.state, { type: "READY", engine: "fallback", inputMode: "voice" }).state));
    expect(ready.state.phase).toBe("speaking");
    expect(spoken(ready.effects)).toEqual(["confirm"]);
  });
  it("Realtime이 열려 있으면 idleClose를 걸고, 만료되면 닫는다. 이어 가면 다시 연결한다", () => {
    const l = atRealtimeListening();
    const p = run(l.state, { type: "PAUSE" });
    expect(timerSet(p.effects, "idleClose")?.ms).toBe(30_000);
    const c = run(p.state, timer("idleClose"));
    expect(c.effects).toEqual([{ type: "ENGINE_CLOSE" }, { type: "RELEASE_MIC" }]);
    expect(c.state.engineReady).toBe(false);
    const r = run(c.state, { type: "RESUME" });
    expect(r.state.phase).toBe("connecting");
    expect(r.effects).toContainEqual({ type: "ENGINE_START", kind: "realtime" });
  });
  it("멈춘 채 listening으로 돌아간 상태에서 HIDDEN은 낭독 없이 paused, VISIBLE은 멈춤음과 기기 목소리 안내(A4)", () => {
    const l = atListening();
    const h = run(l.state, { type: "HIDDEN" });
    expect(h.state.phase).toBe("paused");
    expect(h.state.hidden).toBe(true);
    expect(types(h.effects)).not.toContain("SPEAK");
    expect(h.effects).not.toContainEqual({ type: "EARCON", name: "pause" });
    const v = run(h.state, { type: "VISIBLE" });
    expect(v.effects).toEqual([{ type: "EARCON", name: "pause" }, { type: "SPEAK", id: "pausedReturn", text: script("pausedReturn") }]);
    expect(script("pausedReturn")).toContain(`'${BUTTONS.resume}'`);
    expect(v.state.phase).toBe("paused");
    // 목소리를 못 쓰면 ANNOUNCE에 endId를 싣는다(VoiceOver 대비). 두 번 읽히지 않는다
    const nt = run(run(atListening({ tts: false }).state, { type: "HIDDEN" }).state, { type: "VISIBLE" });
    expect(nt.effects).toEqual([{ type: "EARCON", name: "pause" }, { type: "ANNOUNCE", channel: "status", text: script("pausedReturn"), endId: "pausedReturn" }]);
    // 안내가 끝나면 초점을 큰 단추([계속하기])로 옮긴다. 같은 사건에 SPEAK는 없다(불변식 7)
    expect(run(v.state, speakEnd(v.state)).effects).toEqual([{ type: "FOCUS", target: "main" }]);
  });
  it("그 밖의 상태의 HIDDEN은 hidden만 바꾼다", () => {
    for (const s of [mk(), atDone().state]) {
      const r = run(s, { type: "HIDDEN" });
      expect(r.state.hidden).toBe(true);
      expect(r.state.phase).toBe(s.phase);
    }
  });
});

describe("ended", () => {
  it("EXIT: 마침 대본은 상황에 따라(5.10절 표)", () => {
    const empty = run(atListening().state, { type: "EXIT" });
    expect(spoken(empty.effects)).toEqual(["endedEmpty"]);
    const asked = atSpeakingAsking();
    const talked = run(asked.state, { type: "EXIT" });
    expect(spoken(talked.effects)).toEqual(["endedUnregistered"]);
    // 답을 받지 못한 이용자 칸은 기록에서 빠지므로 처음 말에서 끝내면 endedEmpty
    expect(spoken(run(atThinking().state, { type: "EXIT" }).effects)).toEqual(["endedEmpty"]);
    expect(run(atDone().state, { type: "EXIT" }).effects.some((f) => f.type === "SPEAK" && f.id === "endedRegistered")).toBe(true);
    expect(empty.effects).toEqual(
      expect.arrayContaining([
        { type: "STOP_SPEAK" },
        { type: "ENGINE_CANCEL_LISTEN", discard: false },
        { type: "ENGINE_CLOSE" },
        { type: "RELEASE_MIC" },
        { type: "WAKE_LOCK", on: false },
        { type: "EARCON", name: "end" },
      ]),
    );
    expect(empty.state.engineReady).toBe(false);
    expect(run(empty.state, speakEnd(empty.state)).effects).toEqual([{ type: "FOCUS", target: "main" }]);
  });
  it("EXIT 뒤 CONTINUE가 기록을 유지한다. 접수된 뒤에는 CONTINUE가 없다", () => {
    const talked = run(atConfirming().state, { type: "EXIT" });
    expect(talked.state.resumeTo).toBe("confirming");
    const c = run(talked.state, { type: "CONTINUE" });
    expect(c.state.phase).toBe("connecting");
    expect(c.state.history).toEqual(talked.state.history);
    expect(c.effects).toEqual(expect.arrayContaining([{ type: "WAKE_LOCK", on: true }, { type: "EARCON", name: "start" }]));
    expect(spoken(c.effects)).toEqual(["resumed"]);
    const ready = run(c.state, { type: "READY", engine: "fallback", inputMode: "voice" });
    const back = run(ready.state, speakEnd(ready.state));
    expect(back.state.phase).toBe("speaking");
    expect(spoken(back.effects)).toEqual(["confirm"]);
    const registered = run(atDone().state, { type: "EXIT" });
    expect(run(registered.state, { type: "CONTINUE" }).effects).toEqual([]);
  });
  it("ended의 NEW_REQUEST(sendPending 거짓) → guiding", () => {
    const e = run(atThinking().state, { type: "EXIT" });
    expect(run(e.state, { type: "NEW_REQUEST", cid: "c9" }).state.phase).toBe("guiding");
  });
  it("EXIT는 ended에서 아무 일도 하지 않는다", () => {
    const e = run(atThinking().state, { type: "EXIT" });
    expect(run(e.state, { type: "EXIT" }).effects).toEqual([]);
  });
  it("Realtime 세션 한도: 재연결 1회 뒤 ended, fallback으로 이어서 한다", () => {
    const l = atRealtimeListening();
    const first = run(l.state, { type: "LISTEN_STARTED", late: false }, { type: "LOST", reason: "session_limit" });
    expect(first.state.phase).toBe("connecting");
    expect(first.state.reconnects).toBe(1);
    expect(first.state.engineReady).toBe(false);
    expect(spoken(first.effects)).toEqual(["sessionRenewed"]);
    expect(first.effects).toContainEqual({ type: "ENGINE_CLOSE" });
    expect(first.effects).toContainEqual({ type: "ENGINE_START", kind: "realtime" });
    expect(first.state.resumeTo).toBe("listening");
    const ready = run(first.state, { type: "MIC_READY" }, { type: "READY", engine: "realtime", inputMode: "voice" });
    expect(ready.state.phase).toBe("connecting");   // 읽는 중이라 기다린다
    const again = run(ready.state, speakEnd(ready.state), { type: "LISTEN_STARTED", late: false }, { type: "LOST", reason: "session_limit" });
    expect(again.state.phase).toBe("ended");
    expect(again.state.fallbackOnly).toBe(true);
    expect(spoken(again.effects.slice(-12))).toEqual(["sessionOver"]);
    const cont = run(again.state, { type: "CONTINUE" });
    expect(cont.effects).toContainEqual({ type: "ENGINE_START", kind: "fallback" });
  });
  it("confirming에서 세션이 갱신되면 연결 뒤 확인 문장을 다시 읽는다", () => {
    const l = atRealtimeListening();
    const t = run(l.state, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    const c = run(t.state, { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c" }, { type: "REPLY_END" });
    const conf = run(c.state, speakEnd(c.state));
    const lost = run(conf.state, { type: "LOST", reason: "session_limit" });
    expect(lost.state.resumeTo).toBe("confirming");
    const back = run(lost.state, speakEnd(lost.state), { type: "MIC_READY" }, { type: "READY", engine: "realtime", inputMode: "voice" });
    expect(back.state.phase).toBe("speaking");
    expect(back.state.pendingConfirm).toBe(true);
  });
  it("Realtime의 그 밖의 LOST는 fallback으로 바꾸고 답을 기다리던 이용자 칸을 뺀다", () => {
    const l = atRealtimeListening();
    const t = run(l.state, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    expect(t.state.history.some((h) => h.role === "user")).toBe(true);
    const r = run(t.state, { type: "LOST", reason: "network" });
    expect(r.state.phase).toBe("connecting");
    expect(r.state.fallbackOnly).toBe(true);
    expect(r.state.history.some((h) => h.role === "user")).toBe(false);
    expect(types(r.effects)).toEqual(expect.arrayContaining(["ENGINE_CLOSE", "RELEASE_MIC"]));
    expect(spoken(r.effects)).toEqual(["engineSwitchedVoice"]);
    expect(r.effects).toContainEqual({ type: "ENGINE_START", kind: "fallback" });
    expect(timerSet(r.effects, "connect")?.ms).toBe(12_000);
  });
  it("fallback 엔진의 LOST는 표에 없어 아무 일도 하지 않는다", () => {
    const a = atArmed();
    const r = run(a.state, { type: "LOST", reason: "network" });
    expect(r.effects).toEqual([]);
  });
});

// ---------------------------------------------------------------- 어느 상태에서나

describe("HELP, REPEAT, RATE, SESSION_WARN", () => {
  it("HELP 두 번 → helpVoice, helpMoreVoice, 다시 helpVoice. 글자 모드는 helpText", () => {
    const a = atArmed();
    const h1 = run(a.state, { type: "HELP" });
    expect(spoken(h1.effects)).toEqual(["helpVoice"]);
    expect(h1.effects[0]).toEqual({ type: "ENGINE_CANCEL_LISTEN", discard: false });
    const h2 = run(h1.state, { type: "HELP" });
    expect(spoken(h2.effects)).toEqual(["helpMoreVoice"]);
    expect(h2.state.helpDepth).toBe(0);
    expect(spoken(run(h2.state, { type: "HELP" }).effects)).toEqual(["helpVoice"]);
    const text = run(atListening({ speechAvailable: false }).state, { type: "HELP" });
    expect(spoken(text.effects)).toEqual(["helpText"]);
    const reopen = run(h1.state, speakEnd(h1.state));
    expect(ofType(reopen.effects, "OPEN_TURN")).toHaveLength(1);
  });
  it("도움말이 아닌 다른 차례는 helpDepth를 0으로 돌린다", () => {
    const h1 = run(atArmed().state, { type: "HELP" });
    expect(h1.state.helpDepth).toBe(1);
    const r = run(h1.state, speakEnd(h1.state), { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    expect(r.state.helpDepth).toBe(0);
    const btn = run(h1.state, { type: "REPEAT" });
    expect(btn.state.helpDepth).toBe(0);   // 첫 안내를 다시 읽는다(A20)
  });
  it("thinking·speaking의 HELP는 말과 인식을 멈추고 listening으로, 동의 대기를 끈다. confirming은 그대로", () => {
    const sp = atSpeakingConfirm();
    const r = run(sp.state, { type: "HELP" });
    expect(r.state.phase).toBe("listening");
    expect(r.state.pendingConfirm).toBe(false);
    expect(r.state.awaitingConsent).toBe(false);
    expect(r.effects).toEqual(expect.arrayContaining([{ type: "STOP_SPEAK" }, { type: "ENGINE_CANCEL_RESPONSE" }]));
    const c = run(atConfirming().state, { type: "HELP" });
    expect(c.state.phase).toBe("confirming");
    expect(c.state.awaitingConsent).toBe(true);
    const th = run(atThinking().state, { type: "HELP" });
    expect(th.state.phase).toBe("listening");
    expect(th.state.history.some((h) => h.role === "user")).toBe(false);
  });
  it("guiding의 HELP는 안내를 건너뛰고 연결하며 도움말을 읽는다", () => {
    const g = run(mk(), { type: "CONFIG", realtime: false }, { type: "START" });
    const r = run(g.state, { type: "HELP" });
    expect(r.state.phase).toBe("connecting");
    expect(spoken(r.effects)).toEqual(["helpVoice"]);
    expect(types(r.effects)).toEqual(expect.arrayContaining(["STOP_SPEAK", "VISIT_MARK", "ENGINE_START"]));
    const ready = run(r.state, { type: "READY", engine: "fallback", inputMode: "voice" });
    expect(ready.state.phase).toBe("connecting");
    const done = run(ready.state, speakEnd(ready.state));
    expect(done.state.phase).toBe("listening");
  });
  it("REPEAT: lastReply를 읽는다. confirming이면 confirmAgain", () => {
    const sp = atSpeakingAsking();
    const r = run(sp.state, { type: "REPEAT" });
    expect(r.state.phase).toBe("listening");
    expect(ofType(r.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "repeat", text: "어떤 정보가 궁금하세요?" });
    const c = run(atConfirming().state, { type: "REPEAT" });
    expect(c.state.phase).toBe("confirming");
    expect(ofType(c.effects, "SPEAK")[0].text).toBe(CONFIRM);
    // 첫 AI 답 전에는 처음 안내를 다시 읽는다(A20). 읽을 말이 아예 없으면 아무것도 하지 않는다
    expect(spoken(run(atListening().state, { type: "REPEAT" }).effects)).toEqual(["repeat"]);
    expect(run({ ...atListening().state, lastReply: "" }, { type: "REPEAT" }).effects).toEqual([]);
  });
  it("RATE_BUTTON은 보통 → 천천히 → 빠르게 → 보통. 듣는 상태는 읽고, 그 밖은 rate만", () => {
    let s = atArmed().state;
    const seq: [string, string][] = [["slow", "rateSlow"], ["fast", "rateFast"], ["normal", "rateNormal"]];
    for (const [rate, id] of seq) {
      const r = run(s, { type: "RATE_BUTTON" });
      expect(r.state.rate).toBe(rate);
      expect(r.effects).toContainEqual({ type: "ENGINE_SET_RATE", rate });
      expect(spoken(r.effects)).toEqual([id]);
      s = r.state;
    }
    const idle = run(mk(), { type: "RATE_BUTTON" });
    expect(idle.state.rate).toBe("slow");
    expect(idle.effects).toEqual([]);
    const done = run(atDone().state, { type: "RATE_BUTTON" });
    expect(done.state.rate).toBe("slow");
    expect(done.effects).toEqual([]);
    const g = run(run(mk(), { type: "CONFIG", realtime: false }, { type: "START" }).state, { type: "RATE_BUTTON" });
    expect(g.state.phase).toBe("connecting");
    expect(spoken(g.effects)).toEqual(["rateSlow"]);
  });
  it("SESSION_WARN: 듣는 중이면 읽고, 그 밖의 활성 상태는 다음 차례 열기 전에 읽는다", () => {
    const a = atArmed();
    const r = run(a.state, { type: "SESSION_WARN" });
    expect(spoken(r.effects)).toEqual(["sessionWarn"]);
    const th = run(atThinking().state, { type: "SESSION_WARN" });
    expect(th.state.sessionWarnPending).toBe(true);
    expect(th.effects).toEqual([]);
    const sp = run(th.state, { type: "TURN_RESULT", reply: "무엇이 궁금하세요?", status: "asking", slots: SLOTS });
    const open = run(sp.state, speakEnd(sp.state));
    expect(spoken(open.effects)).toEqual(["sessionWarn"]);
    expect(types(open.effects)).not.toContain("OPEN_TURN");
    expect(open.state.sessionWarnPending).toBe(false);
    const after = run(open.state, speakEnd(open.state));
    expect(ofType(after.effects, "OPEN_TURN")).toHaveLength(1);
    expect(run(atDone().state, { type: "SESSION_WARN" }).effects).toEqual([]);
  });
  it("PAUSE는 활성 상태에서만 paused로 간다", () => {
    expect(run(atThinking().state, { type: "PAUSE" }).state.phase).toBe("paused");
    expect(run(atDone().state, { type: "PAUSE" }).effects).toEqual([]);
    expect(run(atPaused().state, { type: "PAUSE" }).effects).toEqual([]);
  });
  it("paused에서 thinking이던 이용자 칸은 기록에서 빠진다", () => {
    const p = run(atThinking().state, { type: "PAUSE" });
    expect(p.state.history.some((h) => h.role === "user")).toBe(false);
    expect(p.state.pendingTurn).toBeNull();
  });
});

describe("기기 목소리 없음(tts=false)", () => {
  it("SPEAK 대신 ANNOUNCE(endId 포함)를 내고, 이어지는 전이가 같게 돈다", () => {
    const g = run(mk({ tts: false }), { type: "CONFIG", realtime: false }, { type: "START" });
    expect(types(g.effects)).not.toContain("SPEAK");
    const a = ofType(g.effects, "ANNOUNCE")[0];
    expect(a).toMatchObject({ channel: "status", endId: "guideFirstVoice" });
    expect(g.state.speaking).toBe("guideFirstVoice");
    const next = run(g.state, { type: "SPEAK_END", id: a.endId as string });
    expect(next.state.phase).toBe("connecting");
  });
  it("읽기와 함께 SPEAK가 한 번도 나오지 않는다. 오류만 alert", () => {
    let s = mk({ tts: false });
    const all: LiveEffect[] = [];
    const feed = (...events: LiveEvent[]) => {
      const r = run(s, ...events);
      s = r.state;
      all.push(...r.effects);
    };
    feed({ type: "CONFIG", realtime: false }, { type: "START" });
    feed({ type: "SPEAK_END", id: s.speaking as string });
    feed({ type: "READY", engine: "fallback", inputMode: "voice" }, { type: "LISTEN_STARTED", late: false }, timer("silence"));
    feed({ type: "SPEAK_END", id: s.speaking as string });
    feed({ type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    feed({ type: "FAILED", kind: "offline" });
    expect(types(all)).not.toContain("SPEAK");
    expect(ofType(all, "ANNOUNCE").filter((a) => a.channel === "alert")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 접근성 검토 뒤 바뀐 동작(A숫자는 a11y-result.json의 지적 번호)

describe("멈춤과 돌아옴(A3·A4·A17·A29·A34)", () => {
  it("멈춤 안내(pausedByUser·pausedBySilence)가 끝나면 초점을 큰 단추로 옮긴다. 100초 경고 뒤에는 옮기지 않는다", () => {
    const p = atPaused();
    expect(p.state.speaking).toBe("pausedByUser");
    expect(run(p.state, speakEnd(p.state)).effects).toEqual([{ type: "FOCUS", target: "main" }]);
    // 침묵 안내 둘, 계속 들을까요?, 멈춤 순서로 간다. 각 읽기가 끝나면 차례가 다시 열리고 듣기가 시작된다.
    let silent = run(atArmed().state, timer("silence"));
    for (let i = 0; i < 3; i++) {
      silent = run(silent.state, speakEnd(silent.state), { type: "LISTEN_STARTED", late: false }, timer("silence"));
    }
    expect(silent.state.phase).toBe("paused");
    expect(silent.state.speaking).toBe("pausedBySilence");
    expect(run(silent.state, speakEnd(silent.state)).effects).toEqual([{ type: "FOCUS", target: "main" }]);
    const warn = run(run(p.state, speakEnd(p.state)).state, timer("pausedWarn"));
    expect(spoken(warn.effects)).toEqual(["pausedWarn"]);
    expect(run(warn.state, speakEnd(warn.state)).effects).toEqual([]);
  });
  it("멈춤 안내를 읽는 중에 이어 가면 낭독을 먼저 멈춘다(뜸·신호음·마이크 위로 겹치지 않게)", () => {
    const p = atPaused();
    expect(p.state.speaking).toBe("pausedByUser");
    for (const e of [ev({ type: "RESUME" }), ev({ type: "HOLD_ACTIVATE" })]) {
      const r = run(p.state, e);
      expect(r.effects[0]).toEqual({ type: "STOP_SPEAK" });
      expect(r.state.speaking).toBeNull();
    }
  });
  it("돌아왔을 때 이미 읽는 중이면 멈춤 안내를 겹쳐 읽지 않는다", () => {
    const p = atPaused();   // pausedByUser를 읽는 중
    const h = run(p.state, { type: "HIDDEN" }, { type: "VISIBLE" });
    expect(types(h.effects)).not.toContain("SPEAK");
  });
  it("가려진 동안 접수가 끝났으면 돌아왔을 때 접수 결과를 기기 목소리로 읽는다. 마친 화면이면 목록 단추를 가리키지 않는다(A9)", () => {
    const ex = run(atRegistering().state, { type: "EXIT" });
    const hidden = run(ex.state, { type: "HIDDEN" });
    const ok = run(hidden.state, { type: "REGISTER_OK", requestId: "r1", queueNumber: 5, status: "queued" });
    expect(ok.state.resultUnspoken).toBe(true);
    const v = run(ok.state, { type: "VISIBLE" });
    expect(ofType(v.effects, "SPEAK")[0]).toEqual({ type: "SPEAK", id: "registeredLate", text: script("registeredEnded", { n: 5 }) });
    expect(ofType(v.effects, "SPEAK")[0].text).not.toContain(BUTTONS.list);
  });
  it("접수 번호를 읽는 중(registered·registeredEnded·registeredLate)의 NEW_REQUEST는 모두 무시한다", () => {
    const d = atDone();
    for (const id of ["registered", "registeredEnded", "registeredLate"]) {
      expect(run({ ...d.state, speaking: id }, { type: "NEW_REQUEST", cid: "n" }).effects, id).toEqual([]);
    }
  });
});

describe("마이크 허용을 기다리는 동안의 소리 안내(A12·A21·A35)", () => {
  it("Realtime: 마이크를 요청하면 대기 펄스와 8초 안내 타이머를 건다. MIC_READY·READY가 지운다", () => {
    const c = atConnecting({}, true);
    expect(c.effects).toContainEqual({ type: "WAIT_PULSE", on: true });
    expect(timerSet(c.effects, "micSay")?.ms).toBe(8_000);
    expect(timerSet(c.effects, "micWait")?.ms).toBe(60_000);   // 60초 상한은 그대로
    expect(timerCleared(run(c.state, { type: "MIC_READY" }).effects, "micSay")).toBe(true);
    expect(timerCleared(run(c.state, { type: "READY", engine: "realtime", inputMode: "voice" }).effects, "micSay")).toBe(true);
  });
  it("Realtime: 타이머가 울리면 소리로 안내하고 15초 뒤에 다시 건다. 다른 말을 읽는 중이면 4초 뒤에 다시 본다", () => {
    const c = atConnecting({}, true);
    const r = run(c.state, timer("micSay"));
    expect(spoken(r.effects)).toEqual(["micWaiting"]);
    expect(ofType(r.effects, "SPEAK")[0].text).toBe(script("micWaiting"));
    expect(timerSet(r.effects, "micSay")?.ms).toBe(15_000);
    const busy = run({ ...c.state, speaking: "resumed" }, timer("micSay"));
    expect(types(busy.effects)).not.toContain("SPEAK");
    expect(timerSet(busy.effects, "micSay")?.ms).toBe(4_000);
    // 목소리를 못 쓰면 ANNOUNCE(endId)로 낸다
    const nt = run(atConnecting({ tts: false }, true).state, timer("micSay"));
    expect(ofType(nt.effects, "ANNOUNCE")[0]).toMatchObject({ endId: "micWaiting", text: script("micWaiting") });
  });
  it("Realtime: 안내를 읽는 중에 READY가 와도 읽기가 끝난 뒤에 이어 간다", () => {
    const c = atConnecting({}, true);
    const say = run(c.state, timer("micSay"));
    const ready = run(say.state, { type: "MIC_READY" }, { type: "READY", engine: "realtime", inputMode: "voice" });
    expect(types(ready.effects)).not.toContain("OPEN_TURN");
    expect(types(run(ready.state, speakEnd(ready.state)).effects)).toContain("OPEN_TURN");
  });
  it("예비 엔진 첫 듣기: 차례를 열면 8초 안내 타이머. LISTEN_STARTED가 지운다", () => {
    const l = atListening();
    expect(timerSet(l.effects, "micSay")?.ms).toBe(8_000);
    const started = run(l.state, { type: "LISTEN_STARTED", late: false });
    expect(timerCleared(started.effects, "micSay")).toBe(true);
    expect(started.state.micOnce).toBe(true);
    // 한 번 듣기가 시작됐으면 이후 차례에는 걸지 않는다
    expect(timerSet(run(started.state, { type: "HOLD_CANCEL" }).effects, "micSay")).toBeUndefined();
  });
  it("예비 엔진: 허용을 기다리는 사이 타이머가 울리면 인식을 끊고 읽는다. 읽기가 끝나면 차례를 다시 연다", () => {
    const l = atListening();
    const r = run(l.state, timer("micSay"));
    expect(r.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: true });
    expect(spoken(r.effects)).toEqual(["micWaiting"]);
    expect(r.state.mic).toBe("off");
    expect(r.effects.findIndex((f) => f.type === "ENGINE_CANCEL_LISTEN")).toBeLessThan(r.effects.findIndex((f) => f.type === "SPEAK"));
    const again = run(r.state, speakEnd(r.state));
    expect(ofType(again.effects, "OPEN_TURN")).toHaveLength(1);
    expect(timerSet(again.effects, "micSay")?.ms).toBe(15_000);
  });
  it("예비 엔진: 이미 듣기가 시작됐거나 마이크가 닫혀 있으면 읽지 않는다. 허용 안내는 MIC_SAY_MAX번(1번) 읽고 그다음에는 포기 안내(micGiveUp)를 읽는다", () => {
    const started = run(atListening().state, { type: "LISTEN_STARTED", late: false });
    expect(spoken(run(started.state, timer("micSay")).effects)).toEqual([]);
    let s = atListening().state;
    const said: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = run(s, timer("micSay"));
      if (spoken(t.effects).length === 0) break;
      said.push(...spoken(t.effects));
      const reopened = run(t.state, speakEnd(t.state));
      s = reopened.state;
      if (timerSet(reopened.effects, "micSay") === undefined) break;
    }
    // A21: 허용 안내를 읽은 뒤 다음 타이머가 포기 안내를 읽고, 그 읽기가 끝나도 차례를 다시 열지 않는다(소리 없는 120초 꼬리가 없다).
    // 되풀이를 1번으로 줄인 이유: 허용 창이 떠 있는 동안 인식 요청을 여러 번 취소하면 브라우저가 마이크를 자동으로 막을 수 있다(liveTiming.ts).
    expect(said).toEqual(["micWaiting", "micGiveUp"]);
    expect(s.micSays).toBe(2);
    expect(s.mic).toBe("off");
  });
  it("예비 엔진: micGiveUp 읽기가 끝나도 차례가 저절로 열리지 않고 타이머도 없다. '말하기'로 다시 열면 안내를 처음부터 되풀이한다", () => {
    let s = atListening().state;
    for (let i = 0; i < 1; i++) {
      const t = run(s, timer("micSay"));
      s = run(t.state, speakEnd(t.state)).state;
    }
    const giveUp = run(s, timer("micSay"));
    expect(spoken(giveUp.effects)).toEqual(["micGiveUp"]);
    expect(ofType(giveUp.effects, "SPEAK")[0].text).toBe(script("micGiveUp"));
    expect(giveUp.effects).toContainEqual({ type: "ENGINE_CANCEL_LISTEN", discard: true });
    const end = run(giveUp.state, speakEnd(giveUp.state));
    expect(types(end.effects)).not.toContain("OPEN_TURN");
    expect(timerSet(end.effects, "micSay")).toBeUndefined();
    expect(end.state.mic).toBe("off");
    // Space·Enter(말하기)로 다시 열면 듣기를 시작하고 안내 되풀이도 처음(8초)부터 다시 건다
    const again = run(end.state, ev({ type: "MAIN_BUTTON" }));
    expect(ofType(again.effects, "OPEN_TURN")).toHaveLength(1);
    expect(again.state.micSays).toBe(0);
    expect(timerSet(again.effects, "micSay")?.ms).toBe(8_000);
  });
  it("예비 엔진: 허용 안내를 끝까지 읽어도 소리 없이 기다리는 구간이 한 번에 15초를 넘지 않는다(차례는 안내마다 끊고 다시 연다)", () => {
    // 허용이 끝내 안 되는 가상 환경(LISTEN_STARTED가 오지 않는다): 타이머 사이 간격은 8초, 15초뿐이고 마지막은 포기 안내로 끝난다
    let s = atListening().state;
    const gaps: number[] = [];
    const first = timerSet(atListening().effects, "micSay")?.ms ?? -1;
    gaps.push(first);
    for (let i = 0; i < 5; i++) {
      const t = run(s, timer("micSay"));
      const e = run(t.state, speakEnd(t.state));
      s = e.state;
      const next = timerSet(e.effects, "micSay")?.ms;
      if (next === undefined) break;
      gaps.push(next);
    }
    expect(gaps).toEqual([8_000, 15_000]);
    expect(gaps.reduce((a, b) => a + b, 0)).toBeLessThan(120_000);
  });
});

describe("확인 동의와 끝내기 답(A11·A36·A13)", () => {
  it("'네, 부탁드립니다'와 '네 보내세요'로 접수한다", () => {
    for (const text of ["네, 부탁드립니다", "네 보내세요", "네 부탁 드립니다", "네 보내 주십시오"]) {
      const c = atConfirming();
      const r = run(c.state, { type: "USER_TURN_END", text, transcribed: true });
      expect(r.state.phase, text).toBe("registering");
      expect(types(r.effects), text).toContain("REGISTER");
    }
  });
  it("'네, 괜찮아요'는 분명한 동의는 아니다. AI에게 보내고, AI가 동의로 보면 접수한다", () => {
    const c = atConfirming();
    const r = run(c.state, { type: "USER_TURN_END", text: "네, 괜찮아요", transcribed: true });
    expect(r.state.phase).toBe("thinking");
    expect(r.state.consentText).toBe("네, 괜찮아요");
    expect(canRegister(r.state, "model")).toBe(true);
    const done = run(r.state, { type: "TURN_RESULT", reply: "", status: "done", slots: SLOTS });
    expect(done.state.phase).toBe("registering");
  });
  it("'괜찮아요' 혼자나 '아니요 괜찮아요'는 접수가 아니다", () => {
    for (const text of ["괜찮아요", "아니요 괜찮아요", "됐어요"]) {
      const r = run(atConfirming().state, { type: "USER_TURN_END", text, transcribed: true });
      expect(r.state.phase, text).toBe("thinking");
      expect(canRegister(r.state, "model"), text).toBe(false);
    }
  });
  it("끝내고 싶다는 말('그만', '끝내 줘', '끝내고 싶어')에는 끝내지 않고 끝내는 말을 알려 준다. AI에게 보내지 않고, 읽고 나면 차례를 다시 연다", () => {
    for (const said of ["그만", "끝내 줘", "끝내고 싶어", "끝내고 싶어요", "그만할래요"]) {
      const guide = run(atArmed().state, { type: "USER_TURN_END", text: said, transcribed: true });
      expect(guide.state.ask, said).toBeNull();
      expect(guide.state.phase, said).toBe("listening");
      expect(spoken(guide.effects), said).toEqual(["endGuide"]);
      expect(types(guide.effects), said).not.toContain("ENGINE_RESPOND");
      expect(guide.state.mic, said).toBe("off");
      expect(types(run(guide.state, speakEnd(guide.state)).effects), said).toContain("OPEN_TURN");
    }
  });
  it("안내 뒤 '끝내기'라고 하면 끝낸다. 다른 말이면 AI에게 보낸다", () => {
    const guide = run(atArmed().state, { type: "USER_TURN_END", text: "그만", transcribed: true });
    const open = run(run(guide.state, speakEnd(guide.state)).state, { type: "LISTEN_STARTED", late: false });
    expect(run(open.state, { type: "USER_TURN_END", text: "끝내기", transcribed: true }).state.phase).toBe("ended");
    const other = run(open.state, { type: "USER_TURN_END", text: "전기밥솥 찾아 주세요", transcribed: true });
    expect(other.state.phase).toBe("thinking");
    expect(other.state.ask).toBeNull();
  });
  it("'끝내기'라고 하면 되묻지 않고 바로 끝내고, 상품 요청 화면으로 돌아간다는 마침 안내를 읽는다. 단추로 끝내면 예전 안내 그대로다", () => {
    const home = new Set(["endedHome", "endedHomeRegistered", "endedHomeUnsent"]);
    for (const said of ["끝내기", "끝내기요"]) {
      const end = run(atArmed().state, { type: "USER_TURN_END", text: said, transcribed: true });
      expect(end.state.phase, said).toBe("ended");
      expect(home.has(end.state.speaking as string), said).toBe(true);
    }
    const button = run(atArmed().state, { type: "EXIT" });
    expect(button.state.phase).toBe("ended");
    expect(home.has(button.state.speaking as string)).toBe(false);
  });
  it("'멈춰 줘'라고 하면 멈춘다", () => {
    const r = run(atArmed().state, { type: "USER_TURN_END", text: "멈춰 줘", transcribed: true });
    expect(r.state.phase).toBe("paused");
    expect(spoken(r.effects)).toEqual(["pausedByUser"]);
  });
  it("확인 상태에서 끝내고 싶다는 말을 하면 끝내는 말을 알려 주고 확인 상태에 그대로 있다. '끝내기'면 끝낸다", () => {
    const c = atConfirming();
    const guide = run(c.state, { type: "USER_TURN_END", text: "그만", transcribed: true });
    expect(guide.state.phase).toBe("confirming");
    expect(spoken(guide.effects)).toEqual(["endGuide"]);
    // 안내 뒤에 요약과 "보낼까요?"를 다시 읽는다. 그 뒤의 "네"는 방금 다시 들은 요약에 대한 동의다.
    expect(ofType(guide.effects, "SPEAK")[0].text).toBe(`${script("endGuide")} ${CONFIRM}`);
    const open = run(run(guide.state, speakEnd(guide.state)).state, { type: "LISTEN_STARTED", late: false });
    expect(open.state.phase).toBe("confirming");
    expect(run(open.state, { type: "USER_TURN_END", text: "끝내기", transcribed: true }).state.phase).toBe("ended");
  });
  it("확인 상태의 침묵 힌트는 두 번 모두 짧은 안내(confirmHint)다", () => {
    const a = run(atConfirming().state, { type: "LISTEN_STARTED", late: false });
    const first = run(a.state, timer("silence"));
    const reopened = run(first.state, speakEnd(first.state), { type: "LISTEN_STARTED", late: false });
    const second = run(reopened.state, timer("silence"));
    expect(spoken(first.effects)).toEqual(["confirmHint"]);
    expect(spoken(second.effects)).toEqual(["confirmHint"]);
  });
});

describe("글자 모드 끼어들기와 받지 못한 입력(A8·A18)", () => {
  const textSpeaking = () => {
    const t = atThinking("전기밥솥", { speechAvailable: false });
    return run(t.state, { type: "TURN_RESULT", reply: "어떤 정보가 궁금하세요?", status: "asking", slots: { ...SLOTS, info: "" } });
  };
  it("AI 말을 읽는 중의 TEXT_SUBMIT은 읽기를 끊고 그 글을 받는다", () => {
    const sp = textSpeaking();
    expect(sp.state.phase).toBe("speaking");
    expect(sp.state.inputMode).toBe("text");
    const r = run(sp.state, { type: "TEXT_SUBMIT", text: "흰색으로요" });
    expect(types(r.effects)).toEqual(expect.arrayContaining(["STOP_SPEAK", "ENGINE_CANCEL_RESPONSE"]));
    expect(r.state.phase).toBe("thinking");
    expect(ofType(r.effects, "ENGINE_RESPOND")[0].text).toBe("흰색으로요");
    expect(r.state.lastReply).toBe("어떤 정보가 궁금하세요?");
  });
  it("빈 글은 읽던 말을 끊지 않는다", () => {
    const sp = textSpeaking();
    const r = run(sp.state, { type: "TEXT_SUBMIT", text: "   " });
    expect(r.state.phase).toBe("speaking");
    expect(types(r.effects)).not.toContain("STOP_SPEAK");
  });
  it("요약을 읽는 중의 TEXT_SUBMIT '네'는 받지 않는다(동의 관문). 안 받았다는 신호음만 낸다", () => {
    const t = atThinking("전기밥솥", { speechAvailable: false });
    const sp = run(t.state, { type: "TURN_RESULT", reply: "", status: "confirming", slots: SLOTS });
    expect(sp.state.pendingConfirm).toBe(true);
    const r = run(sp.state, { type: "TEXT_SUBMIT", text: "네" });
    expect(r.state.phase).toBe("speaking");
    expect(r.effects).toEqual([{ type: "EARCON", name: "cancel" }]);
  });
  it("안내·연결·답 기다리는 중의 TEXT_SUBMIT은 받지 않고 신호음으로 알린다. 상태는 그대로", () => {
    const states = [
      run(mk({ speechAvailable: false }), { type: "START" }).state,
      atConnecting({ speechAvailable: false }).state,
      atThinking("전기밥솥", { speechAvailable: false }).state,
    ];
    for (const s of states) {
      const r = run(s, { type: "TEXT_SUBMIT", text: "흰색" });
      expect(r.effects, s.phase).toEqual([{ type: "EARCON", name: "cancel" }]);
      expect(r.state, s.phase).toEqual(s);
    }
    // 듣지 않는 상태(done 등)에서는 조용하다
    expect(run(atDone().state, { type: "TEXT_SUBMIT", text: "흰색" }).effects).toEqual([]);
  });
});

describe("대본 문구가 가리키는 것(A10·A27·A40)", () => {
  it("이미 한 번 다시 연결했으면 세션 예고는 '잠시 멈춘다'고 알린다. 처음 예고는 그대로", () => {
    expect(spoken(run(atArmed().state, { type: "SESSION_WARN" }).effects)).toEqual(["sessionWarn"]);
    const second = { ...atArmed().state, reconnects: 1 };
    const r = run(second, { type: "SESSION_WARN" });
    expect(spoken(r.effects)).toEqual(["sessionWarnLast"]);
    expect(script("sessionWarnLast")).toContain(`'${BUTTONS.continueTalk}'`);
    // 기다렸다 읽는 예고도 같은 대본이다
    const th = run({ ...atThinking().state, reconnects: 1 }, { type: "SESSION_WARN" });
    const ai = run(th.state, { type: "TURN_RESULT", reply: "어떤 정보가 궁금하세요?", status: "asking", slots: SLOTS });
    const end = run(ai.state, speakEnd(ai.state));
    expect(spoken(end.effects)).toEqual(["sessionWarnLast"]);
  });
});

// ---------------------------------------------------------------- 불변식(5.11절)

type Trace = { prev: LiveState; event: LiveEvent; next: LiveState; effects: LiveEffect[] };

const TIMERS: TimerId[] = [
  "micWait", "connect", "connectSay", "relisten", "silence", "controlHold", "waitSay1", "waitSay2",
  "think", "retryAfter", "speakGuard", "registerSay", "pausedWarn", "pausedEnd", "idleClose", "thinkGrace", "micSay",
];

function alphabet(s: LiveState): LiveEvent[] {
  const events: LiveEvent[] = [
    { type: "CONFIG", realtime: true }, { type: "CONFIG", realtime: false }, { type: "START" },
    { type: "READY", engine: "fallback", inputMode: "voice" }, { type: "READY", engine: "realtime", inputMode: "voice" },
    { type: "READY", engine: "fallback", inputMode: "text" },
    { type: "MIC_READY" }, { type: "MIC_DENIED" },
    { type: "LISTEN_STARTED", late: false }, { type: "LISTEN_STARTED", late: true },
    { type: "USER_SPEECH_START" }, { type: "NO_SPEECH" },
    { type: "USER_TURN_END", text: "전기밥솥", transcribed: true },
    { type: "USER_TURN_END", text: "네", transcribed: true },
    { type: "USER_TURN_END", text: "네?", transcribed: true },
    { type: "USER_TURN_END", text: "이대로 보내기 버튼", transcribed: true },
    { type: "USER_TURN_END", text: "", transcribed: true },
    { type: "USER_TURN_END", text: "", transcribed: false },
    { type: "USER_TURN_END", text: "도움말", transcribed: true },
    { type: "USER_TURN_END", text: "다시", transcribed: true },
    { type: "USER_TURN_END", text: "잠깐만", transcribed: true },
    { type: "USER_TURN_END", text: "그만", transcribed: true },
    { type: "USER_TURN_END", text: "천천히", transcribed: true },
    { type: "USER_TRANSCRIPT", text: "네 그렇게 보내 주시면 돼요", final: true },
    { type: "TURN_RESULT", reply: "무엇이 궁금하세요?", status: "asking", slots: SLOTS },
    { type: "TURN_RESULT", reply: "", status: "confirming", slots: SLOTS },
    { type: "TURN_RESULT", reply: "", status: "done", slots: SLOTS },
    { type: "TURN_RESULT", reply: "", status: "ended", slots: SLOTS },
    { type: "REPLY_START" }, { type: "REPLY_TEXT", text: "말", final: true }, { type: "REPLY_END" },
    { type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c" },
    { type: "INTENT", kind: "register", callId: "c" }, { type: "INTENT", kind: "end", callId: "c" },
    { type: "FAILED", kind: "rate_limited", retryAfterMs: 1000 }, { type: "FAILED", kind: "timeout" },
    { type: "FAILED", kind: "failed" }, { type: "FAILED", kind: "bad_request" }, { type: "FAILED", kind: "offline" },
    { type: "FAILED", kind: "unavailable_today" }, { type: "FAILED", kind: "mic_blocked" },
    { type: "FAILED", kind: "mic_denied" }, { type: "FAILED", kind: "connect_failed" },
    { type: "SESSION_WARN" },
    { type: "LOST", reason: "session_limit" }, { type: "LOST", reason: "network" },
    { type: "SPEAK_END", id: "stale" },
    { type: "MAIN_BUTTON" }, { type: "CONSENT_BUTTON" }, { type: "EDIT_BUTTON" }, { type: "REPEAT" },
    { type: "HELP" }, { type: "PAUSE" }, { type: "RESUME" }, { type: "RATE_BUTTON" }, { type: "EXIT" },
    { type: "CONTINUE" }, { type: "NEW_REQUEST", cid: "n" }, { type: "RETRY" },
    { type: "TEXT_SUBMIT", text: "네" }, { type: "TEXT_SUBMIT", text: "옵션은 검정" },
    { type: "HOLD_ACTIVATE" }, { type: "HOLD_SUBMIT" }, { type: "HOLD_CANCEL" }, { type: "CONTROL_TOUCH" },
    { type: "HIDDEN" }, { type: "VISIBLE" },
    { type: "REGISTER_BUSY" },
    { type: "REGISTER_OK", requestId: "r", queueNumber: 1, status: "queued" },
    { type: "REGISTER_FAIL", kind: "retryable" }, { type: "REGISTER_FAIL", kind: "unknown" },
    { type: "REGISTER_FAIL", kind: "rejected" }, { type: "REGISTER_FAIL", kind: "conflict" },
    ...TIMERS.map((id): LiveEvent => ({ type: "TIMER", id })),
  ];
  if (s.speaking !== null) events.push({ type: "SPEAK_END", id: s.speaking });
  return events;
}

const keyOf = (s: LiveState) =>
  JSON.stringify([
    s.phase, s.engine, s.engineReady, s.fallbackOnly, s.inputMode, s.speaking, s.mic, s.hidden, s.draft !== null,
    s.pendingConfirm, s.awaitingConsent, s.consentText !== null, s.pendingTurn !== null, s.ask, s.resumeTo,
    s.sessionWarnPending, s.silenceStep, s.silenceArmed, s.lateReopens, Math.min(s.aiFailures, 2), s.rateRetries,
    s.reconnects, s.sendPending, s.requestId !== null, s.resultUnspoken, s.settleNext, s.thinkFresh, s.micOnce,
    Math.min(s.micSays, 1),
  ]);

/** 시작 상태 몇 가지에서 너비 우선으로 도달 가능한 (상태, 사건) 쌍을 모은다. */
function explore(initial: LiveState, cap: number): Trace[] {
  const seen = new Set<string>([keyOf(initial)]);
  const queue: LiveState[] = [initial];
  const traces: Trace[] = [];
  while (queue.length > 0) {
    const prev = queue.shift() as LiveState;
    for (const event of alphabet(prev)) {
      const { state: next, effects } = liveStep(prev, event);
      traces.push({ prev, event, next, effects });
      const k = keyOf(next);
      if (!seen.has(k) && seen.size < cap) {
        seen.add(k);
        queue.push(next);
      }
    }
  }
  return traces;
}

const CONFIGS: Opts[] = [{}, { tts: false }, { speechAvailable: false }];
const allTraces: Trace[] = [];
const addTraces = (list: Trace[]) => {
  for (const t of list) allTraces.push(t);
};
for (const o of CONFIGS) addTraces(explore(mk(o), 2500));
// Realtime 힌트가 있는 시작
addTraces(explore({ ...mk(), realtimeHint: true }, 2500));

describe("5.11 불변식(도달 가능한 모든 상태 × 모든 사건)", () => {
  it("탐색이 충분히 넓다", () => {
    const phases = new Set(allTraces.map((t) => t.next.phase));
    for (const p of ["idle", "guiding", "connecting", "listening", "thinking", "speaking", "confirming", "registering", "done", "error", "paused", "ended"]) {
      expect(phases.has(p as never)).toBe(true);
    }
    expect(allTraces.length).toBeGreaterThan(5000);
  });
  it("1. OPEN_TURN과 RELISTEN은 도착 상태가 listening이나 confirming일 때만", () => {
    for (const t of allTraces) {
      if (t.effects.some((f) => f.type === "OPEN_TURN" || f.type === "RELISTEN")) {
        expect(["listening", "confirming"], JSON.stringify(t.event)).toContain(t.next.phase);
      }
    }
  });
  it("2. registered 대본과 SAVE_RECORD는 REGISTER_OK에서만", () => {
    for (const t of allTraces) {
      const hit = t.effects.some((f) => f.type === "SAVE_RECORD" || (f.type === "SPEAK" && f.id === "registered") || (f.type === "ANNOUNCE" && f.endId === "registered"));
      if (hit) expect(t.event.type).toBe("REGISTER_OK");
    }
  });
  it("3. EXIT는 idle·ended 말고 모두 ended로. done·error·ended로 들어가는 전이는 ENGINE_CLOSE와 RELEASE_MIC", () => {
    for (const t of allTraces) {
      if (t.event.type === "EXIT" && t.prev.phase !== "idle" && t.prev.phase !== "ended") {
        expect(t.next.phase, t.prev.phase).toBe("ended");
      }
      if (["done", "error", "ended"].includes(t.next.phase) && t.prev.phase !== t.next.phase) {
        expect(types(t.effects), `${t.prev.phase} ${t.event.type}`).toEqual(expect.arrayContaining(["ENGINE_CLOSE", "RELEASE_MIC"]));
      }
    }
  });
  it("5. 한 사건에 SPEAK와 ANNOUNCE가 함께 없다. alert는 tts가 거짓일 때만", () => {
    for (const t of allTraces) {
      const speaks = t.effects.some((f) => f.type === "SPEAK");
      const announces = t.effects.some((f) => f.type === "ANNOUNCE" && f.endId !== undefined);
      const alerts = t.effects.some((f) => f.type === "ANNOUNCE" && f.channel === "alert");
      if ((speaks && announces) || (alerts && t.prev.tts) || (speaks && !t.prev.tts)) {
        expect.fail(`${t.prev.phase} ${JSON.stringify(t.event)}`);
      }
    }
  });
  it("6. REGISTER는 canRegister가 참이고 sendPending이 거짓이고 requestId가 없을 때만", () => {
    let count = 0;
    for (const t of allTraces) {
      if (t.effects.some((f) => f.type === "REGISTER")) {
        count++;
        expect(t.prev.draft?.product.trim() ?? "").not.toBe("");
        expect(t.prev.awaitingConsent).toBe(true);
        expect(t.prev.sendPending).toBe(false);
        expect(t.prev.requestId).toBeNull();
        expect(t.next.phase).toBe("registering");
        expect(t.effects.filter((f) => f.type === "REGISTER")).toHaveLength(1);
      }
    }
    expect(count).toBeGreaterThan(0);
  });
  it("7. FOCUS는 SPEAK(또는 endId를 단 ANNOUNCE)와 같은 사건에 나오지 않는다", () => {
    for (const t of allTraces) {
      if (t.effects.some((f) => f.type === "FOCUS")) {
        expect(t.effects.some((f) => f.type === "SPEAK" || (f.type === "ANNOUNCE" && f.endId !== undefined)), `${t.prev.phase} ${t.event.type}`).toBe(false);
      }
    }
  });
  it("8. listening과 confirming 말고는 mic가 off", () => {
    for (const t of allTraces) {
      if (!["listening", "confirming"].includes(t.next.phase)) expect(t.next.mic, `${t.prev.phase} ${t.event.type}`).toBe("off");
    }
  }, 20_000);   // 거의 모든 전이를 하나씩 단언해 단독으로도 2초쯤 걸린다. 전체 시험을 함께 돌리면 기본 5초를 넘긴다(2026-11-24). 단언은 그대로다.
  it("9. mic가 held인 동안에는 TIMER 사건이 SPEAK를 내지 않는다", () => {
    let count = 0;
    for (const t of allTraces) {
      if (t.prev.mic === "held" && t.event.type === "TIMER") {
        count++;
        expect(t.effects.some((f) => f.type === "SPEAK" || (f.type === "ANNOUNCE" && f.endId !== undefined))).toBe(false);
      }
    }
    expect(count).toBeGreaterThan(0);
  });
  it("10. confirming에 있으면 awaitingConsent가 참이고 draft.product가 비어 있지 않다", () => {
    for (const t of allTraces) {
      if (t.next.phase === "confirming") {
        expect(t.next.awaitingConsent, `${t.prev.phase} ${t.event.type}`).toBe(true);
        expect(t.next.draft?.product.trim() ?? "").not.toBe("");
      }
    }
  });
  it("11. listening은 awaitingConsent가 거짓. 참은 confirming·thinking·speaking뿐", () => {
    for (const t of allTraces) {
      if (t.next.phase === "listening") expect(t.next.awaitingConsent, `${t.prev.phase} ${t.event.type}`).toBe(false);
      if (t.next.awaitingConsent) expect(["confirming", "thinking", "speaking"], `${t.prev.phase} ${t.event.type}`).toContain(t.next.phase);
    }
  });
  it("12. ENGINE_RESPOND의 history 마지막 칸은 이번 이용자 글이 아니다(이번 칸은 기록에 따로 있다)", () => {
    let count = 0;
    for (const t of allTraces) {
      for (const f of t.effects) {
        if (f.type !== "ENGINE_RESPOND" || f.text === "") continue;
        count++;
        const nextLast = t.next.history[t.next.history.length - 1];
        // 이번 이용자 칸은 다음 상태의 기록 끝에 있고, 보내는 history는 그 앞까지다.
        expect(nextLast, `${t.prev.phase} ${t.event.type}`).toEqual({ role: "user", content: cutText(f.text, 1000) });
        expect(f.history, `${t.prev.phase} ${t.event.type}`).toEqual(t.next.history.slice(0, -1));
      }
    }
    expect(count).toBeGreaterThan(0);
  });
  it("speaking은 SPEAK·ANNOUNCE의 id로 두고, 낡은 SPEAK_END는 상태를 바꾸지 않는다", () => {
    for (const t of allTraces) {
      if (t.event.type === "SPEAK_END" && t.event.id === "stale") {
        expect(t.next).toEqual(t.prev);
        expect(t.effects).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------- 불변식 4: 이용자 동작 없이 끝없이 도는 길이가 없다

interface Sim { state: LiveState; now: number; steps: number }
type Step = LiveEvent | ((s: LiveState) => LiveEvent);

/** 사건을 차례로 넣고 모든 효과와 마지막 사건의 효과를 돌려준다. */
function drive(start: LiveState, ...steps: Step[]): { state: LiveState; all: LiveEffect[]; last: LiveEffect[] } {
  let state = start;
  const all: LiveEffect[] = [];
  let last: LiveEffect[] = [];
  for (const step of steps) {
    const r = liveStep(state, typeof step === "function" ? step(state) : step);
    state = r.state;
    all.push(...r.effects);
    last = r.effects;
  }
  return { state, all, last };
}
const END = (s: LiveState): LiveEvent => speakEnd(s);
const TO_LISTENING: Step[] = [{ type: "CONFIG", realtime: false }, { type: "START" }, END, { type: "READY", engine: "fallback", inputMode: "voice" }];
const TO_THINKING: Step[] = [...TO_LISTENING, { type: "LISTEN_STARTED", late: false }, { type: "USER_TURN_END", text: "전기밥솥", transcribed: true }];
const TO_CONFIRMING: Step[] = [...TO_THINKING, { type: "TURN_RESULT", reply: "", status: "confirming", slots: SLOTS }, END];

/**
 * 가짜 환경: 읽기는 800ms, 인식은 450ms 뒤 시작하고 4초 조용하면 NO_SPEECH. 이용자는 아무것도 하지 않는다.
 * 타이머는 지금까지 모든 효과로 세우고, 읽기·인식 같은 일회성 사건은 마지막 사건의 효과로만 세운다.
 */
function simulate(d: { state: LiveState; all: LiveEffect[]; last: LiveEffect[] }, limitMs = 1_000_000): Sim {
  let state = d.state;
  let now = 0;
  let steps = 0;
  const timers = new Map<TimerId, number>();
  let queued: { at: number; event: LiveEvent }[] = [];
  const handle = (fx: LiveEffect, oneShot: boolean) => {
    switch (fx.type) {
      case "TIMER_SET": timers.set(fx.id, now + fx.ms); break;
      case "TIMER_CLEAR": timers.delete(fx.id); break;
      default: break;
    }
    if (!oneShot) return;
    switch (fx.type) {
      case "SPEAK": queued.push({ at: now + 800, event: { type: "SPEAK_END", id: fx.id } }); break;
      case "ANNOUNCE": if (fx.endId) queued.push({ at: now + 800, event: { type: "SPEAK_END", id: fx.endId } }); break;
      case "STOP_SPEAK": queued = queued.filter((q) => q.event.type !== "SPEAK_END"); break;
      case "OPEN_TURN": queued.push({ at: now + (fx.settle ? 1000 : 0) + 450, event: { type: "LISTEN_STARTED", late: false } }); break;
      case "RELISTEN": queued.push({ at: now + 50, event: { type: "LISTEN_STARTED", late: false } }); break;
      case "ENGINE_CANCEL_LISTEN": queued = queued.filter((q) => q.event.type !== "LISTEN_STARTED" && q.event.type !== "NO_SPEECH"); break;
      case "ENGINE_START": queued.push({ at: now + 50, event: { type: "READY", engine: "fallback", inputMode: "voice" } }); break;
      default: break;
    }
  };
  for (const fx of d.all) handle(fx, false);
  for (const fx of d.last) handle(fx, true);
  const apply = (event: LiveEvent) => {
    const r = liveStep(state, event);
    state = r.state;
    steps++;
    for (const fx of r.effects) handle(fx, true);
    if (event.type === "LISTEN_STARTED" && state.mic === "on") queued.push({ at: now + 4000, event: { type: "NO_SPEECH" } });
  };
  while (steps < 5000) {
    const candidates = [
      ...Array.from(timers).map(([id, at]) => ({ at, kind: "timer" as const, id: id as string })),
      ...queued.map((q, i) => ({ at: q.at, kind: "queued" as const, id: String(i) })),
    ].sort((a, b) => a.at - b.at);
    const next = candidates[0];
    if (!next || next.at > limitMs) break;
    now = next.at;
    if (next.kind === "timer") {
      timers.delete(next.id as TimerId);
      apply({ type: "TIMER", id: next.id as TimerId });
    } else {
      const q = queued.splice(Number(next.id), 1)[0];
      apply(q.event);
    }
  }
  return { state, now, steps };
}

describe("5.11 불변식 4: 끝없이 도는 길이가 없다", () => {
  it("아무 말 없이 듣기만 하면 침묵 → paused → 120초 → ended로 끝나고 시간과 단계가 유한하다", () => {
    const s = simulate(drive(mk(), ...TO_LISTENING));
    expect(s.state.phase).toBe("ended");
    expect(s.steps).toBeLessThan(500);
    expect(s.now).toBeLessThan(400_000);
    expect(s.now).toBeGreaterThan(60_000 + 120_000);
  });
  it("연결부터 아무 말 없이 두어도 끝난다", () => {
    const sim = simulate(drive(mk(), ...TO_LISTENING.slice(0, 3)));
    expect(sim.state.phase).toBe("ended");
  });
  it("확인 중에 아무 말 없이 두어도 끝난다. 돌아갈 곳은 confirming", () => {
    const sim = simulate(drive(mk(), ...TO_CONFIRMING));
    expect(sim.state.phase).toBe("ended");
    expect(sim.state.resumeTo).toBe("confirming");
  });
  it("답이 오지 않으면 timeout 뒤 listening으로 가서 결국 끝난다", () => {
    const sim = simulate(drive(mk(), ...TO_THINKING));
    expect(sim.state.phase).toBe("ended");
    expect(sim.state.aiFailures).toBe(1);
  });
  it("429 뒤 저절로 다시 보내는 것은 2회까지다", () => {
    let s = atThinking().state;
    let retries = 0;
    for (let i = 0; i < 5 && s.phase === "thinking"; i++) {
      const r = run(s, { type: "FAILED", kind: "rate_limited", retryAfterMs: 1000 });
      if (timerSet(r.effects, "retryAfter")) retries++;
      s = run(r.state, timer("retryAfter")).state;
    }
    expect(retries).toBe(2);
    expect(s.phase).toBe("listening");
  });
  it("허용 창 때문에 다시 여는 것은 2회까지다", () => {
    let s = atListening().state;
    let reopens = 0;
    for (let i = 0; i < 6; i++) {
      const r = run(s, { type: "LISTEN_STARTED", late: true });
      if (r.effects.some((f) => f.type === "OPEN_TURN")) reopens++;
      s = r.state;
    }
    expect(reopens).toBe(2);
  });
});

type ScriptName = Parameters<typeof script>[0];

// Codex 3차 지적 4: 낭독 오류를 "요약을 들었다"로 처리하면 안 된다.
describe("기기 목소리가 읽지 못했을 때", () => {
  const speakFailed = (s: LiveState): LiveEvent => ({ type: "SPEAK_END", id: s.speaking as string, failed: true });

  it("확인 요약 낭독이 실패하면 동의 관문을 열지 않고 한 번 더 읽는다", () => {
    const a = atSpeakingConfirm();
    expect(a.state.speaking).toBe("confirm");
    const b = run(a.state, speakFailed(a.state));
    expect(b.state.phase).toBe("speaking");
    expect(b.state.awaitingConsent).toBe(false);
    expect(ofType(b.effects, "SPEAK").map((f) => [f.id, f.text])).toEqual([["confirm", CONFIRM]]);
    expect(types(b.effects)).not.toContain("OPEN_TURN");
    expect(canRegister(b.state, "speech", "네")).toBe(false);
    expect(canRegister(b.state, "button")).toBe(false);
  });

  it("다시 읽기가 성공하면 평소대로 관문을 연다", () => {
    const a = atSpeakingConfirm();
    const b = run(a.state, speakFailed(a.state));
    const c = run(b.state, speakEnd(b.state));
    expect(c.state.phase).toBe("confirming");
    expect(c.state.awaitingConsent).toBe(true);
    expect(types(c.effects)).toContain("OPEN_TURN");
  });

  it("다시 읽기도 실패하면 취소음과 화면 낭독기 알림으로 요약을 전하고, 그 알림이 끝난 뒤에야 관문을 연다", () => {
    const a = atSpeakingConfirm();
    const b = run(a.state, speakFailed(a.state));
    const c = run(b.state, speakFailed(b.state));
    expect(c.state.phase).toBe("speaking");
    expect(c.state.awaitingConsent).toBe(false);
    expect(spoken(c.effects)).toEqual([]);
    expect(ofType(c.effects, "EARCON").map((f) => f.name)).toEqual(["cancel"]);
    expect(ofType(c.effects, "ANNOUNCE")).toEqual([{ type: "ANNOUNCE", channel: "status", text: CONFIRM, endId: "confirm" }]);
    expect(types(c.effects)).not.toContain("OPEN_TURN");
    // 알림으로 전하는 중에 실패 신호가 또 와도 관문을 열지 않는다.
    const stray = run(c.state, speakFailed(c.state));
    expect(stray.state.phase).toBe("speaking");
    expect(stray.state.awaitingConsent).toBe(false);
    expect(stray.effects).toEqual([]);
    // 알림이 끝나면(실패 아님) 확인 상태로 가고 차례가 열린다.
    const d = run(stray.state, speakEnd(stray.state));
    expect(d.state.phase).toBe("confirming");
    expect(d.state.awaitingConsent).toBe(true);
    expect(types(d.effects)).toContain("OPEN_TURN");
  });

  it("다른 글(첫 안내)은 다시 읽지 않고 알림으로 전한 뒤 이어 간다", () => {
    const r = run(mk(), { type: "CONFIG", realtime: false }, { type: "START" });
    expect(r.state.phase).toBe("guiding");
    const id = r.state.speaking as string;
    const text = ofType(r.effects, "SPEAK").at(-1)?.text ?? "";
    expect(text).not.toBe("");
    const b = run(r.state, speakFailed(r.state));
    expect(b.state.phase).toBe("guiding");
    expect(spoken(b.effects)).toEqual([]);
    expect(ofType(b.effects, "EARCON").map((f) => f.name)).toEqual(["cancel"]);
    expect(ofType(b.effects, "ANNOUNCE")).toEqual([{ type: "ANNOUNCE", channel: "status", text, endId: id }]);
    const c = run(b.state, speakEnd(b.state));
    expect(c.state.phase).toBe("connecting");
  });

  it("끊은 뒤에 온 실패 신호는 버린다", () => {
    const a = atSpeakingConfirm();
    const stale: LiveEvent = { type: "SPEAK_END", id: "guideFirstVoice", failed: true };
    const b = run(a.state, stale);
    expect(b.effects).toEqual([]);
    expect(b.state.speaking).toBe("confirm");
  });
});
