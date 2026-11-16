import { afterEach, describe, expect, it, vi } from "vitest";
import { aiChatReducer, createInitialChat, type AiChatModel } from "@/lib/aiChat";
import {
  AI_STATUS,
  CONVERSE_TIMEOUT_MS,
  readConverseResult,
  readTurns,
  requestConverse,
  type ChatTurn,
} from "@/lib/converse";
import { interpretTurn } from "@/lib/converseModel";
import { mockConverseText } from "@/lib/converseMock";
import { registerRequest } from "@/lib/requestRecord";

const ai = (content: string): ChatTurn => ({ role: "assistant", content });
const user = (content: string): ChatTurn => ({ role: "user", content });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readTurns", () => {
  it("빈 기록과 AI·이용자가 번갈아 나오는 기록을 받고 앞뒤 공백을 지운다", () => {
    expect(readTurns([])).toEqual({ ok: true, turns: [] });
    expect(readTurns([ai(" 질문 "), user(" 답 ")])).toEqual({
      ok: true,
      turns: [ai("질문"), user("답")],
    });
  });

  it("순서가 틀리거나 홀수 개면 invalid_request", () => {
    expect(readTurns([user("답")])).toEqual({ ok: false, error: "invalid_request" });
    expect(readTurns([ai("질문")])).toEqual({ ok: false, error: "invalid_request" });
    expect(readTurns([user("가"), ai("나")])).toEqual({ ok: false, error: "invalid_request" });
    expect(readTurns("안녕")).toEqual({ ok: false, error: "invalid_request" });
    expect(readTurns(undefined)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("역할에 없는 값이나 글자가 아닌 내용은 invalid_request", () => {
    expect(readTurns([ai("질문"), { role: "system", content: "x" }])).toMatchObject({ ok: false });
    expect(readTurns([ai("질문"), { role: "user", content: 3 }])).toMatchObject({ ok: false });
  });
});

describe("readConverseResult", () => {
  it("asking·confirming은 reply와 status만 읽는다", () => {
    expect(readConverseResult({ reply: "질문", status: "asking", extra: 1 })).toEqual({
      reply: "질문",
      status: "asking",
    });
    expect(readConverseResult({ reply: "확인", status: "confirming" })).toEqual({
      reply: "확인",
      status: "confirming",
    });
  });

  it("done은 접수가 받는 세 값이 모두 있어야 한다", () => {
    const request = { product: "소니 헤드셋", budget: "10만 원 이하", condition: "새 제품" };
    expect(readConverseResult({ reply: "등록", status: "done", request })).toEqual({
      reply: "등록",
      status: "done",
      request,
    });
    expect(readConverseResult({ reply: "등록", status: "done" })).toBeNull();
    expect(
      readConverseResult({ reply: "등록", status: "done", request: { ...request, budget: "" } }),
    ).toBeNull();
  });

  it("모양이 틀리면 null", () => {
    expect(readConverseResult(null)).toBeNull();
    expect(readConverseResult({ reply: "", status: "asking" })).toBeNull();
    expect(readConverseResult({ reply: "질문", status: "finished" })).toBeNull();
  });
});

describe("requestConverse", () => {
  const stubFetch = (response: Response | Error) => {
    const fetchMock = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("대화 기록 전체를 POST로 보내고 결과를 돌려준다", async () => {
    const fetchMock = stubFetch(
      Response.json({ reply: "예산은 얼마인가요?", status: "asking" }),
    );
    const messages = [ai("어떤 제품을 찾으세요?"), user("헤드셋")];
    const outcome = await requestConverse(messages);
    expect(outcome).toEqual({
      kind: "ok",
      result: { reply: "예산은 얼마인가요?", status: "asking" },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/requests/converse");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ messages });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("서버 상태별 안내: 400은 기본 질문으로(rejected), 429·502는 다시 시도, 503은 기본 질문으로", async () => {
    stubFetch(new Response("{}", { status: 400 }));
    expect(await requestConverse([])).toEqual({ kind: "rejected", status: AI_STATUS.aiTooLong });
    stubFetch(new Response("{}", { status: 429 }));
    expect(await requestConverse([])).toEqual({ kind: "failed", status: AI_STATUS.aiTooMany });
    stubFetch(new Response("{}", { status: 502 }));
    expect(await requestConverse([])).toEqual({ kind: "failed", status: AI_STATUS.aiFailed });
    stubFetch(new Response("{}", { status: 503 }));
    expect(await requestConverse([])).toEqual({
      kind: "rejected",
      status: AI_STATUS.aiNotConfigured,
    });
  });

  it("네트워크 오류, 본문이 약속과 다름, 시간 초과는 failed", async () => {
    stubFetch(new TypeError("fetch failed"));
    expect(await requestConverse([])).toEqual({ kind: "failed", status: AI_STATUS.aiFailed });
    stubFetch(Response.json({ hello: "world" }));
    expect(await requestConverse([])).toEqual({ kind: "failed", status: AI_STATUS.aiFailed });
    stubFetch(new DOMException("timeout", "TimeoutError"));
    expect(await requestConverse([])).toEqual({ kind: "failed", status: AI_STATUS.aiFailed });
  });

  it("서버 마감(28초)보다 긴 시간 제한을 둔다", () => {
    expect(CONVERSE_TIMEOUT_MS).toBeGreaterThan(28_000);
  });
});

describe("대화 → 접수 본문 매핑", () => {
  it("done의 request가 /api/requests 본문의 product·budget·condition이 된다", async () => {
    const turns = [
      ai("어떤 제품을 찾으세요?"),
      user("sony 헤드셋"),
      ai("예산은 얼마인가요?"),
      user("10만 원 이하"),
      ai("새 제품과 중고 중 무엇을 원하세요?"),
      user("새 제품"),
      ai("sony 헤드셋, 예산 10만 원 이하, 새 제품. 이 내용으로 구매 요청을 등록할까요?"),
      user("네, 등록해 주세요"),
    ];
    const verdict = interpretTurn(mockConverseText(turns), turns);
    const done = verdict.ok ? readConverseResult(verdict.result) : null;
    expect(done).toMatchObject({ status: "done" });

    const fetchMock = vi.fn(async () =>
      Response.json({ requestId: "r-1", queueNumber: 3, status: "waiting" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const clientRequestId = "6f1c2e4a-1111-4222-8333-444455556666";
    const outcome = await registerRequest(clientRequestId, done!.request!);
    expect(outcome).toEqual({ kind: "queued", requestId: "r-1", queueNumber: 3 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      clientRequestId,
      product: "sony 헤드셋",
      budget: "10만 원 이하",
      condition: "새 제품",
    });
  });
});

describe("mockConverseText 단계", () => {
  it("이용자 문장 수로 asking 3번 → confirming → done 순서로 간다", () => {
    const steps = [
      [],
      [ai("1"), user("sony 헤드셋")],
      [ai("1"), user("sony 헤드셋"), ai("2"), user("10만 원 이하")],
      [ai("1"), user("sony 헤드셋"), ai("2"), user("10만 원 이하"), ai("3"), user("새 제품")],
    ].map((turns) => JSON.parse(mockConverseText(turns)).status);
    expect(steps).toEqual(["asking", "asking", "asking", "confirming"]);
  });
});

describe("aiChatReducer", () => {
  const start = createInitialChat();
  const replied = (model: AiChatModel, reply: string, status: "asking" | "confirming" = "asking") =>
    aiChatReducer(model, { type: "replied", reply, status });

  it("시작하면 thinking이고 첫 AI 문장이 오면 ready가 된다", () => {
    expect(start).toMatchObject({ phase: "thinking", history: [], turn: 0, status: AI_STATUS.aiThinking });
    const first = replied(start, "어떤 제품을 찾으세요?");
    expect(first).toMatchObject({
      phase: "ready",
      reply: "어떤 제품을 찾으세요?",
      turn: 1,
      status: "",
      history: [ai("어떤 제품을 찾으세요?")],
    });
  });

  it("이용자가 답하면 기록 끝에 붙여 보내고, 답이 오면 기록이 AI 문장으로 끝난다", () => {
    const first = replied(start, "어떤 제품을 찾으세요?");
    const sending = aiChatReducer(first, { type: "send", text: "헤드셋" });
    expect(sending).toMatchObject({ phase: "thinking", status: AI_STATUS.aiThinking });
    expect(sending.sent).toEqual([ai("어떤 제품을 찾으세요?"), user("헤드셋")]);
    expect(sending.history).toEqual([ai("어떤 제품을 찾으세요?")]);
    const second = replied(sending, "예산은 얼마인가요?");
    expect(second.history).toEqual([
      ai("어떤 제품을 찾으세요?"),
      user("헤드셋"),
      ai("예산은 얼마인가요?"),
    ]);
    expect(second.turn).toBe(2);
  });

  it("thinking 중에는 새 답을 보내지 않는다", () => {
    expect(aiChatReducer(start, { type: "send", text: "헤드셋" })).toBe(start);
  });

  it("실패하면 기록은 그대로 두고, 다시 시도하면 같은 대화를 다시 보낸다", () => {
    const first = replied(start, "어떤 제품을 찾으세요?");
    const sending = aiChatReducer(first, { type: "send", text: "헤드셋" });
    const failed = aiChatReducer(sending, { type: "failed", status: AI_STATUS.aiFailed, canRetry: true });
    expect(failed).toMatchObject({ phase: "failed", status: AI_STATUS.aiFailed, canRetry: true });
    expect(failed.history).toEqual(first.history);
    const retry = aiChatReducer(failed, { type: "retry" });
    expect(retry).toMatchObject({ phase: "thinking", status: AI_STATUS.aiThinking });
    expect(retry.sent).toEqual(sending.sent);
  });

  it("다시 시도할 수 없는 실패(대화가 너무 김)는 retry를 무시한다", () => {
    const failed = aiChatReducer(start, { type: "failed", status: AI_STATUS.aiTooLong, canRetry: false });
    expect(aiChatReducer(failed, { type: "retry" })).toBe(failed);
  });

  it("끝난 호출의 늦은 응답은 무시한다", () => {
    const first = replied(start, "질문");
    expect(replied(first, "또 질문")).toBe(first);
    expect(aiChatReducer(first, { type: "failed", status: "x", canRetry: true })).toBe(first);
  });
});
