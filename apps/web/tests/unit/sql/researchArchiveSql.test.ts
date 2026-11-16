import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 대화 글 30일 보관(research_archives)과 리뷰 영구 저장(research_reviews) SQL 시험(PGlite). 블록 A1b, 이용자 결정 A45.
// 마이그레이션 4개를 모두 적용해서 돌린다. 마이그레이션 1~3의 A1 시험(researchSql.test.ts)은 그대로 따로 돈다(회귀).
// 한계: PGlite는 연결이 하나라 진짜 동시 실행은 못 본다.

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const MIGRATIONS = [
  "supabase/migrations/20261109175932_requests.sql",
  "supabase/migrations/20261112010000_volunteer_flow.sql",
  "supabase/migrations/20261117000000_research_conversation.sql",
  "supabase/migrations/20261117010000_research_archive.sql",
];
const DOWN = "supabase/rollback/20261117010000_research_archive_down.sql";
const NEW_TABLES = ["research_archives", "research_reviews"];
// TS `scrubText`(tests/unit/researchArchive.test.ts)와 같은 표다.
const SCRUB_CASES: Array<[string, string]> = [
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
  ["긴 단어 data:image/png;base64,AAAA interoperability 끝", "긴 단어  interoperability 끝"],
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
const NEW_FUNCTIONS = ["research_url_decode", "research_scrub_plain", "research_scrub_text", "research_final_review", "research_strip_data", "research_body_text", "research_archive_messages", "research_archive_put"];
const EXISTING_FUNCTIONS = ["register_request", "claim_request", "release_request", "complete_request", "reset_demo_requests"];

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

let db: PGlite;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Actor = { id: string; volunteerId: string; sessionId: string };

async function call(text: string, params: unknown[] = []): Promise<Json> {
  const out = await db.query<{ r: Json }>(`select ${text} as r`, params);
  return out.rows[0].r;
}

async function one<T = Json>(text: string, params: unknown[] = []): Promise<T> {
  const out = await db.query<T>(text, params);
  return out.rows[0];
}

async function count(text: string, params: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(`select count(*)::int as n from ${text}`, params)).n;
}

const vol = () => `d-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const LONG_CHAT_KEPT = 61; // 첫 질문 + 한글 1,013자짜리 메시지 120개를 190KB(jsonb 글자 크기) 안에 담을 때 남는 개수. JSON.stringify 크기로 재면 62개라 둘이 갈린다
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const BENEFIT_URL = "https://shop.example.com/event/headset";
const OTHER_URL = "https://card.example.com/promo";

async function opened(volunteerId = vol()): Promise<Actor & { version: number }> {
  const created = await db.query<{ out_request_id: string }>(
    "select * from public.register_request($1, '소니 헤드셋', '10만 원', '새 제품', 'Sony', '헤드셋', 'new')",
    [randomUUID()],
  );
  const id = created.rows[0].out_request_id;
  const claim = await one<{ claim_request: string }>("select public.claim_request($1, $2)", [id, volunteerId]);
  expect(claim.claim_request).toBe("claimed");
  const o = await call("public.research_open($1::uuid, $2, $3::int)", [id, volunteerId, null]);
  expect(o.outcome).toBe("ok");
  return { id, volunteerId, sessionId: o.view.sessionId, version: o.view.version };
}

async function apply(r: Actor, turn: string, base: number | null, patch: object | null, messages: object[]): Promise<Json> {
  return call("public.research_apply($1::uuid, $2, $3::uuid, $4, $5::int, $6::jsonb, $7::jsonb, $8::jsonb)", [
    r.id, r.volunteerId, r.sessionId, turn, base, JSON.stringify(patch), JSON.stringify(messages), "[]",
  ]);
}

const slot = (value: string) => ({ value, status: "filled", by: "volunteer", at: "2026-11-17T00:00:00Z" });
const text = (value: string, role = "ai", tag = "question", slotName: string | null = null) => ({
  role, tag, slot: slotName, body: { text: value }, ai: "none",
});

async function readVersion(r: Actor): Promise<number> {
  return (await one<{ version: number }>("select version from public.research_sessions where request_id = $1", [r.id])).version;
}

const CANDIDATES = [
  { name: "720N", url: "https://example.com/720n", guide: "리뷰 문단", summary: [] },
  { name: "WH-1000XM5", url: "https://example.com/xm5", guide: "", summary: [] },
  { name: "QC45", url: "https://example.com/qc45", guide: "", summary: [] },
];

async function review(r: Actor, version: number, status: string, body = "검수를 마친 리뷰 문단입니다.") {
  return call("public.research_set_review($1::uuid, $2, $3::uuid, $4::int, $5::jsonb)", [
    r.id, r.volunteerId, r.sessionId, version, JSON.stringify({ text: body, status }),
  ]);
}

async function send(r: Actor, version: number, rev: number, candidates: unknown[] = CANDIDATES): Promise<Json> {
  return call("public.research_send($1::uuid, $2, $3::uuid, $4::int, $5::int, $6::jsonb)", [
    r.id, r.volunteerId, r.sessionId, version, rev, JSON.stringify(candidates),
  ]);
}

/** 구매 인증(사진 1장)과 카드·찾는 방법·사진 말풍선이 있는 대화를 만들고 리뷰를 확정한다. 아직 보내지 않는다. */
async function ready(extraMessages: object[] = []) {
  const r = await opened();
  const out = await apply(r, "t1", 0, {
    purchase: "bought",
    slots: { model: slot("720N"), pros: slot("가벼워요"), altReason: slot("귀가 덜 아파요") },
  }, [
    text("어떤 기종을 쓰셨나요?", "ai", "question", "model"),
    text("720N이에요", "volunteer", "answer"),
    { role: "ai", tag: "search", slot: "alts", ai: "ok", body: {
      kind: "products", text: "같이 고민할 제품이에요",
      items: [{ name: "WH-1000XM5", feature: "노이즈 캔슬링", pageUrl: "https://example.com/xm5" }],
      chips: [{ label: "칩", value: "x" }], quick: [{ id: "a", label: "빠른 답" }],
    } },
    { role: "ai", tag: "search", slot: "benefits", ai: "ok", body: {
      kind: "benefits", headline: "혜택을 찾았어요",
      items: [
        { title: "공식몰 행사", kind: "공식몰", condition: "회원 한정", compare: "카드와 중복 불가", url: BENEFIT_URL, mode: "ai" },
        { title: "카드 혜택", kind: "카드", condition: "특정 카드", compare: "", url: OTHER_URL, mode: "check" },
      ],
    } },
    { role: "ai", tag: "search", slot: null, ai: "ok", body: {
      kind: "guide", queries: ["소니 720N 헤드셋"], checks: ["기종 표기", "색상"], steps: ["공식몰", "오픈마켓"],
    } },
    { role: "ai", tag: "review", slot: null, ai: "ok", body: { text: "AI가 제안한 리뷰 초안입니다." } },
    ...extraMessages,
  ]);
  expect(out.outcome).toBe("ok");
  const photo = await call("public.research_add_photo($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)", [
    r.id, r.volunteerId, r.sessionId, JPEG, null, null, null, "{}", "[]", "[]",
  ]);
  expect(photo.outcome).toBe("ok");
  // 사진 말풍선: body에 썸네일과 data URL이 들어 있어도 보관본에는 없어야 한다.
  await apply(r, "t2", null, null, [
    { role: "volunteer", tag: "fill", slot: "photo", ai: "none", body: { kind: "photo", photoId: photo.photoId, thumb: JPEG } },
    text(`사진 확인 ${JPEG} 끝`, "ai", "question", "photo"),
  ]);
  await db.query(
    `update public.research_sessions set slots = slots || jsonb_build_object(
       'benefits', jsonb_build_object('value', '공식몰 행사', 'links', jsonb_build_array($2::text), 'status', 'confirmed',
         'by', 'volunteer', 'at', '2026-11-17T02:00:00Z'),
       'photo', jsonb_build_object('value', '1장', 'status', 'filled', 'by', 'volunteer', 'thumb', $3::text, 'note', $3::text))
     where request_id = $1`,
    [r.id, BENEFIT_URL, JPEG],
  );
  const version = await readVersion(r);
  const confirmed = await review(r, version, "confirmed");
  expect(confirmed.outcome).toBe("ok");
  return { r, version, rev: confirmed.review.rev as number };
}

const A1_FUNCTIONS_KEPT = ["research_open", "research_begin", "research_apply", "research_add_message", "research_add_photo",
  "research_remove_photo", "research_set_review", "research_guard", "research_view", "research_merge", "research_next_valid",
  "research_push_messages", "research_required_missing", "research_slot_askable", "research_drop_on_leave"];

async function definitions(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const rows = await db.query<{ d: string }>(
      "select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace",
      [name],
    );
    // Windows 작업 폴더(autocrlf)는 줄 끝이 CRLF라 정의 전문의 줄 끝 차이는 무시한다.
    out[name] = rows.rows.map((row) => row.d.replace(/\r\n/g, "\n")).join("\n---\n");
  }
  return out;
}

let a1Send = "";
let a1Sweep = "";
let a1Others: Record<string, string> = {};
let existingBefore: Record<string, string> = {};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const file of MIGRATIONS.slice(0, 3)) await db.exec(sql(file));
  const defs = await definitions(["research_send", "research_sweep"]);
  a1Send = defs.research_send;
  a1Sweep = defs.research_sweep;
  a1Others = await definitions(A1_FUNCTIONS_KEPT);
  existingBefore = await definitions(EXISTING_FUNCTIONS);
  await db.exec(sql(MIGRATIONS[3]));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("권한과 구조", () => {
  it("두 표는 RLS가 켜져 있고 정책이 없으며 anon·authenticated는 못 쓰고 service_role만 쓴다", async () => {
    for (const name of NEW_TABLES) {
      const row = await one<{ rls: boolean; policies: number }>(
        `select c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
           from pg_class c where c.oid = to_regclass($1)`,
        [`public.${name}`],
      );
      expect(row, name).toEqual({ rls: true, policies: 0 });
      for (const privilege of ["select", "insert", "update", "delete"]) {
        const priv = await one<{ a: boolean; b: boolean; s: boolean }>(
          `select has_table_privilege('anon', $1, $2) as a, has_table_privilege('authenticated', $1, $2) as b,
                  has_table_privilege('service_role', $1, $2) as s`,
          [`public.${name}`, privilege],
        );
        expect(priv, `${name} ${privilege}`).toEqual({ a: false, b: false, s: true });
      }
      // 요청을 참조하는 외래 키가 없다(요청이 지워져도 남는다).
      expect(await count("pg_constraint where conrelid = to_regclass($1) and contype = 'f'", [`public.${name}`]), name).toBe(0);
    }
  });

  it("research_send·research_sweep은 오버로드 없이 1개씩이다", async () => {
    for (const name of ["research_send", "research_sweep"]) {
      expect(await count("pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name]), name).toBe(1);
    }
    for (const name of NEW_FUNCTIONS) {
      expect(await count("pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name]), name).toBe(1);
    }
  });

  it("research_ 함수는 모두 anon·authenticated가 못 부르고 service_role만 부르며 security invoker·빈 search_path다", async () => {
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
    const names = rows.rows.map((row) => row.name);
    for (const fn of NEW_FUNCTIONS) expect(names.some((n) => n.startsWith(`${fn}(`)), fn).toBe(true);
    for (const row of rows.rows) {
      expect(row, row.name).toMatchObject({ anon: false, auth: false, svc: true, pub: false, definer: false });
      expect(row.cfg, row.name).toMatch(/search_path=""/);
    }
    await db.exec("set role anon");
    await expect(db.query("select public.research_sweep()")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.research_reviews")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await expect(db.query("select public.research_archive_put(gen_random_uuid(), '[]'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.research_archives")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("기존 함수 5개와 A1의 나머지 함수 정의는 새 마이그레이션 전후로 같다(send·sweep만 바뀐다)", async () => {
    expect(await definitions(EXISTING_FUNCTIONS)).toEqual(existingBefore);
    expect(await definitions(A1_FUNCTIONS_KEPT)).toEqual(a1Others);
    const now = await definitions(["research_send", "research_sweep"]);
    expect(now.research_send).not.toBe(a1Send);
    expect(now.research_sweep).not.toBe(a1Sweep);
    // 시그니처는 같다.
    const sig = (d: string) => /create or replace function ([^\n]*)\(([\s\S]*?)\)\s*returns/.exec(d)?.[2].replace(/\s+/g, " ");
    expect(sig(now.research_send)).toBe(sig(a1Send));
    expect(sig(now.research_sweep)).toBe(sig(a1Sweep));
  });
});

describe("보내기", () => {
  it("보내면 archives·reviews 각 1행이고 글만 있다(사진·data URL 없음)", async () => {
    const { r, version, rev } = await ready();
    const sent = await send(r, version, rev);
    expect(sent.outcome).toBe("sent");
    expect(await count("public.research_sessions where request_id = $1", [r.id])).toBe(0); // 세션은 트리거로 지워졌다
    expect(await count("public.research_archives where request_id = $1", [r.id])).toBe(1);
    expect(await count("public.research_reviews where request_id = $1", [r.id])).toBe(1);

    const a = await one<Json>("select * from public.research_archives where request_id = $1", [r.id]);
    expect(a.is_demo).toBe(false); // 봉사자 id(d-…)가 아니라 요청의 is_demo 값이다. 일반 접수 요청이라 false
    expect(a.request).toEqual({ product: "소니 헤드셋", budget: "10만 원", condition: "새 제품", brand: "Sony", item: "헤드셋", conditionKind: "new" });
    expect(a.purchase).toBe("bought");
    expect(a.verified).toBe(true);
    expect(a.slots.model.value).toBe("720N");
    expect(a.slots.photo.thumb).toBeUndefined();
    expect(a.slots.photo.note).toBeUndefined();
    const raw = JSON.stringify(a);
    expect(raw).not.toMatch(/data:/);
    expect(raw).not.toContain("/9j/4AAQ");
    expect(raw).not.toContain("photoId");

    const texts = (a.messages as Json[]).map((m) => m.text as string);
    const seqs = (a.messages as Json[]).map((m) => m.seq as number);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(a.messages[0]).toMatchObject({ role: "ai", tag: "question", slot: "model", text: "어떤 기종을 쓰셨나요?" });
    expect(texts).toContain("720N이에요");
    expect(texts.some((t) => t.includes("같이 고민할 제품이에요") && t.includes("WH-1000XM5 - 노이즈 캔슬링 - https://example.com/xm5"))).toBe(true);
    expect(texts.some((t) => t.includes("혜택을 찾았어요") && t.includes(`공식몰 행사 - 공식몰 - 회원 한정 - 카드와 중복 불가 - ${BENEFIT_URL}`))).toBe(true);
    expect(texts).toContain("검색어: 소니 720N 헤드셋\n확인할 조건: 기종 표기, 색상\n찾는 순서: 공식몰, 오픈마켓");
    expect(texts).toContain("사진 확인  끝"); // data URL만 빠진다
    expect(texts).not.toContain("빠른 답");
    expect(a.messages.every((m: Json) => Object.keys(m).sort().join() === "role,seq,slot,tag,text")).toBe(true);
    expect(a.review).toEqual({ final: "검수를 마친 리뷰 문단입니다.", draft: "AI가 제안한 리뷰 초안입니다.", rev });

    const rv = await one<Json>("select * from public.research_reviews where request_id = $1", [r.id]);
    expect(rv).toMatchObject({
      item: "헤드셋", brand: "Sony", product: "소니 헤드셋", model: "720N", purchase: "bought", verified: true,
      review_text: "검수를 마친 리뷰 문단입니다.", alts: ["WH-1000XM5", "QC45"],
    });
    // 확인했어요(slots.benefits.links)한 혜택만 들어가고, 카드의 제목·종류·조건이 붙는다. 확인하지 않은 카드는 없다.
    expect(rv.benefit_links).toEqual([
      { title: "공식몰 행사", url: BENEFIT_URL, kind: "공식몰", condition: "회원 한정", confirmedAt: "2026-11-17T02:00:00Z" },
    ]);
    expect(JSON.stringify(rv)).not.toContain(OTHER_URL);
    expect(new Date(rv.sent_at).getTime()).toBe(new Date((await one<Json>("select sent_at from public.results where request_id = $1", [r.id])).sent_at).getTime());
    expect((await one<Json>("select is_demo from public.requests where id = $1", [r.id])).is_demo).toBe(a.is_demo);
  });

  it("research_scrub_text: data URL은 지우고 이메일·전화번호는 가리며 일반 글은 그대로 둔다", async () => {
    for (const [input, expected] of SCRUB_CASES) {
      expect((await one<{ t: string }>("select public.research_scrub_text($1) as t", [input])).t, input).toBe(expected);
    }
    expect((await one<{ t: string | null }>("select public.research_scrub_text(null) as t")).t).toBeNull();
  });

  it("연락처·사진 조각이 요청 문장·칸·대화·리뷰에 있어도 보관본(30일)과 영구 리뷰에는 가려서 남는다", async () => {
    const volunteerId = vol();
    const created = await db.query<{ out_request_id: string }>(
      "select * from public.register_request($1, '소니 헤드셋 010-1234-5678', '10만 원', '새 제품', 'Sony', '헤드셋', 'new')",
      [randomUUID()],
    );
    const id = created.rows[0].out_request_id;
    await db.query("select public.claim_request($1, $2)", [id, volunteerId]);
    const o = await call("public.research_open($1::uuid, $2, $3::int)", [id, volunteerId, null]);
    const r: Actor = { id, volunteerId, sessionId: o.view.sessionId };
    const out = await apply(r, "t1", 0, {
      purchase: "research",
      slots: { model: slot("720N a@b.com"), pros: slot("가벼워요 010 1234 5678"), altReason: slot("이유") },
    }, [
      text("제 번호는 010-9999-8888, 메일은 me@example.com 입니다 data:text/plain,hello 끝", "volunteer", "answer"),
      { role: "ai", tag: "review", slot: null, ai: "ok", body: { text: "초안 02-123-4567" } },
    ]);
    expect(out.outcome).toBe("ok");
    const version = await readVersion(r);
    const confirmed = await review(r, version, "confirmed", "리뷰입니다. 문의 010-5555-6666 / x@y.kr");
    expect((await send(r, version, confirmed.review.rev, [{ name: "720N 010-1111-2222", url: "https://e.com", guide: "g", summary: [] }])).outcome).toBe("sent");
    const a = await one<Json>("select * from public.research_archives where request_id = $1", [r.id]);
    const rv = await one<Json>("select * from public.research_reviews where request_id = $1", [r.id]);
    // 무작위 uuid의 숫자 조각이 전화번호 모양으로 읽히지 않게(가끔 시험이 흔들렸다) uuid는 빼고 본다.
    const raw = JSON.stringify([a, rv]).replace(UUID_RE, "");
    expect(raw).not.toMatch(/\d{3}[- ]\d{4}[- ]\d{4}|\d{2}-\d{3}-\d{4}|@|data:/);
    expect(a.request.product).toBe("소니 헤드셋 [전화번호]");
    expect(rv.product).toBe("소니 헤드셋 [전화번호]");
    expect(a.slots.model.value).toBe("720N [이메일]");
    expect(a.slots.pros.value).toBe("가벼워요 [전화번호]");
    expect(a.messages[0].text).toBe("제 번호는 [전화번호], 메일은 [이메일] 입니다  끝");
    expect(a.review).toEqual({ final: "리뷰입니다. 문의 [전화번호] / [이메일]", draft: "초안 [전화번호]", rev: confirmed.review.rev });
    expect(rv.review_text).toBe("리뷰입니다. 문의 [전화번호] / [이메일]");
    expect(rv.model).toBe("720N [이메일]");
  });

  it("리뷰가 공백뿐이면 후보 1의 가이드를 리뷰 문단으로 쓰고, 둘 다 비면 보내지 않는다(아무것도 남지 않음)", async () => {
    const a = await ready();
    await review(a.r, a.version, "confirmed", "   \n ");
    const aRev = (await one<{ rev: number }>("select (review->>'rev')::int as rev from public.research_sessions where request_id = $1", [a.r.id])).rev;
    expect((await send(a.r, a.version, aRev)).outcome).toBe("sent");
    expect((await one<Json>("select review_text from public.research_reviews where request_id = $1", [a.r.id])).review_text).toBe("리뷰 문단");

    const b = await ready();
    await review(b.r, b.version, "confirmed", "   ");
    const bRev = (await one<{ rev: number }>("select (review->>'rev')::int as rev from public.research_sessions where request_id = $1", [b.r.id])).rev;
    expect((await send(b.r, b.version, bRev, [{ ...CANDIDATES[0], guide: " " }])).outcome).toBe("review_not_confirmed");
    expect(await count("public.research_archives where request_id = $1", [b.r.id])).toBe(0);
    expect(await count("public.research_reviews where request_id = $1", [b.r.id])).toBe(0);
    expect(await count("public.results where request_id = $1", [b.r.id])).toBe(0);
    expect((await one<Json>("select status from public.requests where id = $1", [b.r.id])).status).toBe("in_progress");
    // 가이드를 채워 다시 보내면 들어간다.
    expect((await send(b.r, b.version, bRev, [{ ...CANDIDATES[0], guide: "대체 문단" }])).outcome).toBe("sent");
    expect((await one<Json>("select review_text from public.research_reviews where request_id = $1", [b.r.id])).review_text).toBe("대체 문단");
  });

  it("혜택 링크 주소에 전화번호·이메일·data URL이 섞여 있으면 영구 기록에 넣지 않고 확인 날짜도 가린다", async () => {
    const { r, version, rev } = await ready();
    const bad = "https://shop.example/?email=a@b.com&phone=010-1234-5678";
    const encoded = "https://shop.example/?email=a%40b.com";
    await db.query(
      `update public.research_sessions set slots = slots || jsonb_build_object('benefits', jsonb_build_object(
         'value', 'x', 'status', 'confirmed', 'by', 'volunteer', 'at', '2026-11-17T02:00:00Z 010-1234-5678',
         'links', jsonb_build_array($2::text, $3::text, $4::text))) where request_id = $1`,
      [r.id, bad, encoded, BENEFIT_URL],
    );
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const rv = await one<Json>("select benefit_links from public.research_reviews where request_id = $1", [r.id]);
    expect(rv.benefit_links).toHaveLength(1);
    expect(rv.benefit_links[0]).toMatchObject({ url: BENEFIT_URL, confirmedAt: "2026-11-17T02:00:00Z [전화번호]" });
    expect(JSON.stringify(rv)).not.toContain("a@b.com");
    expect(JSON.stringify(rv)).not.toContain("a%40b.com");
    // 30일 보관본의 칸에도 그 링크는 없다(깨진 주소를 남기지 않는다).
    const a = await one<Json>("select slots from public.research_archives where request_id = $1", [r.id]);
    expect(a.slots.benefits.links).toEqual([BENEFIT_URL]);
    expect(JSON.stringify(a)).not.toContain("a@b.com");
    expect(JSON.stringify(a)).not.toContain("a%40b.com");
  });

  it("리뷰·메시지는 SQL left()처럼 문자(코드 포인트) 수로 자르고, 글 속 깨질 주소는 통째로 뺀다", async () => {
    const review = await one<{ n: number; t: string }>(
      "select char_length(public.research_final_review(jsonb_build_object('text', $1::text), '[]'::jsonb)) as n, '' as t",
      ["😀".repeat(1500)],
    );
    expect(review.n).toBe(1000);
    const paragraph = await one<{ t: string }>(
      "select public.research_final_review(jsonb_build_object('text', $1::text), '[]'::jsonb) as t",
      ["혜택 https://shop.example/?email=a@b.com"],
    );
    expect(paragraph.t).toBe("혜택");
    const r = await opened();
    expect((await apply(r, "t1", 0, { purchase: "research" }, [{ role: "ai", tag: "question", slot: null, ai: "none", body: { headline: "a ".repeat(1000), text: "😀".repeat(1500) } }])).outcome).toBe("ok");
    const m = await one<Json>("select public.research_archive_messages($1) as m", [r.id]);
    expect(Array.from(m.m[0].text)).toHaveLength(3000);
    expect(m.m[0].text.endsWith("😀")).toBe(true);
  });

  it("메시지의 tag·slot에 연락처가 들어 있어도 가린다", async () => {
    const r = await opened();
    const out = await apply(r, "t1", 0, { purchase: "research" }, [
      { role: "ai", tag: "q 010-1234-5678", slot: "a@b.com", ai: "none", body: { text: "글" } },
    ]);
    expect(out.outcome).toBe("ok");
    const m = await one<Json>("select public.research_archive_messages($1) as m", [r.id]);
    expect(m.m).toEqual([{ seq: 1, role: "ai", tag: "q [전화번호]", slot: "[이메일]", text: "글" }]);
  });

  it("같은 요청을 다시 보내면 existing이고 두 표는 1행 그대로다", async () => {
    const { r, version, rev } = await ready();
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const before = await one<Json>("select a.id as a, v.id as v from public.research_archives a join public.research_reviews v using (request_id) where request_id = $1", [r.id]);
    const again = await send(r, version, rev);
    expect(again.outcome).toBe("existing");
    expect(await count("public.research_archives where request_id = $1", [r.id])).toBe(1);
    expect(await count("public.research_reviews where request_id = $1", [r.id])).toBe(1);
    const after = await one<Json>("select a.id as a, v.id as v from public.research_archives a join public.research_reviews v using (request_id) where request_id = $1", [r.id]);
    expect(after).toEqual(before);
    // request_id가 같은 행을 직접 넣으려 해도 unique라 막힌다.
    await expect(db.query("insert into public.research_reviews (request_id, review_text) values ($1, 'x')", [r.id])).rejects.toThrow(/duplicate key/);
    await expect(db.query("insert into public.research_archives (request_id) values ($1)", [r.id])).rejects.toThrow(/duplicate key/);
  });

  it("보내기가 실패하면(필수 부족·리뷰 미확정·잘못된 후보) 두 표에 아무것도 남지 않는다", async () => {
    const r = await opened();
    expect((await send(r, 0, 0)).outcome).toBe("missing_required");
    const { r: r2, version, rev } = await ready();
    expect((await send(r2, version, rev + 1)).outcome).toBe("review_not_confirmed");
    expect((await send(r2, version, rev, [])).outcome).toBe("bad_request");
    expect(await count("public.research_archives where request_id = any($1::uuid[])", [[r.id, r2.id]])).toBe(0);
    expect(await count("public.research_reviews where request_id = any($1::uuid[])", [[r.id, r2.id]])).toBe(0);
    // 이어서 제대로 보내면 들어간다.
    expect((await send(r2, version, rev)).outcome).toBe("sent");
    expect(await count("public.research_archives where request_id = $1", [r2.id])).toBe(1);
  });

  it("리서치만(사진 없음)이면 verified가 false이고 같이 고민한 제품이 없으면 alts는 빈 배열이다", async () => {
    const r = await opened();
    const out = await apply(r, "t1", 0, {
      purchase: "research",
      slots: { model: slot("720N"), pros: slot("가벼워요"), altReason: slot("이유") },
    }, [text("답", "volunteer", "answer")]);
    expect(out.outcome).toBe("ok");
    const version = await readVersion(r);
    const confirmed = await review(r, version, "confirmed");
    expect((await send(r, version, confirmed.review.rev, [CANDIDATES[0]])).outcome).toBe("sent");
    const rv = await one<Json>("select * from public.research_reviews where request_id = $1", [r.id]);
    expect(rv).toMatchObject({ purchase: "research", verified: false, alts: [], benefit_links: [] });
    const a = await one<Json>("select * from public.research_archives where request_id = $1", [r.id]);
    expect(a.verified).toBe(false);
    expect(a.review.draft).toBeNull();
  });

  it("긴 대화는 메모리판(archiveMessages)과 같은 개수에서 멈춘다", async () => {
    // tests/unit/researchArchive.test.ts의 같은 이름 시험과 같은 입력·같은 숫자(LONG_CHAT_KEPT).
    const long = "가".repeat(1013);
    const r = await opened();
    const messages = [
      text("어떤 기종을 쓰셨나요?", "ai", "question", "model"),
      ...Array.from({ length: 120 }, (_, i) => text(`${i} ${long}`, i % 2 === 0 ? "ai" : "volunteer", "answer")),
    ];
    expect((await apply(r, "t1", 0, { purchase: "research" }, messages)).outcome).toBe("ok");
    const m = await one<Json>("select public.research_archive_messages($1) as m", [r.id]);
    expect(m.m).toHaveLength(LONG_CHAT_KEPT);
  });

  it("대화가 아주 길어도 messages는 200KB 안으로 줄여 담고 보내기는 성공한다", async () => {
    // 본문 8,000바이트 안쪽(한글 약 2,600자)짜리 메시지 120개 = 약 900KB.
    const long = "가".repeat(2600);
    const many = Array.from({ length: 120 }, (_, i) => text(`${i} ${long}`, i % 2 === 0 ? "ai" : "volunteer", "answer"));
    const { r, version, rev } = await ready(many);
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const size = await one<{ n: number; len: number }>(
      "select octet_length(messages::text) as n, jsonb_array_length(messages) as len from public.research_archives where request_id = $1",
      [r.id],
    );
    expect(size.n).toBeLessThanOrEqual(204_800);
    expect(size.n).toBeGreaterThan(150_000);
    expect(size.len).toBeLessThan(125);
    // 앞쪽부터 자르므로 처음 질문은 남는다.
    const first = await one<Json>("select messages->0 as m from public.research_archives where request_id = $1", [r.id]);
    expect(first.m.text).toBe("어떤 기종을 쓰셨나요?");
  });
});

describe("요청이 지워져도 남는다", () => {
  it("done 7일 정리로 요청이 지워져도 두 표 행은 남는다", async () => {
    const { r, version, rev } = await ready();
    expect((await send(r, version, rev)).outcome).toBe("sent");
    await db.query("update public.requests set done_at = now() - interval '8 days' where id = $1", [r.id]);
    await db.query("select * from public.register_request($1, '다른 물건', '1만 원', '아무거나', null, '물건', 'any')", [randomUUID()]);
    expect(await count("public.requests where id = $1", [r.id])).toBe(0);
    expect(await count("public.results where request_id = $1", [r.id])).toBe(0);
    expect(await count("public.research_archives where request_id = $1", [r.id])).toBe(1);
    expect(await count("public.research_reviews where request_id = $1", [r.id])).toBe(1);
  });

  it("시연용 요청 다시 채우기(reset_demo_requests)로 요청이 지워져도 두 표 행은 남고 is_demo다", async () => {
    await db.query("select public.reset_demo_requests($1)", [null]);
    const demo = await one<{ id: string }>("select id from public.requests where is_demo and status = 'waiting' order by queue_number limit 1");
    const volunteerId = vol();
    expect((await one<{ c: string }>("select public.claim_request($1, $2) as c", [demo.id, volunteerId])).c).toBe("claimed");
    const o = await call("public.research_open($1::uuid, $2, $3::int)", [demo.id, volunteerId, null]);
    const r: Actor = { id: demo.id, volunteerId, sessionId: o.view.sessionId };
    await apply(r, "t1", 0, { purchase: "research", slots: { model: slot("시연 기종"), pros: slot("장점"), altReason: slot("이유") } },
      [text("시연 답", "volunteer", "answer")]);
    const version = await readVersion(r);
    const confirmed = await review(r, version, "confirmed", "시연 리뷰 문단");
    expect((await send(r, version, confirmed.review.rev, [CANDIDATES[0]])).outcome).toBe("sent");
    await db.query("select public.reset_demo_requests($1)", [null]);
    expect(await count("public.requests where id = $1", [demo.id])).toBe(0);
    const a = await one<Json>("select is_demo, request from public.research_archives where request_id = $1", [demo.id]);
    expect(a.is_demo).toBe(true);
    const rv = await one<Json>("select is_demo, review_text from public.research_reviews where request_id = $1", [demo.id]);
    expect(rv).toEqual({ is_demo: true, review_text: "시연 리뷰 문단" });
  });
});

describe("30일 보관과 영구 보관", () => {
  it("sweep은 30일 지난 research_archives만 지우고 research_reviews는 남긴다", async () => {
    const old = await ready();
    const fresh = await ready();
    expect((await send(old.r, old.version, old.rev)).outcome).toBe("sent");
    expect((await send(fresh.r, fresh.version, fresh.rev)).outcome).toBe("sent");
    await db.query("update public.research_archives set created_at = now() - interval '31 days' where request_id = $1", [old.r.id]);
    await db.query("update public.research_archives set created_at = now() - interval '29 days' where request_id = $1", [fresh.r.id]);
    await db.query("update public.research_reviews set created_at = now() - interval '400 days' where request_id = $1", [old.r.id]);
    const swept = await one<{ n: number }>("select public.research_sweep() as n");
    expect(typeof swept.n).toBe("number");
    expect(await count("public.research_archives where request_id = $1", [old.r.id])).toBe(0);
    expect(await count("public.research_archives where request_id = $1", [fresh.r.id])).toBe(1);
    expect(await count("public.research_reviews where request_id = any($1::uuid[])", [[old.r.id, fresh.r.id]])).toBe(2);
    // 한 번 더 돌려도 같다.
    await db.query("select public.research_sweep()");
    expect(await count("public.research_reviews where request_id = any($1::uuid[])", [[old.r.id, fresh.r.id]])).toBe(2);
  });

  it("sweep의 6시간 정리와 반환 값은 마이그레이션 1과 같다(대기열로 돌린 요청 수)", async () => {
    const idle = await opened();
    await db.query("update public.requests set claimed_at = now() - interval '7 hours' where id = $1", [idle.id]);
    await db.query("update public.research_sessions set updated_at = now() - interval '7 hours' where request_id = $1", [idle.id]);
    const swept = await one<{ n: number }>("select public.research_sweep() as n");
    expect(swept.n).toBeGreaterThanOrEqual(1);
    expect((await one<{ status: string }>("select status from public.requests where id = $1", [idle.id])).status).toBe("waiting");
  });
});

describe("보관은 보내기를 막지 않는다", () => {
  const setLinks = (id: string, links: string[]) =>
    db.query(
      `update public.research_sessions set slots = slots || jsonb_build_object(
         'benefits', jsonb_build_object('value', 'x', 'links', $2::jsonb, 'status', 'confirmed', 'by', 'volunteer', 'at', '2026-11-17T02:00:00Z'))
       where request_id = $1`,
      [id, JSON.stringify(links)],
    );
  const benefitCard = (url: string) => ({
    role: "ai", tag: "search", slot: "benefits", ai: "ok",
    body: { kind: "benefits", items: [{ title: "제".repeat(60), kind: "종".repeat(40), condition: "조".repeat(80), compare: "", url }] },
  });

  it("혜택 링크는 앱 상한과 같은 4개까지만 영구 리뷰에 넣는다(순서 유지)", async () => {
    const { r, version, rev } = await ready();
    const links = Array.from({ length: 7 }, (_, i) => `https://shop.example.com/e/${i}`);
    await setLinks(r.id, links);
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const rv = await one<Json>("select benefit_links from public.research_reviews where request_id = $1", [r.id]);
    expect(rv.benefit_links.map((l: Json) => l.url)).toEqual(links.slice(0, 4));
  });

  it("링크 4개가 최대 길이(한글 주소 500자)여도 보내기는 성공하고 영구 표 한도(8,000바이트) 안으로 뒤에서부터 덜어 낸다", async () => {
    // tests/unit/researchArchive.test.ts의 같은 이름 시험과 같은 입력·같은 결과(앞 3개).
    const urls = Array.from({ length: 4 }, (_, i) => `https://shop.example.com/${i}${"가".repeat(474)}`);
    const { r, version, rev } = await ready(urls.map(benefitCard));
    await setLinks(r.id, urls);
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const rv = await one<Json>("select benefit_links, octet_length(benefit_links::text) as n from public.research_reviews where request_id = $1", [r.id]);
    expect(rv.benefit_links.map((l: Json) => l.url)).toEqual(urls.slice(0, 3));
    expect(rv.n).toBeLessThanOrEqual(7500);
    expect(await count("public.research_archives where request_id = $1", [r.id])).toBe(1);
  });

  it("가리면서 칸이 30,000바이트를 넘으면 칸은 {}로 줄여 담고 보내기와 영구 리뷰는 그대로 된다", async () => {
    const { r, version, rev } = await ready();
    await db.query(
      `update public.research_sessions set slots = slots || jsonb_build_object('pros', jsonb_build_object(
         'value', $2::text, 'status', 'filled', 'by', 'volunteer')) where request_id = $1`,
      [r.id, "01012345678 ".repeat(2100)],
    );
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const a = await one<Json>("select slots from public.research_archives where request_id = $1", [r.id]);
    expect(a.slots).toEqual({});
    expect(await count("public.research_reviews where request_id = $1", [r.id])).toBe(1);
  });

  it("마지막 안전망: 보관 표 검사에 걸려도(check_violation) 보내기는 성공하고 그 표만 비어 있다", async () => {
    for (const table of NEW_TABLES) {
      await db.exec(`alter table public.${table} add constraint tmp_block check (false) not valid`);
      try {
        const { r, version, rev } = await ready();
        const sent = await send(r, version, rev);
        expect(sent.outcome, table).toBe("sent");
        expect(await count(`public.${table} where request_id = $1`, [r.id]), table).toBe(0);
        const other = NEW_TABLES.find((name) => name !== table);
        expect(await count(`public.${other} where request_id = $1`, [r.id]), `${table} 말고 ${other}`).toBe(1);
        expect(await count("public.results where request_id = $1", [r.id]), table).toBe(1);
        expect((await one<Json>("select status from public.requests where id = $1", [r.id])).status, table).toBe("done");
      } finally {
        await db.exec(`alter table public.${table} drop constraint tmp_block`);
      }
    }
  });

  it("혜택 확인 시각이 없으면 보낸 시각을 초 단위 UTC 모양으로 쓴다(메모리판과 같은 모양)", async () => {
    const { r, version, rev } = await ready();
    await db.query(
      "update public.research_sessions set slots = jsonb_set(slots, '{benefits}', (slots->'benefits') - 'at') where request_id = $1",
      [r.id],
    );
    expect((await send(r, version, rev)).outcome).toBe("sent");
    const rv = await one<Json>("select benefit_links from public.research_reviews where request_id = $1", [r.id]);
    expect(rv.benefit_links[0].confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("모델 앞뒤 공백은 스페이스만 뗀다(메모리판과 같다)", async () => {
    const a = await ready();
    const b = await ready();
    for (const [x, value] of [[a, "  720N  "], [b, "\t720N"]] as const) {
      await db.query(
        `update public.research_sessions set slots = slots || jsonb_build_object('model', jsonb_build_object(
           'value', $2::text, 'status', 'filled', 'by', 'volunteer')) where request_id = $1`,
        [x.r.id, value],
      );
      expect((await send(x.r, x.version, x.rev)).outcome).toBe("sent");
    }
    expect((await one<Json>("select model from public.research_reviews where request_id = $1", [a.r.id])).model).toBe("720N");
    expect((await one<Json>("select model from public.research_reviews where request_id = $1", [b.r.id])).model).toBe("\t720N");
  });

  it("두 표에 영구·시연 구분 안내(재사용 조회는 is_demo = false)가 표 설명으로 붙어 있다", async () => {
    for (const name of NEW_TABLES) {
      const row = await one<{ d: string | null }>("select obj_description(to_regclass($1), 'pg_class') as d", [`public.${name}`]);
      expect(row.d, name).toMatch(/is_demo/);
    }
  });
});

describe("A1 보내기 회귀(보관 마이그레이션 적용 뒤에도 같다)", () => {
  // tests/unit/sql/researchSql.test.ts의 보내기 시험은 마이그레이션 1~3에서만 돈다. research_send를 바꾼 4번째 마이그레이션 뒤에도 같은 가드가 걸리는지 본다.
  it("필수 부족·리뷰 미확정·낡은 version·rev 불일치는 같은 결과 이름이고 아무것도 남지 않는다", async () => {
    const r = await opened();
    const miss = await send(r, 0, 0);
    expect(miss).toMatchObject({ outcome: "missing_required" });
    expect(miss.missing).toEqual(["purchase", "model", "pros", "altReason"]);
    const { r: r2, version, rev } = await ready();
    expect((await send(r2, version - 1, rev)).outcome).toBe("stale");
    expect((await send(r2, version, rev + 1)).outcome).toBe("review_not_confirmed");
    expect((await review(r2, version, "draft")).review.status).toBe("draft");
    expect((await send(r2, version, rev)).outcome).toBe("review_not_confirmed");
    expect(await count("public.research_archives where request_id = any($1::uuid[])", [[r.id, r2.id]])).toBe(0);
    expect(await count("public.research_reviews where request_id = any($1::uuid[])", [[r.id, r2.id]])).toBe(0);
  });

  it("구매함인데 사진 행이 없으면(칸 표시만 있어도) 보낼 수 없다", async () => {
    const { r, version, rev } = await ready();
    await db.query("delete from public.research_photos where request_id = $1", [r.id]);
    expect(await send(r, version, rev)).toMatchObject({ outcome: "missing_required", missing: ["photo"] });
    expect(await count("public.research_archives where request_id = $1", [r.id])).toBe(0);
  });

  it("남의 요청·세션이 바뀐 요청은 not_yours·session_changed로 막힌다", async () => {
    const { r, version, rev } = await ready();
    expect((await send({ ...r, volunteerId: vol() }, version, rev)).outcome).toBe("not_yours");
    expect((await send({ ...r, sessionId: randomUUID() }, version, rev)).outcome).toBe("session_changed");
    expect(await count("public.research_archives where request_id = $1", [r.id])).toBe(0);
    expect((await send(r, version, rev)).outcome).toBe("sent");
  });

  it("다른 탭이 먼저 보냈으면(결과가 이미 있으면) existing이다", async () => {
    const { r, version, rev } = await ready();
    expect((await send(r, version, rev)).outcome).toBe("sent");
    expect((await send({ ...r, sessionId: randomUUID() }, version, rev)).outcome).toBe("existing");
    expect((await send({ ...r, volunteerId: r.volunteerId }, version + 5, rev + 5)).outcome).toBe("existing");
  });
});

describe("마이그레이션 되돌리기", () => {
  it("적용 → 되돌리기 → 다시 적용", async () => {
    await db.exec(sql(DOWN));
    for (const name of NEW_TABLES) {
      expect((await one<{ t: string | null }>("select to_regclass($1)::text as t", [`public.${name}`])).t, name).toBeNull();
    }
    for (const name of NEW_FUNCTIONS) {
      expect(await count("pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name]), name).toBe(0);
    }
    // send·sweep은 마이그레이션 1의 정의 전문으로 돌아가고 오버로드는 1개다.
    const back = await definitions(["research_send", "research_sweep"]);
    expect(back.research_send).toBe(a1Send);
    expect(back.research_sweep).toBe(a1Sweep);
    expect(await definitions(A1_FUNCTIONS_KEPT)).toEqual(a1Others);
    expect(await definitions(EXISTING_FUNCTIONS)).toEqual(existingBefore);
    // 되돌린 상태에서도 보내기가 된다(보관 없이). 권한도 그대로다.
    const plain = await ready();
    expect((await send(plain.r, plain.version, plain.rev)).outcome).toBe("sent");
    const priv = await one<{ a: boolean; s: boolean }>(
      `select has_function_privilege('anon', 'public.research_send(uuid,text,uuid,int,int,jsonb)', 'execute') as a,
              has_function_privilege('service_role', 'public.research_send(uuid,text,uuid,int,int,jsonb)', 'execute') as s`,
    );
    expect(priv).toEqual({ a: false, s: true });

    await db.exec(sql(MIGRATIONS[3]));
    const again = await ready();
    expect((await send(again.r, again.version, again.rev)).outcome).toBe("sent");
    expect(await count("public.research_archives where request_id = $1", [again.r.id])).toBe(1);
    expect(await count("public.research_reviews where request_id = $1", [again.r.id])).toBe(1);
    for (const name of ["research_send", "research_sweep"]) {
      expect(await count("pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name]), name).toBe(1);
    }
    // 한 번 더 되돌렸다 올려도 된다.
    await db.exec(sql(DOWN));
    await db.exec(sql(MIGRATIONS[3]));
    const third = await ready();
    expect((await send(third.r, third.version, third.rev)).outcome).toBe("sent");
  });
});
