// /live 실행기 시험: 설계서 14절, 9절(차례 열기 순서), 5.4절(같은 호출 스택), 16.1절 liveRunner 항목.
// 가짜 엔진·읽기·신호음·손으로 돌리는 타이머를 쓴다. 유료 호출과 바깥 통신은 0건이다.
import { describe, expect, it, vi } from "vitest";
import type {
  EarconName,
  EngineEvent,
  EngineKind,
  EngineStartContext,
  LiveEngine,
  LiveSlots,
  LiveTurn,
} from "@/lib/liveEngine";
import { earconDurationMs } from "@/lib/liveEarcons";
import { createLiveRunner, type LiveRunner, type LiveRunnerDeps } from "@/lib/liveRunner";
import { createInitialLive, type LiveState } from "@/lib/liveMachine";
import { LIVE_RECORDS_KEY, type LiveRequestBody, type RegisterResult } from "@/lib/liveRequest";
import { LIVE_VISITS_KEY, script } from "@/lib/liveScripts";
import { EARCON_TO_MIC_MS, MIC_SETTLE_MS } from "@/lib/liveTiming";

// ---------------------------------------------------------------- 도우미

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

/** 손으로 시간을 돌리는 타이머. advance는 기한이 된 타이머를 순서대로 실행하고 사이사이 약속을 비운다. */
function makeTimers() {
  let now = 0;
  let seq = 0;
  const items = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn: () => void, ms: number): unknown {
      seq += 1;
      items.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear(handle: unknown) {
      items.delete(handle as number);
    },
    get pending() {
      return items.size;
    },
    async advance(ms: number) {
      await flush(); // 앞에서 풀린 약속이 거는 타이머를 먼저 건다(실제로는 곧바로 걸린다)
      const target = now + ms;
      for (;;) {
        let nextId = -1;
        let nextAt = Infinity;
        for (const [id, it] of items) {
          if (it.at <= target && it.at < nextAt) {
            nextAt = it.at;
            nextId = id;
          }
        }
        if (nextId < 0) break;
        const it = items.get(nextId)!;
        items.delete(nextId);
        now = Math.max(now, it.at);
        it.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

class FakeEngine implements LiveEngine {
  calls: string[] = [];
  listens: { keep?: boolean }[] = [];
  responds: { text: string; history: LiveTurn[] }[] = [];
  toolResults: { callId: string; output: object; respond: boolean }[] = [];
  closed = 0;
  ctx: EngineStartContext | undefined;
  private listener: ((e: EngineEvent) => void) | undefined;
  constructor(readonly kind: EngineKind) {}
  start(ctx: EngineStartContext) {
    this.calls.push("start");
    this.ctx = ctx;
    return Promise.resolve();
  }
  listen(opts?: { keep?: boolean }) {
    this.calls.push("listen");
    this.listens.push(opts ?? {});
  }
  hold() { this.calls.push("hold"); }
  submit() { this.calls.push("submit"); }
  cancelListen(discard: boolean) { this.calls.push(`cancelListen:${discard}`); }
  respond(turn: { text: string; source: "voice" | "text" }, history: LiveTurn[]) {
    this.calls.push("respond");
    this.responds.push({ text: turn.text, history });
  }
  cancelResponse() { this.calls.push("cancelResponse"); }
  toolResult(callId: string, output: object, respond: boolean) {
    this.calls.push("toolResult");
    this.toolResults.push({ callId, output, respond });
  }
  setRate(rate: "slow" | "normal" | "fast") { this.calls.push(`rate:${rate}`); }
  close() { this.closed += 1; }
  on(l: (e: EngineEvent) => void) {
    this.listener = l;
    return () => { this.listener = undefined; };
  }
  emit(e: EngineEvent) { this.listener?.(e); }
}

function fakeStream() {
  const track = { stopped: 0, stop() { this.stopped += 1; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

interface Harness {
  runner: LiveRunner;
  engines: FakeEngine[];
  timers: ReturnType<typeof makeTimers>;
  calls: string[];                 // 부른 순서(신호음, 펄스, 읽기)
  played: EarconName[];
  spoken: { id: string; text: string }[];
  finishSpeak(failed?: boolean): void;
  announced: { channel: string; text: string }[];
  rates: string[];
  streamRequests: ((s: MediaStream | undefined) => void)[];
  registerCalls: { body: LiveRequestBody; onBusy?: () => void }[];
  resolveRegister(r: RegisterResult): Promise<void>;
  pushes: string[];
  storage: Storage;
  wake: boolean[];
  focuses: string[];
  state(): LiveState;
}

function harness(opts: { tts?: boolean; instantSpeak?: boolean } = {}): Harness {
  const timers = makeTimers();
  const engines: FakeEngine[] = [];
  const calls: string[] = [];
  const played: EarconName[] = [];
  const spoken: { id: string; text: string }[] = [];
  const announced: { channel: string; text: string }[] = [];
  const rates: string[] = [];
  const streamRequests: ((s: MediaStream | undefined) => void)[] = [];
  const registerCalls: Harness["registerCalls"] = [];
  const registerResolvers: ((r: RegisterResult) => void)[] = [];
  const pushes: string[] = [];
  const wake: boolean[] = [];
  const focuses: string[] = [];
  const storage = fakeStorage();
  let endSpeak: ((failed?: boolean) => void) | null = null;

  const deps: LiveRunnerDeps = {
    createEngine(kind) {
      const e = new FakeEngine(kind);
      engines.push(e);
      return e;
    },
    speaker: {
      available: true,
      speak(id, text, onEnd) {
        calls.push(`speak:${id}`);
        spoken.push({ id, text });
        if (opts.instantSpeak) onEnd(id);
        else endSpeak = (failed) => onEnd(id, failed);
      },
      stop() { calls.push("stopSpeak"); endSpeak = null; },
      setRate(r) { rates.push(r); },
    },
    earcons: {
      unlock() {},
      play(name) {
        calls.push(`play:${name}`);
        played.push(name);
        return Promise.resolve();
      },
      startWait() { calls.push("startWait"); },
      stopWait() { calls.push("stopWait"); },
    },
    timers: { set: (fn, ms) => timers.set(fn, ms), clear: (h) => timers.clear(h) },
    registerLive: ((body: LiveRequestBody, d: { onBusy?: () => void }) => {
      registerCalls.push({ body, onBusy: d.onBusy });
      return new Promise<RegisterResult>((resolve) => { registerResolvers.push(resolve); });
    }) as LiveRunnerDeps["registerLive"],
    deviceReady: Promise.resolve(),
    storage,
    requestStream: () => new Promise((resolve) => { streamRequests.push(resolve); }),
    setAudioSession() {},
    announce(channel, text) { announced.push({ channel, text }); },
    focus(target) { focuses.push(target); },
    wakeLock(on) { wake.push(on); },
    waitSoundOn: () => true,
    attachPush(id) { pushes.push(id); },
  };
  const initial = createInitialLive({
    cid: "cid-1", visit: "first", tts: opts.tts ?? true, speechAvailable: true,
  });
  const runner = createLiveRunner(deps, initial);
  return {
    runner, engines, timers, calls, played, spoken, announced, rates, streamRequests, registerCalls, pushes,
    storage, wake, focuses,
    finishSpeak(failed) { const f = endSpeak; endSpeak = null; f?.(failed); },
    async resolveRegister(r) { registerResolvers.shift()?.(r); await flush(); },
    state: () => runner.getState(),
  };
}

const SLOTS: LiveSlots = { product: "전기밥솥", info: "할인 혜택", options: "", budget: "" };

/** fallback으로 연결해 listening까지 간다. */
function reachListening(h: Harness): FakeEngine {
  h.runner.dispatch({ type: "START" });
  h.finishSpeak();
  const engine = h.engines[0];
  engine.emit({ type: "READY", engine: "fallback", inputMode: "voice" });
  return engine;
}

/** fallback으로 확인 단계(confirming, 동의 대기)까지 간다. */
function reachConfirming(h: Harness): FakeEngine {
  const engine = reachListening(h);
  engine.emit({ type: "USER_TURN_END", text: "전기밥솥 알려줘", transcribed: true });
  engine.emit({ type: "TURN_RESULT", reply: "확인해요", status: "confirming", slots: SLOTS });
  h.finishSpeak();
  return engine;
}

/** Realtime으로 연결해 listening까지 간다. */
async function reachRealtimeListening(h: Harness) {
  h.runner.dispatch({ type: "CONFIG", realtime: true });
  h.runner.dispatch({ type: "START" });
  h.finishSpeak();
  const { stream, track } = fakeStream();
  h.streamRequests[0](stream);
  await flush();
  const engine = h.engines[0];
  engine.emit({ type: "READY", engine: "realtime", inputMode: "voice" });
  return { engine, stream, track };
}

// ---------------------------------------------------------------- 시험

describe("실행기: 같은 호출 스택과 사건 순서", () => {
  it("START의 SPEAK가 dispatch 안에서 바로 speaker.speak를 부른다", () => {
    const h = harness();
    h.runner.dispatch({ type: "START" });
    // 약속이나 타이머를 기다리지 않은 시점이다.
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0].text).toContain("띵 소리가 나면");
    expect(h.wake).toEqual([true]);
    expect(h.state().phase).toBe("guiding");
  });

  it("읽기가 바로 끝나는 가짜(재귀 dispatch)여도 순서대로 이어 간다", () => {
    const h = harness({ instantSpeak: true });
    h.runner.dispatch({ type: "START" });
    expect(h.state().phase).toBe("connecting");
    expect(h.engines).toHaveLength(1);
    expect(h.engines[0].kind).toBe("fallback");
    expect(h.storage.getItem(LIVE_VISITS_KEY)).toBe("1");
  });

  it("구독자는 사건마다 알림을 받고, dispose 뒤에는 dispatch가 아무 일도 하지 않는다", () => {
    const h = harness();
    const seen = vi.fn();
    h.runner.subscribe(seen);
    h.runner.dispatch({ type: "START" });
    expect(seen).toHaveBeenCalled();
    h.runner.dispose();
    const before = h.state();
    h.runner.dispatch({ type: "PAUSE" });
    expect(h.state()).toBe(before);
  });

  it("자막: 받아 적은 글과 AI 말의 글을 getCaption으로 돌려준다", () => {
    const h = harness();
    const engine = reachListening(h);
    engine.emit({ type: "USER_TRANSCRIPT", text: "전기", final: false });
    expect(h.runner.getCaption().user).toBe("전기");
    engine.emit({ type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    engine.emit({ type: "REPLY_TEXT", text: "어떤 정보가 궁금하세요", final: false });
    expect(h.runner.getCaption().ai).toBe("어떤 정보가 궁금하세요");
  });
});

describe("실행기: 차례 열기 순서(9절)", () => {
  it("뜸 없는 차례: 신호음 → 150ms 뒤 listen이고 실행기는 침묵 타이머를 걸지 않는다", async () => {
    const h = harness();
    const engine = reachListening(h);
    expect(h.played).toEqual(["turn"]);
    expect(engine.listens).toHaveLength(0);
    const wait = earconDurationMs("turn") + EARCON_TO_MIC_MS;
    await h.timers.advance(wait - 1);
    expect(engine.listens).toHaveLength(0);
    await h.timers.advance(1);
    expect(engine.listens).toEqual([{ keep: false }]);
    // LISTEN_STARTED가 없으면 침묵 힌트도 없다(타이머는 상태 기계가 건다).
    await h.timers.advance(30_000);
    expect(h.spoken.some((s) => s.id === "silence1")).toBe(false);
  });

  it("뜸 있는 차례(안내를 단추로 건너뜀): 1000ms 뒤 신호음 → 270ms 뒤 listen", async () => {
    const h = harness();
    h.runner.dispatch({ type: "START" });
    h.runner.dispatch({ type: "MAIN_BUTTON" });
    const engine = h.engines[0];
    engine.emit({ type: "READY", engine: "fallback", inputMode: "voice" });
    expect(h.played).toEqual([]);
    await h.timers.advance(MIC_SETTLE_MS - 1);
    expect(h.played).toEqual([]);
    await h.timers.advance(1);
    expect(h.played).toEqual(["turn"]);
    await h.timers.advance(earconDurationMs("turn") + EARCON_TO_MIC_MS);
    expect(engine.listens).toEqual([{ keep: false }]);
    // 신호음이 listen보다 앞이다.
    const order = h.calls.filter((c) => c.startsWith("play:"));
    expect(order).toEqual(["play:turn"]);
  });

  it("기다리는 사이 취소(ENGINE_CANCEL_LISTEN)되면 listen을 열지 않는다", async () => {
    const h = harness();
    const engine = reachListening(h);
    h.runner.dispatch({ type: "CONTROL_TOUCH" }); // mic on → held: ENGINE_HOLD가 기다림을 끊는다
    await h.timers.advance(1_000);
    expect(engine.listens).toHaveLength(0);
    expect(engine.calls).toContain("hold");
  });

  it("띵 전의 뜸 사이에 [말하기]를 다시 눌러도 신호음이 취소되지 않고 띵 뒤에 듣기가 열린다(A14)", async () => {
    const h = harness();
    h.runner.dispatch({ type: "START" });
    h.runner.dispatch({ type: "MAIN_BUTTON" });
    const engine = h.engines[0];
    engine.emit({ type: "READY", engine: "fallback", inputMode: "voice" });
    await h.timers.advance(500);
    h.runner.dispatch({ type: "MAIN_BUTTON" });   // 뜸 사이의 두 번째 누름(상태 기계는 ENGINE_SUBMIT을 낸다)
    expect(engine.calls).not.toContain("submit");
    await h.timers.advance(MIC_SETTLE_MS - 500);
    expect(h.played).toEqual(["turn"]);
    await h.timers.advance(earconDurationMs("turn") + EARCON_TO_MIC_MS);
    expect(engine.listens).toEqual([{ keep: false }]);
    expect(engine.calls).not.toContain("submit");
  });

  it("신호음을 재생하는 사이의 누름도 버리고, 듣기가 열린 뒤의 누름은 보낸다(A14)", async () => {
    const h = harness();
    const engine = reachListening(h);
    expect(h.played).toEqual(["turn"]);
    h.runner.dispatch({ type: "HOLD_SUBMIT" });   // 뜸 없는 차례: 신호음은 이미 시작됐고 마이크는 아직 닫혀 있다
    expect(engine.calls).not.toContain("submit");
    await h.timers.advance(earconDurationMs("turn") + EARCON_TO_MIC_MS);
    expect(engine.listens).toEqual([{ keep: false }]);
    h.runner.dispatch({ type: "MAIN_BUTTON" });
    expect(engine.calls).toContain("submit");
  });

  it("Realtime도 뜸 사이의 누름을 버리고 띵 뒤에 듣기를 연다(A14)", async () => {
    const h = harness();
    const { engine } = await reachRealtimeListening(h);
    await h.timers.advance(500);
    h.runner.dispatch({ type: "MAIN_BUTTON" });
    expect(engine.calls).not.toContain("submit");
    await h.timers.advance(MIC_SETTLE_MS - 500 + earconDurationMs("turn") + EARCON_TO_MIC_MS);
    expect(h.played.filter((p) => p === "turn")).toHaveLength(1);
    expect(engine.listens).toEqual([{ keep: false }]);
    expect(engine.calls).not.toContain("submit");
  });

  it("차례를 취소(HOLD_CANCEL로 다시 열기)해도 열기 플래그가 남지 않아 다음 보내기가 막히지 않는다(A14)", async () => {
    const h = harness();
    const engine = reachListening(h);
    await h.timers.advance(earconDurationMs("turn") + EARCON_TO_MIC_MS);
    engine.emit({ type: "LISTEN_STARTED", late: false });
    h.runner.dispatch({ type: "HOLD_CANCEL" });     // 듣기를 버리고 새 차례를 연다(열기 시작)
    h.runner.dispatch({ type: "CONTROL_TOUCH" });   // 열기 도중 ENGINE_HOLD가 열기를 끊는다
    expect(engine.calls).toContain("hold");
    await h.timers.advance(4_000 + earconDurationMs("turn") + EARCON_TO_MIC_MS);   // controlHold가 keep으로 다시 연다
    expect(engine.listens).toHaveLength(2);
    h.runner.dispatch({ type: "MAIN_BUTTON" });
    expect(engine.calls.filter((c) => c === "submit")).toHaveLength(1);
  });

  it("RELISTEN은 신호음 없이 listen({keep:true})만 한다", async () => {
    const h = harness();
    const engine = reachListening(h);
    await h.timers.advance(earconDurationMs("turn") + EARCON_TO_MIC_MS);
    engine.emit({ type: "LISTEN_STARTED", late: false });
    const playedBefore = h.played.length;
    engine.emit({ type: "NO_SPEECH" });
    await h.timers.advance(300);
    expect(engine.listens).toEqual([{ keep: false }, { keep: true }]);
    expect(h.played).toHaveLength(playedBefore);
  });
});

describe("실행기: Realtime 시작과 세대 번호", () => {
  it("스트림이 풀린 뒤에야 엔진을 만들고, 그 스트림으로 start한다", async () => {
    const h = harness();
    h.runner.dispatch({ type: "CONFIG", realtime: true });
    h.runner.dispatch({ type: "START" });
    h.finishSpeak();
    expect(h.streamRequests).toHaveLength(1);
    expect(h.engines).toHaveLength(0);
    const { stream } = fakeStream();
    h.streamRequests[0](stream);
    await flush();
    expect(h.engines).toHaveLength(1);
    expect(h.engines[0].kind).toBe("realtime");
    expect(h.engines[0].ctx?.stream).toBe(stream);
    expect(h.engines[0].ctx?.cid).toBe("cid-1");
    expect(h.state().phase).toBe("connecting");
  });

  it("requestStream이 undefined면 MIC_DENIED로 fallback이 된다", async () => {
    const h = harness();
    h.runner.dispatch({ type: "CONFIG", realtime: true });
    h.runner.dispatch({ type: "START" });
    h.finishSpeak();
    h.streamRequests[0](undefined);
    await flush();
    expect(h.state().fallbackOnly).toBe(true);
    expect(h.engines.map((e) => e.kind)).toEqual(["fallback"]);
  });

  it("허용 창이 오래 걸려 세대가 바뀐 뒤 늦게 받은 스트림은 바로 놓는다", async () => {
    const h = harness();
    h.runner.dispatch({ type: "CONFIG", realtime: true });
    h.runner.dispatch({ type: "START" });
    h.finishSpeak();
    await h.timers.advance(60_000); // micWait 시간 초과 → fallback
    expect(h.engines.map((e) => e.kind)).toEqual(["fallback"]);
    const { stream, track } = fakeStream();
    h.streamRequests[0](stream);
    await flush();
    expect(track.stopped).toBeGreaterThan(0);
    expect(h.engines).toHaveLength(1); // Realtime 엔진은 만들지 않았다
  });

  it("연결 시간 초과 뒤 늦게 온 READY는 버리고 그 엔진을 닫고 스트림을 놓는다", async () => {
    const h = harness();
    h.runner.dispatch({ type: "CONFIG", realtime: true });
    h.runner.dispatch({ type: "START" });
    h.finishSpeak();
    const { stream, track } = fakeStream();
    h.streamRequests[0](stream);
    await flush();
    const late = h.engines[0];
    await h.timers.advance(12_000); // connect 시간 초과 → fallback으로 바꿈
    expect(h.state().fallbackOnly).toBe(true);
    expect(h.engines.map((e) => e.kind)).toEqual(["realtime", "fallback"]);
    const closedBefore = late.closed;
    late.emit({ type: "READY", engine: "realtime", inputMode: "voice" });
    expect(h.state().engine).not.toBe("realtime");
    expect(late.closed).toBeGreaterThan(closedBefore);
    expect(track.stopped).toBeGreaterThan(0);
  });
});

describe("실행기: 읽기, 알림, 펄스", () => {
  it("tts가 없으면 ANNOUNCE의 endId로 글자 수 × 250 + 1000ms 뒤 SPEAK_END를 넣는다", async () => {
    const h = harness({ tts: false });
    h.runner.dispatch({ type: "START" });
    const first = h.announced[0];
    expect(first.channel).toBe("status");
    const ms = first.text.length * 250 + 1000;
    await h.timers.advance(ms - 1);
    expect(h.state().phase).toBe("guiding");
    await h.timers.advance(1);
    expect(h.state().phase).toBe("connecting");
    expect(h.spoken).toHaveLength(0);
  });

  it("대기 펄스는 앱이 말하는 동안 쉬고 읽기가 끝나면 다시 켠다", async () => {
    const h = harness();
    const engine = reachListening(h);
    engine.emit({ type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
    expect(h.state().phase).toBe("thinking");
    expect(h.calls).toContain("startWait");
    expect(engine.responds).toHaveLength(1);
    expect(engine.responds[0].text).toBe("전기밥솥");
    // 이번 말은 history에 없다(불변식 12).
    expect(engine.responds[0].history.every((t) => !t.content.includes("전기밥솥"))).toBe(true);
    await h.timers.advance(4_000); // waitSay1
    expect(h.spoken[h.spoken.length - 1].text).toBe(script("waiting1"));
    const afterSpeak = h.calls.length;
    expect(h.calls.slice(0, afterSpeak).lastIndexOf("stopWait")).toBeGreaterThan(h.calls.lastIndexOf("startWait"));
    h.finishSpeak();
    expect(h.calls.slice(afterSpeak)).toContain("startWait");
  });

  it("빠르기가 바뀌면 읽어 주기에도 알린다", () => {
    const h = harness();
    const engine = reachListening(h);
    h.runner.dispatch({ type: "RATE_BUTTON" });
    expect(h.rates).toEqual(["slow"]);
    expect(engine.calls).toContain("rate:slow");
  });
});

describe("실행기: 접수", () => {
  it("REGISTER 성공 뒤에야 기기 기록을 저장하고, 결과는 접수 응답 뒤에 읽는다", async () => {
    const h = harness();
    reachConfirming(h);
    expect(h.state().phase).toBe("confirming");
    h.runner.dispatch({ type: "CONSENT_BUTTON" });
    expect(h.state().phase).toBe("registering");
    expect(h.registerCalls).toHaveLength(1);
    expect(h.registerCalls[0].body.clientRequestId).toBe("cid-1");
    expect(h.registerCalls[0].body.product).toBe("전기밥솥");
    expect(h.storage.getItem(LIVE_RECORDS_KEY)).toBeNull();
    const spokenBefore = h.spoken.length;
    await h.resolveRegister({ ok: true, requestId: "req-1", queueNumber: 3, status: "waiting" });
    expect(h.state().phase).toBe("done");
    expect(h.state().queueNumber).toBe(3);
    const saved = JSON.parse(h.storage.getItem(LIVE_RECORDS_KEY) ?? "[]") as { requestId: string; cid: string }[];
    expect(saved[0]).toMatchObject({ requestId: "req-1", cid: "cid-1" });
    expect(h.pushes).toEqual(["req-1"]);
    expect(h.spoken.length).toBe(spokenBefore + 1);
    expect(h.spoken[h.spoken.length - 1].id).toBe("registered");
  });

  it("접수가 429를 받으면 onBusy가 REGISTER_BUSY를 넣어 안내를 읽는다", async () => {
    const h = harness();
    reachConfirming(h);
    h.runner.dispatch({ type: "CONSENT_BUTTON" });
    h.registerCalls[0].onBusy?.();
    expect(h.spoken[h.spoken.length - 1].id).toBe("registerBusy");
    await h.resolveRegister({ ok: false, kind: "retryable" });
    expect(h.state().phase).toBe("confirming");
    expect(h.storage.getItem(LIVE_RECORDS_KEY)).toBeNull();
  });

  it("dispose 뒤에도 접수 요청은 끊기지 않고 기록과 푸시만 남긴다", async () => {
    const h = harness();
    const engine = reachConfirming(h);
    h.runner.dispatch({ type: "CONSENT_BUTTON" });
    h.runner.dispose();
    expect(engine.closed).toBeGreaterThan(0);
    expect(h.timers.pending).toBe(0);
    await h.resolveRegister({ ok: true, requestId: "req-9", queueNumber: 1, status: "waiting" });
    const saved = JSON.parse(h.storage.getItem(LIVE_RECORDS_KEY) ?? "[]") as { requestId: string }[];
    expect(saved[0].requestId).toBe("req-9");
    expect(h.pushes).toEqual(["req-9"]);
    expect(h.state().phase).toBe("registering"); // 상태 기계에는 더 보내지 않는다
  });

  it("AI를 거치는 접수 한 바퀴: 확인 → 동의 말 → TURN_RESULT done → REGISTER", async () => {
    const h = harness();
    const engine = reachConfirming(h);
    // 분명한 동의가 아닌 말: 서버(AI)를 거친다.
    engine.emit({ type: "USER_TURN_END", text: "네 그렇게 보내 주시면 돼요", transcribed: true });
    expect(h.state().phase).toBe("thinking");
    expect(engine.responds.at(-1)?.text).toBe("네 그렇게 보내 주시면 돼요");
    expect(h.registerCalls).toHaveLength(0);
    engine.emit({ type: "TURN_RESULT", reply: "보낼게요", status: "done", slots: SLOTS });
    expect(h.state().phase).toBe("registering");
    expect(h.registerCalls).toHaveLength(1);
    await h.resolveRegister({ ok: true, requestId: "req-2", queueNumber: 2, status: "waiting" });
    expect(h.state().phase).toBe("done");
  });
});

describe("실행기: Realtime INTENT register 붙들기(14절)", () => {
  /** 확인 문장을 읽고 동의를 기다리는 confirming까지 간 뒤, 전사 없이 말이 끝난 상태(thinking)로 만든다. */
  async function reachWaitingTranscript(h: Harness) {
    const { engine } = await reachRealtimeListening(h);
    engine.emit({ type: "USER_TURN_END", text: "전기밥솥 알려줘", transcribed: true });
    engine.emit({ type: "INTENT", kind: "confirm", slots: SLOTS, callId: "c1" });
    engine.emit({ type: "REPLY_END" });
    h.finishSpeak(); // 확인 문장 읽기 끝 → confirming
    expect(h.state().phase).toBe("confirming");
    expect(h.state().awaitingConsent).toBe(true);
    engine.emit({ type: "USER_TURN_END", text: "", transcribed: false });
    expect(h.state().phase).toBe("thinking");
    expect(h.state().consentText).toBeNull();
    return engine;
  }

  it("전사가 오면 그 전사를 먼저 넘기고 붙든 INTENT를 이어서 넘긴다(그 사이 REPLY_END도 순서대로)", async () => {
    const h = harness();
    const engine = await reachWaitingTranscript(h);
    engine.emit({ type: "INTENT", kind: "register", callId: "c2" });
    engine.emit({ type: "REPLY_END" });
    expect(h.registerCalls).toHaveLength(0);
    expect(h.state().phase).toBe("thinking");
    engine.emit({ type: "USER_TRANSCRIPT", text: "네", final: true });
    expect(h.registerCalls).toHaveLength(1);
    expect(h.state().phase).toBe("registering");
  });

  it("전사가 끝내 안 오면 1.5초 뒤 넘기고, 동의 근거가 없으니 접수하지 않는다", async () => {
    const h = harness();
    const engine = await reachWaitingTranscript(h);
    engine.emit({ type: "INTENT", kind: "register", callId: "c2" });
    await h.timers.advance(1_499);
    expect(h.registerCalls).toHaveLength(0);
    expect(h.state().phase).toBe("thinking");
    await h.timers.advance(1);
    expect(h.registerCalls).toHaveLength(0);
    expect(h.state().phase).not.toBe("registering");
    // need_consent를 도구 결과로 돌려준다.
    expect(engine.toolResults.at(-1)).toMatchObject({ callId: "c2", output: { ok: false } });
  });
});

describe("실행기: 정리", () => {
  it("dispose는 타이머를 모두 지우고 엔진을 닫고 마이크를 놓는다", async () => {
    const h = harness();
    h.runner.dispatch({ type: "CONFIG", realtime: true });
    h.runner.dispatch({ type: "START" });
    h.finishSpeak();
    const { stream, track } = fakeStream();
    h.streamRequests[0](stream);
    await flush();
    expect(h.timers.pending).toBeGreaterThan(0);
    h.runner.dispose();
    expect(h.timers.pending).toBe(0);
    expect(h.engines[0].closed).toBeGreaterThan(0);
    expect(track.stopped).toBeGreaterThan(0);
    expect(h.wake.at(-1)).toBe(false);
  });
});

// Codex 3차 지적 4: 낭독 오류는 끝까지 읽은 것과 구별해 상태 기계에 전한다.
describe("기기 목소리가 읽지 못했을 때", () => {
  it("확인 요약을 읽지 못하면 다시 읽고, 또 못 읽으면 알림으로 전한 뒤에야 동의를 받는다", async () => {
    const h = harness();
    const engine = reachListening(h);
    engine.emit({ type: "USER_TURN_END", text: "전기밥솥 알려줘", transcribed: true });
    engine.emit({ type: "TURN_RESULT", reply: "확인해요", status: "confirming", slots: SLOTS });
    const reading = h.spoken.at(-1);
    expect(reading?.id).toBe("confirm");
    const text = reading?.text ?? "";
    const count = h.spoken.length;

    h.finishSpeak(true); // 낭독 오류
    expect(h.state().phase).toBe("speaking");
    expect(h.state().awaitingConsent).toBe(false);
    expect(h.spoken).toHaveLength(count + 1);
    expect(h.spoken.at(-1)).toEqual({ id: "confirm", text });

    h.finishSpeak(true); // 다시 읽기도 오류
    expect(h.state().phase).toBe("speaking");
    expect(h.state().awaitingConsent).toBe(false);
    expect(h.spoken).toHaveLength(count + 1);
    expect(h.played.at(-1)).toBe("cancel");
    expect(h.announced.at(-1)).toEqual({ channel: "status", text });

    await h.timers.advance(text.length * 250 + 1000 - 1);
    expect(h.state().phase).toBe("speaking");
    await h.timers.advance(1);
    expect(h.state().phase).toBe("confirming");
    expect(h.state().awaitingConsent).toBe(true);
  });

  it("끝까지 읽으면 실패 표시 없이 평소대로 간다", () => {
    const h = harness();
    reachConfirming(h);
    expect(h.state().phase).toBe("confirming");
    expect(h.state().awaitingConsent).toBe(true);
    expect(h.played).not.toContain("cancel");
  });
});
