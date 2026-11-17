import { isFilled } from "./researchChatView";
import { SLOT_KEYS, type ChatMessage, type SlotKey, type SlotMap } from "./researchClient";

// "모은 정보" 창의 새 칸 점과 칸 누르기가 쓰는 순수 함수(서버 코드가 아니다).

/** 이전에는 채워지지 않았다가 이번에 filled·confirmed가 된 칸(건너뜀은 세지 않는다). */
export function newlyFilled(prev: SlotMap, next: SlotMap): SlotKey[] {
  return SLOT_KEYS.filter((key) => !isFilled(prev, key) && isFilled(next, key));
}

/** 그 칸을 마지막으로 물은 AI 질문 말풍선의 seq. 아직 묻지 않았으면 null. */
export function lastQuestionSeq(messages: readonly ChatMessage[], slot: SlotKey): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "ai" && message.tag === "question" && message.slot === slot) return message.seq;
  }
  return null;
}
