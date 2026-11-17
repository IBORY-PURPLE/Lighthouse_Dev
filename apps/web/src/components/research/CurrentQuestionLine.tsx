import { SLOT_LABEL, questionNumber } from "@/lib/researchChatView";
import type { SlotKey } from "@/lib/researchClient";

/** 대화 맨 위에 붙어 지금 묻는 칸을 한 줄로 알린다(질문 n · 칸 이름). 묻는 칸이 없으면 그리지 않는다. */
export function CurrentQuestionLine({ slot, required }: { slot: SlotKey | null; required: boolean }) {
  if (!slot) return null;
  return (
    <p className="vc-current" data-testid="current-question">
      <span className="vc-current-label">지금 질문</span>
      질문 {questionNumber(slot)} · {SLOT_LABEL[slot]}
      <span className="vc-current-req">{required ? "필수" : "선택"}</span>
    </p>
  );
}
