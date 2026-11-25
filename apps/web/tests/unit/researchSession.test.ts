import { describe, expect, it } from "vitest";
import {
  afterAsk,
  applyPatch,
  capsFromEnv,
  DEFAULT_CAPS,
  emptySessionState,
  firstValidNext,
  isAskable,
  isNextValid,
  isPastQuestionSeven,
  mergePending,
  purchaseBadge,
  questionOrder,
  requiredMissing,
  requiredProgress,
  requiredSlots,
  type NextCandidate,
  type ResearchPending,
  type SlotKey,
  type SlotState,
} from "@/lib/researchSession";

const filled = (value = "x"): SlotState => ({ value, status: "filled", by: "volunteer" });
const cand = (action: NextCandidate["action"], slot: SlotKey | null = null): NextCandidate => ({
  action,
  slot,
  message: { role: "ai", body: { text: action } },
});

function state(over: Partial<ReturnType<typeof emptySessionState>> = {}) {
  return { ...emptySessionState(), ...over };
}

describe("질문 순서와 필수", () => {
  it("질문 순서 Q는 7칸이고, 리서치만·미정이면 사진이 빠진다", () => {
    expect(questionOrder("bought")).toEqual(["model", "pros", "photo", "alts", "altReason", "benefits", "refs"]);
    expect(questionOrder("research")).not.toContain("photo");
    expect(questionOrder("unset")).not.toContain("photo");
  });

  it("필수: model, pros, altReason에 구매함이면 photo. 리서치만이면 사진 칸 없음", () => {
    expect(requiredSlots("bought")).toEqual(["model", "pros", "altReason", "photo"]);
    expect(requiredSlots("research")).toEqual(["model", "pros", "altReason"]);
  });

  it("purchase가 정해지지 않았으면 purchase가 비어 있는 필수 맨 앞이다", () => {
    expect(requiredMissing(state())).toEqual(["purchase", "model", "pros", "altReason"]);
    expect(requiredMissing(state({ purchase: "bought", slots: { model: filled(), pros: filled(), altReason: filled() } }))).toEqual(["photo"]);
    expect(requiredMissing(state({ purchase: "research", slots: { model: filled(), pros: filled(), altReason: filled() } }))).toEqual([]);
  });

  it("건너뛴 칸은 필수를 채우지 않는다", () => {
    const s = state({ purchase: "research", slots: { model: filled(), pros: { value: "", status: "skipped", by: "volunteer" }, altReason: filled() } });
    expect(requiredMissing(s)).toEqual(["pros"]);
  });

  it("n/4와 n/3 진행", () => {
    expect(requiredProgress(state({ purchase: "bought", slots: { model: filled() } }))).toEqual({ filled: 1, total: 4 });
    expect(requiredProgress(state({ purchase: "research", slots: { model: filled() } }))).toEqual({ filled: 1, total: 3 });
    expect(requiredProgress(state())).toEqual({ filled: 0, total: 3 });
  });
});

describe("다음 질문 후보 유효성", () => {
  it("purchase가 unset이면 구매 질문만 유효하다", () => {
    const s = state();
    expect(isNextValid(s, cand("ask_purchase"))).toBe(true);
    expect(isNextValid(s, cand("ask_slot", "pros"))).toBe(false);
    expect(isNextValid(s, cand("propose_review"))).toBe(false);
    expect(isNextValid(state({ purchase: "bought" }), cand("ask_purchase"))).toBe(false);
  });

  it("AI가 unset에서 pros를 앞에 두어도 첫 유효 후보는 구매 질문이다", () => {
    expect(firstValidNext(state(), [cand("ask_slot", "pros"), cand("ask_purchase")])?.action).toBe("ask_purchase");
    expect(firstValidNext(state(), [cand("ask_slot", "pros")])).toBeNull();
    expect(firstValidNext(state(), null)).toBeNull();
  });

  it("사진 칸은 구매함일 때만 질문 가능하다", () => {
    expect(isAskable(state({ purchase: "research" }), "photo")).toBe(false);
    expect(isAskable(state({ purchase: "bought" }), "photo")).toBe(true);
  });

  it("찬 칸·확인 필요가 걸린 칸은 질문할 수 없다", () => {
    const s = state({ purchase: "bought", slots: { model: filled() }, pending: { confirmFill: { slot: "pros" } } });
    expect(isAskable(s, "model")).toBe(false);
    expect(isAskable(s, "pros")).toBe(false);
    expect(isAskable(s, "alts")).toBe(true);
  });

  it("물은 선택 칸은 다시 묻지 않고, 물은 필수 칸은 다시 물을 수 있다", () => {
    const s = state({ purchase: "research", counters: { asked: { pros: true, alts: true }, reasked: {} } });
    expect(isNextValid(s, cand("ask_slot", "alts"))).toBe(false);
    expect(isNextValid(s, cand("ask_slot", "pros"))).toBe(true);
  });

  it("reask는 칸마다 한 번이다", () => {
    const s = state({ purchase: "research", counters: { asked: {}, reasked: { pros: 1 } } });
    expect(isNextValid(s, cand("reask", "pros"))).toBe(false);
    expect(isNextValid(s, cand("reask", "model"))).toBe(true);
  });

  it("질문 7을 지나고 필수가 차야 추가 질문·리뷰 제안이 유효하다", () => {
    const base = state({
      purchase: "research",
      slots: { model: filled(), pros: filled(), altReason: filled() },
    });
    expect(isPastQuestionSeven(base)).toBe(false); // alts·benefits·refs를 아직 안 물음
    expect(isNextValid(base, cand("propose_review"))).toBe(false);
    const asked = { ...base, counters: { asked: { alts: true, benefits: true, refs: true }, reasked: {} } };
    expect(isPastQuestionSeven(asked)).toBe(true);
    expect(isNextValid(asked, cand("propose_review"))).toBe(true);
    expect(isNextValid(asked, cand("ask_extra"))).toBe(true);
    expect(isNextValid({ ...asked, extras: ["a", "b", "c"] }, cand("ask_extra"))).toBe(false);
    // 필수가 비면 둘 다 막힌다(규칙 a).
    const missing = { ...asked, slots: { model: filled() } };
    expect(isNextValid(missing, cand("propose_review"))).toBe(false);
    expect(isNextValid(missing, cand("ask_extra"))).toBe(false);
  });

  it("미해결 확인 필요가 있으면 리뷰 제안은 막히고 안내만 유효하다", () => {
    const s = state({
      purchase: "research",
      slots: { model: filled(), pros: filled(), altReason: filled() },
      counters: { asked: { alts: true, benefits: true, refs: true }, reasked: {} },
      pending: { confirmFill: { slot: "alts" } } as ResearchPending,
    });
    expect(isNextValid(s, cand("propose_review"))).toBe(false);
    expect(isNextValid(s, cand("pending_notice"))).toBe(true);
    expect(isNextValid({ ...s, pending: {} }, cand("pending_notice"))).toBe(false);
  });
});

describe("patch", () => {
  it("칸·구매가 바뀌면 changed, 카운터·pending만 바뀌면 changed가 아니다", () => {
    const base = state();
    const slots = applyPatch(base, { slots: { model: filled("720N") } });
    expect(slots).toMatchObject({ ok: true, changed: true });
    const counters = applyPatch(base, { asked: ["model"], pending: { x: { a: 1 } } });
    expect(counters).toMatchObject({ ok: true, changed: false });
    if (counters.ok) {
      expect(counters.counters.asked).toEqual({ model: true });
      expect(counters.pending).toEqual({ x: { a: 1 } });
    }
    expect(applyPatch(base, { purchase: "bought" })).toMatchObject({ ok: true, changed: true });
  });

  it("null은 칸·pending 키를 지운다", () => {
    const base = state({ slots: { model: filled() }, pending: { confirmFill: { slot: "x" } } });
    const result = applyPatch(base, { slots: { model: null }, pending: { confirmFill: null } });
    expect(result).toMatchObject({ ok: true, slots: {}, pending: {}, changed: true });
    expect(mergePending({ a: 1, b: 2 }, { a: null })).toEqual({ b: 2 });
  });

  it("잘못된 patch를 거부한다", () => {
    const base = state();
    expect(applyPatch(base, { slots: { nope: filled() } as never }).ok).toBe(false);
    expect(applyPatch(base, { slots: { model: { value: "x", status: "weird", by: "ai" } as never } }).ok).toBe(false);
    expect(applyPatch(base, { extras: ["1", "2", "3", "4"] }).ok).toBe(false);
    expect(applyPatch(base, { purchase: "maybe" as never }).ok).toBe(false);
  });

  it("질문을 고르면 asked와 직전 질문이 남는다", () => {
    const out = afterAsk({ asked: {}, reasked: {} }, {}, cand("reask", "pros"), 7);
    expect(out.counters).toEqual({ asked: { pros: true }, reasked: { pros: 1 } });
    expect(out.pending.lastQuestion).toEqual({ slot: "pros", seq: 7 });
    expect(afterAsk({ asked: {}, reasked: {} }, {}, cand("ask_purchase"), 2).pending.lastQuestion).toEqual({ slot: "purchase", seq: 2 });
  });
});

describe("배지·상한", () => {
  it("구매 배지 4가지", () => {
    expect(purchaseBadge(state())).toBe("before");
    expect(purchaseBadge(state({ purchase: "research" }))).toBe("research");
    expect(purchaseBadge(state({ purchase: "bought" }))).toBe("bought_no_photo");
    expect(purchaseBadge(state({ purchase: "bought", slots: { photo: filled("1장") } }))).toBe("verified");
    expect(
      purchaseBadge(state({ purchase: "bought", slots: { photo: filled("1장") }, pending: { mismatch: { slot: "model" } } })),
    ).toBe("bought_no_photo");
  });

  it("하루 상한은 환경변수로 바꾸고, 잘못된 값은 기본값이다", () => {
    expect(capsFromEnv({})).toEqual(DEFAULT_CAPS);
    expect(capsFromEnv({ RESEARCH_DAILY_SEARCH_CAP: "10", RESEARCH_DAILY_AI_CAP: "50" })).toMatchObject({ dailySearches: 10, dailyAi: 50, turns: 40 });
    expect(capsFromEnv({ RESEARCH_DAILY_SEARCH_CAP: "abc", RESEARCH_DAILY_AI_CAP: "-3" })).toEqual(DEFAULT_CAPS);
  });
});
