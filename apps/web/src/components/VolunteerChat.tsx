"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import { SpeechInput, type SpeechInputLabels } from "@/components/SpeechInput";
import { requestAnswer } from "@/lib/chat";
import type { MatchResponse } from "@/lib/matchHandoff";
import {
  STATUS,
  type SpeechInputAction,
  type SpeechInputModel,
} from "@/lib/speech";

const QUESTION_LABELS: SpeechInputLabels = {
  speak: "눌러서 질문하기",
  confirm: "이대로 질문",
  retry: "다시 시도",
  field: "질문",
  emptyStatus: STATUS.emptyQuestion,
};

interface VolunteerChatProps {
  match: MatchResponse;
  model: SpeechInputModel;
  dispatch: Dispatch<SpeechInputAction>;
}

export function VolunteerChat({ match, model, dispatch }: VolunteerChatProps) {
  const [answer, setAnswer] = useState("");
  const [arrivals, setArrivals] = useState(0);
  const answerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 입력 쪽 초점 효과가 먼저 돌므로(자식 먼저) 답변 영역 초점이 이긴다.
  useEffect(() => {
    if (arrivals > 0) answerRef.current?.focus();
  }, [arrivals]);

  const handleSubmit = async (question: string) => {
    dispatch({ type: "submit", text: question, status: STATUS.chatWaiting });
    setAnswer("");

    const abort = new AbortController();
    abortRef.current = abort;
    const { brand, item } = match.request;
    const outcome = await requestAnswer(
      { requestId: match.requestId, question, context: { brand, item } },
      (text) => setAnswer((current) => current + text),
      abort,
    );

    switch (outcome.kind) {
      case "answered":
        dispatch({ type: "answered", status: STATUS.chatArrived });
        setArrivals((count) => count + 1);
        break;
      case "rejected":
        setAnswer("");
        dispatch({ type: "matchRejected", status: outcome.status });
        break;
      case "failed":
        setAnswer("");
        dispatch({ type: "matchFailed", status: outcome.status });
        break;
    }
  };

  return (
    <section className="volunteer-chat" aria-labelledby="chat-heading">
      <h2 id="chat-heading">찾는 방법 물어보기</h2>
      <SpeechInput
        model={model}
        dispatch={dispatch}
        onSubmit={handleSubmit}
        labels={QUESTION_LABELS}
      />
      {answer && (
        // 낭독 영역이 아니다. 글자가 올 때마다 읽지 않게 하고, 끝나면 초점으로 읽게 한다.
        <div ref={answerRef} className="chat-answer" tabIndex={-1}>
          {answer}
        </div>
      )}
    </section>
  );
}
