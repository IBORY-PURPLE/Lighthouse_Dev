"use client";

import { useEffect, useReducer, useRef } from "react";
import { SpeechInput } from "@/components/SpeechInput";
import { StatusRegion } from "@/components/StatusRegion";
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
    document.title = "상품 요청 - LightHouse";
    headingRef.current?.focus();
  }, []);

  // 3블록: 여기서 /api/match를 호출하고 매칭 결과를 안내한다.
  const handleSubmit = (text: string) => dispatch({ type: "submit", text });

  return (
    <main className="user-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        LightHouse 상품 요청
      </h1>
      <StatusRegion message={model.status} />
      <SpeechInput model={model} dispatch={dispatch} onSubmit={handleSubmit} />
    </main>
  );
}
