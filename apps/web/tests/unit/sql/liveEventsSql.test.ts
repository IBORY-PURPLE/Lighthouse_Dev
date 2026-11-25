import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// /live 대화 기록 SQL 시험(PGlite = 진짜 Postgres를 WASM으로). 마이그레이션 20261125000000_live_events.sql.
// 앞선 마이그레이션 9개(20261109175932 … 20261124000000)를 순서대로 적용한 뒤 이 표만 더한다.

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const BEFORE = [
  "supabase/migrations/20261109175932_requests.sql",
  "supabase/migrations/20261112010000_volunteer_flow.sql",
  "supabase/migrations/20261117000000_research_conversation.sql",
  "supabase/migrations/20261117010000_research_review_draft_base.sql",
  "supabase/migrations/20261119000000_photo_links.sql",
  "supabase/migrations/20261120000000_push_subscriptions.sql",
  "supabase/migrations/20261122000000_request_details.sql",
  "supabase/migrations/20261123000000_request_device.sql",
  "supabase/migrations/20261124000000_register_request_lock.sql",
];
const LIVE = "supabase/migrations/20261125000000_live_events.sql";
const DOWN = "supabase/rollback/20261125000000_live_events_down.sql";

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const DEVICE = `u-${"a".repeat(32)}`;

let db: PGlite;
let functionsBefore: string;

async function one<T>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(text, params)).rows[0];
}

// public 스키마의 모든 함수 정의를 한 덩어리로 모아 적용 전후를 비교한다(추가형 확인).
async function definitions(): Promise<string> {
  return (
    await one<{ d: string }>(
      `select string_agg(pg_get_functiondef(p.oid), E'\\n--\\n' order by p.oid::regprocedure::text) as d
         from pg_proc p where p.pronamespace = 'public'::regnamespace`,
    )
  ).d;
}

interface Row {
  cid?: string;
  seq?: number;
  device_id?: string;
  kind?: string;
  tag?: string;
  body?: string;
  phase?: string;
  engine?: string;
  at_ms?: number;
  label?: string;
  env?: string;
}

// 기본은 쓸 수 있는 줄. 시험하려는 열만 덮어쓴다.
async function insert(overrides: Row = {}): Promise<void> {
  const r = {
    cid: randomUUID(),
    seq: 0,
    device_id: DEVICE,
    kind: "user",
    tag: "heard",
    body: "소니 헤드셋 찾아 줘",
    phase: "listening",
    engine: "realtime",
    at_ms: 1200,
    label: "P01",
    env: "preview",
    ...overrides,
  };
  await db.query(
    `insert into public.live_events (cid, seq, device_id, kind, tag, body, phase, engine, at_ms, label, env)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [r.cid, r.seq, r.device_id, r.kind, r.tag, r.body, r.phase, r.engine, r.at_ms, r.label, r.env],
  );
}

async function accepts(overrides: Row): Promise<void> {
  await insert(overrides);
}

async function rejects(overrides: Row): Promise<void> {
  await expect(insert(overrides)).rejects.toThrow();
}

async function asServiceRole<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}

async function total(): Promise<number> {
  return (await one<{ n: number }>("select count(*)::int as n from public.live_events")).n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const file of BEFORE) await db.exec(sql(file));
  functionsBefore = await definitions();
  await db.exec(sql(LIVE));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("권한과 구조", () => {
  it("RLS가 켜져 있고 정책이 없다", async () => {
    const row = await one<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c where c.oid = to_regclass('public.live_events')`,
    );
    expect(row).toEqual({ rls: true, policies: 0 });
  });

  it("service_role은 INSERT·SELECT만 갖고, anon·authenticated는 아무것도 없다", async () => {
    const priv = await one<Record<string, boolean>>(
      `select has_table_privilege('service_role', 'public.live_events', 'select') as svc_select,
              has_table_privilege('service_role', 'public.live_events', 'insert') as svc_insert,
              has_table_privilege('service_role', 'public.live_events', 'update') as svc_update,
              has_table_privilege('service_role', 'public.live_events', 'delete') as svc_delete,
              has_table_privilege('service_role', 'public.live_events', 'truncate') as svc_truncate,
              has_table_privilege('service_role', 'public.live_events', 'references') as svc_references,
              has_table_privilege('service_role', 'public.live_events', 'trigger') as svc_trigger,
              has_table_privilege('anon', 'public.live_events', 'select') as anon_select,
              has_table_privilege('anon', 'public.live_events', 'insert') as anon_insert,
              has_table_privilege('anon', 'public.live_events', 'update') as anon_update,
              has_table_privilege('anon', 'public.live_events', 'delete') as anon_delete,
              has_table_privilege('authenticated', 'public.live_events', 'select') as auth_select,
              has_table_privilege('authenticated', 'public.live_events', 'insert') as auth_insert,
              has_table_privilege('authenticated', 'public.live_events', 'update') as auth_update,
              has_table_privilege('authenticated', 'public.live_events', 'delete') as auth_delete`,
    );
    expect(priv).toEqual({
      svc_select: true,
      svc_insert: true,
      svc_update: false,
      svc_delete: false,
      svc_truncate: false,
      svc_references: false,
      svc_trigger: false,
      anon_select: false,
      anon_insert: false,
      anon_update: false,
      anon_delete: false,
      auth_select: false,
      auth_insert: false,
      auth_update: false,
      auth_delete: false,
    });
  });

  it("service_role로 insert … on conflict do nothing과 select는 되고 update·delete는 거부된다", async () => {
    const cid = randomUUID();
    await asServiceRole(async () => {
      await db.query(
        `insert into public.live_events (cid, seq, device_id, kind, tag, body)
         values ($1, 0, $2, 'user', 'heard', '안녕') on conflict (cid, seq) do nothing`,
        [cid, DEVICE],
      );
      const read = await one<{ body: string }>("select body from public.live_events where cid = $1 and seq = 0", [cid]);
      expect(read.body).toBe("안녕");
      await expect(db.query("update public.live_events set body = '고침' where cid = $1", [cid])).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query("delete from public.live_events where cid = $1", [cid])).rejects.toThrow(/permission denied/);
      await expect(db.query("truncate public.live_events")).rejects.toThrow(/permission denied/);
    });
    expect((await one<{ body: string }>("select body from public.live_events where cid = $1", [cid])).body).toBe("안녕");
  });

  it("anon·authenticated는 읽지도 쓰지도 못한다", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query("select * from public.live_events")).rejects.toThrow(/permission denied/);
        await expect(
          db.query("insert into public.live_events (cid, seq, device_id, kind, tag) values ($1, 0, $2, 'user', 'x')", [
            randomUUID(),
            DEVICE,
          ]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  });

  it("기본 키는 (cid, seq)이고 device_id 색인이 있다", async () => {
    const pk = await one<{ cols: string }>(
      `select string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum)) as cols
         from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = 'public.live_events'::regclass and i.indisprimary`,
    );
    expect(pk.cols).toBe("cid,seq");
    const idx = await one<{ def: string }>(
      "select indexdef as def from pg_indexes where schemaname = 'public' and indexname = 'live_events_device_idx'",
    );
    expect(idx.def).toContain("(device_id, created_at)");
  });
});

describe("검사 경계값", () => {
  it("seq는 0~999만 받는다(-1·1000 거부)", async () => {
    await rejects({ seq: -1 });
    await accepts({ seq: 0 });
    await accepts({ seq: 999 });
    await rejects({ seq: 1000 });
  });

  it("body는 한글 1,000자까지 받고 1,001자는 거부한다(바이트가 아니라 글자 수)", async () => {
    await accepts({ body: "가".repeat(1000) });
    await rejects({ body: "가".repeat(1001) });
  });

  it("kind는 user·ai·app·event만 받는다", async () => {
    await accepts({ kind: "user" });
    await accepts({ kind: "ai", tag: "reply" });
    await accepts({ kind: "app", tag: "say:greet" });
    await accepts({ kind: "event", tag: "START", body: "" });
    await rejects({ kind: "system" });
    await rejects({ kind: "" });
    await rejects({ kind: "USER" });
  });

  it("device_id는 u- 뒤 소문자 16진 32자만 받는다", async () => {
    await accepts({ device_id: `u-${"0123456789abcdef".repeat(2)}` });
    await rejects({ device_id: `u-${"a".repeat(31)}` });
    await rejects({ device_id: `u-${"a".repeat(33)}` });
    await rejects({ device_id: `u-${"A".repeat(32)}` });
    await rejects({ device_id: `d-${"a".repeat(32)}` });
    await rejects({ device_id: `u-${"g".repeat(32)}` });
    await rejects({ device_id: "" });
  });

  it("tag는 영문·숫자·_:.-만 받고 한글·공백은 거부한다(40자 상한)", async () => {
    await accepts({ tag: "TURN_RESULT:ok" });
    await accepts({ tag: "say:greet.v2-a" });
    await accepts({ tag: "a".repeat(40) });
    await accepts({ tag: "" });
    await rejects({ tag: "a".repeat(41) });
    await rejects({ tag: "들었어요" });
    await rejects({ tag: "two words" });
    await rejects({ tag: "tab\there" });
  });

  it("label은 12자까지, 13자는 거부한다", async () => {
    await accepts({ label: "a".repeat(12) });
    await accepts({ label: "" });
    await rejects({ label: "a".repeat(13) });
    await rejects({ label: "P 01" });
    await rejects({ label: "참가자" });
  });

  it("at_ms는 0~86,400,000만 받는다", async () => {
    await accepts({ at_ms: 0 });
    await accepts({ at_ms: 86_400_000 });
    await rejects({ at_ms: -1 });
    await rejects({ at_ms: 86_400_001 });
  });

  it("phase·engine·env 모양을 지킨다", async () => {
    await accepts({ phase: "" });
    await accepts({ phase: "a".repeat(16) });
    await rejects({ phase: "a".repeat(17) });
    await rejects({ phase: "Listening" });
    await rejects({ phase: "listen1" });
    await accepts({ engine: "" });
    await accepts({ engine: "fallback" });
    await rejects({ engine: "openai" });
    await accepts({ env: "production" });
    await accepts({ env: "" });
    await rejects({ env: "a".repeat(13) });
    await rejects({ env: "Preview" });
  });

  it("kind가 event이면 body는 비어야 하고 tag는 있어야 한다", async () => {
    await rejects({ kind: "event", tag: "START", body: "글" });
    await rejects({ kind: "event", tag: "", body: "" });
    await accepts({ kind: "event", tag: "START", body: "" });
  });

  it("kind가 user·ai·app이면 body가 있어도, 비어도 된다", async () => {
    await accepts({ kind: "user", tag: "heard", body: "말한 글" });
    await accepts({ kind: "ai", tag: "reply", body: "" });
    await accepts({ kind: "app", tag: "", body: "안내" });
  });

  it("NUL 글자는 text에 들어갈 수 없다(서버가 미리 공백으로 바꿔야 하는 이유)", async () => {
    await rejects({ body: "가\u0000나" });
  });
});

describe("기본값", () => {
  it("열을 생략하면 빈 글·0이 들어가고 created_at·delete_after가 채워진다", async () => {
    const cid = randomUUID();
    await db.query("insert into public.live_events (cid, seq, device_id, kind, tag) values ($1, 0, $2, 'user', 'heard')", [
      cid,
      DEVICE,
    ]);
    const row = await one<Record<string, unknown>>(
      "select body, phase, engine, at_ms, label, env, created_at is not null as has_created, delete_after is not null as has_after from public.live_events where cid = $1",
      [cid],
    );
    expect(row).toEqual({
      body: "",
      phase: "",
      engine: "",
      at_ms: 0,
      label: "",
      env: "",
      has_created: true,
      has_after: true,
    });
  });

  it("created_at은 지금 가까이, delete_after는 한국 날짜 + 30일이다", async () => {
    const cid = randomUUID();
    await insert({ cid });
    const row = await one<{ created_ok: boolean; after_ok: boolean; days: number }>(
      `select abs(extract(epoch from (now() - created_at))) < 60 as created_ok,
              delete_after = ((now() at time zone 'Asia/Seoul')::date + 30) as after_ok,
              (delete_after - (created_at at time zone 'Asia/Seoul')::date) as days
         from public.live_events where cid = $1`,
      [cid],
    );
    expect(row.created_ok).toBe(true);
    expect(row.after_ok).toBe(true);
    expect(row.days).toBe(30);
  });

  it("delete_after의 표 기본값 식이 한국 시간 기준이고 30일이다", async () => {
    // 위 시험은 UTC 날짜와 한국 날짜가 같은 시간대에는 기본값이 UTC 기준이어도 통과한다. 그래서 기본값 식 자체를 본다.
    const row = await one<{ expr: string }>(
      `select pg_get_expr(d.adbin, d.adrelid) as expr
         from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = 'public.live_events'::regclass and a.attname = 'delete_after'`,
    );
    expect(row.expr).toContain("Asia/Seoul");
    expect(row.expr).toMatch(/\+ 30\b/);
  });

  it("한국 날짜 기준이다: UTC 15시 이후(한국은 이미 다음 날)에도 한국 날짜 + 30일이다", async () => {
    // 같은 식을 고정 시각에 적용해 UTC 날짜와 한국 날짜가 갈리는 순간을 본다.
    const row = await one<{ kst: string; utc: string }>(
      `select (((timestamptz '2026-11-24 16:30:00+00') at time zone 'Asia/Seoul')::date + 30)::text as kst,
              (((timestamptz '2026-11-24 16:30:00+00') at time zone 'UTC')::date + 30)::text as utc`,
    );
    expect(row).toEqual({ kst: "2026-12-25", utc: "2026-12-24" });
  });
});

describe("멱등", () => {
  it("같은 (cid, seq)를 다시 넣으면 1줄이고 처음 값이 남는다", async () => {
    const cid = randomUUID();
    const upsert = (body: string) =>
      db.query(
        `insert into public.live_events (cid, seq, device_id, kind, tag, body) values ($1, 3, $2, 'user', 'heard', $3)
         on conflict (cid, seq) do nothing`,
        [cid, DEVICE, body],
      );
    await upsert("처음");
    await upsert("나중");
    const rows = await db.query<{ body: string }>("select body from public.live_events where cid = $1", [cid]);
    expect(rows.rows).toEqual([{ body: "처음" }]);
  });

  it("on conflict 없이 같은 (cid, seq)를 넣으면 거부한다", async () => {
    const cid = randomUUID();
    await insert({ cid, seq: 5 });
    await expect(insert({ cid, seq: 5 })).rejects.toThrow();
    await accepts({ cid, seq: 6 });
  });

  it("다른 기기가 같은 (cid, seq)를 쓰면 뒤 줄은 조용히 버려진다(알려진 약점)", async () => {
    const cid = randomUUID();
    await insert({ cid, seq: 0, body: "첫 기기" });
    await db.query(
      `insert into public.live_events (cid, seq, device_id, kind, tag, body) values ($1, 0, $2, 'user', 'heard', '다른 기기')
       on conflict (cid, seq) do nothing`,
      [cid, `u-${"b".repeat(32)}`],
    );
    const rows = await db.query<{ device_id: string; body: string }>(
      "select device_id, body from public.live_events where cid = $1",
      [cid],
    );
    expect(rows.rows).toEqual([{ device_id: DEVICE, body: "첫 기기" }]);
  });
});

describe("requests와 묶이지 않음", () => {
  it("같은 cid의 requests 행을 지워도 live_events 줄이 남는다", async () => {
    const cid = randomUUID();
    await db.query("select * from public.register_request($1, '소니 헤드셋', '10만 원', '새 제품', 'Sony', '헤드셋', 'new')", [
      cid,
    ]);
    await insert({ cid, seq: 0 });
    await insert({ cid, seq: 1, kind: "ai", tag: "reply", body: "찾는 순서를 알려 드릴게요" });
    await db.query("delete from public.requests where client_request_id = $1", [cid]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.requests where client_request_id = $1", [cid])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from public.live_events where cid = $1", [cid])).n).toBe(2);
  });

  it("live_events에는 외래 키가 없다", async () => {
    const fk = await one<{ n: number }>(
      "select count(*)::int as n from pg_constraint where conrelid = 'public.live_events'::regclass and contype = 'f'",
    );
    expect(fk.n).toBe(0);
  });
});

describe("삭제 SQL", () => {
  it("delete_after가 지난 줄만 지워진다(postgres 역할로)", async () => {
    const old = randomUUID();
    const edge = randomUUID();
    const fresh = randomUUID();
    await insert({ cid: old });
    await insert({ cid: edge });
    await insert({ cid: fresh });
    // service_role은 update 권한이 없으므로 시험 준비는 postgres 역할로 한다.
    await db.query("update public.live_events set delete_after = current_date - 1 where cid = $1", [old]);
    await db.query("update public.live_events set delete_after = current_date where cid = $1", [edge]);
    await db.query("update public.live_events set delete_after = current_date + 1 where cid = $1", [fresh]);
    await db.exec("delete from public.live_events where delete_after <= current_date;");
    const left = await db.query<{ cid: string }>("select cid from public.live_events where cid = any($1::uuid[])", [
      [old, edge, fresh],
    ]);
    expect(left.rows.map((r) => r.cid)).toEqual([fresh]);
  });
});

describe("추가형", () => {
  it("public 함수 정의는 이 마이그레이션 적용 전후로 그대로다", async () => {
    expect(functionsBefore.length).toBeGreaterThan(0);
    expect(functionsBefore).toContain("register_request");
    expect(await definitions()).toBe(functionsBefore);
  });
});

describe("되돌리기", () => {
  it("down 파일이 표를 지우고, 기존 함수는 그대로 두며, 다시 적용된다", async () => {
    await insert();
    expect(await total()).toBeGreaterThan(0);
    await db.exec(sql(DOWN));
    expect(await one<{ t: string | null }>("select to_regclass('public.live_events')::text as t")).toEqual({ t: null });
    expect(await definitions()).toBe(functionsBefore);
    // 두 번 돌려도 오류가 없다(if exists).
    await db.exec(sql(DOWN));
    // 다시 적용되고, 권한도 처음과 같다.
    await db.exec(sql(LIVE));
    expect(await total()).toBe(0);
    const priv = await one<{ ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('service_role', 'public.live_events', 'insert') as ins,
              has_table_privilege('service_role', 'public.live_events', 'update') as upd,
              has_table_privilege('service_role', 'public.live_events', 'delete') as del`,
    );
    expect(priv).toEqual({ ins: true, upd: false, del: false });
  });
});
