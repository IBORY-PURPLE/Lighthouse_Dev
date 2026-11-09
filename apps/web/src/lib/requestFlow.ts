// 이용자 화면 플로우 A(PR 1): 질문 3개 → 요약 → 매칭. 순수 함수만 둔다.
// 답하는 동안에는 아무것도 보내지 않는다. 답은 이 상태(메모리)에만 있다.

import { parseRequest } from "@/lib/parseRequest";
import { STATUS, type InputMode } from "@/lib/speech";

export type QuestionIndex = 0 | 1 | 2;

export interface RequestAnswers {
  product: string;
  budget: string;
  condition: string;
}

export interface Question {
  key: keyof RequestAnswers;
  title: string;
  /** 입력창 이름. */
  field: string;
  emptyStatus: string;
}

export const QUESTIONS: readonly [Question, Question, Question] = [
  {
    key: "product",
    title: "질문 1/3. 어떤 제품을 찾으세요?",
    field: "찾는 제품",
    emptyStatus: "입력창에 찾는 제품을 입력하세요.",
  },
  {
    key: "budget",
    title: "질문 2/3. 예산은 얼마인가요?",
    field: "예산",
    emptyStatus: "입력창에 예산을 입력하세요.",
  },
  {
    key: "condition",
    title: "질문 3/3. 새 제품과 중고 중 무엇을 원하세요?",
    field: "새 제품 또는 중고",
    emptyStatus: "입력창에 새 제품 또는 중고를 입력하세요.",
  },
];

/** /api/match와 같은 상한. */
export const MAX_ANSWER_LENGTH = 200;

export type FlowStep = "intro" | "asking" | "summary" | "matching" | "connected";

export interface RequestFlowModel {
  step: FlowStep;
  question: QuestionIndex;
  answers: RequestAnswers;
  /** 다음 질문을 시작할 방식. 앞 질문이 입력창으로 끝났으면 입력창으로 시작한다. */
  inputMode: InputMode;
  /** asking이 아닐 때 상태 영역에 읽을 문구. asking일 때는 음성 입력 쪽 문구를 쓴다. */
  status: string;
}

export type RequestFlowAction =
  | { type: "start" }
  | { type: "answer"; text: string; inputMode: InputMode }
  | { type: "requestMatch" }
  | { type: "matched"; volunteerName: string }
  | { type: "matchFailed"; status: string };

export function createInitialFlow(inputMode: InputMode): RequestFlowModel {
  return {
    step: "intro",
    question: 0,
    answers: { product: "", budget: "", condition: "" },
    inputMode,
    status: "",
  };
}

/** 답을 받을 수 있으면 null, 아니면 상태 영역 문구. 기기 안에서만 본다. */
export function checkAnswer(question: QuestionIndex, text: string): string | null {
  if (text.length > MAX_ANSWER_LENGTH) return STATUS.answerTooLong;
  if (question === 0 && !parseRequest(text).item) return STATUS.needProduct;
  return null;
}

export function summaryStatus({ product, budget, condition }: RequestAnswers) {
  return STATUS.summary(product, budget, condition);
}

export function requestFlowReducer(
  model: RequestFlowModel,
  action: RequestFlowAction,
): RequestFlowModel {
  switch (action.type) {
    case "start":
      if (model.step !== "intro") return model;
      return { ...model, step: "asking", question: 0, status: "" };
    case "answer": {
      if (model.step !== "asking") return model;
      const key = QUESTIONS[model.question].key;
      const answers = { ...model.answers, [key]: action.text };
      if (model.question < 2) {
        return {
          ...model,
          answers,
          question: (model.question + 1) as QuestionIndex,
          inputMode: action.inputMode,
          status: "",
        };
      }
      return {
        ...model,
        answers,
        step: "summary",
        inputMode: action.inputMode,
        status: summaryStatus(answers),
      };
    }
    case "requestMatch":
      if (model.step !== "summary") return model;
      return { ...model, step: "matching", status: STATUS.matching };
    case "matched":
      if (model.step !== "matching") return model;
      return {
        ...model,
        step: "connected",
        status: STATUS.connected(action.volunteerName),
      };
    case "matchFailed":
      if (model.step !== "matching") return model;
      return { ...model, step: "summary", status: action.status };
  }
}
