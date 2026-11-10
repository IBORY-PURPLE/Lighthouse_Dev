import { describe, expect, it } from "vitest";
import { REGISTERED_VOLUNTEER } from "@/lib/volunteers";

describe("REGISTERED_VOLUNTEER", () => {
  it("등록 봉사자 1명이고 표시 이름은 고정 글자다", () => {
    expect(REGISTERED_VOLUNTEER).toEqual({
      id: "vol-01",
      displayName: "등록 봉사자",
    });
  });

  it("id와 표시 이름 외 필드가 없다", () => {
    expect(Object.keys(REGISTERED_VOLUNTEER).sort()).toEqual([
      "displayName",
      "id",
    ]);
  });

  it("표시 이름에 환경 변수의 번호 숫자가 없다", () => {
    const digits = (process.env.VOLUNTEER_PHONE ?? "").replace(/\D/g, "");
    expect(digits).not.toBe("");
    expect(REGISTERED_VOLUNTEER.displayName).not.toContain(digits);
    expect(REGISTERED_VOLUNTEER.displayName).not.toMatch(/\d/);
  });
});
