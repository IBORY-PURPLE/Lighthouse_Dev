import { describe, expect, it } from "vitest";
import type { MatchResponse } from "@/lib/matchHandoff";
import {
  chatContextFor,
  fromMatchV1,
  type VolunteerRequestView,
} from "@/lib/volunteerRequest";

const MATCH: MatchResponse = {
  requestId: "6f1c2e4a-1111-4222-8333-444455556666",
  volunteer: { id: "v1", displayName: "봉사자" },
  request: { brand: "Sony", item: "헤드셋", raw: "소니 헤드셋 찾아 줘" },
};

describe("fromMatchV1", () => {
  it("lh.match.v1을 공용 모양으로 바꾸고 없는 값은 null로 둔다(TSD:254)", () => {
    expect(fromMatchV1(MATCH)).toEqual({
      requestId: MATCH.requestId,
      queueNumber: null,
      product: "소니 헤드셋 찾아 줘",
      brand: "Sony",
      item: "헤드셋",
      budget: null,
      condition: null,
      conditionKind: null,
      claimedAt: null,
    });
  });

  it("브랜드가 null이어도 그대로 옮긴다", () => {
    const view = fromMatchV1({
      ...MATCH,
      request: { brand: null, item: "헤드셋", raw: "헤드셋" },
    });
    expect(view.brand).toBeNull();
    expect(view.item).toBe("헤드셋");
  });
});

describe("chatContextFor", () => {
  it("시연 어댑터 요청은 v1 맥락과 같은 모양이다", () => {
    expect(chatContextFor(fromMatchV1(MATCH))).toEqual({
      brand: "Sony",
      item: "헤드셋",
    });
  });

  it("예산은 있는지만 넘기고 원문 금액은 넘기지 않는다", () => {
    const view: VolunteerRequestView = {
      ...fromMatchV1(MATCH),
      budget: "10만 원 이하",
      condition: "중고도 괜찮아요",
      conditionKind: "used",
    };
    const context = chatContextFor(view);
    expect(context).toEqual({
      brand: "Sony",
      item: "헤드셋",
      hasBudget: true,
      condition: "used",
    });
    expect(JSON.stringify(context)).not.toContain("10만");
  });

  it("빈 예산 답은 예산 없음으로 본다", () => {
    const view = { ...fromMatchV1(MATCH), budget: "  " };
    expect(chatContextFor(view)).not.toHaveProperty("hasBudget");
  });
});
