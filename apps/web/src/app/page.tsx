"use client";

import { useEffect, useReducer, useRef } from "react";
import { DemoHandoff } from "@/components/DemoHandoff";
import { SpeechInput, type SpeechInputLabels } from "@/components/SpeechInput";
import { StatusRegion } from "@/components/StatusRegion";
import { requestMatch, saveMatch } from "@/lib/matchHandoff";
import {
  checkAnswer,
  createInitialFlow,
  QUESTIONS,
  requestFlowReducer,
} from "@/lib/requestFlow";
import {
  createInitialModel,
  PRIMARY_INPUT,
  speechInputReducer,
} from "@/lib/speech";

const MATCH_BUTTON = "봉사자 매칭 요청";

export default function HomePage() {
  const [flow, flowDispatch] = useReducer(
    requestFlowReducer,
    PRIMARY_INPUT,
    createInitialFlow,
  );
  const [model, dispatch] = useReducer(
    speechInputReducer,
    PRIMARY_INPUT,
    createInitialModel,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const matchRef = useRef<HTMLButtonElement>(null);

  const { step, question } = flow;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // 질문이 바뀌면 질문 제목에서 다시 읽기 시작한다. 첫 질문의 입력창 전환 초점은 입력 쪽이 이긴다.
  useEffect(() => {
    if (step === "asking") questionRef.current?.focus();
  }, [step, question]);

  const reachedSummary = step === "summary" || step === "matching";
  const reachedSummaryOnce = useRef(false);
  useEffect(() => {
    // 매칭 실패로 돌아올 때는 매칭 버튼에 초점이 남아 있게 둔다.
    if (reachedSummary && !reachedSummaryOnce.current) {
      reachedSummaryOnce.current = true;
      summaryRef.current?.focus();
    }
  }, [reachedSummary]);

  const handleStart = () => {
    dispatch({ type: "reset", mode: flow.inputMode });
    flowDispatch({ type: "start" });
  };

  const handleAnswer = (text: string) => {
    const problem = checkAnswer(question, text);
    if (problem) {
      dispatch({ type: "matchRejected", status: problem });
      return;
    }
    const nextMode = model.fellBack ? "text" : "speech";
    if (question < 2) dispatch({ type: "reset", mode: nextMode });
    flowDispatch({ type: "answer", text, inputMode: nextMode });
  };

  const handleMatch = async () => {
    if (step !== "summary") return;
    // Safari는 눌린 버튼에 초점을 주지 않는다. 실패 안내 뒤에도 이 버튼에서 다시 누를 수 있게 둔다.
    matchRef.current?.focus();
    flowDispatch({ type: "requestMatch" });
    const outcome = await requestMatch(flow.answers.product);
    switch (outcome.kind) {
      case "matched":
        saveMatch(outcome.match);
        flowDispatch({
          type: "matched",
          volunteerName: outcome.match.volunteer.displayName,
        });
        break;
      case "rejected":
      case "failed":
        flowDispatch({ type: "matchFailed", status: outcome.status });
        break;
    }
  };

  const current = QUESTIONS[question];
  const labels: SpeechInputLabels = {
    speak: "눌러서 말하기",
    confirm: question < 2 ? "다음 질문" : "완료",
    retry: question < 2 ? "다음 질문" : "완료",
    field: current.field,
    emptyStatus: current.emptyStatus,
    reenter: "다시 입력",
  };

  return (
    <main className="user-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        LightHouse 상품 요청
      </h1>
      <StatusRegion message={step === "asking" ? model.status : flow.status} />
      {step === "intro" && (
        <>
          <p className="flow-guide">
            질문 3개에 답하면 봉사자에게 요청을 보냅니다. 답하는 동안에는
            아무것도 보내지 않습니다.
          </p>
          <button type="button" className="big-button" onClick={handleStart}>
            시작하기
          </button>
        </>
      )}
      {step === "asking" && (
        <>
          <h2 ref={questionRef} tabIndex={-1} className="flow-question">
            {current.title}
          </h2>
          <SpeechInput
            key={question}
            model={model}
            dispatch={dispatch}
            onSubmit={handleAnswer}
            labels={labels}
            confirmTyped
          />
        </>
      )}
      {(step === "summary" || step === "matching") && (
        <>
          <h2 ref={summaryRef} tabIndex={-1} className="flow-question">
            요청 내용
          </h2>
          <ul className="flow-summary">
            <li>찾는 제품: {flow.answers.product}</li>
            <li>예산: {flow.answers.budget}</li>
            <li>새 제품 또는 중고: {flow.answers.condition}</li>
          </ul>
          <button
            ref={matchRef}
            type="button"
            className="big-button"
            aria-disabled={step === "matching" ? true : undefined}
            onClick={handleMatch}
          >
            {MATCH_BUTTON}
          </button>
        </>
      )}
      {step === "connected" && <DemoHandoff />}
    </main>
  );
}
