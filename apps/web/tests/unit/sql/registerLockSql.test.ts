import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 동시 접수 잠금 SQL 시험(PGlite). 마이그레이션 20261124000000_register_request_lock.sql.
// PGlite는 연결이 하나라 "같은 순간의 접수"는 여기서 만들 수 없다. 여기서는 잠금이 들어갔는지와
// 예전 동작(번호, 재전송, 기기 ID, 만료, 권한)이 그대로인지만 본다.
// 실제 동시성은 Postgres 17에 연결 10개로 따로 확인했다(2026-11-24: 고치기 전 200건 중 63건, 고친 뒤 200건 중 200건).

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
];
const LOCK = "supabase/migrations/20261124000000_register_request_lock.sql";
const DOWN = "supabase/rollback/20261124000000_register_request_lock_down.sql";
const SIGNATURE = "public.register_request(uuid, text, text, text, text, text, text, text)";

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

const REGISTER = `select * from public.register_request(
  p_client_request_id => $1, p_product => '무선 이어폰', p_budget => '5만 원', p_condition => '상관없음',
  p_brand => null, p_item => null, p_condition_kind => 'any', p_device_id => $2)`;

async function register(deviceId: string | null, clientId = randomUUID()): Promise<Registered> {
  return one<Registered>(REGISTER, [clientId, deviceId]);
}

async function functionSource(): Promise<string> {
  return (await one<{ def: string }>(`select pg_get_functiondef('${SIGNATURE}'::regprocedure) as def`)).def;
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
  await db.exec(sql(LOCK));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("접수 잠금", () => {
  it("register_request가 트랜잭션 잠금으로 접수를 한 줄로 세운다", async () => {
    const source = await functionSource();
    expect(source).toMatch(/pg_advisory_xact_lock\(hashtextextended\('lighthouse\.register_request', 0\)\)/);
    // 잠금이 번호를 세는 일보다 먼저다.
    expect(source.indexOf("pg_advisory_xact_lock")).toBeLessThan(source.indexOf("max(q.queue_number)"));
  });

  it("함수는 하나뿐이고 service_role만 부를 수 있다", async () => {
    const count = await one<{ n: number }>(
      "select count(*)::int as n from pg_proc where proname = 'register_request' and pronamespace = 'public'::regnamespace",
    );
    expect(count.n).toBe(1);
    const priv = await one<Record<string, boolean>>(
      `select has_function_privilege('anon', '${SIGNATURE}', 'execute') as anon_exec,
              has_function_privilege('authenticated', '${SIGNATURE}', 'execute') as auth_exec,
              has_function_privilege('service_role', '${SIGNATURE}', 'execute') as svc_exec`,
    );
    expect(priv).toEqual({ anon_exec: false, auth_exec: false, svc_exec: true });
  });
});

describe("예전 동작 그대로", () => {
  it("차례로 10명이 접수하면 번호가 1씩 늘고 대기열 순서(created_at)가 번호 순서와 같다", async () => {
    const made: Registered[] = [];
    for (let i = 0; i < 10; i++) made.push(await register(`u-seq-${i}`));
    expect(made.every((row) => row.out_outcome === "created" && row.out_status === "waiting")).toBe(true);
    const numbers = made.map((row) => row.out_queue_number);
    expect(numbers).toEqual(numbers.map((_, i) => numbers[0] + i));
    const ordered = await db.query<{ id: string }>(
      "select id from public.requests where id = any($1::uuid[]) order by created_at asc",
      [made.map((row) => row.out_request_id)],
    );
    expect(ordered.rows.map((row) => row.id)).toEqual(made.map((row) => row.out_request_id));
  });

  it("한 트랜잭션 안의 두 접수도 created_at이 다르다(now()가 아니라 잠금을 얻은 뒤의 시각)", async () => {
    const ids = await db.transaction(async (tx) => {
      const first = (await tx.query<Registered>(REGISTER, [randomUUID(), "u-tx"])).rows[0];
      // PGlite에서 같은 밀리초에 두 호출을 실행하면 clock_timestamp()도 같은 값일 수 있다.
      await wait(20);
      const second = (await tx.query<Registered>(REGISTER, [randomUUID(), "u-tx"])).rows[0];
      return [first.out_request_id, second.out_request_id];
    });
    const rows = await db.query<{ id: string; later: boolean }>(
      `select a.id, b.created_at > a.created_at as later
         from public.requests a, public.requests b where a.id = $1 and b.id = $2`,
      ids,
    );
    expect(rows.rows[0].later).toBe(true);
  });

  it("같은 client_request_id를 다시 보내면 기존 행을 주고 기기 ID를 덮어쓰지 않는다", async () => {
    const clientId = randomUUID();
    const first = await register("u-first", clientId);
    const again = await register("u-other", clientId);
    expect(again).toMatchObject({
      out_outcome: "existing",
      out_request_id: first.out_request_id,
      out_queue_number: first.out_queue_number,
    });
    const owner = await one<{ device_id: string | null }>("select device_id from public.requests where id = $1", [
      first.out_request_id,
    ]);
    expect(owner.device_id).toBe("u-first");
  });

  it("지금 앱의 7개 인자 호출이 그대로 된다", async () => {
    const row = await one<Registered>(
      "select * from public.register_request($1, '키보드', '5만 원', '새 제품', null, '키보드', 'new')",
      [randomUUID()],
    );
    expect(row.out_outcome).toBe("created");
  });

  it("24시간 지난 일반 대기는 expired로 바꾸고 시연 대기는 그대로 둔다", async () => {
    const real = await register("u-old");
    const demo = await register(null);
    await db.query("update public.requests set is_demo = true where id = $1", [demo.out_request_id]);
    await db.query("update public.requests set created_at = now() - interval '30 hours' where id = any($1::uuid[])", [
      [real.out_request_id, demo.out_request_id],
    ]);
    await register("u-trigger");
    const status = async (id: string) =>
      (await one<{ status: string }>("select status from public.requests where id = $1", [id])).status;
    expect(await status(real.out_request_id)).toBe("expired");
    expect(await status(demo.out_request_id)).toBe("waiting");
  });
});

describe("되돌리기", () => {
  it("down을 실행하면 잠금 없는 예전 정의로 돌아가고 접수는 계속 된다", async () => {
    await db.exec(sql(DOWN));
    expect(await functionSource()).not.toMatch(/pg_advisory_xact_lock/);
    const before = await register("u-down-1");
    const after = await register("u-down-2");
    expect(after.out_queue_number).toBe(before.out_queue_number + 1);
    // 다시 적용해도 된다.
    await db.exec(sql(LOCK));
    expect(await functionSource()).toMatch(/pg_advisory_xact_lock/);
    expect((await register("u-up")).out_outcome).toBe("created");
  });
});
