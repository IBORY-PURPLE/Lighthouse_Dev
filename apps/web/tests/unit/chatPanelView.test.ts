import { describe, expect, it } from "vitest";
import { lastQuestionSeq, newlyFilled } from "@/lib/chatPanelView";
import type { ChatMessage } from "@/lib/researchClient";

const question = (seq: number, slot: string): ChatMessage => ({ seq, role: "ai", tag: "question", slot, body: { text: "?" } });
const volunteer = (seq: number): ChatMessage => ({ seq, role: "volunteer", body: { text: "답" } });

describe("newlyFilled", () => {
  const filled = { value: "a", status: "filled", by: "volunteer" } as const;
  const confirmed = { value: "a", status: "confirmed", by: "volunteer" } as const;
  const skipped = { value: "", status: "skipped", by: "volunteer" } as const;

  it("이전에 비었다가 filled·confirmed가 된 칸만 센다", () => {
    expect(newlyFilled({}, { model: filled, pros: confirmed })).toEqual(["model", "pros"]);
    expect(newlyFilled({ model: filled }, { model: filled, pros: filled })).toEqual(["pros"]);
  });

  it("그대로이거나 건너뜀이면 세지 않는다. 이미 filled가 confirmed로 바뀌어도 새 칸이 아니다", () => {
    expect(newlyFilled({ model: filled }, { model: filled })).toEqual([]);
    expect(newlyFilled({}, { model: skipped })).toEqual([]);
    expect(newlyFilled({ model: filled }, { model: confirmed })).toEqual([]);
  });

  it("건너뜀이 나중에 채워지면 새 칸이다", () => {
    expect(newlyFilled({ model: skipped }, { model: filled })).toEqual(["model"]);
  });
});

describe("lastQuestionSeq", () => {
  it("그 칸의 마지막 질문 말풍선 seq", () => {
    const messages = [question(1, "model"), volunteer(2), question(3, "pros"), volunteer(4), question(5, "model")];
    expect(lastQuestionSeq(messages, "model")).toBe(5);
    expect(lastQuestionSeq(messages, "pros")).toBe(3);
  });

  it("묻지 않은 칸은 null, AI가 아닌 말풍선·질문이 아닌 태그는 건너뛴다", () => {
    const messages: ChatMessage[] = [
      question(1, "model"),
      { seq: 2, role: "ai", tag: "fill", slot: "pros", body: { text: "채움" } },
      { seq: 3, role: "volunteer", tag: "question", slot: "pros", body: { text: "x" } },
    ];
    expect(lastQuestionSeq(messages, "pros")).toBeNull();
    expect(lastQuestionSeq([], "model")).toBeNull();
  });
});
