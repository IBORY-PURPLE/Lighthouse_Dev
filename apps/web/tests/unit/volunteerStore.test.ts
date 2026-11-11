import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_DONE,
  DEMO_DONE_CANDIDATES,
  DEMO_WAITING,
} from "@/lib/demoRequests";
import {
  createMemoryStore,
  createSupabaseStore,
  isMissingSchema,
  QUEUE_LIMIT,
  StoreUnavailableError,
  type DbError,
  type DbResult,
  type QueryBuilder,
  type RegisterInput,
  type RequestStore,
  type RpcClient,
} from "@/lib/requestStore";
import type { SentCandidate } from "@/lib/volunteerView";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.parse("2026-11-12T03:00:00Z"); // 서울 11월 12일 12:00

const A = "d-00000000000000aa";
const B = "d-00000000000000bb";

function input(clientRequestId: string, overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    clientRequestId,
    product: "소니 헤드셋",
    budget: "10만 원",
    condition: "새 제품",
    brand: "Sony",
    item: "헤드셋",
    conditionKind: "new",
    ...overrides,
  };
}

const CANDIDATES: SentCandidate[] = [
  { name: "후보 1", url: "https://example.com/1", guide: "가이드", summary: [{ label: "색상", value: "검정" }] },
];

function clock(start = T0) {
  const state = { now: start };
  return { state, now: () => state.now };
}

describe("메모리 저장소: 목록", () => {
  it("대기 요청은 오래 기다린 순이고, 24시간이 지난 것은 빠진다", async () => {
    const time = clock();
    const store = createMemoryStore({ now: time.now });
    const old = await store.register(input("old", { product: "가장 오래된" }));
    time.state.now += 2 * HOUR;
    await store.register(input("mid", { product: "가운데" }));
    time.state.now += HOUR;
    await store.register(input("new", { product: "최근" }));

    const { waiting } = await store.listQueue(A);
    expect(waiting.map((item) => item.product)).toEqual(["가장 오래된", "가운데", "최근"]);
    expect(waiting[0]).toMatchObject({ requestId: old.requestId, budget: "10만 원", item: "헤드셋" });

    time.state.now += 22 * HOUR + 30 * MINUTE; // 오래된 것은 24시간 30분이 됨
    const later = await store.listQueue(A);
    expect(later.waiting.map((item) => item.product)).toEqual(["가운데", "최근"]);
  });

  it(`최대 ${QUEUE_LIMIT}개까지만 준다`, async () => {
    const time = clock();
    const store = createMemoryStore({ now: time.now });
    for (let index = 0; index < QUEUE_LIMIT + 5; index += 1) {
      time.state.now += MINUTE;
      await store.register(input(`c-${index}`, { product: `요청 ${index}` }));
    }
    const { waiting } = await store.listQueue(A);
    expect(waiting).toHaveLength(QUEUE_LIMIT);
    expect(waiting[0].product).toBe("요청 0");
  });

  it("맡은 요청은 대기에서 빠지고 mine에 나온다. 다른 봉사자에게는 보이지 않는다", async () => {
    const store = createMemoryStore({ now: clock().now });
    const first = await store.register(input("a", { product: "하나" }));
    await store.register(input("b", { product: "둘" }));
    expect(await store.claim(first.requestId, A)).toBe("claimed");

    const mine = await store.listQueue(A);
    expect(mine.waiting.map((item) => item.product)).toEqual(["둘"]);
    expect(mine.mine).toMatchObject({ requestId: first.requestId, status: "in_progress", product: "하나" });

    const other = await store.listQueue(B);
    expect(other.waiting.map((item) => item.product)).toEqual(["둘"]);
    expect(other.mine).toBeNull();
  });
});

describe("메모리 저장소: claim·release·complete", () => {
  async function setup() {
    const time = clock();
    const store = createMemoryStore({ now: time.now });
    const one = await store.register(input("one"));
    const two = await store.register(input("two"));
    return { store, time, one: one.requestId, two: two.requestId };
  }

  it("claim의 다섯 결과: claimed, already_mine, taken, busy, not_found", async () => {
    const { store, one, two } = await setup();
    expect(await store.claim(one, A)).toBe("claimed");
    expect(await store.claim(one, A)).toBe("already_mine");
    expect(await store.claim(one, B)).toBe("taken");
    expect(await store.claim(two, A)).toBe("busy");
    expect(await store.claim("00000000-0000-4000-8000-000000000000", B)).toBe("not_found");
  });

  it("먼저 누른 1명만 맡는다", async () => {
    const { store, one } = await setup();
    const results = await Promise.all([store.claim(one, A), store.claim(one, B)]);
    expect(results.sort()).toEqual(["claimed", "taken"]);
  });

  it("release: 내 것만 대기로 돌리고 release_count를 올린다", async () => {
    const { store, one } = await setup();
    expect(await store.release(one, A)).toBe("not_yours"); // 아직 아무도 안 맡음
    await store.claim(one, A);
    expect(await store.release(one, B)).toBe("not_yours");
    expect(await store.release(one, A)).toBe("released");
    expect(await store.release("00000000-0000-4000-8000-000000000000", A)).toBe("not_found");
    const { waiting, mine } = await store.listQueue(A);
    expect(mine).toBeNull();
    expect(waiting.map((item) => item.requestId)).toContain(one);
    // 다른 봉사자가 이어서 맡을 수 있다.
    expect(await store.claim(one, B)).toBe("claimed");
  });

  it("getForVolunteer: 내가 진행 중인 것만 ok, 남의 것은 not_yours, 없는 것은 not_found", async () => {
    const { store, one, two } = await setup();
    await store.claim(one, A);
    const ok = await store.getForVolunteer(one, A);
    expect(ok).toMatchObject({ kind: "ok", result: null });
    expect(ok.kind === "ok" && ok.request.status).toBe("in_progress");
    expect(await store.getForVolunteer(one, B)).toEqual({ kind: "not_yours" });
    expect(await store.getForVolunteer(two, A)).toEqual({ kind: "not_yours" }); // 대기 중
    expect(await store.getForVolunteer("00000000-0000-4000-8000-000000000000", A)).toEqual({
      kind: "not_found",
    });
  });

  it("complete: completed → existing, 남의 것은 not_yours, 없는 것은 not_found", async () => {
    const { store, one, two } = await setup();
    await store.claim(one, A);
    expect(await store.complete(one, B, CANDIDATES)).toEqual({ outcome: "not_yours" });
    expect(await store.complete(two, A, CANDIDATES)).toEqual({ outcome: "not_yours" });
    const done = await store.complete(one, A, CANDIDATES);
    expect(done).toMatchObject({ outcome: "completed" });
    expect(await store.complete(one, A, CANDIDATES)).toEqual({
      outcome: "existing",
      sentAt: done.outcome === "completed" ? done.sentAt : "",
    });
    expect(await store.complete("00000000-0000-4000-8000-000000000000", A, CANDIDATES)).toEqual({
      outcome: "not_found",
    });

    const detail = await store.getForVolunteer(one, A);
    expect(detail).toMatchObject({ kind: "ok", result: { candidates: CANDIDATES } });
    expect(await store.getForVolunteer(one, B)).toEqual({ kind: "not_yours" });
    const { sent, mine } = await store.listQueue(A);
    expect(mine).toBeNull();
    expect(sent).toMatchObject([{ requestId: one, candidateCount: 1, product: "소니 헤드셋" }]);
    expect((await store.listQueue(B)).sent).toEqual([]);
  });
});

describe("메모리 저장소: 시연 다시 채우기", () => {
  it("시연 행만 바꾸고 대기 5건 + 이 기기의 완료 1건을 만든다. 실제 접수 행은 그대로", async () => {
    const time = clock();
    const store = createMemoryStore({ now: time.now });
    const real = await store.register(input("real", { product: "실제 접수" }));

    expect(await store.resetDemo(A)).toBe(5);
    const first = await store.listQueue(A);
    expect(first.waiting).toHaveLength(6); // 실제 1 + 시연 5
    expect(first.waiting.filter((item) => item.isDemo)).toHaveLength(5);
    expect(first.waiting.map((item) => item.product)).toContain("실제 접수");
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toMatchObject({ product: DEMO_DONE.product, candidateCount: 2 });
    // 보낸 때는 하루 전
    expect(Date.parse(first.sent[0].sentAt)).toBe(T0 - 24 * HOUR);

    // 시연 행 하나를 맡고 다시 채우면 시연 행이 새로 5건이 되고, 실제 접수 행은 남는다.
    const demo = first.waiting.find((item) => item.isDemo)!;
    await store.claim(demo.requestId, A);
    expect(await store.resetDemo(A)).toBe(5);
    const second = await store.listQueue(A);
    expect(second.mine).toBeNull();
    expect(second.waiting.filter((item) => item.isDemo)).toHaveLength(5);
    expect(second.waiting.some((item) => item.requestId === real.requestId)).toBe(true);
    expect(second.sent).toHaveLength(1); // 기존 완료 시연 행은 지우고 하나만 다시 만든다

    // 봉사자 ID가 없으면 완료 행은 만들지 않는다.
    expect(await store.resetDemo(null)).toBe(5);
    expect((await store.listQueue(A)).sent).toEqual([]);
  });

  it("대기 시간은 72·47·21·9·2분 전이고 오래된 순이다", async () => {
    const time = clock();
    const store = createMemoryStore({ now: time.now });
    await store.resetDemo(A);
    const { waiting } = await store.listQueue(A);
    expect(waiting.map((item) => Math.round((T0 - Date.parse(item.createdAt)) / MINUTE))).toEqual([
      72, 47, 21, 9, 2,
    ]);
    expect(waiting[0].product).toBe("소니 무선 헤드셋 사고 싶어요");
    expect(waiting[0].item).toBe("헤드셋");
  });

  it("완료 요청은 7일 뒤 지워진다", async () => {
    const time = clock();
    const store = createMemoryStore({ now: time.now });
    await store.resetDemo(A);
    time.state.now += 5 * 24 * HOUR;
    expect((await store.listQueue(A)).sent).toHaveLength(1);
    time.state.now += 3 * 24 * HOUR; // 보낸 지 9일
    expect((await store.listQueue(A)).sent).toEqual([]);
  });
});

describe("마이그레이션 파일과 시연 데이터", () => {
  const sql = readFileSync(
    path.resolve(import.meta.dirname, "../../../../supabase/migrations/20261112010000_volunteer_flow.sql"),
    "utf8",
  );

  it("시연 요청 product·완료 요청 product가 SQL에 그대로 있다", () => {
    for (const demo of DEMO_WAITING) expect(sql).toContain(`'${demo.product}'`);
    expect(sql).toContain(`'${DEMO_DONE.product}'`);
  });

  it("시연 요청의 예산·조건·품목·몇 분 전도 SQL과 같다", () => {
    for (const demo of DEMO_WAITING) {
      const brand = demo.brand ? `'${demo.brand}'` : "null";
      const line =
        `'${demo.product}', '${demo.budget}', '${demo.condition}', ${brand}, '${demo.item}', ` +
        `'${demo.conditionKind}', true, now() - interval '${demo.minutesAgo} minutes'`;
      expect(sql).toContain(line);
    }
  });

  it("완료 시연 후보의 이름·링크·가이드가 SQL과 같다", () => {
    for (const candidate of DEMO_DONE_CANDIDATES) {
      expect(sql).toContain(`"name": "${candidate.name}"`);
      expect(sql).toContain(`"url": "${candidate.url}"`);
      expect(sql).toContain(`"guide": "${candidate.guide}"`);
    }
  });

  it("추가형이다: 기존 표를 지우거나 register_request를 바꾸지 않는다", () => {
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/create or replace function public\.register_request/i);
    expect(sql).toContain("requests_one_in_progress_per_volunteer");
    expect(sql).toContain("create table public.results");
  });
});

// ---------- Supabase(가짜 클라이언트) ----------

interface Call {
  kind: "rpc" | "select";
  name: string;
  args?: Record<string, unknown>;
  filters?: string[];
}

function recorder(handlers: {
  rpc?: (fn: string, args: Record<string, unknown>) => DbResult | Error;
  select?: (table: string, columns: string, filters: string[]) => DbResult | Error;
}) {
  const calls: Call[] = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push({ kind: "rpc", name: fn, args });
      const response = handlers.rpc?.(fn, args) ?? { data: null, error: null };
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    },
    from(table) {
      return {
        select(columns) {
          const filters: string[] = [];
          const respond = (): PromiseLike<DbResult> => {
            calls.push({ kind: "select", name: `${table}:${columns}`, filters: [...filters] });
            const response = handlers.select?.(table, columns, filters) ?? { data: [], error: null };
            return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
          };
          const builder: QueryBuilder = {
            eq(column, value) {
              filters.push(`eq ${column}=${value}`);
              return builder;
            },
            gt(column, value) {
              filters.push(`gt ${column}`);
              void value;
              return builder;
            },
            order(column, options) {
              filters.push(`order ${column} ${options.ascending ? "asc" : "desc"}`);
              return builder;
            },
            limit(count) {
              filters.push(`limit ${count}`);
              return builder;
            },
            maybeSingle: respond,
            // 배열을 기다릴 때(await builder)
            then: (onfulfilled, onrejected) => respond().then(onfulfilled, onrejected),
          };
          return builder;
        },
      };
    },
  } as RpcClient;
  return { client, calls };
}

const REQUEST_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "in_progress",
  product: "소니 무선 헤드셋 사고 싶어요",
  budget: "30만 원 안쪽",
  condition: "새 제품",
  brand: "소니",
  item: "헤드셋",
  condition_kind: "new",
  created_at: "2026-11-12T01:48:00Z",
  claimed_at: "2026-11-12T02:00:00Z",
  done_at: null,
  is_demo: true,
  volunteer_id: A,
};

describe("Supabase 저장소: 봉사자 메서드", () => {
  it("claim·release는 SQL 함수를 p_ 인자로 부르고 결과를 그대로 돌려준다", async () => {
    for (const outcome of ["claimed", "already_mine", "busy", "taken", "not_found"] as const) {
      const { client, calls } = recorder({ rpc: () => ({ data: outcome, error: null }) });
      const store = createSupabaseStore(client);
      expect(await store.claim(REQUEST_ROW.id, A)).toBe(outcome);
      expect(calls).toEqual([
        { kind: "rpc", name: "claim_request", args: { p_request_id: REQUEST_ROW.id, p_volunteer_id: A } },
      ]);
    }
    for (const outcome of ["released", "not_yours", "not_found"] as const) {
      const { client, calls } = recorder({ rpc: () => ({ data: outcome, error: null }) });
      expect(await createSupabaseStore(client).release(REQUEST_ROW.id, A)).toBe(outcome);
      expect(calls[0]).toMatchObject({ name: "release_request" });
    }
  });

  it("complete는 표 함수 결과(배열 첫 행)를 읽는다", async () => {
    const sentAt = "2026-11-12T03:00:00+00:00";
    const { client, calls } = recorder({
      rpc: () => ({ data: [{ out_outcome: "completed", out_sent_at: sentAt }], error: null }),
    });
    const store = createSupabaseStore(client);
    expect(await store.complete(REQUEST_ROW.id, A, CANDIDATES)).toEqual({ outcome: "completed", sentAt });
    expect(calls[0]).toEqual({
      kind: "rpc",
      name: "complete_request",
      args: { p_request_id: REQUEST_ROW.id, p_volunteer_id: A, p_candidates: CANDIDATES },
    });

    const { client: noYours } = recorder({
      rpc: () => ({ data: [{ out_outcome: "not_yours", out_sent_at: null }], error: null }),
    });
    expect(await createSupabaseStore(noYours).complete(REQUEST_ROW.id, A, CANDIDATES)).toEqual({
      outcome: "not_yours",
    });
  });

  it("resetDemo는 reset_demo_requests를 부르고 건수를 돌려준다", async () => {
    const { client, calls } = recorder({ rpc: () => ({ data: 5, error: null }) });
    expect(await createSupabaseStore(client).resetDemo(A)).toBe(5);
    expect(calls[0]).toEqual({ kind: "rpc", name: "reset_demo_requests", args: { p_volunteer_id: A } });
  });

  it("함수 결과의 모양이 이상하면 저장소 오류다", async () => {
    const { client } = recorder({ rpc: () => ({ data: "엉뚱한 값", error: null }) });
    await expect(createSupabaseStore(client).claim(REQUEST_ROW.id, A)).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });

  it("다른 오류·네트워크 실패는 메모리로 떨어지지 않고 저장소 오류다", async () => {
    const { client } = recorder({ rpc: () => ({ data: null, error: { code: "XX000", message: "boom" } }) });
    const store = createSupabaseStore(client);
    await expect(store.claim(REQUEST_ROW.id, A)).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(store.volunteerPersistent).toBe(true);
    const { client: down } = recorder({ rpc: () => new Error("network") });
    await expect(createSupabaseStore(down).release(REQUEST_ROW.id, A)).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });

  it("listQueue: 대기·내 진행·보낸 요청을 조건과 함께 읽는다", async () => {
    const { client, calls } = recorder({
      select: (table, _columns, filters) => {
        if (table === "requests" && filters.includes("eq status=waiting")) {
          return {
            data: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                product: "전기포트 1.7리터",
                budget: "4만 원 안쪽",
                condition: "상관없어요",
                item: "전기포트",
                created_at: "2026-11-12T02:51:00Z",
                is_demo: true,
              },
            ],
            error: null,
          };
        }
        if (table === "requests") return { data: REQUEST_ROW, error: null };
        return {
          data: [
            {
              request_id: "33333333-3333-4333-8333-333333333333",
              sent_at: "2026-11-11T03:00:00Z",
              candidates: [{ name: "a", url: "https://a.example", guide: "", summary: [] }, { name: "b", url: "https://b.example", guide: "", summary: [] }],
              requests: { product: "아이 실내화 210 사이즈, 흰색", budget: "3만 원 안쪽" },
            },
          ],
          error: null,
        };
      },
    });
    const store = createSupabaseStore(client);
    const data = await store.listQueue(A);

    expect(data.waiting).toEqual([
      {
        requestId: "22222222-2222-4222-8222-222222222222",
        product: "전기포트 1.7리터",
        budget: "4만 원 안쪽",
        condition: "상관없어요",
        item: "전기포트",
        createdAt: "2026-11-12T02:51:00Z",
        isDemo: true,
      },
    ]);
    expect(data.mine).toMatchObject({ requestId: REQUEST_ROW.id, status: "in_progress", conditionKind: "new", isDemo: true });
    expect(data.sent).toEqual([
      {
        requestId: "33333333-3333-4333-8333-333333333333",
        product: "아이 실내화 210 사이즈, 흰색",
        budget: "3만 원 안쪽",
        sentAt: "2026-11-11T03:00:00Z",
        candidateCount: 2,
      },
    ]);

    const filtersOf = (name: string, pick: string) =>
      calls.find((call) => call.kind === "select" && call.name.startsWith(name) && call.filters?.includes(pick))?.filters;
    expect(filtersOf("requests", "eq status=waiting")).toEqual([
      "eq status=waiting",
      "gt created_at",
      "order created_at asc",
      `limit ${QUEUE_LIMIT}`,
    ]);
    expect(filtersOf("requests", `eq volunteer_id=${A}`)).toEqual(["eq status=in_progress", `eq volunteer_id=${A}`]);
    expect(filtersOf("results", `eq volunteer_id=${A}`)).toEqual([
      `eq volunteer_id=${A}`,
      "order sent_at desc",
      `limit ${QUEUE_LIMIT}`,
    ]);
  });

  it("listQueue: 내 진행이 없으면 mine은 null, 끼워 읽은 requests가 배열이어도 받는다", async () => {
    const { client } = recorder({
      select: (table, _columns, filters) => {
        if (table === "results") {
          return {
            data: [
              {
                request_id: "33333333-3333-4333-8333-333333333333",
                sent_at: "2026-11-11T03:00:00Z",
                candidates: [{ name: "a", url: "https://a.example", guide: "", summary: [] }],
                requests: [{ product: "p", budget: "b" }],
              },
            ],
            error: null,
          };
        }
        return { data: filters.includes("eq status=waiting") ? [] : null, error: null };
      },
    });
    const data = await createSupabaseStore(client).listQueue(A);
    expect(data.waiting).toEqual([]);
    expect(data.mine).toBeNull();
    expect(data.sent).toMatchObject([{ product: "p", budget: "b", candidateCount: 1 }]);
  });

  it("listQueue: 대기 행의 모양이 이상하면 저장소 오류다", async () => {
    const { client } = recorder({ select: () => ({ data: { not: "an array" }, error: null }) });
    await expect(createSupabaseStore(client).listQueue(A)).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("getForVolunteer: 내 진행 중은 ok, 남의 것은 not_yours, 없으면 not_found", async () => {
    const make = (row: unknown) =>
      createSupabaseStore(recorder({ select: () => ({ data: row, error: null }) }).client);
    expect(await make(REQUEST_ROW).getForVolunteer(REQUEST_ROW.id, A)).toMatchObject({
      kind: "ok",
      result: null,
      request: { requestId: REQUEST_ROW.id, status: "in_progress" },
    });
    expect(await make(REQUEST_ROW).getForVolunteer(REQUEST_ROW.id, B)).toEqual({ kind: "not_yours" });
    expect(await make(null).getForVolunteer(REQUEST_ROW.id, A)).toEqual({ kind: "not_found" });
    expect(await make({ ...REQUEST_ROW, status: "waiting", volunteer_id: null }).getForVolunteer(REQUEST_ROW.id, A)).toEqual({
      kind: "not_yours",
    });
  });

  it("getForVolunteer: 내 완료 요청은 결과를 함께 준다", async () => {
    const { client } = recorder({
      select: (table) =>
        table === "requests"
          ? { data: { ...REQUEST_ROW, status: "done", done_at: "2026-11-11T03:00:00Z" }, error: null }
          : {
              data: {
                request_id: REQUEST_ROW.id,
                volunteer_id: A,
                candidates: [{ name: "후보", url: "https://a.example", guide: "가이드", summary: [{ label: "색상", value: "흰색" }] }],
                sent_at: "2026-11-11T03:00:00Z",
                heard_at: null,
                link_opened_at: null,
              },
              error: null,
            },
    });
    expect(await createSupabaseStore(client).getForVolunteer(REQUEST_ROW.id, A)).toMatchObject({
      kind: "ok",
      request: { status: "done" },
      result: {
        sentAt: "2026-11-11T03:00:00Z",
        heardAt: null,
        candidates: [{ name: "후보", guide: "가이드", summary: [{ label: "색상", value: "흰색" }] }],
      },
    });
  });
});

describe("Supabase 저장소: 마이그레이션 전(함수·표·열 없음)이면 메모리로 떨어진다", () => {
  it("isMissingSchema는 열 없음(42703, PGRST204)도 본다", () => {
    const codes = ["PGRST202", "PGRST205", "42883", "42P01", "42703", "PGRST204"];
    for (const code of codes) expect(isMissingSchema({ code })).toBe(true);
    expect(isMissingSchema({ code: "XX000" } as DbError)).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });

  const SCENARIOS: { code: string; where: "rpc" | "select"; why: string }[] = [
    { code: "PGRST202", where: "rpc", why: "함수 없음(PostgREST)" },
    { code: "42883", where: "rpc", why: "함수 없음(Postgres)" },
    { code: "PGRST205", where: "select", why: "표 없음(PostgREST)" },
    { code: "42P01", where: "select", why: "표 없음(Postgres)" },
    { code: "42703", where: "select", why: "is_demo 열 없음(Postgres)" },
    { code: "PGRST204", where: "select", why: "열 없음(PostgREST)" },
  ];

  for (const scenario of SCENARIOS) {
    it(`${scenario.why}(${scenario.code}) → 메모리로 떨어져 시연 데이터까지 돈다`, async () => {
      const error = { code: scenario.code, message: "missing" };
      const { client } = recorder({
        rpc: () => ({ data: null, error }),
        select: () => ({ data: null, error }),
      });
      const fallback = createMemoryStore({ now: clock().now });
      const store = createSupabaseStore(client, fallback);
      expect(store.volunteerPersistent).toBe(true);

      // 첫 봉사자 호출이 실패하면 같은 호출이 메모리에서 이어진다.
      const first = scenario.where === "rpc" ? await store.resetDemo(A) : (await store.listQueue(A), 5);
      expect(first).toBe(5);
      expect(store.volunteerPersistent).toBe(false);

      // 그 뒤에는 Supabase를 다시 부르지 않고 메모리에서 끝까지 돈다.
      await store.resetDemo(A);
      const { waiting, sent } = await store.listQueue(A);
      expect(waiting).toHaveLength(5);
      expect(sent).toHaveLength(1);
      const target = waiting[0].requestId;
      expect(await store.claim(target, A)).toBe("claimed");
      expect(await store.getForVolunteer(target, A)).toMatchObject({ kind: "ok" });
      expect(await store.release(target, A)).toBe("released");
    });
  }

  it("봉사자 쪽만 떨어진다: 접수(register_request)는 계속 Supabase에 남는다", async () => {
    const missing = { code: "42703", message: "missing" };
    const { client, calls } = recorder({
      rpc: (fn) =>
        fn === "register_request"
          ? {
              data: [
                {
                  out_outcome: "created",
                  out_request_id: "44444444-4444-4444-8444-444444444444",
                  out_queue_number: 7,
                  out_status: "waiting",
                },
              ],
              error: null,
            }
          : { data: null, error: missing },
      select: () => ({ data: null, error: missing }),
    });
    const store: RequestStore = createSupabaseStore(client, createMemoryStore({ now: clock().now }));
    await store.listQueue(A); // is_demo 열이 없어 메모리로 떨어짐
    expect(store.volunteerPersistent).toBe(false);
    expect(store.persistent).toBe(true);
    expect(store.storeKind()).toBe("supabase");

    const registered = await store.register(input("55555555-5555-4555-8555-555555555555"));
    expect(registered).toMatchObject({ outcome: "created", queueNumber: 7 });
    expect(calls.filter((call) => call.kind === "rpc").map((call) => call.name)).toEqual(["register_request"]);
  });

  it("접수 쪽이 먼저 떨어졌으면 봉사자 메서드도 메모리다", async () => {
    const missing = { code: "42P01", message: "missing" };
    const { client } = recorder({ rpc: () => ({ data: null, error: missing }) });
    const store = createSupabaseStore(client, createMemoryStore({ now: clock().now }));
    await store.register(input("66666666-6666-4666-8666-666666666666"));
    expect(store.persistent).toBe(false);
    expect(store.volunteerPersistent).toBe(false);
    expect(await store.resetDemo(A)).toBe(5);
  });
});
