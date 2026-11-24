import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveLogMode, liveLogStatus } from "@/lib/liveConfig";
import {
  DAILY_ROW_CAP,
  TABLE_ROW_CAP,
  DB_TIMEOUT_MS,
  MEMORY_MAX_ROWS,
  UNAVAILABLE_COOLDOWN_MS,
  cleanLiveLogEntries,
  liveLogEnv,
  memoryLiveEventsForTest,
  resetLiveLogForTest,
  saveLiveEvents,
  type LiveEventRow,
} from "@/lib/liveLogStore";
import * as requestStore from "@/lib/requestStore";

// 대화 기록의 스위치(liveConfig), 줄 정리, 저장(liveLogStore). 네트워크·실제 DB는 쓰지 않는다.

const DEVICE = `u-${"a".repeat(32)}`;
const CID = "123e4567-e89b-42d3-a456-426614174000";
const CONTEXT = { deviceId: DEVICE, label: "P01" };

const entry = (patch: Record<string, unknown> = {}) => ({
  cid: CID,
  seq: 0,
  kind: "user",
  tag: "heard",
  body: "소니 헤드셋 찾아 주세요",
  phase: "listening",
  engine: "realtime",
  atMs: 1200,
  ...patch,
});

const clean = (entries: unknown, context = CONTEXT) => cleanLiveLogEntries(entries, context);

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "");
  resetLiveLogForTest();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("liveLogMode (LIVE_LOG, LIVE_LOG_UNTIL)", () => {
  it("on은 label, all은 all, 그 밖과 없음은 꺼짐(off)이다", () => {
    vi.stubEnv("LIVE_LOG", "on");
    expect(liveLogMode()).toBe("label");
    vi.stubEnv("LIVE_LOG", " ALL ");
    expect(liveLogMode()).toBe("all");
    for (const value of ["", "off", "yes", "1", "label"]) {
      vi.stubEnv("LIVE_LOG", value);
      expect(liveLogMode()).toBeNull();
      expect(liveLogStatus()).toEqual({ mode: null, reason: "off" });
    }
    vi.stubEnv("LIVE_LOG", undefined);
    expect(liveLogStatus().reason).toBe("off");
  });

  it("끝 날짜는 한국 시간 그날 23:59:59.999까지 켜져 있고 다음 순간부터 ended다", () => {
    vi.stubEnv("LIVE_LOG", "on");
    vi.stubEnv("LIVE_LOG_UNTIL", "2026-12-03");
    // 2026-12-03T23:59:59.999+09:00
    const last = Date.parse("2026-12-03T23:59:59.999+09:00");
    expect(liveLogMode(last)).toBe("label");
    expect(liveLogStatus(last)).toEqual({ mode: "label", reason: "on" });
    expect(liveLogMode(last + 1)).toBeNull();
    expect(liveLogStatus(last + 1)).toEqual({ mode: null, reason: "ended" });
    // 한국 날짜가 같아도 UTC로는 다음 날인 시각(12-03 20:00 UTC = 12-04 05:00 KST)은 끝난 뒤다.
    expect(liveLogMode(Date.parse("2026-12-03T14:59:59Z"))).toBe("label");
    expect(liveLogMode(Date.parse("2026-12-03T15:00:00Z"))).toBeNull();
  });

  it("끝 날짜 환경 변수가 아예 없으면 끝 날짜 없음으로 본다", () => {
    vi.stubEnv("LIVE_LOG", "all");
    const farFuture = Date.parse("2099-01-01T00:00:00Z");
    vi.stubEnv("LIVE_LOG_UNTIL", undefined);
    expect(liveLogMode(farFuture)).toBe("all");
  });

  it("끝 날짜가 빈 값이거나 모양이 틀리거나 없는 날짜면 꺼짐으로 본다(오타로 약속한 날짜 뒤에도 저장되는 일을 막는다)", () => {
    vi.stubEnv("LIVE_LOG", "all");
    const today = Date.parse("2026-11-25T00:00:00Z");
    for (const value of ["", "   ", "12/03", "2026-12-3", "2026.12.03", "2026-13-01", "2026-02-30", "tomorrow", "2026-12-03T00:00"]) {
      vi.stubEnv("LIVE_LOG_UNTIL", value);
      expect(liveLogStatus(today)).toEqual({ mode: null, reason: "off" });
    }
  });

  it("스위치가 꺼져 있으면 끝 날짜와 상관없이 off다", () => {
    vi.stubEnv("LIVE_LOG", "off");
    vi.stubEnv("LIVE_LOG_UNTIL", "2020-01-01");
    expect(liveLogStatus()).toEqual({ mode: null, reason: "off" });
  });
});

describe("cleanLiveLogEntries (줄 정리)", () => {
  it("좋은 줄은 열 11개를 모두 채운다(created_at, delete_after는 넣지 않는다)", () => {
    const [row] = clean([entry()]);
    expect(Object.keys(row).sort()).toEqual(
      ["at_ms", "body", "cid", "device_id", "engine", "env", "kind", "label", "phase", "seq", "tag"].sort(),
    );
    expect(row).toEqual({
      cid: CID,
      seq: 0,
      device_id: DEVICE,
      kind: "user",
      tag: "heard",
      body: "소니 헤드셋 찾아 주세요",
      phase: "listening",
      engine: "realtime",
      at_ms: 1200,
      label: "P01",
      env: "local",
    });
  });

  it("모든 줄이 같은 열 11개를 갖는다(빠진 값은 기본값으로 채운다)", () => {
    const rows = clean([
      entry(),
      { cid: CID, seq: 1, kind: "event", tag: "START" },
      { cid: CID, seq: 2, kind: "app", body: "안녕하세요" },
    ]);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(Object.keys(rows[0]).sort());
    expect(rows[1]).toMatchObject({ body: "", phase: "", engine: "", at_ms: 0, tag: "START" });
    expect(rows[2]).toMatchObject({ tag: "", phase: "", engine: "", at_ms: 0 });
  });

  it("entries가 배열이 아니면 빈 목록이다", () => {
    expect(clean(undefined)).toEqual([]);
    expect(clean("x")).toEqual([]);
    expect(clean({ 0: entry() })).toEqual([]);
  });

  it("틀린 줄만 버리고 나머지는 살린다(나쁜 줄 1 + 좋은 줄 2)", () => {
    const rows = clean([entry({ seq: 0 }), entry({ seq: 1, kind: "robot" }), entry({ seq: 2 }), null, 5, [], "x"]);
    expect(rows.map((row) => row.seq)).toEqual([0, 2]);
  });

  it("cid는 UUID 모양이어야 하고 소문자로 저장한다", () => {
    expect(clean([entry({ cid: "not-a-uuid" })])).toEqual([]);
    expect(clean([entry({ cid: 5 })])).toEqual([]);
    expect(clean([entry({ cid: CID.toUpperCase() })])[0].cid).toBe(CID);
  });

  it("seq는 0~999 정수만 받는다", () => {
    for (const seq of [-1, 1000, 1.5, "1", null, Number.NaN]) {
      expect(clean([entry({ seq })])).toEqual([]);
    }
    expect(clean([entry({ seq: 0 })])).toHaveLength(1);
    expect(clean([entry({ seq: 999 })])).toHaveLength(1);
  });

  it("kind는 user·ai·app·event만 받는다", () => {
    for (const kind of ["User", "system", "", 3, null]) expect(clean([entry({ kind })])).toEqual([]);
    for (const kind of ["user", "ai", "app"]) expect(clean([entry({ kind })])).toHaveLength(1);
  });

  it("tag: 모양이 틀리면 event는 줄을 버리고 나머지는 ''로 둔다", () => {
    expect(clean([entry({ kind: "event", tag: "", body: "" })])).toEqual([]);
    expect(clean([entry({ kind: "event", tag: "시작", body: "" })])).toEqual([]);
    expect(clean([entry({ kind: "event", tag: "a".repeat(41), body: "" })])).toEqual([]);
    expect(clean([entry({ kind: "event", tag: "a".repeat(40), body: "" })])).toHaveLength(1);
    expect(clean([entry({ kind: "user", tag: "한 글" })])[0].tag).toBe("");
    expect(clean([entry({ kind: "ai", tag: "READY:realtime" })])[0].tag).toBe("READY:realtime");
    expect(clean([entry({ kind: "user", tag: 7 })])[0].tag).toBe("");
  });

  it("phase는 소문자 16자 이하만, engine은 realtime·fallback만 받는다", () => {
    const [bad] = clean([entry({ phase: "Listening", engine: "gpt" })]);
    expect(bad.phase).toBe("");
    expect(bad.engine).toBe("");
    expect(clean([entry({ phase: "a".repeat(16) })])[0].phase).toBe("a".repeat(16));
    expect(clean([entry({ phase: "a".repeat(17) })])[0].phase).toBe("");
    expect(clean([entry({ engine: "fallback" })])[0].engine).toBe("fallback");
  });

  it("atMs는 정수가 아니면 0, 범위 밖이면 0~86,400,000으로 자른다", () => {
    expect(clean([entry({ atMs: 1.5 })])[0].at_ms).toBe(0);
    expect(clean([entry({ atMs: "9" })])[0].at_ms).toBe(0);
    expect(clean([entry({ atMs: -5 })])[0].at_ms).toBe(0);
    expect(clean([entry({ atMs: 86_400_001 })])[0].at_ms).toBe(86_400_000);
    expect(clean([entry({ atMs: 86_400_000 })])[0].at_ms).toBe(86_400_000);
  });

  it("body: NFKC, 제어 문자(NUL 포함)는 공백, 공백은 한 칸으로 줄이고 trim한다", () => {
    expect(clean([entry({ body: "  ＡＢＣ\u0000가\n\n나\t다   " })])[0].body).toBe("ABC 가 나 다");
  });

  it("body: 전화번호 모양은 가린다(전각 숫자도)", () => {
    expect(clean([entry({ body: "연락은 010-1234-5678로" })])[0].body).toBe("연락은 (전화번호 가림)로");
    expect(clean([entry({ body: "０１０ １２３４ ５６７８" })])[0].body).toBe("(전화번호 가림)");
  });

  it("body: 1,000자는 그대로, 1,001자(한글)는 1,000자로 자른다", () => {
    expect(Array.from(clean([entry({ body: "가".repeat(1000) })])[0].body)).toHaveLength(1000);
    const cut = clean([entry({ body: "가".repeat(1001) })])[0].body;
    expect(Array.from(cut)).toHaveLength(1000);
    expect(cut).toBe("가".repeat(1000));
  });

  it("body: 짝 없는 대리 쌍은 U+FFFD로 바꿔 살린다(그대로 두면 DB가 묶음 전체를 거부한다)", () => {
    const out = clean([entry({ seq: 0, body: "가\ud800나" }), entry({ seq: 1, body: "답\udc00" }), entry({ seq: 2, body: "웃음😀" })]);
    expect(out.map((row) => row.body)).toEqual(["가\ufffd나", "답\ufffd", "웃음😀"]);
    expect(() => encodeURIComponent(out.map((row) => row.body).join(""))).not.toThrow();
  });

  it("body: 이모지를 코드 포인트 기준으로 자르고 반쪽을 남기지 않는다", () => {
    const body = clean([entry({ body: "😀".repeat(1001) })])[0].body;
    expect(Array.from(body)).toHaveLength(1000);
    expect(body).toBe("😀".repeat(1000));
    // JSON으로 되돌려도 깨지지 않는다(짝 없는 서로게이트가 없다).
    expect(JSON.parse(JSON.stringify(body))).toBe(body);
    expect(body.isWellFormed()).toBe(true);
  });

  it("event의 body는 언제나 ''이고 tag가 있으면 살린다", () => {
    const [row] = clean([entry({ kind: "event", tag: "FAILED:network", body: "새면 안 되는 글" })]);
    expect(row.body).toBe("");
    expect(row.tag).toBe("FAILED:network");
  });

  it("user·ai·app인데 정리 뒤 body가 비면(문자열 아님, 공백만, 제어 문자만) 버린다", () => {
    for (const body of [undefined, 5, "", "   ", "\u0000\u0007\n"]) {
      for (const kind of ["user", "ai", "app"]) expect(clean([entry({ kind, body })])).toEqual([]);
    }
  });

  it("같은 요청 안에서 (cid, seq)가 겹치면 처음 것만 둔다(대소문자 다른 cid도 같은 것)", () => {
    const rows = clean([entry({ body: "첫째" }), entry({ body: "둘째" }), entry({ cid: CID.toUpperCase(), body: "셋째" }), entry({ seq: 1, body: "다른 순번" })]);
    expect(rows.map((row) => row.body)).toEqual(["첫째", "다른 순번"]);
  });

  it("앞에서 40개까지만 본다", () => {
    const entries = Array.from({ length: 60 }, (_, index) => entry({ seq: index }));
    const rows = clean(entries);
    expect(rows).toHaveLength(40);
    expect(rows[39].seq).toBe(39);
  });

  it("env는 VERCEL_ENV가 소문자 12자 이하일 때만 쓰고 아니면 local이다", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(liveLogEnv()).toBe("preview");
    expect(clean([entry()])[0].env).toBe("preview");
    for (const value of ["", "Production", "a".repeat(13), "prod1", "pre view"]) {
      vi.stubEnv("VERCEL_ENV", value);
      expect(liveLogEnv()).toBe("local");
    }
    vi.stubEnv("VERCEL_ENV", "a".repeat(12));
    expect(liveLogEnv()).toBe("a".repeat(12));
  });
});

// ---------- 저장 ----------

interface UpsertCall {
  rows: LiveEventRow[];
  options: Record<string, unknown>;
}

function fakeClient(options: {
  upsert?: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  count?: () => PromiseLike<{ count: number | null; error: { code?: string } | null }>;
} = {}) {
  const upserts: UpsertCall[] = [];
  const counts: string[] = [];
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      return {
        upsert(rows: LiveEventRow[], opts: Record<string, unknown>) {
          upserts.push({ rows, options: opts });
          return options.upsert ? options.upsert() : Promise.resolve({ data: null, error: null });
        },
        select(columns: string, opts: Record<string, unknown>) {
          counts.push(`${columns}:${JSON.stringify(opts)}`);
          return options.count ? options.count() : Promise.resolve({ count: 10, error: null });
        },
      };
    },
  };
  vi.spyOn(requestStore, "getSupabaseRpcClient").mockReturnValue(client as unknown as requestStore.RpcClient);
  return { upserts, counts, tables };
}

function noClient() {
  vi.spyOn(requestStore, "getSupabaseRpcClient").mockReturnValue(null);
}

const rows = (count = 2, start = 0, cid = CID): LiveEventRow[] =>
  clean(Array.from({ length: count }, (_, index) => entry({ cid, seq: start + index, body: `글 ${start + index}` })));

describe("saveLiveEvents (DB)", () => {
  it("upsert를 (cid,seq) 충돌 무시, defaultToNull false로 부르고 모든 줄에 열 11개를 넘긴다", async () => {
    const fake = fakeClient();
    const result = await saveLiveEvents(rows(3));
    expect(result).toBe("saved");
    expect(fake.tables).toContain("live_events");
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].options).toEqual({ onConflict: "cid,seq", ignoreDuplicates: true, defaultToNull: false });
    expect(fake.upserts[0].rows).toHaveLength(3);
    for (const row of fake.upserts[0].rows) {
      expect(Object.keys(row)).toHaveLength(11);
      expect(row).not.toHaveProperty("created_at");
      expect(row).not.toHaveProperty("delete_after");
    }
  });

  it("빈 목록은 DB를 부르지 않고 saved다", async () => {
    const fake = fakeClient();
    expect(await saveLiveEvents([])).toBe("saved");
    expect(fake.upserts).toHaveLength(0);
  });

  it("표가 없다는 오류(42P01, PGRST205 등)면 unavailable이고 60초 동안 DB를 다시 부르지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-30T03:00:00Z"));
    const fake = fakeClient({ upsert: () => Promise.resolve({ data: null, error: { code: "42P01", message: "x" } }) });
    expect(await saveLiveEvents(rows())).toBe("unavailable");
    expect(fake.upserts).toHaveLength(1);
    vi.setSystemTime(Date.now() + UNAVAILABLE_COOLDOWN_MS - 1_000);
    expect(await saveLiveEvents(rows())).toBe("unavailable");
    expect(fake.upserts).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2_000);
    expect(await saveLiveEvents(rows())).toBe("unavailable");
    expect(fake.upserts).toHaveLength(2);
  });

  it.each(["PGRST202", "PGRST205", "42883", "42703", "PGRST204"])("표·열 없음 코드 %s도 unavailable", async (code) => {
    fakeClient({ upsert: () => Promise.resolve({ data: null, error: { code } }) });
    expect(await saveLiveEvents(rows())).toBe("unavailable");
  });

  it("묶음이 영구 오류로 거부되면 줄마다 따로 넣어 좋은 줄을 살리고 saved로 답한다", async () => {
    let calls = 0;
    const fake = fakeClient({
      upsert: () => {
        calls += 1;
        // 1번째 = 묶음 전체(거부), 3번째 = 둘째 줄(거부), 나머지 = 저장
        const bad = calls === 1 || calls === 3;
        return Promise.resolve({ data: null, error: bad ? { code: "23514", message: "check" } : null });
      },
    });
    const out = { stored: 0 };
    expect(await saveLiveEvents(rows(3), out)).toBe("saved");
    expect(out.stored).toBe(2); // 실제로 들어간 줄 수
    expect(fake.upserts.map((call) => call.rows.map((row) => row.seq))).toEqual([[0, 1, 2], [0], [1], [2]]);
  });

  it("줄마다 따로 넣다가 시간 한도를 넘기면 retry다(남은 줄을 버리지 않고 화면이 다시 보내게 한다)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T03:00:00Z"));
    let calls = 0;
    const fake = fakeClient({
      upsert: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ data: null, error: { code: "23514", message: "check" } });
        vi.setSystemTime(Date.now() + 3000); // 줄 하나에 3초씩 걸린 셈
        return Promise.resolve({ data: null, error: null });
      },
    });
    const out = { stored: 0 };
    expect(await saveLiveEvents(rows(5), out)).toBe("retry");
    expect(out.stored).toBe(0);
    expect(fake.upserts.length).toBeLessThan(6); // 묶음 1번 + 줄 5번을 다 하지 못했다
    vi.useRealTimers();
  });

  it.each(["23514", "23502", "22001", "22P02"])("영구 오류 %s는(줄마다 따로 넣어도 모두 거부되면) failed다", async (code) => {
    fakeClient({ upsert: () => Promise.resolve({ data: null, error: { code, message: "check" } }) });
    expect(await saveLiveEvents(rows())).toBe("failed");
  });

  it("그 밖의 오류(코드 없음, 08006, 57014, 42501)는 retry다", async () => {
    for (const error of [{}, { code: "08006" }, { code: "57014" }, { code: "42501" }]) {
      fakeClient({ upsert: () => Promise.resolve({ data: null, error }) });
      expect(await saveLiveEvents(rows())).toBe("retry");
    }
  });

  it("던지는 클라이언트(네트워크 오류)도 retry다", async () => {
    fakeClient({ upsert: () => Promise.reject(new Error("fetch failed")) });
    expect(await saveLiveEvents(rows())).toBe("retry");
  });

  it("3초 안에 끝나지 않으면 retry다", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-30T03:00:00Z"));
    fakeClient({ upsert: () => new Promise(() => undefined) });
    const pending = saveLiveEvents(rows());
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS + 10);
    expect(await pending).toBe("retry");
  });

  it("줄 수 어림이 표 상한(TABLE_ROW_CAP)을 넘으면 capped이고 upsert를 부르지 않는다", async () => {
    const fake = fakeClient({ count: () => Promise.resolve({ count: TABLE_ROW_CAP + 1, error: null }) });
    expect(await saveLiveEvents(rows())).toBe("capped");
    expect(fake.upserts).toHaveLength(0);
    expect(fake.counts[0]).toBe('*:{"count":"estimated","head":true}');
  });

  it("줄 수 어림이 표 상한(TABLE_ROW_CAP) 이하이면 저장하고, 60초 동안은 다시 세지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-30T03:00:00Z"));
    const fake = fakeClient({ count: () => Promise.resolve({ count: TABLE_ROW_CAP, error: null }) });
    expect(await saveLiveEvents(rows(1, 0))).toBe("saved");
    expect(await saveLiveEvents(rows(1, 1))).toBe("saved");
    expect(fake.counts).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await saveLiveEvents(rows(1, 2))).toBe("saved");
    expect(fake.counts).toHaveLength(2);
  });

  it("세는 조회가 실패하거나 던지거나 값이 없으면 막지 않는다", async () => {
    for (const count of [
      () => Promise.resolve({ count: null, error: { code: "57014" } }),
      () => Promise.reject(new Error("boom")),
      () => Promise.resolve({ count: null, error: null }),
    ]) {
      resetLiveLogForTest();
      const fake = fakeClient({ count });
      expect(await saveLiveEvents(rows())).toBe("saved");
      expect(fake.upserts).toHaveLength(1);
    }
  });

  it("인스턴스 하루 상한(20,000줄)을 넘기면 capped이고 다음 날(한국)에는 다시 센다", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-30T03:00:00Z"));
    const fake = fakeClient();
    for (let batch = 0; batch < DAILY_ROW_CAP / 40; batch += 1) {
      const full = Array.from({ length: 40 }, (_, index) => entry({ cid: CID, seq: index, body: "글" }));
      expect(await saveLiveEvents(clean(full))).toBe("saved");
    }
    expect(fake.upserts).toHaveLength(DAILY_ROW_CAP / 40);
    expect(await saveLiveEvents(rows(1))).toBe("capped");
    expect(fake.upserts).toHaveLength(DAILY_ROW_CAP / 40);
    // 한국 시간 다음 날 00:00 이후(UTC 15:00)
    vi.setSystemTime(new Date("2026-11-30T15:00:01Z"));
    expect(await saveLiveEvents(rows(1))).toBe("saved");
  });

  it("실패한 저장은 하루 세기에 넣지 않는다", async () => {
    fakeClient({ upsert: () => Promise.resolve({ data: null, error: { code: "08006" } }) });
    for (let index = 0; index < 600; index += 1) await saveLiveEvents(rows(40));
    fakeClient();
    expect(await saveLiveEvents(rows(1))).toBe("saved");
  });
});

describe("saveLiveEvents (연결 없음)", () => {
  it("운영(VERCEL_ENV=production)에서 클라이언트가 없으면 unavailable이고 메모리에도 쌓지 않는다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    noClient();
    expect(await saveLiveEvents(rows())).toBe("unavailable");
    expect(memoryLiveEventsForTest()).toEqual([]);
  });

  it("미리보기 배포(VERCEL_ENV=preview, VERCEL=1)에서도 클라이언트가 없으면 unavailable이고 메모리에 쌓지 않는다", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    noClient();
    expect(await saveLiveEvents(rows())).toBe("unavailable");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "1");
    expect(await saveLiveEvents(rows())).toBe("unavailable");
    vi.stubEnv("VERCEL", "");
    expect(memoryLiveEventsForTest()).toEqual([]);
  });

  it("로컬·시험에서는 메모리에 두고 saved로 답한다", async () => {
    noClient();
    expect(await saveLiveEvents(rows(3))).toBe("saved");
    expect(memoryLiveEventsForTest().map((row) => row.seq)).toEqual([0, 1, 2]);
  });

  it("같은 (cid, seq)를 다시 넣어도 한 줄이고 처음 값이 남는다", async () => {
    noClient();
    await saveLiveEvents(clean([entry({ body: "처음" })]));
    expect(await saveLiveEvents(clean([entry({ body: "나중" })]))).toBe("saved");
    const kept = memoryLiveEventsForTest();
    expect(kept).toHaveLength(1);
    expect(kept[0].body).toBe("처음");
  });

  it("2,000줄까지만 두고 넘으면 오래된 줄부터 버린다", async () => {
    noClient();
    for (let index = 0; index < MEMORY_MAX_ROWS + 5; index += 1) {
      const cid = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      await saveLiveEvents(rows(1, 0, cid));
    }
    const kept = memoryLiveEventsForTest();
    expect(kept).toHaveLength(MEMORY_MAX_ROWS);
    expect(kept[0].cid).toBe("00000000-0000-4000-8000-000000000005");
  });

  it("getSupabaseRpcClient가 던져도 던지지 않고 retry다", async () => {
    vi.spyOn(requestStore, "getSupabaseRpcClient").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await saveLiveEvents(rows())).toBe("retry");
  });

  it("접수 저장소가 메모리여도 연결이 있으면 DB로 간다(storeKind를 보지 않는다)", async () => {
    const fake = fakeClient();
    const storeKind = vi.spyOn(requestStore.getRequestStore(), "storeKind");
    expect(await saveLiveEvents(rows())).toBe("saved");
    expect(fake.upserts).toHaveLength(1);
    expect(storeKind).not.toHaveBeenCalled();
  });
});
