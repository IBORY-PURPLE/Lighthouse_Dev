"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import {
  getSpeechRecognitionCtor,
  hasSpeechStartedBefore,
  rememberSpeechStarted,
  SPEECH_FIRST_START_TIMEOUT_MS,
  SPEECH_START_DELAY_MS,
  SPEECH_START_TIMEOUT_MS,
  startRecognition,
  STATUS,
  type SpeechInputAction,
  type SpeechInputModel,
} from "@/lib/speech";

export interface SpeechInputLabels {
  speak: string;
  confirm: string;
  /** 같은 문장을 다시 보내는 상태(refocus "resend")의 확인 버튼 이름. */
  retry: string;
  field: string;
  emptyStatus: string;
  /** 입력창 답 확인 단계의 "다시 입력" 버튼 이름(confirmTyped일 때). */
  reenter?: string;
}

const REQUEST_LABELS: SpeechInputLabels = {
  speak: "눌러서 말하기",
  confirm: "이대로 요청",
  retry: "이대로 요청",
  field: "찾는 상품",
  emptyStatus: STATUS.emptyText,
};

interface SpeechInputProps {
  model: SpeechInputModel;
  dispatch: Dispatch<SpeechInputAction>;
  onSubmit(text: string): void;
  labels?: SpeechInputLabels;
  /** 켜면 입력창 답도 바로 보내지 않고 확인 단계를 거친다(이용자 질문 흐름). */
  confirmTyped?: boolean;
}

export function SpeechInput({
  model,
  dispatch,
  onSubmit,
  labels = REQUEST_LABELS,
  confirmTyped = false,
}: SpeechInputProps) {
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const speechRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const reenterRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const { state, transcript } = model;
  const submitting = state === "submitting";
  const typing = state === "text" || (submitting && !transcript);
  const confirming = state === "confirming" || (submitting && !!transcript);
  const busy = state === "starting" || state === "listening";
  // 입력창 답을 확인하는 중이면 "다시 말하기" 대신 "다시 입력"을 보인다.
  const typedConfirm = confirmTyped && confirming && model.fellBack;
  const confirmLabel =
    model.refocus === "resend" ? labels.retry : labels.confirm;

  useEffect(() => {
    if (!getSpeechRecognitionCtor(window)) dispatch({ type: "unavailable" });
    return () => cancelRef.current?.();
  }, [dispatch]);

  const reachedConfirm = state === "confirming";
  useEffect(() => {
    if (reachedConfirm) confirmRef.current?.focus();
  }, [reachedConfirm]);

  const reachedFallback = state === "text" && model.fellBack;
  useEffect(() => {
    if (reachedFallback) inputRef.current?.focus();
  }, [reachedFallback]);

  // 위 효과들 뒤에 둬서, 매칭이 안 돌아왔을 때는 이 초점이 이긴다.
  const { refocus } = model;
  useEffect(() => {
    if (refocus === "reenter") {
      (typing ? inputRef : speechRef).current?.focus();
    } else if (refocus === "resend") {
      (typing ? submitRef : confirmRef).current?.focus();
    }
  }, [refocus, typing]);

  const handlePress = () => {
    if (busy || submitting) return;
    const Ctor = getSpeechRecognitionCtor(window);
    if (!Ctor) {
      dispatch({ type: "unavailable" });
      return;
    }
    // Safari는 눌린 버튼에 초점을 주지 않아, "이대로 요청"이 사라지면 초점이 body로 빠진다.
    speechRef.current?.focus();
    dispatch({ type: "press" });
    // 처음 쓰는 기기는 마이크·음성 인식 허용 창이 떠 있는 동안 start 이벤트가 오지 않는다.
    // 허용을 누를 때까지 입력창으로 바꾸지 않고 기다린다. 거부하면 not-allowed로 바로 바뀐다.
    const startTimeoutMs = hasSpeechStartedBefore(window.localStorage)
      ? SPEECH_START_TIMEOUT_MS
      : SPEECH_FIRST_START_TIMEOUT_MS;
    cancelRef.current = startRecognition(
      Ctor,
      {
        onListening: () => {
          rememberSpeechStarted(window.localStorage);
          dispatch({ type: "listening" });
        },
        onResult: (text) => dispatch({ type: "result", transcript: text }),
        onMiss: () => dispatch({ type: "miss" }),
        onUnavailable: () => dispatch({ type: "unavailable" }),
      },
      SPEECH_START_DELAY_MS,
      startTimeoutMs,
    );
  };

  const handleTextSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const text = typed.trim();
    if (text && confirmTyped) {
      dispatch({ type: "typed", text });
    } else if (text) {
      onSubmit(text);
    } else {
      dispatch({ type: "emptyText", status: labels.emptyStatus });
      inputRef.current?.focus();
    }
  };

  return (
    <div className="speech-input">
      {confirming && (
        <>
          <p className="speech-transcript">{transcript}</p>
          <button
            ref={confirmRef}
            type="button"
            className="big-button"
            aria-disabled={submitting ? true : undefined}
            onClick={() => {
              if (submitting) return;
              confirmRef.current?.focus();
              onSubmit(transcript);
            }}
          >
            {confirmLabel}
          </button>
        </>
      )}
      {typedConfirm && (
        <button
          ref={reenterRef}
          type="button"
          className="big-button big-button--secondary"
          onClick={() => dispatch({ type: "reenter" })}
        >
          {labels.reenter ?? "다시 입력"}
        </button>
      )}
      {!typing && !typedConfirm && (
        // 초점이 있는 버튼의 이름이나 상태가 바뀌면 VoiceOver가 다시 읽어 마이크에 섞일 수 있다.
        // 그래서 듣는 동안 이름을 바꾸지 않고 비활성으로 표시하지도 않으며, 누름만 무시한다.
        // 같은 요소를 "다시 말하기"로도 써서 누른 뒤에도 초점이 유지된다.
        <button
          ref={speechRef}
          type="button"
          className={
            confirming ? "big-button big-button--secondary" : "big-button"
          }
          aria-disabled={submitting ? true : undefined}
          data-input-state={state}
          onClick={handlePress}
        >
          {confirming ? "다시 말하기" : labels.speak}
        </button>
      )}
      {typing && (
        <form className="text-form" onSubmit={handleTextSubmit} noValidate>
          <label htmlFor="request-text">{labels.field}</label>
          <input
            ref={inputRef}
            id="request-text"
            type="text"
            lang="ko"
            autoComplete="off"
            value={typed}
            readOnly={submitting}
            onChange={(event) => setTyped(event.target.value)}
          />
          <button
            ref={submitRef}
            type="submit"
            className="big-button"
            aria-disabled={submitting ? true : undefined}
          >
            {confirmLabel}
          </button>
        </form>
      )}
    </div>
  );
}
