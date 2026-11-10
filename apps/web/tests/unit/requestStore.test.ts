import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryStore,
  createSupabaseStore,
  getRequestStore,
  kstDate,
  normalizeCondition,
  resetRequestStoresForTest,
  StoreUnavailableError,
  type DbError,
  type RegisterInput,
  type RpcClient,
} from "@/lib/requestStore";

const HOUR = 60 * 60 * 1000;
// 2026-11-10 09:00 KST
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
    ...overrides,
  };
}

describe("kstDate·normalizeCondition", () => {
  it("서울 날짜는 UTC 15시에 바뀐다", () => {
    expect(kstDate(Date.parse("2026-11-10T14:59:59Z"))).toBe("2026-11-10");
    expect(kstDate(Date.parse("2026-11-10T15:00:00Z"))).toBe("2026-11-11");
  });

  it("새·신품 → new, 중고 → used, 상관·아무 → any, 그 외 null", () => {
    expect(normalizeCondition("새 제품")).toBe("new");
    expect(normalizeCondition("신품이요")).toBe("new");
    expect(normalizeCondition("중고")).toBe("used");
    expect(normalizeCondition("상관없어요")).toBe("any");
    expect(normalizeCondition("아무거나")).toBe("any");
    expect(normalizeCondition("잘 모르겠어요")).toBeNull();
  });
});

describe("메모리 저장소", () => {
  it("번호는 1부터 늘고, 같은 id는 같은 번호(existing)다", async () => {
    let now = T0;
    const store = createMemoryStore({ now: () => now });
    const first = await store.register(input("a"));
    expect(first).toMatchObject({ outcome: "created", queueNumber: 1, status: "waiting" });
    now += 1000;
    const second = await store.register(input("b"));
    expect(second).toMatchObject({ outcome: "created", queueNumber: 2 });
    const again = await store.register(input("a"));
    expect(again).toEqual({ ...first, outcome: "existing" });
    expect(store.storeKind()).toBe("memory");
    expect(store.persistent).toBe(false);
  });

  it("get은 번호·상태·제품을 돌려주고, 없는 id는 null", async () => {
    const store = createMemoryStore({ now: () => T0 });
    const { requestId } = await store.register(input("a"));
    expect(await store.get(requestId)).toEqual({
      requestId,
      queueNumber: 1,
      status: "waiting",
      product: "소니 헤드셋",
    });
    expect(await store.get("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("서울 날짜가 바뀌면 1번부터 다시 센다", async () => {
    let now = Date.parse("2026-11-10T14:00:00Z");
    const store = createMemoryStore({ now: () => now });
    await store.register(input("a"));
    await store.register(input("b"));
    now = Date.parse("2026-11-10T15:30:00Z");
    expect((await store.register(input("c"))).queueNumber).toBe(1);
  });

  it("waiting 24시간 → expired, 생성 48시간 뒤 삭제", async () => {
    let now = T0;
    const store = createMemoryStore({ now: () => now });
    const { requestId } = await store.register(input("a"));
    now = T0 + 24 * HOUR;
    expect((await store.get(requestId))?.status).toBe("expired");
    now = T0 + 48 * HOUR;
    expect(await store.get(requestId)).toBeNull();
    // 지워진 뒤 같은 id로 다시 내면 새로 접수한다.
    expect((await store.register(input("a"))).outcome).toBe("created");
  });
});

interface FakeCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeClient(responses: {
  rpc?: { data: unknown; error: DbError | null } | Error;
  select?: { data: unknown; error: DbError | null } | Error;
}) {
  const calls: FakeCall[] = [];
  const selects: { table: string; columns: string; column: string; value: string }[] = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      const response = responses.rpc;
      return response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response ?? { data: null, error: null });
    },
    from(table) {
      return {
        select(columns) {
          return {
            eq(column, value) {
              return {
                maybeSingle() {
                  selects.push({ table, columns, column, value });
                  const response = responses.select;
                  return response instanceof Error
                    ? Promise.reject(response)
                    : Promise.resolve(response ?? { data: null, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls, selects };
}

const ROW = {
  out_outcome: "created",
  out_request_id: "11111111-1111-4111-8111-111111111111",
  out_queue_number: 4,
  out_status: "waiting",
};

describe("Supabase 저장소(가짜 RPC 클라이언트)", () => {
  it("register_request를 p_ 인자로 부르고 배열 첫 행을 돌려준다", async () => {
    const { client, calls } = fakeClient({ rpc: { data: [ROW], error: null } });
    const store = createSupabaseStore(client);
    const result = await store.register(input("22222222-2222-4222-8222-222222222222"));
    expect(calls).toEqual([
      {
        fn: "register_request",
        args: {
          p_client_request_id: "22222222-2222-4222-8222-222222222222",
          p_product: "소니 헤드셋",
          p_budget: "10만 원",
          p_condition: "새 제품",
          p_brand: "Sony",
          p_item: "헤드셋",
          p_condition_kind: "new",
        },
      },
    ]);
    expect(result).toEqual({
      outcome: "created",
      requestId: ROW.out_request_id,
      queueNumber: 4,
      status: "waiting",
    });
    expect(store.storeKind()).toBe("supabase");
    expect(store.persistent).toBe(true);
  });

  it("existing도 그대로 돌려준다", async () => {
    const { client } = fakeClient({
      rpc: { data: [{ ...ROW, out_outcome: "existing" }], error: null },
    });
    expect((await createSupabaseStore(client).register(input("a"))).outcome).toBe("existing");
  });

  it("0행·모양 이상은 저장소 오류다", async () => {
    for (const data of [[], null, [{ ...ROW, out_queue_number: "4" }]]) {
      const { client } = fakeClient({ rpc: { data, error: null } });
      await expect(createSupabaseStore(client).register(input("a"))).rejects.toBeInstanceOf(
        StoreUnavailableError,
      );
    }
  });

  for (const code of ["42883", "PGRST202", "42P01", "PGRST205"]) {
    it(`함수·표 없음(${code})이면 메모리로 떨어지고 storeKind는 memory다`, async () => {
      const { client, calls } = fakeClient({
        rpc: { data: null, error: { code, message: "missing" } },
      });
      const store = createSupabaseStore(client, createMemoryStore({ now: () => T0 }));
      const first = await store.register(input("a"));
      expect(first).toMatchObject({ outcome: "created", queueNumber: 1 });
      expect(store.storeKind()).toBe("memory");
      expect(store.persistent).toBe(false);
      // 떨어진 뒤에는 Supabase를 다시 부르지 않는다.
      expect((await store.register(input("a"))).outcome).toBe("existing");
      expect(calls).toHaveLength(1);
      expect(await store.get(first.requestId)).toMatchObject({ queueNumber: 1 });
    });
  }

  it("다른 오류(권한·네트워크)는 전환하지 않고 저장소 오류다", async () => {
    for (const rpc of [
      { data: null, error: { code: "42501", message: "permission denied" } },
      { data: null, error: { code: "", message: "fetch failed" } },
      new Error("network"),
    ]) {
      const { client } = fakeClient({ rpc });
      const store = createSupabaseStore(client);
      await expect(store.register(input("a"))).rejects.toBeInstanceOf(StoreUnavailableError);
      expect(store.storeKind()).toBe("supabase");
    }
  });

  it("get은 requests에서 id로 한 행을 읽는다", async () => {
    const createdAt = new Date().toISOString();
    const { client, selects } = fakeClient({
      select: {
        data: { id: "r-1", queue_number: 2, status: "waiting", product: "헤드셋", created_at: createdAt },
        error: null,
      },
    });
    const store = createSupabaseStore(client);
    expect(await store.get("r-1")).toEqual({
      requestId: "r-1",
      queueNumber: 2,
      status: "waiting",
      product: "헤드셋",
    });
    expect(selects).toEqual([
      { table: "requests", columns: "id, queue_number, status, product, created_at", column: "id", value: "r-1" },
    ]);
  });

  it("get: 없으면 null, 24시간 지난 waiting은 expired, 오류는 저장소 오류", async () => {
    expect(await createSupabaseStore(fakeClient({}).client).get("r-1")).toBeNull();
    const old = new Date(Date.now() - 25 * HOUR).toISOString();
    const { client } = fakeClient({
      select: {
        data: { id: "r-1", queue_number: 2, status: "waiting", product: "헤드셋", created_at: old },
        error: null,
      },
    });
    expect((await createSupabaseStore(client).get("r-1"))?.status).toBe("expired");
    const broken = fakeClient({ select: { data: null, error: { code: "08006", message: "down" } } });
    await expect(createSupabaseStore(broken.client).get("r-1")).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
});

describe("getRequestStore 선택", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRequestStoresForTest();
  });

  function stubSupabase() {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "fake-secret-value");
  }

  it("변수가 없으면 메모리", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    resetRequestStoresForTest();
    expect(getRequestStore().storeKind()).toBe("memory");
  });

  it("URL과 서버 키가 있으면 Supabase, STORE_MODE=memory면 메모리", () => {
    stubSupabase();
    resetRequestStoresForTest();
    expect(getRequestStore().storeKind()).toBe("supabase");
    vi.stubEnv("STORE_MODE", "memory");
    expect(getRequestStore().storeKind()).toBe("memory");
  });

  it("운영에서는 STORE_MODE=memory를 무시한다", () => {
    stubSupabase();
    vi.stubEnv("STORE_MODE", "memory");
    vi.stubEnv("VERCEL_ENV", "production");
    resetRequestStoresForTest();
    expect(getRequestStore().storeKind()).toBe("supabase");
  });

  it("대체 이름(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)도 읽는다", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-service-value");
    resetRequestStoresForTest();
    expect(getRequestStore().storeKind()).toBe("supabase");
  });
});
