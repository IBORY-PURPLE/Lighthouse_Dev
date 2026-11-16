import type { QuickReply } from "@/lib/researchChatView";

/** 입력창 곁의 빠른 답(높이 48). 보통은 테두리, 강조는 먹색 채움. */
export function QuickReplies({
  replies,
  disabled,
  onPick,
  label,
}: {
  replies: QuickReply[];
  disabled?: boolean;
  onPick: (reply: QuickReply) => void;
  label: string;
}) {
  if (replies.length === 0) return null;
  return (
    <div className="vc-quick" role="group" aria-label={label}>
      {replies.map((reply) => (
        <button
          key={reply.id}
          type="button"
          className={`vc-quick-btn${reply.tone === "primary" ? " vc-quick-btn--primary" : ""}`}
          aria-disabled={disabled ? true : undefined}
          onClick={() => {
            if (!disabled) onPick(reply);
          }}
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
}
