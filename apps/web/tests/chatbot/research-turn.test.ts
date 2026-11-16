import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLlmMode, LLM_MODEL } from "@/lib/llm";
import type { ResearchContext } from "@/lib/researchAi";
import { unknownModelTokens } from "@/lib/researchCheck";
import type { NextCandidate, NextMessage, ResearchView, SlotKey, SlotState } from "@/lib/researchSession";
import { planTurn, runTurn, validateAiTurn, type AiMode, type TurnPlan } from "@/lib/researchTurn";
import { textViolations, type Violation } from "../helpers/researchJudge";
import { buildReviewMaterial, buildTemplateReview, checkReviewText, reviewKnownMaterial, writeReview } from "@/lib/researchReview";
import cases from "./research-turn-cases.json";
import reviewCases from "./research-review-cases.json";

// 대화형 리서치 턴(POST …/research/turn의 AI 부분)을 실제 OpenAI로 부르는 고정 사례 시험이다.
// 실행: apps/web 에서 `npm run test:research-turn` (= vitest run --config vitest.chatbot.config.mts tests/chatbot/research-turn.test.ts).
// 키가 보이지 않으면 호출 시험을 건너뛴다. 건너뛴 것은 통과가 아니다. 평소 `npm run check`와 e2e에서는 돌지 않는다.
// 판정은 코드로 한다: AI가 볼 수 있는 모든 글(말풍선·다음 질문 후보·칸 값)에 금지 표현(가격·재고·할인)과 자료에 없는 기종이 없어야 하고,
// 사례마다 정한 기대(칸 채움, 구매 여부, 찾는 방법 카드)를 만족해야 한다.
// 결과는 저장소 루트 test-results/research-turn-results.json 에 남는다(키·봉사자 글 전문은 담지 않는다).

const INTERVAL_MS = 600;
const CASE_TIMEOUT_MS = 40_000;
const RESULTS_DIR = path.resolve(import.meta.dirname, "../../../../test-results");
const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());

interface SessionSpec {
  purchase: "unset" | "bought" | "research";
  /** 칸 이름 → 값. 값이 빈 글자면 건너뛴 칸. */
  slots: Partial<Record<SlotKey, string>>;
  asked: SlotKey[];
  reasked: SlotKey[];
  lastQuestion: string;
  shownModels: string[];
}
interface Expect {
  purchase?: "bought" | "research";
  fillSlot?: SlotKey;
  fillContains?: string;
  noFill?: boolean;
  guide?: boolean;
}
interface CaseFile {
  id: string;
  group: "ask_back" | "r1" | "r3" | "bait" | "fallback";
  note: string;
  context: ResearchContext;
  session: SessionSpec;
  text: string;
  mode: "live" | "fallback";
  expect: Expect;
}
const CASES = cases as CaseFile[];

function makeView(spec: SessionSpec): ResearchView {
  const slots: ResearchView["slots"] = {};
  for (const [key, value] of Object.entries(spec.slots)) {
    const state: SlotState =
      value === "" ? { value: "", status: "skipped", by: "volunteer" } : { value: value ?? "", status: "filled", by: "volunteer" };
    slots[key as SlotKey] = state;
  }
  const asked: ResearchView["counters"]["asked"] = {};
  for (const key of spec.asked) asked[key] = true;
  const reasked: ResearchView["counters"]["reasked"] = {};
  for (const key of spec.reasked) reasked[key] = 1;
  return {
    sessionId: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
    volunteerId: "d-0000000000000001",
    purchase: spec.purchase,
    slots,
    extras: [],
    counters: { asked, reasked },
    pending: { lastQuestion: { slot: spec.lastQuestion, seq: 1 }, shownModels: spec.shownModels },
    review: {},
    version: 0,
    lastSeq: 1,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    photos: [],
    messages: [],
  };
}

/** AI 쪽에서 나올 수 있는 모든 글: 말풍선(ai)과 다음 질문 후보의 문자열 조각. */
function aiStrings(plan: TurnPlan): [string, string][] {
  const out: [string, string][] = [];
  const walk = (field: string, value: unknown) => {
    if (typeof value === "string") out.push([field, value]);
    else if (Array.isArray(value)) value.forEach((entry, index) => walk(`${field}[${index}]`, entry));
    else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        // 단추 식별자와 종류 이름은 글이 아니다.
        if (key === "id" || key === "kind") continue;
        walk(`${field}.${key}`, entry);
      }
    }
  };
  plan.messages.forEach((message: NextMessage, index) => {
    if (message.role === "ai") walk(`messages[${index}]`, message.body);
  });
  plan.next.forEach((candidate: NextCandidate, index) => walk(`next[${index}]`, candidate.message.body));
  for (const [key, slot] of Object.entries(plan.patch.slots ?? {})) {
    if (slot) out.push([`patch.${key}`, slot.value]);
  }
  return out;
}

function judgeCase(entry: CaseFile, plan: TurnPlan): Violation[] {
  const violations: Violation[] = [];
  const material = [entry.text, entry.context.product, entry.context.brand ?? "", entry.context.item ?? "", ...entry.session.shownModels, ...Object.values(entry.session.slots)];
  for (const [field, value] of aiStrings(plan)) {
    violations.push(...textViolations(field, value));
    const unknown = unknownModelTokens(value, material);
    if (unknown.length > 0) violations.push({ rule: "자료에 없는 기종", field, snippet: unknown.join(",").slice(0, 40) });
  }
  const slots = plan.patch.slots ?? {};
  const filled = Object.entries(slots).filter(([, state]) => state && state.status !== "skipped");
  const want = entry.expect;
  const fail = (rule: string) => violations.push({ rule, field: "expect", snippet: entry.id });
  if (want.purchase && plan.patch.purchase !== want.purchase) fail(`구매 여부 ${want.purchase} 기대`);
  if (want.fillSlot) {
    const state = slots[want.fillSlot];
    if (!state || state.status === "skipped") fail(`${want.fillSlot} 칸 채움 기대`);
    else if (want.fillContains && !state.value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").includes(want.fillContains.toLowerCase())) {
      fail(`${want.fillSlot} 값에 ${want.fillContains} 기대`);
    }
  }
  if (want.noFill && (filled.length > 0 || plan.patch.purchase)) fail("칸을 채우지 않아야 함");
  if (want.guide) {
    // chatbot-quality 합격 기준 2: 검색어, 확인할 조건, 찾는 순서가 모두 들어 있다.
    const guide = plan.messages.find((message) => message.role === "ai" && message.body.kind === "guide");
    const filledList = (value: unknown) => Array.isArray(value) && value.length > 0;
    if (!guide) fail("찾는 방법 카드 기대");
    else if (!filledList(guide.body.queries) || !filledList(guide.body.checks) || !filledList(guide.body.steps)) {
      fail("찾는 방법 카드에 검색어·확인 조건·찾는 순서가 모두 있어야 함");
    }
  }
  return violations;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name: string, value: unknown) => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(value, null, 2));
};

describe("대화형 턴 고정 사례", () => {
  it("30개 안팎이고 id가 겹치지 않으며 묶음이 모두 있다", () => {
    const ids = CASES.map((entry) => entry.id);
    expect(CASES.length).toBeGreaterThanOrEqual(28);
    expect(CASES.length).toBeLessThanOrEqual(34);
    expect(new Set(ids).size).toBe(ids.length);
    const count = (group: CaseFile["group"]) => CASES.filter((entry) => entry.group === group).length;
    expect(count("ask_back")).toBe(20);
    expect(count("r1")).toBeGreaterThanOrEqual(3);
    expect(count("r3")).toBeGreaterThanOrEqual(2);
    expect(count("bait")).toBeGreaterThanOrEqual(4);
    expect(count("fallback")).toBeGreaterThanOrEqual(1);
  });

  it("가격·재고를 유도하는 사례와 표기 변형 사례가 있다", () => {
    const texts = CASES.map((entry) => entry.text).join("\n");
    for (const word of ["최저가", "재고", "품절", "만원대", "sony", "소니", "SONY", "쏘니"]) expect(texts).toContain(word);
  });

  it("기존 20문항은 AI가 어떻게 읽어도(ask_back, 채움 없는 reply, 엉뚱한 칸 채움, AI 없음) 찾는 방법 카드가 나오고 위반이 없다", () => {
    for (const entry of CASES.filter((candidate) => candidate.group === "ask_back")) {
      const session = makeView(entry.session);
      const material = [entry.text, entry.context.product, entry.context.brand ?? "", entry.context.item ?? ""];
      const read = (json: Record<string, unknown> | null): AiMode => {
        const turn = validateAiTurn(json, { text: entry.text, material, purchase: session.purchase }, entry.context);
        return turn ? { state: "ok", turn } : { state: "fallback" };
      };
      const modes: AiMode[] = [
        read({ intent: "ask_back", fills: [] }),
        read({ intent: "reply", fills: [] }),
        read({ intent: "reply", fills: [{ slot: "pros", value: entry.text.slice(0, 20), evidence: entry.text.slice(0, 20) }] }),
        { state: "fallback" },
        { state: "capped", cap: "request" },
      ];
      for (const ai of modes) {
        const plan = planTurn({ session, input: { type: "text", text: entry.text }, context: entry.context, ai });
        expect(judgeCase(entry, plan), `${entry.id} ${ai.state}`).toEqual([]);
      }
    }
  });

  it("AI 없음(대체 동작) 사례는 키 없이도 돈다: 묻는 말이면 기본 찾는 방법 카드와 같은 질문", () => {
    for (const entry of CASES.filter((candidate) => candidate.mode === "fallback")) {
      const plan = planTurn({
        session: makeView(entry.session),
        input: { type: "text", text: entry.text },
        context: entry.context,
        ai: { state: "fallback" },
      });
      expect(judgeCase(entry, plan), entry.id).toEqual([]);
    }
  });
});

interface CaseRecord {
  id: string;
  group: string;
  note: string;
  ai: string;
  upstream: string | number | null;
  ms: number;
  usage: { in: number; out: number };
  violations: Violation[];
  error: string | null;
}

describe.skipIf(!hasKey)("실제 OpenAI 턴 응답", () => {
  const records: CaseRecord[] = [];

  beforeAll(() => {
    expect(getLlmMode()).toBe("live");
  });

  afterAll(() => {
    write("research-turn-results.json", {
      model: LLM_MODEL,
      intervalMs: INTERVAL_MS,
      casesRun: records.length,
      passed: records.filter((record) => !record.error && record.violations.length === 0).length,
      fallbacks: records.filter((record) => record.ai === "fallback").length,
      tokens: records.reduce((sum, record) => ({ in: sum.in + record.usage.in, out: sum.out + record.usage.out }), { in: 0, out: 0 }),
      records,
    });
  });

  it.each(CASES.filter((entry) => entry.mode === "live"))(
    "$id: $note",
    async (entry) => {
      if (records.length > 0) await sleep(INTERVAL_MS);
      const startedAt = Date.now();
      let record: CaseRecord;
      try {
        const run = await runTurn({
          session: makeView(entry.session),
          input: { type: "text", text: entry.text },
          context: entry.context,
          capped: null,
          signal: AbortSignal.timeout(30_000),
        });
        record = {
          id: entry.id,
          group: entry.group,
          note: entry.note,
          ai: run.plan.label,
          upstream: run.upstream,
          ms: Date.now() - startedAt,
          usage: run.usage,
          violations: judgeCase(entry, run.plan),
          error: null,
        };
      } catch (caught) {
        record = {
          id: entry.id,
          group: entry.group,
          note: entry.note,
          ai: "none",
          upstream: null,
          ms: Date.now() - startedAt,
          usage: { in: 0, out: 0 },
          violations: [],
          error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown",
        };
      }
      records.push(record);
      expect(record.error).toBeNull();
      expect(record.violations).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );

  it("실제 호출이 일어났다: 사례의 대부분이 fallback이 아니라 AI 응답이다", () => {
    const live = CASES.filter((entry) => entry.mode === "live").length;
    expect(records.length).toBe(live);
    const ok = records.filter((record) => record.ai === "ok").length;
    expect(ok, `ai=ok ${ok}/${records.length}`).toBeGreaterThanOrEqual(Math.ceil(records.length * 0.9));
  });
});

// ---- 검증 리뷰(블록 A4): POST …/research/review의 AI 부분 -------------------------------------
// 사례 3개: 정상, 가격·재고 유도, 자료에 없는 기종명 유도. 최종 문단(AI가 검사를 통과했으면 AI 문단, 아니면 서버 틀 문단)에서
// 금지 표현(가격·재고·할인)·자료에 없는 기종명·주소·전화번호가 없는지를 코드로 판정한다. 칸 값의 명령형 문장을 인용하지 않는지는 판정하지 않는다(가격·기종 유도 문장은 위 검사로 걸린다).

interface ReviewCase {
  id: string;
  note: string;
  context: ResearchContext;
  purchase: "bought" | "research";
  photos: number;
  slots: Partial<Record<SlotKey, string>>;
  expect: { verified: boolean };
}
const REVIEW_CASES = reviewCases as ReviewCase[];

function reviewView(entry: ReviewCase): ResearchView {
  const slots: ResearchView["slots"] = {};
  for (const [key, value] of Object.entries(entry.slots)) {
    slots[key as SlotKey] = value === "" ? { value: "", status: "skipped", by: "volunteer" } : { value: value ?? "", status: "filled", by: "volunteer" };
  }
  if (entry.photos > 0) slots.photo = { value: `${entry.photos}장`, status: "filled", by: "volunteer" };
  const photos = Array.from({ length: entry.photos }, (_, index) => ({
    id: `p${index}`,
    description: null,
    seenModel: null,
    shot: null,
    createdAt: "2026-11-17T00:00:00.000Z",
  }));
  return {
    sessionId: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
    volunteerId: "d-0000000000000001",
    purchase: entry.purchase,
    slots,
    extras: [],
    counters: { asked: {}, reasked: {} },
    pending: {},
    review: {},
    version: 7,
    lastSeq: 20,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    photos,
    messages: [],
  } as ResearchView;
}

function judgeReview(text: string, known: readonly string[]): Violation[] {
  const violations = textViolations("review", text);
  const unknown = unknownModelTokens(text, known);
  if (unknown.length > 0) violations.push({ rule: "자료에 없는 기종", field: "review", snippet: unknown.join(",").slice(0, 40) });
  for (const reason of checkReviewText(text, known, "edit")) violations.push({ rule: "리뷰 검사", field: "review", snippet: reason.slice(0, 40) });
  return violations;
}

describe("검증 리뷰 고정 사례", () => {
  it("사례 3개: 정상, 가격 유도, 기종명 유도", () => {
    expect(REVIEW_CASES.map((entry) => entry.id)).toEqual(["review-normal", "review-price-bait", "review-model-bait"]);
  });

  it("AI 없음(서버 틀 문단)도 사례마다 위반이 없다: 키 없이 돈다", () => {
    for (const entry of REVIEW_CASES) {
      const source = { view: reviewView(entry), context: entry.context };
      const text = buildTemplateReview(buildReviewMaterial(source));
      expect(judgeReview(text, reviewKnownMaterial(source)), entry.id).toEqual([]);
      expect(text, entry.id).toContain(entry.slots.model ?? "");
    }
  });
});

describe.skipIf(!hasKey)("실제 OpenAI 리뷰 응답", () => {
  const records: { id: string; ai: string; ms: number; usage: { in: number; out: number }; violations: Violation[] }[] = [];

  it.each(REVIEW_CASES)(
    "$id: $note",
    async (entry) => {
      if (records.length > 0) await sleep(INTERVAL_MS);
      const source = { view: reviewView(entry), context: entry.context };
      const material = buildReviewMaterial(source);
      const known = reviewKnownMaterial(source);
      const startedAt = Date.now();
      const written = await writeReview(material, known, AbortSignal.timeout(40_000));
      const text = written.text ?? buildTemplateReview(material);
      const violations = judgeReview(text, known);
      records.push({ id: entry.id, ai: written.text ? "ok" : "fallback", ms: Date.now() - startedAt, usage: written.usage, violations });
      expect(violations).toEqual([]);
      // AI가 만든 문단이면 AI 문단 기준(150~700자, 3~7문장)도 통과한 것이다.
      if (written.text) expect(checkReviewText(written.text, known, "ai")).toEqual([]);
      expect(material.구매 === "구매 인증됨").toBe(entry.expect.verified);
    },
    CASE_TIMEOUT_MS,
  );

  it("실제 호출이 일어났고 대부분 AI 문단이다", () => {
    write("research-review-results.json", { model: LLM_MODEL, records });
    expect(records.length).toBe(REVIEW_CASES.length);
    const ok = records.filter((record) => record.ai === "ok").length;
    expect(ok, `ai=ok ${ok}/${records.length}`).toBeGreaterThanOrEqual(2);
  });
});
