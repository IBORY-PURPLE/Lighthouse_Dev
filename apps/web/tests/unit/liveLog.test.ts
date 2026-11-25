// /live 대화 기록(브라우저 쪽) 시험: 사건 → 줄 변환, 참가자 표지, 모아서 보내기. 바깥 통신 0건(가짜 fetch).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveEffect, LiveEvent, LiveState } from "@/lib/liveMachine";
import { createInitialLive } from "@/lib/liveMachine";
import {
  LIVE_LOG_LEAVE_BYTES,
  LIVE_LOG_NO_DEVICE_MS,
  LIVE_LOG_REST_MS,
  LIVE_LOG_RETRY_MS,
  LIVE_LOG_SEND_DELAY_MS,
  LIVE_LOG_SEND_TIMEOUT_MS,
  createLiveLog,
  forgetLiveLogLabel,
  readLiveLogLabel,
  toLogEntries,
  type LiveLog,
} from "@/lib/liveLog";
import {
  LIVE_LOG_CLIENT_BATCH,
  LIVE_LOG_CLIENT_BYTES,
  LIVE_LOG_LABEL_KEY,
  LIVE_LOG_PATH,
  LIVE_LOG_TAG,
  type LiveLogRequest,
} from "@/lib/liveLogWire";

const CID = "11111111-2222-4333-8444-555555555555";
const CID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const base = createInitialLive({ cid: CID, visit: "first", tts: true, speechAvailable: true });
const st = (over: Partial<LiveState> = {}): LiveState => ({ ...base, ...over });

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 사건 → 줄

describe("toLogEntries: 이용자 말", () => {
  it("차례가 끝나 받아 적은 글은 user heard", () => {
    expect(toLogEntries({ type: "USER_TURN_END", text: "소니 헤드폰", transcribed: true }, st(), [])).toEqual([
      { kind: "user", tag: "heard", body: "소니 헤드폰" },
    ]);
  });

  it("글이 비었거나 전사가 아직 안 왔으면 글 없는 event heard_empty", () => {
    const empty = toLogEntries({ type: "USER_TURN_END", text: "  ", transcribed: true }, st(), []);
    const notYet = toLogEntries({ type: "USER_TURN_END", text: "", transcribed: false }, st(), []);
    expect(empty).toEqual([{ kind: "event", tag: "heard_empty", body: "" }]);
    expect(notYet).toEqual(empty);
  });

  it("USER_PART는 part, 늦게 온 최종 전사는 late, 글자 입력은 typed", () => {
    expect(toLogEntries({ type: "USER_PART", text: "첫 토막" }, st(), [])).toEqual([{ kind: "user", tag: "part", body: "첫 토막" }]);
    expect(toLogEntries({ type: "USER_TRANSCRIPT", text: "늦은 전사", final: true }, st(), [])).toEqual([
      { kind: "user", tag: "late", body: "늦은 전사" },
    ]);
    expect(toLogEntries({ type: "TEXT_SUBMIT", text: "직접 쓴 글" }, st(), [])).toEqual([{ kind: "user", tag: "typed", body: "직접 쓴 글" }]);
  });

  it("최종이 아닌 자막은 남기지 않는다", () => {
    expect(toLogEntries({ type: "USER_TRANSCRIPT", text: "소니", final: false }, st(), [])).toEqual([]);
  });
});

describe("toLogEntries: AI 말", () => {
  it("Realtime의 최종 자막만 ai reply. 누적 중인 자막은 남기지 않는다", () => {
    expect(toLogEntries({ type: "REPLY_TEXT", text: "어떤 제품이세요?", final: true }, st(), [])).toEqual([
      { kind: "ai", tag: "reply", body: "어떤 제품이세요?" },
    ]);
    expect(toLogEntries({ type: "REPLY_TEXT", text: "어떤", final: false }, st(), [])).toEqual([]);
  });

  it("예비 엔진: TURN_RESULT의 reply는 글로 남기지 않고, SPEAK id ai를 한 번만 ai reply로 남긴다", () => {
    const event: LiveEvent = {
      type: "TURN_RESULT",
      reply: "비밀 답변 글",
      status: "asking",
      slots: { product: "", info: "", options: "", budget: "" },
    };
    const fx: LiveEffect[] = [{ type: "SPEAK", id: "ai", text: "비밀 답변 글" }];
    const out = toLogEntries(event, st(), fx);
    expect(out).toEqual([
      { kind: "event", tag: "TURN_RESULT:asking", body: "" },
      { kind: "ai", tag: "reply", body: "비밀 답변 글" },
    ]);
    expect(out.filter((c) => c.body === "비밀 답변 글")).toHaveLength(1);
  });

  it("기기 목소리가 없을 때의 ANNOUNCE endId ai도 ai reply", () => {
    const fx: LiveEffect[] = [{ type: "ANNOUNCE", channel: "status", text: "답이에요", endId: "ai" }];
    expect(toLogEntries({ type: "TURN_RESULT", reply: "답이에요", status: "asking", slots: base.draft ?? { product: "", info: "", options: "", budget: "" } }, st(), fx)).toContainEqual({
      kind: "ai",
      tag: "reply",
      body: "답이에요",
    });
  });
});

describe("toLogEntries: 앱이 읽어 준 글", () => {
  it("SPEAK(id가 ai가 아닌 것)는 app say:<id>", () => {
    expect(toLogEntries({ type: "START" }, st(), [{ type: "SPEAK", id: "confirm", text: "제품은 헤드폰이에요. 보낼까요?" }])).toEqual([
      { kind: "event", tag: "START", body: "" },
      { kind: "app", tag: "say:confirm", body: "제품은 헤드폰이에요. 보낼까요?" },
    ]);
  });

  it("endId가 있는 ANNOUNCE는 say:<endId>, endId가 없는 ANNOUNCE는 남기지 않는다", () => {
    const withEnd = toLogEntries({ type: "HELP" }, st(), [{ type: "ANNOUNCE", channel: "status", text: "도움말", endId: "help" }]);
    expect(withEnd).toContainEqual({ kind: "app", tag: "say:help", body: "도움말" });
    const without = toLogEntries({ type: "HELP" }, st(), [{ type: "ANNOUNCE", channel: "status", text: "상태 알림" }]);
    expect(without).toEqual([{ kind: "event", tag: "HELP", body: "" }]);
  });

  it("읽기 실패 뒤 같은 글을 다시 읽거나 알림으로 바꿔 내도 한 번만 남긴다", () => {
    const retry = toLogEntries({ type: "SPEAK_END", id: "confirm", failed: true }, st(), [{ type: "SPEAK", id: "confirm", text: "요약" }]);
    expect(retry).toEqual([]);
    const fallback = toLogEntries({ type: "SPEAK_END", id: "confirm", failed: true }, st(), [
      { type: "ANNOUNCE", channel: "status", text: "요약", endId: "confirm" },
    ]);
    expect(fallback).toEqual([]);
    // 끝난 뒤 새로 읽기 시작하는 다른 글은 남긴다.
    expect(toLogEntries({ type: "SPEAK_END", id: "guide" }, st(), [{ type: "SPEAK", id: "next", text: "다음 안내" }])).toEqual([
      { kind: "app", tag: "say:next", body: "다음 안내" },
    ]);
  });

  it("id의 낯선 글자는 _로 바꿔 tag 모양에 맞춘다", () => {
    const [line] = toLogEntries({ type: "START" }, st(), [{ type: "SPEAK", id: "a b한", text: "글" }]).slice(1);
    expect(line.tag).toBe("say:a_b_");
    expect(LIVE_LOG_TAG.test(line.tag)).toBe(true);
  });
});

describe("toLogEntries: 글 없는 사건과 허용 목록", () => {
  it("이름만 남기는 사건은 body가 언제나 빈 글", () => {
    const names = [
      "START", "RESUME", "RETRY", "CONTINUE", "EXIT", "PAUSE", "HIDDEN", "MAIN_BUTTON", "CONSENT_BUTTON", "EDIT_BUTTON",
      "REPEAT", "HELP", "HOLD_SUBMIT", "HOLD_CANCEL", "MIC_DENIED", "NO_SPEECH", "SESSION_WARN",
    ] as const;
    for (const type of names) {
      expect(toLogEntries({ type } as LiveEvent, st(), []), type).toEqual([{ kind: "event", tag: type, body: "" }]);
    }
    expect(toLogEntries({ type: "NEW_REQUEST", cid: CID2 }, st(), [])).toEqual([{ kind: "event", tag: "NEW_REQUEST", body: "" }]);
    expect(toLogEntries({ type: "REGISTER_OK", requestId: "r1", queueNumber: 3, status: "waiting" }, st(), [])).toEqual([
      { kind: "event", tag: "REGISTER_OK", body: "" },
    ]);
  });

  it("값이 붙는 사건: READY·INTENT·FAILED·LOST·REGISTER_FAIL", () => {
    expect(toLogEntries({ type: "READY", engine: "realtime", inputMode: "voice" }, st(), [])[0].tag).toBe("READY:realtime");
    expect(toLogEntries({ type: "INTENT", kind: "register", callId: "c" }, st(), [])[0].tag).toBe("INTENT:register");
    expect(toLogEntries({ type: "INTENT", kind: "confirm", callId: "c", slots: { product: "x", info: "", options: "", budget: "" } }, st(), [])[0].tag).toBe(
      "INTENT:confirm",
    );
    expect(toLogEntries({ type: "FAILED", kind: "timeout" }, st(), [])[0].tag).toBe("FAILED:timeout");
    expect(toLogEntries({ type: "LOST", reason: "network", detail: "상세" }, st(), [])[0]).toEqual({ kind: "event", tag: "LOST:network", body: "" });
    expect(toLogEntries({ type: "REGISTER_FAIL", kind: "rejected" }, st(), [])[0].tag).toBe("REGISTER_FAIL:rejected");
  });

  it("효과: ENGINE_START, ENGINE_RESPOND(글은 남기지 않는다), ENGINE_CANCEL_RESPONSE", () => {
    const fx: LiveEffect[] = [
      { type: "ENGINE_START", kind: "fallback" },
      { type: "ENGINE_RESPOND", text: "비밀 말", source: "voice", history: [] },
      { type: "ENGINE_CANCEL_RESPONSE" },
    ];
    const out = toLogEntries({ type: "START" }, st(), fx);
    expect(out.map((c) => c.tag)).toEqual(["START", "ENGINE_START:fallback", "sent:voice", "ENGINE_CANCEL_RESPONSE"]);
    expect(out.every((c) => c.kind === "event" && c.body === "")).toBe(true);
  });

  it("타이머·신호음·초점·SPEAK_END·LISTEN_STARTED·REPLY_START/END·CONFIG 같은 내부 사건과 효과는 남기지 않는다", () => {
    const events: LiveEvent[] = [
      { type: "TIMER", id: "silence" },
      { type: "SPEAK_END", id: "x" },
      { type: "LISTEN_STARTED", late: false },
      { type: "REPLY_START" },
      { type: "REPLY_END" },
      { type: "CONFIG", realtime: true },
      { type: "MIC_READY" },
      { type: "USER_SPEECH_START" },
    ];
    for (const e of events) expect(toLogEntries(e, st(), []), e.type).toEqual([]);
    const fx: LiveEffect[] = [
      { type: "EARCON", name: "turn" },
      { type: "TIMER_SET", id: "silence", ms: 1000 },
      { type: "FOCUS", target: "main" },
      { type: "WAKE_LOCK", on: true },
      { type: "STOP_SPEAK" },
      { type: "ENGINE_CLOSE" },
    ];
    expect(toLogEntries({ type: "TIMER", id: "silence" }, st(), fx)).toEqual([]);
  });

  it("접수를 보낸 효과 REGISTER는 글 없는 사건 REGISTER로 남긴다(닫힌 뒤 끝난 접수는 REGISTER_OK가 남지 않는다)", () => {
    const out = toLogEntries({ type: "MAIN_BUTTON" }, st(), [{ type: "REGISTER" }]);
    expect(out).toEqual([
      { kind: "event", tag: "MAIN_BUTTON", body: "" },
      { kind: "event", tag: "REGISTER", body: "" },
    ]);
  });

  it("글이 1,000자(코드 포인트)를 넘으면 이모지 반쪽 없이 자른다", () => {
    const text = "😀".repeat(1001);
    const [line] = toLogEntries({ type: "TEXT_SUBMIT", text }, st(), []);
    expect(Array.from(line.body)).toHaveLength(1000);
    expect(() => JSON.parse(JSON.stringify(line))).not.toThrow();
    expect(line.body.endsWith("😀")).toBe(true);
  });
});

// ---------------------------------------------------------------- 참가자 표지

function memStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("readLiveLogLabel", () => {
  it("?p=P01이면 P01을 쓰고 기기 저장소에 기억한다", () => {
    const s = memStorage();
    expect(readLiveLogLabel("?p=P01", s)).toBe("P01");
    expect(s.data.get(LIVE_LOG_LABEL_KEY)).toBe("P01");
  });

  it("p가 없으면 기억해 둔 값을 쓴다(다시 열어도 계속 저장)", () => {
    const s = memStorage({ [LIVE_LOG_LABEL_KEY]: "P07" });
    expect(readLiveLogLabel("", s)).toBe("P07");
    expect(readLiveLogLabel("?x=1", s)).toBe("P07");
  });

  it("새 ?p=는 기억해 둔 값을 바꾼다", () => {
    const s = memStorage({ [LIVE_LOG_LABEL_KEY]: "P07" });
    expect(readLiveLogLabel("?p=P08", s)).toBe("P08");
    expect(s.data.get(LIVE_LOG_LABEL_KEY)).toBe("P08");
  });

  it("?p=off는 기억을 지우고 표지 없음", () => {
    const s = memStorage({ [LIVE_LOG_LABEL_KEY]: "P07" });
    expect(readLiveLogLabel("?p=off", s)).toBe("");
    expect(s.data.has(LIVE_LOG_LABEL_KEY)).toBe(false);
    expect(readLiveLogLabel("", s)).toBe("");
  });

  it("?p=OFF, ?p=Off처럼 대소문자가 달라도 끄기로 본다(표지로 받지 않는다)", () => {
    for (const q of ["?p=OFF", "?p=Off", "?p=oFf"]) {
      const s = memStorage({ [LIVE_LOG_LABEL_KEY]: "P07" });
      expect(readLiveLogLabel(q, s), q).toBe("");
      expect(s.data.has(LIVE_LOG_LABEL_KEY), q).toBe(false);
    }
    const fresh = memStorage();
    expect(readLiveLogLabel("?p=OFF", fresh)).toBe("");
    expect(fresh.data.size).toBe(0);
  });

  it("모양이 틀린 p는 저장하지 않고, 기억해 둔 값이 있으면 그것을 쓴다", () => {
    const s = memStorage();
    expect(readLiveLogLabel("?p=%ED%95%9C%EA%B8%80", s)).toBe("");
    expect(readLiveLogLabel("?p=abcdefghijklm", s)).toBe("");   // 13자
    expect(s.data.size).toBe(0);
    s.setItem(LIVE_LOG_LABEL_KEY, "P01");
    expect(readLiveLogLabel("?p=%20", s)).toBe("P01");
    expect(readLiveLogLabel("?p=abcdefghijkl", s)).toBe("abcdefghijkl");   // 12자
  });

  it("기억해 둔 값의 모양이 틀리면 쓰지 않는다", () => {
    expect(readLiveLogLabel("", memStorage({ [LIVE_LOG_LABEL_KEY]: "<script>" }))).toBe("");
  });

  it("저장소가 없거나 접근이 던져도 삼킨다", () => {
    expect(readLiveLogLabel("?p=P01", null)).toBe("P01");
    expect(readLiveLogLabel("", null)).toBe("");
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readLiveLogLabel("?p=P01", bad)).toBe("P01");
    expect(readLiveLogLabel("", bad)).toBe("");
    expect(readLiveLogLabel("?p=off", bad)).toBe("");
  });
});

describe("forgetLiveLogLabel", () => {
  it("기억해 둔 표지를 지운다", () => {
    const s = memStorage({ [LIVE_LOG_LABEL_KEY]: "P07" });
    forgetLiveLogLabel(s);
    expect(s.data.has(LIVE_LOG_LABEL_KEY)).toBe(false);
    expect(readLiveLogLabel("", s)).toBe("");
  });

  it("저장소가 없거나 접근이 던져도 삼킨다", () => {
    expect(() => forgetLiveLogLabel(null)).not.toThrow();
    const bad = {
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => forgetLiveLogLabel(bad)).not.toThrow();
  });
});

// ---------------------------------------------------------------- 모아서 보내기

const settle = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

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
    get now() {
      return now;
    },
    async advance(ms: number) {
      await settle();
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
        await settle();
      }
      now = target;
      await settle();
    },
  };
}

type Reply = { status?: number; json?: unknown } | "network" | "throw";

function harness(opts: { label?: string; deviceReady?: Promise<void> } = {}) {
  const timers = makeTimers();
  const sent: LiveLogRequest[] = [];
  const inits: RequestInit[] = [];
  const urls: string[] = [];
  const plan: Reply[] = [];
  const stored: number[] = [];
  const stops = { n: 0 };
  const misses = { n: 0 };
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    inits.push(init ?? {});
    sent.push(JSON.parse(String(init?.body)) as LiveLogRequest);
    const step = plan.shift() ?? { status: 200, json: { stored: sent[sent.length - 1].entries.length, reason: "saved" } };
    if (step === "throw") throw new Error("sync boom");
    if (step === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(step.json ?? {}), { status: step.status ?? 200 });
  });
  const log = createLiveLog({
    fetch: fetchFn as unknown as typeof fetch,
    deviceReady: opts.deviceReady ?? Promise.resolve(),
    timers,
    now: () => timers.now,
    label: opts.label ?? "T01",
    onStored: (n) => stored.push(n),
    onStopped: () => {
      stops.n += 1;
    },
    onNotStored: () => {
      misses.n += 1;
    },
  });
  return { log, timers, sent, inits, urls, plan, stored, stops, misses, fetchFn };
}

const heard = (text: string): LiveEvent => ({ type: "USER_TURN_END", text, transcribed: true });
const say = (log: LiveLog, text: string, state: LiveState = st()) => log.record(heard(text), state, []);

describe("createLiveLog: 켜기 전과 끄기", () => {
  it("설정 응답 전에는 큐에만 쌓고 보내지 않는다. setMode 뒤 2초 뒤 한 번에 보낸다", async () => {
    const h = harness();
    say(h.log, "하나");
    say(h.log, "둘");
    await h.timers.advance(10_000);
    expect(h.fetchFn).not.toHaveBeenCalled();

    h.log.setMode("label");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS - 1);
    expect(h.fetchFn).not.toHaveBeenCalled();
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    expect(h.urls[0]).toBe(LIVE_LOG_PATH);
    expect(h.sent[0].label).toBe("T01");
    expect(h.sent[0].entries.map((e) => [e.seq, e.body])).toEqual([[0, "하나"], [1, "둘"]]);
  });

  it("설정을 끝내 못 받으면 보내지 않는다", async () => {
    const h = harness();
    say(h.log, "말");
    h.log.flush(true);
    await h.timers.advance(60_000);
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it("setMode(null)이면 큐를 비우고 이후 record를 무시한다", async () => {
    const h = harness();
    say(h.log, "말");
    h.log.setMode(null);
    say(h.log, "또 말");
    h.log.setMode("all");   // 한번 꺼지면 되살리지 않는다는 보장은 없지만, 비운 큐는 돌아오지 않는다
    await h.timers.advance(10_000);
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it("label 방식인데 표지가 없으면 켜지지 않는다. all이면 표지 없이도 보낸다", async () => {
    const a = harness({ label: "" });
    say(a.log, "말");
    a.log.setMode("label");
    say(a.log, "말2");
    await a.timers.advance(10_000);
    expect(a.fetchFn).not.toHaveBeenCalled();

    const b = harness({ label: "" });
    b.log.setMode("all");
    say(b.log, "말");
    await b.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(b.sent[0]).toMatchObject({ label: "" });
    expect(b.sent[0].entries).toHaveLength(1);
  });

  it("글 없는 사건만 있으면 2초 타이머를 걸지 않는다. 오류 사건은 건다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record({ type: "START" }, st(), []);
    h.log.record({ type: "HIDDEN" }, st(), []);
    expect(h.timers.pending).toBe(0);
    h.log.record({ type: "FAILED", kind: "timeout" }, st(), []);
    expect(h.timers.pending).toBe(1);
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.sent[0].entries.map((e) => e.tag)).toEqual(["START", "HIDDEN", "FAILED:timeout"]);
  });
});

describe("createLiveLog: 줄에 붙는 것", () => {
  it("cid는 liveStep 뒤 state의 것, seq는 cid별 0부터, phase·engine·atMs가 붙는다", async () => {
    const h = harness();
    h.log.setMode("label");
    const s1 = st({ phase: "listening", engine: "fallback" });
    h.log.record(heard("처음"), s1, []);
    await h.timers.advance(500);
    h.log.record(heard("조금 뒤"), s1, []);
    await h.timers.advance(1000);
    // 새 대화: state.cid가 바뀐다(사건이 실어 온 cid가 아니라 state의 cid를 쓴다)
    h.log.record({ type: "NEW_REQUEST", cid: "ignored-by-log" }, st({ cid: CID2, phase: "guiding", engine: null }), []);
    h.log.record(heard("새 대화"), st({ cid: CID2, phase: "listening", engine: "realtime" }), []);
    await h.timers.advance(5000);
    const all = h.sent.flatMap((r) => r.entries);
    expect(all.map((e) => [e.cid, e.seq, e.kind, e.tag, e.phase, e.engine])).toEqual([
      [CID, 0, "user", "heard", "listening", "fallback"],
      [CID, 1, "user", "heard", "listening", "fallback"],
      [CID2, 0, "event", "NEW_REQUEST", "guiding", ""],
      [CID2, 1, "user", "heard", "listening", "realtime"],
    ]);
    expect(all[0].atMs).toBe(0);
    expect(all[1].atMs).toBe(500);
    expect(all[2].atMs).toBe(0);   // 새 대화는 그 대화의 첫 줄부터 센다
  });

  it("seq가 999를 넘으면 그 대화의 줄은 버린다", async () => {
    const h = harness();
    h.log.setMode("label");
    for (let i = 0; i < 1010; i += 1) {
      say(h.log, `말 ${i}`);
      await h.timers.advance(2500);
    }
    const all = h.sent.flatMap((r) => r.entries);
    expect(all).toHaveLength(1000);
    expect(Math.max(...all.map((e) => e.seq))).toBe(999);
  });

  it("cid 모양이 UUID가 아니면 남기지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(heard("말"), st({ cid: "not-a-uuid" }), []);
    await h.timers.advance(5000);
    expect(h.fetchFn).not.toHaveBeenCalled();
  });
});

describe("createLiveLog: 보내는 때와 묶음", () => {
  it("큐가 20줄이 되면 바로 보내고, 한 번에 하나만 보낸다(직렬)", async () => {
    const h = harness();
    h.log.setMode("label");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    h.fetchFn.mockImplementationOnce(async (url, init) => {
      h.urls.push(String(url));
      h.sent.push(JSON.parse(String(init?.body)) as LiveLogRequest);
      await gate;
      return new Response(JSON.stringify({ stored: 20, reason: "saved" }), { status: 200 });
    });
    for (let i = 0; i < LIVE_LOG_CLIENT_BATCH; i += 1) say(h.log, `말 ${i}`);
    await settle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].entries).toHaveLength(LIVE_LOG_CLIENT_BATCH);
    for (let i = 20; i < 25; i += 1) say(h.log, `말 ${i}`);
    await h.timers.advance(5000);
    expect(h.sent).toHaveLength(1);   // 앞 요청이 끝나기 전에는 다음을 보내지 않는다
    release?.();
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].entries.map((e) => e.seq)).toEqual([20, 21, 22, 23, 24]);
  });

  it("fetch 옵션: POST, JSON. 평소 전송은 keepalive를 쓰지 않고, 떠날 때만 쓴다", async () => {
    const h = harness();
    h.log.setMode("label");
    say(h.log, "말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.inits[0]).toMatchObject({ method: "POST", keepalive: false, headers: { "Content-Type": "application/json" } });
    say(h.log, "떠나며");
    h.log.flush(true);
    await settle();
    expect(h.inits[1]).toMatchObject({ method: "POST", keepalive: true, headers: { "Content-Type": "application/json" } });
  });

  it("한 묶음은 LIVE_LOG_CLIENT_BYTES 이하다", async () => {
    const h = harness();
    h.log.setMode("label");
    const long = "가".repeat(900);   // 한 줄이 JSON으로 약 2.7KB
    for (let i = 0; i < 12; i += 1) say(h.log, `${i} ${long}`);
    await h.timers.advance(20_000);
    expect(h.sent.length).toBeGreaterThan(1);
    for (const req of h.sent) expect(new TextEncoder().encode(JSON.stringify(req)).length).toBeLessThanOrEqual(LIVE_LOG_CLIENT_BYTES);
    expect(h.sent.flatMap((r) => r.entries)).toHaveLength(12);
  });

  it("큐는 300줄 상한이고 넘으면 오래된 것부터 버린다", async () => {
    const h = harness();
    for (let i = 0; i < 305; i += 1) say(h.log, `말 ${i}`);
    h.log.setMode("label");
    for (let i = 0; i < 20; i += 1) await h.timers.advance(0);   // 20줄씩 15묶음이 이어서 나간다
    const all = h.sent.flatMap((r) => r.entries);
    expect(all).toHaveLength(300);
    expect(all[0].seq).toBe(5);
    expect(all.at(-1)?.seq).toBe(304);
  });

  it("평소 첫 전송은 deviceReady 뒤, 떠날 때(flush(true))는 기다리지 않는다", async () => {
    let ready: (() => void) | undefined;
    const deviceReady = new Promise<void>((r) => (ready = r));
    const h = harness({ deviceReady });
    h.log.setMode("label");
    say(h.log, "평소");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.fetchFn).not.toHaveBeenCalled();   // 쿠키 발급 전
    ready?.();
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);

    const g = harness({ deviceReady: new Promise<void>(() => {}) });
    g.log.setMode("label");
    say(g.log, "떠남");
    g.log.flush(true);
    await settle();
    expect(g.fetchFn).toHaveBeenCalledTimes(1);
    expect(g.sent[0].entries[0].body).toBe("떠남");
  });

  it("flush(true)는 쌓인 것을 바로 보내고 2초 타이머를 지운다", async () => {
    const h = harness();
    h.log.setMode("label");
    say(h.log, "말");
    expect(h.timers.pending).toBe(1);
    h.log.flush(true);
    await settle();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    expect(h.timers.pending).toBe(0);
  });
});

describe("createLiveLog: 끊긴 AI 답", () => {
  const partial = (text: string): LiveEvent => ({ type: "REPLY_TEXT", text, final: false });

  const final = (text: string): LiveEvent => ({ type: "REPLY_TEXT", text, final: true });
  /** 떠나며 보내고, 남은 ai 줄만 (tag, body)로 돌려준다. */
  async function aiLines(h: ReturnType<typeof harness>) {
    h.log.flush(true);
    await settle();
    return h.sent.flatMap((r) => r.entries).filter((e) => e.kind === "ai").map((e) => [e.tag, e.body]);
  }

  it("(가) 조각 → REPLY_START → 조각 → final 순서면 reply 하나뿐이다(자막이 소리 시작 신호보다 먼저 와도 끊긴 것이 아니다)", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("어떤"), st(), []);
    h.log.record({ type: "REPLY_START" }, st(), []);
    h.log.record(partial("어떤 제품"), st(), []);
    h.log.record(final("어떤 제품이세요?"), st(), []);
    expect(await aiLines(h)).toEqual([["reply", "어떤 제품이세요?"]]);
  });

  it("(나) REPLY_START → 조각 → final 순서도 reply 하나뿐이다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record({ type: "REPLY_START" }, st(), []);
    h.log.record(partial("어떤"), st(), []);
    h.log.record(final("어떤 제품이세요?"), st(), []);
    expect(await aiLines(h)).toEqual([["reply", "어떤 제품이세요?"]]);
  });

  it("REPLY_START만으로는 끊긴 글을 남기지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("어떤"), st(), []);
    h.log.record({ type: "REPLY_START" }, st(), []);
    h.log.record({ type: "REPLY_START" }, st(), []);
    h.log.record(partial("어떤 제품"), st(), []);
    await h.timers.advance(60_000);
    expect(h.sent.flatMap((r) => r.entries)).toEqual([]);
  });

  it("(다) 조각 → ENGINE_CANCEL_RESPONSE → 같은 답의 final이면 [reply_cut, reply_after_cut]. 그다음 final은 다시 reply", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("어떤 제품"), st(), []);
    h.log.record({ type: "MAIN_BUTTON" }, st(), [{ type: "ENGINE_CANCEL_RESPONSE" }]);
    h.log.record(final("어떤 제품이세요? 예산도 알려 주세요."), st(), []);
    h.log.record(final("어떤 제품이세요? 예산도 알려 주세요."), st(), []);
    expect(await aiLines(h)).toEqual([
      ["reply_cut", "어떤 제품"],
      ["reply_after_cut", "어떤 제품이세요? 예산도 알려 주세요."],
      ["reply", "어떤 제품이세요? 예산도 알려 주세요."],
    ]);
  });

  it("(라) 조각 A → final 없이 조각 B(A로 시작하지 않음) → final B면 [reply_cut A, reply B]", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("어떤 제품"), st(), []);
    h.log.record(partial("전기밥솥"), st(), []);
    h.log.record(partial("전기밥솥은 몇 인용"), st(), []);
    h.log.record(final("전기밥솥은 몇 인용이세요?"), st(), []);
    expect(await aiLines(h)).toEqual([
      ["reply_cut", "어떤 제품"],
      ["reply", "전기밥솥은 몇 인용이세요?"],
    ]);
  });

  it("끊긴 뒤 그 글로 시작하지 않는 final이 오면 reply(after_cut 아님)", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("어떤 제품"), st(), []);
    h.log.record({ type: "EXIT" }, st(), [{ type: "ENGINE_CLOSE" }]);
    h.log.record(final("전혀 다른 답"), st(), []);
    expect(await aiLines(h)).toEqual([
      ["reply_cut", "어떤 제품"],
      ["reply", "전혀 다른 답"],
    ]);
  });

  it("(마) flush(true) 뒤 final이 오면 [reply_cut, reply_after_cut]", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("떠나기 직전"), st(), []);
    h.log.flush(true);
    await settle();
    h.log.record(final("떠나기 직전의 답 전체"), st(), []);
    h.log.flush(true);
    await settle();
    const ai = h.sent.flatMap((r) => r.entries).filter((e) => e.kind === "ai").map((e) => e.tag);
    expect(ai).toEqual(["reply_cut", "reply_after_cut"]);
  });

  it("final이 오면 기억을 지운다(reply_cut 없음)", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("어떤"), st(), []);
    h.log.record({ type: "REPLY_TEXT", text: "어떤 제품이세요?", final: true }, st(), []);
    h.log.record({ type: "REPLY_START" }, st(), []);
    h.log.flush(true);
    await settle();
    expect(h.sent.flatMap((r) => r.entries).map((e) => e.tag)).toEqual(["reply"]);
  });

  it("ENGINE_CANCEL_RESPONSE·ENGINE_CLOSE 효과가 있어도 남긴다", async () => {
    const a = harness();
    a.log.setMode("label");
    a.log.record(partial("중간"), st(), []);
    a.log.record({ type: "MAIN_BUTTON" }, st(), [{ type: "ENGINE_CANCEL_RESPONSE" }]);
    a.log.flush(true);
    await settle();
    expect(a.sent.flatMap((r) => r.entries).map((e) => e.tag)).toEqual(["reply_cut", "MAIN_BUTTON", "ENGINE_CANCEL_RESPONSE"]);

    const b = harness();
    b.log.setMode("label");
    b.log.record(partial("중간"), st(), []);
    b.log.record({ type: "EXIT" }, st(), [{ type: "ENGINE_CLOSE" }]);
    b.log.flush(true);
    await settle();
    expect(b.sent.flatMap((r) => r.entries).map((e) => e.tag)).toEqual(["reply_cut", "EXIT"]);
  });

  it("flush(true)만으로도 남긴다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.log.record(partial("떠나기 직전의 답"), st(), []);
    h.log.flush(true);
    await settle();
    expect(h.sent[0].entries[0]).toMatchObject({ kind: "ai", tag: "reply_cut", body: "떠나기 직전의 답" });
  });
});

describe("createLiveLog: 응답 처리", () => {
  async function started(h: ReturnType<typeof harness>) {
    h.log.setMode("label");
    say(h.log, "말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
  }

  it("200이면 그 묶음을 버리고 stored > 0이면 onStored를 부른다", async () => {
    const h = harness();
    await started(h);
    expect(h.stored).toEqual([1]);
    await h.timers.advance(60_000);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);   // 다시 보내지 않는다
  });

  it("stored가 0이면(empty, capped 등) onStored를 부르지 않고 다시 보내지도 않는다", async () => {
    for (const reason of ["empty", "capped", "failed"]) {
      const h = harness();
      h.plan.push({ json: { stored: 0, reason } });
      await started(h);
      await h.timers.advance(60_000);
      expect(h.stored, reason).toEqual([]);
      expect(h.fetchFn, reason).toHaveBeenCalledTimes(1);
    }
  });

  it("off·ended·no_label이면 이 화면에서는 더 보내지 않고 큐도 비운다", async () => {
    for (const reason of ["off", "ended", "no_label"]) {
      const h = harness();
      h.plan.push({ json: { stored: 0, reason } });
      await started(h);
      say(h.log, "이후의 말");
      h.log.flush(true);
      await h.timers.advance(60_000);
      expect(h.fetchFn, reason).toHaveBeenCalledTimes(1);
    }
  });

  it("404면 더 보내지 않는다", async () => {
    const h = harness();
    h.plan.push({ status: 404 });
    await started(h);
    say(h.log, "이후");
    await h.timers.advance(60_000);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("no_device면 같은 묶음을 5초 뒤 다시 보내고, 3번째에도 안 되면 버린다", async () => {
    const h = harness();
    h.plan.push({ json: { stored: 0, reason: "no_device" } }, { json: { stored: 0, reason: "no_device" } }, { json: { stored: 0, reason: "no_device" } });
    await started(h);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(LIVE_LOG_NO_DEVICE_MS - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    await h.timers.advance(LIVE_LOG_NO_DEVICE_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    await h.timers.advance(60_000);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);   // 버렸다
    expect(h.sent[0].entries).toEqual(h.sent[1].entries);
  });

  it("no_device 뒤 쿠키가 생기면 저장된다", async () => {
    const h = harness();
    h.plan.push({ json: { stored: 0, reason: "no_device" } });
    await started(h);
    await h.timers.advance(LIVE_LOG_NO_DEVICE_MS);
    expect(h.stored).toEqual([1]);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("429·5xx·네트워크 오류면 큐 앞에 되돌려 다시 보낸다", async () => {
    for (const first of [{ status: 429 }, { status: 503 }, "network"] as Reply[]) {
      const h = harness();
      h.plan.push(first);
      await started(h);
      expect(h.stored).toEqual([]);
      await h.timers.advance(LIVE_LOG_RETRY_MS);
      expect(h.fetchFn).toHaveBeenCalledTimes(2);
      expect(h.sent[1].entries).toEqual(h.sent[0].entries);
      expect(h.stored).toEqual([1]);
    }
  });

  it("연속 3번 실패하면 30초 쉬었다가 다시 시도한다(영영 멈추지 않는다)", async () => {
    const h = harness();
    h.plan.push({ status: 503 }, { status: 503 }, { status: 503 });
    await started(h);                                  // 1번째 실패
    await h.timers.advance(LIVE_LOG_RETRY_MS);        // 2번째 실패
    await h.timers.advance(LIVE_LOG_RETRY_MS);        // 3번째 실패
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    await h.timers.advance(LIVE_LOG_REST_MS - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(4);
    expect(h.stored).toEqual([1]);
  });

  it("다시 보내도 안 되는 4xx(400·403)는 그 묶음을 버리고 멈추지 않는다", async () => {
    const h = harness();
    h.plan.push({ status: 403 });
    await started(h);
    await h.timers.advance(60_000);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    say(h.log, "다음 말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("200인데 본문이 JSON이 아니어도 던지지 않는다", async () => {
    const h = harness();
    h.fetchFn.mockImplementationOnce(async () => new Response("<html>", { status: 200 }));
    await started(h);
    await h.timers.advance(60_000);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("createLiveLog: 실패 중 쉬기·시간 제한·묶음별 다시 보내기·떠날 때 총량", () => {
  it("서버가 503을 계속 줘도 3번 실패 뒤 30초 동안은 record가 쌓여도 요청 0건, 30초 뒤 1건(영영 멈추지는 않는다)", async () => {
    const h = harness();
    h.plan.push({ status: 503 }, { status: 503 }, { status: 503 });
    h.log.setMode("label");
    say(h.log, "첫 말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS); // 1번째 실패
    await h.timers.advance(LIVE_LOG_RETRY_MS); // 2번째 실패
    await h.timers.advance(LIVE_LOG_RETRY_MS); // 3번째 실패
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    // 쉬는 30초 동안 1초마다 record한다. 큐가 20줄을 넘어도 보내지 않는다.
    for (let i = 0; i < 29; i += 1) {
      say(h.log, `쉬는 중 ${i}`);
      await h.timers.advance(1000);
    }
    say(h.log, "쉬는 중 마지막");
    await h.timers.advance(LIVE_LOG_REST_MS - 29_000 - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(4);
    expect(h.sent[3].entries[0].body).toBe("첫 말");
    expect(h.stored).toEqual([20]);
  });

  it("실패한 뒤 5초 안에는 큐가 20줄이 되어도 평소 전송을 하지 않는다", async () => {
    const h = harness();
    h.plan.push({ status: 503 });
    h.log.setMode("label");
    say(h.log, "첫 말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 25; i += 1) say(h.log, `말 ${i}`);
    await h.timers.advance(LIVE_LOG_RETRY_MS - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("끝나지 않는 fetch는 10초 뒤 끊고 실패로 본다. 5초 뒤 같은 묶음을 다시 보낸다", async () => {
    const h = harness();
    h.log.setMode("label");
    const signals: (AbortSignal | undefined | null)[] = [];
    h.fetchFn.mockImplementationOnce(async (_url, init) => {
      h.sent.push(JSON.parse(String(init?.body)) as LiveLogRequest);
      signals.push(init?.signal);
      return new Promise<Response>(() => {});
    });
    say(h.log, "말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(LIVE_LOG_SEND_TIMEOUT_MS - 1);
    expect(signals[0]?.aborted).toBe(false);
    await h.timers.advance(1);
    expect(signals[0]?.aborted).toBe(true);
    await h.timers.advance(LIVE_LOG_RETRY_MS - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    expect(h.sent[1].entries).toEqual(h.sent[0].entries);
    expect(h.stored).toEqual([1]);
  });

  it("떠날 때 보내는 keepalive 요청에는 시간 제한을 걸지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.fetchFn.mockImplementationOnce(async () => new Promise<Response>(() => {}));
    say(h.log, "떠남");
    h.log.flush(true);
    await h.timers.advance(LIVE_LOG_SEND_TIMEOUT_MS * 3);
    expect(h.fetchFn).toHaveBeenCalledTimes(1); // 끊고 다시 보내지 않는다
  });

  it("no_device 다시 보내기 횟수는 묶음마다 센다: 떠날 때 3묶음을 동시에 보내 모두 no_device를 받아도 버려지는 묶음이 없다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.fetchFn.mockImplementationOnce(async () => new Promise<Response>(() => {})); // 평소 첫 묶음(20줄)은 끝나지 않는다
    const mid = "가".repeat(60);
    for (let i = 0; i < 80; i += 1) say(h.log, `${i} ${mid}`);
    await settle();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    h.plan.push(
      { json: { stored: 0, reason: "no_device" } }, // 끝나지 않는 평소 묶음의 사본(떠날 때 한 번 더 보낸 것)
      { json: { stored: 0, reason: "no_device" } },
      { json: { stored: 0, reason: "no_device" } },
      { json: { stored: 0, reason: "no_device" } },
    );
    h.log.flush(true); // 사본 1개 + 남은 60줄 = 20줄씩 3묶음
    await settle();
    expect(h.fetchFn).toHaveBeenCalledTimes(5);
    expect(h.inits.filter((i) => i.keepalive === true)).toHaveLength(4);
    await h.timers.advance(60_000);
    const sentAgain = h.sent.slice(4).flatMap((r) => r.entries.map((e) => e.seq));
    expect(new Set(sentAgain).size).toBe(80); // 0~79 모두 다시 나갔다(버려진 묶음 없음)
  });

  it("떠날 때 flush(true)를 여러 번 불러도 응답이 안 온 keepalive 본문 합계는 한도(약 32KB)를 넘지 않고, 남은 줄은 버리지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    const resolvers: (() => void)[] = [];
    h.fetchFn.mockImplementation(async (_url, init) => {
      const req = JSON.parse(String(init?.body)) as LiveLogRequest;
      h.sent.push(req);
      h.inits.push(init ?? {});
      await new Promise<void>((r) => resolvers.push(r));
      return new Response(JSON.stringify({ stored: req.entries.length, reason: "saved" }), { status: 200 });
    });
    const long = "가".repeat(900); // 한 줄이 JSON으로 약 2.9KB
    for (let i = 0; i < 100; i += 1) say(h.log, `${i} ${long}`);
    h.log.flush(true);
    h.log.flush(true);
    h.log.flush(true);
    await settle();
    const bytes = (init: RequestInit) => new TextEncoder().encode(String(init.body)).length;
    const keep = h.inits.filter((i) => i.keepalive === true);
    const total = keep.reduce((n, i) => n + bytes(i), 0);
    expect(keep.length).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(LIVE_LOG_LEAVE_BYTES);
    expect(total).toBeGreaterThan(LIVE_LOG_CLIENT_BYTES);
    expect(h.inits.filter((i) => i.keepalive !== true)).toHaveLength(1); // 평소 전송은 keepalive가 아니다
    // 남은 줄은 큐에 있다가 응답이 오면 평소 전송으로 나간다(버려지지 않는다).
    for (let i = 0; i < 60; i += 1) {
      while (resolvers.length > 0) resolvers.shift()?.();
      await h.timers.advance(2000);
    }
    expect(new Set(h.sent.flatMap((r) => r.entries.map((e) => e.seq))).size).toBe(100);
  });

  it("200 unavailable(표가 아직 없음)은 실패와 같이 되돌려 놓고 5초, 5초, 그 뒤 30초 쉬며 다시 보낸다. onStored는 부르지 않는다", async () => {
    const h = harness();
    h.plan.push(
      { json: { stored: 0, reason: "unavailable" } },
      { json: { stored: 0, reason: "unavailable" } },
      { json: { stored: 0, reason: "unavailable" } },
    );
    h.log.setMode("label");
    say(h.log, "표가 없을 때의 말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(LIVE_LOG_RETRY_MS - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    await h.timers.advance(LIVE_LOG_RETRY_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    await h.timers.advance(LIVE_LOG_REST_MS - 1);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    expect(h.stored).toEqual([]);
    await h.timers.advance(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(4);
    expect(h.sent[3].entries).toEqual(h.sent[0].entries); // 같은 묶음이 빠지지 않고 다시 갔다
    expect(h.stored).toEqual([1]);
  });

  it("쉬는 중(연속 실패)에는 flush(true)를 5번 불러도 그 쉬는 구간 안의 떠날 때 요청은 한 차례뿐이고, 구간이 끝나 다시 실패하면 한 차례 더 허용한다", async () => {
    const h = harness();
    for (let i = 0; i < 50; i += 1) h.plan.push({ status: 503 });
    h.log.setMode("label");
    say(h.log, "말 하나");
    say(h.log, "말 둘");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS); // 평소 전송 1번째 실패 → 5초 쉼
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    const leavingCount = () => h.inits.filter((i) => i.keepalive === true).length;
    for (let i = 0; i < 5; i += 1) {
      h.log.flush(true);
      await settle();
    }
    expect(leavingCount()).toBe(1);
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    // 쉬는 구간이 끝나면 재시도 타이머가 평소 전송을 하고, 다시 실패해 새 구간이 시작된다.
    await h.timers.advance(LIVE_LOG_REST_MS);
    const before = h.fetchFn.mock.calls.length;
    for (let i = 0; i < 5; i += 1) {
      h.log.flush(true);
      await settle();
    }
    expect(leavingCount()).toBe(2);
    expect(h.fetchFn.mock.calls.length).toBe(before + 1);
  });

  it("실패 상태가 아닐 때의 flush(true)는 평소처럼 부를 때마다 보낸다", async () => {
    const h = harness();
    h.log.setMode("label");
    for (let i = 0; i < 3; i += 1) {
      say(h.log, `말 ${i}`);
      h.log.flush(true);
      await settle();
    }
    expect(h.inits.filter((i) => i.keepalive === true)).toHaveLength(3);
  });

  it("응답을 못 받은 평소 묶음은 flush(true)에서 떠날 때 요청으로 먼저 한 번 더 보낸다. 두 번째 flush(true)에는 다시 보내지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    h.fetchFn.mockImplementationOnce(async (_url, init) => {
      h.sent.push(JSON.parse(String(init?.body)) as LiveLogRequest);
      h.inits.push(init ?? {});
      return new Promise<Response>(() => {}); // 끝나지 않는 평소 전송
    });
    say(h.log, "보내는 중인 말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    expect(h.inits[0].keepalive).toBe(false);
    say(h.log, "큐에 남은 말");
    h.log.flush(true);
    await settle();
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    expect(h.inits[1].keepalive).toBe(true);
    expect(h.inits[2].keepalive).toBe(true);
    expect(h.sent[1].entries.map((e) => e.body)).toEqual(["보내는 중인 말"]); // 사본이 먼저
    expect(h.sent[1].entries).toEqual(h.sent[0].entries); // 같은 cid·seq(서버가 한 번만 저장한다)
    expect(h.sent[2].entries.map((e) => e.body)).toEqual(["큐에 남은 말"]);
    h.log.flush(true);
    h.log.flush(true);
    await settle();
    expect(h.fetchFn).toHaveBeenCalledTimes(3); // 같은 묶음을 되풀이해 보내지 않는다
  });

  it("떠날 때 보낸 사본의 바이트도 한도(32KB) 계산에 들어간다", async () => {
    const h = harness();
    h.log.setMode("label");
    const resolvers: (() => void)[] = [];
    h.fetchFn.mockImplementation(async (_url, init) => {
      const req = JSON.parse(String(init?.body)) as LiveLogRequest;
      h.sent.push(req);
      h.inits.push(init ?? {});
      await new Promise<void>((r) => resolvers.push(r));
      return new Response(JSON.stringify({ stored: req.entries.length, reason: "saved" }), { status: 200 });
    });
    const long = "가".repeat(900);
    for (let i = 0; i < 100; i += 1) say(h.log, `${i} ${long}`);
    await settle();
    h.log.flush(true);
    h.log.flush(true);
    await settle();
    const total = h.inits.filter((i) => i.keepalive === true).reduce((n, i) => n + new TextEncoder().encode(String(i.body)).length, 0);
    expect(total).toBeLessThanOrEqual(LIVE_LOG_LEAVE_BYTES);
    expect(h.sent[1].entries).toEqual(h.sent[0].entries); // 첫 keepalive는 진행 중이던 평소 묶음의 사본
  });

  it("onStopped: off·ended·no_label·404 답으로 보내기를 멈출 때 한 번만 부른다", async () => {
    for (const first of [
      { json: { stored: 0, reason: "off" } },
      { json: { stored: 0, reason: "ended" } },
      { json: { stored: 0, reason: "no_label" } },
      { status: 404 },
    ] as Reply[]) {
      const h = harness();
      h.plan.push(first);
      h.log.setMode("label");
      say(h.log, "말");
      await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
      expect(h.stops.n, JSON.stringify(first)).toBe(1);
      say(h.log, "이후");
      h.log.flush(true);
      await h.timers.advance(60_000);
      expect(h.stops.n, JSON.stringify(first)).toBe(1);
    }
  });

  it("onNotStored: capped·failed·unavailable 답이면 부르고, 다시 저장되면 onStored가 불린다", async () => {
    for (const reason of ["capped", "failed", "unavailable"]) {
      const h = harness();
      h.plan.push({ json: { stored: 0, reason } });
      h.log.setMode("label");
      say(h.log, "말");
      await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
      expect(h.misses.n, reason).toBe(1);
      expect(h.stored, reason).toEqual([]);
      expect(h.stops.n, reason).toBe(0);
      say(h.log, "다음 말");
      await h.timers.advance(60_000);
      expect(h.stored.length, reason).toBeGreaterThan(0);
    }
  });

  it("onNotStored: 503·429·네트워크 오류·no_device처럼 지금 저장되지 않는 답에서도 부른다", async () => {
    for (const first of [{ status: 503 }, { status: 429 }, "network", { json: { stored: 0, reason: "no_device" } }] as Reply[]) {
      const h = harness();
      h.plan.push(first);
      h.log.setMode("label");
      say(h.log, "말");
      await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
      expect(h.misses.n, JSON.stringify(first)).toBeGreaterThan(0);
      expect(h.stored, JSON.stringify(first)).toEqual([]);
      await h.timers.advance(60_000);
      expect(h.stored.length, JSON.stringify(first)).toBeGreaterThan(0); // 다시 보내 저장되면 표시가 돌아온다
    }
  });

  it("onNotStored: 저장이 잘 되는 동안에는 부르지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    say(h.log, "말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.misses.n).toBe(0);
  });

  it("onStopped: 저장이 잘 되는 동안에는 부르지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    say(h.log, "말");
    await h.timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(h.stored).toEqual([1]);
    expect(h.stops.n).toBe(0);
  });
});

describe("createLiveLog: 던지지 않고 콘솔에 아무것도 찍지 않는다", () => {
  it("fetch가 바로 던져도, onStored가 던져도, 엉뚱한 입력에도 던지지 않고 콘솔이 조용하다", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const timers = makeTimers();
    const log = createLiveLog({
      fetch: (() => {
        throw new Error("sync boom");
      }) as unknown as typeof fetch,
      deviceReady: Promise.reject(new Error("no cookie")),
      timers,
      now: () => 0,
      label: "T01",
      onStored: () => {
        throw new Error("ui boom");
      },
    });
    log.setMode("label");
    say(log, "비밀 말");
    log.record(null as unknown as LiveEvent, null as unknown as LiveState, null as unknown as LiveEffect[]);
    log.record(heard("말 2"), st(), []);
    await timers.advance(LIVE_LOG_SEND_DELAY_MS);
    log.flush(true);
    log.flush();
    await timers.advance(100_000);
    log.dispose();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("onStored가 던져도 다음 보내기는 계속된다", async () => {
    const timers = makeTimers();
    const sent: number[] = [];
    const log = createLiveLog({
      fetch: (async () => {
        sent.push(1);
        return new Response(JSON.stringify({ stored: 1, reason: "saved" }), { status: 200 });
      }) as unknown as typeof fetch,
      deviceReady: Promise.resolve(),
      timers,
      now: () => 0,
      label: "T01",
      onStored: () => {
        throw new Error("ui boom");
      },
    });
    log.setMode("label");
    say(log, "하나");
    await timers.advance(LIVE_LOG_SEND_DELAY_MS);
    say(log, "둘");
    await timers.advance(LIVE_LOG_SEND_DELAY_MS);
    expect(sent).toHaveLength(2);
  });

  it("dispose 뒤에는 보내지 않는다", async () => {
    const h = harness();
    h.log.setMode("label");
    say(h.log, "말");
    h.log.dispose();
    await h.timers.advance(60_000);
    expect(h.fetchFn).not.toHaveBeenCalled();
  });
});
