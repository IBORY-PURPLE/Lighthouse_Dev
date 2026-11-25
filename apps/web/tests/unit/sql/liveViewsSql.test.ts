import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// /live 대화 기록 보기 SQL 시험(PGlite = 진짜 Postgres를 WASM으로). 마이그레이션 20261125010000_live_views.sql.
// 앞선 마이그레이션 10개를 순서대로 적용한 뒤 보기 3개를 더한다. 줄은 모두 가짜다.

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
  "supabase/migrations/20261125000000_live_events.sql",
];
const VIEWS = "supabase/migrations/20261125010000_live_views.sql";
const DOWN = "supabase/rollback/20261125010000_live_views_down.sql";
const NAMES = ["live_calls", "live_people", "live_transcript"] as const;

const sql = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const PHONE_A = `u-${"a".repeat(32)}`; // 통화 2번(접수 1번), 성함을 말함
const PHONE_B = `u-${"b".repeat(32)}`; // 통화 1번, 성함을 듣기 전에 끝남
const PHONE_C = `u-${"c".repeat(32)}`; // 화면만 열었다 닫음(이용자 말 없음)
const cid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

let db: PGlite;
let clock = 0;

async function rows<T>(text: string): Promise<T[]> {
  return (await db.query<T>(text)).rows;
}

/** 줄 하나를 넣는다. created_at은 넣는 순서대로 1초씩 늦춘다. */
async function line(device: string, call: number, seq: number, kind: string, tag: string, body: string, atMs: number) {
  clock += 1;
  await db.query(
    `insert into public.live_events (cid, seq, device_id, kind, tag, body, engine, at_ms, env, created_at)
     values ($1, $2, $3, $4, $5, $6, 'realtime', $7, 'production',
             timestamptz '2026-11-25 16:00:00+09' + make_interval(secs => $8))`,
    [cid(call), seq, device, kind, tag, body, atMs, clock],
  );
}

async function privileges(role: string): Promise<boolean[]> {
  const out: boolean[] = [];
  for (const name of NAMES) {
    for (const priv of ["select", "insert", "update", "delete"]) {
      const r = await rows<{ ok: boolean }>(
        `select has_table_privilege('${role}', 'public.${name}', '${priv}') as ok`,
      );
      out.push(r[0].ok);
    }
  }
  return out;
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase처럼 새 표·보기에 기본으로 모든 권한이 붙게 한다(걷어 내는 줄이 실제로 일하는지 보려고).
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const file of BEFORE) await db.exec(sql(file));
  await db.exec(sql(VIEWS));

  // 폰 A 통화 1: 물건 → AI가 성함을 여쭘 → 성함 → 요약 → 접수
  await line(PHONE_A, 1, 0, "event", "START", "", 0);
  await line(PHONE_A, 1, 1, "app", "say:guideFirstVoice", "안내를 읽어 드릴게요", 500);
  await line(PHONE_A, 1, 2, "user", "part", "무선 이어폰 찾아 주세요", 3000);
  await line(PHONE_A, 1, 3, "ai", "reply", "이 대화는 글자로 저장돼요. 성함을 말씀해 주시겠어요?", 5000);
  await line(PHONE_A, 1, 4, "event", "sent:voice", "", 5100);
  await line(PHONE_A, 1, 5, "user", "part", "가나다입니다", 9000);
  await line(PHONE_A, 1, 6, "user", "heard", "다음", 11000);
  await line(PHONE_A, 1, 7, "ai", "reply", "가나다 님, 고맙습니다. 성함은 한 번만 여쭙니다.", 13000);
  await line(PHONE_A, 1, 8, "event", "REGISTER_OK", "", 31000);
  // 폰 C: 화면만 열었다 닫음
  await line(PHONE_C, 2, 0, "event", "HIDDEN", "", 0);
  await line(PHONE_C, 2, 1, "app", "say:endedEmpty", "마쳤어요", 900);
  // 폰 B 통화 1: 한마디 하고, 성함 질문을 듣고 닫음
  await line(PHONE_B, 3, 0, "user", "part", "키보드요", 2000);
  await line(PHONE_B, 3, 1, "ai", "reply", "성함을 말씀해 주시겠어요?", 4000);
  // 폰 A 통화 2: 성함을 다시 묻지 않은 짧은 대화
  await line(PHONE_A, 4, 0, "user", "part", "하나 더 부탁해요", 1500);
  await line(PHONE_A, 4, 1, "ai", "reply", "네, 어떤 물건인가요?", 3500);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("권한과 구조", () => {
  it("보기 3개가 security_invoker로 만들어진다", async () => {
    const found = await rows<{ relname: string; relkind: string; reloptions: string[] }>(
      `select relname, relkind, reloptions from pg_class
        where relnamespace = 'public'::regnamespace and relname = any(array['live_calls','live_people','live_transcript'])
        order by relname`,
    );
    expect(found).toEqual(
      NAMES.map((relname) => ({ relname, relkind: "v", reloptions: ["security_invoker=true"] })),
    );
  });

  it("anon, authenticated, service_role은 어느 보기에도 권한이 없다", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await privileges(role)).toEqual(new Array(12).fill(false));
    }
  });

  it("service_role로 읽으면 거절된다", async () => {
    await db.exec("set role service_role");
    try {
      for (const name of NAMES) {
        await expect(db.query(`select count(*) from public.${name}`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await db.exec("reset role");
    }
  });

  it("live_events의 권한과 줄 수는 그대로다", async () => {
    const r = await rows<{ ins: boolean; sel: boolean; upd: boolean; del: boolean; anon: boolean; n: number }>(
      `select has_table_privilege('service_role', 'public.live_events', 'insert') as ins,
              has_table_privilege('service_role', 'public.live_events', 'select') as sel,
              has_table_privilege('service_role', 'public.live_events', 'update') as upd,
              has_table_privilege('service_role', 'public.live_events', 'delete') as del,
              has_table_privilege('anon', 'public.live_events', 'select') as anon,
              (select count(*)::int from public.live_events) as n`,
    );
    expect(r[0]).toEqual({ ins: true, sel: true, upd: false, del: false, anon: false, n: 15 });
  });
});

describe("live_calls: 한 줄 = 통화 하나", () => {
  it("이용자 말이 있는 통화만, 사람·통화 번호를 처음 말한 순서로 붙인다", async () => {
    const got = await rows(
      `select name_said, person_no::int, call_no::int, seconds, user_lines::int, ai_lines::int, total_lines::int,
              registered, engine, env, device_id, cid::text
         from public.live_calls`,
    );
    expect(got).toEqual([
      { name_said: "가나다입니다", person_no: 1, call_no: 1, seconds: 31, user_lines: 3, ai_lines: 2, total_lines: 9, registered: true, engine: "realtime", env: "production", device_id: PHONE_A, cid: cid(1) },
      { name_said: "가나다입니다", person_no: 1, call_no: 2, seconds: 3, user_lines: 1, ai_lines: 1, total_lines: 2, registered: false, engine: "realtime", env: "production", device_id: PHONE_A, cid: cid(4) },
      { name_said: "", person_no: 2, call_no: 1, seconds: 4, user_lines: 1, ai_lines: 1, total_lines: 2, registered: false, engine: "realtime", env: "production", device_id: PHONE_B, cid: cid(3) },
    ]);
  });

  it("시작 시각을 한국 시간으로 보여 준다", async () => {
    const got = await rows<{ started_kst: string }>("select started_kst from public.live_calls");
    expect(got.map((r) => r.started_kst)).toEqual(["11-25 16:00:01", "11-25 16:00:14", "11-25 16:00:12"]);
  });
});

describe("live_people: 한 줄 = 사람 하나", () => {
  it("사람마다 통화 수와 줄 수를 모은다. 말이 없는 기기는 없다", async () => {
    const got = await rows(
      `select name_said, person_no::int, calls::int, user_lines::int, total_lines::int, registered_calls::int, device_id
         from public.live_people`,
    );
    expect(got).toEqual([
      { name_said: "가나다입니다", person_no: 1, calls: 2, user_lines: 4, total_lines: 11, registered_calls: 1, device_id: PHONE_A },
      { name_said: "", person_no: 2, calls: 1, user_lines: 1, total_lines: 2, registered_calls: 0, device_id: PHONE_B },
    ]);
  });
});

describe("live_transcript: 한 줄 = 말 한 마디", () => {
  it("사건 줄을 빼고 사람·통화·줄 순서로 보여 준다", async () => {
    const got = await rows<{ who: string }>(
      `select name_said || '|' || person_no || '|' || call_no || '|' || seq || '|' || speaker || '|' || said as who
         from public.live_transcript`,
    );
    expect(got.map((r) => r.who)).toEqual([
      "가나다입니다|1|1|1|앱 안내|안내를 읽어 드릴게요",
      "가나다입니다|1|1|2|이용자|무선 이어폰 찾아 주세요",
      "가나다입니다|1|1|3|AI|이 대화는 글자로 저장돼요. 성함을 말씀해 주시겠어요?",
      "가나다입니다|1|1|5|이용자|가나다입니다",
      "가나다입니다|1|1|6|이용자|다음",
      "가나다입니다|1|1|7|AI|가나다 님, 고맙습니다. 성함은 한 번만 여쭙니다.",
      "가나다입니다|1|2|0|이용자|하나 더 부탁해요",
      "가나다입니다|1|2|1|AI|네, 어떤 물건인가요?",
      "|2|1|0|이용자|키보드요",
      "|2|1|1|AI|성함을 말씀해 주시겠어요?",
    ]);
  });

  it("성함으로 거르면 그 사람의 줄만 남는다", async () => {
    const got = await rows<{ n: number; devices: number }>(
      `select count(*)::int as n, count(distinct device_id)::int as devices
         from public.live_transcript where name_said = '가나다입니다'`,
    );
    expect(got[0]).toEqual({ n: 8, devices: 1 });
  });

  it("흐른 시간을 초로 보여 준다", async () => {
    const got = await rows<{ at_sec: string }>(
      "select at_sec::text from public.live_transcript where person_no = 2 order by seq",
    );
    expect(got.map((r) => r.at_sec)).toEqual(["2.0", "4.0"]);
  });
});

describe("성함 고르기", () => {
  it("성함을 여쭌 뒤 말한 줄이 나중에 들어와도 그 기기의 성함이 된다", async () => {
    await line(PHONE_B, 3, 2, "user", "part", "라마바예요", 8000);
    const got = await rows<{ name_said: string }>(
      `select name_said from public.live_people where device_id = '${PHONE_B}'`,
    );
    expect(got).toEqual([{ name_said: "라마바예요" }]);
  });

  it("AI가 성함을 두 번 말해도 처음 여쭌 줄의 다음 말을 쓴다", async () => {
    const got = await rows<{ name_said: string }>(
      `select distinct name_said from public.live_calls where device_id = '${PHONE_A}'`,
    );
    expect(got).toEqual([{ name_said: "가나다입니다" }]);
  });
});

describe("되돌리기", () => {
  it("보기 3개만 지우고 live_events의 줄은 그대로 둔다", async () => {
    const before = await rows<{ n: number }>("select count(*)::int as n from public.live_events");
    await db.exec(sql(DOWN));
    const left = await rows<{ n: number }>(
      `select count(*)::int as n from pg_class
        where relnamespace = 'public'::regnamespace and relname = any(array['live_calls','live_people','live_transcript'])`,
    );
    expect(left[0].n).toBe(0);
    const after = await rows<{ n: number }>("select count(*)::int as n from public.live_events");
    expect(after[0].n).toBe(before[0].n);
    // 되돌린 뒤 다시 적용할 수 있다.
    await db.exec(sql(VIEWS));
    const again = await rows<{ n: number }>("select count(*)::int as n from public.live_people");
    expect(again[0].n).toBe(2);
  });
});
