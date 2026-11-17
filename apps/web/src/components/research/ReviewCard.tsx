"use client";

import { forwardRef } from "react";
import type { ReviewState } from "@/lib/researchClient";

/**
 * 이용자에게 보낼 리뷰 문단. draft면 "AI 초안"과 [검수하기], confirmed면 "봉사자 검수 완료"와 [보내기].
 * 검수를 마치기 전에는 [보내기]가 없다. 칸이 바뀌면 서버가 draft로 되돌린다.
 */
export const ReviewCard = forwardRef<
  HTMLButtonElement,
  {
    review: ReviewState;
    sending: boolean;
    onEdit: () => void;
    onSend: () => void;
  }
>(function ReviewCard({ review, sending, onEdit, onSend }, sendRef) {
  const confirmed = review.status === "confirmed";
  return (
    <section className="vc-card vc-card--review" aria-label="이용자에게 보낼 리뷰" data-state={confirmed ? "confirmed" : "draft"}>
      <div className="vc-review-tags">
        {confirmed ? (
          <>
            <span className="vc-tag vc-tag--ink">봉사자 검수 완료</span>
            <span className="vc-tag">VoiceOver로 읽혀요</span>
          </>
        ) : (
          <>
            <span className="vc-tag">AI 초안</span>
            <span className="vc-tag vc-tag--check">검수 전</span>
          </>
        )}
      </div>
      <p className="vc-review-body">{review.text}</p>
      <p className="vc-review-hint">
        {confirmed
          ? "보내면 이용자에게 이 문단이 전해져요."
          : "AI가 만든 초안이에요. 검수하기를 눌러 직접 읽고 고친 뒤 검수를 마쳐야 보낼 수 있어요."}
      </p>
      <div className="vc-review-actions">
        <button type="button" className="vc-btn" onClick={onEdit}>
          {confirmed ? "다시 편집하기" : "검수하기"}
        </button>
        {confirmed && (
          <button
            ref={sendRef}
            type="button"
            className="vc-btn vc-btn--ink"
            aria-disabled={sending ? true : undefined}
            onClick={() => {
              if (!sending) onSend();
            }}
          >
            보내기
          </button>
        )}
      </div>
    </section>
  );
});
