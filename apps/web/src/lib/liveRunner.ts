// /live 실행기: 상태 기계(liveStep)가 낸 효과를 실제로 실행한다(타이머, 엔진, 읽기, 신호음, 접수). 설계서 14절, 9절, 5.4절.
// React를 쓰지 않아 node에서 시험한다. 로그에는 꼬리표만 남기고 이용자 말, AI 답, SDP, 기기 ID, 상품명을 남기지 않는다.
import type { EngineEvent, EngineKind, LiveEngine } from "@/lib/liveEngine";
import type { EarconPlayer, LiveSpeaker } from "@/lib/liveEngine";
import { earconDurationMs } from "@/lib/liveEarcons";
import { markVisit } from "@/lib/liveScripts";
import { liveStep, type LiveEffect, type LiveEvent, type LiveState, type TimerId } from "@/lib/liveMachine";
import { saveLiveRecord, toLiveRequest, type registerLive } from "@/lib/liveRequest";
import { EARCON_TO_MIC_MS, MIC_SETTLE_MS, TRANSCRIPT_WAIT_MS } from "@/lib/liveTiming";

export interface LiveRunnerDeps {
  createEngine(kind: EngineKind): LiveEngine;
  speaker: LiveSpeaker;
  earcons: EarconPlayer;
  timers: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  registerLive: typeof registerLive;
  deviceReady: Promise<void>;
  storage: Storage;
  requestStream(): Promise<MediaStream | undefined>;  // getUserMedia. 쓸 수 없거나 거절되면 undefined(던지지 않는다)
  setAudioSession(type: "playback" | "auto"): void;
  announce(channel: "status" | "alert", text: string): void;
  focus(target: "main" | "listLink" | "textInput"): void;
  wakeLock(on: boolean): void;
  waitSoundOn(): boolean;
  log?(tail: string): void;                           // 꼬리표만. 글을 남기지 않는다
  /** 설계서에 없는 덧붙임: 접수된 요청에 이미 있는 푸시 구독을 붙인다(ATTACH_PUSH). 없으면 건너뛴다. */
  attachPush?(requestId: string): void;
}

/** 설계서에 없는 덧붙임: 화면이 보여 줄 자막. 이용자가 말한 글(받아 적은 글)과 AI 말의 글. */
export interface LiveCaption { user: string; ai: string }

export interface LiveRunner {
  getState(): LiveState;
  getCaption(): LiveCaption;
  subscribe(listener: () => void): () => void;
  dispatch(event: LiveEvent): void;
  dispose(): void;
}

/** 지금 세대의 엔진 한 개와 그 엔진이 쓰는 것들. */
interface EngineRec {
  gen: number;
  kind: EngineKind;
  engine: LiveEngine;
  controller: AbortController;
  stream: MediaStream | undefined;
  unsub: () => void;
}

const stopStream = (s: MediaStream | undefined): void => {
  if (!s) return;
  try {
    for (const t of s.getTracks()) t.stop();
  } catch {
    // 이미 멈춘 트랙이면 무시한다.
  }
};

export function createLiveRunner(deps: LiveRunnerDeps, initial: LiveState): LiveRunner {
  let state = initial;
  let caption: LiveCaption = { user: "", ai: "" };
  let disposed = false;
  let running = false;
  const queue: LiveEvent[] = [];
  const listeners = new Set<() => void>();

  // 엔진 세대(14절): ENGINE_START와 ENGINE_CLOSE마다 올린다. 지난 세대의 사건은 버린다.
  let gen = 0;
  let current: EngineRec | null = null;
  let startController: AbortController | null = null;
  let stream: MediaStream | undefined;

  // TIMER_SET이 건 타이머. 같은 id를 다시 걸면 앞의 것을 지운다.
  const timerMap = new Map<TimerId, { handle: unknown }>();

  // 차례 열기(OPEN_TURN)의 기다림. 번호가 바뀌면 남은 단계를 하지 않는다.
  let turnSeq = 0;
  let turnTimer: { handle: unknown } | null = null;
  let turnOpening = false;   // 차례를 여는 중이다(뜸 → 신호음 → 마이크 열기 전). turnTimer는 신호음을 기다리는 사이 null이라 따로 둔다

  // 읽기와 대기 펄스, 알림.
  let speakingId: string | null = null;
  let pulseWanted = false;
  let announceEnd: { handle: unknown } | null = null;
  const lastAnnounced: Record<"status" | "alert", string> = { status: "", alert: "" };
  let lastRate = state.rate;

  // Realtime INTENT register를 이용자 말의 전사가 올 때까지 붙든다(14절).
  let holdQueue: { rec: EngineRec; events: EngineEvent[] } | null = null;
  let holdTimer: { handle: unknown } | null = null;

  // REGISTER_OK가 SAVE_RECORD에 넘길 접수 상태.
  let lastRegisterStatus = "waiting";

  const log = (tail: string) => {
    try {
      deps.log?.(tail);
    } catch {
      // 로그 실패는 무시한다.
    }
  };

  const notify = () => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // 듣는 쪽의 오류가 실행기를 멈추지 않게 한다.
      }
    }
  };

  const clearEntry = (entry: { handle: unknown } | null) => {
    if (entry) deps.timers.clear(entry.handle);
  };

  // ---------- 사건 처리 ----------

  function dispatch(event: LiveEvent): void {
    if (disposed) return;
    queue.push(event);
    if (running) return; // 효과 안에서 온 사건은 현재 효과가 끝난 뒤 같은 호출 스택에서 이어 처리한다.
    running = true;
    try {
      while (queue.length > 0 && !disposed) step(queue.shift() as LiveEvent);
    } finally {
      running = false;
    }
  }

  function step(event: LiveEvent): void {
    updateCaptionBefore(event);
    const result = liveStep(state, event);
    state = result.state;
    if (state.rate !== lastRate) {
      lastRate = state.rate;
      try {
        deps.speaker.setRate(state.rate);
      } catch {
        // 빠르기 바꾸기가 막혀도 대화는 계속된다.
      }
    }
    log(`step ${event.type} phase=${state.phase} fx=${result.effects.length}`);
    for (const fx of result.effects) {
      if (disposed) break;
      try {
        runEffect(fx);
      } catch {
        log(`effect_error ${fx.type}`);
      }
    }
    notify();
  }

  function updateCaptionBefore(event: LiveEvent): void {
    if (event.type === "USER_TRANSCRIPT") caption = { ...caption, user: event.text };
    else if (event.type === "REPLY_TEXT") caption = { ...caption, ai: event.text };
    else if (event.type === "REPLY_START") caption = { ...caption, ai: "" };
  }

  // ---------- 효과 ----------

  function runEffect(fx: LiveEffect): void {
    switch (fx.type) {
      case "EARCON":
        void Promise.resolve(deps.earcons.play(fx.name)).catch(() => {});
        return;
      case "WAIT_PULSE":
        pulseWanted = fx.on;
        if (fx.on) startPulse();
        else deps.earcons.stopWait();
        return;
      case "SPEAK":
        speak(fx.id, fx.text);
        return;
      case "STOP_SPEAK":
        stopSpeaking();
        return;
      case "ANNOUNCE":
        announce(fx.channel, fx.text, fx.endId);
        return;
      case "OPEN_TURN":
        caption = { ...caption, user: "" };
        openTurn(fx.earcon, fx.settle, fx.keep);
        return;
      case "RELISTEN":
        deps.setAudioSession("auto");
        current?.engine.listen({ keep: true });
        return;
      case "ENGINE_START":
        startEngine(fx.kind);
        return;
      case "ENGINE_HOLD":
        cancelTurn();
        current?.engine.hold();
        return;
      case "ENGINE_SUBMIT":
        // 띵 전의 뜸·신호음 사이에 온 누름·뗌은 버린다. 취소하면 신호음이 사라지고 마이크가 소리 없이 열린다. 곧 띵이 나고 듣기가 열린다.
        if (turnOpening) return;
        cancelTurn();
        current?.engine.submit();
        return;
      case "ENGINE_CANCEL_LISTEN":
        cancelTurn();
        current?.engine.cancelListen(fx.discard);
        return;
      case "ENGINE_RESPOND":
        caption = { ...caption, ai: "" };
        current?.engine.respond({ text: fx.text, source: fx.source }, fx.history);
        return;
      case "ENGINE_CANCEL_RESPONSE":
        current?.engine.cancelResponse();
        return;
      case "ENGINE_TOOL_RESULT":
        current?.engine.toolResult(fx.callId, fx.output, fx.respond);
        return;
      case "ENGINE_SET_RATE":
        current?.engine.setRate(fx.rate);
        return;
      case "ENGINE_CLOSE":
        closeEngine();
        return;
      case "TIMER_SET":
        setTimer(fx.id, fx.ms);
        return;
      case "TIMER_CLEAR":
        clearTimer(fx.id);
        return;
      case "REGISTER":
        register();
        return;
      case "SAVE_RECORD":
        saveRecord();
        return;
      case "ATTACH_PUSH":
        if (state.requestId) deps.attachPush?.(state.requestId);
        return;
      case "VISIT_MARK":
        markVisit(deps.storage);
        return;
      case "FOCUS":
        deps.focus(fx.target);
        return;
      case "RELEASE_MIC":
        stopStream(stream);
        stream = undefined;
        return;
      case "WAKE_LOCK":
        deps.wakeLock(fx.on);
        return;
    }
  }

  // ---------- 타이머 ----------

  function setTimer(id: TimerId, ms: number): void {
    clearTimer(id);
    const entry = { handle: undefined as unknown };
    timerMap.set(id, entry);
    entry.handle = deps.timers.set(() => {
      if (timerMap.get(id) !== entry) return;
      timerMap.delete(id);
      dispatch({ type: "TIMER", id });
    }, ms);
  }

  function clearTimer(id: TimerId): void {
    const entry = timerMap.get(id);
    if (!entry) return;
    timerMap.delete(id);
    deps.timers.clear(entry.handle);
  }

  // ---------- 읽기와 알림 ----------

  function startPulse(): void {
    if (speakingId !== null) return; // 앱이 말하는 동안에는 펄스를 쉰다. 읽기가 끝나면 다시 켠다.
    let on = false;
    try {
      on = deps.waitSoundOn();
    } catch {
      on = false;
    }
    if (on) deps.earcons.startWait();
  }

  function speak(id: string, text: string): void {
    clearEntry(announceEnd);
    announceEnd = null;
    deps.earcons.stopWait();
    deps.setAudioSession("playback");
    speakingId = id;
    try {
      deps.speaker.speak(id, text, (endedId, failed) => {
        if (speakingId === endedId) speakingId = null;
        if (pulseWanted && speakingId === null) startPulse();
        dispatch(failed ? { type: "SPEAK_END", id: endedId, failed: true } : { type: "SPEAK_END", id: endedId });
      });
    } catch {
      // 읽기를 시작하지 못했다. 읽지 못한 것으로 알린다(상태 기계가 화면 낭독기 알림으로 대신 전한다).
      speakingId = null;
      dispatch({ type: "SPEAK_END", id, failed: true });
    }
  }

  function stopSpeaking(): void {
    clearEntry(announceEnd);
    announceEnd = null;
    speakingId = null;
    try {
      deps.speaker.stop();
    } catch {
      // 이미 멈췄으면 무시한다.
    }
    if (pulseWanted) startPulse();
  }

  function announce(channel: "status" | "alert", text: string, endId?: string): void {
    // 같은 글을 다시 알릴 때는 한 번 비웠다가 넣어야 낭독기가 다시 읽는다.
    if (lastAnnounced[channel] === text && text !== "") deps.announce(channel, "");
    lastAnnounced[channel] = text;
    deps.announce(channel, text);
    if (endId === undefined) return;
    clearEntry(announceEnd);
    const entry = { handle: undefined as unknown };
    announceEnd = entry;
    entry.handle = deps.timers.set(() => {
      if (announceEnd !== entry) return;
      announceEnd = null;
      dispatch({ type: "SPEAK_END", id: endId });
    }, text.length * 250 + 1000);
  }

  // ---------- 차례 열기(9절) ----------

  function cancelTurn(): void {
    turnSeq += 1;
    turnOpening = false;
    clearEntry(turnTimer);
    turnTimer = null;
  }

  function wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const entry = { handle: undefined as unknown };
      turnTimer = entry;
      entry.handle = deps.timers.set(() => {
        if (turnTimer === entry) turnTimer = null;
        resolve();
      }, ms);
    });
  }

  function openTurn(earcon: "turn" | "confirm", settle: boolean, keep: boolean): void {
    cancelTurn();
    turnOpening = true;
    const mine = turnSeq;
    const alive = () => !disposed && mine === turnSeq;
    void (async () => {
      // 단추를 누른 직후에는 낭독이 인식에 섞이지 않게 신호음 앞에 뜸을 둔다.
      if (settle) {
        await wait(MIC_SETTLE_MS);
        if (!alive()) return;
      }
      deps.setAudioSession("playback");
      try {
        await Promise.resolve(deps.earcons.play(earcon));
      } catch {
        // 신호음이 막혀도 듣기는 연다.
      }
      if (!alive()) return;
      await wait(earconDurationMs(earcon) + EARCON_TO_MIC_MS);
      if (!alive()) return;
      turnOpening = false;
      deps.setAudioSession("auto");
      current?.engine.listen({ keep });
    })();
  }

  // ---------- 엔진 ----------

  function discard(rec: EngineRec): void {
    rec.unsub();
    try {
      rec.engine.close();
    } catch {
      // 이미 닫혔으면 무시한다.
    }
    stopStream(rec.stream);
    rec.controller.abort();
  }

  /** 지금 엔진과 마이크 기다림을 끊는다. 세대 번호는 부른 쪽이 올린다. */
  function releaseCurrent(): void {
    clearHold();
    cancelTurn();
    startController?.abort();
    startController = null;
    const rec = current;
    current = null;
    if (rec) {
      // 듣기를 끊지 않는다. 닫힌 엔진이 늦게 READY나 LOST를 내면 onEngineEvent가 버리고 한 번 더 닫는다.
      try {
        rec.engine.close();
      } catch {
        // 이미 닫혔으면 무시한다.
      }
      rec.controller.abort();
    }
  }

  function closeEngine(): void {
    gen += 1;
    releaseCurrent();
  }

  function startEngine(kind: EngineKind): void {
    gen += 1;
    const g = gen;
    releaseCurrent();
    // 앞 연결이 남긴 마이크가 있으면 놓는다(재연결에서 RELEASE_MIC 없이 다시 시작하는 길).
    stopStream(stream);
    stream = undefined;
    const controller = new AbortController();
    startController = controller;
    if (kind === "fallback") {
      launch(g, "fallback", controller, undefined);
      return;
    }
    deps.setAudioSession("auto");
    deps.requestStream().then(
      (got) => {
        if (disposed || g !== gen) {
          stopStream(got); // 세대가 바뀌었다. 받은 마이크는 바로 놓는다.
          return;
        }
        if (!got) {
          dispatch({ type: "MIC_DENIED" });
          return;
        }
        stream = got;
        dispatch({ type: "MIC_READY" });
        if (disposed || g !== gen) return;
        launch(g, "realtime", controller, got);
      },
      () => {
        if (!disposed && g === gen) dispatch({ type: "MIC_DENIED" });
      },
    );
  }

  function launch(g: number, kind: EngineKind, controller: AbortController, strm: MediaStream | undefined): void {
    const engine = deps.createEngine(kind);
    const rec: EngineRec = { gen: g, kind, engine, controller, stream: strm, unsub: () => {} };
    rec.unsub = engine.on((e) => onEngineEvent(rec, e));
    current = rec;
    engine
      .start({ cid: state.cid, history: state.history, rate: state.rate, stream: strm, signal: controller.signal })
      .catch(() => {
        // 엔진은 던지지 않기로 했지만, 던지면 연결 실패로 본다.
        if (disposed || g !== gen) return;
        dispatch(kind === "realtime" ? { type: "LOST", reason: "connect" } : { type: "FAILED", kind: "connect_failed" });
      });
  }

  function onEngineEvent(rec: EngineRec, e: EngineEvent): void {
    if (disposed) return;
    if (rec.gen !== gen) {
      // 연결 시간 초과 뒤 늦게 끝난 연결이 살아남지 않게 한다.
      if (e.type === "READY" || e.type === "LOST") discard(rec);
      return;
    }
    if (holdQueue) {
      if (e.type === "USER_TRANSCRIPT") {
        dispatch(e);
        if (e.final) releaseHold();
        return;
      }
      holdQueue.events.push(e);
      return;
    }
    if (
      e.type === "INTENT" && e.kind === "register" && rec.kind === "realtime" &&
      state.awaitingConsent && state.consentText === null
    ) {
      // 이번 말의 전사가 아직 없다. 전사가 오거나 TRANSCRIPT_WAIT_MS가 지날 때까지 붙든다.
      holdQueue = { rec, events: [e] };
      const entry = { handle: undefined as unknown };
      holdTimer = entry;
      entry.handle = deps.timers.set(() => {
        if (holdTimer === entry) releaseHold();
      }, TRANSCRIPT_WAIT_MS);
      return;
    }
    dispatch(e);
  }

  function releaseHold(): void {
    const held = holdQueue;
    clearEntry(holdTimer);
    holdTimer = null;
    holdQueue = null;
    if (!held) return;
    for (const ev of held.events) {
      if (disposed || held.rec.gen !== gen) break; // 앞 사건이 엔진을 닫았으면 나머지는 버린다.
      dispatch(ev);
    }
  }

  function clearHold(): void {
    clearEntry(holdTimer);
    holdTimer = null;
    holdQueue = null;
  }

  // ---------- 접수와 기록 ----------

  function register(): void {
    const draft = state.draft;
    const body = draft ? toLiveRequest(draft, state.cid) : null;
    if (!body) {
      dispatch({ type: "REGISTER_FAIL", kind: "rejected" });
      return;
    }
    const snapshot = { cid: state.cid, product: body.product, summary: body.details.summary };
    const sleep = (ms: number) => new Promise<void>((resolve) => { deps.timers.set(resolve, ms); });
    deps
      .registerLive(body, {
        fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
        sleep,
        deviceReady: deps.deviceReady,
        onBusy: () => dispatch({ type: "REGISTER_BUSY" }),
      })
      .then(
        (res) => {
          if (res.ok) {
            lastRegisterStatus = res.status;
            if (disposed) {
              // 화면이 닫혀도 접수는 끝까지 갔다. 기록과 푸시만 남긴다.
              saveLiveRecord(deps.storage, { ...snapshot, requestId: res.requestId, status: res.status });
              deps.attachPush?.(res.requestId);
              return;
            }
            dispatch({ type: "REGISTER_OK", requestId: res.requestId, queueNumber: res.queueNumber, status: res.status });
          } else if (!disposed) {
            dispatch({ type: "REGISTER_FAIL", kind: res.kind });
          }
        },
        () => {
          if (!disposed) dispatch({ type: "REGISTER_FAIL", kind: "unknown" });
        },
      );
  }

  function saveRecord(): void {
    if (!state.requestId) return;
    saveLiveRecord(deps.storage, {
      cid: state.cid,
      product: state.draft?.product ?? "",
      summary: state.draft?.summary ?? "",
      requestId: state.requestId,
      status: lastRegisterStatus,
    });
  }

  // ---------- 바깥에 내놓는 것 ----------

  return {
    getState: () => state,
    getCaption: () => caption,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      for (const entry of timerMap.values()) deps.timers.clear(entry.handle);
      timerMap.clear();
      clearEntry(announceEnd);
      announceEnd = null;
      gen += 1;
      releaseCurrent();
      stopStream(stream);
      stream = undefined;
      try {
        deps.speaker.stop();
        deps.earcons.stopWait();
        deps.wakeLock(false);
      } catch {
        // 정리 중의 오류는 무시한다.
      }
      listeners.clear();
    },
  };
}
