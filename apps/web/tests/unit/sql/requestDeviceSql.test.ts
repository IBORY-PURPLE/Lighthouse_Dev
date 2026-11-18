import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 이용자 기기 구분 SQL 시험(PGlite = 진짜 Postgres를 WASM으로). 마이그레이션 20261123000000_request_device.sql.
// 앞선 마이그레이션(20261109~20261122)에만 기대고, 아직 원격에 없는 다른 마이그레이션에는 기대지 않는다.

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const BEFORE = [
  "supabase/migrations/20261109175932_requests.sql",
  "supabase/migrations/20261112010000_volunteer_flow.sql",
  "supabase/migrations/20261117000000_research_conversation.sql",
  "supabase/migrations/20261117010000_research_review_draft_base.sql",
  "supabase/migrations/20261119000000_photo_links.sql",
  "supabase/migrations/20261120000000_push_subscriptions.sql",
  "supabase/migrations/20261122000000_request_details.sql",
];
const DEVICE = "supabase/migrations/20261123000000_request_device.sql";
const DOWN = "supabase/rollback/20261123000000_request_device_down.sql";

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

let db: PGlite;

async function one<T>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(text, params)).rows[0];
}

interface Registered {
  out_outcome: string;
  out_request_id: string;
  out_queue_number: number;
  out_status: string;
}

/** 지금 운영 앱이 부르는 모양: 이름 붙은 7개 인자만. */
async function registerLegacy(clientId = randomUUID()): Promise<Registered> {
  return one<Registered>(
    `select * from public.register_request(
       p_client_request_id => $1, p_product => '소니 헤드셋', p_budget => '10만 원', p_condition => '새 제품',
       p_brand => 'Sony', p_item => '헤드셋', p_condition_kind => 'new')`,
    [clientId],
  );
}

async function registerWith(deviceId: string | null, clientId = randomUUID()): Promise<Registered> {
  return one<Registered>(
    `select * from public.register_request(
       p_client_request_id => $1, p_product => '소니 헤드셋', p_budget => '10만 원', p_condition => '새 제품',
       p_brand => 'Sony', p_item => '헤드셋', p_condition_kind => 'new', p_device_id => $2)`,
    [clientId, deviceId],
  );
}

async function deviceOf(id: string): Promise<string | null> {
  return (await one<{ device_id: string | null }>("select device_id from public.requests where id = $1", [id])).device_id;
}

async function statusOf(id: string): Promise<string> {
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
  await db.exec(sql(DEVICE));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("register_request 호환", () => {
  it("함수는 하나뿐이고(8개 인자), 지금 앱의 7개 인자 호출이 그대로 된다", async () => {
    const count = await one<{ n: number }>(
      "select count(*)::int as n from pg_proc where proname = 'register_request' and pronamespace = 'public'::regnamespace",
    );
    expect(count.n).toBe(1);
    const created = await registerLegacy();
    expect(created).toMatchObject({ out_outcome: "created", out_status: "waiting" });
    expect(await deviceOf(created.out_request_id)).toBeNull();
    const next = await registerLegacy();
    expect(next.out_queue_number).toBe(created.out_queue_number + 1);
  });

  it("위치 인자 7개로도 부를 수 있다", async () => {
    const row = await one<Registered>(
      "select * from public.register_request($1, '키보드', '5만 원', '새 제품', null, '키보드', 'new')",
      [randomUUID()],
    );
    expect(row.out_outcome).toBe("created");
  });

  it("service_role만 부를 수 있다", async () => {
    const signature = "public.register_request(uuid, text, text, text, text, text, text, text)";
    const priv = await one<Record<string, boolean>>(
      `select has_function_privilege('anon', '${signature}', 'execute') as anon_exec,
              has_function_privilege('authenticated', '${signature}', 'execute') as auth_exec,
              has_function_privilege('service_role', '${signature}', 'execute') as svc_exec`,
    );
    expect(priv).toEqual({ anon_exec: false, auth_exec: false, svc_exec: true });
  });
});

describe("device_id", () => {
  it("처음 만들 때 기기 ID가 저장된다", async () => {
    const created = await registerWith("u-aaaa");
    expect(created.out_outcome).toBe("created");
    expect(await deviceOf(created.out_request_id)).toBe("u-aaaa");
  });

  it("같은 client_request_id를 다시 보내면 기존 행을 주고 기기 ID를 덮어쓰지 않는다", async () => {
    const clientId = randomUUID();
    const first = await registerWith("u-first", clientId);
    const again = await registerWith("u-other", clientId);
    expect(again).toMatchObject({ out_outcome: "existing", out_request_id: first.out_request_id });
    expect(await deviceOf(first.out_request_id)).toBe("u-first");
    // 기기 ID 없이 다시 보내도(옛 앱) 그대로다.
    const legacy = await registerWith(null, clientId);
    expect(legacy.out_outcome).toBe("existing");
    expect(await deviceOf(first.out_request_id)).toBe("u-first");
  });

  it("옛 앱이 먼저 만든 행(기기 없음)은 새 기기 ID로 다시 보내도 비어 있다", async () => {
    const clientId = randomUUID();
    const legacy = await registerLegacy(clientId);
    await registerWith("u-late", clientId);
    expect(await deviceOf(legacy.out_request_id)).toBeNull();
  });

  it("기기별 목록 색인이 있다", async () => {
    const index = await one<{ def: string }>(
      "select indexdef as def from pg_indexes where indexname = 'requests_device_created_at_idx'",
    );
    expect(index.def).toMatch(/device_id, created_at DESC/);
    expect(index.def).toMatch(/WHERE \(device_id IS NOT NULL\)/);
  });
});

describe("시연 요청은 24시간 만료에서 빠진다", () => {
  it("register_request가 24시간 지난 일반 대기는 expired로 바꾸지만 시연 대기는 그대로 둔다", async () => {
    const real = await registerWith("u-old");
    const demo = await registerWith(null);
    await db.query("update public.requests set is_demo = true where id = $1", [demo.out_request_id]);
    await db.query("update public.requests set created_at = now() - interval '30 hours' where id = any($1::uuid[])", [
      [real.out_request_id, demo.out_request_id],
    ]);
    await registerWith("u-trigger");
    expect(await statusOf(real.out_request_id)).toBe("expired");
    expect(await statusOf(demo.out_request_id)).toBe("waiting");
  });

  it("reset_demo_requests가 만든 시연 대기 5건은 device_id가 없다", async () => {
    expect((await one<{ n: number }>("select public.reset_demo_requests(null) as n")).n).toBe(5);
    const rows = await db.query<{ device_id: string | null }>("select device_id from public.requests where is_demo");
    expect(rows.rows).toHaveLength(5);
    expect(rows.rows.every((row) => row.device_id === null)).toBe(true);
  });
});

describe("claim_request의 24시간 규칙", () => {
  const claim = async (id: string, volunteer: string) =>
    (await one<{ r: string }>("select public.claim_request($1, $2) as r", [id, volunteer])).r;

  it("25시간 지난 시연 대기는 맡을 수 있고, 25시간 지난 일반 대기는 taken이다", async () => {
    const demo = await registerWith(null);
    const real = await registerWith("u-claim-old");
    await db.query("update public.requests set is_demo = true where id = $1", [demo.out_request_id]);
    await db.query("update public.requests set created_at = now() - interval '25 hours' where id = any($1::uuid[])", [
      [demo.out_request_id, real.out_request_id],
    ]);
    expect(await claim(demo.out_request_id, "d-0123456789abcdef")).toBe("claimed");
    expect(await claim(real.out_request_id, "d-fedcba9876543210")).toBe("taken");
  });

  it("claim_request도 service_role만 부를 수 있다", async () => {
    const priv = await one<Record<string, boolean>>(
      `select has_function_privilege('anon', 'public.claim_request(uuid, text)', 'execute') as anon_exec,
              has_function_privilege('service_role', 'public.claim_request(uuid, text)', 'execute') as svc_exec`,
    );
    expect(priv).toEqual({ anon_exec: false, svc_exec: true });
  });
});

describe("되돌리기", () => {
  it("rollback을 돌리면 7개 인자 함수가 돌아오고 열이 없어지며, 다시 적용된다", async () => {
    await db.exec(sql(DOWN));
    const funcs = await db.query<{ args: string }>(
      "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.proname = 'register_request' and p.pronamespace = 'public'::regnamespace",
    );
    expect(funcs.rows).toHaveLength(1);
    expect(funcs.rows[0].args).not.toContain("p_device_id");
    const column = await one<{ n: number }>(
      "select count(*)::int as n from information_schema.columns where table_name = 'requests' and column_name = 'device_id'",
    );
    expect(column.n).toBe(0);
    expect((await registerLegacy()).out_outcome).toBe("created");
    // 되돌린 뒤 repair 하고 다시 올리는 경우.
    await db.exec(sql(DEVICE));
    expect((await registerWith("u-again")).out_outcome).toBe("created");
  });
});
