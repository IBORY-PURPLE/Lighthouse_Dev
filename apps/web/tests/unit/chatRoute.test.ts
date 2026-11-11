import { readFileSync } from "node:fs";
import path from "node:path";
import { APIConnectionTimeoutError, RateLimitError } from "groq-sdk";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST, runtime } from "@/app/api/chat/route";
import { ACCESS_COOKIE, hashAccessCode } from "@/lib/access";
import { LLM_MODEL, TRUNCATED_NOTICE } from "@/lib/llm";

// 일반 시험은 실제 Groq를 부르지 않는다(.claude/rules/chatbot-quality.md).
const { create, constructed } = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as unknown[],
}));

vi.mock("groq-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("groq-sdk")>();
  class FakeGroq {
    chat = { completions: { create } };
    constructor(options: unknown) {
      constructed.push(options);
    }
  }
  return { ...actual, default: FakeGroq };
});

interface FakeChunk {
  content?: string;
  finish?: "stop" | "length";
}

function fakeStream(chunks: FakeChunk[], failAfter?: Error) {
  return (async function* () {
    for (const { content, finish = null } of chunks) {
      yield { choices: [{ delta: { content }, finish_reason: finish }] };
    }
    if (failAfter) throw failAfter;
  })();
}

const ORIGIN = "http://localhost:3000";
const VALID = {
  requestId: "6f1c2e4a-1111-4222-8333-444455556666",
  question: "sony 헤드셋 제품을 찾는 가이드 알려줘",
  context: { brand: "Sony", item: "헤드셋" },
};

let nextClient = 1;

function chatRequest(
  body: unknown,
  {
    cookie = true,
    client,
    headers = {},
  }: {
    cookie?: boolean;
    client?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return new NextRequest(`${ORIGIN}/api/chat`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "x-forwarded-for": client ?? `203.0.113.${(nextClient += 1)}`,
      ...(cookie
        ? { cookie: `${ACCESS_COOKIE}=${hashAccessCode("right-code")}` }
        : {}),
      ...headers,
    },
  });
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: string }).error;

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_CODE", "right-code");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    create.mockReset();
    constructed.length = 0;
    create.mockImplementation(async () =>
      fakeStream([
        { content: "검색어:\n" },
        { content: "" },
        { content: "1. 소니 헤드셋" },
        { finish: "stop" },
      ]),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Vercel 설정값이 TSD와 같다", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });

  it("답변을 text/plain 스트림으로 돌려준다", async () => {
    const response = await POST(chatRequest(VALID));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("검색어:\n1. 소니 헤드셋");
  });

  it("글자를 여러 조각으로 내보낸다", async () => {
    const response = await POST(chatRequest(VALID));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("검색어:\n");
    const second = await reader.read();
    expect(decoder.decode(second.value)).toBe("1. 소니 헤드셋");
    expect((await reader.read()).done).toBe(true);
  });

  it("Groq 호출값이 TSD §9와 같고 대화 기록을 보내지 않는다", async () => {
    await (await POST(chatRequest(VALID))).text();

    expect(constructed).toEqual([
      { apiKey: "test-key", maxRetries: 1, timeout: 20_000 },
    ]);
    const [params] = create.mock.calls[0];
    expect(params.model).toBe(LLM_MODEL);
    expect(params.model).toBe("openai/gpt-oss-120b");
    expect(params.stream).toBe(true);
    expect(params.max_completion_tokens).toBe(800);
    expect(params.messages).toHaveLength(2);
    expect(params.messages[0].role).toBe("system");
    expect(params.messages[0].content).toContain("Sony 헤드셋");
    expect(params.messages[1]).toEqual({
      role: "user",
      content: VALID.question,
    });
  });

  it("브랜드가 null이어도 받는다", async () => {
    const response = await POST(
      chatRequest({ ...VALID, context: { brand: null, item: "헤드셋" } }),
    );
    expect(response.status).toBe(200);
    await response.text();
  });

  it("finish_reason이 length면 잘림 안내를 덧붙인다", async () => {
    create.mockImplementation(async () =>
      fakeStream([{ content: "검색어:" }, { finish: "length" }]),
    );
    const response = await POST(chatRequest(VALID));
    expect(await response.text()).toBe(`검색어:\n${TRUNCATED_NOTICE}`);
  });

  it("쿠키가 없으면 내용을 보기 전에 401이고 Groq를 부르지 않는다", async () => {
    const response = await POST(chatRequest("not json", { cookie: false }));
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toBe("unauthorized");
    expect(create).not.toHaveBeenCalled();
  });

  it("질문 300자는 통과하고 301자는 400이다", async () => {
    const pass = await POST(
      chatRequest({ ...VALID, question: "가".repeat(300) }),
    );
    expect(pass.status).toBe(200);
    await pass.text();

    const tooLong = await POST(
      chatRequest({ ...VALID, question: "가".repeat(301) }),
    );
    expect(tooLong.status).toBe(400);
    expect(await errorOf(tooLong)).toBe("too_long");
  });

  it("본문이 2KB를 넘으면 400이다(실제 크기와 선언 크기 모두)", async () => {
    const padded = {
      ...VALID,
      context: { brand: "S".repeat(2100), item: "헤드셋" },
    };
    const actual = await POST(chatRequest(padded));
    expect(actual.status).toBe(400);
    expect(await errorOf(actual)).toBe("too_long");

    const declared = await POST(
      chatRequest(VALID, { headers: { "content-length": "5000" } }),
    );
    expect(declared.status).toBe(400);
    expect(await errorOf(declared)).toBe("too_long");
    expect(create).not.toHaveBeenCalled();
  });

  it("크기를 밝히지 않은 본문은 2KB를 넘는 순간 읽기를 멈추고 400이다", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new NextRequest(`${ORIGIN}/api/chat`, {
      method: "POST",
      body: endless,
      duplex: "half",
      headers: {
        "x-forwarded-for": `203.0.113.${(nextClient += 1)}`,
        cookie: `${ACCESS_COOKIE}=${hashAccessCode("right-code")}`,
      },
    } as ConstructorParameters<typeof NextRequest>[1]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("too_long");
    expect(pulls).toBeLessThan(6);
  });

  it("본문이 정확히 2KB면 받는다", async () => {
    const base = JSON.stringify({ ...VALID, context: { brand: "", item: "헤드셋" } });
    const brand = "S".repeat(2048 - Buffer.byteLength(base));
    const body = JSON.stringify({ ...VALID, context: { brand, item: "헤드셋" } });
    expect(Buffer.byteLength(body)).toBe(2048);

    const response = await POST(chatRequest(body));
    expect(response.status).toBe(200);
    await response.text();
  });

  for (const [name, body] of [
    ["JSON이 아님", "not json"],
    ["null", "null"],
    ["requestId 없음", { question: "가", context: VALID.context }],
    ["질문이 숫자", { ...VALID, question: 1 }],
    ["빈 질문", { ...VALID, question: "   " }],
    ["context 없음", { requestId: VALID.requestId, question: "가" }],
    ["품목 없음", { ...VALID, context: { brand: "Sony", item: " " } }],
    ["브랜드가 숫자", { ...VALID, context: { brand: 1, item: "헤드셋" } }],
  ] as const) {
    it(`형식 오류는 400이다: ${name}`, async () => {
      const response = await POST(chatRequest(body));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    });
  }

  it("같은 주소에서 분당 21번째는 429이고 다른 주소는 영향이 없다", async () => {
    const client = "198.51.100.20";
    for (let i = 0; i < 20; i += 1) {
      const response = await POST(chatRequest(VALID, { client }));
      expect(response.status).toBe(200);
      await response.text();
    }
    const limited = await POST(chatRequest(VALID, { client }));
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const other = await POST(chatRequest(VALID, { client: "198.51.100.21" }));
    expect(other.status).toBe(200);
    await other.text();
  });

  it("키가 없으면 503이고 Groq를 부르지 않는다", async () => {
    vi.stubEnv("GROQ_API_KEY", "  ");
    const response = await POST(chatRequest(VALID));
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe("not_configured");
    expect(create).not.toHaveBeenCalled();
  });

  it("Groq 한도는 429다", async () => {
    create.mockRejectedValue(
      new RateLimitError(429, {}, "limit", new Headers()),
    );
    const response = await POST(chatRequest(VALID));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("Groq 시간 초과와 오류는 502다", async () => {
    create.mockRejectedValue(new APIConnectionTimeoutError());
    const timedOut = await POST(chatRequest(VALID));
    expect(timedOut.status).toBe(502);
    expect(await errorOf(timedOut)).toBe("llm_failed");

    create.mockRejectedValue(new Error("boom"));
    expect((await POST(chatRequest(VALID))).status).toBe(502);
  });

  it("글자 없이 끝난 답은 502다(토큰을 다 써서 잘린 경우 포함)", async () => {
    create.mockImplementation(async () => fakeStream([{ finish: "stop" }]));
    expect((await POST(chatRequest(VALID))).status).toBe(502);

    create.mockImplementation(async () => fakeStream([{ finish: "length" }]));
    expect((await POST(chatRequest(VALID))).status).toBe(502);
  });

  it("첫 글자 전 오류는 상태 코드로, 도중 오류는 스트림 오류로 처리한다", async () => {
    create.mockImplementation(async () =>
      fakeStream([], new RateLimitError(429, {}, "limit", new Headers())),
    );
    expect((await POST(chatRequest(VALID))).status).toBe(429);

    create.mockImplementation(async () =>
      fakeStream([{ content: "검색어:" }], new Error("boom")),
    );
    const response = await POST(chatRequest(VALID));
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
  });

  it("브라우저가 끊으면 Groq 요청도 취소한다", async () => {
    const response = await POST(chatRequest(VALID));
    const signal: AbortSignal = create.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    await response.body!.cancel();
    expect(signal.aborted).toBe(true);
  });

  it("LLM_MODE=mock이면 키 없이 가짜 답변을 주고 Groq를 부르지 않는다", async () => {
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("GROQ_API_KEY", "");
    const response = await POST(chatRequest(VALID));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("찾는 순서:");
    expect(create).not.toHaveBeenCalled();
  });

  it("production에서는 LLM_MODE=mock을 무시한다", async () => {
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("GROQ_API_KEY", "");
    expect((await POST(chatRequest(VALID))).status).toBe(503);
  });

  it("로그에 사용자 문장과 답변을 남기지 않는다", async () => {
    const logged: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args);
      });
    }

    await (await POST(chatRequest(VALID))).text();
    await POST(chatRequest({ ...VALID, question: "   " }));
    create.mockImplementation(async () =>
      fakeStream([{ content: "비밀 답변" }], new Error("비밀 오류")),
    );
    await (await POST(chatRequest(VALID))).text().catch(() => {});

    expect(logged.map((args) => args.join(" "))).toEqual([
      expect.stringMatching(/^POST \/api\/chat 200 \d+ms$/),
      expect.stringMatching(/^POST \/api\/chat 400 \d+ms$/),
      expect.stringMatching(/^POST \/api\/chat 200 \d+ms$/),
      expect.stringMatching(/^POST \/api\/chat stream_failed \d+ms$/),
    ]);
  });

  it("상위 AI 서버 호출이 실패하면 그 서버의 상태 코드만 로그에 덧붙인다", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args.join(" "));
      });
    }
    const { AuthenticationError } = await import("groq-sdk");

    create.mockRejectedValue(
      new AuthenticationError(401, {}, "비밀 오류", new Headers()),
    );
    expect((await POST(chatRequest(VALID))).status).toBe(502);
    create.mockRejectedValue(new Error("비밀 오류"));
    expect((await POST(chatRequest(VALID))).status).toBe(502);

    expect(logged).toEqual([
      expect.stringMatching(/^POST \/api\/chat 502 \d+ms upstream=401$/),
      expect.stringMatching(/^POST \/api\/chat 502 \d+ms upstream=none$/),
    ]);
    expect(logged.join("\n")).not.toContain("비밀");
  });
});

describe("역할 분리", () => {
  it("이용자 화면 코드는 챗봇 호출을 가져오지 않는다", () => {
    const root = path.resolve(import.meta.dirname, "../../src");
    for (const file of [
      "app/page.tsx",
      "components/DemoHandoff.tsx",
      "components/SpeechInput.tsx",
      "lib/matchHandoff.ts",
      "lib/speech.ts",
    ]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/\/api\/chat|lib\/chat|VolunteerChat/);
    }
  });
});
