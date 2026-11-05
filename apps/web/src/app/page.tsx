"use client";

import { useEffect, useReducer, useRef } from "react";
import { DemoHandoff } from "@/components/DemoHandoff";
import { SpeechInput } from "@/components/SpeechInput";
import { StatusRegion } from "@/components/StatusRegion";
import { requestMatch, saveMatch } from "@/lib/matchHandoff";
import {
  createInitialModel,
  PRIMARY_INPUT,
  speechInputReducer,
} from "@/lib/speech";

export default function HomePage() {
  const [model, dispatch] = useReducer(
    speechInputReducer,
    PRIMARY_INPUT,
    createInitialModel,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleSubmit = async (text: string) => {
    dispatch({ type: "submit", text });
    const outcome = await requestMatch(text);
    switch (outcome.kind) {
      case "matched":
        saveMatch(outcome.match);
        dispatch({
          type: "matched",
          volunteerName: outcome.match.volunteer.displayName,
        });
        break;
      case "rejected":
        dispatch({ type: "matchRejected", status: outcome.status });
        break;
      case "failed":
        dispatch({ type: "matchFailed", status: outcome.status });
        break;
    }
  };

  return (
    <main className="user-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        LightHouse 상품 요청
      </h1>
      <StatusRegion message={model.status} />
      {model.state === "matched" ? (
        <DemoHandoff />
      ) : (
        <SpeechInput model={model} dispatch={dispatch} onSubmit={handleSubmit} />
      )}
    </main>
  );
}
