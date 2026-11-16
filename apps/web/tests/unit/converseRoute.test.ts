import { randomUUID } from "node:crypto";
import { APIConnectionTimeoutError, RateLimitError } from "openai";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST, runtime } from "@/app/api/requests/converse/route";
import { POST as REGISTER } from "@/app/api/requests/route";
import {
  CONVERSE_MAX_COMPLETION_TOKENS,
  LLM_MODEL,
} from "@/lib/llm";
import {
  MAX_REPLY_LENGTH,
  MAX_TOTAL_LENGTH,
  MAX_TURNS,
  MAX_USER_LENGTH,
  type ChatTurn,
} from "@/lib/converse";
import { CONVERSE_INSTRUCTIONS } from "@/lib/prompt";
import * as requestStore from "@/lib/requestStore";

// 일반 시험은 실제 OpenAI를 부르지 않는다(.claude/rules/chatbot-quality.md).
const { create, constructed } = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as unknown[],
}));

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    chat = { completions: { create } };
    constructor(options: unknown) {
      constructed.push(options);
    }
  }
  return { ...actual, default: FakeOpenAI, OpenAI: FakeOpenAI };
});

const ORIGIN = "http://localhost:3000";
const freshClient = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

function converseRequest(body: unknown, client: string = freshClient()) {
  return new NextRequest(`${ORIGIN}/api/requests/converse`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client },
  });
}

const ai = (content: string): ChatTurn => ({ role: "assistant", content });
const user = (content: string): ChatTurn => ({ role: "user", content });

const PRODUCT = "sony껄로 헤드셋 사고싶어";
const BUDGET = "10만 원 이하";
const CONDITION = "새 제품";

/** 모의 AI가 확인 질문까지 마친 대화. */
const CONFIRMED: ChatTurn[] = [
  ai("어떤 제품을 찾으세요?"),
  user(PRODUCT),
  ai("예산은 얼마인가요?"),
  user(BUDGET),
  ai("새 제품과 중고 중 무엇을 원하세요?"),
  user(CONDITION),
  ai(`${PRODUCT}, 예산 ${BUDGET}, ${CONDITION}. 이 내용으로 구매 요청을 등록할까요?`),
  user("네, 등록해 주세요"),
];

function modelAnswer(fields: Record<string, unknown>) {
  create.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(fields) }, finish_reason: "stop" }],
  });
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: string }).error;

describe("POST /api/requests/converse (가짜 AI)", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "");
    create.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Vercel 설정값: nodejs, 최대 30초", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });

  it("빈 기록이면 첫 질문을 한다(asking)", async () => {
    const response = await POST(converseRequest({ messages: [] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      reply: "어떤 제품을 찾으세요?",
      status: "asking",
    });
  });

  it("조건을 다 들으면 등록 확인을 묻고(confirming) 아직 request는 없다", async () => {
    const response = await POST(converseRequest({ messages: CONFIRMED.slice(0, 6) }));
    const body = await response.json();
    expect(body.status).toBe("confirming");
    expect(body.reply).toContain("이 내용으로 구매 요청을 등록할까요?");
    expect(body).not.toHaveProperty("request");
  });

  it("동의하면 done과 접수 모양의 request를 준다", async () => {
    const response = await POST(converseRequest({ messages: CONFIRMED }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reply: "요청을 등록합니다.",
      status: "done",
      request: { product: PRODUCT, budget: BUDGET, condition: CONDITION },
    });
  });

  it("동의하지 않으면 done이 아니라 다시 확인한다", async () => {
    const messages = [...CONFIRMED.slice(0, 7), user("아니요, 고치고 싶어요")];
    const body = await (await POST(converseRequest({ messages }))).json();
    expect(body.status).toBe("confirming");
    expect(body).not.toHaveProperty("request");
  });

  it("무상태: 같은 기록은 누가 몇 번 보내도 같은 답이고, 다른 기록의 영향을 받지 않는다", async () => {
    const first = await (await POST(converseRequest({ messages: CONFIRMED }))).json();
    await POST(converseRequest({ messages: [] }));
    const again = await (await POST(converseRequest({ messages: CONFIRMED }))).json();
    expect(again).toEqual(first);
    // 기록이 짧으면 앞서 동의한 기록이 있어도 done이 되지 않는다.
    const short = await (await POST(converseRequest({ messages: CONFIRMED.slice(0, 2) }))).json();
    expect(short.status).toBe("asking");
  });

  it("done의 request로 접수하면 대기번호가 나온다(기록 → 접수 본문 매핑)", async () => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
    const done = await (await POST(converseRequest({ messages: CONFIRMED }))).json();
    const registered = await REGISTER(
      new NextRequest(`${ORIGIN}/api/requests`, {
        method: "POST",
        body: JSON.stringify({ clientRequestId: randomUUID(), ...done.request }),
        headers: { "x-forwarded-for": freshClient() },
      }),
    );
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ queueNumber: 1, status: "waiting" });
  });

  describe("입력 검사", () => {
    const rejected = async (body: unknown, error: string) => {
      const response = await POST(converseRequest(body));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe(error);
      expect(create).not.toHaveBeenCalled();
    };

    it("JSON이 아니거나 messages가 배열이 아니면 invalid_request", async () => {
      await rejected("이건 JSON이 아니다", "invalid_request");
      await rejected({}, "invalid_request");
      await rejected({ messages: "안녕" }, "invalid_request");
      await rejected(null, "invalid_request");
    });

    it("AI 문장으로 시작해 번갈아 나오고 이용자 문장으로 끝나야 한다", async () => {
      await rejected({ messages: [user("헤드셋")] }, "invalid_request");
      await rejected({ messages: [ai("질문")] }, "invalid_request");
      await rejected({ messages: [ai("질문"), ai("또 질문")] }, "invalid_request");
      await rejected({ messages: [user("가"), ai("나")] }, "invalid_request");
      await rejected({ messages: [ai("질문"), { role: "system", content: "x" }] }, "invalid_request");
      await rejected({ messages: [ai("질문"), { role: "user" }] }, "invalid_request");
      await rejected({ messages: [ai("질문"), user("   ")] }, "invalid_request");
    });

    it("턴 수, 이용자 글자 수, AI 글자 수, 전체 글자 수 상한을 넘으면 too_long", async () => {
      const long = Array.from({ length: MAX_TURNS + 2 }, (_, i) =>
        i % 2 === 0 ? ai("질문") : user("답"),
      );
      await rejected({ messages: long }, "too_long");
      await rejected(
        { messages: [ai("질문"), user("가".repeat(MAX_USER_LENGTH + 1))] },
        "too_long",
      );
      await rejected(
        { messages: [ai("가".repeat(MAX_REPLY_LENGTH + 1)), user("답")] },
        "too_long",
      );
      // 개별 상한은 지키지만 합이 넘는 기록.
      const pairs = Math.ceil(MAX_TOTAL_LENGTH / (MAX_REPLY_LENGTH + MAX_USER_LENGTH)) + 1;
      const heavy = Array.from({ length: pairs * 2 }, (_, i) =>
        i % 2 === 0 ? ai("가".repeat(MAX_REPLY_LENGTH)) : user("나".repeat(MAX_USER_LENGTH)),
      );
      await rejected({ messages: heavy.slice(0, MAX_TURNS) }, "too_long");
    });

    it("상한 안의 가장 긴 대화는 받는다", async () => {
      const edge = Array.from({ length: MAX_TURNS }, (_, i) =>
        i % 2 === 0 ? ai("질문".repeat(10)) : user("답".repeat(20)),
      );
      expect((await POST(converseRequest({ messages: edge }))).status).toBe(200);
    });

    it("요청 본문이 16KB를 넘으면 읽다가 끊고 too_long이다", async () => {
      const huge = JSON.stringify({ messages: [], padding: "가".repeat(20_000) });
      const response = await POST(converseRequest(huge));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("too_long");
    });
  });

  it("같은 주소는 분당 13번째부터 429와 Retry-After", async () => {
    const client = freshClient();
    for (let i = 0; i < 12; i += 1) {
      expect((await POST(converseRequest({ messages: [] }, client))).status).toBe(200);
    }
    const limited = await POST(converseRequest({ messages: [] }, client));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorOf(limited)).toBe("rate_limited");
    // 다른 주소는 영향이 없다.
    expect((await POST(converseRequest({ messages: [] }))).status).toBe(200);
  });

  it("횟수 제한은 형식 검사보다 먼저다(잘못된 요청도 횟수를 쓴다)", async () => {
    const client = freshClient();
    for (let i = 0; i < 12; i += 1) await POST(converseRequest("깨진 본문", client));
    expect((await POST(converseRequest({ messages: [] }, client))).status).toBe(429);
  });
});

describe("POST /api/requests/converse (모델 호출 값과 실패)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    create.mockReset();
    constructed.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("호출값: gpt-6-luna, 추론 끔, 출력 상한, JSON 모드, 대화 기록 전체와 지시문", async () => {
    modelAnswer({ reply: "예산은 얼마인가요?", status: "asking" });
    const messages = [ai("어떤 제품을 찾으세요?"), user(PRODUCT)];
    const response = await POST(converseRequest({ messages }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: "예산은 얼마인가요?", status: "asking" });

    expect(constructed).toEqual([{ apiKey: "test-key", maxRetries: 1, timeout: 20_000 }]);
    const [params, options] = create.mock.calls[0];
    expect(params.model).toBe(LLM_MODEL);
    expect(params.model).toBe("gpt-6-luna");
    expect(params.reasoning_effort).toBe("none");
    expect(params.max_completion_tokens).toBe(CONVERSE_MAX_COMPLETION_TOKENS);
    expect(params.response_format).toEqual({ type: "json_object" });
    expect(params.stream).toBeUndefined();
    expect(params.messages[0]).toEqual({ role: "system", content: CONVERSE_INSTRUCTIONS });
    expect(params.messages.slice(2)).toEqual(messages);
    expect(params.messages[1].role).toBe("user");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("지시문에 한 번에 질문 하나, 확인 문구, 동의 전 done 금지, 가격·재고 금지가 들어 있다", () => {
    expect(CONVERSE_INSTRUCTIONS).toContain("한 번에 질문은 하나만");
    expect(CONVERSE_INSTRUCTIONS).toContain("이 내용으로 구매 요청을 등록할까요?");
    expect(CONVERSE_INSTRUCTIONS).toContain("동의하기 전에는 done을 쓰지 않는다");
    expect(CONVERSE_INSTRUCTIONS).toContain("확인한 것처럼 말하지 않는다");
    expect(CONVERSE_INSTRUCTIONS).toContain("asking");
    expect(CONVERSE_INSTRUCTIONS).toContain("confirming");
    expect(CONVERSE_INSTRUCTIONS).toContain("done");
  });

  it("코드 블록이나 앞뒤 설명이 붙은 JSON도 읽는다", async () => {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: { content: '```json\n{"reply":"예산은 얼마인가요?","status":"asking"}\n```' },
          finish_reason: "stop",
        },
      ],
    });
    const response = await POST(converseRequest({ messages: [ai("질문"), user(PRODUCT)] }));
    expect((await response.json()).reply).toBe("예산은 얼마인가요?");
  });

  it("done이면 빈 예산·조건에 기본 문구를 채운다", async () => {
    modelAnswer({ reply: "등록합니다.", status: "done", product: PRODUCT, budget: "", condition: "" });
    const body = await (await POST(converseRequest({ messages: CONFIRMED }))).json();
    expect(body.request).toEqual({
      product: PRODUCT,
      budget: "정하지 않음",
      condition: "상관없음",
    });
  });

  it("접수가 받지 않는 품목이면 done을 막고 헤드셋만 받는다고 되묻는다", async () => {
    modelAnswer({ reply: "등록합니다.", status: "done", product: "전기밥솥", budget: BUDGET, condition: CONDITION });
    const messages = [
      ...CONFIRMED.slice(0, 6),
      ai("전기밥솥, 예산 10만 원 이하, 새 제품. 이 내용으로 구매 요청을 등록할까요?"),
      user("네"),
    ];
    const body = await (await POST(converseRequest({ messages }))).json();
    expect(body).toEqual({
      reply: "지금은 헤드셋 요청만 받을 수 있습니다. 헤드셋을 찾으시나요?",
      status: "asking",
    });
  });

  it("바로 앞 AI 문장이 등록 확인이 아니면 done을 받아들이지 않는다(동의 전 등록 금지)", async () => {
    modelAnswer({ reply: "등록합니다.", status: "done", product: PRODUCT, budget: BUDGET, condition: CONDITION });
    const messages = [ai("어떤 제품을 찾으세요?"), user(PRODUCT)];
    const response = await POST(converseRequest({ messages }));
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe("llm_failed");
  });

  describe("금지 표현", () => {
    const ask = async (reply: string, extra: Record<string, unknown> = {}) => {
      modelAnswer({ reply, status: "asking", ...extra });
      return POST(converseRequest({ messages: [ai("어떤 제품을 찾으세요?"), user(PRODUCT)] }));
    };

    it("이용자가 말하지 않은 금액은 502로 막는다", async () => {
      const response = await ask("소니 헤드셋은 보통 5만 원쯤 해요. 예산은 얼마인가요?");
      expect(response.status).toBe(502);
      expect(await errorOf(response)).toBe("llm_failed");
    });

    it("재고 단정은 502로 막는다", async () => {
      expect((await ask("지금 재고가 있어요. 예산은 얼마인가요?")).status).toBe(502);
    });

    it("이용자가 말하지 않은 모델명은 502로 막는다", async () => {
      expect((await ask("WH-1000XM5를 찾으세요?")).status).toBe(502);
    });

    it("AI가 채운 상품·예산 칸의 지어낸 값도 막는다", async () => {
      expect(
        (await ask("예산은 얼마인가요?", { product: "소니 WH-1000XM5 헤드셋" })).status,
      ).toBe(502);
    });

    it("이용자가 말한 예산과 상품 이름은 되풀이해도 된다", async () => {
      modelAnswer({
        reply: `${BUDGET}로 ${PRODUCT} 맞으신가요?`,
        status: "asking",
      });
      const response = await POST(
        converseRequest({ messages: [ai("예산은 얼마인가요?"), user(BUDGET), ai("질문"), user(PRODUCT)] }),
      );
      expect(response.status).toBe(200);
    });
  });

  describe("모델 출력 형식 오류는 502 llm_failed", () => {
    const cases: [string, unknown][] = [
      ["JSON이 아님", "죄송합니다. 다시 말씀해 주세요."],
      ["reply 없음", { status: "asking" }],
      ["reply가 비어 있음", { reply: "  ", status: "asking" }],
      ["알 수 없는 status", { reply: "질문", status: "finished" }],
      ["reply가 상한보다 김", { reply: "가".repeat(MAX_REPLY_LENGTH + 1), status: "asking" }],
      ["done인데 product 없음", { reply: "등록", status: "done", product: "", budget: "a", condition: "b" }],
    ];
    it.each(cases)("%s", async (_name, content) => {
      create.mockResolvedValueOnce({
        choices: [
          {
            message: { content: typeof content === "string" ? content : JSON.stringify(content) },
            finish_reason: "stop",
          },
        ],
      });
      const response = await POST(converseRequest({ messages: CONFIRMED }));
      expect(response.status).toBe(502);
      expect(await errorOf(response)).toBe("llm_failed");
    });
  });

  it("출력이 상한에 잘렸거나(length) 글자가 없으면 502", async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"reply":"예산은' }, finish_reason: "length" }],
    });
    expect((await POST(converseRequest({ messages: [] }))).status).toBe(502);
    create.mockResolvedValueOnce({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    expect((await POST(converseRequest({ messages: [] }))).status).toBe(502);
  });

  it("시간 초과(APIConnectionTimeoutError)는 502, 한도 초과(429)는 429와 Retry-After", async () => {
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    const timedOut = await POST(converseRequest({ messages: [] }));
    expect(timedOut.status).toBe(502);
    expect(await errorOf(timedOut)).toBe("llm_failed");

    create.mockRejectedValueOnce(
      new RateLimitError(429, {}, "rate limit", new Headers()),
    );
    const limited = await POST(converseRequest({ messages: [] }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("28초 예산 신호를 모델 호출에 넘긴다", async () => {
    modelAnswer({ reply: "어떤 제품을 찾으세요?", status: "asking" });
    await POST(converseRequest({ messages: [] }));
    const [, options] = create.mock.calls[0];
    expect(options.signal.aborted).toBe(false);
  });

  it("키가 없으면 503 not_configured이고 모델을 부르지 않는다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(converseRequest({ messages: [] }));
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe("not_configured");
    expect(create).not.toHaveBeenCalled();
  });

  it("로그에 이용자 문장과 AI 답을 남기지 않는다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    modelAnswer({ reply: "예산은 얼마인가요?", status: "asking" });
    await POST(converseRequest({ messages: [ai("질문"), user("비밀스러운 말")] }));
    const logged = info.mock.calls.flat().join("\n");
    expect(logged).toMatch(/POST \/api\/requests\/converse 200 \d+ms/);
    expect(logged).not.toContain("비밀스러운 말");
    expect(logged).not.toContain("예산은 얼마인가요?");
  });
});
