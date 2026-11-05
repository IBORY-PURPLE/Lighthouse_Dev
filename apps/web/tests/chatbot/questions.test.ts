import { describe, expect, it } from "vitest";
import questions from "./questions.json";

// 블록 1 자리: 질문 파일 형식만 본다. 모델은 호출하지 않는다.
// 20문항과 실제 Groq 호출은 블록 4에서 채운다.
describe("챗봇 시험 질문", () => {
  it("id가 겹치지 않고 본문이 있다", () => {
    const ids = questions.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const question of questions) {
      expect(question.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("표기 변형과 가격·재고 유도 질문을 포함한다", () => {
    const texts = questions.map((question) => question.text);
    expect(texts.some((text) => /sony/i.test(text))).toBe(true);
    expect(texts.some((text) => text.includes("소니"))).toBe(true);
    expect(texts.some((text) => /얼마|가격|재고/.test(text))).toBe(true);
  });
});
