"use client";

import { useEffect, useState } from "react";
import { THINKING_COPY, thinkingPhase, type ThinkingKind } from "@/lib/researchChatView";

/**
 * AI가 찾는 중일 때의 표시(모션 명세 190:838). 점은 장식이라 숨기고, 문구는 단계가 바뀔 때만 낭독한다.
 * 첫 문구는 aria-busy, 4초·10초 문구는 role="status". 점의 움직임은 CSS가 맡고 reduced-motion에서 멈춘다.
 */
export function Thinking({ kind, startedAt }: { kind: ThinkingKind; startedAt: number }) {
  const [phase, setPhase] = useState<0 | 1 | 2>(() => thinkingPhase(Date.now() - startedAt));

  useEffect(() => {
    const timer = window.setInterval(() => setPhase(thinkingPhase(Date.now() - startedAt)), 500);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const phrase = THINKING_COPY[kind][phase];
  return (
    <div className="vc-row vc-row--ai">
      <div className="vc-bubble vc-bubble--ai vc-thinking" data-testid="thinking" data-phase={phase}>
        <span className="vc-dots" aria-hidden="true">
          <i className="lh-thinking-dot" />
          <i className="lh-thinking-dot" />
          <i className="lh-thinking-dot" />
        </span>
        {phase === 0 ? (
          <p className="vc-thinking-text" aria-busy="true">
            {phrase}
          </p>
        ) : (
          <p className="vc-thinking-text" aria-hidden="true" key={phase}>
            {phrase}
          </p>
        )}
        <span role="status" className="vol-sr">
          {phase === 0 ? "" : phrase}
        </span>
      </div>
    </div>
  );
}
