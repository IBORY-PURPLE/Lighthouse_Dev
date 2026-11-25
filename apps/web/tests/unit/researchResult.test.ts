import { describe, expect, it } from "vitest";
import { clip } from "@/lib/researchResult";

describe("clip", () => {
  it("한도 이하면 그대로, 넘으면 max자(말줄임표 포함)로 자른다", () => {
    expect(clip("가나다", 3)).toBe("가나다");
    expect(clip("가나다라", 3)).toBe("가나…");
    expect([...clip("😀".repeat(10), 4)]).toHaveLength(4);
  });
});
