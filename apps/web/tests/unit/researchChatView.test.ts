import { describe, expect, it } from "vitest";
import {
  activeQuick,
  altNames,
  arrangeMessages,
  badgeOf,
  benefitsOf,
  chipsOf,
  currentSlot,
  failureText,
  imageSearchUrl,
  missingText,
  needsBenefitsSearch,
  panelSlots,
  planFold,
  productsOf,
  questionNumber,
  quickOf,
  reasonsOf,
  requiredProgress,
  requiredSlots,
  shortcutsOf,
  slotTag,
  thinkingPhase,
} from "@/lib/researchChatView";
import { mergeMessages, mergeView, normalizeView, type ChatMessage } from "@/lib/researchClient";

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

describe("서버 응답에 맞춘 읽기", () => {
  const ai = (seq: number, tag: string, slot: string): ChatMessage => ({ seq, role: "ai", tag, slot, body: { kind: "text", text: "x" } });

  it("쇼핑몰 바로가기는 https 주소만 읽는다", () => {
    expect(
      shortcutsOf({
        shortcuts: [
          { label: "쿠팡에서 찾기", url: "https://www.coupang.com/np/search?q=a" },
          { label: "나쁜 주소", url: "javascript:alert(1)" },
          { label: "", url: "https://example.com" },
        ],
      }),
    ).toEqual([{ label: "쿠팡에서 찾기", url: "https://www.coupang.com/np/search?q=a" }]);
    expect(shortcutsOf({})).toEqual([]);
  });

  it("질문 7은 혜택 카드 아래로 옮기고, 혜택 검색 중에는 그리지 않는다", () => {
    const messages = [ai(1, "question", "benefits"), ai(2, "question", "refs"), ai(3, "search", "benefits"), ai(4, "search", "benefits")];
    expect(arrangeMessages(messages, false).map((message) => message.seq)).toEqual([1, 3, 4, 2]);
    // 검색 중이고 카드가 아직 없으면 질문 7을 숨긴다.
    const early = [ai(1, "question", "benefits"), ai(2, "question", "refs")];
    expect(arrangeMessages(early, true).map((message) => message.seq)).toEqual([1]);
    // 검색이 끝났는데 카드가 끝내 없으면(실패) 제자리에 보인다.
    expect(arrangeMessages(early, false).map((message) => message.seq)).toEqual([1, 2]);
    // 질문 7이 없으면 그대로.
    expect(arrangeMessages([ai(1, "question", "model")], true)).toHaveLength(1);
  });

  it("보낸 뒤에 오는 빈 대화 응답도 화면이 쓸 수 있게 채운다", () => {
    const view = normalizeView({ stage: "sent", messages: [], slots: {}, photos: [], extras: [], pending: {} });
    expect(view).toMatchObject({ stage: "sent", sessionId: "", version: 0, purchase: "unset", review: {}, verified: false });
  });

  it("서버 오류 이유를 글로 바꾼다(빠진 칸, 막힌 이유, 모르는 이유는 기본 글)", () => {
    expect(missingText(["purchase", "model", "photo", "other"])).toBe("구매 여부, 기종, 구매 인증 사진");
    expect(failureText("send", 409, "missing_required", { missing: ["model", "pros"] }, "x")).toContain("기종, 장점");
    expect(failureText("review", 409, "not_ready", {}, "x")).toContain("질문 7");
    expect(failureText("photo", 429, "photo_cap", {}, "x")).toContain("사진 횟수");
    expect(failureText("turn", 429, "rate_limited", {}, "x")).toContain("요청이 많아요");
    expect(failureText("photo", 413, "image_too_large", {}, "x")).toContain("너무 커요");
    expect(failureText("turn", 500, "internal_error", {}, "기본 글")).toBe("기본 글");
    expect(reasonsOf({ reasons: ["가", 3, "", "나"] })).toEqual(["가", "나"]);
  });
});

describe("지금 눌러 답할 수 있는 빠른 답(activeQuick)", () => {
  const skip = { quick: [{ id: "skip.refs", label: "건너뛰기" }] };
  const msg = (seq: number, role: ChatMessage["role"], tag: string | null, body: Record<string, unknown> = {}): ChatMessage => ({
    seq,
    role,
    tag,
    slot: tag === "question" ? "refs" : null,
    body,
  });

  it("안내·칸 채움·검색 말풍선과 봉사자 말을 지나 가장 가까운 질문의 빠른 답을 찾는다", () => {
    const messages = [msg(1, "ai", "question", skip), msg(2, "volunteer", null, { text: "확인했어요" }), msg(3, "ai", "notice", { text: "확인했어요" })];
    expect(activeQuick(messages).map((reply) => reply.id)).toEqual(["skip.refs"]);
  });

  it("빠른 답이 없는 질문에서 멈추고(위 질문의 빠른 답을 되살리지 않는다), 안내 말풍선의 확인 버튼은 그대로 쓴다", () => {
    const older = msg(1, "ai", "question", skip);
    const plain = msg(2, "ai", "question", { text: "?" });
    expect(activeQuick([older, plain])).toEqual([]);
    const confirm = msg(3, "ai", "notice", { quick: [{ id: "confirm.yes", label: "넣기" }, { id: "confirm.no", label: "아니요" }] });
    expect(activeQuick([older, plain, confirm]).map((reply) => reply.id)).toEqual(["confirm.yes", "confirm.no"]);
    expect(activeQuick([])).toEqual([]);
  });
});

describe("혜택 검색이 빠졌는지(needsBenefitsSearch)", () => {
  const filled = { value: "카드 할인", status: "filled" as const, by: "volunteer" as const };
  const benefitsCard: ChatMessage = { seq: 5, role: "ai", tag: "search", slot: "benefits", body: { kind: "benefits", items: [] } };

  it("혜택 칸이 채워지거나 건너뛰어졌는데 혜택 카드가 대화에 없으면 true", () => {
    expect(needsBenefitsSearch({ slots: { benefits: filled }, messages: [question(1, "model")] })).toBe(true);
    expect(needsBenefitsSearch({ slots: { benefits: { ...filled, status: "skipped" } }, messages: [] })).toBe(true);
    expect(needsBenefitsSearch({ slots: { benefits: { ...filled, status: "confirmed" } }, messages: [] })).toBe(true);
  });

  it("칸이 비었거나 혜택 카드가 이미 있으면 false", () => {
    expect(needsBenefitsSearch({ slots: {}, messages: [] })).toBe(false);
    expect(needsBenefitsSearch({ slots: { benefits: filled }, messages: [question(1, "refs"), benefitsCard] })).toBe(false);
  });

  it("다른 칸의 검색 결과(기종·대안)는 혜택 카드로 세지 않는다", () => {
    const modelCard: ChatMessage = { seq: 2, role: "ai", tag: "search", slot: "model", body: { kind: "text", text: "후보" } };
    expect(needsBenefitsSearch({ slots: { benefits: filled }, messages: [modelCard] })).toBe(true);
  });
});

describe("mergeView: GET ?after가 주지 않는 사진 썸네일을 지킨다", () => {
  const base = normalizeView({ sessionId: "s", version: 1, lastSeq: 2, photos: [{ id: "p1", thumb: "data:image/jpeg;base64,AAA", description: null }] });

  it("같은 id의 사진은 이미 가진 썸네일을 남기고, 새 값에 썸네일이 있으면 그것을 쓴다", () => {
    const incoming = normalizeView({
      sessionId: "s",
      version: 2,
      lastSeq: 3,
      photos: [{ id: "p1", description: "설명" }, { id: "p2", thumb: "data:image/jpeg;base64,BBB" }],
    });
    const merged = mergeView(base, incoming);
    expect(merged.photos).toEqual([
      { id: "p1", description: "설명", thumb: "data:image/jpeg;base64,AAA" },
      { id: "p2", thumb: "data:image/jpeg;base64,BBB" },
    ]);
    expect(merged.version).toBe(2);
  });

  it("처음 보는 사진에 썸네일이 없으면 없는 채로 둔다(자리 표시가 나온다)", () => {
    const merged = mergeView(base, normalizeView({ sessionId: "s", version: 2, photos: [{ id: "p9" }] }));
    expect(merged.photos).toEqual([{ id: "p9" }]);
  });

  it("메시지는 seq로 합치고 lastSeq는 큰 쪽을 쓴다", () => {
    const prev = normalizeView({ sessionId: "s", lastSeq: 1, messages: [question(1, "model")] });
    const merged = mergeView(prev, normalizeView({ sessionId: "s", lastSeq: 3, messages: [question(3, "alts")] }));
    expect(merged.messages.map((message) => message.seq)).toEqual([1, 3]);
    expect(merged.lastSeq).toBe(3);
  });
});
