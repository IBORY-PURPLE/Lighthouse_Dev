"use client";

import { useEffect, useReducer, useRef } from "react";
import { DemoHandoff } from "@/components/DemoHandoff";
import { SpeechInput, type SpeechInputLabels } from "@/components/SpeechInput";
import { StatusRegion } from "@/components/StatusRegion";
import {
  checkAnswer,
  createInitialFlow,
  QUESTIONS,
  requestFlowReducer,
  type FlowStep,
} from "@/lib/requestFlow";
import {
  checkRequest,
  clearRequestRecord,
  readRequestRecord,
  registerRequest,
  saveRequestRecord,
} from "@/lib/requestRecord";
import {
  createInitialModel,
  PRIMARY_INPUT,
  speechInputReducer,
  STATUS,
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
  const queuedRef = useRef<HTMLHeadingElement>(null);
  const matchRef = useRef<HTMLButtonElement>(null);
  const previousStep = useRef<FlowStep | null>(null);

  const { step, question } = flow;

  // 앱을 열 때 지난 접수 기록이 있으면 서버에 상태를 묻는다(notes C2 checking).
  useEffect(() => {
    const record = readRequestRecord();
    if (!record) return;
    flowDispatch({ type: "check" });
    void checkRequest(record.requestId).then((outcome) => {
      const target = {
        requestId: record.requestId,
        product: record.product,
      };
      switch (outcome.kind) {
        case "waiting":
          flowDispatch({ type: "resumed", ...target, queueNumber: outcome.queueNumber });
          break;
        case "gone":
          clearRequestRecord();
          flowDispatch({ type: "resumeGone" });
          break;
        case "failed":
          flowDispatch({ type: "resumeFailed", ...target, queueNumber: record.queueNumber });
          break;
      }
    });
  }, []);

  // 화면이 바뀔 때 읽기 시작할 곳으로 초점을 옮긴다.
  useEffect(() => {
    const before = previousStep.current;
    previousStep.current = step;
    if (before === step) return;
    if (step === "intro" || step === "checking") headingRef.current?.focus();
    if (step === "queued") queuedRef.current?.focus();
    // 접수 실패로 돌아올 때는 매칭 버튼에 초점이 남아 있게 둔다.
    if (step === "summary" && before !== "registering") summaryRef.current?.focus();
  }, [step]);

  // 질문이 바뀌면 질문 제목에서 다시 읽기 시작한다. 첫 질문의 입력창 전환 초점은 입력 쪽이 이긴다.
  useEffect(() => {
    if (step === "asking") questionRef.current?.focus();
  }, [step, question]);

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
    // 실패 뒤 다시 누르면 같은 id로 보내 번호가 둘로 늘지 않게 한다.
    const clientRequestId = flow.clientRequestId ?? crypto.randomUUID();
    flowDispatch({ type: "register", clientRequestId });
    const outcome = await registerRequest(clientRequestId, flow.answers);
    switch (outcome.kind) {
      case "queued":
        saveRequestRecord({
          requestId: outcome.requestId,
          queueNumber: outcome.queueNumber,
          product: flow.answers.product,
        });
        flowDispatch({
          type: "registered",
          requestId: outcome.requestId,
          queueNumber: outcome.queueNumber,
        });
        break;
      case "needProduct":
        dispatch({ type: "reset", mode: flow.inputMode });
        dispatch({ type: "emptyText", status: STATUS.needProduct });
        flowDispatch({ type: "backToProduct" });
        break;
      case "failed":
        flowDispatch({ type: "registerFailed", status: outcome.status });
        break;
    }
  };

  const handleNewRequest = () => {
    // 기기 안 기록만 지운다. 서버의 접수는 그대로 둔다.
    clearRequestRecord();
    dispatch({ type: "reset", mode: flow.inputMode });
    flowDispatch({ type: "newRequest" });
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
      {(step === "summary" || step === "registering") && (
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
            aria-disabled={step === "registering" ? true : undefined}
            onClick={handleMatch}
          >
            {MATCH_BUTTON}
          </button>
        </>
      )}
      {step === "queued" && flow.queued && (
        <>
          <h2 ref={queuedRef} tabIndex={-1} className="flow-question">
            접수 완료
          </h2>
          <p className="queue-number">대기번호 {flow.queued.queueNumber}번</p>
          <p className="flow-guide">
            앱을 닫아도 됩니다. 다시 열면 대기번호를 알려 드립니다.
          </p>
          <DemoHandoff
            product={flow.answers.product}
            onFailed={(status) => flowDispatch({ type: "handoffFailed", status })}
          />
          <button
            type="button"
            className="big-button big-button--secondary"
            onClick={handleNewRequest}
          >
            새 요청하기
          </button>
        </>
      )}
    </main>
  );
}
