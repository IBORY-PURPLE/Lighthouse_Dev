"use client";

import { forwardRef } from "react";
import {
  isVerified,
  missingRequiredCards,
  proofMissingNotice,
  RESEARCH_COPY,
  RESEARCH_LIMITS,
  type CardId,
  type ResearchState,
} from "@/lib/research";

// 보내기 전 확인 단계(가운데 스크롤 영역). 후보 목록, 핵심 정리 글, 사진 장수, 구매 인증, 빠진 필수 질문.

const GUIDE_LABEL = RESEARCH_COPY.summary.guide;

export const ResearchSummary = forwardRef<
  HTMLHeadingElement,
  {
    state: ResearchState;
    summaryBusy: boolean;
    onChangeText: (value: string) => void;
    onGoToCard: (id: CardId) => void;
  }
>(function ResearchSummary({ state, summaryBusy, onChangeText, onGoToCard }, headingRef) {
  const missing = missingRequiredCards(state);
  const verified = isVerified(state);
  const proofCount = state.photos.filter((photo) => photo.kind === "proof").length;
  const detailCount = state.photos.length - proofCount;
  const notice = proofMissingNotice(state);
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className="rc-summary-title">
        {RESEARCH_COPY.summary.title}
      </h2>

      {missing.length > 0 && (
        <section className="rc-missing" aria-labelledby="rc-missing-title" data-testid="missing-cards">
          <h3 id="rc-missing-title" className="rc-box-title">
            {RESEARCH_COPY.summary.missingTitle}
          </h3>
          <ul className="rc-missing-list">
            {missing.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  className="vol-btn vol-btn--secondary vol-btn--small"
                  onClick={() => onGoToCard(card.id)}
                >
                  {card.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rc-box" aria-labelledby="rc-cands-title" data-testid="summary-candidates">
        <h3 id="rc-cands-title" className="rc-box-title">
          {RESEARCH_COPY.summary.candidates}
        </h3>
        <p className="vol-summary-label">추천 기종</p>
        <p className="rc-box-name">
          {state.model.trim() || "—"}
          {verified && <span className="vol-chip rc-inline-chip">구매 인증됨 · 봉사시간 가산</span>}
        </p>
        {state.alts.length > 0 && (
          <>
            <p className="vol-summary-label rc-sep">같이 고민한 제품</p>
            <ul className="rc-box-list">
              {state.alts.map((alt) => (
                <li key={alt}>{alt}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rc-box" aria-labelledby="rc-guide-title">
        <h3 id="rc-guide-title" className="rc-box-title">
          {GUIDE_LABEL}
        </h3>
        <label htmlFor="rc-guide" className="vol-sr">
          {GUIDE_LABEL}
        </label>
        <textarea
          id="rc-guide"
          className="vol-input vol-textarea rc-guide"
          value={state.summaryText}
          maxLength={RESEARCH_LIMITS.summaryEditMax}
          aria-describedby="rc-guide-note"
          aria-busy={summaryBusy}
          onChange={(event) => onChangeText(event.target.value)}
        />
        <p id="rc-guide-note" className="vol-foot rc-foot">
          {RESEARCH_COPY.summary.guideNote}
        </p>
      </section>

      <p className="rc-fact" data-testid="summary-photos">
        {RESEARCH_COPY.summary.photoCount(state.photos.length)}
        {state.photos.length > 0 && ` · ${RESEARCH_COPY.photo.proof} ${proofCount}, ${RESEARCH_COPY.photo.detail} ${detailCount}`}
      </p>
      <p className="rc-fact rc-fact--strong" data-testid="summary-purchase">
        {RESEARCH_COPY.summary.purchase(verified)}
      </p>
      {notice && (
        <p className="vol-notice" data-testid="proof-missing">
          {notice}
        </p>
      )}
    </>
  );
});
