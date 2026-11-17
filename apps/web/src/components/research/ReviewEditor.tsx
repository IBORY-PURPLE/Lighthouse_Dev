"use client";

import { useEffect, useRef, useState } from "react";
import { REVIEW_MAX, REVIEW_MIN } from "@/lib/researchChatView";

/**
 * 리뷰 문단 편집. 글자 수, 막힌 이유(role="alert"), [편집 취소] [검수 마치기].
 * 편집 칸에서는 Enter가 줄바꿈이다. 서버가 막으면(422) 이유를 보이고 입력은 그대로 둔다.
 */
export function ReviewEditor({
  initial,
  busy,
  reasons,
  onCancel,
  onFinish,
}: {
  initial: string;
  busy: boolean;
  reasons: string[];
  onCancel: () => void;
  onFinish: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  const length = text.trim().length;
  const short = length < REVIEW_MIN;
  const long = length > REVIEW_MAX;

  return (
    <section className="vc-card vc-card--review is-editing" aria-label="리뷰 문단 편집">
      <div className="vc-review-head">
        <h3 className="vc-review-title">리뷰 문단 편집 중</h3>
        <span className="vc-review-count" data-testid="review-count">
          글자 수 {length}자
        </span>
      </div>
      <label htmlFor="vc-review-text" className="vol-sr">
        이용자에게 보낼 리뷰 문단
      </label>
      <textarea
        ref={areaRef}
        id="vc-review-text"
        className="vc-review-text"
        value={text}
        rows={7}
        onChange={(event) => setText(event.target.value)}
        aria-describedby="vc-review-hint"
      />
      <p id="vc-review-hint" className="vc-review-hint">
        {short
          ? `${REVIEW_MIN}자 이상 적어 주세요.`
          : long
            ? `${REVIEW_MAX}자 이하로 줄여 주세요.`
            : "가격 숫자와 품질 정보는 넣지 않아요. 봉사자님이 직접 겪은 일만 써 주세요."}
      </p>
      {reasons.length > 0 && (
        <div role="alert" className="vc-alert">
          <p className="vc-alert-title">이 문단은 아직 검수를 마칠 수 없어요.</p>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="vc-review-actions">
        <button type="button" className="vc-btn" onClick={onCancel}>
          편집 취소
        </button>
        <button
          type="button"
          className="vc-btn vc-btn--ink"
          aria-disabled={busy || short || long ? true : undefined}
          onClick={() => {
            if (!busy && !short && !long) onFinish(text.trim());
          }}
        >
          검수 마치기
        </button>
      </div>
    </section>
  );
}
