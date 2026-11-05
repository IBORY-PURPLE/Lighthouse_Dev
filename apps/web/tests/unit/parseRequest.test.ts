import { describe, expect, it } from "vitest";
import { parseRequest } from "@/lib/parseRequest";

describe("parseRequest", () => {
  it("합격 문장은 Sony 헤드셋이다", () => {
    expect(parseRequest("sony껄로 헤드셋 사고싶어")).toEqual({
      brand: "Sony",
      item: "헤드셋",
    });
  });

  for (const brand of ["sony", "Sony", "SONY", "소니", "쏘니", "소니껄로", "쏘니꺼"]) {
    it(`브랜드 표기 변형: ${brand}`, () => {
      expect(parseRequest(`${brand} 헤드셋`).brand).toBe("Sony");
    });
  }

  for (const item of ["헤드셋", "헤드폰", "헤드폰으로", "헤드셋을"]) {
    it(`품목 표기 변형: ${item}`, () => {
      expect(parseRequest(`소니 ${item} 찾아줘`).item).toBe("헤드셋");
    });
  }

  it("브랜드가 없으면 null이고 품목은 찾는다", () => {
    expect(parseRequest("헤드셋 사고싶어")).toEqual({
      brand: null,
      item: "헤드셋",
    });
  });

  it("품목이 없으면 item이 null이다", () => {
    expect(parseRequest("sony껄로 사고싶어")).toEqual({
      brand: "Sony",
      item: null,
    });
    expect(parseRequest("안녕하세요")).toEqual({ brand: null, item: null });
  });

  it("연속으로 불러도 같은 결과다", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(parseRequest("SONY 헤드폰")).toEqual({
        brand: "Sony",
        item: "헤드셋",
      });
    }
  });
});
