import { describe, expect, it } from "vitest";
import type { BenefitGroup, ProductItem, SearchRun } from "@/lib/researchSearch";
import { benefitTextViolations, judgeBenefits, judgeProducts } from "../helpers/researchSearchJudge";

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

  it("한글 수사 + 프로·퍼센트·포인트·P(오 프로 혜택, 오 포인트 적립)를 잡는다", () => {
    for (const text of ["오 프로 혜택", "오 포인트 적립", "이십 프로 적립", "십 퍼센트 청구 할인", "하나 포인트 적립", "오P 적립", "포인트 500 적립", "포인트 약 5천", "포인트 오백 적립"]) {
      expect(benefitTextViolations("title", text).length, text).toBeGreaterThan(0);
    }
  });

  it("종류와 조건만 말한 글은 통과한다", () => {
    for (const text of ["제휴 카드 청구 할인", "12개월 무이자 할부", "포인트 적립 혜택", "공식몰에서 주문하면 받아요", "카드사 포인트 적립", "프로모션 사은품", "프로그램 가입 혜택"]) {
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

describe("judgeProducts: 제품 목록의 pageUrl", () => {
  const productRun = (data: ProductItem[], ai: "ok" | "fallback", citations: string[] = []): SearchRun<ProductItem[]> => ({
    data,
    ai,
    upstream: null,
    usage: { in: 0, out: 0, ws: 0 },
    citations,
  });
  const url = "https://www.sony.co.kr/headphones/wh-ch720n";

  it("AI 응답은 인용에 있던 주소가 있어야 하고, 주소가 없거나 인용에 없으면 위반이다", () => {
    expect(judgeProducts(productRun([{ name: "소니 WH-CH720N", feature: "가벼워요", pageUrl: url }], "ok", [url]))).toEqual([]);
    const missing = judgeProducts(productRun([{ name: "소니 WH-CH720N", feature: "가벼워요", pageUrl: null }], "ok", [url]));
    expect(missing.map((violation) => violation.rule)).toContain("제품 주소 없음");
    const stray = judgeProducts(productRun([{ name: "소니 WH-CH720N", feature: "가벼워요", pageUrl: "https://shop.example.com/x" }], "ok", [url]));
    expect(stray.map((violation) => violation.rule)).toContain("인용에 없는 주소");
  });

  it("고정 후보는 pageUrl이 없어야 한다(만든 쇼핑몰 검색 주소를 공식 페이지로 보이면 위반)", () => {
    expect(judgeProducts(productRun([{ name: "소니 WH-CH720N", feature: "고정 후보", pageUrl: null }], "fallback"))).toEqual([]);
    const bad = judgeProducts(
      productRun([{ name: "소니 WH-CH720N", feature: "고정 후보", pageUrl: "https://search.11st.co.kr/pc/total-search?kwd=x" }], "fallback"),
    );
    expect(bad.map((violation) => violation.rule)).toContain("고정 후보 pageUrl");
  });
});
