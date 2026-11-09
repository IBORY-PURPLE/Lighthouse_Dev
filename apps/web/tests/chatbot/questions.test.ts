import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAnswer, type AnswerViolation } from "@/lib/answerRules";
import { getLlmMode, LLM_MODEL, streamAnswer } from "@/lib/llm";
import type { ChatContext } from "@/lib/prompt";
import rawQuestions from "./questions.json";

// 실제 Groq를 부르는 유일한 시험이다(.claude/rules/chatbot-quality.md).
// 키가 보이지 않으면 호출 시험을 건너뛴다. 건너뛴 것은 통과가 아니다(ai.md 블록 4).

const INTERVAL_MS = 7_000;
/** Playwright가 apps/web/test-results를 비우므로 저장소 루트에 남긴다. */
const RESULTS_DIR = path.resolve(import.meta.dirname, "../../../../test-results");
const hasKey = Boolean(process.env.GROQ_API_KEY?.trim());

// v1 고정 질문 20개(q01~q20)는 그대로 두고, 선택 맥락 질문 5개(q21~q25)를 더했다(TSD §9, 블록 5).
const V1_IDS = Array.from(
  { length: 20 },
  (_, index) => `q${String(index + 1).padStart(2, "0")}`,
);

const questions: { id: string; text: string; context: ChatContext }[] =
  rawQuestions as { id: string; text: string; context: ChatContext }[];

describe("챗봇 시험 질문", () => {
  it("v1 20개 + 맥락 질문 5개이고 id가 겹치지 않으며 본문과 품목이 있다", () => {
    const ids = questions.map((question) => question.id);
    expect(ids).toHaveLength(25);
    expect(ids.slice(0, 20)).toEqual(V1_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const question of questions) {
      expect(question.text.trim().length).toBeGreaterThan(0);
      expect(question.text.length).toBeLessThanOrEqual(300);
      expect(question.context.item.trim().length).toBeGreaterThan(0);
    }
  });

  it("합격 질문, 표기 변형, 가격·재고 유도 질문을 포함한다", () => {
    const texts = questions.map((question) => question.text);
    expect(texts).toContain("sony 헤드셋 제품을 찾는 가이드 알려줘");
    for (const variant of ["sony", "소니", "SONY", "쏘니"]) {
      expect(texts.some((text) => text.includes(variant))).toBe(true);
    }
    expect(texts.some((text) => text.includes("얼마"))).toBe(true);
    expect(texts.some((text) => text.includes("재고"))).toBe(true);
    expect(texts).toContain("제일 싼 거 가격이랑 모델명 알려줘");
  });

  it("v1 질문에는 선택 맥락이 없다", () => {
    for (const question of questions.slice(0, 20)) {
      expect(Object.keys(question.context).sort()).toEqual(["brand", "item"]);
    }
  });

  it("예산 있음·중고·새 제품 맥락 질문과 예산 숫자 유도 질문을 포함한다", () => {
    const extra = questions.slice(20);
    expect(extra.some((question) => question.context.hasBudget === true)).toBe(
      true,
    );
    expect(extra.some((question) => question.context.condition === "used")).toBe(
      true,
    );
    expect(extra.some((question) => question.context.condition === "new")).toBe(
      true,
    );
    expect(
      extra.some(
        (question) =>
          question.context.hasBudget === true &&
          /\d+\s*만\s*원/.test(question.text),
      ),
    ).toBe(true);
  });
});

interface AnswerRecord {
  id: string;
  question: string;
  answer: string;
  violations: AnswerViolation[];
  error: string | null;
  ms: number;
}

describe.skipIf(!hasKey)("실제 Groq 답변", () => {
  const records: AnswerRecord[] = [];

  beforeAll(() => {
    expect(getLlmMode()).toBe("live");
  });

  afterAll(() => {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(
      path.join(RESULTS_DIR, `chatbot-${stamp}.json`),
      JSON.stringify(
        {
          model: LLM_MODEL,
          intervalMs: INTERVAL_MS,
          questionsAsked: records.length,
          passed: records.filter(
            (record) => !record.error && record.violations.length === 0,
          ).length,
          records,
        },
        null,
        2,
      ),
    );
  });

  it.each(questions)("$id: $text", async ({ id, text, context }) => {
    if (records.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }

    const startedAt = Date.now();
    let answer = "";
    let error: string | null = null;
    try {
      for await (const piece of streamAnswer({ question: text, context })) {
        answer += piece;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "unknown";
    }
    const violations = checkAnswer(answer);
    records.push({
      id,
      question: text,
      answer,
      violations,
      error,
      ms: Date.now() - startedAt,
    });

    expect(error).toBeNull();
    expect(violations).toEqual([]);
  });
});
