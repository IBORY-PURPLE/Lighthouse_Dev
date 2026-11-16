import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildResultFromSession } from "@/lib/researchResult";
import { checkCandidate } from "@/lib/resultInput";

// 리서치 챗 대화 저장 SQL 시험(PGlite = 진짜 Postgres를 WASM으로). design.md 5절, 7절.
// 한계: PGlite는 연결이 하나라 진짜 동시 실행(잠금 대기, skip locked)은 못 본다.
// 경합은 "두 단계 호출"(소유 확인 → 다른 쪽이 먼저 커밋 → 이어서 호출)로 순서만 재현한다.

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const MIGRATIONS = [
  "supabase/migrations/20261109175932_requests.sql",
  "supabase/migrations/20261112010000_volunteer_flow.sql",
  "supabase/migrations/20261117000000_research_conversation.sql",
];
const DOWN = "supabase/rollback/20261117000000_research_conversation_down.sql";

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

let db: PGlite;
let before: { functions: Record<string, string>; columns: string };

const EXISTING_FUNCTIONS = ["register_request", "claim_request", "release_request", "complete_request", "reset_demo_requests"];

/** 기존 함수 5개의 정의 전문과 requests·results 열 목록. 새 마이그레이션이 이것을 바꾸지 않는지 비교한다. */
async function existingDefinitions() {
  const functions: Record<string, string> = {};
  for (const name of EXISTING_FUNCTIONS) {
    const row = await db.query<{ d: string }>(
      "select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace",
      [name],
    );
    functions[name] = row.rows[0].d;
  }
  const columns = await db.query<{ c: string }>(
    `select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, ordinal_position) as c
       from information_schema.columns where table_schema = 'public' and table_name in ('requests', 'results')`,
  );
  return { functions, columns: columns.rows[0].c };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 인자 모양을 알 수 있도록 jsonb 자리는 캐스팅 문자열로 부른다.
async function call(text: string, params: unknown[] = []): Promise<Json> {
  const out = await db.query<{ r: Json }>(`select ${text} as r`, params);
  return out.rows[0].r;
}

function vol(): string {
  return `d-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** 요청 하나를 만들고 봉사자가 맡은 상태로 둔다. */
async function claimed(volunteerId = vol()): Promise<{ id: string; volunteerId: string }> {
  const created = await db.query<{ out_request_id: string }>(
    "select * from public.register_request($1, '소니 헤드셋', '10만 원', '새 제품', 'Sony', '헤드셋', 'new')",
    [randomUUID()],
  );
  const id = created.rows[0].out_request_id;
  const outcome = await db.query<{ claim_request: string }>("select public.claim_request($1, $2)", [
    id,
    volunteerId,
  ]);
  expect(outcome.rows[0].claim_request).toBe("claimed");
  return { id, volunteerId };
}

async function open(id: string, volunteerId: string, after: number | null = null): Promise<Json> {
  return call("public.research_open($1::uuid, $2, $3::int)", [id, volunteerId, after]);
}

async function opened(volunteerId = vol()) {
  const c = await claimed(volunteerId);
  const o = await open(c.id, c.volunteerId);
  expect(o.outcome).toBe("ok");
  return { ...c, sessionId: o.view.sessionId as string, version: o.view.version as number };
}

async function begin(
  r: { id: string; volunteerId: string; sessionId: string },
  kind: string,
  extra: Partial<{ base: number | null; turn: string | null; key: string | null; units: number; caps: object }> = {},
): Promise<Json> {
  return call(
    "public.research_begin($1::uuid, $2, $3::uuid, $4, $5::int, $6, $7, $8::int, $9::jsonb)",
    [r.id, r.volunteerId, r.sessionId, kind, extra.base ?? null, extra.turn ?? null, extra.key ?? null,
      extra.units ?? 1, JSON.stringify(extra.caps ?? {})],
  );
}

async function apply(
  r: { id: string; volunteerId: string; sessionId: string },
  turn: string,
  base: number | null,
  patch: object | null,
  messages: object[],
  next: object[],
): Promise<Json> {
  return call(
    "public.research_apply($1::uuid, $2, $3::uuid, $4, $5::int, $6::jsonb, $7::jsonb, $8::jsonb)",
    [r.id, r.volunteerId, r.sessionId, turn, base, JSON.stringify(patch), JSON.stringify(messages), JSON.stringify(next)],
  );
}

const msg = (text: string, role = "ai", tag = "question") => ({ role, tag, body: { text }, ai: "none" });
const ask = (action: string, slot: string | null, text = "질문") => ({ action, slot, message: msg(text) });
const slot = (value: string, status = "filled") => ({ value, status, by: "volunteer", at: "2026-11-17T00:00:00Z" });
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

async function one<T = Json>(text: string, params: unknown[] = []): Promise<T> {
  const out = await db.query<T>(text, params);
  return out.rows[0];
}

async function fillRequired(
  r: { id: string; volunteerId: string; sessionId: string },
  turn: string,
  base: number,
  withPhoto = false,
) {
  const slots: Record<string, unknown> = {
    model: slot("720N"),
    pros: slot("가벼워요"),
    altReason: slot("귀가 덜 아파요"),
  };
  const out = await apply(r, turn, base, { purchase: withPhoto ? "bought" : "research", slots }, [msg("답", "volunteer", "answer")], []);
  expect(out.outcome).toBe("ok");
  return out.response.version as number;
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase와 같은 역할·기본 권한(새 객체에 anon·authenticated·service_role 권한을 자동으로 준다).
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const file of MIGRATIONS.slice(0, 2)) await db.exec(sql(file));
  before = await existingDefinitions();
  await db.exec(sql(MIGRATIONS[2]));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("권한과 구조", () => {
  it("새 표 6개와 트리거가 있고 RLS가 켜져 있으며 정책은 없다", async () => {
    const tables = ["research_sessions", "research_messages", "research_turns", "research_photos", "research_usage", "ai_usage_daily"];
    for (const name of tables) {
      const row = await one<{ rls: boolean; policies: number }>(
        `select c.relrowsecurity as rls,
                (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
           from pg_class c where c.oid = to_regclass($1)`,
        [`public.${name}`],
      );
      expect(row, name).toEqual({ rls: true, policies: 0 });
      const priv = await one<{ a: boolean; b: boolean; s: boolean }>(
        `select has_table_privilege('anon', $1, 'select') as a,
                has_table_privilege('authenticated', $1, 'select') as b,
                has_table_privilege('service_role', $1, 'select') as s`,
        [`public.${name}`],
      );
      expect(priv, name).toEqual({ a: false, b: false, s: true });
    }
    expect(await one("select to_regclass('public.photo_links') as t")).toEqual({ t: null });
    const trg = await one<{ n: number }>(
      "select count(*)::int as n from pg_trigger where tgname = 'research_drop_on_leave' and not tgisinternal",
    );
    expect(trg.n).toBe(1);
  });

  it("research_ 함수는 anon·authenticated가 못 부르고 service_role만 부른다", async () => {
    const rows = await db.query<{ name: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean; definer: boolean; cfg: string | null }>(
      `select p.oid::regprocedure::text as name,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), false) as pub,
              p.prosecdef as definer, array_to_string(p.proconfig, ',') as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'research\\_%'`,
    );
    const names = rows.rows.map((r) => r.name);
    for (const fn of ["research_open", "research_begin", "research_apply", "research_add_message",
      "research_add_photo", "research_remove_photo", "research_set_review", "research_send", "research_sweep"]) {
      expect(names.some((n) => n.startsWith(`${fn}(`)), fn).toBe(true);
    }
    expect(rows.rows.length).toBeGreaterThanOrEqual(15);
    for (const row of rows.rows) {
      expect(row, row.name).toMatchObject({ anon: false, auth: false, svc: true, pub: false, definer: false });
      // security invoker(prosecdef false)이고 search_path가 빈 값이다.
      expect(row.cfg, row.name).toMatch(/search_path=""/);
    }
    // 정책 이름이 아니라 실제 권한: anon으로 바꿔 부르면 거부된다.
    await db.exec("set role anon");
    await expect(db.query("select public.research_sweep()")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("기존 함수 5개의 정의 전문과 requests·results 열은 새 마이그레이션 전후로 같다", async () => {
    const after = await existingDefinitions();
    expect(after.functions).toEqual(before.functions);
    expect(after.columns).toBe(before.columns);
  });

  it("기존 함수 5개 권한은 그대로다(anon 못 부름, service_role 부름)", async () => {
    for (const fn of EXISTING_FUNCTIONS) {
      const row = await one<{ anon: boolean; svc: boolean }>(
        `select has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('service_role', p.oid, 'execute') as svc
           from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
        [fn],
      );
      expect(row, fn).toEqual({ anon: false, svc: true });
    }
  });
});

describe("열기·읽기", () => {
  it("없는 요청·대기 요청·남의 요청은 거부하고, 내 요청은 세션을 만든다", async () => {
    expect((await open(randomUUID(), vol())).outcome).toBe("not_found");
    const created = await db.query<{ out_request_id: string }>(
      "select * from public.register_request($1, '키보드', '5만 원', '새 제품', null, '키보드', 'new')",
      [randomUUID()],
    );
    expect((await open(created.rows[0].out_request_id, vol())).outcome).toBe("not_in_progress");
    const c = await claimed();
    expect((await open(c.id, vol())).outcome).toBe("not_yours");
    const first = await open(c.id, c.volunteerId);
    expect(first.outcome).toBe("ok");
    expect(first.view).toMatchObject({ purchase: "unset", version: 0, lastSeq: 0, messages: [], photos: [] });
    const again = await open(c.id, c.volunteerId);
    expect(again.view.sessionId).toBe(first.view.sessionId);
  });

  it("읽기는 소유 확인과 같은 문장에서 한다: 다른 봉사자의 세션은 null이다", async () => {
    const r = await opened();
    await apply(r, "a", 0, null, [msg("내 대화")], []);
    const mine = await call("public.research_view($1::uuid, 0, false, $2)", [r.id, r.volunteerId]);
    expect(mine.messages.length).toBe(1);
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]);
    const other = vol();
    await db.query("select public.claim_request($1, $2)", [r.id, other]);
    await open(r.id, other);
    expect(await call("public.research_view($1::uuid, 0, false, $2)", [r.id, r.volunteerId])).toBeNull();
    expect((await call("public.research_view($1::uuid, 0, false, $2)", [r.id, other])).messages).toEqual([]);
    const polled = await open(r.id, r.volunteerId, 0);
    expect(polled.outcome).toBe("not_yours");
    expect(polled.view).toBeUndefined();
  });

  it("p_after가 있으면 읽기만 한다(세션을 만들지 않는다)", async () => {
    const c = await claimed();
    expect((await open(c.id, c.volunteerId, 0)).outcome).toBe("session_changed");
    const r = await opened();
    await apply(r, "t1", 0, null, [msg("하나"), msg("둘")], []);
    const polled = await open(r.id, r.volunteerId, 1);
    expect(polled.view.messages.map((m: Json) => m.seq)).toEqual([2]);
    expect(polled.view.photos).toEqual([]);
  });
});

describe("begin·apply", () => {
  it("구매 여부가 unset이면 구매 질문만 유효하고, 첫 유효 후보가 들어간다", async () => {
    const r = await opened();
    const b = await begin(r, "turn", { base: 0, turn: "a1" });
    expect(b).toMatchObject({ outcome: "ok", ai: "ok", version: 0 });
    const out = await apply(r, "a1", 0, null, [msg("안녕", "volunteer", "answer")], [
      ask("ask_slot", "pros", "장점 질문"),
      ask("ask_purchase", null, "구매하셨나요?"),
    ]);
    expect(out.outcome).toBe("ok");
    expect(out.response.chosen).toBe("ask_purchase");
    expect(out.response.messages.map((m: Json) => m.body.text)).toEqual(["안녕", "구매하셨나요?"]);
    expect(out.response.session.pending.lastQuestion).toMatchObject({ slot: "purchase", seq: 2 });
    expect(out.response.session.version).toBe(0);
  });

  it("칸·구매가 바뀌면 version이 오르고, 질문한 칸은 asked에 적힌다", async () => {
    const r = await opened();
    await apply(r, "a1", 0, null, [], []);
    const out = await apply(r, "a2", 0, { purchase: "bought", slots: { model: slot("720N") } }, [msg("720N 샀어요", "volunteer", "answer")], [
      ask("ask_slot", "model", "이미 찬 칸"),
      ask("ask_slot", "pros", "장점 질문"),
    ]);
    expect(out.response.version).toBe(1);
    expect(out.response.chosen).toBe("ask_slot");
    expect(out.response.session.counters.asked).toEqual({ pros: true });
    expect(out.response.session.slots.model.value).toBe("720N");
  });

  it("리서치만이면 사진 질문은 유효하지 않다. 구매함이면 유효하다", async () => {
    const research = await opened();
    await apply(research, "a", 0, { purchase: "research" }, [], []);
    const noPhoto = await apply(research, "b", 1, null, [], [ask("ask_slot", "photo", "사진"), ask("ask_slot", "model", "기종")]);
    expect(noPhoto.response.chosen).toBe("ask_slot");
    expect(noPhoto.response.session.counters.asked).toEqual({ model: true });
    const bought = await opened();
    await apply(bought, "a", 0, { purchase: "bought" }, [], []);
    const withPhoto = await apply(bought, "b", 1, null, [], [ask("ask_slot", "photo", "사진")]);
    expect(withPhoto.response.session.counters.asked).toEqual({ photo: true });
  });

  it("물은 선택 칸은 다시 묻지 않고, 물은 필수 칸은 둘째 회차에 다시 묻는다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "research", asked: ["pros", "alts"] }, [], []);
    const optional = await apply(r, "b", 1, null, [], [ask("ask_slot", "alts", "alts")]);
    expect(optional.response.chosen).toBeNull();
    const required = await apply(r, "c", 1, null, [], [ask("ask_slot", "pros", "pros")]);
    expect(required.response.chosen).toBe("ask_slot");
  });

  it("reask는 칸마다 1번이다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "research" }, [], []);
    const first = await apply(r, "b", 1, null, [], [ask("reask", "pros", "다시")]);
    expect(first.response.chosen).toBe("reask");
    expect(first.response.session.counters.reasked).toEqual({ pros: 1 });
    const second = await apply(r, "c", 1, null, [], [ask("reask", "pros", "또")]);
    expect(second.response.chosen).toBeNull();
  });

  it("필수가 비면 추가 질문·리뷰 제안은 막히고, 다 차고 질문 7을 지나면 열린다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "research" }, [], []);
    const blocked = await apply(r, "b", 1, { asked: ["model", "pros", "alts", "altReason", "benefits", "refs"] }, [], [
      ask("propose_review", null, "리뷰?"),
      ask("ask_extra", null, "추가?"),
    ]);
    expect(blocked.response.chosen).toBeNull();
    const v = await fillRequired(r, "c", 1);
    const open1 = await apply(r, "d", v, null, [], [ask("propose_review", null, "리뷰를 만들까요?")]);
    expect(open1.response.chosen).toBe("propose_review");
  });

  it("질문 7을 아직 안 지났으면 리뷰 제안이 막힌다", async () => {
    const r = await opened();
    const v = await fillRequired(r, "a", 0);
    const early = await apply(r, "b", v, null, [], [ask("propose_review", null, "리뷰?")]);
    expect(early.response.chosen).toBeNull();
  });

  it("미해결 확인 필요가 있으면 리뷰 제안은 안 나가고 안내만 유효하다", async () => {
    const r = await opened();
    const v = await fillRequired(r, "a", 0);
    const out = await apply(
      r,
      "b",
      v,
      { asked: ["alts", "benefits", "refs", "photo"], pending: { confirmFill: { slot: "alts", text: "x" } } },
      [],
      [ask("propose_review", null, "리뷰?"), ask("pending_notice", null, "위 확인에 먼저 답해 주세요")],
    );
    expect(out.response.chosen).toBe("pending_notice");
  });

  it("중복 턴은 저장된 응답을 주고(stale보다 먼저), 처리 중이면 pending이다", async () => {
    const r = await opened();
    expect(await begin(r, "turn", { base: 0, turn: "dup" })).toMatchObject({ outcome: "ok" });
    expect(await begin(r, "turn", { base: 0, turn: "dup" })).toMatchObject({ outcome: "pending" });
    const done = await apply(r, "dup", 0, { purchase: "bought" }, [msg("x", "volunteer", "answer")], []);
    expect(done.response.version).toBe(1);
    const again = await begin(r, "turn", { base: 0, turn: "dup" }); // base가 낡았어도 중복이 먼저
    expect(again.outcome).toBe("duplicate");
    expect(again.response.version).toBe(1);
    const applyAgain = await apply(r, "dup", 0, { purchase: "research" }, [], []);
    expect(applyAgain.outcome).toBe("duplicate");
    expect((await open(r.id, r.volunteerId)).view.purchase).toBe("bought");
  });

  it("stale은 세지 않고, 낡은 처리 중 자리는 지워 다시 시도할 수 있다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "bought" }, [], []);
    const before = await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id]);
    expect(before ?? { turns: 0 }).toEqual({ turns: 0 });
    expect(await begin(r, "turn", { base: 0, turn: "late" })).toMatchObject({ outcome: "stale", version: 1 });
    expect(await one("select turns from public.research_usage where request_id = $1", [r.id])).toBeUndefined();
    // begin 뒤에 다른 요청이 version을 올린 경우
    expect(await begin(r, "turn", { base: 1, turn: "race" })).toMatchObject({ outcome: "ok" });
    await apply(r, "other", 1, { slots: { model: slot("720N") } }, [], []);
    const usageBefore = await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id]);
    const dailyBefore = await one<{ ai_calls: number }>("select ai_calls from public.ai_usage_daily");
    expect(await apply(r, "race", 1, null, [], [])).toMatchObject({ outcome: "stale", version: 2 });
    // begin이 올린 사용량(요청당·하루)은 stale이 되면 되돌린다.
    expect((await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id])).turns).toBe(usageBefore.turns - 1);
    expect((await one<{ ai_calls: number }>("select ai_calls from public.ai_usage_daily")).ai_calls).toBe(dailyBefore.ai_calls - 1);
    expect(await begin(r, "turn", { base: 2, turn: "race" })).toMatchObject({ outcome: "ok" });
  });

  it("photo 칸은 patch로 못 바꾸고, 채운 칸의 값은 비면 안 된다(건너뜀은 빈 값 가능)", async () => {
    const r = await opened();
    expect(await apply(r, "p", 0, { slots: { photo: slot("1장") } }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "e1", 0, { slots: { model: slot("   ") } }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "e2", 0, { slots: { model: { status: "filled", by: "volunteer" } } }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "e3", 0, { slots: { model: slot("x".repeat(201)) } }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "ok", 0, { slots: { alts: { value: "", status: "skipped", by: "volunteer" } } }, [], [])).toMatchObject({ outcome: "ok" });
  });

  it("잘못된 patch는 거부한다", async () => {
    const r = await opened();
    expect(await apply(r, "a", 0, { slots: { nope: slot("x") } }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "b", 0, { slots: { model: { value: "x", status: "weird" } } }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "c", 0, { extras: [1, 2, 3, 4] }, [], [])).toMatchObject({ outcome: "bad_patch" });
    expect(await apply(r, "d", 0, { purchase: "maybe" }, [], [])).toMatchObject({ outcome: "bad_patch" });
  });

  it("확정한 리뷰는 칸이 바뀌면 draft로 돌아간다", async () => {
    const r = await opened();
    const v = await fillRequired(r, "a", 0);
    const set = await call("public.research_set_review($1::uuid, $2, $3::uuid, $4::int, $5::jsonb)", [
      r.id, r.volunteerId, r.sessionId, v, JSON.stringify({ text: "리뷰 본문", status: "confirmed" }),
    ]);
    expect(set.review).toMatchObject({ status: "confirmed", confirmedVersion: v, rev: 1 });
    const out = await apply(r, "b", v, { slots: { pros: slot("조용해요") } }, [], []);
    expect(out.response.session.review).toMatchObject({ status: "draft", rev: 2 });
  });

  it("검색 도중 턴이 들어와도 서로 막지 않고 seq는 겹치지 않는다", async () => {
    const r = await opened();
    expect(await begin(r, "search", { key: "model:1" })).toMatchObject({ outcome: "ok" });
    await apply(r, "t1", 0, null, [msg("턴 답")], []);
    const added = await call(
      "public.research_add_message($1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::jsonb, $7)",
      [r.id, r.volunteerId, r.sessionId, "model:1", JSON.stringify([msg("후보 카드", "ai", "cards")]), JSON.stringify({ x: { a: 1 } }), "done"],
    );
    expect(added).toMatchObject({ outcome: "ok", lastSeq: 2 });
    const seqs = await db.query<{ seq: number }>("select seq from public.research_messages where request_id = $1 order by seq", [r.id]);
    expect(seqs.rows.map((x) => x.seq)).toEqual([1, 2]);
    expect(await begin(r, "search", { key: "model:1" })).toMatchObject({ outcome: "cached" });
  });
});

describe("상한과 사용량", () => {
  it("요청당 턴 상한을 넘으면 capped로 이어지고 세지 않는다", async () => {
    const r = await opened();
    const caps = { turns: 2 };
    for (const turn of ["a", "b"]) {
      expect(await begin(r, "turn", { turn, caps })).toMatchObject({ outcome: "ok", ai: "ok" });
      await apply(r, turn, null, null, [], []);
    }
    const third = await begin(r, "turn", { turn: "c", caps });
    expect(third).toMatchObject({ outcome: "ok", ai: "capped", cap: "request" });
    const usage = await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id]);
    expect(usage.turns).toBe(2);
    // 중복·캐시 적중·stale은 세지 않는다.
    await apply(r, "c", null, null, [], []);
    expect((await begin(r, "turn", { turn: "c", caps })).outcome).toBe("duplicate");
    expect((await begin(r, "turn", { turn: "d", base: 99, caps })).outcome).toBe("stale");
    expect((await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id])).turns).toBe(2);
  });

  it("검색은 단위(혜택 3)로 세고, 캐시 적중·진행 중은 세지 않는다", async () => {
    const r = await opened();
    const caps = { searches: 5 };
    expect(await begin(r, "search", { key: "benefits:1", units: 3, caps })).toMatchObject({ outcome: "ok" });
    expect(await begin(r, "search", { key: "benefits:1", units: 3, caps })).toMatchObject({ outcome: "pending" });
    await call("public.research_add_message($1::uuid, $2, $3::uuid, $4, $5::jsonb)", [r.id, r.volunteerId, r.sessionId, "benefits:1", "[]"]);
    expect(await begin(r, "search", { key: "benefits:1", units: 3, caps })).toMatchObject({ outcome: "cached" });
    expect(await begin(r, "search", { key: "benefits:2", units: 3, caps })).toMatchObject({ outcome: "capped", cap: "request" });
    expect((await one<{ searches: number }>("select searches from public.research_usage where request_id = $1", [r.id])).searches).toBe(3);
    // 진행 중 표시가 90초 넘게 남아 있으면 다시 시도할 수 있다.
    await db.query(
      `update public.research_sessions set search_cache = jsonb_build_object('stuck', jsonb_build_object('state','pending','at', extract(epoch from now()) - 200)) where request_id = $1`,
      [r.id],
    );
    expect(await begin(r, "search", { key: "stuck", units: 1, caps })).toMatchObject({ outcome: "ok" });
  });

  it("하루 상한은 서울 날짜 한 줄에서 세고, 넘으면 capped daily다", async () => {
    await db.exec("delete from public.ai_usage_daily");
    const r = await opened();
    const caps = { dailyAi: 2, dailySearches: 3 };
    expect(await begin(r, "turn", { turn: "a", caps })).toMatchObject({ ai: "ok" });
    expect(await begin(r, "turn", { turn: "b", caps })).toMatchObject({ ai: "ok" });
    expect(await begin(r, "turn", { turn: "c", caps })).toMatchObject({ ai: "capped", cap: "daily" });
    expect(await begin(r, "search", { key: "k1", units: 3, caps })).toMatchObject({ outcome: "ok" });
    expect(await begin(r, "search", { key: "k2", units: 1, caps })).toMatchObject({ outcome: "capped", cap: "daily" });
    const day = await one<{ searches: number; ai_calls: number; ok: boolean }>(
      "select searches, ai_calls, day = (now() at time zone 'Asia/Seoul')::date as ok from public.ai_usage_daily",
    );
    expect(day).toEqual({ searches: 3, ai_calls: 2, ok: true });
    // 요청당 usage도 하루 상한에 막힌 호출은 늘리지 않는다.
    expect((await one<{ turns: number; searches: number }>("select turns, searches from public.research_usage where request_id = $1", [r.id]))).toEqual({ turns: 2, searches: 3 });
    await db.exec("delete from public.ai_usage_daily");
  });

  it("사진 올리기는 하루 AI 상한을 쓰지 않는다(상한이 찼어도 ok, 요청당 상한만)", async () => {
    await db.exec("delete from public.ai_usage_daily");
    const r = await opened();
    await apply(r, "a", 0, { purchase: "bought" }, [], []);
    const caps = { dailyAi: 1 };
    expect(await begin(r, "turn", { turn: "t1", caps })).toMatchObject({ ai: "ok" });
    expect(await begin(r, "turn", { turn: "t2", caps })).toMatchObject({ ai: "capped", cap: "daily" });
    expect(await begin(r, "photo", { caps })).toMatchObject({ outcome: "ok" });
    expect(await begin(r, "photo", { caps })).toMatchObject({ outcome: "ok" });
    expect((await one<{ ai_calls: number }>("select ai_calls from public.ai_usage_daily")).ai_calls).toBe(1);
    await db.exec("delete from public.ai_usage_daily");
  });

  it("그날 첫 사용이어도 하루 상한을 넘으면 막는다", async () => {
    await db.exec("delete from public.ai_usage_daily");
    const r = await opened();
    expect(await begin(r, "search", { key: "big", units: 3, caps: { dailySearches: 1 } })).toMatchObject({ outcome: "capped", cap: "daily" });
    expect(await one("select day from public.ai_usage_daily")).toBeUndefined();
    expect((await one<{ searches: number }>("select searches from public.research_usage where request_id = $1", [r.id]))?.searches ?? 0).toBe(0);
    expect(await begin(r, "turn", { turn: "z", caps: { dailyAi: 0 } })).toMatchObject({ ai: "capped", cap: "daily" });
    await db.exec("delete from public.ai_usage_daily");
  });

  it("내려놓고 다시 맡아도 요청당 usage는 유지된다", async () => {
    const r = await opened();
    await begin(r, "turn", { turn: "a" });
    await apply(r, "a", null, { purchase: "bought" }, [], []);
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]);
    expect(await one("select request_id from public.research_sessions where request_id = $1", [r.id])).toBeUndefined();
    expect((await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id])).turns).toBe(1);
    await db.query("select public.claim_request($1, $2)", [r.id, r.volunteerId]);
    const again = await open(r.id, r.volunteerId);
    expect(again.view.sessionId).not.toBe(r.sessionId); // 새 session_id
    expect(again.view).toMatchObject({ purchase: "unset", lastSeq: 0 });
    const next = await begin({ ...r, sessionId: again.view.sessionId }, "turn", { turn: "b" });
    expect(next.outcome).toBe("ok");
    expect((await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id])).turns).toBe(2);
  });

  it("사진 올리기·리뷰 상한과 사진 규칙", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "research" }, [], []);
    expect((await begin(r, "photo")).outcome).toBe("photo_not_needed");
    await apply(r, "b", 1, { purchase: "bought" }, [], []);
    expect(await begin(r, "photo", { caps: { photoUploads: 1 } })).toMatchObject({ outcome: "ok" });
    expect(await begin(r, "photo", { caps: { photoUploads: 1 } })).toMatchObject({ outcome: "capped", cap: "request" });
    expect(await begin(r, "review", { caps: { reviews: 1 } })).toMatchObject({ outcome: "ok" });
    expect(await begin(r, "review", { caps: { reviews: 1 } })).toMatchObject({ outcome: "capped" });
    expect((await begin(r, "nope")).outcome).toBe("bad_request");
  });
});

describe("사진", () => {
  it("사진 3장까지, 넷째는 거부한다. 일치하면 다음 질문이 같은 처리에서 들어간다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "bought", slots: { model: slot("720N") } }, [], [ask("ask_slot", "photo", "사진을 올려 주세요")]);
    const add = (n: number, next: object[] = [ask("ask_slot", "pros", "장점 질문")]) =>
      call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
        r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, JSON.stringify({}),
        JSON.stringify([{ role: "volunteer", tag: "photo", body: { n } }]), JSON.stringify(next),
      ]);
    const first = await add(1);
    expect(first).toMatchObject({ outcome: "ok", chosen: "ask_slot" });
    expect(first.session.slots.photo).toMatchObject({ value: "1장", status: "filled" });
    expect(first.session.pending.lastQuestion.slot).toBe("pros");
    // 직전 질문이 photo가 아니면(지금은 pros) 다음 질문을 또 넣지 않는다.
    const second = await add(2);
    expect(second.chosen).toBeNull();
    expect((await add(3)).outcome).toBe("ok");
    expect((await add(4)).outcome).toBe("photos_full");
    expect(await begin(r, "photo")).toMatchObject({ outcome: "photos_full" });
    const photos = await db.query("select id from public.research_photos where request_id = $1", [r.id]);
    expect(photos.rows.length).toBe(3);
  });

  it("히어로에서 올린 사진은 구매 질문으로 이어진다", async () => {
    const r = await opened();
    const out = await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]",
      JSON.stringify([ask("ask_slot", "pros", "장점"), ask("ask_purchase", null, "구매하셨나요?")]),
    ]);
    expect(out.chosen).toBe("ask_purchase");
  });

  it("확인 필요가 걸리면 다음 질문을 넣지 않고, 리서치만이면 사진을 받지 않는다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "bought" }, [], []);
    const out = await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, JPEG, "d", "XM5", "photo",
      JSON.stringify({ mismatch: { slot: "model", seen: "XM5" } }), "[]", JSON.stringify([ask("ask_slot", "pros", "장점")]),
    ]);
    expect(out.chosen).toBeNull();
    expect(out.session.pending.mismatch).toMatchObject({ slot: "model" });
    const r2 = await opened();
    await apply(r2, "a", 0, { purchase: "research" }, [], []);
    const refused = await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r2.id, r2.volunteerId, r2.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
    ]);
    expect(refused.outcome).toBe("photo_not_needed");
  });

  it("jpeg data URL이 아닌 thumb은 bad_request로 거부한다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "bought" }, [], []);
    const out = await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, "data:image/png;base64,AAAA", null, null, null, "{}", "[]", "[]",
    ]);
    expect(out.outcome).toBe("bad_request");
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_photos where request_id = $1", [r.id])).n).toBe(0);
  });

  it("사진 삭제는 id와 request_id가 같은 행만 지우고, 0장이면 photo 칸을 비운다", async () => {
    const a = await opened();
    const b = await opened();
    for (const r of [a, b]) {
      await apply(r, "a", 0, { purchase: "bought" }, [], []);
      await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
        r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
      ]);
    }
    const bPhoto = (await one<{ id: string }>("select id from public.research_photos where request_id = $1", [b.id])).id;
    const wrong = await call("public.research_remove_photo($1::uuid, $2, $3::uuid, $4::uuid)", [a.id, a.volunteerId, a.sessionId, bPhoto]);
    expect(wrong.outcome).toBe("photo_not_found");
    expect((await db.query("select 1 from public.research_photos where id = $1", [bPhoto])).rows.length).toBe(1);
    const aPhoto = (await one<{ id: string }>("select id from public.research_photos where request_id = $1", [a.id])).id;
    const removed = await call("public.research_remove_photo($1::uuid, $2, $3::uuid, $4::uuid)", [a.id, a.volunteerId, a.sessionId, aPhoto]);
    expect(removed.outcome).toBe("ok");
    expect(removed.session.slots.photo).toBeUndefined();
    expect(removed.session.photos).toEqual([]);
  });
});

describe("리뷰·보내기", () => {
  const review = (r: { id: string; volunteerId: string; sessionId: string }, base: number | null, status: string) =>
    call("public.research_set_review($1::uuid, $2, $3::uuid, $4::int, $5::jsonb)", [
      r.id, r.volunteerId, r.sessionId, base, JSON.stringify({ text: "검수한 리뷰 문단", status }),
    ]);
  const send = (r: { id: string; volunteerId: string; sessionId: string }, base: number, rev: number) =>
    call("public.research_send($1::uuid, $2, $3::uuid, $4::int, $5::int, $6::jsonb)", [
      r.id, r.volunteerId, r.sessionId, base, rev,
      JSON.stringify([{ name: "720N", url: "https://example.com", guide: "리뷰 문단", summary: [] }]),
    ]);

  it("필수가 비면 missing_required, review가 확정이 아니면 review_not_confirmed, 낡으면 stale", async () => {
    const r = await opened();
    const miss = await send(r, 0, 0);
    expect(miss).toMatchObject({ outcome: "missing_required" });
    expect(miss.missing).toEqual(["purchase", "model", "pros", "altReason"]);
    const v = await fillRequired(r, "a", 0, true);
    expect((await send(r, v, 0)).missing).toEqual(["photo"]);
    await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
    ]);
    const v2 = v + 1;
    expect((await send(r, v2, 0)).outcome).toBe("review_not_confirmed");
    expect((await review(r, v2, "draft")).review.status).toBe("draft");
    expect((await send(r, v2, 1)).outcome).toBe("review_not_confirmed");
    expect((await review(r, v - 5, "confirmed")).outcome).toBe("stale");
    const confirmed = await review(r, v2, "confirmed");
    expect(confirmed.review).toMatchObject({ status: "confirmed", rev: 2 });
    expect((await send(r, v2, 1)).outcome).toBe("review_not_confirmed"); // rev 불일치
    expect((await send(r, v2 - 1, 2)).outcome).toBe("stale");
  });

  it("구매함인데 사진 행이 없으면(칸 표시만 있어도) 보낼 수 없다", async () => {
    const r = await opened();
    const v = await fillRequired(r, "a", 0, true);
    await db.query(
      `update public.research_sessions set slots = slots || jsonb_build_object('photo', jsonb_build_object('value','1장','status','filled','by','volunteer')) where request_id = $1`,
      [r.id],
    );
    await review(r, v, "confirmed");
    expect(await send(r, v, 1)).toMatchObject({ outcome: "missing_required", missing: ["photo"] });
  });

  it("보내면 요청이 done이 되고 세션은 지워지며 usage는 남는다. 다시 보내면 existing", async () => {
    const r = await opened();
    await begin(r, "turn", { turn: "u" });
    const v = await fillRequired(r, "a", 0);
    await review(r, v, "confirmed");
    const sent = await send(r, v, 1);
    expect(sent.outcome).toBe("sent");
    expect(await one("select request_id from public.research_sessions where request_id = $1", [r.id])).toBeUndefined();
    expect(await one("select count(*)::int as n from public.research_messages where request_id = $1", [r.id])).toEqual({ n: 0 });
    expect((await one<{ status: string }>("select status from public.requests where id = $1", [r.id])).status).toBe("done");
    expect((await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [r.id])).turns).toBe(1);
    const results = await db.query("select candidates from public.results where request_id = $1", [r.id]);
    expect(results.rows.length).toBe(1);
    const again = await send(r, v, 1);
    expect(again).toMatchObject({ outcome: "existing" });
    expect(again.sentAt).toBe(sent.sentAt);
    // 같은 봉사자의 늦은 턴은 거부된다.
    expect((await apply(r, "late", null, null, [], [])).outcome).toBe("not_in_progress");
  });
});

describe("내려놓기·정리·트리거", () => {
  it("소유 확인 뒤 release가 끝나면 늦은 쓰기는 세션을 남기지 않는다(두 단계 호출)", async () => {
    const r = await opened();
    expect((await begin(r, "turn", { turn: "x" })).outcome).toBe("ok"); // 1단계: 소유 확인
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]); // 2단계: release 커밋
    expect((await apply(r, "x", null, { purchase: "bought" }, [msg("늦은 답")], [])).outcome).toBe("not_in_progress");
    expect((await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
    ])).outcome).toBe("not_in_progress");
    expect((await call("public.research_add_message($1::uuid, $2, $3::uuid, $4, $5::jsonb)", [
      r.id, r.volunteerId, r.sessionId, "model:1", "[]",
    ])).outcome).toBe("not_in_progress");
    for (const t of ["research_sessions", "research_messages", "research_turns", "research_photos"]) {
      const n = await one<{ n: number }>(`select count(*)::int as n from public.${t} where request_id = $1`, [r.id]);
      expect(n.n, t).toBe(0);
    }
  });

  it("다른 봉사자가 맡으면 옛 세션 id로는 쓸 수 없다", async () => {
    const r = await opened();
    await db.query("select public.release_request($1, $2)", [r.id, r.volunteerId]);
    const other = vol();
    await db.query("select public.claim_request($1, $2)", [r.id, other]);
    const o = await open(r.id, other);
    expect(o.view.sessionId).not.toBe(r.sessionId);
    expect((await apply(r, "z", null, null, [], [])).outcome).toBe("not_yours");
    expect((await apply({ ...r, volunteerId: other }, "z", null, null, [], [])).outcome).toBe("session_changed");
  });

  it("트리거: release·complete·claim·reset 기존 함수가 새 트리거와 함께 성공한다", async () => {
    const a = await opened();
    expect((await one<{ r: string }>("select public.release_request($1, $2) as r", [a.id, a.volunteerId])).r).toBe("released");
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_sessions where request_id = $1", [a.id])).n).toBe(0);

    const b = await opened();
    const done = await one<{ out_outcome: string }>(
      "select * from public.complete_request($1, $2, $3::jsonb)",
      [b.id, b.volunteerId, JSON.stringify([{ name: "x", url: "https://e.com", guide: "g", summary: [] }])],
    );
    expect(done.out_outcome).toBe("completed");
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_sessions where request_id = $1", [b.id])).n).toBe(0);

    // reset: 시연 요청을 맡은 세션과 usage도 요청과 함께 사라진다(on delete cascade).
    const demoVolunteer = vol();
    await db.query("select public.reset_demo_requests($1)", [null]);
    const demo = await one<{ id: string }>("select id from public.requests where is_demo and status = 'waiting' order by queue_number limit 1");
    await db.query("select public.claim_request($1, $2)", [demo.id, demoVolunteer]);
    const o = await open(demo.id, demoVolunteer);
    expect(o.outcome).toBe("ok");
    await begin({ id: demo.id, volunteerId: demoVolunteer, sessionId: o.view.sessionId }, "turn", { turn: "t" });
    const count = await one<{ r: number }>("select public.reset_demo_requests($1) as r", [null]);
    expect(count.r).toBe(5);
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_sessions where request_id = $1", [demo.id])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_usage where request_id = $1", [demo.id])).n).toBe(0);
    // 대기 요청을 다시 맡을 수 있다.
    const fresh = await one<{ id: string }>("select id from public.requests where is_demo and status = 'waiting' limit 1");
    expect((await one<{ c: string }>("select public.claim_request($1, $2) as c", [fresh.id, vol()])).c).toBe("claimed");
  });

  it("봉사자만 바뀌어도(상태 그대로) 세션을 지운다", async () => {
    const r = await opened();
    await db.query("update public.requests set volunteer_id = $2 where id = $1", [r.id, vol()]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_sessions where request_id = $1", [r.id])).n).toBe(0);
  });

  it("6시간 방치된 요청은 대기열로 돌아가고 세션은 지워지며 usage는 남는다", async () => {
    const idle = await opened();
    const active = await opened();
    const neverOpened = await claimed();
    await begin(idle, "turn", { turn: "t" });
    await db.query("update public.requests set claimed_at = now() - interval '7 hours' where id = any($1::uuid[])", [[idle.id, active.id, neverOpened.id]]);
    await db.query("update public.research_sessions set updated_at = now() - interval '7 hours' where request_id = $1", [idle.id]);
    // active는 요청은 오래전에 맡았지만 세션 활동이 방금이다.
    await db.query("update public.research_sessions set updated_at = now() where request_id = $1", [active.id]);
    const swept = await one<{ n: number }>("select public.research_sweep() as n");
    expect(swept.n).toBeGreaterThanOrEqual(2);
    const status = async (id: string) =>
      one<{ status: string; volunteer_id: string | null; claimed_at: string | null; release_count: number }>(
        "select status, volunteer_id, claimed_at, release_count from public.requests where id = $1", [id]);
    expect(await status(idle.id)).toEqual({ status: "waiting", volunteer_id: null, claimed_at: null, release_count: 1 });
    expect((await status(neverOpened.id)).status).toBe("waiting");
    expect((await status(active.id)).status).toBe("in_progress");
    expect((await one<{ n: number }>("select count(*)::int as n from public.research_sessions where request_id = $1", [idle.id])).n).toBe(0);
    expect((await one<{ turns: number }>("select turns from public.research_usage where request_id = $1", [idle.id])).turns).toBe(1);
    // 방치된 봉사자가 돌아오면 세션을 못 쓴다.
    expect((await apply(idle, "late", null, null, [], [])).outcome).toBe("not_in_progress");
  });

  it("열기가 6시간 정리를 함께 부른다", async () => {
    const stale = await opened();
    await db.query("update public.requests set claimed_at = now() - interval '8 hours' where id = $1", [stale.id]);
    await db.query("update public.research_sessions set updated_at = now() - interval '8 hours' where request_id = $1", [stale.id]);
    const fresh = await claimed();
    expect((await open(fresh.id, fresh.volunteerId)).outcome).toBe("ok");
    expect((await one<{ status: string }>("select status from public.requests where id = $1", [stale.id])).status).toBe("waiting");
  });

  it("sweep은 skip locked와 advisory lock을 쓴다(정의 확인. 동시 실행은 PGlite로 못 본다)", async () => {
    const def = await one<{ d: string }>("select pg_get_functiondef('public.research_sweep(interval)'::regprocedure) as d");
    expect(def.d).toMatch(/for update skip locked/i);
    expect(def.d).toMatch(/pg_try_advisory_xact_lock/);
  });
});

describe("A4 라우트의 호출 순서(사진 말풍선 → 다음 질문, 결과 보내기)", () => {
  it("add_photo(다음 질문 없음) → add_message(cache key 없음) → apply(후보 목록)로 말풍선이 질문보다 앞에 온다", async () => {
    const r = await opened();
    await apply(r, "a", 0, { purchase: "bought", slots: { model: slot("720N") } }, [], [ask("ask_slot", "photo", "사진을 올려 주세요")]);
    const state = (await open(r.id, r.volunteerId)).view;
    const added = await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
    ]);
    expect(added).toMatchObject({ outcome: "ok", chosen: null, messages: [] });
    const bubble = await call("public.research_add_message($1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::jsonb, $7)", [
      r.id, r.volunteerId, r.sessionId, null,
      JSON.stringify([{ role: "volunteer", tag: null, slot: "photo", body: { kind: "photo", photoId: added.photoId }, ai: null }]),
      null, "done",
    ]);
    expect(bubble.outcome).toBe("ok");
    expect(added.session.pending.lastQuestion.slot).toBe("photo");
    const applied = await apply(r, `photo-${added.photoId}`, added.session.version, null, [], [ask("ask_slot", "pros", "장점 질문")]);
    expect(applied.outcome).toBe("ok");
    expect(applied.response.chosen).toBe("ask_slot");
    const seqs = (await db.query<{ seq: number; kind: string | null; text: string | null }>(
      "select seq, body->>'kind' as kind, body->>'text' as text from public.research_messages where request_id = $1 order by seq",
      [r.id],
    )).rows;
    expect(seqs.slice(-2).map((row) => row.kind ?? row.text)).toEqual(["photo", "장점 질문"]);
    expect(applied.response.lastSeq).toBe(seqs.at(-1)?.seq);
    expect(state.version + 1).toBe(added.session.version);
    // apply가 version을 더 올리지 않고, 같은 turn id를 다시 부르면 저장된 응답이다.
    expect(applied.response.version).toBe(added.session.version);
    expect((await apply(r, `photo-${added.photoId}`, added.session.version, null, [], [])).outcome).toBe("duplicate");
  });

  it("buildResultFromSession의 후보로 보내면 results에 그대로 저장된다", async () => {
    const r = await opened();
    const v = await fillRequired(r, "a", 0, true);
    await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
      r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
    ]);
    const text = "720N은 직접 구매해서 쓰는 봉사자가 사진으로 인증한 헤드셋이에요. 가벼워서 편하다고 해요.";
    const draft = await call("public.research_set_review($1::uuid, $2, $3::uuid, $4::int, $5::jsonb)", [
      r.id, r.volunteerId, r.sessionId, null, JSON.stringify({ text, status: "draft" }),
    ]);
    expect(draft.outcome).toBe("ok");
    const confirmed = await call("public.research_set_review($1::uuid, $2, $3::uuid, $4::int, $5::jsonb)", [
      r.id, r.volunteerId, r.sessionId, v + 1, JSON.stringify({ text, status: "confirmed" }),
    ]);
    const view = (await open(r.id, r.volunteerId)).view;
    const candidates = buildResultFromSession(view);
    expect(candidates[0]).toMatchObject({ name: "720N", guide: text });
    const sent = await call("public.research_send($1::uuid, $2, $3::uuid, $4::int, $5::int, $6::jsonb)", [
      r.id, r.volunteerId, r.sessionId, v + 1, confirmed.review.rev, JSON.stringify(candidates),
    ]);
    expect(sent.outcome).toBe("sent");
    const stored = await one<{ candidates: { name: string; guide: string; summary: { label: string; value: string }[] }[] }>(
      "select candidates from public.results where request_id = $1",
      [r.id],
    );
    expect(stored.candidates[0].guide).toBe(text);
    expect(stored.candidates[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("구매 인증됨");
    for (const candidate of stored.candidates) expect(checkCandidate(candidate).ok).toBe(true);
  });
});

describe("마이그레이션 되돌리기", () => {
  it("적용 → 되돌리기 → 다시 적용", async () => {
    const before = await one<{ fns: number }>(
      "select count(*)::int as fns from pg_proc where pronamespace = 'public'::regnamespace and proname like 'research\\_%'",
    );
    expect(before.fns).toBeGreaterThanOrEqual(15);
    await db.exec(sql(DOWN));
    for (const name of ["research_sessions", "research_messages", "research_turns", "research_photos", "research_usage", "ai_usage_daily"]) {
      expect((await one<{ t: string | null }>("select to_regclass($1)::text as t", [`public.${name}`])).t, name).toBeNull();
    }
    const after = await one<{ fns: number; trg: number }>(
      `select (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname like 'research\\_%') as fns,
              (select count(*)::int from pg_trigger where tgname = 'research_drop_on_leave') as trg`,
    );
    expect(after).toEqual({ fns: 0, trg: 0 });
    // 기존 함수는 되돌린 뒤에도 그대로 돈다.
    const c = await claimed();
    expect((await one<{ r: string }>("select public.release_request($1, $2) as r", [c.id, c.volunteerId])).r).toBe("released");
    await db.exec(sql(MIGRATIONS[2]));
    const again = await opened();
    expect(again.sessionId).toBeTruthy();
    // 한 번 더 되돌렸다 올려도 된다(멱등하게 반복 가능).
    await db.exec(sql(DOWN));
    await db.exec(sql(MIGRATIONS[2]));
    expect((await opened()).sessionId).toBeTruthy();
  });
});
