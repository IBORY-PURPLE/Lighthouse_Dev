"use client";

import {
  SLOT_LABEL,
  isFilled,
  panelSlots,
  questionNumber,
  requiredProgress,
  requiredSlots,
  slotTag,
} from "@/lib/researchChatView";
import type { Purchase, SlotKey, SlotMap } from "@/lib/researchClient";
import { ReleaseConfirm } from "./ReleaseConfirm";

function noteOf(purchase: Purchase, slots: SlotMap, reviewReady: boolean): string {
  if (purchase === "unset") return "먼저 구매 여부를 알려 주세요.";
  const { filled, total } = requiredProgress({ purchase, slots });
  if (reviewReady) return "고친 문단을 확인하고 보내면 끝나요.";
  if (filled === total) return `필수 칸 ${total}개를 모두 채웠어요. 선택 칸도 이어서 물어요.`;
  return `필수 칸 ${total}개를 대화로 하나씩 채워 가요.`;
}

/**
 * 오른쪽 "모은 정보" 패널. 필수 n/m, 칸 상태 줄(점선+"AI 제안", 실선+"봉사자 확정"), 빠진 필수 칸 안내.
 * 위 바의 버튼으로 접고 편다. 칸마다 그 질문으로 가는 버튼이 있다. 요청 내려놓기는 이 패널 맨 아래에 둔다.
 */
export function SlotPanel({
  id,
  purchase,
  slots,
  photoCount,
  currentSlot,
  open,
  reviewReady,
  onRelease,
  releasing,
  onJump,
}: {
  id: string;
  purchase: Purchase;
  slots: SlotMap;
  photoCount: number;
  currentSlot: SlotKey | null;
  open: boolean;
  reviewReady: boolean;
  onRelease: () => void;
  releasing: boolean;
  /** 칸 버튼: 그 칸의 마지막 질문 말풍선으로 간다(스크롤과 초점만, 서버 호출 없음). */
  onJump: (slot: SlotKey) => void;
}) {
  const { filled, total } = requiredProgress({ purchase, slots });
  const required = requiredSlots(purchase);
  const rows = panelSlots(purchase);

  return (
    <aside id={id} className={`vc-panel${open ? " is-open" : ""}`} aria-label="모은 정보" inert={!open}>
      <div className="vc-panel-head">
        <h2 className="vc-panel-title">모은 정보</h2>
        <span className="vc-count" data-testid="required-count">
          필수 {filled}/{total}
        </span>
      </div>
      <div className="vc-bars" aria-hidden="true">
        {required.map((key) => (
          <span key={key} className={`vc-bar${isFilled(slots, key) ? " is-on" : ""}`} />
        ))}
      </div>
      <ul className="vc-slots">
        {rows.map((key) => {
          const slot = slots[key];
          const tag = slotTag(slot);
          const isCurrent = currentSlot === key && !slot;
          const value =
            key === "photo"
              ? photoCount > 0
                ? `착샷 ${photoCount}장`
                : (slot?.value ?? "")
              : slot?.status === "skipped"
                ? ""
                : (slot?.value ?? "");
          return (
            <li
              key={key}
              className={`vc-slot vc-slot--${isCurrent ? "now" : tag.tone}`}
              data-slot={key}
              data-state={slot ? (slot.status === "skipped" ? "skipped" : "filled") : "empty"}
            >
              <div className="vc-slot-head">
                <span className="vc-slot-no">{questionNumber(key)}</span>
                <span className="vc-slot-name">{SLOT_LABEL[key]}</span>
                <span className="vc-slot-req">{required.includes(key) ? "필수" : "선택"}</span>
                {isCurrent ? (
                  <span className="vc-tag vc-tag--ink">지금 질문</span>
                ) : tag.tone === "empty" ? (
                  <span className="vc-slot-empty">비어 있음</span>
                ) : tag.tone === "skipped" ? (
                  <span className="vc-slot-empty">건너뜀</span>
                ) : (
                  <span className="vc-tag">{tag.text}</span>
                )}
              </div>
              {isCurrent && <p className="vc-slot-value vc-slot-value--wait">봉사자 답을 기다려요</p>}
              {value && <p className="vc-slot-value">{value}</p>}
              <button
                type="button"
                className="vc-slot-jump"
                aria-label={`질문 ${questionNumber(key)} ${SLOT_LABEL[key]}으로 가기`}
                onClick={() => onJump(key)}
              />
            </li>
          );
        })}
      </ul>
      <p className="vc-missing" data-testid="panel-note">
        {noteOf(purchase, slots, reviewReady)}
      </p>
      <div className="vc-release">
        <ReleaseConfirm onRelease={onRelease} releasing={releasing} />
      </div>
    </aside>
  );
}
