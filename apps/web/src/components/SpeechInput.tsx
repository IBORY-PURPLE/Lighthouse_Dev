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
  startRecognition,
  type SpeechInputAction,
  type SpeechInputModel,
} from "@/lib/speech";

const CONFIRM_LABEL = "이대로 요청";

interface SpeechInputProps {
  model: SpeechInputModel;
  dispatch: Dispatch<SpeechInputAction>;
  onSubmit(text: string): void;
}

export function SpeechInput({ model, dispatch, onSubmit }: SpeechInputProps) {
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const speechRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const { state, transcript } = model;
  const submitting = state === "submitting";
  const typing = state === "text" || (submitting && !transcript);
  const confirming = state === "confirming" || (submitting && !!transcript);
  const busy = state === "starting" || state === "listening";

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
    cancelRef.current = startRecognition(Ctor, {
      onListening: () => dispatch({ type: "listening" }),
      onResult: (text) => dispatch({ type: "result", transcript: text }),
      onMiss: () => dispatch({ type: "miss" }),
      onUnavailable: () => dispatch({ type: "unavailable" }),
    });
  };

  const handleTextSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const text = typed.trim();
    if (text) {
      onSubmit(text);
    } else {
      dispatch({ type: "emptyText" });
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
            {CONFIRM_LABEL}
          </button>
        </>
      )}
      {!typing && (
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
          {confirming ? "다시 말하기" : "눌러서 말하기"}
        </button>
      )}
      {typing && (
        <form className="text-form" onSubmit={handleTextSubmit} noValidate>
          <label htmlFor="request-text">찾는 상품</label>
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
            {CONFIRM_LABEL}
          </button>
        </form>
      )}
    </div>
  );
}
