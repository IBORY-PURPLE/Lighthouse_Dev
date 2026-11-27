import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST, runtime } from "@/app/api/voice/chat/route";
import { POST as REGISTER } from "@/app/api/requests/route";
import * as requestStore from "@/lib/requestStore";
import {
  MAX_HISTORY,
  MAX_HISTORY_CONTENT,
  MAX_MESSAGE_LENGTH,
  toQueueRequest,
  VOICE_START_MESSAGE,
  voiceDetails,
  type VoiceTurn,
} from "@/lib/voiceChat";
import { readRequestDetails, resetRequestDetailsForTest } from "@/lib/requestDetails";
import { VOICE_INSTRUCTIONS } from "@/lib/voiceInstructions";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ORIGIN = "http://localhost:3000";
const freshClient = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

function voiceRequest(body: unknown, client: string = freshClient()) {
  return new NextRequest(`${ORIGIN}/api/voice/chat`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client },
  });
}

const sessionId = () => randomUUID();
const user = (content: string): VoiceTurn => ({ role: "user", content });
const ai = (reply: string, extra: Record<string, unknown> = {}): VoiceTurn => ({
  role: "assistant",
  content: JSON.stringify({ reply, status: "asking", summary: "", product: "", ...extra }),
});

const PRODUCT = "sony껄로 헤드셋 사고싶어";
const BUDGET = "10만 원 이하";

/** 화면이 들고 있는 기록: 시작 신호, 첫 질문, 상품, 예산 질문, 예산, 확인 질문. */
const CONFIRMING: VoiceTurn[] = [
  user(VOICE_START_MESSAGE),
  ai("어떤 상품을 찾으세요?"),
  user(PRODUCT),
  ai("예산은 얼마인가요?"),
  user(BUDGET),
  ai(`${PRODUCT}, 예산 ${BUDGET}. 이 내용으로 구매 요청을 등록할까요?`, { status: "confirming" }),
];

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: string }).error;

describe("운영 음성 화면의 진입점", () => {
  it("홈과 구매 요청 목록에서 안내를 거쳐 /live로 이동하고 PWA를 연다", () => {
    const home = readFileSync(path.join(ROOT, "web/public/voice/index.html"), "utf8");
    const guide = readFileSync(path.join(ROOT, "web/public/voice/request.html"), "utf8");
    const requests = readFileSync(path.join(ROOT, "web/public/voice/requests.js"), "utf8");
    expect(home.match(/<a [^>]*href="\/request"/g)).toHaveLength(2);
    expect(guide).toContain('<a class="guide-start" href="/live">질문 시작하기</a>');
    expect(home).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(requests).not.toContain("/api/voice/chat");
  });
});

describe("POST /api/voice/chat (가짜 AI)", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Vercel 설정값: nodejs, 최대 30초", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });

  it("reset이면 기록 없이 첫 질문을 하고 원본 응답 모양(reply, status, summary, product)이다", async () => {
    const response = await POST(
      voiceRequest({ sessionId: sessionId(), message: "", reset: true }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      reply: "어떤 상품을 찾으세요?",
      status: "asking",
      summary: "",
      product: "",
    });
  });

  it("reset이면 보낸 history는 무시한다", async () => {
    const response = await POST(
      voiceRequest({ sessionId: sessionId(), message: "", reset: true, history: CONFIRMING }),
    );
    expect((await response.json()).status).toBe("asking");
  });

  it("기록만으로 이어진다(무상태): 다른 sessionId로도, 몇 번을 보내도 같다", async () => {
    const send = async () =>
      (
        await POST(
          voiceRequest({ sessionId: sessionId(), message: "네, 등록해 주세요", history: CONFIRMING }),
        )
      ).json();
    const first = await send();
    expect(await send()).toEqual(first);
    expect(first).toMatchObject({ status: "done", summary: `${PRODUCT}, 예산 ${BUDGET}`, product: PRODUCT });
  });

  it("확정(done)이면 접수가 받는 모양의 request를 덧붙인다", async () => {
    const body = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: "네", history: CONFIRMING }))
    ).json();
    // 접수 본문에 이용자가 확인한 요약과 질문·답(details)이 실린다. 마지막 동의("네")와 확인 질문은 뺀다.
    expect(body.request).toEqual({
      product: PRODUCT,
      budget: BUDGET,
      condition: "정하지 않음",
      details: {
        summary: `${PRODUCT}, 예산 ${BUDGET}`,
        qa: [
          { q: "어떤 상품을 찾으세요?", a: PRODUCT },
          { q: "예산은 얼마인가요?", a: BUDGET },
        ],
      },
    });
  });

  it("확정 전(asking·confirming)에는 request가 없다", async () => {
    const asking = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: PRODUCT, history: CONFIRMING.slice(0, 2) }))
    ).json();
    expect(asking.status).toBe("asking");
    expect(asking).not.toHaveProperty("request");
    const confirming = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: BUDGET, history: CONFIRMING.slice(0, 4) }))
    ).json();
    expect(confirming.status).toBe("confirming");
    expect(confirming).not.toHaveProperty("request");
  });

  it("동의하지 않으면 done이 아니다", async () => {
    const body = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: "아니요", history: CONFIRMING }))
    ).json();
    expect(body.status).toBe("confirming");
  });

  it("done의 request로 접수(POST /api/requests)하면 대기번호가 나온다", async () => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
    resetRequestDetailsForTest();
    const id = sessionId();
    const done = await (
      await POST(voiceRequest({ sessionId: id, message: "네", history: CONFIRMING }))
    ).json();
    const registered = await REGISTER(
      new NextRequest(`${ORIGIN}/api/requests`, {
        method: "POST",
        // 화면은 대화 id를 접수 id로 쓴다.
        body: JSON.stringify({ clientRequestId: id, ...done.request }),
        headers: { "x-forwarded-for": freshClient() },
      }),
    );
    expect(registered.status).toBe(201);
    const created = await registered.json();
    expect(created).toMatchObject({ queueNumber: 1, status: "waiting" });
    // 접수에 실린 details가 저장되어 맡은 봉사자에게 내보낼 수 있다.
    expect(await readRequestDetails(created.requestId)).toEqual(done.request.details);
  });

  it("품목 사전에 없는 물건도 확정되면 request를 돌려주고, 그 request로 접수된다(A6)", async () => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
    const id = sessionId();
    const history = [
      user(VOICE_START_MESSAGE),
      ai("어떤 상품을 찾으세요?"),
      user("전기밥솥"),
      ai("예산은 얼마인가요?"),
      user("5만 원"),
      ai("전기밥솥, 예산 5만 원. 이 내용으로 구매 요청을 등록할까요?", { status: "confirming" }),
    ];
    const body = await (
      await POST(voiceRequest({ sessionId: id, message: "네", history }))
    ).json();
    expect(body.status).toBe("done");
    expect(body.request).toMatchObject({ product: "전기밥솥", budget: "5만 원", condition: "정하지 않음" });
    // 브리핑(#61): 사전에 없는 물건도 이용자 질문·답이 접수 본문에 함께 실린다.
    expect(body.request.details).toEqual({
      summary: "전기밥솥, 예산 5만 원",
      qa: [
        { q: "어떤 상품을 찾으세요?", a: "전기밥솥" },
        { q: "예산은 얼마인가요?", a: "5만 원" },
      ],
    });
    const registered = await REGISTER(
      new NextRequest(`${ORIGIN}/api/requests`, {
        method: "POST",
        body: JSON.stringify({ clientRequestId: id, ...body.request }),
        headers: { "x-forwarded-for": freshClient() },
      }),
    );
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ queueNumber: 1, status: "waiting" });
  });

  describe("입력 검사(원본 메시지 그대로)", () => {
    const rejected = async (body: unknown, error: string) => {
      const response = await POST(voiceRequest(body));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe(error);
    };

    it("sessionId가 형식에 맞지 않으면 세션 식별자 오류", async () => {
      await rejected({ message: "안녕", reset: true }, "세션 식별자 오류");
      await rejected({ sessionId: "짧음", message: "안녕", reset: true }, "세션 식별자 오류");
      await rejected({ sessionId: "a".repeat(101), message: "x", reset: true }, "세션 식별자 오류");
      await rejected({ sessionId: "abc def ghi!", message: "x", reset: true }, "세션 식별자 오류");
    });

    it("message가 글자가 아니거나 1000자를 넘으면 메시지 길이 오류", async () => {
      await rejected({ sessionId: sessionId(), message: 3, history: [] }, "메시지 길이 오류");
      await rejected(
        { sessionId: sessionId(), message: "가".repeat(MAX_MESSAGE_LENGTH + 1), history: [] },
        "메시지 길이 오류",
      );
    });

    it("reset이 아닌데 빈 답이면 답변을 입력해 주세요", async () => {
      await rejected({ sessionId: sessionId(), message: "   ", history: [] }, "답변을 입력해 주세요");
    });

    it("기록이 36칸 이상이면 대화가 너무 길어졌다고 한다(원본의 history.length >= 36)", async () => {
      const long = Array.from({ length: MAX_HISTORY }, (_, i) => (i % 2 === 0 ? user("가") : ai("나")));
      await rejected(
        { sessionId: sessionId(), message: "답", history: long },
        "대화가 너무 길어졌습니다. 새 요청을 시작해 주세요.",
      );
      const edge = long.slice(0, MAX_HISTORY - 1);
      expect(
        (await POST(voiceRequest({ sessionId: sessionId(), message: "답", history: edge }))).status,
      ).toBe(200);
    });

    it("기록이 없거나 모양이 틀리면 대화 기록 오류", async () => {
      await rejected({ sessionId: sessionId(), message: "답" }, "대화 기록 오류");
      await rejected({ sessionId: sessionId(), message: "답", history: "안녕" }, "대화 기록 오류");
      await rejected(
        { sessionId: sessionId(), message: "답", history: [{ role: "system", content: "x" }] },
        "대화 기록 오류",
      );
      await rejected(
        { sessionId: sessionId(), message: "답", history: [{ role: "user", content: 3 }] },
        "대화 기록 오류",
      );
      await rejected(
        {
          sessionId: sessionId(),
          message: "답",
          history: [user("가".repeat(MAX_HISTORY_CONTENT + 1))],
        },
        "대화 기록 오류",
      );
    });

    it("JSON이 아니면 400, 64KB를 넘으면 읽다가 끊고 400", async () => {
      const broken = await POST(voiceRequest("이건 JSON이 아니다"));
      expect(broken.status).toBe(400);
      const huge = await POST(
        voiceRequest({ sessionId: sessionId(), message: "답", history: [], padding: "가".repeat(30_000) }),
      );
      expect(huge.status).toBe(400);
      expect(await errorOf(huge)).toBe("요청이 너무 큽니다");
    });
  });

  it("같은 주소는 분당 21번째부터 429와 Retry-After", async () => {
    const client = freshClient();
    const send = () =>
      POST(voiceRequest({ sessionId: sessionId(), message: "", reset: true }, client));
    for (let i = 0; i < 20; i += 1) expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await POST(voiceRequest({ sessionId: sessionId(), message: "", reset: true }))).status).toBe(200);
  });
});

describe("POST /api/voice/chat (OpenAI 호출 값과 실패)", () => {
  const fetchMock = vi.fn();

  const modelText = (value: unknown) =>
    Response.json({
      output: [
        { content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }] },
      ],
    });

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ask = (body: Record<string, unknown> = {}) =>
    POST(
      voiceRequest({
        sessionId: sessionId(),
        message: "",
        reset: true,
        ...body,
      }),
    );

  it("호출값이 원본과 같다: Responses API, gpt-4.1-mini, 450토큰, JSON, store false, 지시문 원문", async () => {
    fetchMock.mockResolvedValueOnce(
      modelText({ reply: "어떤 상품을 찾으세요?", status: "asking", summary: "", product: "" }),
    );
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reply: "어떤 상품을 찾으세요?",
      status: "asking",
      summary: "",
      product: "",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      model: "gpt-4.1-mini",
      instructions: VOICE_INSTRUCTIONS,
      input: [
        { role: "developer", content: "반드시 JSON 객체로 답변하세요." },
        { role: "user", content: VOICE_START_MESSAGE },
      ],
      max_output_tokens: 450,
      text: { format: { type: "json_object" } },
      store: false,
    });
  });

  it("OPENAI_MODEL이 있으면 그 모델을 쓴다", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-test-model");
    fetchMock.mockResolvedValueOnce(modelText({ reply: "질문", status: "asking" }));
    await ask();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("gpt-test-model");
  });

  it("기록 전체와 이번 답을 순서대로 모델에 보낸다", async () => {
    fetchMock.mockResolvedValueOnce(modelText({ reply: "확인", status: "confirming" }));
    await ask({ reset: false, message: "  네, 등록해 주세요  ", history: CONFIRMING });
    const { input } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(input).toEqual([
      { role: "developer", content: "반드시 JSON 객체로 답변하세요." },
      ...CONFIRMING,
      { role: "user", content: "네, 등록해 주세요" },
    ]);
  });

  it("done 응답에 접수용 request를 덧붙인다", async () => {
    fetchMock.mockResolvedValueOnce(
      modelText({
        reply: "등록할게요.",
        status: "done",
        summary: "소니 무선 헤드셋, 새 제품으로 30만 원 이하",
        product: "소니 무선 헤드셋",
      }),
    );
    const body = await (await ask({ reset: false, message: "네", history: CONFIRMING })).json();
    expect(body.request).toEqual({
      product: "소니 무선 헤드셋",
      budget: "30만 원 이하",
      condition: "새 제품",
      details: {
        summary: "소니 무선 헤드셋, 새 제품으로 30만 원 이하",
        qa: [
          { q: "어떤 상품을 찾으세요?", a: PRODUCT },
          { q: "예산은 얼마인가요?", a: BUDGET },
        ],
      },
    });
  });

  it("키가 없으면 503과 원본 메시지이고 OpenAI를 부르지 않는다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe("서버에 OPENAI_API_KEY가 설정되지 않았습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OpenAI 오류는 500과 원본 안내문이고 키와 상위 메시지를 내보내지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: "Incorrect API key test-key" } }, { status: 401 }),
    );
    const response = await ask();
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error).toBe("AI 요청에 실패했습니다. 서버 설정과 API 사용량을 확인해 주세요.");
    expect(error).not.toContain("test-key");
  });

  it("시간 초과(AbortError)는 500과 원본 시간 초과 안내문", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const response = await ask();
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe("AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.");
  });

  it("25초 마감 타이머를 건다", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const pending = ask();
      await vi.advanceTimersByTimeAsync(24_999);
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      const response = await pending;
      expect(response.status).toBe(500);
      expect(await errorOf(response)).toContain("시간이 초과");
    } finally {
      vi.useRealTimers();
    }
  });

  const badOutputs: [string, unknown][] = [
    ["JSON이 아님", "죄송합니다."],
    ["reply 없음", { status: "asking" }],
    ["알 수 없는 status", { reply: "질문", status: "finished" }],
  ];
  it.each(badOutputs)("모델 출력 형식 오류(%s)는 500", async (_name, value) => {
    fetchMock.mockResolvedValueOnce(modelText(value));
    expect((await ask()).status).toBe(500);
  });

  it("로그에 이용자 문장과 AI 답을 남기지 않는다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(modelText({ reply: "비밀 답변", status: "asking" }));
    await ask({ reset: false, message: "비밀스러운 말", history: [] });
    const logged = info.mock.calls.flat().join("\n");
    expect(logged).toMatch(/POST \/api\/voice\/chat 200 \d+ms/);
    expect(logged).not.toContain("비밀스러운 말");
    expect(logged).not.toContain("비밀 답변");
  });
});

describe("voiceDetails(대화 기록 → 봉사자 브리핑)", () => {
  const consent = user("네, 등록해 주세요");

  it("질문과 바로 다음 이용자 답을 한 짝으로 묶고, 시작 문장과 마지막 동의는 뺀다", () => {
    expect(voiceDetails([...CONFIRMING, consent], "요약 글")).toEqual({
      summary: "요약 글",
      qa: [
        { q: "어떤 상품을 찾으세요?", a: PRODUCT },
        { q: "예산은 얼마인가요?", a: BUDGET },
      ],
    });
  });

  it("확인 중에 고친 말은 남기고, 마지막 동의만 뺀다", () => {
    const fixed = [
      ...CONFIRMING,
      user("아니요, 예산은 20만 원으로 해 주세요"),
      ai("20만 원으로 고쳐서 다시 확인합니다. 등록할까요?", { status: "confirming" }),
      consent,
    ];
    const qa = voiceDetails(fixed, "요약")?.qa ?? [];
    expect(qa).toHaveLength(3);
    expect(qa[2]).toEqual({
      q: `${PRODUCT}, 예산 ${BUDGET}. 이 내용으로 구매 요청을 등록할까요?`,
      a: "아니요, 예산은 20만 원으로 해 주세요",
    });
    expect(JSON.stringify(qa)).not.toContain("네, 등록해 주세요");
  });

  it("깨진 JSON 칸과 status가 done·알 수 없는 칸은 건너뛴다", () => {
    const turns: VoiceTurn[] = [
      user(VOICE_START_MESSAGE),
      { role: "assistant", content: "{깨진" },
      user("첫 답"),
      ai("끝난 칸", { status: "done" }),
      user("둘째 답"),
      { role: "assistant", content: JSON.stringify({ reply: 3, status: "asking" }) },
      user("셋째 답"),
      ai("예산은 얼마인가요?"),
      user("넷째 답"),
      consent,
    ];
    expect(voiceDetails(turns, "요약")?.qa).toEqual([{ q: "예산은 얼마인가요?", a: "넷째 답" }]);
  });

  it("시작 문장만 있는 기록은 짝이 없다(요약만 남는다). 요약도 없으면 null", () => {
    expect(voiceDetails([user(VOICE_START_MESSAGE), consent], "요약")).toEqual({ summary: "요약", qa: [] });
    expect(voiceDetails([user(VOICE_START_MESSAGE), consent], "")).toBeNull();
  });

  it("12짝까지만 둔다(대화 상한 36칸이면 최대 17짝이다)", () => {
    const turns: VoiceTurn[] = [user(VOICE_START_MESSAGE)];
    for (let index = 0; index < 16; index += 1) turns.push(ai(`질문 ${index}`), user(`답 ${index}`));
    turns.push(consent);
    const qa = voiceDetails(turns, "요약")?.qa ?? [];
    expect(qa).toHaveLength(12);
    expect(qa[0]).toEqual({ q: "질문 0", a: "답 0" });
  });

  it("긴 말과 전화번호는 cleanRequestDetails가 다듬는다", () => {
    const turns = [ai("연락처를 알려 주세요"), user("010-1234-5678이에요"), ai("마지막 질문"), consent];
    expect(voiceDetails(turns, "요약")?.qa).toEqual([{ q: "연락처를 알려 주세요", a: "(전화번호 가림)이에요" }]);
  });
});

describe("toQueueRequest(확정 요청 → 접수 본문)", () => {
  it("product에 품목이 있으면 product를 쓰고 예산·조건은 요약에서 찾는다", () => {
    expect(
      toQueueRequest("소니 무선 헤드셋", "소니 무선 헤드셋, 중고, 10만 원 안쪽"),
    ).toEqual({ product: "소니 무선 헤드셋", budget: "10만 원 안쪽", condition: "중고" });
  });

  it("product에 품목이 없고 요약에 있으면 요약을 product로 쓴다", () => {
    expect(toQueueRequest("무선 이어셋", "무선 헤드폰을 새 상품으로 찾습니다")).toEqual({
      product: "무선 헤드폰을 새 상품으로 찾습니다",
      budget: "정하지 않음",
      condition: "새 제품",
    });
  });

  it("예산·조건을 못 찾으면 정하지 않음이고, 한글 금액도 읽는다", () => {
    expect(toQueueRequest("헤드셋", "")).toEqual({
      product: "헤드셋",
      budget: "정하지 않음",
      condition: "정하지 않음",
    });
    expect(toQueueRequest("헤드셋", "헤드셋 십만 원 이하")?.budget).toBe("십만 원 이하");
    // '이 원하는'의 "이 원"을 금액으로 읽지 않는다.
    expect(toQueueRequest("헤드셋", "이 원하는 헤드셋")?.budget).toBe("정하지 않음");
  });

  it("품목 사전에 없는 물건은 product를, product가 비면 summary를 그대로 쓴다(A6)", () => {
    expect(toQueueRequest("전기밥솥", "소형 전기밥솥 5만 원")).toEqual({
      product: "전기밥솥",
      budget: "5만 원",
      condition: "정하지 않음",
    });
    expect(toQueueRequest("", "소형 전기밥솥 5만 원")?.product).toBe("소형 전기밥솥 5만 원");
  });

  it("product와 summary가 모두 비었을 때만 null", () => {
    expect(toQueueRequest("", "")).toBeNull();
    expect(toQueueRequest("  ", " ")).toBeNull();
  });

  it("접수 상한(200자)에 맞게 자른다", () => {
    expect(toQueueRequest("헤드셋".padEnd(300, "가"), "")?.product).toHaveLength(200);
  });
});
