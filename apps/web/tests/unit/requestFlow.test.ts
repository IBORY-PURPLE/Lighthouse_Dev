import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  createInitialFlow,
  MAX_ANSWER_LENGTH,
  QUESTIONS,
  requestFlowReducer,
  type RequestFlowModel,
} from "@/lib/requestFlow";
import { STATUS } from "@/lib/speech";

function answerAll(model: RequestFlowModel, modes = ["speech", "speech", "speech"] as const) {
  let next = requestFlowReducer(model, { type: "start" });
  const texts = ["소니 헤드셋", "10만 원 이하", "중고"];
  texts.forEach((text, index) => {
    next = requestFlowReducer(next, { type: "answer", text, inputMode: modes[index] });
  });
  return next;
}

describe("requestFlowReducer", () => {
  const initial = createInitialFlow("speech");

  it("intro에서 시작하고 질문 문구는 3개다", () => {
    expect(initial).toMatchObject({ step: "intro", question: 0, status: "" });
    expect(QUESTIONS.map((question) => question.title)).toEqual([
      "질문 1/3. 어떤 제품을 찾으세요?",
      "질문 2/3. 예산은 얼마인가요?",
      "질문 3/3. 새 제품과 중고 중 무엇을 원하세요?",
    ]);
  });

  it("intro → asking(0) → asking(1) → asking(2) → summary", () => {
    const asking0 = requestFlowReducer(initial, { type: "start" });
    expect(asking0).toMatchObject({ step: "asking", question: 0 });
    const asking1 = requestFlowReducer(asking0, { type: "answer", text: "소니 헤드셋", inputMode: "speech" });
    expect(asking1).toMatchObject({ step: "asking", question: 1, answers: { product: "소니 헤드셋" } });
    const asking2 = requestFlowReducer(asking1, { type: "answer", text: "10만 원 이하", inputMode: "speech" });
    expect(asking2).toMatchObject({ step: "asking", question: 2 });
    const summary = requestFlowReducer(asking2, { type: "answer", text: "중고", inputMode: "speech" });
    expect(summary).toMatchObject({
      step: "summary",
      answers: { product: "소니 헤드셋", budget: "10만 원 이하", condition: "중고" },
      status: STATUS.summary("소니 헤드셋", "10만 원 이하", "중고"),
    });
  });

  it("앞 질문이 입력창으로 끝나면 다음 질문도 입력창으로 시작한다", () => {
    let model = requestFlowReducer(initial, { type: "start" });
    model = requestFlowReducer(model, { type: "answer", text: "소니 헤드셋", inputMode: "speech" });
    expect(model.inputMode).toBe("speech");
    model = requestFlowReducer(model, { type: "answer", text: "10만 원", inputMode: "text" });
    expect(model).toMatchObject({ question: 2, inputMode: "text" });
  });

  // PR 2: 요약 다음은 매칭이 아니라 접수 → 대기번호다(시험 변경, PR 본문).
  it("summary → registering → queued, id는 첫 시도 때 정한다", () => {
    const summary = answerAll(initial);
    expect(summary.clientRequestId).toBeNull();
    const registering = requestFlowReducer(summary, { type: "register", clientRequestId: "id-1" });
    expect(registering).toMatchObject({ step: "registering", clientRequestId: "id-1", status: STATUS.registering });
    const queued = requestFlowReducer(registering, { type: "registered", requestId: "r-1", queueNumber: 3 });
    expect(queued).toMatchObject({
      step: "queued",
      queued: { requestId: "r-1", queueNumber: 3 },
      status: STATUS.queued(3),
    });
  });

  it("접수 실패는 요약으로 돌아가 답과 id를 유지하고, 다시 보내면 같은 id를 쓴다", () => {
    const registering = requestFlowReducer(answerAll(initial), { type: "register", clientRequestId: "id-1" });
    const failed = requestFlowReducer(registering, { type: "registerFailed", status: STATUS.registerFailed });
    expect(failed).toMatchObject({
      step: "summary",
      status: STATUS.registerFailed,
      clientRequestId: "id-1",
      answers: { product: "소니 헤드셋", budget: "10만 원 이하", condition: "중고" },
    });
    const retry = requestFlowReducer(failed, { type: "register", clientRequestId: "id-2" });
    expect(retry.clientRequestId).toBe("id-1");
  });

  it("서버가 품목 없음(422)이면 질문 1로 돌아가고 id를 버린다", () => {
    const registering = requestFlowReducer(answerAll(initial), { type: "register", clientRequestId: "id-1" });
    const back = requestFlowReducer(registering, { type: "backToProduct" });
    expect(back).toMatchObject({ step: "asking", question: 0, clientRequestId: null });
  });

  it("다시 열기: checking → 기다리는 중 / 없음 → intro / 확인 실패 → 저장 번호", () => {
    const checking = requestFlowReducer(initial, { type: "check" });
    expect(checking).toMatchObject({ step: "checking", status: STATUS.checking });
    const target = { requestId: "r-1", queueNumber: 7, product: "소니 헤드셋" };
    expect(requestFlowReducer(checking, { type: "resumed", ...target })).toMatchObject({
      step: "queued",
      queued: { requestId: "r-1", queueNumber: 7 },
      answers: { product: "소니 헤드셋" },
      status: STATUS.waiting(7),
    });
    expect(requestFlowReducer(checking, { type: "resumeGone" })).toMatchObject({
      step: "intro",
      status: STATUS.requestGone,
    });
    expect(requestFlowReducer(checking, { type: "resumeFailed", ...target })).toMatchObject({
      step: "queued",
      status: STATUS.checkFailed(7),
    });
  });

  it("대기번호 화면: 이어 보기 실패 안내, 새 요청하기는 처음으로", () => {
    let queued = requestFlowReducer(answerAll(initial), { type: "register", clientRequestId: "id-1" });
    queued = requestFlowReducer(queued, { type: "registered", requestId: "r-1", queueNumber: 1 });
    expect(requestFlowReducer(queued, { type: "handoffFailed", status: STATUS.matchFailed })).toMatchObject({
      step: "queued",
      status: STATUS.matchFailed,
    });
    expect(requestFlowReducer(queued, { type: "newRequest" })).toEqual(createInitialFlow(queued.inputMode));
  });

  it("단계에 맞지 않는 동작은 무시한다", () => {
    expect(requestFlowReducer(initial, { type: "answer", text: "x", inputMode: "speech" })).toBe(initial);
    expect(requestFlowReducer(initial, { type: "register", clientRequestId: "id" })).toBe(initial);
    expect(requestFlowReducer(initial, { type: "resumeGone" })).toBe(initial);
    const summary = answerAll(initial);
    expect(requestFlowReducer(summary, { type: "start" })).toBe(summary);
    expect(requestFlowReducer(summary, { type: "registered", requestId: "r", queueNumber: 1 })).toBe(summary);
    expect(requestFlowReducer(summary, { type: "check" })).toBe(summary);
  });
});

describe("checkAnswer", () => {
  it("질문 1은 품목이 있어야 넘어간다(기기 안 사전)", () => {
    expect(checkAnswer(0, "sony껄로 헤드셋 사고싶어")).toBeNull();
    expect(checkAnswer(0, "소니 헤드폰")).toBeNull();
    expect(checkAnswer(0, "sony껄로 사고싶어")).toBe(STATUS.needProduct);
  });

  it("질문 2·3은 품목을 보지 않는다", () => {
    expect(checkAnswer(1, "10만 원 이하")).toBeNull();
    expect(checkAnswer(2, "중고")).toBeNull();
  });

  it("200자 초과는 답이 길다고 안내한다", () => {
    expect(checkAnswer(1, "가".repeat(MAX_ANSWER_LENGTH))).toBeNull();
    expect(checkAnswer(1, "가".repeat(MAX_ANSWER_LENGTH + 1))).toBe(STATUS.answerTooLong);
    expect(checkAnswer(0, "헤드셋".padEnd(201, "가"))).toBe(STATUS.answerTooLong);
  });
});
