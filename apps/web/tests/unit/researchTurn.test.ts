import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, resetRequestStoresForTest, type RequestStore } from "@/lib/requestStore";
import { hasForbidden } from "@/lib/researchCheck";
import { createMemoryResearchStore, type ResearchActor } from "@/lib/researchStore";
import type { NextMessage, ResearchView, SlotKey } from "@/lib/researchSession";
import {
  buildCandidates,
  defaultGuide,
  evidenceMatches,
  isQuestionLike,
  parseTurnBody,
  planTurn,
  urlInText,
  validateAiTurn,
  type AiMode,
  type TurnInput,
} from "@/lib/researchTurn";
import * as text from "@/lib/researchTurnText";

// 대화 한 턴의 규칙(design.md 4.3~4.6). 가짜 AI 응답(검사를 거친 JSON)과 메모리 저장소로 질문 순서·대체 동작을 확인한다.
// 실제 AI는 tests/chatbot/research-turn.test.ts가 부른다.

const CONTEXT = { product: "소니 헤드셋 찾아줘", brand: "Sony", item: "헤드셋" };
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const SESSION_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseTurnBody", () => {
  const base = { clientTurnId: "t-1", sessionId: SESSION_ID, baseVersion: 0 };
  const ok = (input: unknown) => parseTurnBody({ ...base, input });

  it("글·빠른 답·칩·고치기·건너뛰기·링크 확인을 받는다", () => {
    expect(ok({ type: "text", text: "  가볍고 좋아요  " })).toMatchObject({ ok: true, body: { input: { type: "text", text: "가볍고 좋아요" } } });
    expect(ok({ type: "quick", replyId: "purchase.bought" }).ok).toBe(true);
    expect(ok({ type: "chip", slot: "model", value: "WH-CH720N" }).ok).toBe(true);
    expect(ok({ type: "edit", slot: "pros", text: "가벼워요" }).ok).toBe(true);
    expect(ok({ type: "skip", slot: "refs" }).ok).toBe(true);
    expect(ok({ type: "link_check", url: "https://example.com/a" }).ok).toBe(true);
    // skip.<칸> 빠른 답은 skip 입력과 같다.
    expect(ok({ type: "quick", replyId: "skip.alts" })).toMatchObject({ body: { input: { type: "skip", slot: "alts" } } });
  });

  it("본문이 틀리면 거부한다", () => {
    expect(parseTurnBody(null).ok).toBe(false);
    expect(parseTurnBody({ ...base, sessionId: "x", input: { type: "text", text: "a" } }).ok).toBe(false);
    expect(parseTurnBody({ ...base, baseVersion: -1, input: { type: "text", text: "a" } }).ok).toBe(false);
    expect(parseTurnBody({ ...base, baseVersion: 1.5, input: { type: "text", text: "a" } }).ok).toBe(false);
    expect(parseTurnBody({ ...base, clientTurnId: "", input: { type: "text", text: "a" } }).ok).toBe(false);
    expect(ok({ type: "text", text: "   " }).ok).toBe(false);
    expect(ok({ type: "text", text: "가".repeat(1001) }).ok).toBe(false);
    expect(ok({ type: "text", text: "가".repeat(1000) }).ok).toBe(true);
    expect(ok({ type: "quick", replyId: "nope" }).ok).toBe(false);
    expect(ok({ type: "chip", slot: "pros", value: "x" }).ok).toBe(false);
    expect(ok({ type: "skip", slot: "photo" }).ok).toBe(false);
    expect(ok({ type: "edit", slot: "photo", text: "x" }).ok).toBe(false);
    expect(ok({ type: "link_check", url: "http://example.com" }).ok).toBe(false);
    expect(ok({ type: "other" }).ok).toBe(false);
  });

  it("고치기 글에서 금지 표현 문장은 지우고, 다 지워지면 거부한다", () => {
    expect(ok({ type: "edit", slot: "pros", text: "가벼워요. 19,900원이에요." })).toMatchObject({
      body: { input: { text: "가벼워요." } },
    });
    expect(ok({ type: "edit", slot: "pros", text: "19,900원이에요." }).ok).toBe(false);
  });
});

describe("evidenceMatches (b)안", () => {
  const said = "저는 WH-CH720N을 샀고 가볍고 귀가 덜 아파요!";
  it("정규화한 부분 문자열이면 통과한다(공백·문장부호·대소문자 무시)", () => {
    expect(evidenceMatches("가볍고 귀가 덜 아파요", said)).toBe(true);
    expect(evidenceMatches("가볍고귀가덜아파요", said)).toBe(true);
    expect(evidenceMatches("wh-ch720n 을 샀고", said)).toBe(true);
  });
  it("끝 조사를 뗀 낱말의 80% 이상이 말에 있으면 통과한다", () => {
    expect(evidenceMatches("720N이 가볍고 귀가 덜 아파요", said)).toBe(true);
    expect(evidenceMatches("WH-CH720N을 샀어요", said)).toBe(false);
  });
  it("말에 없거나 너무 짧으면 거부한다", () => {
    expect(evidenceMatches("배터리가 오래가요", said)).toBe(false);
    expect(evidenceMatches("요", said)).toBe(false);
    expect(evidenceMatches("", said)).toBe(false);
  });
});

describe("isQuestionLike", () => {
  it("의문형·부탁형은 묻는 말로 본다", () => {
    for (const line of ["어디서 찾아요?", "찾는 방법 알려줘", "소니 헤드셋 추천해줘", "재고 있나요", "뭐가 좋을까요"]) {
      expect(isQuestionLike(line), line).toBe(true);
    }
    for (const line of ["가볍고 귀가 덜 아파요", "WH-CH720N이요", "카드 할인 받았어요"]) {
      expect(isQuestionLike(line), line).toBe(false);
    }
  });
  it("'나요'·'가요'로 끝나는 평서문(오래가요·잘 나요·들어가요)은 묻는 말이 아니다", () => {
    for (const line of ["배터리가 오래가요", "소리가 잘 나요", "가방에 쏙 들어가요", "티가 안 나요", "음질 차이가 나요", "손이 자주 가요"]) {
      expect(isQuestionLike(line), line).toBe(false);
      expect(isQuestionLike(line, true), line).toBe(false);
    }
    // 의문 어미는 그대로 묻는 말이다.
    for (const line of ["좋은가요", "뭔가요", "큰가요", "되나요", "재고 있어", "가격 얼마야", "어디서 사요"]) {
      expect(isQuestionLike(line), line).toBe(true);
    }
  });
  it("AI가 읽은 뒤에는 물음표와 부탁형만 정규식으로 본다(나머지는 AI의 ask_back을 따른다)", () => {
    expect(isQuestionLike("재고 있나요", true)).toBe(false);
    expect(isQuestionLike("어디서 찾아요?", true)).toBe(true);
    expect(isQuestionLike("찾는 방법 알려줘", true)).toBe(true);
  });
});

describe("validateAiTurn", () => {
  const input = { text: "WH-CH720N 샀어요. 가볍고 좋아요", material: ["WH-CH720N 샀어요. 가볍고 좋아요", "소니 헤드셋 찾아줘"], purchase: "unset" as const };
  it("evidence가 말에 있는 칸만 받고 하나라도 버리면 dropped", () => {
    const turn = validateAiTurn(
      {
        intent: "reply",
        fills: [
          { slot: "model", value: "WH-CH720N", evidence: "WH-CH720N 샀어요" },
          { slot: "pros", value: "가벼워요", evidence: "배터리 오래가요" },
        ],
        purchase: { value: "bought", evidence: "WH-CH720N 샀어요" },
      },
      input,
      CONTEXT,
    );
    expect(turn?.fills).toEqual([{ slot: "model", value: "WH-CH720N" }]);
    expect(turn?.purchase).toBe("bought");
    expect(turn?.dropped).toBe(true);
  });
  it("자료에 없는 기종 번호는 버린다", () => {
    const turn = validateAiTurn(
      { intent: "reply", fills: [{ slot: "model", value: "XM-9999", evidence: "WH-CH720N 샀어요" }] },
      input,
      CONTEXT,
    );
    expect(turn?.fills).toEqual([]);
    expect(turn?.dropped).toBe(true);
  });
  it("photo 칸과 ask_extra는 받지 않는다", () => {
    const turn = validateAiTurn(
      {
        intent: "reply",
        fills: [{ slot: "photo", value: "1장", evidence: "WH-CH720N 샀어요" }],
        next: { action: "ask_extra", slot: null, text: "더 있어요?" },
      },
      input,
      CONTEXT,
    );
    expect(turn?.fills).toEqual([]);
    expect(turn?.next).toBeNull();
  });
  it("다음 질문 글에 금지 표현이 있으면 그 글을 버린다", () => {
    const turn = validateAiTurn(
      { intent: "reply", fills: [], next: { action: "ask_slot", slot: "pros", text: "19,900원에 샀나요?" } },
      input,
      CONTEXT,
    );
    expect(turn?.next?.text).toBeNull();
    expect(turn?.dropped).toBe(true);
  });
  it("JSON이 아니면 null(대체 동작)", () => {
    expect(validateAiTurn(null, input, CONTEXT)).toBeNull();
  });
  it("묻는 말 guide의 빈 부분은 기본 찾는 방법으로 채운다", () => {
    const turn = validateAiTurn({ intent: "ask_back", fills: [], guide: { queries: ["최저가 얼마"], checks: [], steps: ["공식 페이지를 연다"] } }, input, CONTEXT);
    expect(turn?.guide?.queries).toEqual(defaultGuide(CONTEXT).queries);
    expect(turn?.guide?.checks).toEqual(defaultGuide(CONTEXT).checks);
    expect(turn?.guide?.steps).toEqual(["공식 페이지를 연다"]);
  });
});

describe("서버 문장 상수", () => {
  it("모든 상수와 질문에 금지 표현이 없고 질문은 120자 이하다", () => {
    const strings = Object.entries(text)
      .filter(([, value]) => typeof value === "string")
      .map(([name, value]) => [name, value as string]);
    for (const [name, value] of strings) expect(hasForbidden(value), name).toBe(false);
    for (const purchase of ["bought", "research"] as const) {
      for (const slot of ["model", "pros", "photo", "alts", "altReason", "benefits", "refs"] as SlotKey[]) {
        for (const alts of [[], ["소니 WH-CH520"]]) {
          const question = text.turnQuestion(slot, { purchase, subject: "소니 헤드셋", model: "WH-CH720N", alts });
          expect(hasForbidden(question), `${slot} ${question}`).toBe(false);
          expect([...question].length, question).toBeLessThanOrEqual(120);
        }
      }
    }
    expect(text.turnQuestion("altReason", { purchase: "bought", subject: "", model: "WH-CH720N", alts: [] })).toBe(
      "WH-CH720N을(를) 고른 이유가 뭐예요?",
    );
    expect([...text.REASK_PREFIX + text.BENEFITS_QUESTION].length).toBeLessThanOrEqual(120);
  });
  it("CAP 문구는 요청 한도와 하루 한도가 다르다", () => {
    expect(text.CAP_REQUEST).not.toBe(text.CAP_DAILY);
    expect(text.CAP_REQUEST).toContain("이 요청");
    expect(text.CAP_DAILY).toContain("오늘");
  });
});

// ---- 메모리 저장소로 한 턴씩 돌리기 -------------------------------------------------------

let requests: RequestStore;
let research: ReturnType<typeof createMemoryResearchStore>;
let volSeq = 0;

interface Harness {
  actor: ResearchActor;
  view(): Promise<ResearchView>;
  /** 한 턴: begin → 계획 → apply. 새 메시지와 고른 질문 action을 돌려준다. */
  step(input: TurnInput, ai?: AiMode | Record<string, unknown>): Promise<{ messages: NextMessage[]; chosen: string | null; version: number; view: ResearchView }>;
  questions(): Promise<string[]>;
}

async function harness(): Promise<Harness> {
  const volunteerId = `d-${String(++volSeq).padStart(16, "0")}`;
  const reg = await requests.register({
    clientRequestId: crypto.randomUUID(),
    product: CONTEXT.product,
    budget: "10만 원",
    condition: "새 제품",
    brand: "Sony",
    item: "헤드셋",
    conditionKind: "new",
  });
  expect(await requests.claim(reg.requestId, volunteerId)).toBe("claimed");
  const opened = await research.open(reg.requestId, volunteerId);
  if (opened.outcome !== "ok") throw new Error(opened.outcome);
  const actor: ResearchActor = { requestId: reg.requestId, volunteerId, sessionId: opened.view.sessionId };
  let turn = 0;
  const view = async () => {
    const again = await research.open(actor.requestId, actor.volunteerId);
    if (again.outcome !== "ok") throw new Error(again.outcome);
    return again.view;
  };
  return {
    actor,
    view,
    async step(input, ai) {
      const before = await view();
      const clientTurnId = `t-${(turn += 1)}`;
      const begun = await research.begin({ ...actor, kind: "turn", clientTurnId, baseVersion: before.version });
      if (begun.outcome !== "ok") throw new Error(begun.outcome);
      const mode = resolveAi(input, ai, before);
      const plan = planTurn({ session: begun.session, input, context: CONTEXT, ai: mode });
      const applied = await research.apply({
        ...actor,
        clientTurnId,
        baseVersion: before.version,
        patch: plan.patch,
        messages: plan.messages,
        next: plan.next,
      });
      if (applied.outcome !== "ok") throw new Error(applied.outcome);
      return {
        messages: applied.response.messages as unknown as NextMessage[],
        chosen: applied.response.chosen,
        version: applied.response.version,
        view: await view(),
      };
    },
    async questions() {
      const current = await view();
      return current.messages.filter((message) => message.role === "ai" && message.tag === "question").map((message) => message.slot ?? "");
    },
  };
}

function resolveAi(input: TurnInput, ai: AiMode | Record<string, unknown> | undefined, before: ResearchView): AiMode {
  if (input.type !== "text") return { state: "none" };
  if (ai && "state" in ai) return ai as AiMode;
  const material = [input.text, CONTEXT.product, CONTEXT.brand, CONTEXT.item];
  const turn = validateAiTurn((ai as Record<string, unknown>) ?? null, { text: input.text, material, purchase: before.purchase }, CONTEXT);
  return turn ? { state: "ok", turn } : { state: "fallback" };
}

const say = (value: string): TurnInput => ({ type: "text", text: value });
const fill = (slot: SlotKey, value: string, evidence = value) => ({ slot, value, evidence });
const replyAi = (...fills: ReturnType<typeof fill>[]) => ({ intent: "reply", fills });
const bodyText = (message: NextMessage) => String(message.body.text ?? "");

beforeEach(() => {
  resetRequestStoresForTest();
  requests = createMemoryStore();
  research = createMemoryResearchStore(requests);
  volSeq = 0;
});
afterEach(() => research.close());

describe("질문 순서", () => {
  it("구매 → 기종 → 장점 → 사진 → 대안 → 이유 → 혜택 → 참고 글 → 리뷰 제안(구매함)", async () => {
    const h = await harness();
    const first = await h.step({ type: "quick", replyId: "purchase.bought" });
    expect(first.chosen).toBe("ask_slot");
    expect(first.messages.at(-1)).toMatchObject({ tag: "question", slot: "model" });
    expect(bodyText(first.messages.at(-1)!)).toBe(text.MODEL_QUESTION_BOUGHT);

    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    await h.step(say("가볍고 귀가 덜 아파요"), replyAi(fill("pros", "가볍고 귀가 덜 아파요")));
    expect(await h.questions()).toEqual(["model", "pros", "photo"]);

    // 사진은 올리기로만 채운다. 올리면 저장소가 다음 질문(대안)을 붙인다.
    const before = await h.view();
    const next = buildCandidates(before, "소니 헤드셋", { hold: false, aiNext: null, reask: null });
    const uploaded = await research.addPhoto({ ...h.actor, thumb: JPEG, messages: [], next });
    expect(uploaded.outcome).toBe("ok");
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("가벼워서요"), replyAi(fill("altReason", "가벼워서요")));
    await h.step(say("카드 할인을 받았어요"), replyAi(fill("benefits", "카드 할인을 받았어요")));
    const end = await h.step({ type: "skip", slot: "refs" });
    expect(await h.questions()).toEqual(["model", "pros", "photo", "alts", "altReason", "benefits", "refs"]);
    expect(end.chosen).toBe("propose_review");
  });

  it("사진 질문에 글로 답해도 칸이 채워지지 않고 대화가 이어진다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    await h.step(say("가볍고 귀가 덜 아파요"), replyAi(fill("pros", "가볍고 귀가 덜 아파요")));
    for (const line of ["아직 안 올렸어요", "나중에 올릴게요", "그냥 두세요"]) {
      const result = await h.step(say(line), { intent: "reply", fills: [] });
      expect(result.view.slots.photo).toBeUndefined();
    }
    const fallback = await h.step(say("사진은 없어요"), { state: "fallback" });
    expect(fallback.view.slots.photo).toBeUndefined();
    // 사진 재질문을 마치면 다음 칸(대안)으로 넘어가 있으므로, 확인은 사진이 아닌 칸에 걸린다.
    expect(fallback.view.pending.confirmFill).not.toMatchObject({ slot: "photo" });
  });

  it("사진을 안 올리면 마지막에 사진(필수)을 다시 묻고 리뷰는 제안하지 않는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    await h.step(say("가볍고 귀가 덜 아파요"), replyAi(fill("pros", "가볍고 귀가 덜 아파요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("가벼워서요"), replyAi(fill("altReason", "가벼워서요")));
    await h.step({ type: "skip", slot: "benefits" });
    const end = await h.step({ type: "skip", slot: "refs" });
    expect(end.chosen).toBe("ask_slot");
    expect(end.messages.at(-1)).toMatchObject({ tag: "question", slot: "photo" });
  });

  it("리서치만이면 사진 질문이 없고 필수 3칸이 차면 리뷰를 제안한다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    await h.step(say("WH-CH520"), replyAi(fill("model", "WH-CH520")));
    await h.step(say("가벼워 보여요"), replyAi(fill("pros", "가벼워 보여요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("가격 대비 무게가 맘에 들어요"), replyAi(fill("altReason", "가격 대비 무게가 맘에 들어요")));
    await h.step({ type: "skip", slot: "benefits" });
    const end = await h.step({ type: "skip", slot: "refs" });
    expect(await h.questions()).not.toContain("photo");
    expect(end.chosen).toBe("propose_review");
    const last = end.messages.at(-1)!;
    expect(bodyText(last)).toBe(text.REVIEW_PROPOSAL);
    expect(last.body.quick).toEqual(text.REVIEW_QUICK);
  });

  it("구매 여부가 unset이면 AI가 장점 질문을 골라도 구매 질문이 먼저다", async () => {
    const h = await harness();
    const result = await h.step(say("잘 모르겠어요"), { intent: "reply", fills: [], next: { action: "ask_slot", slot: "pros", text: "장점이 뭐예요?" } });
    expect(result.chosen).toBe("ask_purchase");
    expect(bodyText(result.messages.at(-1)!)).toBe(text.PURCHASE_QUESTION);
    expect(result.view.purchase).toBe("unset");
  });

  it("봉사자 말에서 구매 여부와 기종을 함께 읽고, 이미 찬 칸은 다시 묻지 않는다", async () => {
    const h = await harness();
    const result = await h.step(
      say("WH-CH720N 샀어요. 가볍고 좋아요"),
      {
        intent: "reply",
        fills: [fill("model", "WH-CH720N", "WH-CH720N 샀어요"), fill("pros", "가볍고 좋아요")],
        purchase: { value: "bought", evidence: "WH-CH720N 샀어요" },
      },
    );
    expect(result.view.purchase).toBe("bought");
    expect(result.view.slots.model).toMatchObject({ value: "WH-CH720N", status: "filled", by: "ai" });
    // 칸 채움 말풍선은 서버가 만든다.
    expect(result.messages.filter((message) => message.tag === "fill").map(bodyText)).toEqual([
      "구매 여부는 “구매했어요”로 적었어요.",
      "기종 칸에 “WH-CH720N”라고 적었어요.",
      "장점 칸에 “가볍고 좋아요”라고 적었어요.",
    ]);
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "photo" });
  });

  it("앞선 필수 칸(장점·사진)이 남아 있으면 AI가 고른 뒤 칸보다 그 칸을 먼저 묻는다(질문 번호 순서가 기본)", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("WH-CH720N이요"), {
      intent: "reply",
      fills: [fill("model", "WH-CH720N", "WH-CH720N이요")],
      next: { action: "ask_slot", slot: "altReason", text: "WH-CH720N을 고른 이유가 뭐예요?" },
    });
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "pros", ai: "none" });
  });

  it("구매함에서 장점까지 채워도 AI가 뒤 칸을 골라도 사진(필수)이 먼저다(E3)", async () => {
    const h = await harness();
    const result = await h.step(say("WH-CH720N 샀어요. 소리가 잘 나요"), {
      intent: "reply",
      fills: [fill("model", "WH-CH720N", "WH-CH720N 샀어요"), fill("pros", "소리가 잘 나요")],
      purchase: { value: "bought", evidence: "WH-CH720N 샀어요" },
      next: { action: "ask_slot", slot: "altReason", text: "WH-CH720N을 고른 이유가 뭐예요?" },
    });
    expect(result.view.slots.pros).toMatchObject({ value: "소리가 잘 나요", by: "ai" });
    expect(result.messages.some((message) => message.body.kind === "guide")).toBe(false);
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "photo" });
  });

  it("앞선 필수 칸이 모두 찼으면 봉사자가 꺼낸 주제로 AI가 고른 칸이 먼저다(A21)", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    const result = await h.step(say("WH-CH520이고 가벼워서 샀고 무게가 맘에 들어요. 블로그 글도 봤어요"), {
      intent: "reply",
      fills: [
        fill("model", "WH-CH520", "WH-CH520이고"),
        fill("pros", "가벼워요", "가벼워서"),
        fill("altReason", "무게가 맘에 들어요", "무게가 맘에 들어요"),
      ],
      next: { action: "ask_slot", slot: "refs", text: "봤다는 블로그 글을 알려 주세요." },
    });
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "refs", ai: "ok" });
    expect(bodyText(result.messages.at(-1)!)).toBe("봤다는 블로그 글을 알려 주세요.");
  });

  it("AI 질문 글이 검사를 못 넘으면 서버 질문을 쓴다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("WH-CH720N이요"), {
      intent: "reply",
      fills: [fill("model", "WH-CH720N", "WH-CH720N이요")],
      next: { action: "ask_slot", slot: "altReason", text: "19,900원인데 어땠나요?" },
    });
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "pros", ai: "none" });
  });
});

describe("evidence 변형 3개", () => {
  const cases: [string, string, string][] = [
    ["공백이 달라도", "가볍고귀가 덜아파요", "가볍고 귀가 덜 아파요"],
    ["문장부호가 달라도", "가볍고, 귀가 덜 아파요!", "가볍고 귀가 덜 아파요"],
    ["끝 조사가 달라도", "720N이 가볍고 귀가 덜 아파요", "720N 가볍고 귀가 덜 아파요"],
  ];
  it.each(cases)("%s 칸을 채운다", async (_name, said, evidence) => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    const result = await h.step(say(said), replyAi(fill("pros", "가볍고 귀가 덜 아파요", evidence)));
    expect(result.view.slots.pros?.value).toBe("가볍고 귀가 덜 아파요");
  });
  it("말에 없는 evidence면 칸을 채우지 않고 한 번 다시 묻는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    const result = await h.step(say("괜찮았어요"), replyAi(fill("pros", "배터리가 좋아요", "배터리가 오래가요")));
    expect(result.view.slots.pros).toBeUndefined();
    expect(result.chosen).toBe("reask");
    expect(bodyText(result.messages.at(-1)!).startsWith(text.REASK_PREFIX)).toBe(true);
  });
});

describe("묻는 말·재질문·짧은 답", () => {
  it("AI가 ask_back이면 칸을 채우지 않고 찾는 방법만 주고 같은 질문을 다시 보인다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("소니 헤드셋 가격이랑 재고 알려줘"), {
      intent: "ask_back",
      fills: [],
      guide: { queries: ["소니 헤드셋"], checks: ["기종 이름이 같은지"], steps: ["공식 페이지를 연다"] },
    });
    const guide = result.messages.find((message) => message.body.kind === "guide")!;
    expect(guide.tag).toBe("search");
    expect(guide.body).toMatchObject({ queries: ["소니 헤드셋"], checks: ["기종 이름이 같은지"], steps: ["공식 페이지를 연다"] });
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "model" });
    expect(result.view.slots.model).toBeUndefined();
    // 가격·재고 문구는 어디에도 없다(봉사자 말풍선 제외).
    for (const message of result.messages.filter((entry) => entry.role === "ai")) {
      expect(hasForbidden(JSON.stringify(message.body)), JSON.stringify(message.body)).toBe(false);
    }
  });

  it("묻는 말은 AI가 칸 채움을 함께 줘도 채우지 않고 찾는 방법 카드와 같은 질문을 보인다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("WH-CH720N이요. 그런데 가격 알려줘"), {
      intent: "ask_back",
      fills: [fill("model", "WH-CH720N", "WH-CH720N이요")],
      purchase: { value: "research", evidence: "WH-CH720N이요" },
    });
    expect(result.view.slots.model).toBeUndefined();
    const guide = result.messages.find((message) => message.body.kind === "guide")!;
    expect(guide.body).toMatchObject({ queries: defaultGuide(CONTEXT).queries, checks: defaultGuide(CONTEXT).checks, steps: defaultGuide(CONTEXT).steps });
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "model" });
    expect(result.messages.filter((message) => message.tag === "fill")).toEqual([]);
    // AI가 reply로 읽고 pros를 채웠어도 말이 부탁형이면 같다.
    const h2 = await harness();
    await h2.step({ type: "quick", replyId: "purchase.bought" });
    const reply = await h2.step(say("소니 헤드셋 찾는 방법 알려줘"), {
      intent: "reply",
      fills: [fill("pros", "찾는 방법", "소니 헤드셋 찾는 방법")],
    });
    expect(reply.view.slots.pros).toBeUndefined();
    expect(reply.messages.some((message) => message.body.kind === "guide")).toBe(true);
    expect(reply.messages.at(-1)).toMatchObject({ tag: "question", slot: "model" });
  });

  it("구매 여부 전에 묻는 말이면 찾는 방법 카드 뒤에 구매 질문을 한다", async () => {
    const h = await harness();
    const result = await h.step(say("소니 헤드셋 어떻게 찾아요?"), { intent: "ask_back", fills: [] });
    expect(result.messages.some((message) => message.body.kind === "guide")).toBe(true);
    expect(result.messages.at(-1)).toMatchObject({ slot: "purchase", body: { text: text.PURCHASE_QUESTION } });
  });

  it("재질문은 한 번이고, 그다음 짧은 답은 그대로 값으로 넣는다(short)", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    const asked = await h.step(say("음 글쎄요"), { intent: "reply", fills: [] });
    expect(asked.chosen).toBe("reask");
    const again = await h.step(say("그냥 편해요"), { intent: "reply", fills: [] });
    expect(again.view.slots.pros).toMatchObject({ value: "그냥 편해요", status: "filled", by: "volunteer", short: true });
    expect(again.messages.at(-1)).toMatchObject({ tag: "question", slot: "photo" });
  });

  it("재질문 뒤에도 의문형·건너뛰자는 말·한 글자는 값으로 넣지 않는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), replyAi(fill("model", "WH-CH720N")));
    await h.step(say("음 글쎄요"), { intent: "reply", fills: [] });
    const asking = await h.step(say("뭐가 좋을까요?"), { intent: "reply", fills: [] });
    expect(asking.view.slots.pros).toBeUndefined();
    const one = await h.step(say("네"), { intent: "reply", fills: [] });
    expect(one.view.slots.pros).toBeUndefined();
  });

  it("기종 칸은 재질문 뒤에도 말을 그대로 넣지 않는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("글쎄요"), { intent: "reply", fills: [] });
    const result = await h.step(say("그냥 헤드셋이요"), { intent: "reply", fills: [] });
    expect(result.view.slots.model).toBeUndefined();
  });
});

describe("대체 동작(AI 없음)", () => {
  const fallback: AiMode = { state: "fallback" };
  it("의문형이면 기본 찾는 방법 카드를 붙이고 같은 질문을 다시 보인다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("어디서 찾아요?"), fallback);
    const notice = result.messages.find((message) => message.tag === "notice")!;
    expect(bodyText(notice)).toBe(text.FALLBACK_NOTICE);
    expect(notice.ai).toBe("fallback");
    const guide = result.messages.find((message) => message.body.kind === "guide")!;
    expect(guide.body).toMatchObject({ queries: defaultGuide(CONTEXT).queries, checks: defaultGuide(CONTEXT).checks });
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "model" });
    expect(result.view.slots.model).toBeUndefined();
  });

  it("답처럼 보이면 칸에 바로 넣지 않고 넣을지 먼저 묻는다. 넣기를 누르면 채운다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("WH-CH720N"), fallback);
    expect(result.view.slots.model).toBeUndefined();
    expect(result.view.pending.confirmFill).toMatchObject({ slot: "model", value: "WH-CH720N" });
    const confirm = result.messages.at(-1)!;
    expect(bodyText(confirm)).toContain(text.CONFIRM_FILL);
    expect(confirm.body.quick).toEqual(text.CONFIRM_QUICK);

    const yes = await h.step({ type: "quick", replyId: "confirm.yes" });
    expect(yes.view.slots.model).toMatchObject({ value: "WH-CH720N", status: "filled", by: "volunteer" });
    expect(yes.view.pending.confirmFill).toBeUndefined();
    expect(yes.messages.at(-1)).toMatchObject({ tag: "question", slot: "pros" });
  });

  it("아니요를 누르면 칸을 채우지 않고 지나간다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await h.step(say("WH-CH720N"), fallback);
    const no = await h.step({ type: "quick", replyId: "confirm.no" });
    expect(no.view.slots.model).toBeUndefined();
    expect(no.view.pending.confirmFill).toBeUndefined();
    expect(no.view.counters.asked.model).toBe(true);
  });

  it("넣을지 확인이 남아 있고 다음이 리뷰 제안이면 확인을 재촉한다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    await h.step(say("WH-CH520"), replyAi(fill("model", "WH-CH520")));
    await h.step(say("가벼워 보여요"), replyAi(fill("pros", "가벼워 보여요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("무게가 맘에 들어요"), replyAi(fill("altReason", "무게가 맘에 들어요")));
    await h.step({ type: "skip", slot: "benefits" });
    // 마지막 질문(참고 글)에 AI 없이 답하면 넣을지 묻고, 그 확인이 남은 채 글이 아닌 입력이 오면 리뷰 제안 대신 재촉한다.
    await h.step(say("블로그 글 읽었어요"), fallback);
    const result = await h.step({ type: "skip", slot: "benefits" });
    expect(result.view.pending.confirmFill).toBeDefined();
    expect(result.messages.at(-1)).toMatchObject({ tag: "notice" });
    // 넣을 칸과 값을 함께 보여 준다.
    expect(bodyText(result.messages.at(-1)!)).toBe(`${text.PENDING_NOTICE} 참고 글 칸에 “블로그 글 읽었어요”라고 적어도 될까요?`);
    expect(result.chosen).not.toBe("propose_review");
  });

  it("상한에 닿으면 CAP 문구를 한 번만 보이고 기본 질문으로 이어 간다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const first = await h.step(say("WH-CH720N"), { state: "capped", cap: "request" });
    expect(first.messages.map(bodyText)).toContain(text.CAP_REQUEST);
    expect(first.messages.find((message) => bodyText(message) === text.CAP_REQUEST)?.ai).toBe("capped");
    const second = await h.step(say("WH-CH520"), { state: "capped", cap: "request" });
    expect(second.messages.map(bodyText)).not.toContain(text.CAP_REQUEST);
    const daily = await harness();
    await daily.step({ type: "quick", replyId: "purchase.bought" });
    const dailyFirst = await daily.step(say("WH-CH720N"), { state: "capped", cap: "daily" });
    expect(dailyFirst.messages.map(bodyText)).toContain(text.CAP_DAILY);
  });
});

describe("건너뛰기·칩·고치기·링크", () => {
  it("선택 칸은 건너뛸 수 있다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step({ type: "skip", slot: "alts" });
    expect(result.view.slots.alts).toMatchObject({ status: "skipped", value: "" });
  });

  it("필수 칸 건너뛰기는 거부하고 REQUIRED_SKIP과 같은 질문을 보인다(상태 불변)", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const before = await h.view();
    const result = await h.step({ type: "skip", slot: "model" });
    expect(result.messages.map(bodyText)).toContain(text.REQUIRED_SKIP);
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "model" });
    expect(result.view.slots.model).toBeUndefined();
    expect(result.view.version).toBe(before.version);
  });

  it("AI가 건너뛰자는 말도 필수 칸이면 거부한다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const result = await h.step(say("건너뛸게요"), { intent: "skip", fills: [] });
    expect(result.messages.map(bodyText)).toContain(text.REQUIRED_SKIP);
    expect(result.view.slots.model).toBeUndefined();
  });

  it("칩은 보인 후보만 받는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    await research.addMessage({ ...h.actor, cacheKey: "model", messages: [], pending: { shownModels: ["소니 WH-CH720N"] } });
    const bad = await h.step({ type: "chip", slot: "model", value: "소니 XM-9999" });
    expect(bad.view.slots.model).toBeUndefined();
    const good = await h.step({ type: "chip", slot: "model", value: "소니 WH-CH720N" });
    expect(good.view.slots.model).toMatchObject({ value: "소니 WH-CH720N", status: "confirmed", by: "volunteer" });
    expect(good.messages.at(-1)).toMatchObject({ tag: "question", slot: "pros" });
  });

  it("패널에서 고친 칸이 지금 묻는 칸이 아니면 새 질문을 겹쳐 붙이지 않는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const edit = await h.step({ type: "edit", slot: "pros", text: "가벼워요" });
    expect(edit.view.slots.pros).toMatchObject({ value: "가벼워요", status: "confirmed", by: "volunteer" });
    expect(edit.messages).toEqual([]);
    const same = await h.step({ type: "edit", slot: "model", text: "WH-CH720N" });
    expect(same.messages.at(-1)).toMatchObject({ tag: "question", slot: "photo" });
  });

  it("참고 글 질문에 https 주소를 붙이면 직접 확인 필요 링크 카드를 만들고, 확인하면 칸을 채운다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    await h.step(say("WH-CH520"), replyAi(fill("model", "WH-CH520")));
    await h.step(say("가벼워 보여요"), replyAi(fill("pros", "가벼워 보여요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("무게가 맘에 들어요"), replyAi(fill("altReason", "무게가 맘에 들어요")));
    await h.step({ type: "skip", slot: "benefits" });
    const url = "https://blog.example.com/post/1";
    const card = await h.step(say(`이 글 봤어요 ${url}`), replyAi());
    const link = card.messages.find((message) => message.body.kind === "link")!;
    expect(link.body).toMatchObject({ kind: "link", url, note: text.LINK_NOTE });
    expect(card.view.slots.refs).toBeUndefined();
    // 확인하기 전에는 다음 질문도 리뷰 제안도 없다.
    expect(card.messages.at(-1)).toBe(link);

    const unknown = await h.step({ type: "link_check", url: "https://other.example.com/x" });
    expect(unknown.view.slots.refs).toBeUndefined();
    const checked = await h.step({ type: "link_check", url });
    expect(checked.view.slots.refs).toMatchObject({ value: url, links: [url], status: "confirmed" });
    expect(checked.chosen).toBe("propose_review");
  });

  it("문장 끝 마침표·쉼표·닫는 괄호·따옴표는 주소에 넣지 않는다", () => {
    expect(urlInText("이 글 봤어요 https://example.com/review.")).toBe("https://example.com/review");
    expect(urlInText("https://example.com/review, 좋아요")).toBe("https://example.com/review");
    expect(urlInText("(https://example.com/review)")).toBe("https://example.com/review");
    expect(urlInText('"https://example.com/review".')).toBe("https://example.com/review");
    expect(urlInText("https://example.com/review?id=3!!")).toBe("https://example.com/review?id=3");
    expect(urlInText("https://example.com/a。")).toBe("https://example.com/a");
    // 짝이 맞는 괄호는 주소의 일부다.
    expect(urlInText("https://ko.wikipedia.org/wiki/Foo_(bar)")).toBe("https://ko.wikipedia.org/wiki/Foo_(bar)");
    expect(urlInText("https://ko.wikipedia.org/wiki/Foo_(bar).")).toBe("https://ko.wikipedia.org/wiki/Foo_(bar)");
    expect(urlInText("주소 없어요")).toBeNull();
    expect(urlInText("https://.")).toBeNull();
  });

  it("끝에 마침표가 붙은 주소도 그 주소로 링크 카드를 만든다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    await h.step(say("WH-CH520"), replyAi(fill("model", "WH-CH520")));
    await h.step(say("가벼워 보여요"), replyAi(fill("pros", "가벼워 보여요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("무게가 맘에 들어요"), replyAi(fill("altReason", "무게가 맘에 들어요")));
    await h.step({ type: "skip", slot: "benefits" });
    const card = await h.step(say("이 글 봤어요 https://blog.example.com/review."), replyAi());
    const link = card.messages.find((message) => message.body.kind === "link")!;
    expect(link.body).toMatchObject({ kind: "link", url: "https://blog.example.com/review" });
  });

  it("AI가 참고 글 칸을 주소로 채우려 해도 값으로 넣지 않고 링크 카드로 받는다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    await h.step(say("WH-CH520"), replyAi(fill("model", "WH-CH520")));
    await h.step(say("가벼워 보여요"), replyAi(fill("pros", "가벼워 보여요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("무게가 맘에 들어요"), replyAi(fill("altReason", "무게가 맘에 들어요")));
    await h.step({ type: "skip", slot: "benefits" });
    const url = "https://blog.example.com/post/2";
    const said = `이 글을 참고했어요 ${url}`;
    const card = await h.step(say(said), replyAi(fill("refs", said, said)));
    expect(card.view.slots.refs).toBeUndefined();
    expect(card.messages.find((message) => message.body.kind === "link")?.body).toMatchObject({ url, note: text.LINK_NOTE });
    expect(card.messages.filter((message) => message.tag === "fill")).toEqual([]);
    // 다른 칸(혜택 질문 중)에 AI가 refs를 채우려 해도 같다. 주소가 든 refs 값은 링크 확인을 거친다.
    const h2 = await harness();
    await h2.step({ type: "quick", replyId: "purchase.research" });
    const other = await h2.step(say(said), replyAi(fill("refs", said, said)));
    expect(other.view.slots.refs).toBeUndefined();
    expect(other.messages.some((message) => message.body.kind === "link")).toBe(true);
  });

  it("메시지 본문은 8,192바이트 이하다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    const long = "가".repeat(1000);
    const result = await h.step(say(long), replyAi());
    for (const message of result.view.messages) {
      expect(Buffer.byteLength(JSON.stringify(message.body), "utf8")).toBeLessThanOrEqual(8192);
    }
  });
});

describe("A2 독립 리뷰 지적 반영", () => {
  const fallback: AiMode = { state: "fallback" };
  async function researchUntilRefs() {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    await h.step(say("WH-CH520"), replyAi(fill("model", "WH-CH520")));
    await h.step(say("가벼워 보여요"), replyAi(fill("pros", "가벼워 보여요")));
    await h.step({ type: "skip", slot: "alts" });
    await h.step(say("무게가 맘에 들어요"), replyAi(fill("altReason", "무게가 맘에 들어요")));
    await h.step({ type: "skip", slot: "benefits" });
    return h;
  }

  it("200자가 넘는 https 주소도 링크 확인 뒤 칸 값은 짧게, 전체 주소는 links에 둔다", async () => {
    const h = await researchUntilRefs();
    const url = `https://blog.example.com/post/${"a".repeat(300)}`;
    const card = await h.step(say(`이 글을 참고했어요 ${url}`), fallback);
    expect(card.messages.find((message) => message.body.kind === "link")?.body).toMatchObject({ url });
    const checked = await h.step({ type: "link_check", url });
    expect(checked.view.slots.refs?.links).toEqual([url]);
    expect(checked.view.slots.refs?.status).toBe("confirmed");
    expect((checked.view.slots.refs?.value ?? "").length).toBeLessThanOrEqual(200);
    expect(checked.view.slots.refs?.value).toContain("blog.example.com");
  });

  it("대안 이름 둘을 이으면 200자를 넘는 경우 새 이름을 넣지 않는다(칸 한도)", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    const first = "가".repeat(110);
    const second = "나".repeat(110);
    const result = await h.step(say(`${first} 그리고 ${second}`), {
      intent: "reply",
      fills: [fill("alts", first, "가".repeat(50)), fill("alts", second, "나".repeat(50))],
    });
    expect(result.view.slots.alts?.value).toBe(first);
  });

  it("확인을 기다리는 중에 글이 오면 확인을 닫고 새 말로 처리한다(오래된 값이 남지 않는다)", async () => {
    const h = await researchUntilRefs();
    const pending = await h.step(say("블로그 글 읽었어요"), fallback);
    expect(pending.view.pending.confirmFill).toMatchObject({ slot: "refs" });
    // 묻는 말: 확인은 닫히고 막혔던 칸 질문이 다시 보인다.
    const asked = await h.step(say("어디서 찾아요?"), fallback);
    expect(asked.view.pending.confirmFill).toBeUndefined();
    expect(asked.messages.at(-1)).toMatchObject({ tag: "question", slot: "refs" });
    // 그다음 답은 버려지지 않는다(재질문을 이미 했으므로 짧은 답이 칸에 들어간다). 예전 확인 값이 새 값을 덮지도 않는다.
    const answer = await h.step(say("공식 후기 글이요"), fallback);
    expect(answer.view.pending.confirmFill).toBeUndefined();
    expect(answer.view.slots.refs).toMatchObject({ value: "공식 후기 글이요", status: "filled" });
    const yes = await h.step({ type: "quick", replyId: "confirm.yes" });
    expect(yes.view.slots.refs?.value).toBe("공식 후기 글이요");
  });

  it("건너뛰기로 칸이 바뀌면 같은 칸의 확인도 닫힌다", async () => {
    const h = await researchUntilRefs();
    await h.step(say("블로그 글 읽었어요"), fallback);
    const skipped = await h.step({ type: "skip", slot: "refs" });
    expect(skipped.view.pending.confirmFill).toBeUndefined();
    expect(skipped.view.slots.refs?.status).toBe("skipped");
  });

  it("AI 없이도 물음표 없는 가격·재고·판매처 질문에는 찾는 방법 카드를 준다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.bought" });
    for (const line of ["가격 얼마야", "어디서 사", "재고 있어"]) {
      const result = await h.step(say(line), fallback);
      expect(result.messages.some((message) => message.body.kind === "guide"), line).toBe(true);
      expect(result.view.slots.model, line).toBeUndefined();
      expect(result.view.pending.confirmFill, line).toBeUndefined();
    }
  });

  it("봉사자가 그 주제를 꺼내지 않았으면 AI가 고른 뒤 칸이 순서를 앞지르지 못한다", async () => {
    const h = await harness();
    await h.step({ type: "quick", replyId: "purchase.research" });
    const result = await h.step(say("WH-CH520이고 가벼워서 샀고 무게가 맘에 들어요"), {
      intent: "reply",
      fills: [
        fill("model", "WH-CH520", "WH-CH520이고"),
        fill("pros", "가벼워요", "가벼워서"),
        fill("altReason", "무게가 맘에 들어요", "무게가 맘에 들어요"),
      ],
      next: { action: "ask_slot", slot: "refs", text: "참고한 글이 있나요?" },
    });
    // 참고 글 얘기는 없었으므로 질문 번호 순서(대안)가 이어진다.
    expect(result.messages.at(-1)).toMatchObject({ tag: "question", slot: "alts", ai: "none" });
  });

  describe("AI 출력 검사의 틈", () => {
    const input = {
      text: "가벼워요 그리고 소니랑 보스를 봤어요",
      material: ["가벼워요 그리고 소니랑 보스를 봤어요", "소니 헤드셋 찾아줘"],
      purchase: "bought" as const,
    };
    it("값 일부가 금지 표현으로 지워지면 dropped로 센다", () => {
      const turn = validateAiTurn(
        { intent: "reply", fills: [{ slot: "pros", value: "가벼워요. 19,900원이에요.", evidence: "가벼워요" }] },
        input,
        CONTEXT,
      );
      expect(turn?.fills).toEqual([{ slot: "pros", value: "가벼워요." }]);
      expect(turn?.dropped).toBe(true);
    });
    it("쉼표로 이은 대안 이름은 이름 수로 상한 2를 센다", () => {
      const turn = validateAiTurn(
        { intent: "reply", fills: [{ slot: "alts", value: "소니, 보스, 젠하이저", evidence: "소니랑 보스" }] },
        input,
        CONTEXT,
      );
      expect(turn?.fills).toEqual([]);
      expect(turn?.dropped).toBe(true);
    });
    it("알아볼 수 있는 필드가 없는 JSON은 AI 실패(대체 동작)로 본다", () => {
      expect(validateAiTurn({ answer: "sorry" }, input, CONTEXT)).toBeNull();
      expect(validateAiTurn({ intent: "reply", fills: [] }, input, CONTEXT)).not.toBeNull();
    });
    it("값은 봉사자 말이나 evidence에 근거해야 한다: 핵심 낱말이 없으면 그 fill만 버린다", () => {
      const grounded = validateAiTurn(
        {
          intent: "reply",
          fills: [
            { slot: "pros", value: "가벼움", evidence: "가벼워요" },
            { slot: "altReason", value: "노이즈캔슬링이 가장 강력해서", evidence: "가벼워요" },
          ],
        },
        input,
        CONTEXT,
      );
      // 말하지 않은 값은 evidence가 맞아도 버린다.
      expect(grounded?.fills).toEqual([{ slot: "pros", value: "가벼움" }]);
      expect(grounded?.dropped).toBe(true);
      const fromEvidence = validateAiTurn(
        { intent: "reply", fills: [{ slot: "altReason", value: "소니랑 보스를 봤어요", evidence: "소니랑 보스를 봤어요" }] },
        input,
        CONTEXT,
      );
      expect(fromEvidence?.fills).toHaveLength(1);
    });
    it("흔하지 않은 최상위 도메인(.ai·.xyz)도 주소로 본다", () => {
      const turn = validateAiTurn(
        { intent: "reply", fills: [], next: { action: "ask_slot", slot: "pros", text: "example.xyz 에서 확인해 주세요." } },
        input,
        CONTEXT,
      );
      expect(turn?.next?.text).toBeNull();
      expect(turn?.dropped).toBe(true);
      const ai = validateAiTurn({ intent: "reply", fills: [{ slot: "pros", value: "example.ai 가벼워요", evidence: "가벼워요" }] }, input, CONTEXT);
      expect(ai?.fills).toEqual([]);
      // 소수점이 든 말은 주소가 아니다.
      const ok = validateAiTurn(
        { intent: "reply", fills: [{ slot: "pros", value: "무게가 1.5배 가벼워요", evidence: "가벼워요" }] },
        { ...input, text: "무게가 1.5배 가벼워요" },
        CONTEXT,
      );
      expect(ok?.fills).toHaveLength(1);
    });
    it("주소·도메인이 든 글은 다음 질문·찾는 방법·다른 칸 값에서 버린다", () => {
      const turn = validateAiTurn(
        {
          intent: "ask_back",
          fills: [{ slot: "pros", value: "www.evil.example 가벼워요", evidence: "가벼워요" }],
          guide: { queries: ["소니 헤드셋 https://evil.example"], checks: ["기종 이름이 같은지"], steps: ["evil.com 에서 산다"] },
          next: { action: "ask_slot", slot: "pros", text: "https://evil.example 에서 알려 주세요." },
        },
        input,
        CONTEXT,
      );
      expect(turn?.fills).toEqual([]);
      expect(turn?.next?.text).toBeNull();
      expect(turn?.guide?.queries).toEqual(defaultGuide(CONTEXT).queries);
      expect(turn?.guide?.steps).toEqual(defaultGuide(CONTEXT).steps);
      expect(turn?.dropped).toBe(true);
    });
  });
});
