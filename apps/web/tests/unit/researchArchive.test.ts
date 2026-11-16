import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, type RequestStore } from "@/lib/requestStore";
import { createMemoryResearchStore, type ResearchActor } from "@/lib/researchStore";
import {
  archiveMessages,
  ARCHIVE_KEEP_MS,
  ARCHIVE_MESSAGES_MAX_BYTES,
  bodyText,
  stripData,
} from "@/lib/researchArchive";
import type { ResearchMessage, SlotState } from "@/lib/researchSession";

// 보낼 때 남기는 두 기록(30일 대화 글, 영구 리뷰)의 순수 규칙과 메모리 저장소 시험. 블록 A1b, 이용자 결정 A45.
// SQL 쪽은 tests/unit/sql/researchArchiveSql.test.ts. 두 구현은 같은 규칙이다.

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-17T01:00:00Z");
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const BENEFIT_URL = "https://shop.example.com/event/headset";

let clock = T0;
let requests: RequestStore;
let research: ReturnType<typeof createMemoryResearchStore>;
let seqVol = 0;
const newVol = () => `d-${String(++seqVol).padStart(16, "0")}`;
const slot = (value: string, extra: Partial<SlotState> = {}): SlotState => ({ value, status: "filled", by: "volunteer", ...extra });

const CANDIDATES = [
  { name: "720N", url: "https://example.com/720n", guide: "리뷰 문단", summary: [] },
  { name: "WH-1000XM5", url: "https://example.com/xm5", guide: "", summary: [] },
  { name: "QC45", url: "https://example.com/qc45", guide: "", summary: [] },
];

beforeEach(() => {
  clock = T0;
  seqVol = 0;
  requests = createMemoryStore({ now: () => clock });
  research = createMemoryResearchStore(requests, { now: () => clock });
});

afterEach(() => {
  research.close();
});

async function claimedOpen(): Promise<{ id: string; volunteerId: string; actor: ResearchActor }> {
  const reg = await requests.register({
    clientRequestId: crypto.randomUUID(), product: "소니 헤드셋", budget: "10만 원", condition: "새 제품",
    brand: "Sony", item: "헤드셋", conditionKind: "new",
  });
  const volunteerId = newVol();
  expect(await requests.claim(reg.requestId, volunteerId)).toBe("claimed");
  const o = await research.open(reg.requestId, volunteerId);
  if (o.outcome !== "ok") throw new Error(o.outcome);
  return { id: reg.requestId, volunteerId, actor: { requestId: reg.requestId, volunteerId, sessionId: o.view.sessionId } };
}

/** 사진 1장·혜택 확인·카드가 있는 대화를 만들고 리뷰를 확정한다. 아직 보내지 않는다. */
async function ready(extra: Array<{ role: "ai" | "volunteer"; tag: string; body: Record<string, unknown> }> = []) {
  const r = await claimedOpen();
  const applied = await research.apply({
    ...r.actor, clientTurnId: "t1", baseVersion: 0,
    patch: {
      purchase: "bought",
      slots: { model: slot("720N"), pros: slot("가벼워요"), altReason: slot("편해요") },
    },
    messages: [
      { role: "ai", tag: "question", slot: "model", body: { text: "어떤 기종을 쓰셨나요?" }, ai: "none" },
      { role: "volunteer", tag: "answer", body: { text: "720N이에요" }, ai: "none" },
      { role: "ai", tag: "search", slot: "benefits", ai: "ok", body: {
        kind: "benefits", headline: "혜택을 찾았어요",
        items: [
          { title: "공식몰 행사", kind: "공식몰", condition: "회원 한정", compare: "", url: BENEFIT_URL, mode: "ai" },
          { title: "카드 혜택", kind: "카드", condition: "특정 카드", compare: "", url: "https://card.example.com/promo", mode: "check" },
        ],
      } },
      { role: "ai", tag: "review", body: { text: "AI 초안 문단" }, ai: "ok" },
      ...extra.map((message) => ({ ...message, ai: "none" as const })),
    ],
    next: [],
  });
  if (applied.outcome !== "ok") throw new Error(applied.outcome);
  const photo = await research.addPhoto({ ...r.actor, thumb: JPEG, messages: [], next: [] });
  if (photo.outcome !== "ok") throw new Error(photo.outcome);
  await research.addMessage({ ...r.actor, cacheKey: null, messages: [
    { role: "volunteer", tag: "fill", slot: "photo", body: { kind: "photo", photoId: photo.photoId, thumb: JPEG }, ai: "none" },
    { role: "ai", tag: "question", body: { text: `사진 확인 ${JPEG} 끝` }, ai: "none" },
  ] });
  // 혜택 확인(칸 version은 올리지 않고 세션을 직접 읽어 같은 version으로 확정한다).
  const patched = await research.apply({
    ...r.actor, clientTurnId: "t2", baseVersion: null,
    patch: { slots: { benefits: slot("공식몰 행사", { status: "confirmed", links: [BENEFIT_URL], at: "2026-11-17T02:00:00Z" }) } },
    messages: [], next: [],
  });
  if (patched.outcome !== "ok") throw new Error(patched.outcome);
  const version = patched.response.version;
  const confirmed = await research.setReview({ ...r.actor, baseVersion: version, text: "검수를 마친 리뷰 문단입니다.", status: "confirmed" });
  if (confirmed.outcome !== "ok") throw new Error(confirmed.outcome);
  return { r, version, rev: confirmed.review.rev ?? 0 };
}

describe("글만 뽑기(순수 함수)", () => {
  it("글, 제품·혜택 카드, 링크, 찾는 방법 세 부분을 글로 만들고 사진·빠른 답·칩은 뺀다", () => {
    expect(bodyText({ text: "안녕하세요", quick: [{ id: "a", label: "빠른 답" }], chips: [{ label: "칩" }] })).toBe("안녕하세요");
    expect(bodyText({ kind: "photo", photoId: "p", thumb: JPEG })).toBe("");
    expect(bodyText({ kind: "products", text: "후보", items: [{ name: "XM5", feature: "노캔", pageUrl: "https://e.com/x" }, 3] }))
      .toBe("후보\nXM5 - 노캔 - https://e.com/x");
    expect(bodyText({ kind: "benefits", headline: "혜택", items: [{ title: "행사", kind: "공식몰", condition: "회원", compare: "중복 불가", url: "https://e.com" }] }))
      .toBe("혜택\n행사 - 공식몰 - 회원 - 중복 불가 - https://e.com");
    expect(bodyText({ kind: "link", url: "https://e.com/a", note: "직접 확인 필요" })).toBe("https://e.com/a - 직접 확인 필요");
    expect(bodyText({ kind: "guide", queries: ["소니 헤드셋"], checks: ["기종", 1, "색상"], steps: ["공식몰"] }))
      .toBe("검색어: 소니 헤드셋\n확인할 조건: 기종, 색상\n찾는 순서: 공식몰");
    expect(bodyText(null)).toBe("");
    expect(bodyText({ text: JPEG, kind: "x" })).toBe("");
  });

  it("stripData는 data: 문자열 값과 thumb 키를 지운다", () => {
    expect(stripData({ a: 1, thumb: "x", b: JPEG, c: [JPEG, "ok", { thumb: "y", t: "z" }], d: { e: ` ${JPEG}` } }))
      .toEqual({ a: 1, c: ["ok", { t: "z" }], d: {} });
  });

  it("archiveMessages는 seq 순서, 글이 없는 메시지 생략, 3,000자 자르기, 190KB 한도를 지킨다", () => {
    const m = (seq: number, body: Record<string, unknown>, role: ResearchMessage["role"] = "ai"): ResearchMessage => ({ seq, role, tag: "question", slot: null, body });
    const out = archiveMessages([m(3, { text: "셋" }), m(1, { text: " 하나 " }), m(2, { kind: "photo", thumb: JPEG }), m(4, { quick: [] }), m(5, { text: `앞 ${JPEG} 뒤` })]);
    expect(out.map((x) => [x.seq, x.text])).toEqual([[1, "하나"], [3, "셋"], [5, "앞  뒤"]]);
    const long = Array.from({ length: 200 }, (_, i) => m(i + 1, { text: "가".repeat(3500) }));
    const cut = archiveMessages(long);
    expect(cut[0].text.length).toBe(3000);
    expect(new TextEncoder().encode(JSON.stringify(cut)).length).toBeLessThanOrEqual(ARCHIVE_MESSAGES_MAX_BYTES + 200);
    expect(cut.length).toBeLessThan(200);
    expect(cut.length).toBeGreaterThan(10);
  });
});

describe("메모리 보내기 기록", () => {
  it("보내면 archives·reviews 각 1행이고 글만 있다. 재전송해도 1행이다", async () => {
    const { r, version, rev } = await ready();
    const sent = await research.send({ ...r.actor, baseVersion: version, reviewRev: rev, candidates: CANDIDATES });
    expect(sent.outcome).toBe("sent");
    const snap = research.archiveSnapshot();
    expect(snap.archives).toHaveLength(1);
    expect(snap.reviews).toHaveLength(1);
    const [a] = snap.archives;
    expect(a).toMatchObject({
      requestId: r.id, isDemo: false, purchase: "bought", verified: true,
      request: { product: "소니 헤드셋", budget: "10만 원", condition: "새 제품", brand: "Sony", item: "헤드셋", conditionKind: "new" },
      review: { final: "검수를 마친 리뷰 문단입니다.", draft: "AI 초안 문단" },
    });
    const raw = JSON.stringify(a);
    expect(raw).not.toMatch(/data:/);
    expect(raw).not.toContain("photoId");
    expect(a.messages[0]).toMatchObject({ role: "ai", tag: "question", slot: "model", text: "어떤 기종을 쓰셨나요?" });
    expect(a.messages.map((x) => x.text)).toContain("사진 확인  끝");
    const [rv] = snap.reviews;
    expect(rv).toMatchObject({
      requestId: r.id, item: "헤드셋", brand: "Sony", product: "소니 헤드셋", model: "720N", purchase: "bought",
      verified: true, reviewText: "검수를 마친 리뷰 문단입니다.", alts: ["WH-1000XM5", "QC45"],
      benefitLinks: [{ title: "공식몰 행사", url: BENEFIT_URL, kind: "공식몰", condition: "회원 한정", confirmedAt: "2026-11-17T02:00:00Z" }],
    });
    expect(rv.sentAt).toBe(a.createdAt);

    const again = await research.send({ ...r.actor, baseVersion: version, reviewRev: rev, candidates: CANDIDATES });
    expect(again.outcome).toBe("existing");
    expect(research.archiveSnapshot().archives).toHaveLength(1);
    expect(research.archiveSnapshot().reviews).toHaveLength(1);
    expect(research.archiveSnapshot().reviews[0].id).toBe(rv.id);
  });

  it("보내기가 실패하면 아무것도 남지 않는다", async () => {
    const { r, version, rev } = await ready();
    expect((await research.send({ ...r.actor, baseVersion: version, reviewRev: rev + 1, candidates: CANDIDATES })).outcome).toBe("review_not_confirmed");
    expect((await research.send({ ...r.actor, baseVersion: version, reviewRev: rev, candidates: [] })).outcome).toBe("bad_request");
    expect(research.archiveSnapshot()).toEqual({ archives: [], reviews: [] });
  });

  it("요청이 지워져도(done 7일 정리·시연 다시 채우기) 기록은 남는다", async () => {
    const { r, version, rev } = await ready();
    expect((await research.send({ ...r.actor, baseVersion: version, reviewRev: rev, candidates: CANDIDATES })).outcome).toBe("sent");
    clock += 8 * DAY;
    await requests.register({
      clientRequestId: crypto.randomUUID(), product: "다른 물건", budget: "1만 원", condition: "아무거나",
      brand: null, item: "물건", conditionKind: "any",
    });
    expect(await requests.get(r.id)).toBeNull();
    expect(research.archiveSnapshot().archives).toHaveLength(1);
    expect(research.archiveSnapshot().reviews).toHaveLength(1);

    // 시연 다시 채우기
    await requests.resetDemo(null);
    const demoId = (await requests.listQueue(newVol())).waiting[0].requestId;
    const v = newVol();
    expect(await requests.claim(demoId, v)).toBe("claimed");
    const o = await research.open(demoId, v);
    if (o.outcome !== "ok") throw new Error(o.outcome);
    const actor = { requestId: demoId, volunteerId: v, sessionId: o.view.sessionId };
    const filled = await research.apply({
      ...actor, clientTurnId: "a", baseVersion: 0,
      patch: { purchase: "research", slots: { model: slot("시연 기종"), pros: slot("장점"), altReason: slot("이유") } },
      messages: [], next: [],
    });
    if (filled.outcome !== "ok") throw new Error(filled.outcome);
    await research.setReview({ ...actor, baseVersion: filled.response.version, text: "시연 리뷰", status: "confirmed" });
    expect((await research.send({ ...actor, baseVersion: filled.response.version, reviewRev: 1, candidates: [CANDIDATES[0]] })).outcome).toBe("sent");
    expect(await requests.resetDemo(null)).toBe(5);
    expect(await requests.get(demoId)).toBeNull();
    const snap = research.archiveSnapshot();
    expect(snap.archives).toHaveLength(2);
    expect(snap.archives.find((a) => a.requestId === demoId)?.isDemo).toBe(true);
    expect(snap.reviews.find((x) => x.requestId === demoId)).toMatchObject({ isDemo: true, reviewText: "시연 리뷰", alts: [], benefitLinks: [] });
  });

  it("sweep은 30일 지난 archives만 지우고 reviews는 남긴다", async () => {
    const a = await ready();
    expect((await research.send({ ...a.r.actor, baseVersion: a.version, reviewRev: a.rev, candidates: CANDIDATES })).outcome).toBe("sent");
    clock += 29 * DAY;
    const b = await ready();
    expect((await research.send({ ...b.r.actor, baseVersion: b.version, reviewRev: b.rev, candidates: CANDIDATES })).outcome).toBe("sent");
    await research.sweep();
    expect(research.archiveSnapshot().archives).toHaveLength(2); // a는 29일째라 아직 남는다
    clock += 2 * DAY; // a는 31일, b는 2일
    await research.sweep();
    const snap = research.archiveSnapshot();
    expect(snap.archives.map((x) => x.requestId)).toEqual([b.r.id]);
    expect(snap.reviews.map((x) => x.requestId).sort()).toEqual([a.r.id, b.r.id].sort());
    clock += 400 * DAY;
    await research.sweep();
    expect(research.archiveSnapshot().archives).toEqual([]);
    expect(research.archiveSnapshot().reviews).toHaveLength(2);
    expect(ARCHIVE_KEEP_MS).toBe(30 * DAY);
  });
});
