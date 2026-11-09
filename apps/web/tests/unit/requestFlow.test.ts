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

  it("summary → matching → connected", () => {
    const summary = answerAll(initial);
    const matching = requestFlowReducer(summary, { type: "requestMatch" });
    expect(matching).toMatchObject({ step: "matching", status: STATUS.matching });
    const connected = requestFlowReducer(matching, { type: "matched", volunteerName: "봉사자 A" });
    expect(connected).toMatchObject({ step: "connected", status: STATUS.connected("봉사자 A") });
  });

  it("매칭 실패는 요약으로 돌아가고 답을 유지한다", () => {
    const matching = requestFlowReducer(answerAll(initial), { type: "requestMatch" });
    const failed = requestFlowReducer(matching, { type: "matchFailed", status: STATUS.matchFailed });
    expect(failed).toMatchObject({
      step: "summary",
      status: STATUS.matchFailed,
      answers: { product: "소니 헤드셋", budget: "10만 원 이하", condition: "중고" },
    });
  });

  it("단계에 맞지 않는 동작은 무시한다", () => {
    expect(requestFlowReducer(initial, { type: "answer", text: "x", inputMode: "speech" })).toBe(initial);
    expect(requestFlowReducer(initial, { type: "requestMatch" })).toBe(initial);
    const summary = answerAll(initial);
    expect(requestFlowReducer(summary, { type: "start" })).toBe(summary);
    expect(requestFlowReducer(summary, { type: "matched", volunteerName: "A" })).toBe(summary);
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
