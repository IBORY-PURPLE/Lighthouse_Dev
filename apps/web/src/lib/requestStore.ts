import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// 대기열 저장소(플로우 A PR 2). 인터페이스 하나에 메모리 구현과 Supabase 구현. TSD §8.3, §10.
// 이용자 답은 저장소에만 둔다. 로그에는 남기지 않는다.

export type RequestStatus = "waiting" | "in_progress" | "done" | "expired";
export type ConditionKind = "new" | "used" | "any";
export type StoreKind = "supabase" | "memory";

export interface RegisterInput {
  clientRequestId: string;
  product: string;
  budget: string;
  condition: string;
  brand: string | null;
  item: string;
  conditionKind: ConditionKind | null;
}

export interface RegisterResult {
  outcome: "created" | "existing";
  requestId: string;
  queueNumber: number;
  status: RequestStatus;
}

export interface StoredRequest {
  requestId: string;
  queueNumber: number;
  status: RequestStatus;
  product: string;
}

export interface RequestStore {
  register(input: RegisterInput): Promise<RegisterResult>;
  get(requestId: string): Promise<StoredRequest | null>;
  storeKind(): StoreKind;
  /** 서버를 다시 띄워도 남는지. 메모리면 false라 404가 "지워짐"을 뜻하지 않는다. */
  readonly persistent: boolean;
}

/** 저장소를 쓸 수 없다(네트워크, 권한, 모양 이상). 라우트는 503 store_unavailable. */
export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreUnavailableError";
  }
}

const HOUR_MS = 60 * 60 * 1000;
/** waiting이 이 시간을 넘으면 expired. */
export const WAITING_TTL_MS = 24 * HOUR_MS;
/** expired는 생성 뒤 이 시간에 지운다(TSD §8.3 "보관": expired 24시간 뒤 삭제). */
export const DELETE_AFTER_MS = 48 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

/** 서울 날짜 YYYY-MM-DD. 번호는 이 날짜마다 1번부터. */
export function kstDate(time: number): string {
  return new Date(time + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "새 제품" → new, "중고" → used, "상관없어" → any. 모르면 null(TSD:267, AI 결정). */
export function normalizeCondition(condition: string): ConditionKind | null {
  if (/상관|아무/.test(condition)) return "any";
  if (/중고/.test(condition)) return "used";
  if (/새|신품/.test(condition)) return "new";
  return null;
}

// ---------- 메모리 ----------

interface MemoryRow {
  id: string;
  clientRequestId: string;
  queueDate: string;
  queueNumber: number;
  product: string;
  status: RequestStatus;
  createdAt: number;
}

interface MemoryState {
  rows: Map<string, MemoryRow>;
  byClient: Map<string, string>;
}

export function createMemoryStore(
  options: { now?: () => number; state?: MemoryState } = {},
): RequestStore {
  const now = options.now ?? Date.now;
  const state = options.state ?? { rows: new Map(), byClient: new Map() };

  function sweep(current: number) {
    for (const row of state.rows.values()) {
      if (row.status === "waiting" && current - row.createdAt >= WAITING_TTL_MS) {
        row.status = "expired";
      }
      if (row.status === "expired" && current - row.createdAt >= DELETE_AFTER_MS) {
        state.rows.delete(row.id);
        state.byClient.delete(row.clientRequestId);
      }
    }
  }

  return {
    persistent: false,
    storeKind: () => "memory",
    async register(input) {
      const current = now();
      sweep(current);
      const existingId = state.byClient.get(input.clientRequestId);
      const existing = existingId ? state.rows.get(existingId) : undefined;
      if (existing) {
        return {
          outcome: "existing",
          requestId: existing.id,
          queueNumber: existing.queueNumber,
          status: existing.status,
        };
      }
      const queueDate = kstDate(current);
      let last = 0;
      for (const row of state.rows.values()) {
        if (row.queueDate === queueDate) last = Math.max(last, row.queueNumber);
      }
      const row: MemoryRow = {
        id: randomUUID(),
        clientRequestId: input.clientRequestId,
        queueDate,
        queueNumber: last + 1,
        product: input.product,
        status: "waiting",
        createdAt: current,
      };
      state.rows.set(row.id, row);
      state.byClient.set(row.clientRequestId, row.id);
      return {
        outcome: "created",
        requestId: row.id,
        queueNumber: row.queueNumber,
        status: row.status,
      };
    },
    async get(requestId) {
      sweep(now());
      const row = state.rows.get(requestId);
      return row
        ? {
            requestId: row.id,
            queueNumber: row.queueNumber,
            status: row.status,
            product: row.product,
          }
        : null;
    },
  };
}

// ---------- Supabase ----------

export interface DbError {
  code?: string;
  message?: string;
}

interface DbResult {
  data: unknown;
  error: DbError | null;
}

/** 시험에서 가짜로 바꿔 넣는 최소 모양. supabase-js 클라이언트가 이 모양을 만족한다. */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<DbResult>;
      };
    };
  };
}

/** 함수·표가 아직 없다는 오류(마이그레이션 원격 적용 전). 이때만 메모리로 떨어진다. */
const MISSING_SCHEMA_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

export function isMissingSchema(error: DbError | null | undefined): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code));
}

const STATUSES = new Set<RequestStatus>(["waiting", "in_progress", "done", "expired"]);

function isStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && STATUSES.has(value as RequestStatus);
}

/** rpc는 표를 돌려주는 함수에 배열을 준다. 한 행이 아니면 모양 이상으로 본다. */
function toRegisterResult(data: unknown): RegisterResult {
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | null
    | undefined;
  if (
    !row ||
    (row.out_outcome !== "created" && row.out_outcome !== "existing") ||
    typeof row.out_request_id !== "string" ||
    typeof row.out_queue_number !== "number" ||
    !isStatus(row.out_status)
  ) {
    throw new StoreUnavailableError("unexpected register_request result");
  }
  return {
    outcome: row.out_outcome,
    requestId: row.out_request_id,
    queueNumber: row.out_queue_number,
    status: row.out_status,
  };
}

function toStoredRequest(data: unknown): StoredRequest | null {
  if (data === null || data === undefined) return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.queue_number !== "number" ||
    !isStatus(row.status) ||
    typeof row.product !== "string"
  ) {
    throw new StoreUnavailableError("unexpected requests row");
  }
  let status = row.status;
  // 정리는 접수 때만 하므로, 조회 때는 24시간 지난 waiting을 expired로 읽는다.
  if (
    status === "waiting" &&
    typeof row.created_at === "string" &&
    Date.now() - Date.parse(row.created_at) >= WAITING_TTL_MS
  ) {
    status = "expired";
  }
  return {
    requestId: row.id,
    queueNumber: row.queue_number,
    status,
    product: row.product,
  };
}

export function createSupabaseStore(
  client: RpcClient,
  fallback: RequestStore = createMemoryStore(),
): RequestStore {
  // 표·함수가 없다는 답을 받으면 이 프로세스는 메모리로 간다. 다음 인스턴스는 다시 Supabase부터.
  let fellBack = false;

  return {
    get persistent() {
      return !fellBack;
    },
    storeKind: () => (fellBack ? "memory" : "supabase"),
    async register(input) {
      if (fellBack) return fallback.register(input);
      let result: DbResult;
      try {
        result = await client.rpc("register_request", {
          p_client_request_id: input.clientRequestId,
          p_product: input.product,
          p_budget: input.budget,
          p_condition: input.condition,
          p_brand: input.brand,
          p_item: input.item,
          p_condition_kind: input.conditionKind,
        });
      } catch {
        throw new StoreUnavailableError("register_request failed");
      }
      if (result.error) {
        if (isMissingSchema(result.error)) {
          fellBack = true;
          return fallback.register(input);
        }
        throw new StoreUnavailableError("register_request failed");
      }
      return toRegisterResult(result.data);
    },
    async get(requestId) {
      if (fellBack) return fallback.get(requestId);
      let result: DbResult;
      try {
        result = await client
          .from("requests")
          .select("id, queue_number, status, product, created_at")
          .eq("id", requestId)
          .maybeSingle();
      } catch {
        throw new StoreUnavailableError("requests select failed");
      }
      if (result.error) {
        if (isMissingSchema(result.error)) {
          fellBack = true;
          return fallback.get(requestId);
        }
        throw new StoreUnavailableError("requests select failed");
      }
      return toStoredRequest(result.data);
    },
  };
}

// ---------- 선택 ----------

interface StoreCache {
  memory?: RequestStore;
  supabase?: RequestStore;
}

const globalCache = globalThis as typeof globalThis & {
  __lhRequestStores?: StoreCache;
};

function cache(): StoreCache {
  globalCache.__lhRequestStores ??= {};
  return globalCache.__lhRequestStores;
}

/** 값은 보지 않고 있는지만 본다. */
function supabaseSettings(): { url: string; key: string } | null {
  // 빈 값은 없는 것으로 본다(TSD:147의 ?? 순서를 빈 문자열까지 넓힌 것).
  const url =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

/**
 * STORE_MODE=memory(운영에서는 무시) → 메모리. 아니면 Supabase 변수 두 개가 있으면 Supabase,
 * 없으면 메모리(TSD:153-154).
 */
export function getRequestStore(): RequestStore {
  const stores = cache();
  const forcedMemory =
    process.env.STORE_MODE === "memory" && process.env.VERCEL_ENV !== "production";
  const settings = forcedMemory ? null : supabaseSettings();
  stores.memory ??= createMemoryStore();
  if (!settings) return stores.memory;
  stores.supabase ??= createSupabaseStore(
    createClient(settings.url, settings.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as RpcClient,
    stores.memory,
  );
  return stores.supabase;
}

/** 시험 전용: 저장소 캐시를 비운다. memory를 주면 메모리 자리에 그 저장소를 둔다. */
export function resetRequestStoresForTest(memory?: RequestStore): void {
  globalCache.__lhRequestStores = memory ? { memory } : {};
}
