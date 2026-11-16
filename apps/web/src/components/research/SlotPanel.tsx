"use client";

import { useState } from "react";
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

function noteOf(purchase: Purchase, slots: SlotMap, reviewReady: boolean): string {
  if (purchase === "unset") return "먼저 구매 여부를 알려 주세요.";
  const { filled, total } = requiredProgress({ purchase, slots });
  if (reviewReady) return "고친 문단을 확인하고 보내면 끝나요.";
  if (filled === total) return `필수 칸 ${total}개를 모두 채웠어요. 선택 칸도 이어서 물어요.`;
  return `필수 칸 ${total}개를 대화로 하나씩 채워 가요.`;
}

/**
 * 오른쪽 "모은 정보" 패널. 필수 n/m, 칸 상태 줄(점선+"AI 제안", 실선+"봉사자 확정"), 빠진 필수 칸 안내.
 * 1180px 미만에서는 접혀 있다가 위 바의 버튼으로 열린다. 요청 내려놓기는 이 패널 맨 아래에 둔다.
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
}) {
  const [confirming, setConfirming] = useState(false);
  const { filled, total } = requiredProgress({ purchase, slots });
  const required = requiredSlots(purchase);
  const rows = panelSlots(purchase);

  return (
    <aside id={id} className={`vc-panel${open ? " is-open" : ""}`} aria-label="모은 정보">
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
            </li>
          );
        })}
      </ul>
      <p className="vc-missing" data-testid="panel-note">
        {noteOf(purchase, slots, reviewReady)}
      </p>
      <div className="vc-release">
        {confirming ? (
          <div role="group" aria-label="요청 내려놓기 확인">
            <p className="vc-release-prompt">이 요청을 대기열로 돌려놓을까요? 모은 정보는 지워져요.</p>
            <div className="vc-release-row">
              <button type="button" className="vc-btn vc-btn--small" onClick={() => setConfirming(false)}>
                취소
              </button>
              <button
                type="button"
                className="vc-btn vc-btn--small vc-btn--ink"
                aria-disabled={releasing ? true : undefined}
                onClick={() => {
                  if (!releasing) onRelease();
                }}
              >
                돌려놓기
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="vc-release-btn" onClick={() => setConfirming(true)}>
            요청 내려놓기
          </button>
        )}
      </div>
    </aside>
  );
}
