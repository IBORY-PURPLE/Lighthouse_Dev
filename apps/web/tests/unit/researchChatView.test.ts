import { describe, expect, it } from "vitest";
import {
  altNames,
  badgeOf,
  benefitsOf,
  chipsOf,
  currentSlot,
  imageSearchUrl,
  panelSlots,
  planFold,
  productsOf,
  questionNumber,
  quickOf,
  requiredProgress,
  requiredSlots,
  slotTag,
  thinkingPhase,
} from "@/lib/researchChatView";
import { mergeMessages, type ChatMessage } from "@/lib/researchClient";

const question = (seq: number, slot: string): ChatMessage => ({ seq, role: "ai", tag: "question", slot, body: { text: "?" } });
const volunteer = (seq: number): ChatMessage => ({ seq, role: "volunteer", body: { text: "답" } });

describe("리서치 챗 화면 규칙", () => {
  it("리서치만이면 사진 칸이 없고 필수는 3칸이다", () => {
    expect(requiredSlots("research")).toEqual(["model", "pros", "altReason"]);
    expect(requiredSlots("bought")).toEqual(["model", "pros", "photo", "altReason"]);
    expect(panelSlots("research")).not.toContain("photo");
    expect(panelSlots("bought")).toHaveLength(7);
    expect(panelSlots("unset")).toHaveLength(7);
  });

  it("필수 n/m은 찬 필수 칸만 센다", () => {
    const slots = {
      model: { value: "A", status: "filled" as const, by: "volunteer" as const },
      alts: { value: "B", status: "filled" as const, by: "volunteer" as const },
      photo: { value: "1장", status: "filled" as const, by: "volunteer" as const },
    };
    expect(requiredProgress({ purchase: "bought", slots })).toEqual({ filled: 2, total: 4 });
    expect(requiredProgress({ purchase: "research", slots })).toEqual({ filled: 1, total: 3 });
  });

  it("구매 배지는 상태를 글자로 구분한다", () => {
    expect(badgeOf({ purchase: "unset", verified: false }).label).toBe("구매 확인 전");
    expect(badgeOf({ purchase: "bought", verified: false }).label).toBe("구매함 · 사진 전");
    expect(badgeOf({ purchase: "bought", verified: true }).label).toBe("구매 인증됨");
    expect(badgeOf({ purchase: "research", verified: false }).label).toBe("리서치만");
  });

  it("칸 꼬리표: AI 제안은 점선 쪽, 봉사자 확정과 건너뜀은 글자로 구분", () => {
    expect(slotTag(undefined).text).toBe("비어 있음");
    expect(slotTag({ value: "", status: "skipped", by: "volunteer" }).text).toBe("건너뜀");
    expect(slotTag({ value: "x", status: "filled", by: "ai" }).text).toBe("AI 제안");
    expect(slotTag({ value: "x", status: "confirmed", by: "volunteer" }).text).toBe("봉사자 확정");
  });

  it("질문 번호와 지금 질문", () => {
    expect(questionNumber("model")).toBe(1);
    expect(questionNumber("refs")).toBe(7);
    expect(currentSlot([question(1, "model"), volunteer(2), question(3, "pros")])).toBe("pros");
    expect(currentSlot([volunteer(1)])).toBeNull();
  });

  it("지난 질문은 질문이 4개 이상일 때 마지막 두 질문 앞까지 접는다", () => {
    const few = [question(1, "model"), volunteer(2), question(3, "pros")];
    expect(planFold(few, false).foldedCount).toBe(0);
    const many = [
      question(1, "model"),
      volunteer(2),
      question(3, "pros"),
      volunteer(4),
      question(5, "photo"),
      volunteer(6),
      question(7, "alts"),
      question(8, "altReason"),
    ];
    const plan = planFold(many, true);
    expect(plan.foldedUpTo).toBe(6);
    expect(plan.foldedCount).toBe(6);
    expect(plan.summary).toBe("질문 1~3 · 기종, 장점, 사진 — 칸 채움 완료, 구매 인증됨");
  });

  it("같이 고민한 제품 이름은 칸 값에서 나눈다(건너뜀이면 없다)", () => {
    expect(altNames({ alts: { value: "A, B", status: "filled", by: "volunteer" } })).toEqual(["A", "B"]);
    expect(altNames({ alts: { value: "", status: "skipped", by: "volunteer" } })).toEqual([]);
    expect(altNames({})).toEqual([]);
  });

  it("사진 보기는 새 탭 이미지 검색 주소다", () => {
    expect(imageSearchUrl("WH-1000XM5")).toBe("https://www.google.com/search?tbm=isch&q=WH-1000XM5");
    expect(imageSearchUrl("소니 헤드셋")).toContain("q=%EC%86%8C%EB%8B%88");
  });

  it("메시지 body 읽기: 빠른 답·칩·제품·혜택", () => {
    expect(quickOf({ quick: [{ id: "a", label: "A" }, { id: "", label: "x" }, { id: "b", label: "B", tone: "primary", action: "review_make" }] })).toEqual([
      { id: "a", label: "A", tone: "normal", action: "turn" },
      { id: "b", label: "B", tone: "primary", action: "review_make" },
    ]);
    expect(chipsOf({ text: "x" })).toBeNull();
    const chips = chipsOf({ chips: [{ label: "WH-CH720N" }], chipSlot: "model" });
    expect(chips?.chips).toEqual([{ label: "WH-CH720N", value: "WH-CH720N", slot: "model" }]);
    expect(productsOf({ kind: "products", items: [{ name: "A", feature: "f", pageUrl: "https://x.test" }, { feature: "이름 없음" }] })?.items).toHaveLength(1);
    expect(productsOf({ text: "t" })).toBeNull();
    const benefits = benefitsOf({ kind: "benefits", headline: "h", items: [{ title: "t", url: "https://a.test", mode: "check" }, { id: "2", title: "u", url: "https://b.test" }] });
    expect(benefits?.items.map((item) => item.mode)).toEqual(["check", "ai"]);
  });

  it("메시지는 seq로 합치고 같은 seq는 새 것이 이긴다", () => {
    const merged = mergeMessages([volunteer(1), question(2, "model")], [{ ...volunteer(2), body: { text: "새" } }, question(3, "pros")]);
    expect(merged.map((message) => message.seq)).toEqual([1, 2, 3]);
    expect(merged[1].body.text).toBe("새");
  });

  it("생각 중 문구는 0초, 4초, 10초에 바뀐다", () => {
    expect(thinkingPhase(0)).toBe(0);
    expect(thinkingPhase(3_999)).toBe(0);
    expect(thinkingPhase(4_000)).toBe(1);
    expect(thinkingPhase(10_000)).toBe(2);
  });
});
