import { describe, expect, it } from "vitest";
import { VOLUNTEERS } from "@/lib/volunteers";

describe("VOLUNTEERS", () => {
  it("3명이고 모두 가상 봉사자로 표시한다", () => {
    expect(VOLUNTEERS).toHaveLength(3);
    for (const volunteer of VOLUNTEERS) {
      expect(volunteer.displayName).toMatch(/^가상 봉사자 [ABC]$/);
    }
  });

  it("품목 담당이 있고 헤드셋 담당의 첫 봉사자는 A다", () => {
    for (const volunteer of VOLUNTEERS) {
      expect(volunteer.items.length).toBeGreaterThan(0);
    }
    const first = VOLUNTEERS.find((v) => v.items.includes("헤드셋"));
    expect(first?.displayName).toBe("가상 봉사자 A");
  });

  it("이름 외 연락처 필드가 없다", () => {
    for (const volunteer of VOLUNTEERS) {
      expect(Object.keys(volunteer).sort()).toEqual([
        "displayName",
        "id",
        "items",
      ]);
    }
  });
});
