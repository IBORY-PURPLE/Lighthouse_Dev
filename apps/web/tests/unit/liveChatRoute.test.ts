import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveChatStatus, LiveSlots, LiveTurn } from "@/lib/liveEngine";
import { encodeAiTurn } from "@/lib/liveText";

// POST /api/live/chat, GET /api/live/config, liveConfig 스위치. 설계서 7.1~7.3절, 13절, 16.1절.
// 라우트의 제한기와 예산 카운터는 모듈 메모리라, 시험마다 모듈을 새로 불러온다.

const ORIGIN = "http://localhost:3000";
const freshClient = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;
const sessionId = () => randomUUID();

type ChatRoute = typeof import("@/app/api/live/chat/route");
type ConfigRoute = typeof import("@/app/api/live/config/route");
let chat: ChatRoute;
let config: ConfigRoute;

function chatRequest(body: unknown, client: string = freshClient()) {
  return new NextRequest(`${ORIGIN}/api/live/chat`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client },
  });
}

const user = (content: string): LiveTurn => ({ role: "user", content });
const ai = (status: LiveChatStatus, slots: Partial<LiveSlots> = {}, reply = ""): LiveTurn => ({
  role: "assistant",
  content: encodeAiTurn({ reply, status, slots: { product: "", info: "", options: "", budget: "", ...slots } }),
});

type ChatBody = { reply: string; status: LiveChatStatus; slots: LiveSlots; error?: string; code?: string };
const json = async (response: Response) => (await response.json()) as ChatBody;

const INTRO = ai("asking", {}, "안녕하세요. 음성 도우미예요.");

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("LIVE_ENABLED", undefined);
  vi.stubEnv("LIVE_REAL_CALL_BUDGET", undefined);
  vi.stubEnv("OPENAI_MODEL", "");
  chat = await import("@/app/api/live/chat/route");
  config = await import("@/app/api/live/config/route");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/live/chat (가짜 AI)", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "mock");
  });

  it("라우트 설정: nodejs, 30초", () => {
    expect(chat.runtime).toBe("nodejs");
    expect(chat.dynamic).toBe("force-dynamic");
    expect(chat.maxDuration).toBe(30);
  });

  it("3턴이면 confirming이고, 4번째 '네 그렇게 보내 주시면 돼요'는 done이다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = freshClient();
    const id = sessionId();
    const history: LiveTurn[] = [INTRO];
    const say = async (message: string) => {
      const response = await chat.POST(chatRequest({ sessionId: id, message, history }, client));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await json(response);
      history.push(user(message), ai(body.status, body.slots, body.reply));
      return body;
    };

    const first = await say("무선 이어폰");
    expect(first.status).toBe("asking");
    expect(first.slots.product).toBe("무선 이어폰");
    const second = await say("후기");
    expect(second.status).toBe("asking");
    expect(second.slots.info).toBe("후기");
    const third = await say("흰색 5만 원 이하");
    expect(third.status).toBe("confirming");
    expect(third.slots).toEqual({ product: "무선 이어폰", info: "후기", options: "흰색 5만 원 이하", budget: "5만 원 이하" });
    const fourth = await say("네 그렇게 보내 주시면 돼요");
    expect(fourth.status).toBe("done");
    expect(fourth.reply).toBe("보내 드릴게요.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mock이 읽은 이용자 말은 이번 message 한 번뿐이다(첫 턴이 asking '정보'로 간다)", async () => {
    // 이용자 글이 두 번 들어가면 said.length가 2가 되어 '옵션이나 예산' 질문이 나온다.
    const response = await chat.POST(chatRequest({ sessionId: sessionId(), message: "고유한말", history: [INTRO] }));
    const body = await json(response);
    expect(body.slots.product).toBe("고유한말");
    expect(body.reply).toContain("어떤 점이 궁금하세요?");
  });

  it("서버 관문: mock이 done을 내도 앞 칸이 confirming이 아니면 confirming으로 낮추고 로그에 gate=downgraded가 남는다", async () => {
    const history = [INTRO, user("무선 이어폰"), ai("asking", { product: "무선 이어폰" }), user("후기"), ai("asking"), user("흰색"), ai("asking")];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await chat.POST(chatRequest({ sessionId: sessionId(), message: "네", history }));
    const body = await json(response);
    expect(body.status).toBe("confirming");
    expect(info.mock.calls.map((c) => String(c[0])).join("\n")).toContain("gate=downgraded");
  });

  it("reset:true는 400 bad_request다", async () => {
    const response = await chat.POST(chatRequest({ sessionId: sessionId(), message: "", reset: true }));
    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("bad_request");
  });

  it("검사 실패는 400 bad_request와 한글 문장이다", async () => {
    const cases: unknown[] = [
      { sessionId: "짧음", message: "안녕", history: [] },
      { sessionId: sessionId(), message: "", history: [] },
      { sessionId: sessionId(), message: "가".repeat(1001), history: [] },
      { sessionId: sessionId(), message: "안녕", history: "배열 아님" },
      { sessionId: sessionId(), message: "안녕", history: Array.from({ length: 36 }, () => user("a")) },
      { sessionId: sessionId(), message: "안녕", history: [{ role: "assistant", content: "가".repeat(2001) }] },
    ];
    for (const body of cases) {
      const response = await chat.POST(chatRequest(body));
      const parsed = await json(response);
      expect(response.status).toBe(400);
      expect(parsed.code).toBe("bad_request");
      expect(parsed.error).toMatch(/[가-힣]/);
    }
    const broken = await chat.POST(chatRequest("이건 JSON이 아니다"));
    expect(broken.status).toBe(400);
    expect((await json(broken)).error).toBe("요청 형식 오류");
  });

  it("큰 본문은 413 too_large다", async () => {
    const response = await chat.POST(chatRequest("가".repeat(30_000)));
    expect(response.status).toBe(413);
    const body = await json(response);
    expect(body.code).toBe("too_large");
    expect(body.error).toBe("요청이 너무 큽니다");
  });

  it("같은 IP의 21번째 요청은 429 rate_limited와 Retry-After다", async () => {
    const client = freshClient();
    for (let i = 0; i < 20; i += 1) {
      const ok = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }, client));
      expect(ok.status).toBe(200);
    }
    const limited = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }, client));
    expect(limited.status).toBe(429);
    expect((await json(limited)).code).toBe("rate_limited");
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
  });

  it("하루 601번째 요청은 429 daily_cap이다(IP가 달라도 인스턴스 전체로 센다)", async () => {
    for (let i = 0; i < 600; i += 1) {
      const ok = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
      expect(ok.status).toBe(200);
    }
    const capped = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
    expect(capped.status).toBe(429);
    const body = await json(capped);
    expect(body.code).toBe("daily_cap");
    expect(body.error).toBe("오늘 이용량이 다 찼습니다.");
    expect(Number(capped.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("검사에 실패한 요청은 하루 장부에 세지 않는다", async () => {
    for (let i = 0; i < 700; i += 1) {
      await chat.POST(chatRequest({ sessionId: "짧음", message: "안녕", history: [] }));
    }
    const ok = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
    expect(ok.status).toBe(200);
  });

  it("LIVE_ENABLED=off면 404 disabled다", async () => {
    vi.stubEnv("LIVE_ENABLED", "off");
    const response = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
    expect(response.status).toBe(404);
    const body = await json(response);
    expect(body.code).toBe("disabled");
    expect(body.error).toBe("지금은 음성 도우미를 쓸 수 없습니다.");
  });

  it("운영(VERCEL_ENV=production)에서 LIVE_ENABLED가 없으면 404이고 on이면 열린다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const closed = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
    expect(closed.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("LIVE_ENABLED", "on");
    const open = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
    expect(open.status).not.toBe(404);
  });

  it("mock일 때 OpenAI fetch는 0회이고 예산도 쓰지 않는다", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 3; i += 1) {
      const ok = await chat.POST(chatRequest({ sessionId: sessionId(), message: "청소기", history: [INTRO] }));
      expect(ok.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("로그에 이용자 글과 AI 답이 없다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await chat.POST(chatRequest({ sessionId: sessionId(), message: "비밀스러운소니이어폰", history: [INTRO] }));
    const logged = [info, warn, error].flatMap((spy) => spy.mock.calls.map((c) => c.join(" "))).join("\n");
    expect(logged).toMatch(/POST \/api\/live\/chat 200 \d+ms/);
    expect(logged).not.toContain("비밀스러운소니이어폰");
    expect(logged).not.toContain("어떤 점이 궁금하세요");
  });
});

describe("POST /api/live/chat (OpenAI 호출 값과 실패)", () => {
  const fetchMock = vi.fn();
  const openaiText = (value: unknown) =>
    new Response(
      JSON.stringify({ output: [{ content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }] }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const asking = { reply: "어떤 점이 궁금하세요?", status: "asking", product: "청소기", info: "", options: "", budget: "" };
  const sent = (message: string, history: LiveTurn[] = [INTRO]) =>
    chat.POST(chatRequest({ sessionId: sessionId(), message, history }));

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("LLM_MODE", "");
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => openaiText(asking));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("OpenAI로 가는 요청 값과 input에 이번 message가 정확히 한 번, 마지막 칸으로 들어 있다", async () => {
    const response = await sent("청소기");
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ reply: "어떤 점이 궁금하세요?", status: "asking", slots: { product: "청소기" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const payload = JSON.parse(init.body as string) as {
      model: string;
      instructions: string;
      input: { role: string; content: string }[];
      max_output_tokens: number;
      text: { format: { type: string } };
      store: boolean;
    };
    expect(payload.model).toBe("gpt-4.1-mini");
    expect(payload.max_output_tokens).toBe(500);
    expect(payload.text.format.type).toBe("json_object");
    expect(payload.store).toBe(false);
    expect(payload.instructions).toContain("[출력 형식]");
    expect(payload.input[0]).toEqual({ role: "developer", content: "반드시 JSON 객체로 답변하세요." });
    expect(payload.input.at(-1)).toEqual({ role: "user", content: "청소기" });
    expect(payload.input.filter((turn) => turn.content === "청소기")).toHaveLength(1);
    expect(payload.input).toHaveLength(3); // developer + 안내 칸 + 이번 말
  });

  it("OPENAI_MODEL이 있으면 그 모델을 쓴다", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-test-model");
    await sent("청소기");
    const payload = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as { model: string };
    expect(payload.model).toBe("gpt-test-model");
  });

  it("mock이 아니고 키가 없으면 503 not_configured이고 fetch는 0회다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await sent("청소기");
    expect(response.status).toBe(503);
    const body = await json(response);
    expect(body.code).toBe("not_configured");
    expect(body.error).toBe("서버에 OPENAI_API_KEY가 설정되지 않았습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("LIVE_REAL_CALL_BUDGET=1이면 두 번째 실호출은 429 budget이고 fetch는 1회다", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "1");
    const first = await sent("청소기");
    expect(first.status).toBe(200);
    const second = await sent("청소기");
    expect(second.status).toBe(429);
    const body = await json(second);
    expect(body.code).toBe("budget");
    expect(body.error).toBe("시험 호출 예산이 다 찼습니다.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("예산 로그 꼬리표가 남는다", async () => {
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "5");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sent("청소기");
    expect(info.mock.calls.map((c) => String(c[0])).join("\n")).toContain("budget=1/5");
  });

  it("fetch가 던지면 502 failed, AbortError면 504 timeout이다", async () => {
    fetchMock.mockRejectedValueOnce(new Error("네트워크"));
    const failed = await sent("청소기");
    expect(failed.status).toBe(502);
    expect((await json(failed)).code).toBe("failed");

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const timeout = await sent("청소기");
    expect(timeout.status).toBe(504);
    const body = await json(timeout);
    expect(body.code).toBe("timeout");
    expect(body.error).toBe("AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.");
  });

  it("OpenAI가 오류 코드를 주거나 모양이 틀린 글을 주면 502다", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: "x" } }), { status: 500 }));
    expect((await sent("청소기")).status).toBe(502);
    fetchMock.mockImplementationOnce(async () => openaiText("JSON이 아닌 글"));
    expect((await sent("청소기")).status).toBe(502);
    fetchMock.mockImplementationOnce(async () => openaiText({ reply: "", status: "asking" }));
    expect((await sent("청소기")).status).toBe(502);
  });

  it("25초에 끊는다", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
      );
      const pending = sent("청소기");
      await vi.advanceTimersByTimeAsync(24_999);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect((await pending).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AI가 done이라 해도 앞 칸이 confirming이 아니면 confirming으로 낮춰 내보낸다", async () => {
    fetchMock.mockImplementationOnce(async () =>
      openaiText({ reply: "보내 드릴게요.", status: "done", product: "청소기", info: "후기", options: "", budget: "" }),
    );
    const history = [INTRO, user("청소기"), ai("asking", { product: "청소기" }, "무엇이 궁금하세요?")];
    const response = await sent("후기가 궁금해요", history);
    const body = await json(response);
    expect(body.status).toBe("confirming");
    expect(body.slots.product).toBe("청소기");
  });

  it("앞 칸이 confirming이고 분명한 동의면 done을 내보낸다", async () => {
    fetchMock.mockImplementationOnce(async () =>
      openaiText({ reply: "보내 드릴게요.", status: "done", product: "청소기", info: "후기", options: "", budget: "" }),
    );
    const history = [INTRO, user("청소기"), ai("confirming", { product: "청소기", info: "후기" })];
    const body = await json(await sent("네 보내 주세요", history));
    expect(body.status).toBe("done");
  });

  it("응답의 전화번호를 가린다", async () => {
    fetchMock.mockImplementationOnce(async () =>
      openaiText({ reply: "010-1234-5678로 연락드릴까요?", status: "asking", product: "청소기", info: "", options: "", budget: "" }),
    );
    const body = await json(await sent("청소기"));
    expect(body.reply).not.toContain("010-1234-5678");
    expect(body.reply).toContain("(전화번호 가림)");
  });

  it("로그에 이용자 글, AI 답, 키가 없다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("비밀스러운소니이어폰 test-key"));
    await sent("비밀스러운소니이어폰");
    await sent("비밀스러운소니이어폰");
    const logged = [info, warn, error].flatMap((spy) => spy.mock.calls.map((c) => c.join(" "))).join("\n");
    expect(logged).toMatch(/POST \/api\/live\/chat 502 \d+ms/);
    expect(logged).not.toContain("비밀스러운소니이어폰");
    expect(logged).not.toContain("test-key");
    expect(logged).not.toContain("어떤 점이 궁금하세요");
  });
});

describe("liveConfig 스위치(7.1절)", () => {
  it("isLiveEnabled: 운영은 on일 때만, 그 밖은 off가 아니면 켜진다", async () => {
    const { isLiveEnabled } = await import("@/lib/liveConfig");
    expect(isLiveEnabled()).toBe(true);
    vi.stubEnv("LIVE_ENABLED", "off");
    expect(isLiveEnabled()).toBe(false);
    vi.stubEnv("LIVE_ENABLED", "on");
    expect(isLiveEnabled()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isLiveEnabled()).toBe(true);
    vi.stubEnv("LIVE_ENABLED", "yes");
    expect(isLiveEnabled()).toBe(false);
    vi.stubEnv("LIVE_ENABLED", undefined);
    expect(isLiveEnabled()).toBe(false);
  });

  it("realtimeGate: 스위치, mock, 키 순서로 이유를 낸다", async () => {
    const { realtimeGate } = await import("@/lib/liveConfig");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("LLM_MODE", "");
    expect(realtimeGate()).toEqual({ ok: false, reason: "disabled" });
    vi.stubEnv("LIVE_REALTIME", "on");
    expect(realtimeGate()).toEqual({ ok: true });
    vi.stubEnv("LLM_MODE", "mock");
    expect(realtimeGate()).toEqual({ ok: false, reason: "mock" });
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("OPENAI_API_KEY", "  ");
    expect(realtimeGate()).toEqual({ ok: false, reason: "no_key" });
    // 운영에서는 LLM_MODE=mock이어도 live다.
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    expect(realtimeGate()).toEqual({ ok: true });
  });

  it("값과 기본값, 자르기", async () => {
    const c = await import("@/lib/liveConfig");
    expect(c.LIVE_REALTIME_MODEL_DEFAULT).toBe("gpt-realtime-2.1-mini");
    expect(c.LIVE_VOICE).toBe("marin");
    expect(c.LIVE_WARN_BEFORE_SEC).toBe(60);
    expect(c.LIVE_MAX_TURNS).toBe(30);
    expect(c.LIVE_CHAT_DAILY_CAP).toBe(600);

    expect(c.liveMaxSessionSec()).toBe(270);
    vi.stubEnv("LIVE_MAX_SESSION_SEC", "1000");
    expect(c.liveMaxSessionSec()).toBe(280);
    vi.stubEnv("LIVE_MAX_SESSION_SEC", "10");
    expect(c.liveMaxSessionSec()).toBe(60);
    vi.stubEnv("LIVE_MAX_SESSION_SEC", "abc");
    expect(c.liveMaxSessionSec()).toBe(270);
    vi.stubEnv("LIVE_MAX_SESSION_SEC", "120");
    expect(c.liveMaxSessionSec()).toBe(120);

    expect(c.liveDailySessionCap()).toBe(10);
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "999");
    expect(c.liveDailySessionCap()).toBe(200);
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "-3");
    expect(c.liveDailySessionCap()).toBe(0);
    vi.stubEnv("LIVE_DAILY_SESSION_CAP", "0");
    expect(c.liveDailySessionCap()).toBe(0);

    expect(c.liveTranscribeLang()).toBe("ko");
    vi.stubEnv("LIVE_TRANSCRIBE_LANG", "");
    expect(c.liveTranscribeLang()).toBe("");
    vi.stubEnv("LIVE_TRANSCRIBE_LANG", "en");
    expect(c.liveTranscribeLang()).toBe("en");

    expect(c.liveVadMode()).toBe("server");
    vi.stubEnv("LIVE_REALTIME_VAD", "semantic");
    expect(c.liveVadMode()).toBe("semantic");

    expect(c.liveReasoningEffort()).toBe("minimal");
    vi.stubEnv("LIVE_REALTIME_REASONING", "off");
    expect(c.liveReasoningEffort()).toBeNull();
    vi.stubEnv("LIVE_REALTIME_REASONING", "low");
    expect(c.liveReasoningEffort()).toBe("low");
  });

  it("실호출 예산: 제한이 없으면 null과 빈 꼬리표, 있으면 세고 돌려준다", async () => {
    const c = await import("@/lib/liveConfig");
    expect(c.realCallsLeft()).toBeNull();
    expect(c.realCallTail()).toBe("");
    expect(c.spendRealCalls(5).ok).toBe(true);

    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "10");
    // 제한이 없던 때 쓴 5회도 센다.
    expect(c.spendRealCalls(4)).toEqual({ ok: true, used: 9, limit: 10 });
    expect(c.realCallsLeft()).toBe(1);
    expect(c.spendRealCalls(2)).toEqual({ ok: false, used: 9, limit: 10 });
    expect(c.spendRealCalls(1)).toEqual({ ok: true, used: 10, limit: 10 });
    expect(c.realCallsLeft()).toBe(0);
    expect(c.realCallTail()).toBe(" budget=10/10");
    c.refundRealCalls(3);
    expect(c.realCallsLeft()).toBe(3);
    c.refundRealCalls(100);
    expect(c.realCallsLeft()).toBe(10);
    expect(c.realCallTail()).toBe(" budget=0/10");
  });

  it("예산 값이 숫자가 아니거나 음수면 제한이 없는 것으로 본다", async () => {
    const c = await import("@/lib/liveConfig");
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "abc");
    expect(c.realCallsLeft()).toBeNull();
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "-1");
    expect(c.realCallsLeft()).toBeNull();
    vi.stubEnv("LIVE_REAL_CALL_BUDGET", "0");
    expect(c.spendRealCalls(1).ok).toBe(false);
  });
});

describe("GET /api/live/config", () => {
  const get = (client: string = freshClient()) =>
    config.GET(new NextRequest(`${ORIGIN}/api/live/config`, { headers: { "x-forwarded-for": client } }));
  type ConfigBody = { enabled?: boolean; realtime?: boolean; reason?: string; maxSessionSec?: number; warnBeforeSec?: number; ok?: boolean; error?: string };

  it("기본: Realtime 꺼짐 이유 disabled와 상한을 준다", async () => {
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()) as ConfigBody).toEqual({
      enabled: true,
      realtime: false,
      reason: "disabled",
      maxSessionSec: 270,
      warnBeforeSec: 60,
    });
  });

  it("LIVE_REALTIME=on이고 mock이 아니고 키가 있으면 realtime이 참이고 reason이 없다", async () => {
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("LIVE_REALTIME", "on");
    vi.stubEnv("LIVE_MAX_SESSION_SEC", "200");
    const body = (await (await get()).json()) as ConfigBody;
    expect(body).toEqual({ enabled: true, realtime: true, maxSessionSec: 200, warnBeforeSec: 60 });
  });

  it("mock이면 reason mock, 키가 없으면 no_key", async () => {
    vi.stubEnv("LIVE_REALTIME", "on");
    vi.stubEnv("LLM_MODE", "mock");
    expect(((await (await get()).json()) as ConfigBody).reason).toBe("mock");
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(((await (await get()).json()) as ConfigBody).reason).toBe("no_key");
  });

  it("LIVE_ENABLED=off면 404 {ok:false,error:'disabled'}", async () => {
    vi.stubEnv("LIVE_ENABLED", "off");
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "disabled" });
  });

  it("같은 IP의 61번째 요청은 429다", async () => {
    const client = freshClient();
    for (let i = 0; i < 60; i += 1) expect((await get(client)).status).toBe(200);
    const limited = await get(client);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
