import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEvent, LiveTurn } from "@/lib/liveEngine";
import { createFallbackEngine, resetFallbackPageState } from "@/lib/liveFallbackEngine";
import { SPEAK_RATES, createLiveSpeaker } from "@/lib/liveSpeaker";
import {
  createWakeLock,
  newConversationId,
  runStartClick,
  setAudioSession,
} from "@/lib/liveUnlock";

// fallback 엔진(설계서 6.2절), 읽어 주기(6.1절), 시작 잠금 해제(5.4절). 가짜 인식기·가짜 fetch로 돌리고 유료 호출은 0건이다.

interface ResultItem { t: string; final: boolean }

function makeRecClass(withStop: boolean) {
  return class FakeRec {
    static instances: FakeRec[] = [];
    lang = "";
    continuous = true;
    interimResults = false;
    maxAlternatives = 0;
    onstart: (() => void) | null = null;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    stopped = 0;
    aborted = 0;
    stop?: () => void;
    constructor() {
      FakeRec.instances.push(this);
      if (withStop) this.stop = () => { this.stopped += 1; };
    }
    start() { this.started = true; }
    abort() { this.aborted += 1; }
    // 시험 도우미
    result(items: ResultItem[]) {
      const results = items.map((i) => Object.assign([{ transcript: i.t }], { isFinal: i.final }));
      this.onresult?.({ results });
    }
  };
}

type RecClass = ReturnType<typeof makeRecClass>;

const SIGNAL = () => new AbortController().signal;

function setup(opts: { withStop?: boolean; noCtor?: boolean; fetch?: typeof fetch } = {}) {
  const Rec = makeRecClass(opts.withStop ?? true);
  const win = {
    document: { visibilityState: "visible" },
    navigator: { onLine: true },
    get localStorage(): never { throw new Error("기기 저장소를 읽으면 안 된다"); },
  } as Record<string, unknown>;
  if (!opts.noCtor) win.webkitSpeechRecognition = Rec;
  const engine = createFallbackEngine(win as unknown as Window, { fetch: opts.fetch });
  const events: EngineEvent[] = [];
  engine.on((e) => events.push(e));
  const last = () => Rec.instances[Rec.instances.length - 1] as InstanceType<RecClass>;
  const types = () => events.map((e) => e.type);
  return { engine, events, win, Rec, last, types };
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const flush = () => vi.advanceTimersByTimeAsync(1);

beforeEach(() => {
  vi.useFakeTimers();
  resetFallbackPageState();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fallback 엔진: 시작과 듣기", () => {
  it("인식기가 있으면 READY voice, 없으면 text와 speech_unavailable. 네트워크를 쓰지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const a = setup();
    await a.engine.start({ cid: "c", history: [], rate: "normal", signal: SIGNAL() });
    expect(a.events).toEqual([{ type: "READY", engine: "fallback", inputMode: "voice" }]);
    const b = setup({ noCtor: true });
    await b.engine.start({ cid: "c", history: [], rate: "normal", signal: SIGNAL() });
    expect(b.events).toEqual([
      { type: "READY", engine: "fallback", inputMode: "text", textReason: "speech_unavailable" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listen은 새 인식기를 ko-KR, continuous=false, interimResults=true로 연다", () => {
    const { engine, last } = setup();
    engine.listen();
    expect(last().started).toBe(true);
    expect(last().lang).toBe("ko-KR");
    expect(last().continuous).toBe(false);
    expect(last().interimResults).toBe(true);
    expect(last().maxAlternatives).toBe(1);
  });

  it("확정 결과 → USER_TURN_END. 첫 결과에서 USER_SPEECH_START는 한 번", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "무선 이어폰", final: false }]);
    last().result([{ t: "무선 이어폰 찾아줘", final: false }]);
    last().result([{ t: "무선 이어폰 찾아줘", final: true }]);
    last().onend?.();
    expect(events).toEqual([
      { type: "LISTEN_STARTED", late: false },
      { type: "USER_SPEECH_START" },
      { type: "USER_TRANSCRIPT", text: "무선 이어폰", final: false },
      { type: "USER_TRANSCRIPT", text: "무선 이어폰 찾아줘", final: false },
      { type: "USER_TURN_END", text: "무선 이어폰 찾아줘", transcribed: true },
    ]);
  });

  it("결과 없이 끝남 → NO_SPEECH", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().onend?.();
    expect(events.at(-1)).toEqual({ type: "NO_SPEECH" });
  });

  it("no-speech 오류는 표시만 하고 이어 오는 end가 NO_SPEECH를 낸다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().onerror?.({ error: "no-speech" });
    expect(events.map((e) => e.type)).toEqual(["LISTEN_STARTED"]);
    last().onend?.();
    expect(events.at(-1)).toEqual({ type: "NO_SPEECH" });
  });

  it("onstart → late:false, 2초 뒤의 onstart → late:true", () => {
    const a = setup();
    a.engine.listen();
    a.last().onstart?.();
    expect(a.events[0]).toEqual({ type: "LISTEN_STARTED", late: false });
    const b = setup();
    b.engine.listen();
    vi.advanceTimersByTime(2000);
    b.last().onstart?.();
    expect(b.events[0]).toEqual({ type: "LISTEN_STARTED", late: true });
  });

  it("시작 감시: 처음에는 60초, onstart를 한 번 받은 뒤에는 3초. 기기 저장소를 읽지 않는다", () => {
    const first = setup();
    first.engine.listen();
    vi.advanceTimersByTime(59_999);
    expect(first.events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(first.events).toEqual([{ type: "NO_SPEECH" }]);
    expect(first.last().aborted).toBe(1);

    // 이 페이지에서 onstart를 한 번 받았다.
    const warm = setup();
    warm.engine.listen();
    warm.last().onstart?.();
    warm.last().onend?.();

    const later = setup();
    later.engine.listen();
    vi.advanceTimersByTime(2_999);
    expect(later.events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(later.events).toEqual([{ type: "NO_SPEECH" }]);
  });

  it("시작 감시가 연속 2회면 FAILED speech_unavailable", () => {
    const { engine, events } = setup();
    engine.listen();
    vi.advanceTimersByTime(60_000);
    engine.listen();
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([{ type: "NO_SPEECH" }, { type: "FAILED", kind: "speech_unavailable" }]);
  });

  it("onstart가 오면 실패 횟수가 0으로 돌아간다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    vi.advanceTimersByTime(60_000);
    engine.listen();
    last().onstart?.();
    last().onend?.();
    engine.listen();
    vi.advanceTimersByTime(3_000);
    expect(events.filter((e) => e.type === "FAILED")).toEqual([]);
  });

  it("듣기 감시: 15초가 지나면 submit()과 같게 끝낸다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "전기밥솥", final: false }]);
    vi.advanceTimersByTime(15_000);
    expect(last().stopped).toBe(1);
    last().result([{ t: "전기밥솥", final: true }]);
    last().onend?.();
    expect(events.at(-1)).toEqual({ type: "USER_TURN_END", text: "전기밥솥", transcribed: true });
  });
});

describe("fallback 엔진: 오류 코드", () => {
  it("not-allowed 첫 번째는 mic_blocked, 두 번째는 mic_denied", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onerror?.({ error: "not-allowed" });
    engine.listen();
    last().onerror?.({ error: "not-allowed" });
    expect(events).toEqual([
      { type: "FAILED", kind: "mic_blocked" },
      { type: "FAILED", kind: "mic_denied" },
    ]);
  });

  it("audio-capture도 같은 순서로 센다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onerror?.({ error: "audio-capture" });
    expect(events).toEqual([{ type: "FAILED", kind: "mic_blocked" }]);
  });

  it("페이지가 숨겨진 때의 not-allowed는 사건이 없고 blockedOnce도 올리지 않는다", () => {
    const { engine, events, last, win } = setup();
    (win.document as { visibilityState: string }).visibilityState = "hidden";
    engine.listen();
    last().onerror?.({ error: "not-allowed" });
    last().onend?.();
    expect(events).toEqual([]);
    (win.document as { visibilityState: string }).visibilityState = "visible";
    engine.listen();
    last().onerror?.({ error: "not-allowed" });
    expect(events).toEqual([{ type: "FAILED", kind: "mic_blocked" }]);
  });

  it("service-not-allowed → speech_unavailable", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onerror?.({ error: "service-not-allowed" });
    expect(events).toEqual([{ type: "FAILED", kind: "speech_unavailable" }]);
  });

  it("network 같은 그 밖의 오류는 실패 1회로 센다. 연속 2회면 speech_unavailable", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onerror?.({ error: "network" });
    last().onend?.();
    engine.listen();
    last().onerror?.({ error: "network" });
    expect(events).toEqual([{ type: "NO_SPEECH" }, { type: "FAILED", kind: "speech_unavailable" }]);
  });
});

describe("fallback 엔진: hold와 submit", () => {
  it("hold() 뒤 submit() → 붙든 글로 USER_TURN_END. stop이 있으면 stop을 부른다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "흰색 이어폰", final: true }]);
    engine.hold();
    expect(last().stopped).toBe(1);
    last().onend?.();
    expect(events.map((e) => e.type)).not.toContain("USER_TURN_END");
    engine.submit();
    expect(events.at(-1)).toEqual({ type: "USER_TURN_END", text: "흰색 이어폰", transcribed: true });
  });

  it("hold() 중 stop 뒤에 확정 글이 오면 붙든 글이 그 글로 바뀐다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "흰색 이", final: false }]);
    engine.hold();
    last().result([{ t: "흰색 이어폰", final: true }]);
    last().onend?.();
    engine.submit();
    expect(events.at(-1)).toEqual({ type: "USER_TURN_END", text: "흰색 이어폰", transcribed: true });
  });

  it("hold()에 확정 글이 없으면 마지막 중간 글을 붙든다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "검정색 말고", final: false }]);
    engine.hold();
    last().onend?.();
    engine.submit();
    expect(events.at(-1)).toEqual({ type: "USER_TURN_END", text: "검정색 말고", transcribed: true });
  });

  it("들은 것이 없는 hold() 뒤 submit() → NO_SPEECH", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    engine.hold();
    engine.submit();
    expect(events.at(-1)).toEqual({ type: "NO_SPEECH" });
  });

  it("stop이 없는 인식기에서도 동작한다(hold는 abort, submit은 마지막 중간 글)", () => {
    const a = setup({ withStop: false });
    a.engine.listen();
    a.last().onstart?.();
    a.last().result([{ t: "가방", final: false }]);
    a.engine.hold();
    expect(a.last().aborted).toBe(1);
    a.engine.submit();
    expect(a.events.at(-1)).toEqual({ type: "USER_TURN_END", text: "가방", transcribed: true });

    const b = setup({ withStop: false });
    b.engine.listen();
    b.last().onstart?.();
    b.last().result([{ t: "지갑", final: false }]);
    b.engine.submit();
    expect(b.last().aborted).toBe(1);
    expect(b.events.at(-1)).toEqual({ type: "USER_TURN_END", text: "지갑", transcribed: true });

    const c = setup({ withStop: false });
    c.engine.listen();
    c.last().onstart?.();
    c.engine.submit();
    expect(c.events.at(-1)).toEqual({ type: "NO_SPEECH" });
  });

  it("listen({keep:true})는 붙든 글을 이어 붙인다. keep이 아니면 버린다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "이어폰", final: true }]);
    engine.hold();
    last().onend?.();
    engine.listen({ keep: true });
    last().onstart?.();
    last().result([{ t: "흰색으로", final: true }]);
    last().onend?.();
    expect(events.at(-1)).toEqual({ type: "USER_TURN_END", text: "이어폰 흰색으로", transcribed: true });

    engine.listen();
    last().onstart?.();
    last().result([{ t: "처음부터", final: true }]);
    engine.hold();
    last().onend?.();
    engine.listen();
    engine.submit();
    last().onend?.();
    expect(events.at(-1)).toEqual({ type: "NO_SPEECH" });
  });

  it("submit()에서 stop 뒤 끝남 신호가 없으면 3초 뒤 들은 글로 끝낸다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "우산", final: false }]);
    engine.submit();
    expect(last().stopped).toBe(1);
    vi.advanceTimersByTime(3_000);
    expect(events.at(-1)).toEqual({ type: "USER_TURN_END", text: "우산", transcribed: true });
  });

  it("cancelListen은 인식을 끊고 사건을 내지 않는다. discard가 참이면 붙든 글도 버린다", () => {
    const { engine, events, last } = setup();
    engine.listen();
    last().onstart?.();
    last().result([{ t: "신발", final: true }]);
    engine.cancelListen(true);
    last().onend?.();
    expect(last().aborted).toBe(1);
    expect(events.map((e) => e.type)).toEqual(["LISTEN_STARTED", "USER_SPEECH_START"]);
  });
});

describe("fallback 엔진: respond", () => {
  const history: LiveTurn[] = [{ role: "assistant", content: "안내" }];

  it("요청 본문의 history에 이번 message가 없다. 성공 → TURN_RESULT 하나", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ reply: "어떤 점이 궁금하세요?", status: "asking", slots: { product: "이어폰", info: 7 } }),
    );
    const { engine, events } = setup({ fetch: fetchMock as unknown as typeof fetch });
    await engine.start({ cid: "cid-1", history: [], rate: "normal", signal: SIGNAL() });
    engine.respond({ text: "이어폰 찾아줘", source: "voice" }, history);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/live/chat");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ sessionId: "cid-1", message: "이어폰 찾아줘", history });
    expect(JSON.stringify(body.history)).not.toContain("이어폰 찾아줘");
    expect(events.filter((e) => e.type === "TURN_RESULT")).toEqual([
      {
        type: "TURN_RESULT",
        reply: "어떤 점이 궁금하세요?",
        status: "asking",
        slots: { product: "이어폰", info: "", options: "", budget: "" },
      },
    ]);
  });

  it("history는 뒤에서 34칸만 보낸다", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reply: "", status: "confirming", slots: {} }));
    const { engine } = setup({ fetch: fetchMock as unknown as typeof fetch });
    const long: LiveTurn[] = Array.from({ length: 40 }, (_, i) => ({ role: "user", content: `말${i}` }));
    engine.respond({ text: "다음", source: "text" }, long);
    await flush();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.history).toEqual(long.slice(-34));
    expect(body.history).toHaveLength(34);
  });

  const table: Array<[string, number, unknown, Record<string, string>, EngineEvent]> = [
    ["429 rate_limited(Retry-After 7)", 429, { code: "rate_limited" }, { "Retry-After": "7" }, { type: "FAILED", kind: "rate_limited", retryAfterMs: 7000 }],
    ["429 rate_limited(Retry-After 없음)", 429, { code: "rate_limited" }, {}, { type: "FAILED", kind: "rate_limited", retryAfterMs: 5000 }],
    ["429 daily_cap", 429, { code: "daily_cap" }, {}, { type: "FAILED", kind: "unavailable_today" }],
    ["429 budget", 429, { code: "budget" }, {}, { type: "FAILED", kind: "unavailable_today" }],
    ["400 bad_request", 400, { code: "bad_request" }, {}, { type: "FAILED", kind: "bad_request" }],
    ["413 too_large", 413, { code: "too_large" }, {}, { type: "FAILED", kind: "bad_request" }],
    ["503 not_configured", 503, { code: "not_configured" }, {}, { type: "FAILED", kind: "not_configured" }],
    ["404 disabled", 404, { code: "disabled" }, {}, { type: "FAILED", kind: "not_configured" }],
    ["504 timeout", 504, { code: "timeout" }, {}, { type: "FAILED", kind: "timeout" }],
    ["502 failed", 502, { code: "failed" }, {}, { type: "FAILED", kind: "failed" }],
    ["본문 없는 500", 500, null, {}, { type: "FAILED", kind: "failed" }],
  ];
  it.each(table)("오류 표: %s", async (_name, status, body, headers, expected) => {
    const fetchMock = vi.fn(async () => jsonResponse(body, status, headers));
    const { engine, events } = setup({ fetch: fetchMock as unknown as typeof fetch });
    engine.respond({ text: "말", source: "voice" }, []);
    await flush();
    expect(events).toEqual([expected]);
  });

  it("네트워크 오류: onLine이 거짓이면 offline, 참이면 failed", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const a = setup({ fetch: fetchMock as unknown as typeof fetch });
    (a.win.navigator as { onLine: boolean }).onLine = false;
    a.engine.respond({ text: "말", source: "voice" }, []);
    await flush();
    expect(a.events).toEqual([{ type: "FAILED", kind: "offline" }]);
    const b = setup({ fetch: fetchMock as unknown as typeof fetch });
    b.engine.respond({ text: "말", source: "voice" }, []);
    await flush();
    expect(b.events).toEqual([{ type: "FAILED", kind: "failed" }]);
  });

  it("모양이 틀린 200 응답은 failed", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reply: "안녕", status: "weird", slots: {} }));
    const { engine, events } = setup({ fetch: fetchMock as unknown as typeof fetch });
    engine.respond({ text: "말", source: "voice" }, []);
    await flush();
    expect(events).toEqual([{ type: "FAILED", kind: "failed" }]);
  });

  it("28초에 끊고 FAILED timeout. 늦게 온 응답은 버린다", async () => {
    let signal: AbortSignal | undefined;
    let resolve: (r: Response) => void = () => {};
    const fetchMock = vi.fn((_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((r) => { resolve = r; });
    });
    const { engine, events } = setup({ fetch: fetchMock as unknown as typeof fetch });
    engine.respond({ text: "말", source: "voice" }, []);
    await vi.advanceTimersByTimeAsync(27_999);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ type: "FAILED", kind: "timeout" }]);
    expect(signal?.aborted).toBe(true);
    resolve(jsonResponse({ reply: "늦음", status: "asking", slots: {} }));
    await flush();
    expect(events).toHaveLength(1);
  });

  it("cancelResponse는 끊긴 응답의 사건을 내지 않는다", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolve = r; }));
    const { engine, events } = setup({ fetch: fetchMock as unknown as typeof fetch });
    engine.respond({ text: "말", source: "voice" }, []);
    engine.cancelResponse();
    resolve(jsonResponse({ reply: "x", status: "asking", slots: {} }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events).toEqual([]);
  });

  it("기본 fetch는 전역 fetch를 부를 때 찾는다", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reply: "네", status: "asking", slots: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const { engine, events } = setup();
    engine.respond({ text: "말", source: "voice" }, []);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events[0]?.type).toBe("TURN_RESULT");
  });

  it("close는 여러 번 불러도 안전하고 이후 사건이 없다. toolResult와 setRate는 아무 일도 안 한다", async () => {
    const { engine, events, last } = setup();
    engine.listen();
    engine.close();
    engine.close();
    last().onerror?.({ error: "network" });
    engine.listen();
    engine.toolResult("c", {}, true);
    engine.setRate("fast");
    expect(events).toEqual([]);
  });

  it("start에 이미 끊긴 signal이 오면 READY를 내지 않고 닫는다", async () => {
    const { engine, events } = setup();
    const ac = new AbortController();
    ac.abort();
    await engine.start({ cid: "c", history: [], rate: "normal", signal: ac.signal });
    expect(events).toEqual([]);
  });
});

describe("liveSpeaker", () => {
  function fakeWin() {
    const spoken: Array<{ text: string; lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null }> = [];
    const synth = { speak: vi.fn((u: (typeof spoken)[number]) => { spoken.push(u); }), cancel: vi.fn() };
    class Utterance {
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    return { win: { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance } as unknown as Window, spoken, synth };
  }

  it("ko-KR로 읽고 onend와 onerror 둘 다 끝으로 본다", () => {
    const { win, spoken, synth } = fakeWin();
    const speaker = createLiveSpeaker(win);
    const ended: string[] = [];
    speaker.speak("a", "안녕하세요", (id) => ended.push(id));
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(spoken[0].lang).toBe("ko-KR");
    expect(spoken[0].rate).toBe(SPEAK_RATES.normal);
    spoken[0].onend?.();
    speaker.speak("b", "다시", (id) => ended.push(id));
    spoken[1].onerror?.();
    expect(ended).toEqual(["a", "b"]);
  });

  it("speak는 호출 스택 안에서 바로 speechSynthesis.speak를 부른다", () => {
    const { win, synth } = fakeWin();
    createLiveSpeaker(win).speak("a", "시작 안내", () => {});
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("앞의 읽기를 끊고, 낡은 콜백은 버린다. 같은 읽기의 끝은 한 번만 알린다", () => {
    const { win, spoken } = fakeWin();
    const speaker = createLiveSpeaker(win);
    const ended: string[] = [];
    speaker.speak("a", "첫째", (id) => ended.push(id));
    speaker.speak("b", "둘째", (id) => ended.push(id));
    spoken[0].onend?.();
    expect(ended).toEqual([]);
    spoken[1].onend?.();
    spoken[1].onerror?.();
    vi.advanceTimersByTime(60_000);
    expect(ended).toEqual(["b"]);
  });

  it("stop은 cancel을 부르고 onEnd를 부르지 않는다", () => {
    const { win, spoken, synth } = fakeWin();
    const speaker = createLiveSpeaker(win);
    const onEnd = vi.fn();
    speaker.speak("a", "읽는 중", onEnd);
    speaker.stop();
    spoken[0].onend?.();
    vi.advanceTimersByTime(60_000);
    expect(synth.cancel).toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("끝남 신호가 없으면 글자 수 × 250ms + 3000ms 뒤에 끝으로 본다", () => {
    const { win } = fakeWin();
    const speaker = createLiveSpeaker(win);
    const onEnd = vi.fn();
    speaker.speak("a", "가나다라마", onEnd); // 5자 → 4250ms
    vi.advanceTimersByTime(4_249);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith("a");
  });

  it("setRate는 다음 읽기부터 적용된다", () => {
    const { win, spoken } = fakeWin();
    const speaker = createLiveSpeaker(win);
    speaker.setRate("slow");
    speaker.speak("a", "천천히", () => {});
    speaker.setRate("fast");
    speaker.speak("b", "빠르게", () => {});
    expect([spoken[0].rate, spoken[1].rate]).toEqual([0.8, 1.15]);
  });

  it("speechSynthesis가 없으면 available가 거짓이고 끝을 알려 멈추지 않게 한다", () => {
    const speaker = createLiveSpeaker({} as unknown as Window);
    expect(speaker.available).toBe(false);
    const onEnd = vi.fn();
    speaker.speak("a", "안내", onEnd);
    vi.advanceTimersByTime(0);
    expect(onEnd).toHaveBeenCalledWith("a");
    expect(() => speaker.stop()).not.toThrow();
  });
});

describe("liveUnlock", () => {
  it("setAudioSession: 있으면 type을 바꾸고, 없거나 던져도 무시한다", () => {
    const nav = { audioSession: { type: "auto" } };
    setAudioSession("playback", nav);
    expect(nav.audioSession.type).toBe("playback");
    expect(() => setAudioSession("auto", {})).not.toThrow();
    const throwing = {
      get audioSession(): never { throw new Error("막힘"); },
    };
    expect(() => setAudioSession("playback", throwing)).not.toThrow();
  });

  it("newConversationId: randomUUID가 없으면 getRandomValues로 UUID v4를 만든다", () => {
    const fake = { getRandomValues: (a: Uint8Array) => { a.fill(255); return a; } };
    const id = newConversationId(fake);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newConversationId({ randomUUID: () => "uuid-1" })).toBe("uuid-1");
    expect(newConversationId({})).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("runStartClick: pushState → 신호음 잠금 해제 → audioSession → START 순서", () => {
    const order: string[] = [];
    const pushed = runStartClick({
      pushed: false,
      pushState: () => order.push("push"),
      earcons: { unlock: () => order.push("unlock") },
      setAudioSession: (t) => order.push(`session:${t}`),
      dispatchStart: () => order.push("start"),
    });
    expect(order).toEqual(["push", "unlock", "session:playback", "start"]);
    expect(pushed).toBe(true);
  });

  it("runStartClick: 이미 pushState를 했으면 다시 하지 않고, 앞 단계가 던져도 START는 보낸다", () => {
    const push = vi.fn();
    const start = vi.fn();
    const pushed = runStartClick({
      pushed: true,
      pushState: push,
      earcons: { unlock: () => { throw new Error("막힘"); } },
      setAudioSession: () => { throw new Error("막힘"); },
      dispatchStart: start,
    });
    expect(push).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(pushed).toBe(true);
    const failed = runStartClick({
      pushed: false,
      pushState: () => { throw new Error("막힘"); },
      earcons: { unlock: () => {} },
      setAudioSession: () => {},
      dispatchStart: start,
    });
    expect(failed).toBe(false);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("createWakeLock: 켜면 요청하고, 끄면 놓는다. 없거나 실패해도 던지지 않는다", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    const set = createWakeLock({ wakeLock: { request } });
    set(true);
    set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    set(false);
    expect(release).toHaveBeenCalledTimes(1);

    // 켜는 중에 꺼 달라고 하면 받자마자 놓는다.
    const quick = createWakeLock({ wakeLock: { request } });
    quick(true);
    quick(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledTimes(2);

    expect(() => createWakeLock({})(true)).not.toThrow();
    const rejecting = createWakeLock({ wakeLock: { request: async () => { throw new Error("거절"); } } });
    expect(() => rejecting(true)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
