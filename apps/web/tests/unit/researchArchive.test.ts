import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, type RequestStore } from "@/lib/requestStore";
import { createMemoryResearchStore, type ResearchActor } from "@/lib/researchStore";
import {
  archiveMessages,
  ARCHIVE_KEEP_MS,
  ARCHIVE_MESSAGES_MAX_BYTES,
  ARCHIVE_SLOTS_MAX_BYTES,
  BENEFIT_LINKS_MAX,
  BENEFIT_LINKS_MAX_BYTES,
  bodyText,
  buildArchive,
  finalReview,
  jsonbBytes,
  scrubText,
  stripData,
} from "@/lib/researchArchive";
import { RESEARCH_LIMITS } from "@/lib/research";
import type { ResearchMessage, ResearchSessionData, SlotState } from "@/lib/researchSession";

// 보낼 때 남기는 두 기록(30일 대화 글, 영구 리뷰)의 순수 규칙과 메모리 저장소 시험. 블록 A1b, 이용자 결정 A45.
// SQL 쪽은 tests/unit/sql/researchArchiveSql.test.ts. 두 구현은 같은 규칙이다.

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-17T01:00:00Z");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
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

async function claimedOpen(product = "소니 헤드셋"): Promise<{ id: string; volunteerId: string; actor: ResearchActor }> {
  const reg = await requests.register({
    clientRequestId: crypto.randomUUID(), product, budget: "10만 원", condition: "새 제품",
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

  it("scrubText는 SQL research_scrub_text와 같은 표를 만족한다", () => {
    // tests/unit/sql/researchArchiveSql.test.ts의 SCRUB_CASES와 같은 표다.
    const cases: Array<[string, string]> = [
      ["연락은 010-1234-5678로", "연락은 [전화번호]로"],
      ["01012345678 / 02 123 4567 / 031-123-4567", "[전화번호] / [전화번호] / [전화번호]"],
      ["+82 10-1234-5678 또는 +82-010-1234-5678", "[전화번호] 또는 [전화번호]"],
      ["메일 a.b+c@example.co.kr 로", "메일 [이메일] 로"],
      ["사진 data:image/jpeg;base64,/9j/4AAQSkZJRg== 끝 data:text/plain,hello 끝", "사진  끝  끝"],
      ["720N WH-1000XM5 2026-11-17 10만 원 1,000,000원 12345678901234", "720N WH-1000XM5 2026-11-17 10만 원 1,000,000원 12345678901234"],
    ["링크 https://shop.example/?email=a%40b.com 끝", "링크  끝"],
    ["혜택 https://shop.example/?email=a@b.com 끝", "혜택  끝"],
    ["https://shop.example/?p=010%2D1234%2D5678&q=1", ""],
    ["이중 https://shop.example/?e=a%2540b.com 끝", "이중  끝"],
    ["대소문자 Data:text/plain,hello DATA:image/png;base64,AAAA 끝", "대소문자   끝"],
    ["끊긴 사진 data:image/png;base64,iVBORw0KGgo\n" + "A1b+".repeat(8) + " Good 끝", "끊긴 사진  Good 끝"],
  ["영문 data:image/png;base64,AA Good", "영문  Good"],
    ["공백 없는 긴 덩어리 " + "A1b+".repeat(60) + " 끝 / 199자 " + "a".repeat(199) + " 끝", "공백 없는 긴 덩어리  끝 / 199자 " + "a".repeat(199) + " 끝"],
    ["괄호 https://shop.example/a(b)?email=a%40b.com 끝", "괄호  끝"],
    ["따옴표 https://shop.example/a'b\"c?email=a%40b.com 끝", "따옴표  끝"],
    ["덩어리 www.shop.example/?e=a%40b.com 와 연락:010%2D1234%2D5678 끝", "덩어리  와  끝"],
    ["퍼센트 100%25 할인 2026%2D11%2D17 은 그대로", "퍼센트 100%25 할인 2026%2D11%2D17 은 그대로"],
    ["줄바꿈 https://s.example/?e=a%40b.com\n다음 줄 \u00a0https://ok.example/a", "줄바꿈 \n다음 줄 \u00a0https://ok.example/a"],
    ["네 번 https://shop.example/?email=a%25252540b.com 끝", "네 번  끝"],
    [`서른 번 https://shop.example/?email=a${"%" + "25".repeat(29) + "40"}b.com 끝`, "서른 번  끝"],
    ["대문자 HTTPS://shop.example/?e=a%40b.com 끝", "대문자  끝"],
    ["주민 900101-1234567 번호 / 900101-5234567 / 9001011234567", "주민 [주민번호] 번호 / 900101-5234567 / 9001011234567"],
    ["카드 1234-5678-9012-3456 / 1234 5678 9012 3456 / 1234567890123456 끝", "카드 [카드번호] / [카드번호] / [카드번호] 끝"],
    ["구분이 섞여도 4111-1111 1111-1111 / 4111 1111-1111 1111 끝", "구분이 섞여도 [카드번호] / [카드번호] 끝"],
    [`덩어리가 서른 겹 a${"%" + "25".repeat(29) + "40"}b.com 끝`, "덩어리가 서른 겹  끝"],
    ["정상 https://e.com/a?x=1%20y&z=%EA%B0%80 와 HTTPS://E.COM/%2F 와 http://x.kr 010-1234-5678", "정상 https://e.com/a?x=1%20y&z=%EA%B0%80 와 HTTPS://E.COM/%2F 와 http://x.kr [전화번호]"],
    ];
    for (const [input, expected] of cases) expect(scrubText(input), input).toBe(expected);
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

describe("SQL과 같은 보관 한도", () => {
  it("긴 대화는 SQL(jsonb::text 크기)과 같은 개수에서 멈춘다", () => {
    // tests/unit/sql/researchArchiveSql.test.ts의 같은 이름 시험과 같은 입력·같은 숫자(LONG_CHAT_KEPT).
    const long = "가".repeat(1013);
    const messages: ResearchMessage[] = [
      { seq: 1, role: "ai", tag: "question", slot: "model", body: { text: "어떤 기종을 쓰셨나요?" } },
      ...Array.from({ length: 120 }, (_, i): ResearchMessage => ({
        seq: i + 2, role: i % 2 === 0 ? "ai" : "volunteer", tag: "answer", slot: null, body: { text: `${i} ${long}` },
      })),
    ];
    expect(archiveMessages(messages)).toHaveLength(61);
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

  it("연락처·사진 조각이 있어도 가려서 남기고, 리뷰가 공백뿐이면 후보 1 가이드를 쓴다", async () => {
    const r = await claimedOpen("소니 헤드셋 010-1234-5678");
    const applied = await research.apply({
      ...r.actor, clientTurnId: "t1", baseVersion: 0,
      patch: { purchase: "research", slots: { model: slot("720N a@b.com"), pros: slot("장점 010 1234 5678"), altReason: slot("이유") } },
      messages: [
        { role: "volunteer", tag: "answer", body: { text: "번호 010-9999-8888 메일 me@example.com data:text/plain,hello 끝" }, ai: "none" },
        { role: "ai", tag: "review", body: { text: "초안 02-123-4567" }, ai: "ok" },
      ],
      next: [],
    });
    if (applied.outcome !== "ok") throw new Error(applied.outcome);
    const version = applied.response.version;
    const confirmed = await research.setReview({ ...r.actor, baseVersion: version, text: "문의 010-5555-6666 / x@y.kr", status: "confirmed" });
    if (confirmed.outcome !== "ok") throw new Error(confirmed.outcome);
    const rev = confirmed.review.rev ?? 0;
    expect((await research.send({ ...r.actor, baseVersion: version, reviewRev: rev, candidates: [{ ...CANDIDATES[0], name: "720N 010-1111-2222" }] })).outcome).toBe("sent");
    const [a] = research.archiveSnapshot().archives;
    const [rv] = research.archiveSnapshot().reviews;
    // 무작위 uuid의 숫자 조각이 전화번호 모양으로 읽히지 않게 uuid는 빼고 본다.
    expect(JSON.stringify([a, rv]).replace(UUID_RE, "")).not.toMatch(/\d{3}[- ]\d{4}[- ]\d{4}|\d{2}-\d{3}-\d{4}|@|data:/);
    expect(a.request.product).toBe("소니 헤드셋 [전화번호]");
    expect(rv.product).toBe("소니 헤드셋 [전화번호]");
    expect(a.messages[0].text).toBe("번호 [전화번호] 메일 [이메일]  끝");
    expect(a.review).toEqual({ final: "문의 [전화번호] / [이메일]", draft: "초안 [전화번호]", rev });
    expect(rv.reviewText).toBe("문의 [전화번호] / [이메일]");
    expect(rv.model).toBe("720N [이메일]");

    // 공백뿐인 리뷰: 후보 1 가이드를 쓰고, 둘 다 비면 보내지 않는다(두 표 모두 비어 있다).
    const b = await ready();
    await research.setReview({ ...b.r.actor, baseVersion: b.version, text: "   ", status: "confirmed" });
    const bView = await research.open(b.r.id, b.r.volunteerId);
    const bRev = bView.outcome === "ok" ? (bView.view.review.rev ?? 0) : -1;
    expect((await research.send({ ...b.r.actor, baseVersion: b.version, reviewRev: bRev, candidates: CANDIDATES })).outcome).toBe("sent");
    expect(research.archiveSnapshot().reviews.find((x) => x.requestId === b.r.id)?.reviewText).toBe("리뷰 문단");
    const c = await ready();
    await research.setReview({ ...c.r.actor, baseVersion: c.version, text: "   ", status: "confirmed" });
    const cView = await research.open(c.r.id, c.r.volunteerId);
    const cRev = cView.outcome === "ok" ? (cView.view.review.rev ?? 0) : -1;
    expect((await research.send({ ...c.r.actor, baseVersion: c.version, reviewRev: cRev, candidates: [{ ...CANDIDATES[0], guide: " " }] })).outcome).toBe("review_not_confirmed");
    expect(research.archiveSnapshot().archives.some((x) => x.requestId === c.r.id)).toBe(false);
    expect(research.archiveSnapshot().reviews.some((x) => x.requestId === c.r.id)).toBe(false);
    expect((await requests.get(c.r.id))?.status).toBe("in_progress");
    expect((await research.send({ ...c.r.actor, baseVersion: c.version, reviewRev: cRev, candidates: [{ ...CANDIDATES[0], guide: "대체 문단" }] })).outcome).toBe("sent");
    expect(research.archiveSnapshot().reviews.find((x) => x.requestId === c.r.id)?.reviewText).toBe("대체 문단");
  });

  it("혜택 링크 주소에 전화번호·이메일·data URL이 섞여 있으면 영구 기록과 보관 칸에 넣지 않는다", async () => {
    const { r, version } = await ready();
    const bad = "https://shop.example/?email=a@b.com&phone=010-1234-5678";
    const encoded = "https://shop.example/?email=a%40b.com";
    const patched = await research.apply({
      ...r.actor, clientTurnId: "t3", baseVersion: version,
      patch: { slots: { benefits: slot("x", { status: "confirmed", links: [bad, encoded, BENEFIT_URL], at: "2026-11-17T02:00:00Z 010-1234-5678" }) } },
      messages: [], next: [],
    });
    if (patched.outcome !== "ok") throw new Error(patched.outcome);
    const v = patched.response.version;
    const confirmed = await research.setReview({ ...r.actor, baseVersion: v, text: "리뷰 문단", status: "confirmed" });
    if (confirmed.outcome !== "ok") throw new Error(confirmed.outcome);
    expect((await research.send({ ...r.actor, baseVersion: v, reviewRev: confirmed.review.rev ?? 0, candidates: CANDIDATES })).outcome).toBe("sent");
    const rv = research.archiveSnapshot().reviews.find((x) => x.requestId === r.id);
    expect(rv?.benefitLinks).toHaveLength(1);
    expect(rv?.benefitLinks[0]).toMatchObject({ url: BENEFIT_URL, confirmedAt: "2026-11-17T02:00:00Z [전화번호]" });
    expect(JSON.stringify(rv)).not.toContain("a@b.com");
    expect(JSON.stringify(rv)).not.toContain("a%40b.com");
    // 30일 보관본의 칸에도 그 링크는 없다(깨진 주소를 남기지 않는다).
    const a = research.archiveSnapshot().archives.find((x) => x.requestId === r.id);
    expect((a?.slots.benefits as { links: string[] }).links).toEqual([BENEFIT_URL]);
    expect(JSON.stringify(a)).not.toContain("a@b.com");
    expect(JSON.stringify(a)).not.toContain("a%40b.com");
  });

  it("리뷰·메시지는 SQL left()처럼 문자(코드 포인트) 수로 자르고, 글 속 깨질 주소는 통째로 뺀다", () => {
    expect(Array.from(finalReview("😀".repeat(1500), []))).toHaveLength(1000);
    expect(finalReview("혜택 https://shop.example/?email=a@b.com", [])).toBe("혜택");
    const out = archiveMessages([{ seq: 1, role: "ai", tag: null, slot: null, body: { headline: "a ".repeat(1000), text: "😀".repeat(1500) } }]);
    expect(Array.from(out[0].text)).toHaveLength(3000);
    expect(out[0].text.endsWith("😀")).toBe(true);
  });

  it("메시지의 tag·slot에 연락처가 들어 있어도 가린다", () => {
    const out = archiveMessages([{ seq: 1, role: "ai", tag: "q 010-1234-5678", slot: "a@b.com", body: { text: "글" } }]);
    expect(out).toEqual([{ seq: 1, role: "ai", tag: "q [전화번호]", slot: "[이메일]", text: "글" }]);
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

describe("보관은 보내기를 막지 않는다(크기를 줄여 담는다)", () => {
  const session = (slots: Record<string, unknown>) =>
    ({ purchase: "research", slots, review: { text: "리뷰 문단", status: "confirmed", rev: 1 } }) as unknown as ResearchSessionData;
  const source = (slots: Record<string, unknown>, messages: ResearchMessage[] = []) => ({
    requestId: "r1", now: T0, isDemo: false,
    request: { product: "소니 헤드셋", budget: "10만 원", condition: "새 제품", brand: "Sony", item: "헤드셋", conditionKind: "new" },
    session: session(slots), messages, photoCount: 0, candidates: [CANDIDATES[0]],
  });
  const ids = () => { let n = 0; return () => `id-${++n}`; };
  const card = (seq: number, url: string): ResearchMessage => ({
    seq, role: "ai", tag: "search", slot: "benefits",
    body: { kind: "benefits", items: [{ title: "제".repeat(60), kind: "종".repeat(40), condition: "조".repeat(80), compare: "", url }] },
  });

  it("혜택 링크 상한은 앱 상한과 같은 4개다", () => {
    expect(BENEFIT_LINKS_MAX).toBe(RESEARCH_LIMITS.maxLinks);
    const links = Array.from({ length: 7 }, (_, i) => `https://shop.example.com/e/${i}`);
    const { review } = buildArchive(source({ benefits: slot("x", { status: "confirmed", links }) }), ids());
    expect(review?.benefitLinks.map((l) => l.url)).toEqual(links.slice(0, 4));
  });

  it("링크 4개가 최대 길이(한글 주소 500자)여도 영구 표 한도(8,000바이트) 안으로 뒤에서부터 덜어 낸다", () => {
    const urls = Array.from({ length: 4 }, (_, i) => `https://shop.example.com/${i}${"가".repeat(474)}`);
    const messages = urls.map((u, i) => card(i + 1, u));
    const { review } = buildArchive(source({ benefits: slot("x", { status: "confirmed", links: urls }) }, messages), ids());
    const kept = review?.benefitLinks ?? [];
    expect(kept.map((l) => l.url)).toEqual(urls.slice(0, 3));
    expect(jsonbBytes(kept)).toBeLessThanOrEqual(BENEFIT_LINKS_MAX_BYTES);
    expect(jsonbBytes(urls.map((url) => ({ title: "제".repeat(60), url, kind: "종".repeat(40), condition: "조".repeat(80), confirmedAt: "2026-11-17T01:00:00Z" })))).toBeGreaterThan(8000);
  });

  it("가린 칸이 30,000바이트를 넘으면 칸은 {}로 줄여 담고 나머지는 그대로 만든다", () => {
    const grown = "01012345678 ".repeat(2100);
    const { archive, review } = buildArchive(source({ model: slot(grown) }), ids());
    expect(archive.slots).toEqual({});
    expect(jsonbBytes(stripData({ model: slot(grown) }))).toBeGreaterThan(ARCHIVE_SLOTS_MAX_BYTES);
    expect(review?.reviewText).toBe("리뷰 문단");
    const small = buildArchive(source({ model: slot("720N") }), ids());
    expect(small.archive.slots).toEqual({ model: { value: "720N", status: "filled", by: "volunteer" } });
  });

  it("혜택 확인 시각이 없으면 보낸 시각을 SQL과 같은 초 단위 UTC 모양으로 쓴다", () => {
    const { review } = buildArchive(source({ benefits: slot("x", { status: "confirmed", links: [BENEFIT_URL] }) }), ids());
    expect(review?.benefitLinks[0].confirmedAt).toBe("2026-11-17T01:00:00Z");
  });

  it("모델 앞뒤 공백은 SQL btrim처럼 스페이스만 뗀다", () => {
    expect(buildArchive(source({ model: slot("  720N  ") }), ids()).review?.model).toBe("720N");
    expect(buildArchive(source({ model: slot("\t720N") }), ids()).review?.model).toBe("\t720N");
  });
});
