import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryStore,
  StoreUnavailableError,
  type DbResult,
  type RequestStore,
  type RpcClient,
} from "@/lib/requestStore";
import {
  createMemoryResearchStore,
  createSupabaseResearchStore,
  getResearchStore,
  resetResearchStoresForTest,
  type ResearchActor,
  type ResearchStore,
} from "@/lib/researchStore";
import { resetRequestStoresForTest } from "@/lib/requestStore";
import type { NextCandidate, NextMessage, SlotKey, SlotState } from "@/lib/researchSession";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-17T01:00:00Z");
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

let clock = T0;
let requests: RequestStore;
let research: ReturnType<typeof createMemoryResearchStore>;

const msg = (text: string, role: NextMessage["role"] = "ai"): NextMessage => ({ role, tag: "t", body: { text }, ai: "none" });
const ask = (action: NextCandidate["action"], slot: SlotKey | null = null, text = "질문"): NextCandidate => ({
  action,
  slot,
  message: msg(text),
});
const slot = (value: string): SlotState => ({ value, status: "filled", by: "volunteer" });

async function claimed(volunteerId = "d-0123456789abcdef"): Promise<{ id: string; volunteerId: string }> {
  const reg = await requests.register({
    clientRequestId: crypto.randomUUID(),
    product: "소니 헤드셋",
    budget: "10만 원",
    condition: "새 제품",
    brand: "Sony",
    item: "헤드셋",
    conditionKind: "new",
  });
  expect(await requests.claim(reg.requestId, volunteerId)).toBe("claimed");
  return { id: reg.requestId, volunteerId };
}

async function opened(volunteerId?: string) {
  const c = await claimed(volunteerId);
  const o = await research.open(c.id, c.volunteerId);
  if (o.outcome !== "ok") throw new Error(o.outcome);
  const actor: ResearchActor = { requestId: c.id, volunteerId: c.volunteerId, sessionId: o.view.sessionId };
  return { ...c, actor, sessionId: o.view.sessionId };
}

let seqVol = 0;
const newVol = () => `d-${String(++seqVol).padStart(16, "0")}`;

beforeEach(() => {
  clock = T0;
  seqVol = 0;
  requests = createMemoryStore({ now: () => clock });
  research = createMemoryResearchStore(requests, { now: () => clock });
});

afterEach(() => {
  research.close();
});

describe("메모리 열기", () => {
  it("없는 요청·대기 요청·남의 요청을 거부하고, 내 요청은 세션을 한 번만 만든다", async () => {
    expect((await research.open(crypto.randomUUID(), newVol())).outcome).toBe("not_found");
    const waiting = await requests.register({
      clientRequestId: crypto.randomUUID(), product: "키보드", budget: "5만", condition: "새 제품",
      brand: null, item: "키보드", conditionKind: "new",
    });
    expect((await research.open(waiting.requestId, newVol())).outcome).toBe("not_in_progress");
    const c = await claimed(newVol());
    expect((await research.open(c.id, newVol())).outcome).toBe("not_yours");
    const first = await research.open(c.id, c.volunteerId);
    const again = await research.open(c.id, c.volunteerId);
    expect(first.outcome === "ok" && again.outcome === "ok" && first.view.sessionId === again.view.sessionId).toBe(true);
    if (first.outcome === "ok") expect(first.view).toMatchObject({ purchase: "unset", version: 0, lastSeq: 0, messages: [], photos: [] });
  });

  it("afterSeq가 있으면 읽기만 하고 세션을 만들지 않는다", async () => {
    const c = await claimed(newVol());
    expect((await research.open(c.id, c.volunteerId, 0)).outcome).toBe("session_changed");
    const r = await opened(newVol());
    await research.apply({ ...r.actor, clientTurnId: "t", baseVersion: 0, messages: [msg("하나"), msg("둘")], next: [] });
    const polled = await research.open(r.id, r.volunteerId, 1);
    expect(polled.outcome === "ok" && polled.view.messages.map((m) => m.seq)).toEqual([2]);
  });
});

describe("메모리 begin·apply", () => {
  it("구매 질문이 먼저 나가고, 칸을 채우면 version이 오른다", async () => {
    const r = await opened(newVol());
    expect((await research.begin({ ...r.actor, kind: "turn", baseVersion: 0, clientTurnId: "a" })).outcome).toBe("ok");
    const out = await research.apply({
      ...r.actor, clientTurnId: "a", baseVersion: 0,
      messages: [msg("안녕", "volunteer")],
      next: [ask("ask_slot", "pros"), ask("ask_purchase", null, "구매하셨나요?")],
    });
    expect(out.outcome === "ok" && out.response.chosen).toBe("ask_purchase");
    expect(out.outcome === "ok" && out.response.messages.map((m) => m.body.text)).toEqual(["안녕", "구매하셨나요?"]);
    const second = await research.apply({
      ...r.actor, clientTurnId: "b", baseVersion: 0,
      patch: { purchase: "bought", slots: { model: slot("720N") } },
      messages: [msg("720N 샀어요", "volunteer")],
      next: [ask("ask_slot", "model"), ask("ask_slot", "pros", "장점")],
    });
    expect(second.outcome === "ok" && second.response).toMatchObject({ version: 1, chosen: "ask_slot", lastSeq: 4 });
    expect(second.outcome === "ok" && second.response.session.counters.asked).toEqual({ pros: true });
    expect(second.outcome === "ok" && second.response.session.pending.lastQuestion).toEqual({ slot: "pros", seq: 4 });
  });

  it("중복 턴은 저장된 응답(stale보다 먼저), 처리 중이면 pending, 낡은 base는 stale", async () => {
    const r = await opened(newVol());
    expect((await research.begin({ ...r.actor, kind: "turn", baseVersion: 0, clientTurnId: "dup" })).outcome).toBe("ok");
    expect((await research.begin({ ...r.actor, kind: "turn", baseVersion: 0, clientTurnId: "dup" })).outcome).toBe("pending");
    const done = await research.apply({ ...r.actor, clientTurnId: "dup", baseVersion: 0, patch: { purchase: "bought" }, messages: [], next: [] });
    expect(done.outcome === "ok" && done.response.version).toBe(1);
    const again = await research.begin({ ...r.actor, kind: "turn", baseVersion: 0, clientTurnId: "dup" });
    expect(again.outcome).toBe("duplicate");
    expect((await research.apply({ ...r.actor, clientTurnId: "dup", baseVersion: 0, patch: { purchase: "research" }, messages: [], next: [] })).outcome).toBe("duplicate");
    expect(await research.begin({ ...r.actor, kind: "turn", baseVersion: 0, clientTurnId: "late" })).toEqual({ outcome: "stale", version: 1 });
    // 처리 중 자리가 있는데 다른 요청이 version을 올린 경우, 낡은 자리를 지워 다시 시도할 수 있다.
    expect((await research.begin({ ...r.actor, kind: "turn", baseVersion: 1, clientTurnId: "race" })).outcome).toBe("ok");
    await research.apply({ ...r.actor, clientTurnId: "other", baseVersion: 1, patch: { slots: { model: slot("x") } }, messages: [], next: [] });
    expect(await research.apply({ ...r.actor, clientTurnId: "race", baseVersion: 1, messages: [], next: [] })).toEqual({ outcome: "stale", version: 2 });
    expect((await research.begin({ ...r.actor, kind: "turn", baseVersion: 2, clientTurnId: "race" })).outcome).toBe("ok");
  });

  it("잘못된 patch는 bad_patch다", async () => {
    const r = await opened(newVol());
    expect((await research.apply({ ...r.actor, clientTurnId: "a", baseVersion: 0, patch: { extras: ["1", "2", "3", "4"] }, messages: [], next: [] })).outcome).toBe("bad_patch");
  });

  it("확정한 리뷰는 칸이 바뀌면 draft로 돌아간다", async () => {
    const r = await opened(newVol());
    const filledAll = await research.apply({
      ...r.actor, clientTurnId: "a", baseVersion: 0,
      patch: { purchase: "research", slots: { model: slot("720N"), pros: slot("가벼워요"), altReason: slot("귀가 편해요") } },
      messages: [], next: [],
    });
    const version = filledAll.outcome === "ok" ? filledAll.response.version : -1;
    const set = await research.setReview({ ...r.actor, baseVersion: version, text: "리뷰", status: "confirmed" });
    expect(set).toMatchObject({ outcome: "ok", review: { status: "confirmed", confirmedVersion: version, rev: 1 } });
    const next = await research.apply({ ...r.actor, clientTurnId: "b", baseVersion: version, patch: { slots: { pros: slot("조용해요") } }, messages: [], next: [] });
    expect(next.outcome === "ok" && next.response.session.review).toMatchObject({ status: "draft", rev: 2 });
  });
});

describe("메모리 상한과 사용량", () => {
  it("요청당 턴 상한을 넘으면 capped, 중복·stale은 세지 않는다", async () => {
    const r = await opened(newVol());
    const caps = { turns: 2, searches: 12, photoUploads: 6, reviews: 3, dailySearches: 60, dailyAi: 600 };
    for (const turn of ["a", "b"]) {
      expect(await research.begin({ ...r.actor, kind: "turn", clientTurnId: turn, caps })).toMatchObject({ outcome: "ok", ai: "ok" });
      await research.apply({ ...r.actor, clientTurnId: turn, baseVersion: null, messages: [], next: [] });
    }
    expect(await research.begin({ ...r.actor, kind: "turn", clientTurnId: "c", caps })).toMatchObject({ outcome: "ok", ai: "capped", cap: "request" });
    await research.apply({ ...r.actor, clientTurnId: "c", baseVersion: null, messages: [], next: [] });
    expect((await research.begin({ ...r.actor, kind: "turn", clientTurnId: "c", caps })).outcome).toBe("duplicate");
    expect((await research.begin({ ...r.actor, kind: "turn", clientTurnId: "d", baseVersion: 99, caps })).outcome).toBe("stale");
  });

  it("검색은 단위로 세고 캐시·진행 중은 세지 않으며, 90초 넘은 진행 표시는 풀린다", async () => {
    const r = await opened(newVol());
    const caps = { turns: 40, searches: 5, photoUploads: 6, reviews: 3, dailySearches: 60, dailyAi: 600 };
    const search = (key: string, units: number) => research.begin({ ...r.actor, kind: "search", cacheKey: key, units, caps });
    expect((await search("b1", 3)).outcome).toBe("ok");
    expect((await search("b1", 3)).outcome).toBe("pending");
    await research.addMessage({ ...r.actor, cacheKey: "b1", messages: [] });
    expect((await search("b1", 3)).outcome).toBe("cached");
    expect(await search("b2", 3)).toEqual({ outcome: "capped", cap: "request" });
    clock += 100_000;
    expect((await search("b1x", 1)).outcome).toBe("ok");
    expect((await search("b1x", 1)).outcome).toBe("pending");
    clock += 91_000;
    expect((await search("b1x", 1)).outcome).toBe("ok");
  });

  it("하루 상한은 서울 날짜에서 센다", async () => {
    const r = await opened(newVol());
    const caps = { turns: 40, searches: 12, photoUploads: 6, reviews: 3, dailySearches: 3, dailyAi: 2 };
    expect(await research.begin({ ...r.actor, kind: "turn", clientTurnId: "a", caps })).toMatchObject({ ai: "ok" });
    expect(await research.begin({ ...r.actor, kind: "turn", clientTurnId: "b", caps })).toMatchObject({ ai: "ok" });
    expect(await research.begin({ ...r.actor, kind: "turn", clientTurnId: "c", caps })).toMatchObject({ ai: "capped", cap: "daily" });
    expect((await research.begin({ ...r.actor, kind: "search", cacheKey: "k", units: 3, caps })).outcome).toBe("ok");
    expect(await research.begin({ ...r.actor, kind: "search", cacheKey: "k2", units: 1, caps })).toEqual({ outcome: "capped", cap: "daily" });
    clock += 24 * HOUR; // 다음 날은 다시 센다
    const r2 = await opened(newVol());
    expect((await research.begin({ ...r2.actor, kind: "turn", clientTurnId: "z", caps })).outcome).toBe("ok");
  });

  it("내려놓고 다시 맡아도 요청당 usage는 유지되고 세션은 새로 생긴다", async () => {
    const r = await opened(newVol());
    const caps = { turns: 1, searches: 12, photoUploads: 6, reviews: 3, dailySearches: 60, dailyAi: 600 };
    expect((await research.begin({ ...r.actor, kind: "turn", clientTurnId: "a", caps })).outcome).toBe("ok");
    await research.apply({ ...r.actor, clientTurnId: "a", baseVersion: null, patch: { purchase: "bought" }, messages: [], next: [] });
    expect(await requests.release(r.id, r.volunteerId)).toBe("released");
    expect((await research.begin({ ...r.actor, kind: "turn", clientTurnId: "b", caps })).outcome).toBe("not_in_progress");
    expect(await requests.claim(r.id, r.volunteerId)).toBe("claimed");
    const again = await research.open(r.id, r.volunteerId);
    expect(again.outcome === "ok" && again.view.sessionId).not.toBe(r.sessionId);
    expect(again.outcome === "ok" && again.view).toMatchObject({ purchase: "unset", lastSeq: 0 });
    const actor = { ...r.actor, sessionId: again.outcome === "ok" ? again.view.sessionId : null };
    expect(await research.begin({ ...actor, kind: "turn", clientTurnId: "b", caps })).toMatchObject({ ai: "capped", cap: "request" });
    // 옛 세션 id로는 쓸 수 없다.
    expect((await research.begin({ ...r.actor, kind: "turn", clientTurnId: "c", caps })).outcome).toBe("session_changed");
  });
});

describe("메모리 사진·리뷰·보내기", () => {
  it("사진은 3장까지이고 리서치만이면 받지 않으며, 일치하면 다음 질문이 같이 들어간다", async () => {
    const r = await opened(newVol());
    await research.apply({ ...r.actor, clientTurnId: "a", baseVersion: 0, patch: { purchase: "bought" }, messages: [], next: [ask("ask_slot", "photo", "사진")] });
    const add = (next: NextCandidate[] = [ask("ask_slot", "pros", "장점")]) =>
      research.addPhoto({ ...r.actor, thumb: JPEG, messages: [msg("사진", "volunteer")], next });
    const first = await add();
    expect(first).toMatchObject({ outcome: "ok", chosen: "ask_slot" });
    expect(first.outcome === "ok" && first.session.slots.photo).toMatchObject({ value: "1장", status: "filled" });
    expect((await add()).outcome === "ok" && (await add()).outcome).toBe("ok");
    expect((await add()).outcome).toBe("photos_full");
    expect((await research.begin({ ...r.actor, kind: "photo" })).outcome).toBe("photos_full");

    const research2 = await opened(newVol());
    await research.apply({ ...research2.actor, clientTurnId: "a", baseVersion: 0, patch: { purchase: "research" }, messages: [], next: [] });
    expect((await research.addPhoto({ ...research2.actor, thumb: JPEG, messages: [], next: [] })).outcome).toBe("photo_not_needed");
    expect((await research.begin({ ...research2.actor, kind: "photo" })).outcome).toBe("photo_not_needed");
  });

  it("jpeg가 아닌 thumb은 거부하고, 확인 필요가 걸리면 다음 질문을 넣지 않는다", async () => {
    const r = await opened(newVol());
    await research.apply({ ...r.actor, clientTurnId: "a", baseVersion: 0, patch: { purchase: "bought" }, messages: [], next: [] });
    expect((await research.addPhoto({ ...r.actor, thumb: "data:image/png;base64,AAAA", messages: [], next: [] })).outcome).toBe("bad_request");
    const out = await research.addPhoto({
      ...r.actor, thumb: JPEG, shot: "photo", seenModel: "XM5",
      pending: { mismatch: { slot: "model" } }, messages: [], next: [ask("ask_slot", "pros")],
    });
    expect(out).toMatchObject({ outcome: "ok", chosen: null });
  });

  it("히어로에서 올린 사진은 구매 질문으로 이어진다", async () => {
    const r = await opened(newVol());
    const out = await research.addPhoto({ ...r.actor, thumb: JPEG, messages: [], next: [ask("ask_slot", "pros"), ask("ask_purchase")] });
    expect(out).toMatchObject({ outcome: "ok", chosen: "ask_purchase" });
  });

  it("사진 삭제는 id가 맞을 때만 지우고, 0장이면 photo 칸을 비운다", async () => {
    const r = await opened(newVol());
    await research.apply({ ...r.actor, clientTurnId: "a", baseVersion: 0, patch: { purchase: "bought" }, messages: [], next: [] });
    const added = await research.addPhoto({ ...r.actor, thumb: JPEG, messages: [], next: [] });
    const photoId = added.outcome === "ok" ? added.photoId : "";
    expect((await research.removePhoto(r.actor, crypto.randomUUID())).outcome).toBe("photo_not_found");
    const removed = await research.removePhoto(r.actor, photoId);
    expect(removed.outcome === "ok" && removed.session.slots.photo).toBeUndefined();
    expect(removed.outcome === "ok" && removed.session.photos).toEqual([]);
  });

  it("보내기: 필수 → review → 보냄. 세션은 지워지고 다시 보내면 existing", async () => {
    const r = await opened(newVol());
    const candidates = [{ name: "720N", url: "https://example.com", guide: "리뷰", summary: [] }];
    const send = (base: number, rev: number) => research.send({ ...r.actor, baseVersion: base, reviewRev: rev, candidates });
    const miss = await send(0, 0);
    expect(miss).toEqual({ outcome: "missing_required", missing: ["purchase", "model", "pros", "altReason"] });
    const filled = await research.apply({
      ...r.actor, clientTurnId: "a", baseVersion: 0,
      patch: { purchase: "research", slots: { model: slot("720N"), pros: slot("가벼워요"), altReason: slot("편해요") } },
      messages: [], next: [],
    });
    const version = filled.outcome === "ok" ? filled.response.version : -1;
    expect((await send(version, 0)).outcome).toBe("review_not_confirmed");
    await research.setReview({ ...r.actor, baseVersion: version, text: "초안", status: "draft" });
    expect((await research.setReview({ ...r.actor, baseVersion: version - 5, text: "확정", status: "confirmed" })).outcome).toBe("stale");
    await research.setReview({ ...r.actor, baseVersion: version, text: "확정", status: "confirmed" });
    expect((await send(version, 1)).outcome).toBe("review_not_confirmed"); // rev 불일치
    expect((await send(version - 1, 2)).outcome).toBe("stale");
    const sent = await send(version, 2);
    expect(sent.outcome).toBe("sent");
    const again = await send(version, 2);
    expect(again).toMatchObject({ outcome: "existing", sentAt: sent.outcome === "sent" ? sent.sentAt : "" });
    const reopened = await research.open(r.id, r.volunteerId, 0);
    expect(reopened.outcome).toBe("not_in_progress");
    expect((await requests.getForVolunteer(r.id, r.volunteerId)).kind).toBe("ok");
    expect((await research.apply({ ...r.actor, clientTurnId: "late", baseVersion: null, messages: [], next: [] })).outcome).toBe("not_in_progress");
  });
});

describe("메모리 내려놓기·6시간 반환", () => {
  it("내려놓은 뒤 늦은 쓰기는 거부되고 세션이 남지 않는다", async () => {
    const r = await opened(newVol());
    expect((await research.begin({ ...r.actor, kind: "turn", clientTurnId: "x" })).outcome).toBe("ok");
    expect(await requests.release(r.id, r.volunteerId)).toBe("released");
    expect((await research.apply({ ...r.actor, clientTurnId: "x", baseVersion: null, patch: { purchase: "bought" }, messages: [msg("늦음")], next: [] })).outcome).toBe("not_in_progress");
    expect((await research.addPhoto({ ...r.actor, thumb: JPEG, messages: [], next: [] })).outcome).toBe("not_in_progress");
    expect((await research.addMessage({ ...r.actor, cacheKey: "k", messages: [] })).outcome).toBe("not_in_progress");
    expect((await research.open(r.id, r.volunteerId, 0)).outcome).toBe("not_in_progress");
  });

  it("다른 봉사자가 맡으면 빈 대화에서 시작한다", async () => {
    const r = await opened(newVol());
    await research.apply({ ...r.actor, clientTurnId: "a", baseVersion: 0, patch: { purchase: "bought" }, messages: [msg("내 대화")], next: [] });
    await requests.release(r.id, r.volunteerId);
    const other = newVol();
    expect(await requests.claim(r.id, other)).toBe("claimed");
    const o = await research.open(r.id, other);
    expect(o.outcome === "ok" && o.view).toMatchObject({ purchase: "unset", messages: [], lastSeq: 0 });
    expect((await research.apply({ ...r.actor, clientTurnId: "z", baseVersion: null, messages: [], next: [] })).outcome).toBe("not_yours");
  });

  it("보낸 요청·초기화(reset)로 지워진 요청의 세션도 지워진다", async () => {
    await requests.resetDemo(null);
    const queue = await requests.listQueue(newVol());
    const demoId = queue.waiting[0].requestId;
    const v = newVol();
    expect(await requests.claim(demoId, v)).toBe("claimed");
    const o = await research.open(demoId, v);
    expect(o.outcome).toBe("ok");
    expect(await requests.resetDemo(null)).toBe(5);
    expect((await research.open(demoId, v)).outcome).toBe("not_found");
  });

  it("6시간 활동이 없으면 대기열로 돌아가고 세션은 지워진다", async () => {
    const idle = await opened(newVol());
    const active = await opened(newVol());
    const neverOpened = await claimed(newVol());
    clock += 5 * HOUR;
    await research.addMessage({ ...active.actor, cacheKey: null, messages: [msg("방금 활동")] }); // active만 활동
    clock += 2 * HOUR; // idle·neverOpened는 7시간, active는 2시간
    expect(await research.sweep()).toBe(2);
    expect((await requests.get(idle.id))?.status).toBe("waiting");
    expect((await requests.get(neverOpened.id))?.status).toBe("waiting");
    expect((await requests.get(active.id))?.status).toBe("in_progress");
    expect((await research.apply({ ...idle.actor, clientTurnId: "late", baseVersion: null, messages: [], next: [] })).outcome).toBe("not_in_progress");
    // 열기가 정리를 함께 부른다
    const another = await opened(newVol());
    clock += 7 * HOUR;
    const fresh = await claimed(newVol());
    expect((await research.open(fresh.id, fresh.volunteerId)).outcome).toBe("ok");
    expect((await requests.get(another.id))?.status).toBe("waiting");
  });

  it("usage는 세션이 지워져도 남고, 요청이 지워지면 정리된다", async () => {
    const r = await opened(newVol());
    const caps = { turns: 1, searches: 12, photoUploads: 6, reviews: 3, dailySearches: 60, dailyAi: 600 };
    await research.begin({ ...r.actor, kind: "turn", clientTurnId: "a", caps });
    await requests.release(r.id, r.volunteerId);
    await requests.claim(r.id, r.volunteerId);
    const again = await research.open(r.id, r.volunteerId);
    const actor = { ...r.actor, sessionId: again.outcome === "ok" ? again.view.sessionId : null };
    expect(await research.begin({ ...actor, kind: "turn", clientTurnId: "b", caps })).toMatchObject({ ai: "capped" });
  });
});

// ---------- Supabase판(가짜 클라이언트) ----------

describe("Supabase 저장소", () => {
  function fakeClient(handler: (fn: string, args: Record<string, unknown>) => DbResult | Error): { client: RpcClient; calls: { fn: string; args: Record<string, unknown> }[] } {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        const out = handler(fn, args);
        if (out instanceof Error) return Promise.reject(out);
        return Promise.resolve(out);
      },
      from() {
        throw new Error("unused");
      },
    } as unknown as RpcClient;
    return { client, calls };
  }
  const actor: ResearchActor = { requestId: "r1", volunteerId: "d-0123456789abcdef", sessionId: "s1" };

  it("RPC 이름과 인자를 SQL 함수 모양으로 넘긴다", async () => {
    const { client, calls } = fakeClient(() => ({ data: { outcome: "stale", version: 3 }, error: null }));
    const store: ResearchStore = createSupabaseResearchStore(client);
    expect(await store.begin({ ...actor, kind: "search", cacheKey: "k", units: 3 })).toEqual({ outcome: "stale", version: 3 });
    expect(calls[0].fn).toBe("research_begin");
    expect(calls[0].args).toMatchObject({
      p_request_id: "r1", p_volunteer_id: "d-0123456789abcdef", p_session_id: "s1", p_kind: "search",
      p_cache_key: "k", p_units: 3, p_base_version: null,
    });
    expect((calls[0].args.p_caps as { turns: number }).turns).toBe(40);
    await store.open("r1", "v", 4);
    expect(calls[1]).toMatchObject({ fn: "research_open", args: { p_request_id: "r1", p_volunteer_id: "v", p_after: 4 } });
    await store.apply({ ...actor, clientTurnId: "t", baseVersion: 1, patch: { purchase: "bought" }, messages: [], next: [] });
    expect(calls[2]).toMatchObject({ fn: "research_apply", args: { p_client_turn_id: "t", p_base_version: 1, p_patch: { purchase: "bought" } } });
    await store.removePhoto(actor, "p1");
    expect(calls[3]).toMatchObject({ fn: "research_remove_photo", args: { p_photo_id: "p1" } });
    await store.setReview({ ...actor, baseVersion: 2, text: "글", status: "confirmed" });
    expect(calls[4]).toMatchObject({ fn: "research_set_review", args: { p_review: { text: "글", status: "confirmed" } } });
    await store.send({ ...actor, baseVersion: 2, reviewRev: 1, candidates: [{}] });
    expect(calls[5]).toMatchObject({ fn: "research_send", args: { p_review_rev: 1 } });
  });

  it("표·함수가 없거나 오류면 메모리로 떨어지지 않고 StoreUnavailableError다", async () => {
    for (const code of ["PGRST202", "42883", "42P01", "XX000"]) {
      const { client } = fakeClient(() => ({ data: null, error: { code, message: "boom" } }));
      await expect(createSupabaseResearchStore(client).open("r", "v")).rejects.toBeInstanceOf(StoreUnavailableError);
    }
    const thrown = fakeClient(() => new Error("network"));
    await expect(createSupabaseResearchStore(thrown.client).sweep()).rejects.toBeInstanceOf(StoreUnavailableError);
    const odd = fakeClient(() => ({ data: "oops", error: null }));
    await expect(createSupabaseResearchStore(odd.client).open("r", "v")).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("교착(40P01)은 한 번 다시 시도한다", async () => {
    let n = 0;
    const { client, calls } = fakeClient(() => {
      n += 1;
      return n === 1
        ? { data: null, error: { code: "40P01", message: "deadlock" } }
        : { data: { outcome: "ok", view: {} }, error: null };
    });
    expect((await createSupabaseResearchStore(client).open("r", "v")).outcome).toBe("ok");
    expect(calls.length).toBe(2);
    n = -5; // 계속 교착이면 두 번째에서 포기
    const { client: c2 } = fakeClient(() => ({ data: null, error: { code: "40P01" } }));
    await expect(createSupabaseResearchStore(c2).open("r", "v")).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("sweep은 정수를 그대로 돌려준다", async () => {
    const { client } = fakeClient(() => ({ data: 2, error: null }));
    expect(await createSupabaseResearchStore(client).sweep()).toBe(2);
  });
});

describe("저장소 선택", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetRequestStoresForTest();
    resetResearchStoresForTest();
  });

  it("Supabase 변수가 없거나 STORE_MODE=memory이면 메모리판을, 있으면 Supabase판을 쓴다", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetRequestStoresForTest();
    resetResearchStoresForTest();
    expect(getResearchStore().storeKind()).toBe("memory");
    expect(getResearchStore()).toBe(getResearchStore());
    Object.assign(process.env, { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "k" });
    delete process.env.STORE_MODE;
    resetRequestStoresForTest();
    resetResearchStoresForTest();
    expect(getResearchStore().storeKind()).toBe("supabase");
    process.env.STORE_MODE = "memory";
    process.env.VERCEL_ENV = "preview";
    resetRequestStoresForTest();
    resetResearchStoresForTest();
    expect(getResearchStore().storeKind()).toBe("memory");
    // 운영에서는 STORE_MODE=memory를 무시한다(requestStore와 같다).
    process.env.VERCEL_ENV = "production";
    resetRequestStoresForTest();
    resetResearchStoresForTest();
    expect(getResearchStore().storeKind()).toBe("supabase");
  });
});
