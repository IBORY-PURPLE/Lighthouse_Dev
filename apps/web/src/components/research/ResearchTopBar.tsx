import { forwardRef, type Ref } from "react";
import { PurchaseBadge } from "./PurchaseBadge";
import { ReleaseConfirm } from "./ReleaseConfirm";
import { BrandTitle } from "../BrandTitle";
import type { BadgeKind } from "@/lib/researchChatView";

/** 위 바: 서비스 로고(누르면 첫 화면)(요청 제목은 화면 읽기 프로그램에만) · 모은 정보 버튼(모든 폭) · 구매 배지 · "…" 더 보기(요청 내려놓기). */
export const ResearchTopBar = forwardRef<
  HTMLHeadingElement,
  {
    title: string;
    badge: { kind: BadgeKind; label: string };
    panelOpen: boolean;
    panelSummary: string;
    onTogglePanel: () => void;
    panelId: string;
    toggleRef?: Ref<HTMLButtonElement>;
    /** 새로 채워진 칸이 있는데 오른쪽 창이 닫혀 있다. */
    unseen: boolean;
    moreOpen: boolean;
    onToggleMore: () => void;
    moreId: string;
    moreToggleRef?: Ref<HTMLButtonElement>;
    onRelease: () => void;
    releasing: boolean;
  }
>(function ResearchTopBar(
  { title, badge, panelOpen, panelSummary, onTogglePanel, panelId, toggleRef, unseen, moreOpen, onToggleMore, moreId, moreToggleRef, onRelease, releasing },
  headingRef,
) {
  return (
    <header className="vc-topbar">
      <BrandTitle ref={headingRef} context={`리서치 챗 · ${title}`} />
      <span className="vh-spacer" />
      <button
        ref={toggleRef}
        type="button"
        className="vc-panel-toggle"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={onTogglePanel}
      >
        모은 정보 {panelSummary}
        {unseen && (
          <>
            <span className="vc-dot" aria-hidden="true" />
            <span className="vol-sr"> 새 정보 있음</span>
          </>
        )}
      </button>
      <PurchaseBadge kind={badge.kind} label={badge.label} />
      <div className="vc-more-wrap">
        <button
          ref={moreToggleRef}
          type="button"
          className="vc-more-toggle"
          aria-label="더 보기"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={onToggleMore}
        >
          <span aria-hidden="true">…</span>
        </button>
        <div id={moreId} className="vc-more" hidden={!moreOpen}>
          {moreOpen && <ReleaseConfirm onRelease={onRelease} releasing={releasing} />}
        </div>
      </div>
    </header>
  );
});
