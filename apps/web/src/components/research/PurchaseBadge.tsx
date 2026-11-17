import type { BadgeKind } from "@/lib/researchChatView";

/** 구매 인증 배지. 인증됨은 글자로도 구분된다("구매 인증됨"). */
export function PurchaseBadge({ kind, label }: { kind: BadgeKind; label: string }) {
  return (
    <span className={`vc-badge vc-badge--${kind}`} data-testid="purchase-badge">
      {label}
    </span>
  );
}

/** 히어로의 알림 알약("요청을 맡았어요 · 이용자: …"). */
export function StatusPill({ text }: { text: string }) {
  return (
    <p className="vc-pill">
      <span className="vc-pill-dot" aria-hidden="true" />
      {text}
    </p>
  );
}
