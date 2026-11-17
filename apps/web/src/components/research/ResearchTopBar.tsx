import Link from "next/link";
import { forwardRef, type Ref } from "react";
import { PurchaseBadge } from "./PurchaseBadge";
import { Icon } from "./Icon";
import { ReleaseConfirm } from "./ReleaseConfirm";
import type { BadgeKind } from "@/lib/researchChatView";

/** 위 바: 뒤로(첫 화면) · 리서치 챗 · 이용자 요청 한 줄 · 왼쪽 창 버튼 · 모은 정보 버튼(모든 폭) · 구매 배지 · "…" 더 보기(요청 내려놓기). */
export const ResearchTopBar = forwardRef<
  HTMLHeadingElement,
  {
    title: string;
    detail: string;
    badge: { kind: BadgeKind; label: string };
    panelOpen: boolean;
    panelSummary: string;
    onTogglePanel: () => void;
    panelId: string;
    toggleRef?: Ref<HTMLButtonElement>;
    sideOpen: boolean;
    onToggleSide: () => void;
    sideId: string;
    sideToggleRef?: Ref<HTMLButtonElement>;
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
  { title, detail, badge, panelOpen, panelSummary, onTogglePanel, panelId, toggleRef, sideOpen, onToggleSide, sideId, sideToggleRef, unseen, moreOpen, onToggleMore, moreId, moreToggleRef, onRelease, releasing },
  headingRef,
) {
  return (
    <header className="vc-topbar">
      <Link href="/volunteer" className="vc-back" aria-label="첫 화면으로">
        <Icon name="back" />
      </Link>
      <h1 ref={headingRef} tabIndex={-1} className="vc-topbar-title">
        리서치 챗
      </h1>
      <span className="vc-topbar-rule" aria-hidden="true" />
      <div className="vc-request">
        <p className="vc-request-title">{title}</p>
        <p className="vc-request-detail">{detail}</p>
      </div>
      <button
        ref={sideToggleRef}
        type="button"
        className="vc-mine-toggle"
        aria-expanded={sideOpen}
        aria-controls={sideId}
        onClick={onToggleSide}
      >
        대기열·내 담당
      </button>
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
