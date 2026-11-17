import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 이용자 요청 브리핑 SQL 시험(PGlite = 진짜 Postgres를 WASM으로). 마이그레이션 20261122000000_request_details.sql.
// 앞선 마이그레이션(20261109~20261120)에만 기대고, 아직 원격에 없는 다른 마이그레이션에는 기대지 않는다.

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const BEFORE = [
  "supabase/migrations/20261109175932_requests.sql",
  "supabase/migrations/20261112010000_volunteer_flow.sql",
  "supabase/migrations/20261117000000_research_conversation.sql",
  "supabase/migrations/20261117010000_research_review_draft_base.sql",
  "supabase/migrations/20261119000000_photo_links.sql",
  "supabase/migrations/20261120000000_push_subscriptions.sql",
];
const DETAILS = "supabase/migrations/20261122000000_request_details.sql";
const DOWN = "supabase/rollback/20261122000000_request_details_down.sql";
const EXISTING_FUNCTIONS = [
  "register_request",
  "claim_request",
  "release_request",
  "complete_request",
  "reset_demo_requests",
  "research_drop_on_leave",
];

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

let db: PGlite;
let existingBefore: Record<string, string>;

async function one<T>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(text, params)).rows[0];
}

async function definitions(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of EXISTING_FUNCTIONS) {
    out[name] = (
      await one<{ d: string }>(
        "select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace",
        [name],
      )
    ).d;
  }
  return out;
}

async function newRequest(): Promise<string> {
  const created = await db.query<{ out_request_id: string }>(
    "select * from public.register_request($1, '소니 헤드셋', '10만 원', '새 제품', 'Sony', '헤드셋', 'new')",
    [randomUUID()],
  );
  return created.rows[0].out_request_id;
}

const QA = JSON.stringify([{ q: "예산은 얼마인가요?", a: "십만 원 정도" }]);

async function save(id: string, summary = "소니 무선 헤드셋, 예산 십만 원", qa = QA): Promise<void> {
  await db.query("insert into public.request_details (request_id, summary, qa) values ($1, $2, $3::jsonb)", [
    id,
    summary,
    qa,
  ]);
}

async function count(id: string): Promise<number> {
  return (await one<{ n: number }>("select count(*)::int as n from public.request_details where request_id = $1", [id])).n;
}

async function status(id: string): Promise<string> {
  return (await one<{ status: string }>("select status from public.requests where id = $1", [id])).status;
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
  existingBefore = await definitions();
  await db.exec(sql(DETAILS));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("권한과 구조", () => {
  it("request_details는 RLS가 켜져 있고 정책이 없으며 service_role만 읽고 쓴다", async () => {
    const row = await one<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c where c.oid = to_regclass('public.request_details')`,
    );
    expect(row).toEqual({ rls: true, policies: 0 });
    // 시험 틀의 기본 권한(alter default privileges)을 마이그레이션의 revoke가 걷어 낸다. 운영과 같은 순서다.
    const priv = await one<Record<string, boolean>>(
      `select has_table_privilege('anon', 'public.request_details', 'select') as anon_select,
              has_table_privilege('anon', 'public.request_details', 'insert') as anon_insert,
              has_table_privilege('authenticated', 'public.request_details', 'select') as auth_select,
              has_table_privilege('authenticated', 'public.request_details', 'delete') as auth_delete,
              has_table_privilege('service_role', 'public.request_details', 'select') as svc_select,
              has_table_privilege('service_role', 'public.request_details', 'insert') as svc_insert,
              has_table_privilege('service_role', 'public.request_details', 'delete') as svc_delete`,
    );
    expect(priv).toEqual({
      anon_select: false,
      anon_insert: false,
      auth_select: false,
      auth_delete: false,
      svc_select: true,
      svc_insert: true,
      svc_delete: true,
    });
  });

  it("트리거 함수는 security invoker이고 search_path를 비운다", async () => {
    const row = await one<{ definer: boolean; cfg: string | null }>(
      `select p.prosecdef as definer, array_to_string(p.proconfig, ',') as cfg
         from pg_proc p where p.proname = 'request_details_drop_on_close' and p.pronamespace = 'public'::regnamespace`,
    );
    expect(row.definer).toBe(false);
    expect(row.cfg).toContain("search_path");
  });

  it("기존 함수 정의는 그대로다(추가형)", async () => {
    expect(await definitions()).toEqual(existingBefore);
  });
});

describe("검사", () => {
  it("12짝·300자는 들어가고 13짝·301자·배열 아님은 거절한다", async () => {
    const id = await newRequest();
    const pairs = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ q: `질문 ${i}`, a: `답 ${i}` })));
    await save(id, "가".repeat(300), pairs(12));
    expect(await count(id)).toBe(1);

    const other = await newRequest();
    await expect(save(other, "가".repeat(300), pairs(13))).rejects.toThrow();
    await expect(save(other, "가".repeat(301), pairs(1))).rejects.toThrow();
    await expect(save(other, "요약", JSON.stringify({ q: "a" }))).rejects.toThrow();
    expect(await count(other)).toBe(0);
  });

  it("qa 글자 수가 16,000바이트를 넘으면 거절한다", async () => {
    const id = await newRequest();
    const big = JSON.stringify(Array.from({ length: 12 }, () => ({ q: "가".repeat(600), a: "나".repeat(600) })));
    await expect(save(id, "요약", big)).rejects.toThrow();
  });

  it("없는 요청에는 달 수 없다(외래 키)", async () => {
    await expect(save(randomUUID())).rejects.toThrow();
  });

  it("요청당 하나다: 두 번째 insert는 거절하고, on conflict do nothing은 처음 것을 지킨다", async () => {
    const id = await newRequest();
    await save(id);
    await expect(save(id, "다른 요약")).rejects.toThrow();
    await db.query(
      "insert into public.request_details (request_id, summary) values ($1, '무시됨') on conflict (request_id) do nothing",
      [id],
    );
    expect((await one<{ summary: string }>("select summary from public.request_details where request_id = $1", [id])).summary).toBe(
      "소니 무선 헤드셋, 예산 십만 원",
    );
  });
});

describe("지우는 때", () => {
  it("요청이 지워지면 cascade로 같이 지워진다", async () => {
    const id = await newRequest();
    await save(id);
    await db.query("delete from public.requests where id = $1", [id]);
    expect(await count(id)).toBe(0);
  });

  it("맡기·내려놓기에서는 남고, 보내서 done이 되면 지운다", async () => {
    const id = await newRequest();
    await save(id);
    await db.query("select public.claim_request($1, $2)", [id, "d-aaaaaaaaaaaaaaaa"]);
    expect(await status(id)).toBe("in_progress");
    expect(await count(id)).toBe(1);
    await db.query("select public.release_request($1, $2)", [id, "d-aaaaaaaaaaaaaaaa"]);
    expect(await status(id)).toBe("waiting");
    expect(await count(id)).toBe(1);
    await db.query("select public.claim_request($1, $2)", [id, "d-bbbbbbbbbbbbbbbb"]);
    expect(await count(id)).toBe(1);
    await db.query("update public.requests set status = 'done', done_at = now() where id = $1", [id]);
    expect(await count(id)).toBe(0);
  });

  it("24시간 지난 대기 요청이 만료되면(register_request) 지운다", async () => {
    const id = await newRequest();
    await save(id);
    await db.query("update public.requests set created_at = now() - interval '25 hours' where id = $1", [id]);
    expect(await count(id)).toBe(1);
    await newRequest();
    expect(await status(id)).toBe("expired");
    expect(await count(id)).toBe(0);
  });

  it("status가 아닌 열을 고칠 때는 지우지 않는다", async () => {
    const id = await newRequest();
    await save(id);
    await db.query("update public.requests set updated_at = now() where id = $1", [id]);
    expect(await count(id)).toBe(1);
  });
});

describe("되돌리기", () => {
  it("down 파일이 표·트리거·함수를 지우고 기존 함수는 그대로 둔다", async () => {
    const id = await newRequest();
    await save(id);
    await db.exec(sql(DOWN));
    expect(await one<{ t: string | null }>("select to_regclass('public.request_details')::text as t")).toEqual({ t: null });
    expect(
      (await one<{ n: number }>("select count(*)::int as n from pg_trigger where tgname = 'request_details_drop_on_close'")).n,
    ).toBe(0);
    expect(
      (await one<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'request_details_drop_on_close'")).n,
    ).toBe(0);
    expect(await definitions()).toEqual(existingBefore);
    // 두 번 돌려도 오류가 없다(if exists).
    await db.exec(sql(DOWN));
    // 요청 표는 그대로 쓸 수 있다.
    await db.query("update public.requests set status = 'done', done_at = now() where id = $1", [id]);
  });
});
