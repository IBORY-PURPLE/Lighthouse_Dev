import { describe, expect, it } from "vitest";
import { hasForbidden } from "@/lib/researchCheck";
import {
  buildReviewMaterial,
  buildTemplateReview,
  checkReviewText,
  confirmedBenefits,
  mockReviewText,
  reviewKnownMaterial,
  type ReviewSource,
} from "@/lib/researchReview";
import { buildResultFromSession } from "@/lib/researchResult";
import type { ResearchView, SlotState } from "@/lib/researchSession";
import { checkCandidate, RESULT_LIMITS } from "@/lib/resultInput";

// 검증 리뷰의 순수 부분: 문단 검사(AI·고친 문단), 서버 틀 문단, 결과 만들기(buildResultFromSession).

const filled = (value: string, extra: Partial<SlotState> = {}): SlotState => ({
  value,
  status: "filled",
  by: "volunteer",
  ...extra,
});

function makeView(overrides: Partial<ResearchView> = {}): ResearchView {
  return {
    sessionId: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
    volunteerId: "d-0000000000000001",
    purchase: "bought",
    slots: {
      model: filled("LH-200"),
      pros: filled("가벼워서 오래 써도 편해요"),
      photo: filled("1장"),
      alts: filled("LH-300"),
      altReason: filled("배터리가 더 오래간다고 해서 같이 봤어요"),
    },
    extras: [],
    counters: { asked: {}, reasked: {} },
    pending: {},
    review: {},
    version: 5,
    lastSeq: 12,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    photos: [{ id: "p1", description: null, seenModel: null, shot: null, createdAt: "2026-11-17T00:00:00.000Z" }],
    messages: [],
    ...overrides,
  };
}
const context = { product: "헤드셋 찾아줘", brand: "Sony", item: "헤드셋" };
const sourceOf = (view: ResearchView): ReviewSource => ({ view, context });

const GOOD_AI =
  "LH-200은 봉사자가 직접 구매해 쓰고 사진으로 인증한 헤드셋이에요. 가벼워서 오래 써도 편하다고 해요. 같이 고민한 제품은 LH-300이고 배터리가 더 오래간다고 해서 비교했어요. 구매 인증 사진은 한 장 올라와 있어요. 이 내용은 봉사자가 모은 자료를 정리한 것이라서 최신 판매 정보는 쇼핑몰에서 직접 확인해 주세요.";

describe("checkReviewText", () => {
  const known = ["LH-200", "LH-300", "헤드셋"];

  it("좋은 AI 문단은 통과한다", () => {
    expect(checkReviewText(GOOD_AI, known, "ai")).toEqual([]);
  });

  it("가격·재고·할인 표현은 걸리고 어느 문장인지 보인다", () => {
    for (const bad of ["이 제품은 29,000원이에요.", "지금 재고가 많아요.", "카드로 10% 할인을 받았어요.", "최저가로 샀어요."]) {
      const reasons = checkReviewText(`${GOOD_AI} ${bad}`, known, "ai");
      expect(reasons.some((reason) => reason.startsWith("가격·재고·할인")), bad).toBe(true);
      expect(checkReviewText(`${GOOD_AI} ${bad}`, known, "edit").length, bad).toBeGreaterThan(0);
    }
  });

  it("자료에 없는 기종 이름은 걸리고 자료에 있는 이름은 통과한다", () => {
    const reasons = checkReviewText(`${GOOD_AI} WH-1000XM9도 좋아요.`, known, "ai");
    expect(reasons.join(" ")).toContain("WH-1000XM9");
    expect(checkReviewText(GOOD_AI, ["헤드셋"], "ai").join(" ")).toContain("LH-200");
  });

  it("주소(링크)는 걸린다", () => {
    expect(checkReviewText(`${GOOD_AI} https://example.com/a 를 보세요.`, known, "ai")).toContain("주소(링크)는 문단에 넣지 않아요.");
    expect(checkReviewText(`${GOOD_AI} www.example.com 에서 봤어요.`, known, "edit")).toContain("주소(링크)는 문단에 넣지 않아요.");
  });

  it("AI 문단은 길이(150~700자)·문장 수(3~7)·목록 기호를 본다", () => {
    expect(checkReviewText("LH-200은 좋아요.", known, "ai").length).toBeGreaterThan(1);
    expect(checkReviewText(GOOD_AI + " 한 문장이 더 있어요.".repeat(10), known, "ai").join(" ")).toContain("문장");
    expect(checkReviewText(`- ${GOOD_AI}`, known, "ai")).toContain("목록이나 기호가 들어 있어요.");
    expect(checkReviewText("가".repeat(701), known, "ai").join(" ")).toContain("150~700자");
  });

  it("고친 문단은 50~1,000자이고 전화번호 모양을 걸러낸다", () => {
    const edit = `LH-200은 가벼워서 오래 써도 편한 헤드셋이에요. 같이 본 LH-300은 배터리가 더 오래간대요. 최신 판매 정보는 쇼핑몰에서 확인해 주세요.`;
    expect(checkReviewText(edit, known, "edit")).toEqual([]);
    // 문장 수(3~7)와 목록·기호는 고친 문단에도 건다
    expect(checkReviewText("LH-200은 가벼워서 오래 써도 편한 헤드셋이고 소리도 선명하며 같이 본 LH-300보다 착용감이 좋다고 해요", known, "edit")[0]).toContain("문장이");
    expect(checkReviewText(`${edit}
- 가볍다`, known, "edit").join(" ")).toContain("목록이나 기호");
    expect(checkReviewText("짧아요.", known, "edit")[0]).toContain("50자 이상");
    expect(checkReviewText("가".repeat(1001), known, "edit")[0]).toContain("1,000자 이하");
    for (const phone of ["010-1234-5678", "01012345678", "02 123 4567", "+82 10 1234 5678", "1588-1234"]) {
      expect(checkReviewText(`${edit} 전화는 ${phone} 이에요.`, known, "edit"), phone).toContain("전화번호처럼 보이는 숫자는 넣지 않아요.");
    }
    // 기종 번호와 사양 숫자는 전화번호가 아니다.
    expect(checkReviewText(`${edit} 배터리는 30시간이고 모델 번호는 1000 시리즈예요.`, known, "edit")).toEqual([]);
  });
});

describe("서버 틀 문단", () => {
  it("구매 인증됨: 사진 장수와 같이 고민한 제품을 말하고 두 검사를 모두 통과한다", () => {
    const view = makeView();
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(text).toContain("LH-200");
    expect(text).toContain("사진으로 인증");
    expect(text).toContain("구매 인증 사진은 1장");
    expect(text).toContain("LH-300");
    const known = reviewKnownMaterial(sourceOf(view));
    expect(checkReviewText(text, known, "ai")).toEqual([]);
    expect(checkReviewText(text, known, "edit")).toEqual([]);
  });

  it("칸 값이 여러 문장이어도 틀 문단은 edit 검사를 통과한다(검수 마치기만 눌러도 422가 나지 않는다)", () => {
    const multi = "첫째 좋아요. 둘째도 좋아요! 셋째는 어때요? 넷째도 있어요. 다섯째까지 있어요.";
    const view = makeView({
      slots: {
        model: filled("LH-200. 새 제품이에요. 색은 검정이에요."),
        pros: filled(multi),
        photo: filled("1장"),
        alts: filled("LH-300, LH-400"),
        altReason: filled(multi),
        benefits: filled(multi),
      },
    });
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(checkReviewText(text, reviewKnownMaterial(sourceOf(view)), "edit")).toEqual([]);
    expect(text).toContain("첫째 좋아요");
    expect(text).not.toContain("둘째");
    expect(text).not.toContain("(");
  });

  it("칸 값에 기호·도메인 이름이 있어도 틀 문단은 edit 검사를 통과한다", () => {
    const view = makeView({
      slots: {
        model: filled("LH-200"),
        pros: filled("가볍고 좋아요 # 추천해요 * 최고 | 조용해요 `코드` shop.com에서 봤어요"),
        photo: filled("1장"),
        altReason: filled("> 인용처럼 썼어요 _강조_"),
      },
    });
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(checkReviewText(text, reviewKnownMaterial(sourceOf(view)), "edit")).toEqual([]);
    expect(text).toContain("가볍고 좋아요");
  });

  it("장점·고른 이유가 주소뿐이라 비어도 틀 문단은 3문장 이상이고 edit 검사를 통과한다", () => {
    const view = makeView({
      purchase: "research",
      slots: { model: filled("LH-200"), pros: filled("https://blog.example.com/a"), altReason: filled("example.edu/page") },
      photos: [],
    });
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(checkReviewText(text, reviewKnownMaterial(sourceOf(view)), "edit")).toEqual([]);
    expect(text).not.toContain("example");
  });

  it("점 하나로 이어진 도메인 이름(example.edu 등)도 주소로 걸린다", () => {
    expect(checkReviewText(`${"가".repeat(60)}. 자세한 건 example.edu 에서 봐요. 둘째예요. 셋째예요.`, [], "edit").join(" ")).toContain("주소");
  });

  it("AI 문단에도 전화번호 모양은 걸린다", () => {
    const known = ["LH-200"];
    const text = `${GOOD_AI.replace("LH-300이고", "LH-200이고")} 문의는 010-1234-5678이에요.`;
    expect(checkReviewText(text, known, "ai").join(" ")).toContain("전화번호");
  });

  it("틀 문단이 7문장·1,000자를 넘으려 하면 선택 문장부터 뺀다", () => {
    const long = "가".repeat(110);
    const view = makeView({
      slots: {
        model: filled("L".repeat(95)),
        pros: filled(long),
        photo: filled("1장"),
        alts: filled(`${"A".repeat(90)}, ${"B".repeat(90)}`),
        altReason: filled(long),
        benefits: filled(long),
      },
    });
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(checkReviewText(text, reviewKnownMaterial(sourceOf(view)), "edit")).toEqual([]);
    expect(text).toContain("최신 판매 정보는 쇼핑몰에서 직접 확인");
  });

  it("문장 수 이유에 지금 문장 수가 들어 있다", () => {
    const reasons = checkReviewText("하나예요. 둘이에요.", [], "ai");
    expect(reasons.join(" ")).toContain("지금 2개예요");
  });

  it("리서치만이면 인증 표현이 없고 사지 않고 알아본 제품이라고 밝힌다", () => {
    const view = makeView({
      purchase: "research",
      slots: { model: filled("LH-200"), pros: filled("소리가 선명하대요"), altReason: filled("가격 대신 기능을 비교했어요") },
      photos: [],
    });
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(text).toContain("사지 않고 알아본");
    expect(text).not.toContain("인증");
  });

  it("봉사자가 쓴 칸에 가격·주소·전화번호가 있으면 그 부분은 문단에 넣지 않는다", () => {
    const view = makeView({
      slots: {
        model: filled("LH-200"),
        pros: filled("가벼워요. 2만 9천원에 샀어요. https://shop.example.com/x 에서 봤고 010-1234-5678로 물어봤어요."),
        photo: filled("1장"),
        altReason: filled("그냥 이 제품이 마음에 들었어요"),
        benefits: filled("카드 10% 할인을 받았어요"),
      },
    });
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(text).toContain("가벼워요");
    expect(hasForbidden(text)).toBe(false);
    expect(checkReviewText(text, reviewKnownMaterial(sourceOf(view)), "edit")).toEqual([]);
    expect(text).not.toContain("https");
    expect(text).not.toContain("010");
  });

  it("혜택을 건너뛰면 없었다고 말하고, 확인한 혜택은 종류·조건만 말한다", () => {
    const view = makeView({
      slots: { ...makeView().slots, benefits: filled("카드 혜택 있었어요", { links: ["https://card.example.com/a"] }) },
      messages: [
        {
          seq: 3,
          role: "ai",
          tag: "search",
          slot: "benefits",
          body: {
            kind: "benefits",
            items: [
              { title: "카드 안내", kind: "카드 혜택", condition: "특정 카드로 결제할 때", url: "https://card.example.com/a?utm_source=x", mode: "check" },
              { title: "쿠폰 안내", kind: "쿠폰", condition: "첫 구매", url: "https://coupon.example.com/b", mode: "check" },
            ],
          },
        },
      ],
    });
    // 확인한(링크가 칸에 있는) 항목만 든다.
    expect(confirmedBenefits(view)).toEqual([{ kind: "카드 혜택", condition: "특정 카드로 결제할 때" }]);
    const text = buildTemplateReview(buildReviewMaterial(sourceOf(view)));
    expect(text).toContain("카드 혜택, 조건은 특정 카드로 결제할 때");
    expect(text).not.toContain("쿠폰");
    const skipped = makeView({ slots: { ...makeView().slots, benefits: { value: "", status: "skipped", by: "volunteer" } } });
    expect(buildTemplateReview(buildReviewMaterial(sourceOf(skipped)))).toContain("없었어요");
  });

  it("가짜 AI 문단도 150자 이상이고 검사를 통과한다", () => {
    const view = makeView();
    const text = mockReviewText(buildReviewMaterial(sourceOf(view)));
    expect(checkReviewText(text, reviewKnownMaterial(sourceOf(view)), "ai")).toEqual([]);
  });
});

describe("buildResultFromSession", () => {
  const confirmed = "LH-200은 직접 구매해 사진으로 인증한 헤드셋이에요. 가벼워서 오래 써도 편하다고 해요.";

  it("후보 1은 기종·리뷰 문단·기존 요약 항목, 후보 2는 같이 고민한 제품이고 resultInput 한도 안이다", () => {
    const view = makeView({
      slots: {
        ...makeView().slots,
        alts: filled("LH-300, LH-400"),
        benefits: filled("카드 혜택 있었어요", { links: ["https://card.example.com/a", "https://card.example.com/b", "https://card.example.com/c"] }),
        refs: filled("블로그 글", { links: ["https://blog.example.com/p"] }),
      },
      review: { status: "confirmed", text: confirmed, rev: 2, confirmedVersion: 5 },
    });
    const candidates = buildResultFromSession(view);
    expect(candidates).toHaveLength(3);
    expect(candidates[0].name).toBe("LH-200");
    expect(candidates[0].guide).toBe(confirmed);
    const labels = candidates[0].summary.map((entry) => entry.label);
    expect(labels).toEqual(expect.arrayContaining(["구분", "구매 인증", "장점", "사진", "같이 고민한 제품", "고민한 이유", "혜택", "혜택 링크 1", "혜택 링크 2", "참고 글", "참고 링크 1"]));
    expect(labels).not.toContain("혜택 링크 3");
    expect(candidates[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("구매 인증됨");
    expect(candidates[0].summary.find((entry) => entry.label === "사진")?.value).toBe("1장");
    expect(candidates[0].summary.find((entry) => entry.label === "혜택 링크 1")?.value).toBe("card.example.com https://card.example.com/a");
    expect(candidates[0].summary.length).toBeLessThanOrEqual(RESULT_LIMITS.summaryMax);
    expect(candidates.slice(1).map((entry) => entry.name)).toEqual(["LH-300", "LH-400"]);
    expect(candidates[1].summary[0]).toEqual({ label: "구분", value: "같이 고민한 제품" });
    for (const candidate of candidates) expect(checkCandidate(candidate).ok, candidate.name).toBe(true);
  });

  it("구매했지만 사진 인증이 안 됐으면 '구매했지만 사진 인증 안 됨'이고, 리서치만이면 사진 줄이 없다", () => {
    const pendingCheck = buildResultFromSession(
      makeView({ pending: { mismatch: { slot: "photo" } }, review: { status: "confirmed", text: confirmed, rev: 1, confirmedVersion: 5 } }),
    );
    expect(pendingCheck[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("구매했지만 사진 인증 안 됨");
    const researchWithPhoto = buildResultFromSession(
      makeView({ purchase: "research", review: { status: "confirmed", text: confirmed, rev: 1, confirmedVersion: 5 } }),
    );
    const labels = researchWithPhoto[0].summary.map((entry) => entry.label);
    expect(researchWithPhoto[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("리서치만");
    expect(labels).not.toContain("사진");
  });

  it("참고 링크를 확인해 칸 값이 그 주소가 되면 '참고 글'에 같은 주소를 또 넣지 않는다", () => {
    const url = "https://blog.example.com/review";
    const candidates = buildResultFromSession(
      makeView({
        slots: {
          model: filled("LH-200"), pros: filled("편해요"), photo: filled("1장"), altReason: filled("그냥요"),
          refs: { value: url, status: "filled", by: "volunteer", links: [url] },
        },
        review: { status: "confirmed", text: confirmed, rev: 1, confirmedVersion: 5 },
      }),
    );
    const labels = candidates[0].summary.map((entry) => entry.label);
    expect(labels).not.toContain("참고 글");
    expect(labels).toContain("참고 링크 1");
  });

  it("리서치만이면 구매 인증이 아니라 리서치만이고, 건너뛴 칸은 요약에 없다", () => {
    const view = makeView({
      purchase: "research",
      slots: {
        model: filled("LH-200"),
        pros: filled("소리가 선명해요"),
        alts: { value: "", status: "skipped", by: "volunteer" },
        altReason: filled("이 제품이 제일 알려져 있어요"),
      },
      photos: [],
      review: { status: "confirmed", text: confirmed, rev: 1, confirmedVersion: 5 },
    });
    const candidates = buildResultFromSession(view);
    expect(candidates).toHaveLength(1);
    const labels = candidates[0].summary.map((entry) => entry.label);
    expect(candidates[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("리서치만");
    expect(labels).not.toContain("사진");
    expect(labels).not.toContain("같이 고민한 제품");
    expect(checkCandidate(candidates[0]).ok).toBe(true);
  });

  it("리뷰 문단은 1,000자로, 이름은 100자로 자른다. 기종이 비었으면 빈 목록", () => {
    const long = makeView({
      slots: { ...makeView().slots, model: filled("가".repeat(150).slice(0, 150)) },
      review: { status: "confirmed", text: "나".repeat(1200), rev: 1, confirmedVersion: 5 },
    });
    const [first] = buildResultFromSession(long);
    expect([...first.name].length).toBeLessThanOrEqual(RESULT_LIMITS.nameMax);
    expect([...first.guide].length).toBeLessThanOrEqual(RESULT_LIMITS.guideMax);
    expect(checkCandidate(first).ok).toBe(true);
    expect(buildResultFromSession(makeView({ slots: {} }))).toEqual([]);
  });
});
