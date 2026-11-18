import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasForbidden } from "@/lib/researchCheck";
import {
  buildReviewMaterial,
  buildTemplateReview,
  reviewInstructions,
  reviewKnownMaterial,
  writeReview,
  type ReviewSource,
} from "@/lib/researchReview";
import type { ResearchView, SlotState } from "@/lib/researchSession";
import type { RequestDetailsView } from "@/lib/volunteerView";

// 이용자 요청 브리핑(이용자조건)이 리뷰 문단 AI 자료에 들어가는 방식. 가짜 OpenAI로 호출 인자를 본다.

const { chatCreate } = vi.hoisted(() => ({ chatCreate: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    chat = { completions: { create: chatCreate } };
  }
  return { ...actual, default: FakeOpenAI, OpenAI: FakeOpenAI };
});

const filled = (value: string): SlotState => ({ value, status: "filled", by: "volunteer" });

function makeView(): ResearchView {
  return {
    sessionId: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
    volunteerId: "d-0000000000000001",
    purchase: "bought",
    slots: {
      model: filled("LH-200"),
      pros: filled("가벼워서 오래 써도 편해요"),
      photo: filled("1장"),
    },
    extras: [],
    counters: { asked: {}, reasked: {} },
    pending: {},
    review: {},
    version: 5,
    lastSeq: 12,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    photos: [{ id: "p1", description: null, seenModel: null, shot: null, createdAt: "2026-11-18T00:00:00.000Z" }],
    messages: [],
  };
}

const CONTEXT = { product: "헤드셋 찾아줘", brand: "Sony", item: "헤드셋" };
const sourceOf = (needs?: RequestDetailsView | null): ReviewSource => ({
  view: makeView(),
  context: needs === undefined ? CONTEXT : { ...CONTEXT, needs },
});

const NEEDS: RequestDetailsView = {
  summary: "소니 무선 헤드셋, 노이즈 캔슬링",
  qa: [
    { q: "어디에 쓰세요?", a: "출퇴근 지하철에서 써요" },
    { q: "무선이어야 하나요?", a: "네, 무선이요" },
    { q: "예산은 얼마인가요?", a: "십만 원 정도" },
  ],
};

describe("이용자조건(buildReviewMaterial)", () => {
  it("이용자 조건이 없으면 키 자체가 없다(기존 자료 그대로)", () => {
    for (const needs of [undefined, null]) {
      const material = buildReviewMaterial(sourceOf(needs));
      expect("이용자조건" in material).toBe(false);
    }
    expect(buildReviewMaterial(sourceOf({ summary: "", qa: [] }))).not.toHaveProperty("이용자조건");
  });

  it("요약과 문답을 거른 글로 넣고, 금액이 든 문답은 짝째 뺀다", () => {
    const material = buildReviewMaterial(sourceOf(NEEDS));
    expect(material.이용자조건).toEqual({
      요약: "소니 무선 헤드셋, 노이즈 캔슬링",
      답: ["어디에 쓰세요? → 출퇴근 지하철에서 써요", "무선이어야 하나요? → 네, 무선이요"],
    });
    expect(JSON.stringify(material)).not.toContain("십만");
  });

  it("전화번호·주소(링크)는 자료에 넣지 않는다", () => {
    const material = buildReviewMaterial(
      sourceOf({
        summary: "연락은 010-1234-5678 로, https://shop.example.com/a 에서 봤어요",
        qa: [{ q: "연락처는요?", a: "02-123-4567" }, { q: "어디서 봤나요?", a: "www.example.com 에서요" }],
      }),
    );
    const text = JSON.stringify(material.이용자조건);
    expect(text).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
    expect(text).not.toMatch(/https?:|www\.|example\.com/);
  });

  it("답은 6개까지만 넣는다", () => {
    const qa = Array.from({ length: 9 }, (_, i) => ({ q: `질문 ${i}`, a: `답 ${i}` }));
    expect(buildReviewMaterial(sourceOf({ summary: "요약", qa })).이용자조건?.답).toHaveLength(6);
  });

  it("틀 문단은 이용자조건과 상관없이 같다(새 정보를 더하지 않는다)", () => {
    expect(buildTemplateReview(buildReviewMaterial(sourceOf(NEEDS)))).toBe(buildTemplateReview(buildReviewMaterial(sourceOf())));
  });

  it("이용자가 말한 기종 이름이 문단 검사의 근거 글에 들어간다", () => {
    const known = reviewKnownMaterial(sourceOf({ summary: "WH-1000XM6을 찾아요", qa: [{ q: "기종이 있나요?", a: "WH-1000XM6이요" }] }));
    expect(known.join(" ")).toContain("WH-1000XM6");
    expect(reviewKnownMaterial(sourceOf()).join(" ")).not.toContain("WH-1000XM6");
  });

  it("지시문에 이용자조건 규칙이 있고 그 줄에는 금지 표현이 없다(금액은 쓰지 않는다는 말만 든다)", () => {
    const instructions = reviewInstructions();
    expect(instructions).toContain("이용자조건은 이용자가 말로 바란 것이고 사실이 아니다");
    expect(instructions).toContain("이용자조건에 없는 바람을 지어내지 않는다");
    const line = instructions.split("\n").find((entry) => entry.includes("이용자조건"))!;
    expect(hasForbidden(line)).toBe(false);
  });
});

describe("writeReview 호출 인자", () => {
  const GOOD =
    "LH-200은 봉사자가 직접 구매해 쓰고 사진으로 인증한 헤드셋이에요. 가벼워서 오래 써도 편하다고 해요. 구매 인증 사진은 한 장 올라와 있어요. 이용자가 바란 조건 가운데 봉사자가 확인하지 못한 것은 확인하지 못했다고 밝혀요. 이 내용은 봉사자가 모은 자료를 정리한 것이라서 최신 판매 정보는 쇼핑몰에서 직접 확인해 주세요.";

  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    vi.stubEnv("OPENAI_STORE_LOGS", "");
    chatCreate.mockReset();
    chatCreate.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ text: GOOD }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("이용자조건이 든 호출은 store:false이고 metadata를 붙이지 않는다. 자료에 이용자조건이 실린다", async () => {
    const source = sourceOf(NEEDS);
    const written = await writeReview(buildReviewMaterial(source), reviewKnownMaterial(source));
    expect(written.text).toBe(GOOD);
    expect(chatCreate).toHaveBeenCalledTimes(1);
    const params = chatCreate.mock.calls[0][0] as { store?: boolean; metadata?: unknown; messages: { role: string; content: string }[] };
    expect(params.store).toBe(false);
    expect(params).not.toHaveProperty("metadata");
    const user = params.messages.find((message) => message.role === "user")!.content;
    expect(user).toContain("이용자조건");
    expect(user).toContain("출퇴근 지하철에서 써요");
    expect(user).not.toContain("십만");
  });

  it("이용자조건이 없으면 지금처럼 store:true와 metadata(feature=research_review)다", async () => {
    const source = sourceOf();
    await writeReview(buildReviewMaterial(source), reviewKnownMaterial(source));
    const params = chatCreate.mock.calls[0][0] as { store?: boolean; metadata?: unknown; messages: { role: string; content: string }[] };
    expect(params.store).toBe(true);
    expect(params.metadata).toEqual({ app: "lighthouse", feature: "research_review" });
    expect(params.messages.find((message) => message.role === "user")!.content).not.toContain("이용자조건");
  });

  it("OPENAI_STORE_LOGS=off여도 이용자조건이 있으면 store:false다", async () => {
    vi.stubEnv("OPENAI_STORE_LOGS", "off");
    const source = sourceOf(NEEDS);
    await writeReview(buildReviewMaterial(source), reviewKnownMaterial(source));
    expect((chatCreate.mock.calls[0][0] as { store?: boolean }).store).toBe(false);
  });
});
