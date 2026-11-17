import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 휴대폰 사진 링크 SQL 시험(PGlite = 진짜 Postgres를 WASM으로). design.md 3.3·5.2, 마이그레이션 2.
// 한계: PGlite는 연결이 하나라 진짜 동시 실행(잠금 대기)은 못 본다. 경합은 "단계를 나눠 부르는" 순서로만 재현한다.

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const MIGRATIONS = [
  "supabase/migrations/20261109175932_requests.sql",
  "supabase/migrations/20261112010000_volunteer_flow.sql",
  "supabase/migrations/20261117000000_research_conversation.sql",
  "supabase/migrations/20261117010000_research_review_draft_base.sql",
];
const PHOTO_LINKS = "supabase/migrations/20261119000000_photo_links.sql";
const DOWN = "supabase/rollback/20261119000000_photo_links_down.sql";
const EXISTING_FUNCTIONS = ["register_request", "claim_request", "release_request", "complete_request", "reset_demo_requests"];

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

let db: PGlite;
let existingBefore: Record<string, string>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const newHash = () => hash(randomUUID());
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

async function call(text: string, params: unknown[] = []): Promise<Json> {
  const out = await db.query<{ r: Json }>(`select ${text} as r`, params);
  return out.rows[0].r;
}

async function one<T = Json>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(text, params)).rows[0];
}

function vol(): string {
  return `d-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

interface Opened {
  id: string;
  volunteerId: string;
  sessionId: string;
}

async function opened(volunteerId = vol()): Promise<Opened> {
  const created = await db.query<{ out_request_id: string }>(
    "select * from public.register_request($1, '소니 헤드셋', '10만 원', '새 제품', 'Sony', '헤드셋', 'new')",
    [randomUUID()],
  );
  const id = created.rows[0].out_request_id;
  await db.query("select public.claim_request($1, $2)", [id, volunteerId]);
  const o = await call("public.research_open($1::uuid, $2, $3::int)", [id, volunteerId, null]);
  expect(o.outcome).toBe("ok");
  return { id, volunteerId, sessionId: o.view.sessionId as string };
}

const issue = (r: Opened, tokenHash: string, session = r.sessionId, volunteerId = r.volunteerId) =>
  call("public.photo_link_issue($1::uuid, $2, $3::uuid, $4)", [r.id, volunteerId, session, tokenHash]);
const redeem = (tokenHash: string, grantHash: string) => call("public.photo_link_redeem($1, $2)", [tokenHash, grantHash]);
const check = (grantHash: string) => call("public.photo_link_check($1)", [grantHash]);
const state = (r: Opened) => call("public.photo_link_state($1::uuid, $2, $3::uuid)", [r.id, r.volunteerId, r.sessionId]);
const revoke = (r: Opened, session = r.sessionId) =>
  call("public.photo_link_revoke($1::uuid, $2, $3::uuid)", [r.id, r.volunteerId, session]);

function addPhoto(r: Opened, grant: string | null, session: string | null = r.sessionId, volunteerId = r.volunteerId) {
  return call(
    "public.research_add_photo($1::uuid, $2, $3::uuid, $4, null, null, null, null, '[]'::jsonb, '[]'::jsonb, $5)",
    [r.id, volunteerId, session, JPEG, grant],
  );
}

/** 링크를 만들고 휴대폰이 쓴 상태(grant 발급)까지 간다. */
async function connected(r: Opened) {
  const token = newHash();
  const grant = newHash();
  expect((await issue(r, token)).outcome).toBe("ok");
  expect((await redeem(token, grant)).outcome).toBe("ok");
  return { token, grant };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const file of MIGRATIONS.slice(0, 2)) await db.exec(sql(file));
  for (const file of MIGRATIONS.slice(2)) await db.exec(sql(file));
  existingBefore = {};
  for (const name of EXISTING_FUNCTIONS) {
    existingBefore[name] = (
      await one<{ d: string }>(
        "select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace",
        [name],
      )
    ).d;
  }
  await db.exec(sql(PHOTO_LINKS));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("권한과 구조", () => {
  it("photo_links는 RLS가 켜져 있고 정책이 없으며 service_role만 쓴다", async () => {
    const row = await one<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c where c.oid = to_regclass('public.photo_links')`,
    );
    expect(row).toEqual({ rls: true, policies: 0 });
    const priv = await one<{ a: boolean; b: boolean; s: boolean }>(
      `select has_table_privilege('anon', 'public.photo_links', 'select') as a,
              has_table_privilege('authenticated', 'public.photo_links', 'select') as b,
              has_table_privilege('service_role', 'public.photo_links', 'select') as s`,
    );
    expect(priv).toEqual({ a: false, b: false, s: true });
  });

  it("함수 4개(issue·redeem·check·revoke)와 state, 바뀐 add_photo는 service_role만 부른다", async () => {
    const rows = await db.query<{ name: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean; definer: boolean; cfg: string | null }>(
      `select p.oid::regprocedure::text as name,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), false) as pub,
              p.prosecdef as definer, array_to_string(p.proconfig, ',') as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'photo\\_link\\_%' or p.proname = 'research_add_photo')`,
    );
    const names = rows.rows.map((r) => r.name);
    for (const fn of ["photo_link_issue", "photo_link_redeem", "photo_link_check", "photo_link_revoke", "photo_link_state"]) {
      expect(names.some((n) => n.startsWith(`${fn}(`)), fn).toBe(true);
    }
    // add_photo는 인자 11개 하나만 남는다(옛 인자 10개는 지웠다).
    const addPhotos = names.filter((n) => n.startsWith("research_add_photo("));
    expect(addPhotos).toHaveLength(1);
    expect(addPhotos[0]).toMatch(/text\)$/);
    expect(rows.rows).toHaveLength(6);
    for (const row of rows.rows) {
      expect(row, row.name).toMatchObject({ anon: false, auth: false, svc: true, pub: false, definer: false });
      expect(row.cfg ?? "", row.name).toMatch(/search_path=""/);
    }
  });

  it("기존 함수 5개의 정의는 그대로다", async () => {
    for (const name of EXISTING_FUNCTIONS) {
      const row = await one<{ d: string }>(
        "select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace",
        [name],
      );
      expect(row.d, name).toBe(existingBefore[name]);
    }
  });
});

describe("photo_link_issue", () => {
  it("해시만 저장하고 만료는 10분이다", async () => {
    const r = await opened();
    const token = newHash();
    const out = await issue(r, token);
    expect(out.outcome).toBe("ok");
    const row = await one<{ token_hash: string; used_at: string | null; grant_hash: string | null; minutes: number }>(
      "select token_hash, used_at, grant_hash, extract(epoch from (expires_at - created_at)) / 60 as minutes from public.photo_links where request_id = $1",
      [r.id],
    );
    expect(row.token_hash).toBe(token);
    expect(row.used_at).toBeNull();
    expect(row.grant_hash).toBeNull();
    expect(Number(row.minutes)).toBeCloseTo(10, 3);
  });

  it("새로 만들면 앞 링크는 끊긴다", async () => {
    const r = await opened();
    const first = newHash();
    const second = newHash();
    await issue(r, first);
    await issue(r, second);
    expect((await redeem(first, newHash())).outcome).toBe("gone");
    expect((await redeem(second, newHash())).outcome).toBe("ok");
  });

  it("해시 모양이 틀리면 bad_request, 세션·소유가 틀리면 막는다", async () => {
    const r = await opened();
    expect((await issue(r, "not-a-hash")).outcome).toBe("bad_request");
    expect((await issue(r, newHash(), randomUUID())).outcome).toBe("session_changed");
    expect((await issue(r, newHash(), r.sessionId, vol())).outcome).toBe("not_yours");
    expect((await issue(r, newHash(), null as unknown as string)).outcome).toBe("bad_request");
    const missing = { ...r, id: randomUUID() };
    expect((await issue(missing, newHash())).outcome).toBe("not_found");
  });

  it("리서치만이면 photo_not_needed, 사진 3장이면 photos_full", async () => {
    const research = await opened();
    const applied = await call(
      "public.research_apply($1::uuid, $2, $3::uuid, 't1', 0, $4::jsonb, '[]'::jsonb, '[]'::jsonb)",
      [research.id, research.volunteerId, research.sessionId, JSON.stringify({ purchase: "research" })],
    );
    expect(applied.outcome).toBe("ok");
    expect((await issue(research, newHash())).outcome).toBe("photo_not_needed");

    const full = await opened();
    for (let index = 0; index < 3; index += 1) expect((await addPhoto(full, null)).outcome).toBe("ok");
    expect((await issue(full, newHash())).outcome).toBe("photos_full");
  });
});

describe("photo_link_redeem", () => {
  it("한 번만 쓸 수 있고 grant는 30분이다", async () => {
    const r = await opened();
    const token = newHash();
    const grant = newHash();
    await issue(r, token);
    const out = await redeem(token, grant);
    expect(out.outcome).toBe("ok");
    const row = await one<{ minutes: number; used: boolean }>(
      "select extract(epoch from (grant_expires_at - used_at)) / 60 as minutes, used_at is not null as used from public.photo_links where token_hash = $1",
      [token],
    );
    expect(row.used).toBe(true);
    expect(Number(row.minutes)).toBeCloseTo(30, 3);
    // 두 번째는 gone(410).
    expect((await redeem(token, newHash())).outcome).toBe("gone");
  });

  it("모르는 링크·만료·끊김은 gone, 모양이 틀리면 bad_request", async () => {
    const r = await opened();
    expect((await redeem(newHash(), newHash())).outcome).toBe("gone");
    expect((await redeem("zzz", newHash())).outcome).toBe("bad_request");
    expect((await redeem(newHash(), "zzz")).outcome).toBe("bad_request");

    const expired = newHash();
    await issue(r, expired);
    await db.query("update public.photo_links set expires_at = now() - interval '1 second' where token_hash = $1", [expired]);
    expect((await redeem(expired, newHash())).outcome).toBe("gone");

    const revoked = newHash();
    await issue(r, revoked);
    expect((await revoke(r)).outcome).toBe("ok");
    expect((await redeem(revoked, newHash())).outcome).toBe("gone");
  });

  it("요청을 내려놓으면 링크도 지워져 gone이다", async () => {
    const r = await opened();
    const token = newHash();
    await issue(r, token);
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.photo_links where request_id = $1", [r.id])).n).toBe(0);
    expect((await redeem(token, newHash())).outcome).toBe("gone");
  });

  it("쓰면 같은 세션의 다른 grant는 끊긴다", async () => {
    const r = await opened();
    const first = await connected(r);
    expect((await check(first.grant)).outcome).toBe("ok");
    const second = await connected(r);
    expect((await check(second.grant)).outcome).toBe("ok");
    expect((await check(first.grant)).outcome).toBe("gone");
  });
});

describe("photo_link_check와 state", () => {
  it("grant가 살아 있으면 요청·세션·봉사자를 돌려주고, 만료·끊김·내려놓기는 gone", async () => {
    const r = await opened();
    const { grant } = await connected(r);
    const out = await check(grant);
    expect(out).toMatchObject({ outcome: "ok", requestId: r.id, volunteerId: r.volunteerId, sessionId: r.sessionId });
    expect(await check(newHash())).toEqual({ outcome: "gone" });
    expect(await check("zzz")).toEqual({ outcome: "gone" });

    await db.query("update public.photo_links set grant_expires_at = now() - interval '1 second' where grant_hash = $1", [grant]);
    expect((await check(grant)).outcome).toBe("gone");

    const second = await connected(r);
    expect((await check(second.grant)).outcome).toBe("ok");
    await revoke(r);
    expect((await check(second.grant)).outcome).toBe("gone");

    const third = await connected(r);
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]);
    expect((await check(third.grant)).outcome).toBe("gone");
  });

  it("state: none → waiting → connected → expired", async () => {
    const r = await opened();
    expect(await state(r)).toEqual({ outcome: "ok", state: "none", expiresAt: null });
    const token = newHash();
    await issue(r, token);
    const waiting = await state(r);
    expect(waiting).toMatchObject({ outcome: "ok", state: "waiting" });
    expect(Date.parse(waiting.expiresAt)).toBeGreaterThan(Date.now());
    await redeem(token, newHash());
    expect(await state(r)).toMatchObject({ state: "connected" });
    await db.query("update public.photo_links set grant_expires_at = now() - interval '1 second' where request_id = $1", [r.id]);
    expect(await state(r)).toMatchObject({ state: "expired" });
    await revoke(r);
    expect(await state(r)).toMatchObject({ state: "none" });
  });

  it("state는 다른 봉사자·다른 세션에게는 none이다", async () => {
    const r = await opened();
    await issue(r, newHash());
    expect(await call("public.photo_link_state($1::uuid, $2, $3::uuid)", [r.id, vol(), r.sessionId])).toMatchObject({ state: "none" });
    expect(await call("public.photo_link_state($1::uuid, $2, $3::uuid)", [r.id, r.volunteerId, randomUUID()])).toMatchObject({ state: "none" });
  });
});

describe("research_add_photo의 grant 재확인", () => {
  it("살아 있는 grant로는 올라가고 사진 칸·말풍선 규칙은 그대로다", async () => {
    const r = await opened();
    const { grant } = await connected(r);
    const out = await addPhoto(r, grant);
    expect(out.outcome).toBe("ok");
    expect(out.photoId).toBeTruthy();
    const photos = await one<{ n: number }>("select count(*)::int as n from public.research_photos where request_id = $1", [r.id]);
    expect(photos.n).toBe(1);
  });

  it("grant 없이 올리는 노트북 경로는 지금까지와 같다", async () => {
    const r = await opened();
    expect((await addPhoto(r, null)).outcome).toBe("ok");
  });

  it("틀린·만료·끊긴 grant와 session_id 없는 grant는 사진을 넣지 않는다", async () => {
    const r = await opened();
    const { grant } = await connected(r);
    expect((await addPhoto(r, newHash())).outcome).toBe("grant_gone");
    expect((await addPhoto(r, grant, null)).outcome).toBe("grant_gone");
    expect((await addPhoto(r, grant, randomUUID())).outcome).toBe("session_changed");
    await db.query("update public.photo_links set grant_expires_at = now() - interval '1 second' where grant_hash = $1", [grant]);
    expect((await addPhoto(r, grant)).outcome).toBe("grant_gone");

    const again = await connected(r);
    await revoke(r);
    expect((await addPhoto(r, again.grant)).outcome).toBe("grant_gone");
    const count = await one<{ n: number }>("select count(*)::int as n from public.research_photos where request_id = $1", [r.id]);
    expect(count.n).toBe(0);
  });

  it("다른 요청의 grant로는 올릴 수 없다", async () => {
    const a = await opened();
    const b = await opened();
    const { grant } = await connected(a);
    expect((await addPhoto(b, grant)).outcome).toBe("grant_gone");
  });

  it("새 링크 세션이 바뀌면(다시 열림) 옛 grant는 쓸 수 없다", async () => {
    const r = await opened();
    const { grant } = await connected(r);
    // 요청을 놓았다가 같은 봉사자가 다시 맡으면 세션이 새로 생긴다.
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]);
    await db.query("select public.claim_request($1, $2)", [r.id, r.volunteerId]);
    const again = await call("public.research_open($1::uuid, $2, null::int)", [r.id, r.volunteerId]);
    expect(again.outcome).toBe("ok");
    const fresh = { ...r, sessionId: again.view.sessionId as string };
    expect(fresh.sessionId).not.toBe(r.sessionId);
    expect((await addPhoto(fresh, grant)).outcome).toBe("grant_gone");
    expect((await check(grant)).outcome).toBe("gone");
  });
});

describe("마이그레이션 되돌리기", () => {
  it("적용 → 되돌리기 → 다시 적용", async () => {
    await db.exec(sql(DOWN));
    expect((await one<{ t: string | null }>("select to_regclass('public.photo_links')::text as t")).t).toBeNull();
    const fns = await one<{ n: number }>(
      "select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'photo\\_link\\_%'",
    );
    expect(fns.n).toBe(0);
    const addPhotos = await db.query<{ name: string }>(
      "select p.oid::regprocedure::text as name from pg_proc p where p.proname = 'research_add_photo' and p.pronamespace = 'public'::regnamespace",
    );
    expect(addPhotos.rows).toHaveLength(1);
    expect(addPhotos.rows[0].name).toMatch(/jsonb\)$/);
    // 옛 add_photo가 돈다.
    const r = await opened();
    const old = await call(
      "public.research_add_photo($1::uuid, $2, $3::uuid, $4, null, null, null, null, '[]'::jsonb, '[]'::jsonb)",
      [r.id, r.volunteerId, r.sessionId, JPEG],
    );
    expect(old.outcome).toBe("ok");
    // 다시 적용해도 된다.
    await db.exec(sql(PHOTO_LINKS));
    const r2 = await opened();
    const { grant } = await connected(r2);
    expect((await addPhoto(r2, grant)).outcome).toBe("ok");
  });
});
