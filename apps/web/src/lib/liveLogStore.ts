import "server-only";
import { maskPhone } from "./liveText";
import {
  LIVE_LOG_AT_MS_MAX,
  LIVE_LOG_BODY_MAX,
  LIVE_LOG_CID,
  LIVE_LOG_MAX_ENTRIES,
  LIVE_LOG_PHASE,
  LIVE_LOG_SEQ_MAX,
  LIVE_LOG_TAG,
  type LiveLogKind,
} from "./liveLogWire";
import { getSupabaseRpcClient, isMissingSchema, type DbError, type RpcClient } from "./requestStore";

/**
 * /live 대화 기록(QA 분석용)의 정리와 저장. 서버 전용.
 * - 정리(cleanLiveLogEntries): 줄 단위로 거른다. 틀린 줄만 버리고 나머지는 살린다. 표(live_events)의 check와 같은 규칙이라
 *   저장 묶음 전체가 DB에서 거부되지 않는다.
 * - 저장(saveLiveEvents): 던지지 않고 결과 낱말로 돌려준다. 같은 (cid, seq)를 다시 넣어도 처음 값이 남는다.
 * - Supabase 연결이 없으면(로컬·e2e) 메모리에 최대 2,000줄만 둔다. 운영에서는 메모리에 쌓지 않고 unavailable로 알린다.
 * - requestDetails.ts와 달리 접수 저장소가 메모리로 떨어진 인스턴스에서도 DB로 간다(연결이 있는지만 본다).
 * - 로그와 콘솔에 글, cid, 기기 ID, 참가자 표지를 남기지 않는다. 이 모듈은 아무것도 찍지 않는다.
 */

/** live_events 표의 한 줄. created_at, delete_after는 DB 기본값이라 넣지 않는다. 모든 줄에 11개 열을 빠짐없이 채운다. */
export interface LiveEventRow {
  cid: string;
  seq: number;
  device_id: string;
  kind: LiveLogKind;
  tag: string;
  body: string;
  phase: string;
  engine: "" | "realtime" | "fallback";
  at_ms: number;
  label: string;
  env: string;
}

/** saved: 저장함(묶음이 거부돼 줄마다 따로 넣어 일부만 들어간 경우 포함) / unavailable: 표가 없거나 연결이 없음 / failed: 어느 줄도 넣지 못한 영구 오류 / capped: 상한 / retry: 잠깐의 오류(나중에 다시) */
export type SaveLiveEventsResult = "saved" | "unavailable" | "failed" | "capped" | "retry";

const KINDS: ReadonlySet<string> = new Set<LiveLogKind>(["user", "ai", "app", "event"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// 짝 없는 대리 쌍. 그대로 두면 Postgres가 JSON을 거부해(22P02) 같은 묶음의 좋은 줄까지 버려진다.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const ENV_PATTERN = /^[a-z]{1,12}$/;

export const MEMORY_MAX_ROWS = 2000;
export const DB_TIMEOUT_MS = 3000;
/** 묶음이 거부돼 줄마다 따로 넣을 때 쓰는 전체 시간 한도. */
export const ONE_BY_ONE_BUDGET_MS = 5000;
/** 표가 없다는 오류를 만나면 이 시간 동안 DB를 부르지 않는다. */
export const UNAVAILABLE_COOLDOWN_MS = 60_000;
/** 표의 줄 수 어림값을 다시 보는 간격. */
export const COUNT_CACHE_MS = 60_000;
/** 표가 이 줄 수를 넘으면 더 쌓지 않는다. */
export const TABLE_ROW_CAP = 600_000;
/**
 * 인스턴스 하나가 하루에 저장하는 줄 수 상한(한국 날짜 기준). 폭주를 막는 안전판이다.
 * QA 하루치(30명이 두 조로 하면 약 3만 줄로 어림)보다 넉넉해야 한다. 닿으면 그날 남은 묶음이 capped로 버려진다.
 */
export const DAILY_ROW_CAP = 100_000;

const KST_OFFSET_MS = 9 * 60 * 60_000;

/** VERCEL_ENV가 소문자 12자 이하면 그 값, 아니면 "local". */
export function liveLogEnv(): string {
  const value = process.env.VERCEL_ENV;
  return value && ENV_PATTERN.test(value) ? value : "local";
}

/** 본문 정리: 짝 없는 대리 쌍을 U+FFFD로, NFKC, 제어 문자(NUL 포함)를 공백으로, 공백 한 칸으로·trim, 전화번호 가림, 코드 포인트 기준 1,000자. 문자열이 아니면 "". */
function cleanBody(value: unknown): string {
  if (typeof value !== "string") return "";
  const whole = value.replace(LONE_SURROGATE, "\ufffd");
  const text = maskPhone(whole.normalize("NFKC").replace(CONTROL, " ").replace(/\s+/g, " ").trim());
  return Array.from(text).slice(0, LIVE_LOG_BODY_MAX).join("");
}

export interface CleanContext {
  deviceId: string;
  /** 이미 LIVE_LOG_LABEL을 통과했거나 "". */
  label: string;
}

/**
 * 받은 entries를 거른다. 앞에서 LIVE_LOG_MAX_ENTRIES개까지만 본다. 같은 (cid, seq)는 처음 것만 둔다.
 * 틀린 줄(cid·seq·kind 오류, event인데 tag 오류, 글 종류인데 정리 뒤 본문이 빔)은 버린다.
 */
export function cleanLiveLogEntries(entries: unknown, context: CleanContext): LiveEventRow[] {
  if (!Array.isArray(entries)) return [];
  const env = liveLogEnv();
  const seen = new Set<string>();
  const rows: LiveEventRow[] = [];
  for (const raw of entries.slice(0, LIVE_LOG_MAX_ENTRIES)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;

    if (typeof entry.cid !== "string" || !LIVE_LOG_CID.test(entry.cid)) continue;
    const cid = entry.cid.toLowerCase();
    const seq = entry.seq;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq > LIVE_LOG_SEQ_MAX) continue;
    const kind = entry.kind;
    if (typeof kind !== "string" || !KINDS.has(kind)) continue;

    const tagOk = typeof entry.tag === "string" && LIVE_LOG_TAG.test(entry.tag);
    if (kind === "event" && !tagOk) continue;
    const tag = tagOk ? (entry.tag as string) : "";

    const body = kind === "event" ? "" : cleanBody(entry.body);
    if (kind !== "event" && body === "") continue;

    const key = `${cid}:${seq}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const phase = typeof entry.phase === "string" && LIVE_LOG_PHASE.test(entry.phase) ? entry.phase : "";
    const engine = entry.engine === "realtime" || entry.engine === "fallback" ? entry.engine : "";
    const atMs =
      typeof entry.atMs === "number" && Number.isInteger(entry.atMs)
        ? Math.min(LIVE_LOG_AT_MS_MAX, Math.max(0, entry.atMs))
        : 0;

    rows.push({
      cid,
      seq,
      device_id: context.deviceId,
      kind: kind as LiveLogKind,
      tag,
      body,
      phase,
      engine,
      at_ms: atMs,
      label: context.label,
      env,
    });
  }
  return rows;
}

// ---------- 저장 ----------

/** 이 모듈이 쓰는 supabase-js 조회 모양(RpcClient는 upsert를 모른다). */
interface LogTable {
  upsert(
    rows: LiveEventRow[],
    options: { onConflict: string; ignoreDuplicates: boolean; defaultToNull: boolean },
  ): PromiseLike<{ data: unknown; error: DbError | null }>;
  select(
    columns: string,
    options: { count: "estimated"; head: true },
  ): PromiseLike<{ count: number | null; error: DbError | null }>;
}
interface LogClient {
  from(table: string): LogTable;
}

interface LogState {
  memory: Map<string, LiveEventRow>;
  unavailableUntil: number;
  count: { at: number; value: number | null } | null;
  day: string;
  dayRows: number;
}

function freshState(): LogState {
  return { memory: new Map(), unavailableUntil: 0, count: null, day: "", dayRows: 0 };
}

// 같은 프로세스 안에서 모듈이 여러 번 불려도 한 곳만 쓰게 전역에 둔다(다른 서버 저장소와 같은 방식).
const globalState = globalThis as typeof globalThis & { __lhLiveLog?: LogState };
const state = (): LogState => (globalState.__lhLiveLog ??= freshState());

/** 시험 전용: 메모리 줄, 60초 쉼, 줄 수 어림 캐시, 하루 세기를 비운다. */
export function resetLiveLogForTest(): void {
  globalState.__lhLiveLog = freshState();
}

/** 시험 전용: 메모리에 쌓인 줄(들어온 순서). */
export function memoryLiveEventsForTest(): LiveEventRow[] {
  return [...state().memory.values()];
}

class TimeoutSignal extends Error {}

/** 3초 안에 끝나지 않으면 TimeoutSignal로 거부한다. */
function withTimeout<T>(work: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutSignal()), DB_TIMEOUT_MS);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function seoulDay(now: number): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** check·형식 위반(SQLSTATE 22xxx, 23xxx)은 다시 보내도 같다. */
function isPermanent(error: DbError): boolean {
  return Boolean(error.code && /^2[23]/.test(error.code));
}

function saveToMemory(rows: LiveEventRow[]): void {
  const { memory } = state();
  for (const row of rows) {
    const key = `${row.cid}:${row.seq}`;
    if (memory.has(key)) continue;
    memory.set(key, row);
    if (memory.size > MEMORY_MAX_ROWS) {
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
  }
}

/** 표의 줄 수 어림값이 상한을 넘었는지. 조회가 실패하면 막지 않는다. 60초 캐시. */
async function tableIsFull(table: LogTable, now: number): Promise<boolean> {
  const current = state();
  if (!current.count || now - current.count.at >= COUNT_CACHE_MS) {
    let value: number | null = null;
    try {
      const result = await withTimeout(table.select("*", { count: "estimated", head: true }));
      value = !result.error && typeof result.count === "number" ? result.count : null;
    } catch {
      value = null;
    }
    current.count = { at: now, value };
  }
  return current.count.value !== null && current.count.value > TABLE_ROW_CAP;
}

/**
 * 정리된 줄을 저장한다. 던지지 않는다.
 * 열은 모두 채워서 보낸다(묶음 upsert는 줄마다 열이 다르면 빠진 열을 null로 보낸다). created_at, delete_after는 DB 기본값.
 */
export async function saveLiveEvents(rows: LiveEventRow[], out?: { stored: number }): Promise<SaveLiveEventsResult> {
  if (out) out.stored = 0;
  if (rows.length === 0) return "saved";
  let client: RpcClient | null;
  try {
    client = getSupabaseRpcClient();
  } catch {
    return "retry";
  }
  if (!client) {
    // Vercel 배포(운영·미리보기)에서 메모리에만 쌓이고 사라지는 일을 '저장됨'으로 보이지 않게 한다. 메모리 저장은 로컬·시험에서만 쓴다.
    if (process.env.VERCEL === "1" || (process.env.VERCEL_ENV ?? "") !== "") return "unavailable";
    saveToMemory(rows);
    if (out) out.stored = rows.length;
    return "saved";
  }

  const now = Date.now();
  const current = state();
  if (now < current.unavailableUntil) return "unavailable";

  const today = seoulDay(now);
  if (current.day !== today) {
    current.day = today;
    current.dayRows = 0;
  }
  if (current.dayRows + rows.length > DAILY_ROW_CAP) return "capped";

  const table = (client as unknown as LogClient).from("live_events");
  try {
    if (await tableIsFull(table, now)) return "capped";
    const { error } = await withTimeout(
      table.upsert(rows, { onConflict: "cid,seq", ignoreDuplicates: true, defaultToNull: false }),
    );
    if (!error) {
      current.dayRows += rows.length;
      if (out) out.stored = rows.length;
      return "saved";
    }
    if (isMissingSchema(error)) {
      current.unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
      return "unavailable";
    }
    if (!isPermanent(error)) return "retry";
    // 줄 하나 때문에 묶음 전체가 거부됐을 수 있다. 줄마다 따로 넣어 좋은 줄을 살린다.
    const one = await saveOneByOne(table, rows);
    current.dayRows += one.saved;
    // 시간 안에 다 해 보지 못했으면 화면이 묶음을 다시 보내게 한다(이미 들어간 줄은 같은 순번이라 다시 와도 한 번만 남는다).
    if (!one.complete) return "retry";
    if (one.saved === 0) return "failed";
    if (out) out.stored = one.saved;
    return "saved";
  } catch {
    return "retry";
  }
}

/** 묶음이 영구 오류로 거부됐을 때 줄마다 따로 넣는다. 저장된 줄 수와 모든 줄을 해 봤는지를 돌려준다. 전체 5초를 넘기면 그만둔다(complete: false). */
async function saveOneByOne(table: LogTable, rows: LiveEventRow[]): Promise<{ saved: number; complete: boolean }> {
  const startedAt = Date.now();
  let saved = 0;
  for (const row of rows) {
    if (Date.now() - startedAt > ONE_BY_ONE_BUDGET_MS) return { saved, complete: false };
    try {
      const { error } = await withTimeout(
        table.upsert([row], { onConflict: "cid,seq", ignoreDuplicates: true, defaultToNull: false }),
      );
      if (!error) saved += 1;
    } catch {
      // 이 줄은 넘어간다.
    }
  }
  return { saved, complete: true };
}
