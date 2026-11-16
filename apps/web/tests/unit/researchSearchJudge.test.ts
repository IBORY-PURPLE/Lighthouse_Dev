import { describe, expect, it } from "vitest";
import type { BenefitGroup, SearchRun } from "@/lib/researchSearch";
import { benefitTextViolations, judgeBenefits } from "../helpers/researchSearchJudge";

// 혜택 응답 판정(실제 AI 시험이 쓴다)이 혜택 전용 표현을 잡는지. 키 없이 돈다.

const run = (item: Partial<BenefitGroup["items"][number]>): SearchRun<BenefitGroup[]> => {
  const url = "https://example.com/benefits/a";
  return {
    data: [
      {
        branch: "official",
        label: "공식몰·제조사 행사",
        items: [
          { id: "official-1", title: "공식몰 사은품", kind: "공식몰·제조사 행사", condition: "주문하면 받아요", compare: "다른 종류예요", url, mode: "ai", ...item },
        ],
      },
    ],
    ai: "ok",
    upstream: null,
    usage: { in: 0, out: 0, ws: 0 },
    citations: [url],
  };
};

describe("benefitTextViolations: 혜택 글 전용 의심", () => {
  it("돈 낱말이 없는 퍼센트, 천만 단위 수, 포인트 수량, 연락처를 잡는다", () => {
    for (const text of ["20% 포인트 추가", "즉시 5% 혜택", "최대 3천 포인트", "5,000P 적립", "최대 3만", "문의 010-1234-5678", "카톡으로 문의"]) {
      expect(benefitTextViolations("title", text).length, text).toBeGreaterThan(0);
    }
  });

  it("종류와 조건만 말한 글은 통과한다", () => {
    for (const text of ["제휴 카드 청구 할인", "12개월 무이자 할부", "포인트 적립 혜택", "공식몰에서 주문하면 받아요"]) {
      expect(benefitTextViolations("title", text), text).toEqual([]);
    }
  });
});

describe("judgeBenefits", () => {
  it("깨끗한 항목은 통과하고, 퍼센트가 든 항목은 위반으로 센다", () => {
    expect(judgeBenefits(run({}), { experience: "" })).toEqual([]);
    const bad = judgeBenefits(run({ condition: "즉시 5% 혜택이에요" }), { experience: "" });
    expect(bad.map((violation) => violation.rule)).toContain("혜택 글의 퍼센트");
  });
});
