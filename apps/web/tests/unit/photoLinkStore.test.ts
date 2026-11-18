import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHOTO_GRANT_TTL_MS, PHOTO_LINK_TTL_MS } from "@/lib/photoLink";
import { createMemoryStore, type DbResult, type RequestStore, type RpcClient } from "@/lib/requestStore";
import {
  createMemoryResearchStore,
  createSupabaseResearchStore,
  type ResearchActor,
} from "@/lib/researchStore";

// 휴대폰 사진 링크: 메모리 저장소(SQL과 같은 동작)와 Supabase 저장소가 SQL 함수를 부르는 모양.
// 토큰·만료·재사용 410·다른 세션 거부·grant 만료(design.md 3.3, 합격 기준 7).

const T0 = Date.parse("2026-11-19T01:00:00Z");
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fresh = () => hash(randomUUID());

let clock = T0;
let requests: RequestStore;
let research: ReturnType<typeof createMemoryResearchStore>;

async function opened(volunteerId = `d-${randomUUID().replace(/-/g, "").slice(0, 16)}`) {
  const reg = await requests.register({
    clientRequestId: randomUUID(),
    product: "소니 헤드셋",
    budget: "10만 원",
    condition: "새 제품",
    brand: "Sony",
    item: "헤드셋",
    conditionKind: "new",
    deviceId: null,
  });
  expect(await requests.claim(reg.requestId, volunteerId)).toBe("claimed");
  const o = await research.open(reg.requestId, volunteerId);
  if (o.outcome !== "ok") throw new Error(o.outcome);
  const actor: ResearchActor = { requestId: reg.requestId, volunteerId, sessionId: o.view.sessionId };
  return actor;
}

const photo = (actor: ResearchActor, grantHash: string | null) =>
  research.addPhoto({ ...actor, thumb: JPEG, messages: [], next: [], grantHash });

/** 링크를 만들고 휴대폰이 쓴 상태(grant)까지. */
async function connected(actor: ResearchActor) {
  const token = fresh();
  const grant = fresh();
  expect((await research.issuePhotoLink(actor, token)).outcome).toBe("ok");
  expect((await research.redeemPhotoLink(token, grant)).outcome).toBe("ok");
  return { token, grant };
}

beforeEach(() => {
  clock = T0;
  requests = createMemoryStore({ now: () => clock });
  research = createMemoryResearchStore(requests, { now: () => clock });
});

afterEach(() => {
  research.close();
});

describe("링크 만들기", () => {
  it("만료는 10분이고 상태는 waiting이다", async () => {
    const actor = await opened();
    expect(await research.photoLinkState(actor)).toEqual({ state: "none", expiresAt: null });
    const out = await research.issuePhotoLink(actor, fresh());
    expect(out).toEqual({ outcome: "ok", expiresAt: new Date(T0 + PHOTO_LINK_TTL_MS).toISOString() });
    expect(PHOTO_LINK_TTL_MS).toBe(10 * 60_000);
    expect(await research.photoLinkState(actor)).toEqual({ state: "waiting", expiresAt: new Date(T0 + PHOTO_LINK_TTL_MS).toISOString() });
    clock = T0 + PHOTO_LINK_TTL_MS;
    expect((await research.photoLinkState(actor)).state).toBe("expired");
  });

  it("새로 만들면 앞 링크는 끊긴다", async () => {
    const actor = await opened();
    const first = fresh();
    const second = fresh();
    await research.issuePhotoLink(actor, first);
    await research.issuePhotoLink(actor, second);
    expect(await research.redeemPhotoLink(first, fresh())).toEqual({ outcome: "gone" });
    expect((await research.redeemPhotoLink(second, fresh())).outcome).toBe("ok");
  });

  it("해시 모양이 틀리거나 소유·세션이 다르면 만들지 않는다", async () => {
    const actor = await opened();
    expect((await research.issuePhotoLink(actor, "plain-token")).outcome).toBe("bad_request");
    expect((await research.issuePhotoLink({ ...actor, sessionId: randomUUID() }, fresh())).outcome).toBe("session_changed");
    expect((await research.issuePhotoLink({ ...actor, volunteerId: "d-ffffffffffffffff" }, fresh())).outcome).toBe("not_yours");
    expect((await research.issuePhotoLink({ ...actor, requestId: randomUUID() }, fresh())).outcome).toBe("not_found");
  });

  it("리서치만이거나 사진이 3장이면 만들지 않는다", async () => {
    const research1 = await opened();
    await research.apply({
      ...research1, clientTurnId: "t1", baseVersion: 0, patch: { purchase: "research" }, messages: [], next: [],
    });
    expect((await research.issuePhotoLink(research1, fresh())).outcome).toBe("photo_not_needed");
    const full = await opened();
    for (let i = 0; i < 3; i += 1) expect((await photo(full, null)).outcome).toBe("ok");
    expect((await research.issuePhotoLink(full, fresh())).outcome).toBe("photos_full");
  });
});

describe("링크 쓰기와 열쇠", () => {
  it("한 번만 쓸 수 있고(두 번째 gone) grant는 30분이다", async () => {
    const actor = await opened();
    const token = fresh();
    const grant = fresh();
    await research.issuePhotoLink(actor, token);
    expect(await research.redeemPhotoLink(token, grant)).toEqual({
      outcome: "ok",
      grantExpiresAt: new Date(T0 + PHOTO_GRANT_TTL_MS).toISOString(),
    });
    expect(PHOTO_GRANT_TTL_MS).toBe(30 * 60_000);
    expect(await research.redeemPhotoLink(token, fresh())).toEqual({ outcome: "gone" });
    expect((await research.photoLinkState(actor)).state).toBe("connected");
    expect(await research.checkPhotoGrant(grant)).toMatchObject({ outcome: "ok", ...actor });
  });

  it("모르는 링크·만료된 링크는 gone, 모양이 틀리면 bad_request", async () => {
    const actor = await opened();
    expect(await research.redeemPhotoLink(fresh(), fresh())).toEqual({ outcome: "gone" });
    expect((await research.redeemPhotoLink("x", fresh())).outcome).toBe("bad_request");
    const token = fresh();
    await research.issuePhotoLink(actor, token);
    clock = T0 + PHOTO_LINK_TTL_MS + 1;
    expect(await research.redeemPhotoLink(token, fresh())).toEqual({ outcome: "gone" });
  });

  it("grant는 30분이 지나면 쓸 수 없다", async () => {
    const actor = await opened();
    const { grant } = await connected(actor);
    clock = T0 + PHOTO_GRANT_TTL_MS - 1;
    expect((await research.checkPhotoGrant(grant)).outcome).toBe("ok");
    expect((await photo(actor, grant)).outcome).toBe("ok");
    clock = T0 + PHOTO_GRANT_TTL_MS;
    expect(await research.checkPhotoGrant(grant)).toEqual({ outcome: "gone" });
    expect((await photo(actor, grant)).outcome).toBe("grant_gone");
    expect((await research.photoLinkState(actor)).state).toBe("expired");
  });

  it("새 grant가 생기면 앞 grant는 끊긴다", async () => {
    const actor = await opened();
    const first = await connected(actor);
    const second = await connected(actor);
    expect((await research.checkPhotoGrant(first.grant)).outcome).toBe("gone");
    expect((await photo(actor, first.grant)).outcome).toBe("grant_gone");
    expect((await photo(actor, second.grant)).outcome).toBe("ok");
  });

  it("revoke는 링크와 grant를 모두 끊는다", async () => {
    const actor = await opened();
    const { grant } = await connected(actor);
    expect(await research.revokePhotoLinks(actor)).toEqual({ outcome: "ok", revoked: 1 });
    expect((await research.checkPhotoGrant(grant)).outcome).toBe("gone");
    expect((await photo(actor, grant)).outcome).toBe("grant_gone");
    expect((await research.photoLinkState(actor)).state).toBe("none");
    expect((await research.revokePhotoLinks({ ...actor, sessionId: randomUUID() })).outcome).toBe("session_changed");
  });

  it("다른 세션의 열쇠로는 올릴 수 없고, 세션이 바뀌면 옛 열쇠는 죽는다", async () => {
    const a = await opened();
    const b = await opened();
    const { grant } = await connected(a);
    expect((await photo(b, grant)).outcome).toBe("grant_gone");
    expect((await photo({ ...a, sessionId: randomUUID() }, grant)).outcome).toBe("session_changed");
    // 놓았다가 다시 맡으면 세션이 새로 생기고 링크는 사라진다.
    await requests.release(a.requestId, a.volunteerId);
    expect(await research.checkPhotoGrant(grant)).toEqual({ outcome: "gone" });
    expect(await requests.claim(a.requestId, a.volunteerId)).toBe("claimed");
    const reopened = await research.open(a.requestId, a.volunteerId);
    if (reopened.outcome !== "ok") throw new Error(reopened.outcome);
    expect((await photo({ ...a, sessionId: reopened.view.sessionId }, grant)).outcome).toBe("grant_gone");
  });

  it("요청을 내려놓으면 링크도 쓸 수 없다", async () => {
    const actor = await opened();
    const token = fresh();
    await research.issuePhotoLink(actor, token);
    await requests.release(actor.requestId, actor.volunteerId);
    expect(await research.redeemPhotoLink(token, fresh())).toEqual({ outcome: "gone" });
  });

  it("grant 없이 올리는 노트북 경로는 그대로 된다", async () => {
    const actor = await opened();
    expect((await photo(actor, null)).outcome).toBe("ok");
  });
});

describe("Supabase 저장소가 SQL 함수를 부르는 모양", () => {
  function fakeClient(handler: (fn: string) => DbResult) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve(handler(fn));
      },
    } as unknown as RpcClient;
    return { client, calls };
  }
  const actor: ResearchActor = { requestId: "r1", volunteerId: "d-0123456789abcdef", sessionId: "s1" };

  it("issue·redeem·check·revoke·state의 이름과 인자", async () => {
    const { client, calls } = fakeClient(() => ({ data: { outcome: "ok", state: "waiting", expiresAt: "2026-11-19T01:10:00Z" }, error: null }));
    const store = createSupabaseResearchStore(client);
    await store.issuePhotoLink(actor, "h1");
    await store.redeemPhotoLink("h1", "g1");
    await store.checkPhotoGrant("g1");
    await store.revokePhotoLinks(actor);
    expect(await store.photoLinkState(actor)).toEqual({ state: "waiting", expiresAt: "2026-11-19T01:10:00Z" });
    expect(calls.map((c) => c.fn)).toEqual(["photo_link_issue", "photo_link_redeem", "photo_link_check", "photo_link_revoke", "photo_link_state"]);
    expect(calls[0].args).toEqual({ p_request_id: "r1", p_volunteer_id: "d-0123456789abcdef", p_session_id: "s1", p_token_hash: "h1" });
    expect(calls[1].args).toEqual({ p_token_hash: "h1", p_grant_hash: "g1" });
    expect(calls[2].args).toEqual({ p_grant_hash: "g1" });
    expect(calls[3].args).toEqual({ p_request_id: "r1", p_volunteer_id: "d-0123456789abcdef", p_session_id: "s1" });
  });

  it("add_photo는 grant가 있을 때만 p_grant_hash를 보낸다(마이그레이션 2 전의 옛 함수도 부를 수 있게)", async () => {
    const { client, calls } = fakeClient(() => ({ data: { outcome: "ok" }, error: null }));
    const store = createSupabaseResearchStore(client);
    await store.addPhoto({ ...actor, thumb: JPEG, messages: [], next: [] });
    await store.addPhoto({ ...actor, thumb: JPEG, messages: [], next: [], grantHash: "g1" });
    expect("p_grant_hash" in calls[0].args).toBe(false);
    expect(calls[1].args.p_grant_hash).toBe("g1");
  });

  it("state가 모르는 모양이면 StoreUnavailableError", async () => {
    const { client } = fakeClient(() => ({ data: { outcome: "ok", state: "weird" }, error: null }));
    await expect(createSupabaseResearchStore(client).photoLinkState(actor)).rejects.toThrow();
  });
});
