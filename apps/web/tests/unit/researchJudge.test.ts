import { describe, expect, it } from "vitest";
import type { ResearchResponse } from "@/lib/research";
import type { ResearchContext } from "@/lib/researchAi";
import { hasForbidden } from "@/lib/researchCheck";
import { judge, SUSPECT, textViolations, withoutExempt } from "../helpers/researchJudge";

// 실제 OpenAI 시험(tests/chatbot/research-ai.test.ts)이 쓰는 응답 판정 함수의 시험이다. 키 없이 돈다.
// 판정 목록이 깨지면 실호출 결과가 조용히 통과하므로, 평소 npm run check에서 확인한다.

/** 서버 보조 검사(hasForbidden)에 기대지 않고 SUSPECT 규칙만으로 걸렸는지. */
const caughtBySuspect = (text: string) =>
  textViolations("text", text).some((violation) => violation.rule !== "서버검사(hasForbidden)");

describe("SUSPECT와 EXEMPT", () => {
  it("독립 의심 목록은 예시마다 자기 정규식이 직접 잡는다(서버 검사에 기대지 않는다)", () => {
    for (const [rule, pattern, sample] of SUSPECT) {
      expect(pattern.test(withoutExempt(sample.normalize("NFKC"))), `${rule}: 정규식이 예시를 못 잡음`).toBe(true);
    }
  });

  it("서버 검사가 놓쳐도 독립 의심 목록이 잡는 표현이 있다(서버와 따로 간다는 증거)", () => {
    // 이 시험이 서버 hasForbidden에 기대고 있었다면 이 문장들은 통과했을 것이다. 서버가 나중에 막아도 이 시험은 계속 잡는다.
    for (const text of [
      "19900이에요",
      "값은 19900이에요",
      "할인해서 15900",
      "2000에 팔아요",
      "구매가 가능해요",
      "완판이에요",
      "솔드아웃이에요",
      "재입고 예정이래요",
      "10퍼 할인해요",
      "바로 살 수 있어요",
      "재고 넉넉해요",
      "정상가보다 싸요 1만 2천 원",
    ]) {
      expect(textViolations("text", text).length, text).toBeGreaterThan(0);
    }
  });

  // 4차 R4-4: 예외 조각이 너무 넓게 지워 SUSPECT를 무력화하던 곳
  it("R4-4: 19,900 won, 재고 3개, USD 199, KRW19900은 SUSPECT만으로 걸린다", () => {
    for (const text of ["19,900 won", "29900won", "재고 3개", "재고 12개 남았어요", "USD 199", "KRW19900", "usd199"]) {
      expect(caughtBySuspect(text), text).toBe(true);
    }
  });

  it("R4-4: 영문 한 글자 단위는 뒤에 영문이 오지 않을 때만 지운다", () => {
    expect(withoutExempt("19,900 won").trim()).toContain("won");
    expect(withoutExempt("5000mAh 배터리").trim()).toBe("배터리");
    expect(withoutExempt("40W 충전, 12V, 2.5m 줄").replace(/\s+/g, " ").trim()).toBe("충전, , 줄");
  });

  it("R4-3: 한글 숫자 한 글자 금액도 SUSPECT가 잡는다", () => {
    for (const text of ["만원대 이어폰이에요", "천원짜리 케이스도 있어요", "만 원짜리예요", "오만원대예요"]) {
      expect(caughtBySuspect(text), text).toBe(true);
    }
    for (const text of ["만 원하시면 알려 주세요", "블루투스만 원하시면 골라요", "만원권은 없어요"]) {
      expect(textViolations("text", text), text).toEqual([]);
    }
  });

  it("서버가 통과시키는 글을 이 시험이 위반으로 잡지 않는다(오탐 예외)", () => {
    for (const text of [
      "5만큼 가벼워요",
      "갤럭시 버즈2 프로",
      "아이폰 15 프로",
      "갤럭시 버즈 2 프로 이어폰",
      "쿠폰 적용 방법 안내",
      "기기 사이 원활하게",
      "40mm IPX4 A2DP 지원",
      "구매 가능 여부는 쇼핑몰에서 확인해요",
      "재고 여부는 쇼핑몰에서 확인해요",
      "WH-1000XM4와 LH-200을 비교해요",
      "5000mAh 배터리, 20,000Hz까지",
      "리뷰 1200개",
      "리뷰 수는 1,200개예요",
      "35시간 재생, 2개 중 1세대",
      "2024년에 나왔어요",
      "블루투스 5.3 지원",
      "배터리 80% 충전, 습도 50%",
    ]) {
      expect(textViolations("text", text), text).toEqual([]);
    }
  });
});

describe("judge", () => {
  it("판정 함수가 우회 표현과 지어낸 기종 토큰을 잡는다", () => {
    const context: ResearchContext = { product: "소니 헤드셋", brand: "Sony", item: "헤드셋" };
    const request = { kind: "summary", model: "소니 WH-CH720N" };
    for (const text of ["지금 19,900에 팔아요", "삼만 원이에요", "10프로 할인", "재고: 있음", "Sold out", "반값이에요"]) {
      expect(textViolations("text", text).length, text).toBeGreaterThan(0);
    }
    for (const text of ["착용감이 편해요", "35시간 쓸 수 있대요", "WH-CH720N을 골랐어요"]) {
      expect(textViolations("text", text), text).toEqual([]);
    }
    const made: ResearchResponse = { kind: "summary", ai: "ok", text: "WH-1000XM5도 함께 보세요. WH-CH720N이 가벼워요." };
    const rules = judge(made, context, request).map((violation) => `${violation.rule}:${violation.snippet}`);
    expect(rules).toEqual(["자료에 없는 기종 토큰:WH-1000XM5"]);
  });

  it("서버 보조 검사가 아는 표현은 규칙 이름으로 구분된다", () => {
    // hasForbidden만 아는 표현이 있으면 서버 검사 이름으로 나온다. 둘 다 아는 표현은 SUSPECT 이름으로 나온다.
    const [only] = textViolations("text", "만 원이에요");
    expect(only?.rule).toBe("한글 숫자 금액");
    expect(hasForbidden("만 원이에요")).toBe(true);
  });
});
