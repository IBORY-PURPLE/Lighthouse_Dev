import { describe, expect, it } from "vitest";
import { turnTrace, type TurnRun } from "@/lib/researchTurn";

const question = (slot: "pros" | "alts", text: string, ai: "ok" | "none") => ({
  action: "ask_slot" as const,
  slot,
  message: { role: "ai" as const, tag: "question", slot, body: { kind: "text", text }, ai },
});

describe("turnTrace(Vercel 로그용 턴 요약)", () => {
  it("AI 판단과 서버 질문 후보를 남기고, 봉사자가 말한 칸 값은 남기지 않는다", () => {
    const run: TurnRun = {
      plan: {
        patch: {},
        messages: [],
        next: [question("alts", "가볍다고 하셨는데, 같이 고민한 제품도 있었나요?", "ok"), question("pros", "기본 질문", "none"), question("pros", "셋째", "none")],
        label: "ok",
      },
      upstream: null,
      usage: { in: 812, out: 64 },
      aiTurn: {
        intent: "reply",
        fills: [{ slot: "pros", value: "봉사자비밀값 가벼워서 좋아요" }],
        purchase: null,
        guide: null,
        next: { action: "ask_slot", slot: "alts", text: "가볍다고 하셨는데, 같이 고민한 제품도 있었나요?" },
        dropped: false,
      },
    };
    const trace = turnTrace(run);
    expect(trace).toEqual({
      ai: "ok",
      upstream: null,
      tokens: { in: 812, out: 64 },
      intent: "reply",
      filled: ["pros"],
      aiNext: { action: "ask_slot", slot: "alts", text: "가볍다고 하셨는데, 같이 고민한 제품도 있었나요?" },
      aiDropped: false,
      next: [
        { action: "ask_slot", slot: "alts", by: "ok", text: "가볍다고 하셨는데, 같이 고민한 제품도 있었나요?" },
        { action: "ask_slot", slot: "pros", by: "none", text: "기본 질문" },
      ],
    });
    expect(JSON.stringify(trace)).not.toContain("봉사자비밀값");
  });

  it("AI가 실패하면 판단 칸은 비우고 실패 원인을 남긴다", () => {
    const run: TurnRun = {
      plan: { patch: {}, messages: [], next: [], label: "fallback" },
      upstream: "timeout",
      usage: { in: 0, out: 0 },
      aiTurn: null,
    };
    expect(turnTrace(run)).toMatchObject({ ai: "fallback", upstream: "timeout", intent: null, filled: [], aiNext: null, next: [] });
  });
});
