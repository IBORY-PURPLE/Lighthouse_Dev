import Link from "next/link";
import { forwardRef } from "react";
import { PurchaseBadge } from "./PurchaseBadge";
import { Icon } from "./Icon";
import type { BadgeKind } from "@/lib/researchChatView";

/** 위 바: 뒤로 · 리서치 챗 · 이용자 요청 한 줄 · 구매 배지. 1180 미만에서는 모은 정보 패널 버튼이 붙는다. */
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
  }
>(function ResearchTopBar({ title, detail, badge, panelOpen, panelSummary, onTogglePanel, panelId }, headingRef) {
  return (
    <header className="vc-topbar">
      <Link href="/volunteer?tab=mine" className="vc-back" aria-label="내 담당 목록으로">
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
        type="button"
        className="vc-panel-toggle"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={onTogglePanel}
      >
        모은 정보 {panelSummary}
      </button>
      <PurchaseBadge kind={badge.kind} label={badge.label} />
    </header>
  );
});
