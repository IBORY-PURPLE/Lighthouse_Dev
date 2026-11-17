import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** AI 말풍선 위 꼬리표(칸 질문일 때만 "질문 n · 칸 이름"). */
export function AiTag({ chip, note }: { chip: string; note: string }) {
  return (
    <div className="vc-aitag">
      <span className="vc-aitag-chip">{chip}</span>
      {note && <span className="vc-aitag-note">{note}</span>}
    </div>
  );
}

/** 말풍선 한 줄. AI는 왼쪽(옅은 회색 + 반짝 아이콘), 봉사자는 오른쪽(먹색). */
export function MessageBubble({
  role,
  tag,
  text,
  pending,
  id,
  tabIndex,
  children,
}: {
  role: "ai" | "volunteer" | "system";
  tag?: { chip: string; note: string } | null;
  text?: string;
  pending?: boolean;
  /** 칸 누르기가 찾아가는 질문 말풍선의 id(vc-q-<seq>)와 초점 받기(-1). */
  id?: string;
  tabIndex?: number;
  children?: ReactNode;
}) {
  if (role === "volunteer") {
    return (
      <div id={id} tabIndex={tabIndex} className="vc-row vc-row--me vc-enter">
        {text ? (
          <p className={`vc-bubble vc-bubble--me${pending ? " vc-bubble--pending" : ""}`}>{text}</p>
        ) : null}
        {children}
      </div>
    );
  }
  return (
    <div id={id} tabIndex={tabIndex} className="vc-row vc-row--ai vc-enter">
      {tag && <AiTag chip={tag.chip} note={tag.note} />}
      {text ? (
        <p className={`vc-bubble vc-bubble--ai${role === "system" ? " vc-bubble--notice" : ""}`}>
          {role === "ai" && <Icon name="sparkle" />}
          <span>{text}</span>
        </p>
      ) : null}
      {children}
    </div>
  );
}
