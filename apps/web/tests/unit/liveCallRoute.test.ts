import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REALTIME_INSTRUCTIONS, LIVE_TOOLS } from "@/lib/liveInstructions";

// POST /api/live/call, POST /api/live/hangup, liveRealtimeSession(세션 설정, 통화 장부, 하루 자리, 예약 끊기). 설계서 7.4~7.6절, 13절, 16.1절.
// OpenAI로 가는 fetch는 모두 가짜다. 라우트의 제한기와 카운터는 모듈 메모리라 시험마다 모듈을 새로 불러온다.
// 예약 끊기가 280초 잠들기를 시작하므로 setTimeout을 가짜로 바꾼다(시험이 실제로 잠들지 않는다).

const ORIGIN = "http://localhost:3000";
const OFFER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n";
const ANSWER = "v=0\r\no=- 9 9 IN IP4 203.0.113.9\r\ns=ANSWER-SDP\r\n";
const freshClient = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type CallRoute = typeof import("@/app/api/live/call/route");
type HangupRoute = typeof import("@/app/api/live/hangup/route");
type Session = typeof import("@/lib/liveRealtimeSession");
type Config = typeof import("@/lib/liveConfig");
let call: CallRoute;
let hangup: HangupRoute;
let session: Session;
let config: Config;
let fetchMock: ReturnType<typeof vi.fn>;
let nextCallId = 0;

/** 통화 만들기에 성공한 OpenAI 응답. answer SDP가 본문이고 call_id는 Location에 있다. */
function openaiOk(location: string | null = `/v1/realtime/calls/rtc_call_${++nextCallId}`) {
  return new Response(ANSWER, { status: 201, headers: location === null ? {} : { location } });
}

/** 통화 만들기(…/calls)로 간 fetch 호출만. 끊기(…/hangup)는 뺀다. */
const createCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === CALLS_URL);
const hangupCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/hangup"));

function callRequest(
  o: { body?: string; type?: string | null; client?: string; query?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { "x-forwarded-for": o.client ?? freshClient(), ...(o.headers ?? {}) };
  if (o.type !== null) headers["content-type"] = o.type ?? "application/sdp";
  return new NextRequest(`${ORIGIN}/api/live/call${o.query ?? ""}`, {
    method: "POST",
    body: o.body ?? OFFER,
    headers,
  });
}

function hangupRequest(body: unknown, client: string = freshClient()) {
  return new NextRequest(`${ORIGIN}/api/live/hangup`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client, "content-type": "text/plain" },
  });
}

type Json = Record<string, unknown>;
const json = async (response: Response) => (await response.json()) as Json;
const flush = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};
/** 통화를 하나 만들고 JSON을 돌려준다. */
async function makeCall(o: Parameters<typeof callRequest>[0] = {}) {
  const response = await call.POST(callRequest(o));
  return { response, body: await json(response) };
}
/** session JSON을 필드 이름으로 읽기 위한 느슨한 모양(시험 전용). */
type LooseSession = {
  [key: string]: unknown;
  tools: { name: string }[];
  audio: {
    input: { [key: string]: unknown; turn_detection: object };
    output: { speed: number };
  };
};
/** OpenAI로 나간 session JSON. */
function sentSession(index = 0): Json {
  const form = createCalls()[index][1].body as FormData;
  return JSON.parse(form.get("session") as string) as Json;
}

beforeEach(async () => {
  vi.resetModules();
  nextCallId = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (const name of [
    "LIVE_ENABLED",
    "LLM_MODE",
    "LIVE_REAL_CALL_BUDGET",
    "LIVE_DAILY_SESSION_CAP",
    "LIVE_MAX_SESSION_SEC",
    "LIVE_REALTIME_MODEL",
    "LIVE_REALTIME_VAD",
    "LIVE_REALTIME_REASONING",
    "LIVE_ASK_NAME",
    "LIVE_TRANSCRIBE_LANG",
    "LIVE_CALL_IP_LIMIT",
  ]) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("LIVE_REALTIME", "on");
  vi.stubEnv("OPENAI_API_KEY", "test-key-not-real");
  fetchMock = vi.fn(async (url: unknown) => (String(url).endsWith("/hangup") ? new Response("", { status: 200 }) : openaiOk()));
  vi.stubGlobal("fetch", fetchMock);
  call = await import("@/app/api/live/call/route");
  hangup = await import("@/app/api/live/hangup/route");
  session = await import("@/lib/liveRealtimeSession");
  config = await import("@/lib/liveConfig");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/live/call 검사 순서(7.4절 표)", () => {
  it("라우트 설정: nodejs, force-dynamic, maxDuration 300 / hangup은 15", () => {
    expect(call.runtime).toBe("nodejs");
    expect(call.dynamic).toBe("force-dynamic");
    expect(call.maxDuration).toBe(300);
    expect(hangup.runtime).toBe("nodejs");
    expect(hangup.maxDuration).toBe(15);
  });

  it("1. 꺼져 있으면 404 disabled이고 fetch 0회", async () => {
    vi.stubEnv("LIVE_ENABLED", "off");
    const response = await call.POST(callRequest());
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ ok: false, error: "disabled" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("1. 운영(VERCEL_ENV=production)에서 LIVE_ENABLED가 없으면 404, on이면 열림", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await call.POST(callRequest())).status).toBe(404);
    vi.stubEnv("LIVE_ENABLED", "on");
    expect((await call.POST(callRequest())).status).toBe(200);
  });

  it("2. Content-Type이 application/sdp가 아니면 415 unsupported", async () => {
    for (const type of ["text/plain", "application/json", null]) {
      const response = await call.POST(callRequest({ type }));
      expect(response.status).toBe(415);
      expect(await json(response)).toEqual({ ok: false, error: "unsupported" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // charset가 붙어도 된다.
    expect((await call.POST(callRequest({ type: "application/sdp; charset=utf-8" }))).status).toBe(200);
  });

  it("3. Origin이 다른 사이트면 403 forbidden, 같은 출처이거나 없으면 통과", async () => {
    const bad = await call.POST(callRequest({ headers: { origin: "https://evil.example" } }));
    expect(bad.status).toBe(403);
    expect(await json(bad)).toEqual({ ok: false, error: "forbidden" });
    expect((await call.POST(callRequest({ headers: { origin: "null" } }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await call.POST(callRequest({ headers: { origin: ORIGIN } }))).status).toBe(200);
    expect((await call.POST(callRequest())).status).toBe(200);
  });

  it("앞 검사가 먼저다: 1 > 2 > 3", async () => {
    vi.stubEnv("LIVE_ENABLED", "off");
    expect((await call.POST(callRequest({ type: "text/plain" }))).status).toBe(404);
    vi.stubEnv("LIVE_ENABLED", undefined);
    expect((await call.POST(callRequest({ type: "text/plain", headers: { origin: "https://evil.example" } }))).status).toBe(415);
  });

  it("4. IP당 3회/10분: 4번째는 200 fallback rate_limited이고 OpenAI는 3회만. 403은 횟수를 쓰지 않는다", async () => {
    const client = freshClient();
    for (let i = 0; i < 3; i += 1) {
      expect((await call.POST(callRequest({ client, headers: { origin: "https://evil.example" } }))).status).toBe(403);
    }
    for (let i = 0; i < 3; i += 1) expect((await makeCall({ client })).body.engine).toBe("realtime");
    // 4번째는 큰 본문이어도 413보다 제한이 먼저다.
    const fourth = await call.POST(callRequest({ client, body: `v=0${"x".repeat(20_000)}` }));
    expect(fourth.status).toBe(200);
    expect(await json(fourth)).toEqual({ engine: "fallback", reason: "rate_limited" });
    expect(createCalls()).toHaveLength(3);
    // 다른 IP는 영향이 없다.
    expect((await makeCall()).body.engine).toBe("realtime");
  });

  it("5. 본문 16,384바이트 이하: 16,385바이트는 413 too_large", async () => {
    const ok = await call.POST(callRequest({ body: `v=0${"x".repeat(16_384 - 3)}` }));
    expect(ok.status).toBe(200);
    const big = await call.POST(callRequest({ body: `v=0${"x".repeat(16_384 - 2)}` }));
    expect(big.status).toBe(413);
    expect(await json(big)).toEqual({ ok: false, error: "too_large" });
    expect(createCalls()).toHaveLength(1);
  });

  it("6. 본문이 v=0으로 시작하지 않으면 400 invalid_sdp", async () => {
    for (const body of ["hello", "", " v=0\r\n"]) {
      const response = await call.POST(callRequest({ body }));
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ ok: false, error: "invalid_sdp" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("7. LIVE_REALTIME 없음·mock·키 없음이면 200 fallback이고 fetch 0회", async () => {
    vi.stubEnv("LIVE_REALTIME", undefined);
    expect(await json(await call.POST(callRequest()))).toEqual({ engine: "fallback", reason: "disabled" });
    vi.stubEnv("LIVE_REALTIME", "off");
    expect(await json(await call.POST(callRequest()))).toEqual({ engine: "fallback", reason: "disabled" });
    vi.stubEnv("LIVE_REALTIME", "on");
    vi.stubEnv("LLM_MODE", "mock");
    expect(await json(await call.POST(callRequest()))).toEqual({ engine: "fallback", reason: "mock" });
    vi.stubEnv("LLM_MODE", undefined);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await json(await call.POST(callRequest()))).toEqual({ engine: "fallback", reason: "no_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("7. 게이트에 걸린 요청은 하루 자리와 예산을 쓰지 않는다", async () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "1");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "100");
    vi.stubEnv("LIVE_REALTIME", undefined);
    for (let i = 0; i < 3; i += 1) await call.POST(callRequest());
    expect(config.realCallsLeft()).toBe(100);
    vi.stubEnv("LIVE_REALTIME", "on");
    expect((await makeCall()).body.engine).toBe("realtime");
  });

  it("8. 하루 상한: 기본 10회, 11번째는 200 fallback daily_cap이고 OpenAI는 10회만", async () => {
    for (let i = 0; i < 10; i += 1) expect((await makeCall()).body.engine).toBe("realtime");
    const eleventh = await makeCall();
    expect(eleventh.response.status).toBe(200);
    expect(eleventh.body).toEqual({ engine: "fallback", reason: "daily_cap" });
    expect(createCalls()).toHaveLength(10);
  });

  it("8. LIVE_DAILY_SESSION_CAP으로 바꿀 수 있고 0이면 모두 daily_cap", async () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "2");
    await makeCall();
    await makeCall();
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "daily_cap" });
    expect(createCalls()).toHaveLength(2);
    vi.resetModules();
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "0");
    call = await import("@/app/api/live/call/route");
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "daily_cap" });
  });

  it("9. 실호출 예산이 모자라면 200 fallback budget이고 fetch 0회, 하루 자리는 되돌려진다", async () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "1");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "1"); // 남은 1회로는 연결 1회 + 턴 1회가 안 된다
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "budget" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(config.realCallsLeft()).toBe(1);
    // 자리가 되돌려졌으므로 예산을 늘리면 같은 하루 상한 1회로 성공한다.
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "5");
    expect((await makeCall()).body.engine).toBe("realtime");
  });

  it("9. 예산이 0이어도 budget", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "0");
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "budget" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("10. OpenAI가 500을 주면 fallback upstream이고 하루 자리와 예산이 되돌려진다", async () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "1");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "100");
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const failed = await makeCall();
    expect(failed.response.status).toBe(200);
    expect(failed.body).toEqual({ engine: "fallback", reason: "upstream" });
    expect(config.realCallsLeft()).toBe(100);
    // 자리가 돌아왔으므로 다음 요청은 성공한다.
    expect((await makeCall()).body.engine).toBe("realtime");
  });

  it("10. 8초에 끊어도 fallback upstream이고 자리와 예산이 되돌려진다", async () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "1");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "100");
    fetchMock.mockImplementationOnce(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = makeCall();
    await flush();
    await vi.advanceTimersByTimeAsync(7_999);
    expect(config.realCallsLeft()).toBeLessThan(100); // 아직 기다리는 중
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).body).toEqual({ engine: "fallback", reason: "upstream" });
    expect(config.realCallsLeft()).toBe(100);
    expect((await makeCall()).body.engine).toBe("realtime");
  });

  it("10. 네트워크 오류도 fallback upstream", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "upstream" });
  });

  it("11. Location이 없으면 fallback upstream이고 answer SDP를 넘기지 않는다. 자리는 쓴 것, 예산은 연결 1회만 남긴다", async () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "1");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "100");
    fetchMock.mockResolvedValueOnce(openaiOk(null));
    const failed = await makeCall();
    expect(failed.body).toEqual({ engine: "fallback", reason: "upstream" });
    expect(JSON.stringify(failed.body)).not.toContain("ANSWER-SDP");
    expect("sdp" in failed.body).toBe(false);
    expect(config.realCallsLeft()).toBe(99);
    // 하루 자리는 쓴 것으로 둔다.
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "daily_cap" });
  });

  it("11. Location 모양이 틀려도(call_id로 못 읽음) 같은 처리", async () => {
    fetchMock.mockResolvedValueOnce(openaiOk("/v1/realtime/calls/bad id!"));
    const failed = await makeCall();
    expect(failed.body).toEqual({ engine: "fallback", reason: "upstream" });
    expect("sdp" in failed.body).toBe(false);
  });
});

describe("POST /api/live/call 성공과 세션 설정", () => {
  it("성공: realtime 응답 필드, FormData 본문, Authorization, 장부 기록", async () => {
    const { response, body } = await makeCall();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      engine: "realtime",
      sdp: ANSWER,
      callId: "rtc_call_1",
      maxSessionSec: 270,
      warnBeforeSec: 60,
      maxTurns: 30,
    });
    expect(createCalls()).toHaveLength(1);
    const [url, init] = createCalls()[0];
    expect(url).toBe(CALLS_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-key-not-real" });
    expect(JSON.stringify(init.headers)).not.toMatch(/OpenAI-Beta/i);
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("sdp")).toBe(OFFER);
    expect(typeof form.get("session")).toBe("string");
    // 장부에 있으므로 turns 5만 쓴 것으로 돌려줄 수 있다(25회).
    expect(session.settleCall("rtc_call_1", 5)).toBe(25);
  });

  it("session: 모델, output_modalities, reasoning, 도구 3개, turn_detection, max_output_tokens", async () => {
    await makeCall();
    const sent = sentSession() as unknown as LooseSession;
    expect(sent.type).toBe("realtime");
    expect(sent.model).toBe("gpt-realtime-2.1-mini");
    expect(sent.instructions).toBe(LIVE_REALTIME_INSTRUCTIONS);
    expect(sent.output_modalities).toEqual(["audio"]);
    expect(sent.reasoning).toEqual({ effort: "minimal" });
    expect(sent.tools).toHaveLength(3);
    expect(sent.tools).toEqual(JSON.parse(JSON.stringify(LIVE_TOOLS)));
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual(["confirm_request", "register_request", "end_conversation"]);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.max_output_tokens).toBe(400);
    expect(sent.truncation).toBe("auto");
    expect(sent.audio.input.transcription).toEqual({ model: "gpt-transcribe", language: "ko" });
    expect(sent.audio.input.noise_reduction).toEqual({ type: "near_field" });
    expect(sent.audio.input.turn_detection).toEqual({
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 1200,
      create_response: false,
      interrupt_response: false,
    });
    expect("idle_timeout_ms" in sent.audio.input.turn_detection).toBe(false);
    expect(sent.audio.output).toEqual({ voice: "marin", speed: 1.0 });
    // 옛 베타 표기를 쓰지 않는다.
    const text = JSON.stringify(sent);
    expect(text).not.toContain("input_audio_transcription");
    expect(Object.keys(sent)).not.toContain("modalities");
  });

  it("?rate: slow 0.85, normal 1.0, fast 1.2, 그 밖은 normal", async () => {
    await makeCall({ query: "?rate=slow" });
    await makeCall({ query: "?rate=fast" });
    await makeCall({ query: "?rate=normal" });
    await makeCall({ query: "?rate=turbo" });
    await makeCall();
    const speeds = [0, 1, 2, 3, 4].map((i) => (sentSession(i).audio as { output: { speed: number } }).output.speed);
    expect(speeds).toEqual([0.85, 1.2, 1.0, 1.0, 1.0]);
  });

  it("LIVE_REALTIME_VAD=semantic → semantic_vad(idle_timeout_ms 없음). 그 밖의 값은 기본(server_vad)", async () => {
    vi.stubEnv("LIVE_REALTIME_VAD", "semantic");
    await makeCall();
    const detection = (sentSession().audio as { input: { turn_detection: Json } }).input.turn_detection;
    expect(detection).toEqual({
      type: "semantic_vad",
      eagerness: "low",
      create_response: false,
      interrupt_response: false,
    });
    vi.stubEnv("LIVE_REALTIME_VAD", "something-else");
    await makeCall();
    expect((sentSession(1).audio as { input: { turn_detection: Json } }).input.turn_detection.type).toBe("server_vad");
  });

  it("LIVE_REALTIME_REASONING=off → reasoning 필드 없음, 다른 값이면 그 값", async () => {
    vi.stubEnv("LIVE_REALTIME_REASONING", "off");
    await makeCall();
    expect("reasoning" in sentSession(0)).toBe(false);
    vi.stubEnv("LIVE_REALTIME_REASONING", "low");
    await makeCall();
    expect(sentSession(1).reasoning).toEqual({ effort: "low" });
  });

  it("LIVE_TRANSCRIBE_LANG=''이면 language를 뺀다. LIVE_REALTIME_MODEL로 모델을 바꾼다", async () => {
    vi.stubEnv("LIVE_TRANSCRIBE_LANG", "");
    vi.stubEnv("LIVE_REALTIME_MODEL", "gpt-realtime-test");
    await makeCall();
    const sent = sentSession() as unknown as LooseSession;
    expect(sent.audio.input.transcription).toEqual({ model: "gpt-transcribe" });
    expect(sent.model).toBe("gpt-realtime-test");
  });

  it("Location이 전체 URL일 때와 상대 경로일 때 모두 callId를 꺼낸다", async () => {
    fetchMock.mockResolvedValueOnce(openaiOk("https://api.openai.com/v1/realtime/calls/rtc_full_url"));
    expect((await makeCall()).body.callId).toBe("rtc_full_url");
    fetchMock.mockResolvedValueOnce(openaiOk("/v1/realtime/calls/rtc_relative/"));
    expect((await makeCall()).body.callId).toBe("rtc_relative");
  });

  it("Location에 id 구간이 없으면(…/calls/, 맨 id) 통화를 화면에 넘기지 않는다", async () => {
    // Codex 5차 지적 2: "/v1/realtime/calls/"의 마지막 구간 "calls"를 id로 읽어 answer SDP를 넘기면 예약 끊기가 그 통화를 끊지 못한다.
    for (const location of ["/v1/realtime/calls/", "https://api.openai.com/v1/realtime/calls", "rtc_bare"]) {
      fetchMock.mockResolvedValueOnce(openaiOk(location));
      const res = await makeCall();
      expect(res.body).toEqual({ engine: "fallback", reason: "upstream" });
      expect(JSON.stringify(res.body)).not.toContain("v=0");
    }
  });

  it("maxTurns: 예산 제한이 없으면 30, 예산이 있으면 min(30, 남은 수 - 1)이고 1 + maxTurns를 미리 쓴다", async () => {
    expect((await makeCall()).body.maxTurns).toBe(30);
    expect(config.realCallsLeft()).toBeNull();
    // 제한이 없을 때도 쓴 수는 센다(31). 상한을 새로 걸면 그 위에서 계산한다.
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "51");
    expect(config.realCallsLeft()).toBe(20);
    expect((await makeCall()).body.maxTurns).toBe(19);
    expect(config.realCallsLeft()).toBe(0);
    expect((await makeCall()).body).toEqual({ engine: "fallback", reason: "budget" });
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "200");
    expect((await makeCall()).body.maxTurns).toBe(30);
    expect(config.realCallsLeft()).toBe(200 - 51 - 31);
  });

  it("동시 요청 11건(서로 다른 IP) → OpenAI 통화 만들기는 10회 이하", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      await Promise.resolve();
      await Promise.resolve();
      return String(url).endsWith("/hangup") ? new Response("", { status: 200 }) : openaiOk();
    });
    const results = await Promise.all(Array.from({ length: 11 }, () => call.POST(callRequest())));
    const bodies = await Promise.all(results.map(json));
    expect(createCalls().length).toBeLessThanOrEqual(10);
    expect(bodies.filter((b) => b.engine === "realtime")).toHaveLength(10);
    expect(bodies.filter((b) => b.reason === "daily_cap")).toHaveLength(1);
  });

  it("예약 끊기: 응답 뒤 (270 + 10)초에 그 통화의 hangup 주소로 1회, 장부에서 지운다", async () => {
    const { body } = await makeCall();
    expect(hangupCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(279_999);
    expect(hangupCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(hangupCalls()).toHaveLength(1);
    expect(hangupCalls()[0][0]).toBe(`${CALLS_URL}/${body.callId}/hangup`);
    expect(hangupCalls()[0][1].method).toBe("POST");
    expect(session.settleCall(body.callId as string, 0)).toBe(0); // 이미 장부에 없다
  });

  it("같은 인스턴스의 오래된 통화는 다음 /call 요청이 끊는다(sweepCalls)", async () => {
    session.rememberCall("rtc_old_one", 5, Date.now() - 300_000);
    await makeCall();
    await flush();
    expect(hangupCalls().map(([url]) => String(url))).toContain(`${CALLS_URL}/rtc_old_one/hangup`);
  });

  it("로그: 상태·시간·꼬리표만. SDP, callId, 이용자 말이 없다", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "200");
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await makeCall(); // 성공
    await makeCall({ type: "text/plain" }); // 415
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "1");
    await makeCall(); // daily_cap
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "5");
    await makeCall(); // upstream
    const lines = spy.mock.calls.map((args) => args.join(" "));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^POST \/api\/live\/call 200 \d+ms engine=realtime cap=1\/10 budget=31\/200$/);
    expect(lines[1]).toMatch(/^POST \/api\/live\/call 415 \d+ms$/);
    expect(lines[2]).toMatch(/^POST \/api\/live\/call 200 \d+ms engine=fallback reason=daily_cap$/);
    expect(lines[3]).toMatch(/^POST \/api\/live\/call 200 \d+ms engine=fallback reason=upstream status=500 budget=31\/200$/);
    const all = lines.join("\n");
    expect(all).not.toContain("v=0");
    expect(all).not.toContain("ANSWER-SDP");
    expect(all).not.toContain("rtc_call_");
    expect(all).not.toContain("203.0.113");
  });
});

describe("스위치가 꺼졌거나 mock이면 OpenAI fetch 0회", () => {
  it("LIVE_REALTIME 없음, mock, 키 없음, 기능 꺼짐, 예산 0 모두 fetch 0회", async () => {
    vi.stubEnv("LIVE_REALTIME", undefined);
    await call.POST(callRequest());
    vi.stubEnv("LIVE_REALTIME", "on");
    vi.stubEnv("LLM_MODE", "mock");
    await call.POST(callRequest());
    vi.stubEnv("LLM_MODE", undefined);
    vi.stubEnv("OPENAI_API_KEY", "");
    await call.POST(callRequest());
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-real");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "0");
    await call.POST(callRequest());
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", undefined);
    vi.stubEnv("LIVE_ENABLED", "off");
    await call.POST(callRequest());
    expect(createCalls()).toHaveLength(0);
  });
});

describe("POST /api/live/hangup(7.6절)", () => {
  it("모양이 틀린 callId와 틀린 본문도 204이고 fetch 0회", async () => {
    const bodies: unknown[] = [
      "not json",
      "",
      "null",
      "[]",
      {},
      { callId: 5 },
      { callId: "" },
      { callId: "." },
      { callId: ".." },
      { callId: "../etc/passwd" },
      { callId: "a b" },
      { callId: "a/b" },
      { callId: "x".repeat(201) },
    ];
    // 제한(10회/분)이 걸리지 않게 IP를 바꾼다.
    for (const body of bodies) {
      const response = await hangup.POST(hangupRequest(body));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("본문이 1,024바이트를 넘으면 204이고 fetch 0회", async () => {
    const response = await hangup.POST(hangupRequest({ callId: "rtc_a", pad: "x".repeat(2000) }));
    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("맞는 callId는 hangup 주소로 1회 보낸다. 장부에 없어도 끊는다", async () => {
    const response = await hangup.POST(hangupRequest({ callId: "rtc_unknown-1.a~b" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CALLS_URL}/rtc_unknown-1.a~b/hangup`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-key-not-real" });
  });

  it("realtimeGate가 거짓이면 fetch 없이 204", async () => {
    vi.stubEnv("LIVE_REALTIME", undefined);
    expect((await hangup.POST(hangupRequest({ callId: "rtc_a" }))).status).toBe(204);
    vi.stubEnv("LIVE_REALTIME", "on");
    vi.stubEnv("LLM_MODE", "mock");
    expect((await hangup.POST(hangupRequest({ callId: "rtc_a" }))).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns만큼만 남기고 예산을 돌려준다. turns가 없거나 틀리면 돌려주지 않는다", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "200");
    const first = await makeCall();
    expect(config.realCallsLeft()).toBe(200 - 31);
    await hangup.POST(hangupRequest({ callId: first.body.callId, turns: 5 }));
    expect(config.realCallsLeft()).toBe(200 - 31 + 25);
    // 한 번 정산한 통화는 다시 돌려주지 않는다.
    await hangup.POST(hangupRequest({ callId: first.body.callId, turns: 0 }));
    expect(config.realCallsLeft()).toBe(200 - 31 + 25);

    const noTurns = await makeCall();
    const afterSecond = config.realCallsLeft();
    await hangup.POST(hangupRequest({ callId: noTurns.body.callId }));
    expect(config.realCallsLeft()).toBe(afterSecond);

    const badTurns = await makeCall();
    const afterThird = config.realCallsLeft();
    await hangup.POST(hangupRequest({ callId: badTurns.body.callId, turns: -1 }));
    await hangup.POST(hangupRequest({ callId: "rtc_unused", turns: 1.5 }));
    expect(config.realCallsLeft()).toBe(afterThird);
  });

  it("turns가 maxTurns보다 커도 그만큼 더 돌려주지 않는다. 장부에 없는 callId는 0", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "200");
    const made = await makeCall();
    const left = config.realCallsLeft();
    await hangup.POST(hangupRequest({ callId: made.body.callId, turns: 999 }));
    expect(config.realCallsLeft()).toBe(left);
    await hangup.POST(hangupRequest({ callId: "rtc_never_made", turns: 0 }));
    expect(config.realCallsLeft()).toBe(left);
  });

  it("IP당 10회/분: 11번째는 204이지만 fetch를 하지 않는다", async () => {
    const client = freshClient();
    for (let i = 0; i < 11; i += 1) {
      expect((await hangup.POST(hangupRequest({ callId: `rtc_${i}` }, client))).status).toBe(204);
    }
    expect(hangupCalls()).toHaveLength(10);
  });

  it("OpenAI가 2xx가 아닌 코드를 주어도 204이고, 그 코드가 로그에 남는다. callId는 남지 않는다", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "200");
    const made = await makeCall();
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect((await hangup.POST(hangupRequest({ callId: made.body.callId, turns: 5 }))).status).toBe(204);
    const line = spy.mock.calls.map((a) => a.join(" ")).join("\n");
    expect(line).toMatch(/^POST \/api\/live\/hangup 204 \d+ms upstream=404 budget=\d+\/200$/);
    expect(line).not.toContain(made.body.callId as string);
  });

  it("로그 형식: upstream 코드와 예산 꼬리표", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "200");
    const made = await makeCall();
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await hangup.POST(hangupRequest({ callId: made.body.callId, turns: 5 }));
    expect(spy.mock.calls[0].join(" ")).toMatch(/^POST \/api\/live\/hangup 204 \d+ms upstream=200 budget=6\/200$/);
  });

  it("hangup이 네트워크 오류를 만나도 던지지 않고 204", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await hangup.POST(hangupRequest({ callId: "rtc_a" }))).status).toBe(204);
  });
});

describe("liveRealtimeSession 부품", () => {
  it("parseCallId: 전체 URL, 상대 경로, 끝 슬래시, 틀린 모양", () => {
    const { parseCallId } = session;
    expect(parseCallId(null)).toBeNull();
    expect(parseCallId("")).toBeNull();
    expect(parseCallId("/")).toBeNull();
    expect(parseCallId("https://api.openai.com/v1/realtime/calls/rtc_abc123")).toBe("rtc_abc123");
    expect(parseCallId("/v1/realtime/calls/rtc_abc123")).toBe("rtc_abc123");
    expect(parseCallId("/v1/realtime/calls/rtc_abc123/")).toBe("rtc_abc123");
    // 경로가 …/calls/<id>로 끝날 때만 받는다. id 구간이 없으면 마지막 구간을 id로 읽지 않는다.
    expect(parseCallId("rtc_bare")).toBeNull();
    expect(parseCallId("/v1/realtime/calls/")).toBeNull();
    expect(parseCallId("/v1/realtime/calls")).toBeNull();
    expect(parseCallId("https://api.openai.com/v1/realtime/calls/")).toBeNull();
    expect(parseCallId("/v1/realtime/")).toBeNull();
    expect(parseCallId("/v1/realtime/calls/rtc_abc123/hangup")).toBeNull();
    expect(parseCallId("/v1/realtime/calls/rtc abc")).toBeNull();
    expect(parseCallId("/v1/realtime/calls/rtc%2Fabc")).toBeNull();
    expect(parseCallId(`/v1/realtime/calls/${"x".repeat(201)}`)).toBeNull();
  });

  it("buildRealtimeSession: LIVE_ASK_NAME=on이면 지시문 끝에 성함 여쭙기가 붙고, 그 밖의 값이면 그대로다", () => {
    vi.stubEnv("LIVE_ASK_NAME", "on");
    const asked = String((session.buildRealtimeSession() as unknown as LooseSession).instructions);
    expect(asked.startsWith(LIVE_REALTIME_INSTRUCTIONS)).toBe(true);
    expect(asked).toContain("[성함 여쭙기]");
    vi.stubEnv("LIVE_ASK_NAME", "yes");
    expect((session.buildRealtimeSession() as unknown as LooseSession).instructions).toBe(LIVE_REALTIME_INSTRUCTIONS);
  });

  it("buildRealtimeSession: 기본값과 LIVE_REALTIME_INSTRUCTIONS, 도구 3개", () => {
    const built = session.buildRealtimeSession() as unknown as LooseSession;
    expect(built.instructions).toBe(LIVE_REALTIME_INSTRUCTIONS);
    expect(built.tools).toEqual(LIVE_TOOLS);
    expect(built.audio.output.speed).toBe(1.0);
    expect((session.buildRealtimeSession({ rate: "slow" }) as unknown as LooseSession).audio.output.speed).toBe(0.85);
    expect((session.buildRealtimeSession({ rate: "fast" }) as unknown as LooseSession).audio.output.speed).toBe(1.2);
  });

  it("reserveDailyCall: 첫 통화부터 고정 24시간 창, 상한이 차면 retryAfterSec, 창이 지나면 초기화", () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "2");
    const DAY = 24 * 60 * 60 * 1000;
    const a = session.reserveDailyCall(1_000);
    const b = session.reserveDailyCall(2_000);
    expect(a.ok && b.ok).toBe(true);
    const full = session.reserveDailyCall(3_000);
    expect(full).toEqual({ ok: false, retryAfterSec: Math.ceil((DAY - 2_000) / 1000) });
    expect(session.reserveDailyCall(1_000 + DAY - 1).ok).toBe(false);
    expect(session.reserveDailyCall(1_000 + DAY).ok).toBe(true); // 새 창
  });

  it("reserveDailyCall: release()는 한 번만 듣는다. 상한 0이면 언제나 실패", () => {
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "2");
    const a = session.reserveDailyCall(0);
    const b = session.reserveDailyCall(0);
    if (!a.ok || !b.ok) throw new Error("자리를 잡지 못함");
    expect(session.reserveDailyCall(0).ok).toBe(false);
    a.release();
    a.release();
    expect(session.reserveDailyCall(0).ok).toBe(true); // 하나만 돌아왔다
    expect(session.reserveDailyCall(0).ok).toBe(false);
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "0");
    expect(session.reserveDailyCall(5_000_000_000).ok).toBe(false);
  });

  it("settleCall: 장부에서 지우고 돌려줄 수를 준다", () => {
    session.rememberCall("rtc_a", 30);
    expect(session.settleCall("rtc_a", 10)).toBe(20);
    expect(session.settleCall("rtc_a", 10)).toBe(0); // 이미 지움
    session.rememberCall("rtc_b", 30);
    expect(session.settleCall("rtc_b")).toBe(0); // 턴 수를 모르면 돌려주지 않음
    session.rememberCall("rtc_c", 30);
    expect(session.settleCall("rtc_c", 30)).toBe(0);
    session.rememberCall("rtc_d", 30);
    expect(session.settleCall("rtc_d", 31)).toBe(0);
    session.rememberCall("rtc_e", 30);
    expect(session.settleCall("rtc_e", -1)).toBe(0);
    expect(session.settleCall("rtc_nope", 0)).toBe(0);
  });

  it("sweepCalls: 상한 + 15초가 지난 통화만 끊고 지운다", async () => {
    session.rememberCall("rtc_fresh", 5, 100_000);
    session.rememberCall("rtc_stale", 5, 0);
    expect(await session.sweepCalls(285_000)).toBe(0); // 270 + 15 = 285초는 아직
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await session.sweepCalls(285_001)).toBe(1);
    expect(hangupCalls().map(([url]) => String(url))).toEqual([`${CALLS_URL}/rtc_stale/hangup`]);
    expect(await session.sweepCalls(285_001)).toBe(0); // 지웠다
    expect(session.settleCall("rtc_fresh", 0)).toBe(5);
  });

  it("scheduleHangup: 가짜 예약기에 작업을 넘기고, 가짜 타이머로 (상한 + 10)초 뒤에 끊는다", async () => {
    const tasks: Array<() => Promise<void>> = [];
    session.rememberCall("rtc_sched", 7);
    session.scheduleHangup("rtc_sched", (task) => tasks.push(task));
    expect(tasks).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled(); // 예약만 했고 잠들기도 시작하지 않았다
    const running = tasks[0]();
    await vi.advanceTimersByTimeAsync(279_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(hangupCalls().map(([url]) => String(url))).toEqual([`${CALLS_URL}/rtc_sched/hangup`]);
    expect(session.settleCall("rtc_sched", 0)).toBe(0);
  });

  it("scheduleHangup: LIVE_MAX_SESSION_SEC를 따른다(60~280으로 잘림)", async () => {
    vi.stubEnv("LIVE_MAX_SESSION_SEC", "100");
    const tasks: Array<() => Promise<void>> = [];
    session.scheduleHangup("rtc_short", (task) => tasks.push(task));
    const running = tasks[0]();
    await vi.advanceTimersByTimeAsync(109_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("scheduleHangup: 예약기를 안 넘기고 요청 범위 밖에서 부르면(after가 던짐) 바로 작업을 돈다", async () => {
    session.scheduleHangup("rtc_default");
    await flush();
    await vi.advanceTimersByTimeAsync(280_000);
    expect(hangupCalls().map(([url]) => String(url))).toEqual([`${CALLS_URL}/rtc_default/hangup`]);
  });

  it("hangupRealtimeCall: 코드를 돌려주고, 5초에 끊고, 던지지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await session.hangupRealtimeCall("rtc_a")).toBe(404);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await session.hangupRealtimeCall("rtc_a")).toBe("network");
    fetchMock.mockImplementationOnce(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = session.hangupRealtimeCall("rtc_a");
    await vi.advanceTimersByTimeAsync(4_999);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("timeout");
  });

  it("hangupRealtimeCall: callId를 주소용으로 인코딩한다", async () => {
    await session.hangupRealtimeCall("a~b.c-d_e");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${CALLS_URL}/a~b.c-d_e/hangup`);
    await session.hangupRealtimeCall("a b/c");
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${CALLS_URL}/a%20b%2Fc/hangup`);
  });

  it("createRealtimeCall: 상위가 2xx가 아니면 그 코드, Location 없음은 no_call_id", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    expect(await session.createRealtimeCall(OFFER, {})).toEqual({ ok: false, status: 401 });
    fetchMock.mockResolvedValueOnce(openaiOk(null));
    expect(await session.createRealtimeCall(OFFER, {})).toEqual({ ok: false, status: "no_call_id" });
    fetchMock.mockResolvedValueOnce(openaiOk("/v1/realtime/calls/rtc_ok"));
    expect(await session.createRealtimeCall(OFFER, { type: "realtime" })).toEqual({ ok: true, sdp: ANSWER, callId: "rtc_ok" });
    const form = createCalls()[2][1].body as FormData;
    expect(form.get("session")).toBe(JSON.stringify({ type: "realtime" }));
  });
});

describe("Codex 1차 지적과 거절 사유 꼬리표", () => {
  it("끊기 라우트: 기능이 꺼져 있으면 404 disabled이고 OpenAI를 부르지 않는다", async () => {
    vi.stubEnv("LIVE_ENABLED", "off");
    const response = await hangup.POST(hangupRequest({ callId: "rtc_any_call", turns: 0 }));
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ ok: false, error: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("끊기 라우트: 운영(VERCEL_ENV=production)에서 LIVE_ENABLED가 없으면 404, on이면 204", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await hangup.POST(hangupRequest({ callId: "rtc_any_call" }))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("LIVE_ENABLED", "on");
    expect((await hangup.POST(hangupRequest({ callId: "rtc_any_call" }))).status).toBe(204);
    expect(hangupCalls()).toHaveLength(1);
  });

  it("통화 만들기 거절: 어느 필드인지(param, code)만 로그에 남고 오류 글은 남지 않는다", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "Unknown parameter: 'session.reasoning'. v=0 SECRET-SDP-PIECE",
            type: "invalid_request_error",
            param: "session.reasoning",
            code: "unknown_parameter",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const failed = await makeCall();
    expect(failed.body).toEqual({ engine: "fallback", reason: "upstream" });
    const line = spy.mock.calls.map((args) => args.join(" ")).join(" | ");
    expect(line).toMatch(/reason=upstream status=400 param=session\.reasoning code=unknown_parameter/);
    expect(line).not.toContain("Unknown parameter");
    expect(line).not.toContain("SECRET-SDP-PIECE");
  });

  it("거절 사유: 본문이 JSON이 아니면 꼬리표 없이 코드만, 이상한 글자는 걸러진다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 502 }));
    expect(await session.createRealtimeCall(OFFER, {})).toEqual({ ok: false, status: 502 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { param: "session.audio output\nvoice=<x>", code: 42, type: "invalid request!" } }), { status: 400 }),
    );
    expect(await session.createRealtimeCall(OFFER, {})).toEqual({
      ok: false,
      status: 400,
      detail: " param=session.audiooutputvoicex code=invalidrequest",
    });
  });
});

describe("LIVE_CALL_IP_LIMIT(로컬 되풀이 시험용)", () => {
  it("기본은 3이고 1~60으로 자른다. 숫자가 아니면 기본값", () => {
    expect(config.liveCallIpLimit()).toBe(3);
    vi.stubEnv("LIVE_CALL_IP_LIMIT", "20");
    expect(config.liveCallIpLimit()).toBe(20);
    vi.stubEnv("LIVE_CALL_IP_LIMIT", "0");
    expect(config.liveCallIpLimit()).toBe(1);
    vi.stubEnv("LIVE_CALL_IP_LIMIT", "999");
    expect(config.liveCallIpLimit()).toBe(60);
    vi.stubEnv("LIVE_CALL_IP_LIMIT", "many");
    expect(config.liveCallIpLimit()).toBe(3);
  });

  it("5로 올리고 라우트를 새로 불러오면 같은 주소에서 5번까지 통화가 만들어지고 6번째가 rate_limited다", async () => {
    vi.stubEnv("LIVE_CALL_IP_LIMIT", "5");
    vi.resetModules();
    const route = await import("@/app/api/live/call/route");
    const client = freshClient();
    for (let i = 0; i < 5; i += 1) {
      expect((await json(await route.POST(callRequest({ client })))).engine).toBe("realtime");
    }
    expect(await json(await route.POST(callRequest({ client })))).toEqual({ engine: "fallback", reason: "rate_limited" });
  });
});
