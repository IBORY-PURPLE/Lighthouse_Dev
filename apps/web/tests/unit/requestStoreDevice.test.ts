import { describe, expect, it } from "vitest";
import {
  createMemoryStore,
  createSupabaseStore,
  DEVICE_LIST_LIMIT,
  QUEUE_LIMIT,
  StoreUnavailableError,
  type DbError,
  type DbResult,
  type QueryBuilder,
  type RegisterInput,
  type RpcClient,
} from "@/lib/requestStore";

// 기기 구분(2026-11-18): 저장소가 접수한 기기를 기억하고, 기기별 목록·소유 조회를 준다.
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-10T00:00:00Z");

function input(clientRequestId: string, overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    clientRequestId,
    product: "소니 헤드셋",
    budget: "10만 원",
    condition: "새 제품",
    brand: "Sony",
    item: "헤드셋",
    conditionKind: "new",
    deviceId: null,
    ...overrides,
  };
}

describe("기기 구분(메모리 저장소)", () => {
  it("접수한 기기만 자기 목록을 최신순으로 본다", async () => {
    let now = T0;
    const store = createMemoryStore({ now: () => now });
    await store.register(input("a1", { deviceId: "u-a", product: "A 첫째" }));
    now += 1000;
    await store.register(input("b1", { deviceId: "u-b", product: "B 하나" }));
    now += 1000;
    await store.register(input("a2", { deviceId: "u-a", product: "A 둘째" }));
    await store.register(input("n1", { deviceId: null, product: "기기 없음" }));
    expect((await store.listByDevice("u-a")).map((row) => row.product)).toEqual(["A 둘째", "A 첫째"]);
    expect((await store.listByDevice("u-b")).map((row) => row.product)).toEqual(["B 하나"]);
    expect(await store.listByDevice("u-none")).toEqual([]);
  });

  it(`목록은 ${DEVICE_LIST_LIMIT}건까지`, async () => {
    let now = T0;
    const store = createMemoryStore({ now: () => now });
    for (let i = 0; i < DEVICE_LIST_LIMIT + 3; i += 1) {
      now += 1000;
      await store.register(input(`r${i}`, { deviceId: "u-a", product: `물건 ${i}` }));
    }
    const rows = await store.listByDevice("u-a");
    expect(rows).toHaveLength(DEVICE_LIST_LIMIT);
    expect(rows[0].product).toBe(`물건 ${DEVICE_LIST_LIMIT + 2}`);
  });

  it("같은 id를 다른 기기로 다시 보내도 처음 기기를 지킨다", async () => {
    const store = createMemoryStore({ now: () => T0 });
    const first = await store.register(input("a", { deviceId: "u-first" }));
    const again = await store.register(input("a", { deviceId: "u-other" }));
    expect(again.outcome).toBe("existing");
    expect((await store.listByDevice("u-first")).map((row) => row.requestId)).toEqual([first.requestId]);
    expect(await store.listByDevice("u-other")).toEqual([]);
  });

  it("getForDevice: 기기 ID가 붙은 행은 그 기기만, 붙지 않은 행은 누구나", async () => {
    const store = createMemoryStore({ now: () => T0 });
    const owned = await store.register(input("a", { deviceId: "u-a" }));
    const open = await store.register(input("b", { deviceId: null }));
    expect(await store.getForDevice(owned.requestId, "u-a")).toMatchObject({ requestId: owned.requestId });
    expect(await store.getForDevice(owned.requestId, "u-b")).toBeNull();
    expect(await store.getForDevice(owned.requestId, null)).toBeNull();
    expect(await store.getForDevice(open.requestId, null)).toMatchObject({ requestId: open.requestId });
    expect(await store.getForDevice(open.requestId, "u-b")).toMatchObject({ requestId: open.requestId });
    expect(await store.getForDevice("00000000-0000-4000-8000-000000000000", "u-a")).toBeNull();
  });

  it("시연 요청은 시간이 지나도 대기로 남고 대기열에 실제 요청과 함께 오래된 순으로 보인다", async () => {
    let now = T0;
    const store = createMemoryStore({ now: () => now });
    await store.resetDemo(null);
    now = T0 + 60 * HOUR;
    const real = await store.register(input("real", { deviceId: "u-a", product: "진짜 요청" }));
    const queue = await store.listQueue("v-x");
    expect(queue.waiting).toHaveLength(6);
    expect(queue.waiting.filter((item) => item.isDemo)).toHaveLength(5);
    expect(queue.waiting.at(-1)?.requestId).toBe(real.requestId);
    expect(queue.waiting.slice(0, 5).every((item) => item.isDemo)).toBe(true);
    // 시연 요청은 기기 목록에 나오지 않는다.
    expect(await store.listByDevice("u-a")).toHaveLength(1);
    // 진짜 대기는 24시간이 지나면 expired다.
    now += 25 * HOUR;
    expect((await store.get(real.requestId))?.status).toBe("expired");
    const later = await store.listQueue("v-x");
    expect(later.waiting).toHaveLength(5);
    expect(later.waiting.every((item) => item.isDemo)).toBe(true);
  });

  it(`시연이 ${QUEUE_LIMIT}건을 채우지 않으면 진짜 요청이 같이 보인다`, async () => {
    const store = createMemoryStore({ now: () => T0 });
    await store.resetDemo(null);
    for (let i = 0; i < 3; i += 1) await store.register(input(`r${i}`, { deviceId: "u-a" }));
    expect((await store.listQueue("v-x")).waiting).toHaveLength(8);
  });
});

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

const ROW = {
  out_outcome: "created",
  out_request_id: "11111111-1111-4111-8111-111111111111",
  out_queue_number: 4,
  out_status: "waiting",
};

/** select 한 번에 정해진 응답을 주는 가짜 클라이언트. 걸린 조건을 log에 남긴다. */
function queryClient(response: DbResult, log: string[] = []) {
  const builder = (): QueryBuilder => {
    const self: QueryBuilder = {
      eq: (column, value) => {
        log.push(`eq ${column}=${value}`);
        return self;
      },
      gt: () => self,
      or: () => self,
      order: (column, options) => {
        log.push(`order ${column} ${options.ascending ? "asc" : "desc"}`);
        return self;
      },
      limit: (count) => {
        log.push(`limit ${count}`);
        return self;
      },
      maybeSingle: () => Promise.resolve(response),
      then: (onfulfilled, onrejected) => Promise.resolve(response).then(onfulfilled, onrejected),
    };
    return self;
  };
  const client = {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => ({
      select: (columns: string) => {
        log.push(`select ${table}:${columns}`);
        return builder();
      },
    }),
  };
  return client as unknown as RpcClient;
}

function rpcClient(respond: (args: Record<string, unknown>) => { data: unknown; error: DbError | null }) {
  const calls: Call[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args: { ...args } });
      return Promise.resolve(respond(args));
    },
  } as unknown as RpcClient;
  return { client, calls };
}

describe("기기 구분(Supabase 저장소, 가짜 클라이언트)", () => {
  it("기기 ID가 있으면 register_request에 p_device_id를 함께 보낸다", async () => {
    const { client, calls } = rpcClient(() => ({ data: [ROW], error: null }));
    await createSupabaseStore(client).register(input("a", { deviceId: "u-abc" }));
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_condition_kind: "new", p_device_id: "u-abc" });
  });

  it("기기 ID가 없으면 p_device_id를 보내지 않는다(7개 인자 그대로)", async () => {
    const { client, calls } = rpcClient(() => ({ data: [ROW], error: null }));
    await createSupabaseStore(client).register(input("a", { deviceId: null }));
    expect(Object.keys(calls[0].args)).not.toContain("p_device_id");
    expect(Object.keys(calls[0].args)).toHaveLength(7);
  });

  it("마이그레이션 전(8개 인자 함수 없음)이면 p_device_id를 빼고 다시 보내 Supabase에 접수한다", async () => {
    const { client, calls } = rpcClient((args) =>
      "p_device_id" in args
        ? { data: null, error: { code: "PGRST202", message: "no function" } }
        : { data: [ROW], error: null },
    );
    const store = createSupabaseStore(client, createMemoryStore({ now: () => T0 }));
    const result = await store.register(input("a", { deviceId: "u-abc" }));
    expect(result.requestId).toBe(ROW.out_request_id);
    expect(store.storeKind()).toBe("supabase");
    expect(store.persistent).toBe(true);
    expect(calls.map((call) => "p_device_id" in call.args)).toEqual([true, false]);
    // 다음 접수는 처음부터 빼고 보낸다.
    await store.register(input("b", { deviceId: "u-abc" }));
    expect(calls.map((call) => "p_device_id" in call.args)).toEqual([true, false, false]);
  });

  it("listByDevice: device_id로 최신순 20건을 읽는다", async () => {
    const log: string[] = [];
    const createdAt = new Date().toISOString();
    const client = queryClient(
      {
        data: [
          { id: "r-2", queue_number: 2, status: "waiting", product: "둘째", created_at: createdAt },
          { id: "r-1", queue_number: 1, status: "waiting", product: "첫째", created_at: createdAt },
        ],
        error: null,
      },
      log,
    );
    const rows = await createSupabaseStore(client).listByDevice("u-abc");
    expect(rows.map((row) => row.requestId)).toEqual(["r-2", "r-1"]);
    expect(rows[0].createdAt).toBe(createdAt);
    expect(log).toEqual([
      "select requests:id, queue_number, status, product, created_at",
      "eq device_id=u-abc",
      "order created_at desc",
      `limit ${DEVICE_LIST_LIMIT}`,
    ]);
  });

  it("listByDevice: device_id 열이 없으면(마이그레이션 전) 빈 목록, 다른 오류는 저장소 오류", async () => {
    const missing = queryClient({ data: null, error: { code: "42703", message: "no column" } });
    expect(await createSupabaseStore(missing).listByDevice("u-abc")).toEqual([]);
    const broken = queryClient({ data: null, error: { code: "08006", message: "down" } });
    await expect(createSupabaseStore(broken).listByDevice("u-abc")).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("getForDevice: 남의 행은 null, 내 행과 기기 없는 행은 그대로", async () => {
    const row = (device: string | null): DbResult => ({
      data: {
        id: "r-1",
        queue_number: 2,
        status: "waiting",
        product: "헤드셋",
        created_at: new Date().toISOString(),
        is_demo: false,
        device_id: device,
      },
      error: null,
    });
    expect(await createSupabaseStore(queryClient(row("u-a"))).getForDevice("r-1", "u-a")).toMatchObject({
      requestId: "r-1",
    });
    expect(await createSupabaseStore(queryClient(row("u-a"))).getForDevice("r-1", "u-b")).toBeNull();
    expect(await createSupabaseStore(queryClient(row("u-a"))).getForDevice("r-1", null)).toBeNull();
    expect(await createSupabaseStore(queryClient(row(null))).getForDevice("r-1", null)).toMatchObject({
      requestId: "r-1",
    });
    expect(await createSupabaseStore(queryClient({ data: null, error: null })).getForDevice("r-1", "u-a")).toBeNull();
  });

  it("getForDevice: 시연 요청은 24시간이 지나도 expired로 읽지 않고, 일반 요청은 expired로 읽는다", async () => {
    const old = new Date(Date.now() - 30 * HOUR).toISOString();
    const make = (isDemo: boolean) =>
      queryClient({
        data: { id: "r-1", queue_number: 2, status: "waiting", product: "헤드셋", created_at: old, is_demo: isDemo, device_id: null },
        error: null,
      });
    expect((await createSupabaseStore(make(true)).getForDevice("r-1", null))?.status).toBe("waiting");
    expect((await createSupabaseStore(make(false)).getForDevice("r-1", null))?.status).toBe("expired");
  });

  it("getForDevice: 열이 없으면(마이그레이션 전) 소유 확인 없이 옛 조회로 돌아간다", async () => {
    const columnsSeen: string[] = [];
    const client = {
      rpc: () => Promise.resolve({ data: null, error: null }),
      from: () => ({
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: (): Promise<DbResult> => {
              columnsSeen.push(columns);
              return Promise.resolve(
                columns.includes("device_id")
                  ? { data: null, error: { code: "42703", message: "no column" } }
                  : {
                      data: {
                        id: "r-1",
                        queue_number: 2,
                        status: "waiting",
                        product: "헤드셋",
                        created_at: new Date().toISOString(),
                      },
                      error: null,
                    },
              );
            },
          }),
        }),
      }),
    } as unknown as RpcClient;
    const store = createSupabaseStore(client);
    expect(await store.getForDevice("r-1", null)).toMatchObject({ requestId: "r-1" });
    expect(await store.getForDevice("r-1", "u-a")).toMatchObject({ requestId: "r-1" });
    expect(store.storeKind()).toBe("supabase");
    // 두 번째부터는 실패할 조회를 다시 하지 않는다.
    expect(columnsSeen.filter((columns) => columns.includes("device_id"))).toHaveLength(1);
  });
});
