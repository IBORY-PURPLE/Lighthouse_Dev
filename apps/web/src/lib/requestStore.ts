import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DEMO_DONE, DEMO_DONE_CANDIDATES, DEMO_WAITING } from "./demoRequests";
import type {
  QueueData,
  QueueItem,
  SentCandidate,
  SentItem,
  SentResult,
  VolunteerRequestView,
} from "./volunteerView";

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

export type ClaimOutcome = "claimed" | "already_mine" | "busy" | "taken" | "not_found";
export type ReleaseOutcome = "released" | "not_yours" | "not_found";
export type CompleteOutcome =
  | { outcome: "completed" | "existing"; sentAt: string }
  | { outcome: "not_yours" | "not_found" };
export type DetailOutcome =
  | { kind: "ok"; request: VolunteerRequestView; result: SentResult | null }
  | { kind: "not_yours" }
  | { kind: "not_found" };

/** 대기열 목록·내 담당에 한 번에 담는 개수 상한. */
export const QUEUE_LIMIT = 20;

export interface RequestStore {
  register(input: RegisterInput): Promise<RegisterResult>;
  get(requestId: string): Promise<StoredRequest | null>;
  storeKind(): StoreKind;
  /** 서버를 다시 띄워도 남는지. 메모리면 false라 404가 "지워짐"을 뜻하지 않는다. */
  readonly persistent: boolean;
  /**
   * 봉사자 기능(목록·맡기·보내기)이 서버를 다시 띄워도 남는지. 표·함수·열이 없어 메모리로 떨어지면 false.
   * 접수·조회(persistent)와 따로 둔다: 봉사자 쪽 마이그레이션이 없어도 접수는 Supabase에 남아야 한다.
   */
  readonly volunteerPersistent: boolean;
  /** 봉사자 화면 목록: 대기(24시간 안, 오래된 순, 20개), 내가 맡은 1건, 내가 보낸 것(최신순, 20개). */
  listQueue(volunteerId: string): Promise<QueueData>;
  /** 내가 진행 중인 요청, 또는 내 결과가 있는 완료 요청만 ok. */
  getForVolunteer(requestId: string, volunteerId: string): Promise<DetailOutcome>;
  claim(requestId: string, volunteerId: string): Promise<ClaimOutcome>;
  release(requestId: string, volunteerId: string): Promise<ReleaseOutcome>;
  complete(
    requestId: string,
    volunteerId: string,
    candidates: SentCandidate[],
  ): Promise<CompleteOutcome>;
  /** 시연 행만 지우고 대기 5건을 넣는다. volunteerId가 있으면 그 기기의 완료 1건도. 대기 건수를 돌려준다. */
  resetDemo(volunteerId: string | null): Promise<number>;
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
  budget: string;
  condition: string;
  brand: string | null;
  item: string | null;
  conditionKind: ConditionKind | null;
  status: RequestStatus;
  volunteerId: string | null;
  createdAt: number;
  claimedAt: number | null;
  doneAt: number | null;
  releaseCount: number;
  isDemo: boolean;
}

interface MemoryResult {
  volunteerId: string;
  candidates: SentCandidate[];
  sentAt: number;
}

interface MemoryState {
  rows: Map<string, MemoryRow>;
  byClient: Map<string, string>;
  results: Map<string, MemoryResult>;
}

/** done은 이 시간 뒤에 지운다(register_request SQL과 같다). */
const DONE_DELETE_AFTER_MS = 7 * 24 * HOUR_MS;

function iso(time: number | null): string | null {
  return time === null ? null : new Date(time).toISOString();
}

function memoryView(row: MemoryRow): VolunteerRequestView {
  return {
    requestId: row.id,
    status: row.status,
    product: row.product,
    budget: row.budget,
    condition: row.condition,
    brand: row.brand,
    item: row.item,
    conditionKind: row.conditionKind,
    createdAt: new Date(row.createdAt).toISOString(),
    claimedAt: iso(row.claimedAt),
    doneAt: iso(row.doneAt),
    isDemo: row.isDemo,
  };
}

function memorySent(result: MemoryResult): SentResult {
  return {
    sentAt: new Date(result.sentAt).toISOString(),
    heardAt: null,
    linkOpenedAt: null,
    candidates: result.candidates,
  };
}

export function createMemoryStore(
  options: { now?: () => number; state?: Partial<MemoryState> } = {},
): RequestStore {
  const now = options.now ?? Date.now;
  const state: MemoryState = {
    rows: options.state?.rows ?? new Map(),
    byClient: options.state?.byClient ?? new Map(),
    results: options.state?.results ?? new Map(),
  };

  function removeRow(row: MemoryRow) {
    state.rows.delete(row.id);
    state.byClient.delete(row.clientRequestId);
    state.results.delete(row.id);
  }

  function sweep(current: number) {
    for (const row of [...state.rows.values()]) {
      if (row.status === "waiting" && current - row.createdAt >= WAITING_TTL_MS) {
        row.status = "expired";
      }
      if (row.status === "expired" && current - row.createdAt >= DELETE_AFTER_MS) {
        removeRow(row);
      } else if (
        row.status === "done" &&
        row.doneAt !== null &&
        current - row.doneAt >= DONE_DELETE_AFTER_MS
      ) {
        removeRow(row);
      }
    }
  }

  function nextQueueNumber(queueDate: string): number {
    let last = 0;
    for (const row of state.rows.values()) {
      if (row.queueDate === queueDate) last = Math.max(last, row.queueNumber);
    }
    return last + 1;
  }

  function addRow(
    fields: Pick<
      MemoryRow,
      "product" | "budget" | "condition" | "brand" | "item" | "conditionKind"
    > &
      Partial<MemoryRow>,
    current: number,
  ): MemoryRow {
    const queueDate = kstDate(current);
    const row: MemoryRow = {
      id: randomUUID(),
      clientRequestId: randomUUID(),
      queueDate,
      queueNumber: nextQueueNumber(queueDate),
      status: "waiting",
      volunteerId: null,
      createdAt: current,
      claimedAt: null,
      doneAt: null,
      releaseCount: 0,
      isDemo: false,
      ...fields,
    };
    state.rows.set(row.id, row);
    state.byClient.set(row.clientRequestId, row.id);
    return row;
  }

  function mineOf(volunteerId: string): MemoryRow | undefined {
    for (const row of state.rows.values()) {
      if (row.status === "in_progress" && row.volunteerId === volunteerId) return row;
    }
    return undefined;
  }

  return {
    persistent: false,
    volunteerPersistent: false,
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
      const row = addRow(
        {
          clientRequestId: input.clientRequestId,
          product: input.product,
          budget: input.budget,
          condition: input.condition,
          brand: input.brand,
          item: input.item,
          conditionKind: input.conditionKind,
        },
        current,
      );
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
    async listQueue(volunteerId) {
      const current = now();
      sweep(current);
      const waiting: QueueItem[] = [...state.rows.values()]
        .filter((row) => row.status === "waiting" && current - row.createdAt < WAITING_TTL_MS)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, QUEUE_LIMIT)
        .map((row) => ({
          requestId: row.id,
          product: row.product,
          budget: row.budget,
          condition: row.condition,
          item: row.item,
          createdAt: new Date(row.createdAt).toISOString(),
          isDemo: row.isDemo,
        }));
      const mine = mineOf(volunteerId);
      const sent: SentItem[] = [...state.results.entries()]
        .filter(([id, result]) => result.volunteerId === volunteerId && state.rows.has(id))
        .sort(([, a], [, b]) => b.sentAt - a.sentAt)
        .slice(0, QUEUE_LIMIT)
        .map(([id, result]) => {
          const row = state.rows.get(id) as MemoryRow;
          return {
            requestId: id,
            product: row.product,
            budget: row.budget,
            sentAt: new Date(result.sentAt).toISOString(),
            candidateCount: result.candidates.length,
          };
        });
      return { waiting, mine: mine ? memoryView(mine) : null, sent };
    },
    async getForVolunteer(requestId, volunteerId) {
      sweep(now());
      const row = state.rows.get(requestId);
      if (!row) return { kind: "not_found" };
      if (row.status === "in_progress" && row.volunteerId === volunteerId) {
        return { kind: "ok", request: memoryView(row), result: null };
      }
      const result = state.results.get(requestId);
      if (row.status === "done" && result && result.volunteerId === volunteerId) {
        return { kind: "ok", request: memoryView(row), result: memorySent(result) };
      }
      return { kind: "not_yours" };
    },
    async claim(requestId, volunteerId) {
      const current = now();
      sweep(current);
      const mine = mineOf(volunteerId);
      if (mine) return mine.id === requestId ? "already_mine" : "busy";
      const row = state.rows.get(requestId);
      if (!row) return "not_found";
      if (row.status !== "waiting") return "taken";
      row.status = "in_progress";
      row.volunteerId = volunteerId;
      row.claimedAt = current;
      return "claimed";
    },
    async release(requestId, volunteerId) {
      sweep(now());
      const row = state.rows.get(requestId);
      if (!row) return "not_found";
      if (row.status !== "in_progress" || row.volunteerId !== volunteerId) return "not_yours";
      row.status = "waiting";
      row.volunteerId = null;
      row.claimedAt = null;
      row.releaseCount += 1;
      return "released";
    },
    async complete(requestId, volunteerId, candidates) {
      const current = now();
      sweep(current);
      const existing = state.results.get(requestId);
      if (existing && existing.volunteerId === volunteerId) {
        return { outcome: "existing", sentAt: new Date(existing.sentAt).toISOString() };
      }
      const row = state.rows.get(requestId);
      if (!row) return { outcome: "not_found" };
      if (row.status !== "in_progress" || row.volunteerId !== volunteerId) {
        return { outcome: "not_yours" };
      }
      row.status = "done";
      row.doneAt = current;
      state.results.set(requestId, { volunteerId, candidates, sentAt: current });
      return { outcome: "completed", sentAt: new Date(current).toISOString() };
    },
    async resetDemo(volunteerId) {
      const current = now();
      sweep(current);
      for (const row of [...state.rows.values()]) {
        if (row.isDemo) removeRow(row);
      }
      for (const demo of DEMO_WAITING) {
        addRow(
          {
            product: demo.product,
            budget: demo.budget,
            condition: demo.condition,
            brand: demo.brand,
            item: demo.item,
            conditionKind: demo.conditionKind,
            isDemo: true,
            createdAt: current - demo.minutesAgo * 60_000,
          },
          current,
        );
      }
      if (volunteerId) {
        const minute = 60_000;
        const row = addRow(
          {
            product: DEMO_DONE.product,
            budget: DEMO_DONE.budget,
            condition: DEMO_DONE.condition,
            brand: DEMO_DONE.brand,
            item: DEMO_DONE.item,
            conditionKind: DEMO_DONE.conditionKind,
            isDemo: true,
            status: "done",
            volunteerId,
            createdAt: current - DEMO_DONE.createdMinutesAgo * minute,
            claimedAt: current - DEMO_DONE.claimedMinutesAgo * minute,
            doneAt: current - DEMO_DONE.sentMinutesAgo * minute,
          },
          current,
        );
        state.results.set(row.id, {
          volunteerId,
          candidates: DEMO_DONE_CANDIDATES.map((candidate) => ({
            ...candidate,
            summary: candidate.summary.map((entry) => ({ ...entry })),
          })),
          sentAt: current - DEMO_DONE.sentMinutesAgo * minute,
        });
      }
      return DEMO_WAITING.length;
    },
  };
}

// ---------- Supabase ----------

export interface DbError {
  code?: string;
  message?: string;
}

export interface DbResult {
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

/** 봉사자 목록 읽기가 쓰는 조회 모양. await하면 여러 행(배열)을 준다. */
export interface QueryBuilder extends PromiseLike<DbResult> {
  eq(column: string, value: string): QueryBuilder;
  gt(column: string, value: string): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): PromiseLike<DbResult>;
}

/** RpcClient를 넓힌 모양. 봉사자 메서드만 쓴다(접수·조회는 RpcClient만으로 된다). */
export interface VolunteerClient extends RpcClient {
  from(table: string): {
    select(columns: string): QueryBuilder;
  };
}

/**
 * 함수·표·열이 아직 없다는 오류(마이그레이션 원격 적용 전). 이때만 메모리로 떨어진다.
 * 42703/PGRST204는 requests에 is_demo 열이 없을 때(봉사자 마이그레이션 전)다.
 */
const MISSING_SCHEMA_CODES = new Set([
  "PGRST202",
  "PGRST205",
  "42883",
  "42P01",
  "42703",
  "PGRST204",
]);

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

// ----- 봉사자 읽기·쓰기의 모양 검사 -----

/** 이 프로세스가 봉사자 표·함수·열이 없다는 답을 받았다. 메모리로 간다. */
class MissingSchemaSignal extends Error {}

const REQUEST_COLUMNS =
  "id, status, product, budget, condition, brand, item, condition_kind, created_at, claimed_at, done_at, is_demo";
const QUEUE_COLUMNS = "id, product, budget, condition, item, created_at, is_demo";
const SENT_COLUMNS = "request_id, sent_at, candidates, requests(product, budget)";
const RESULT_COLUMNS = "request_id, volunteer_id, candidates, sent_at, heard_at, link_opened_at";

function bad(what: string): never {
  throw new StoreUnavailableError(`unexpected ${what}`);
}

function str(value: unknown, what: string): string {
  return typeof value === "string" ? value : bad(what);
}

function strOrNull(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : str(value, what);
}

function toConditionKind(value: unknown): ConditionKind | null {
  return value === "new" || value === "used" || value === "any" ? value : null;
}

function toView(data: unknown): VolunteerRequestView {
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || !isStatus(row.status)) bad("requests row");
  return {
    requestId: str(row.id, "requests row"),
    status: row.status as RequestStatus,
    product: str(row.product, "requests row"),
    budget: str(row.budget, "requests row"),
    condition: str(row.condition, "requests row"),
    brand: strOrNull(row.brand, "requests row"),
    item: strOrNull(row.item, "requests row"),
    conditionKind: toConditionKind(row.condition_kind),
    createdAt: str(row.created_at, "requests row"),
    claimedAt: strOrNull(row.claimed_at, "requests row"),
    doneAt: strOrNull(row.done_at, "requests row"),
    isDemo: row.is_demo === true,
  };
}

function toQueueItem(data: unknown): QueueItem {
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object") bad("requests row");
  return {
    requestId: str(row.id, "requests row"),
    product: str(row.product, "requests row"),
    budget: str(row.budget, "requests row"),
    condition: str(row.condition, "requests row"),
    item: strOrNull(row.item, "requests row"),
    createdAt: str(row.created_at, "requests row"),
    isDemo: row.is_demo === true,
  };
}

function toCandidates(value: unknown): SentCandidate[] {
  if (!Array.isArray(value)) bad("results candidates");
  return value.map((entry) => {
    const candidate = entry as Record<string, unknown> | null;
    if (!candidate || typeof candidate !== "object") bad("results candidates");
    const summary = Array.isArray(candidate.summary) ? candidate.summary : [];
    return {
      name: str(candidate.name, "results candidates"),
      url: str(candidate.url, "results candidates"),
      guide: typeof candidate.guide === "string" ? candidate.guide : "",
      summary: summary.map((item) => {
        const pair = item as Record<string, unknown> | null;
        return {
          label: str(pair?.label, "results candidates"),
          value: str(pair?.value, "results candidates"),
        };
      }),
    };
  });
}

function toSentItem(data: unknown): SentItem {
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object") bad("results row");
  // 많은 쪽(results)에서 한 쪽(requests)을 끼워 읽으면 객체다. 배열로 올 때도 받는다.
  const embedded = Array.isArray(row.requests) ? row.requests[0] : row.requests;
  const request = embedded as Record<string, unknown> | null;
  if (!request || typeof request !== "object") bad("results row");
  return {
    requestId: str(row.request_id, "results row"),
    product: str(request.product, "results row"),
    budget: str(request.budget, "results row"),
    sentAt: str(row.sent_at, "results row"),
    candidateCount: toCandidates(row.candidates).length,
  };
}

function toSentResult(data: unknown): SentResult {
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object") bad("results row");
  return {
    sentAt: str(row.sent_at, "results row"),
    heardAt: strOrNull(row.heard_at, "results row"),
    linkOpenedAt: strOrNull(row.link_opened_at, "results row"),
    candidates: toCandidates(row.candidates),
  };
}

/** rpc가 text 하나를 돌려주면 문자열, 표 함수면 배열이다. */
function scalar(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

function toClaimOutcome(data: unknown): ClaimOutcome {
  const value = scalar(data);
  if (
    value === "claimed" ||
    value === "already_mine" ||
    value === "busy" ||
    value === "taken" ||
    value === "not_found"
  ) {
    return value;
  }
  return bad("claim_request result");
}

function toReleaseOutcome(data: unknown): ReleaseOutcome {
  const value = scalar(data);
  if (value === "released" || value === "not_yours" || value === "not_found") return value;
  return bad("release_request result");
}

function toCompleteOutcome(data: unknown): CompleteOutcome {
  const row = scalar(data) as Record<string, unknown> | null | undefined;
  const outcome = row?.out_outcome;
  if (outcome === "completed" || outcome === "existing") {
    if (typeof row?.out_sent_at !== "string") return bad("complete_request result");
    return { outcome, sentAt: row.out_sent_at };
  }
  if (outcome === "not_yours" || outcome === "not_found") return { outcome };
  return bad("complete_request result");
}

export function createSupabaseStore(
  client: RpcClient,
  fallback: RequestStore = createMemoryStore(),
): RequestStore {
  // 표·함수가 없다는 답을 받으면 이 프로세스는 메모리로 간다. 다음 인스턴스는 다시 Supabase부터.
  let fellBack = false;
  // 봉사자 쪽만 따로 본다. 마이그레이션이 없어도 접수(register_request)는 Supabase에 남겨야 한다.
  let volunteerFellBack = false;
  // 읽기에 넓은 조회 모양이 필요하다. supabase-js는 그 모양을 갖고 있다.
  const reader = client as VolunteerClient;

  function checked(result: DbResult, label: string): unknown {
    if (result.error) {
      if (isMissingSchema(result.error)) throw new MissingSchemaSignal(label);
      throw new StoreUnavailableError(`${label} failed`);
    }
    return result.data;
  }

  /** 봉사자 메서드 공통: Supabase를 부르고, 스키마가 없으면 메모리로 떨어진다. */
  async function volunteerCall<T>(
    label: string,
    run: () => Promise<T>,
    viaMemory: () => Promise<T>,
  ): Promise<T> {
    if (fellBack || volunteerFellBack) return viaMemory();
    try {
      return await run();
    } catch (error) {
      if (error instanceof MissingSchemaSignal) {
        volunteerFellBack = true;
        return viaMemory();
      }
      if (error instanceof StoreUnavailableError) throw error;
      throw new StoreUnavailableError(`${label} failed`);
    }
  }

  async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    return checked(await client.rpc(fn, args), fn);
  }

  return {
    get persistent() {
      return !fellBack;
    },
    get volunteerPersistent() {
      return !fellBack && !volunteerFellBack;
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
    listQueue(volunteerId) {
      return volunteerCall(
        "queue select",
        async () => {
          const cutoff = new Date(Date.now() - WAITING_TTL_MS).toISOString();
          const [waiting, mine, sent] = await Promise.all([
            reader
              .from("requests")
              .select(QUEUE_COLUMNS)
              .eq("status", "waiting")
              .gt("created_at", cutoff)
              .order("created_at", { ascending: true })
              .limit(QUEUE_LIMIT),
            reader
              .from("requests")
              .select(REQUEST_COLUMNS)
              .eq("status", "in_progress")
              .eq("volunteer_id", volunteerId)
              .maybeSingle(),
            reader
              .from("results")
              .select(SENT_COLUMNS)
              .eq("volunteer_id", volunteerId)
              .order("sent_at", { ascending: false })
              .limit(QUEUE_LIMIT),
          ]);
          const waitingRows = checked(waiting, "queue select");
          const mineRow = checked(mine, "queue select");
          const sentRows = checked(sent, "queue select");
          if (!Array.isArray(waitingRows) || !Array.isArray(sentRows)) bad("queue rows");
          return {
            waiting: waitingRows.map(toQueueItem),
            mine: mineRow ? toView(mineRow) : null,
            sent: sentRows.map(toSentItem),
          };
        },
        () => fallback.listQueue(volunteerId),
      );
    },
    getForVolunteer(requestId, volunteerId) {
      return volunteerCall(
        "detail select",
        async (): Promise<DetailOutcome> => {
          const row = checked(
            await reader
              .from("requests")
              .select(`${REQUEST_COLUMNS}, volunteer_id`)
              .eq("id", requestId)
              .maybeSingle(),
            "detail select",
          ) as Record<string, unknown> | null;
          if (!row) return { kind: "not_found" };
          const view = toView(row);
          if (row.volunteer_id !== volunteerId) return { kind: "not_yours" };
          if (view.status === "in_progress") return { kind: "ok", request: view, result: null };
          if (view.status !== "done") return { kind: "not_yours" };
          const result = checked(
            await reader
              .from("results")
              .select(RESULT_COLUMNS)
              .eq("request_id", requestId)
              .eq("volunteer_id", volunteerId)
              .maybeSingle(),
            "detail select",
          );
          return result
            ? { kind: "ok", request: view, result: toSentResult(result) }
            : { kind: "not_yours" };
        },
        () => fallback.getForVolunteer(requestId, volunteerId),
      );
    },
    claim(requestId, volunteerId) {
      return volunteerCall(
        "claim_request",
        async () =>
          toClaimOutcome(
            await rpc("claim_request", {
              p_request_id: requestId,
              p_volunteer_id: volunteerId,
            }),
          ),
        () => fallback.claim(requestId, volunteerId),
      );
    },
    release(requestId, volunteerId) {
      return volunteerCall(
        "release_request",
        async () =>
          toReleaseOutcome(
            await rpc("release_request", {
              p_request_id: requestId,
              p_volunteer_id: volunteerId,
            }),
          ),
        () => fallback.release(requestId, volunteerId),
      );
    },
    complete(requestId, volunteerId, candidates) {
      return volunteerCall(
        "complete_request",
        async () =>
          toCompleteOutcome(
            await rpc("complete_request", {
              p_request_id: requestId,
              p_volunteer_id: volunteerId,
              p_candidates: candidates,
            }),
          ),
        () => fallback.complete(requestId, volunteerId, candidates),
      );
    },
    resetDemo(volunteerId) {
      return volunteerCall(
        "reset_demo_requests",
        async () => {
          const value = scalar(await rpc("reset_demo_requests", { p_volunteer_id: volunteerId }));
          return typeof value === "number" ? value : bad("reset_demo_requests result");
        },
        () => fallback.resetDemo(volunteerId),
      );
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

/** 시험에서 접수·조회만 가짜로 넣을 때 쓰는 부분 저장소. 봉사자 메서드는 비워도 된다. */
export type PartialRequestStore = Pick<
  RequestStore,
  "register" | "get" | "storeKind" | "persistent"
> &
  Partial<RequestStore>;

/** 시험 전용: 저장소 캐시를 비운다. memory를 주면 메모리 자리에 그 저장소를 둔다. */
export function resetRequestStoresForTest(memory?: PartialRequestStore): void {
  globalCache.__lhRequestStores = memory ? { memory: memory as RequestStore } : {};
}
