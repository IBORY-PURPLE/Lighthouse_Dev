"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { SpeechInput, type SpeechInputLabels } from "@/components/SpeechInput";
import { StatusRegion } from "@/components/StatusRegion";
import { aiChatReducer, createInitialChat } from "@/lib/aiChat";
import {
  AI_STATUS,
  MAX_USER_LENGTH,
  requestConverse,
  type ChatTurn,
} from "@/lib/converse";
import type { RequestAnswers } from "@/lib/requestFlow";
import {
  createInitialModel,
  getSpeechRecognitionCtor,
  PRIMARY_INPUT,
  speechInputReducer,
  STATUS,
  type InputMode,
  type SpeechInputModel,
} from "@/lib/speech";
import {
  canSpeak,
  cancelSpeech,
  readTtsPreference,
  saveTtsPreference,
  speakText,
} from "@/lib/tts";

// 이용자 AI 대화(PR 3). apps/user-voice-ui의 음성 대화 경험을 apps/web 부품으로 옮겼다.
// 한 턴마다 대화 기록 전체를 서버로 보내고 AI의 다음 문장을 받는다. 서버는 저장하지 않는다.

const LABELS: SpeechInputLabels = {
  speak: "눌러서 말하기",
  confirm: "보내기",
  retry: "다시 보내기",
  field: "답변",
  emptyStatus: AI_STATUS.aiEmptyAnswer,
  reenter: "다시 입력",
};

const CONSENT_YES = "네, 등록해 주세요";
const CONSENT_NO = "아니요, 고치고 싶어요";

/** 음성 인식을 못 쓰는 기기는 처음부터 입력창으로 시작한다. */
function createSpeechModel(): SpeechInputModel {
  const initial = createInitialModel(PRIMARY_INPUT);
  return getSpeechRecognitionCtor(window)
    ? initial
    : speechInputReducer(initial, { type: "reset", mode: "text" });
}

interface AiConversationProps {
  /** 이용자가 등록에 동의했다. 정리된 요청을 접수로 넘긴다. */
  onDone(answers: RequestAnswers): void;
  /** 고정 질문 3개로 바꾼다. */
  onUseBasic(): void;
}

export function AiConversation({ onDone, onUseBasic }: AiConversationProps) {
  const [chat, chatDispatch] = useReducer(aiChatReducer, undefined, createInitialChat);
  const [model, dispatch] = useReducer(speechInputReducer, undefined, createSpeechModel);
  const [ttsOn, setTtsOn] = useState(readTtsPreference);
  const [speaking, setSpeaking] = useState(false);
  const replyRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const basicRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextMode = useRef<InputMode>(PRIMARY_INPUT);
  const latest = useRef({ onDone });

  useEffect(() => {
    latest.current = { onDone };
    nextMode.current = model.fellBack ? "text" : "speech";
  });

  const runTurn = async (messages: ChatTurn[]) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const outcome = await requestConverse(messages, abort.signal);
    // 그만두었거나 다른 호출로 바뀌었으면 이 응답은 버린다.
    if (abort.signal.aborted) return;
    if (outcome.kind !== "ok") {
      chatDispatch({
        type: "failed",
        status: outcome.status,
        canRetry: outcome.kind === "failed",
      });
      return;
    }
    const { reply, status, request } = outcome.result;
    if (status === "done" && request) {
      latest.current.onDone(request);
      return;
    }
    chatDispatch({ type: "replied", reply, status });
    dispatch({ type: "reset", mode: nextMode.current });
  };

  // 열자마자 AI의 첫 질문을 받는다. 닫으면 기다리던 호출을 버린다.
  useEffect(() => {
    void runTurn([]);
    return () => {
      abortRef.current?.abort();
      cancelSpeech();
    };
    // 처음 한 번만. runTurn이 쓰는 값은 모두 ref나 dispatch다.
  }, []);

  // 새 AI 문장이 오면 그 문장에서 읽기 시작하고, 읽어 주기가 켜져 있으면 소리로도 읽는다.
  const { turn, reply } = chat;
  useEffect(() => {
    if (turn === 0) return;
    replyRef.current?.focus();
    if (ttsOn) speakText(reply, setSpeaking);
    // 읽어 주기를 켜고 끄는 것은 이미 온 문장을 다시 읽지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);

  // 말하기를 시작하면 읽던 소리를 멈춘다(AI 소리가 인식에 섞이지 않게).
  const micOpen = model.state === "starting" || model.state === "listening";
  useEffect(() => {
    if (!micOpen) return;
    cancelSpeech();
  }, [micOpen]);

  const failed = chat.phase === "failed";
  useEffect(() => {
    if (!failed) return;
    (retryRef.current ?? basicRef.current)?.focus();
  }, [failed]);

  const handleSubmit = (text: string) => {
    if (chat.phase !== "ready") return;
    if (text.length > MAX_USER_LENGTH) {
      dispatch({ type: "matchRejected", status: STATUS.answerTooLong });
      return;
    }
    cancelSpeech();
    chatDispatch({ type: "send", text });
    void runTurn([...chat.history, { role: "user", content: text }]);
  };

  const handleRetry = () => {
    chatDispatch({ type: "retry" });
    void runTurn(chat.sent);
  };

  const handleBasic = () => {
    abortRef.current?.abort();
    cancelSpeech();
    onUseBasic();
  };

  const toggleTts = () => {
    const next = !ttsOn;
    setTtsOn(next);
    saveTtsPreference(next);
    if (!next) {
      cancelSpeech();
      setSpeaking(false);
    }
  };

  const orb = speaking
    ? "speaking"
    : model.state === "listening"
      ? "listening"
      : chat.phase === "thinking"
        ? "thinking"
        : "idle";
  const lastSaid = chat.sent.at(-1);
  const showSaid = chat.phase !== "ready" && lastSaid?.role === "user";
  const statusMessage = chat.phase === "ready" ? model.status : chat.status;

  return (
    <>
      <StatusRegion message={statusMessage} />
      {/* 장식이다. 화면 낭독기에는 숨긴다. */}
      <div className={`ai-orb ai-orb--${orb}`} aria-hidden="true" />
      {chat.reply && (
        <h2 key={chat.turn} ref={replyRef} tabIndex={-1} className="flow-question">
          {chat.reply}
        </h2>
      )}
      {showSaid && <p className="flow-guide">내 답변: {lastSaid.content}</p>}
      {chat.phase === "ready" && (
        <>
          {chat.replyStatus === "confirming" && (
            <div className="ai-consent">
              <button
                type="button"
                className="big-button"
                onClick={() => handleSubmit(CONSENT_YES)}
              >
                {CONSENT_YES}
              </button>
              <button
                type="button"
                className="big-button big-button--secondary"
                onClick={() => handleSubmit(CONSENT_NO)}
              >
                {CONSENT_NO}
              </button>
            </div>
          )}
          <SpeechInput
            key={chat.turn}
            model={model}
            dispatch={dispatch}
            onSubmit={handleSubmit}
            labels={LABELS}
            confirmTyped
          />
          {model.state === "idle" && (
            <button
              type="button"
              className="big-button big-button--secondary"
              onClick={() => dispatch({ type: "reset", mode: "text" })}
            >
              글자로 입력하기
            </button>
          )}
        </>
      )}
      {failed && chat.canRetry && (
        <button ref={retryRef} type="button" className="big-button" onClick={handleRetry}>
          다시 시도
        </button>
      )}
      <div className="ai-tools">
        {canSpeak() && (
          <>
            <button
              type="button"
              className="small-button"
              aria-pressed={ttsOn}
              onClick={toggleTts}
            >
              읽어 주기
            </button>
            {chat.reply && (
              <button
                type="button"
                className="small-button"
                onClick={() => speakText(chat.reply, setSpeaking)}
              >
                다시 듣기
              </button>
            )}
          </>
        )}
        <button
          ref={basicRef}
          type="button"
          className="small-button"
          onClick={handleBasic}
        >
          기본 질문으로 하기
        </button>
      </div>
    </>
  );
}
