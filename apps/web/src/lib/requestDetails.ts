import "server-only";
import { getRequestStore, getSupabaseRpcClient, isMissingSchema, onRequestLeave, type DbError, type RpcClient } from "./requestStore";
import { PHONE } from "./researchCheck";
import type { RequestDetailsView, RequestQa } from "./volunteerView";

/**
 * 이용자 음성 요청의 확인 요약과 질문·답(봉사자 브리핑). 서버 전용.
 * - 접수(POST /api/requests) 때 이용자가 말한 그대로 저장한다. 맡은 봉사자 1명에게만, 그 요청이 진행 중인 동안만 내보낸다.
 * - 요청이 done·expired가 되면 지운다(DB는 트리거, 메모리는 onRequestLeave). 요청이 지워지면 함께 지워진다.
 * - Supabase 표 request_details가 없거나(마이그레이션 전) 못 쓰면 던지지 않고 "unavailable"·"failed"로 알린다. 접수는 그대로 된다.
 * - 글은 로그·OpenAI 기록·봉사자 기기에 남기지 않는다.
 */

export const DETAILS_SUMMARY_MAX = 300;
export const DETAILS_Q_MAX = 150;
export const DETAILS_A_MAX = 200;
export const DETAILS_PAIRS_MAX = 12;
/** POST /api/requests 본문 상한. */
export const DETAILS_BODY_MAX_BYTES = 32 * 1024;

const PHONE_MASK = "(전화번호 가림)";
// 제어 문자(줄바꿈·탭 포함)는 공백으로 바꾼 뒤 공백을 한 칸으로 줄인다.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** 한 줄로 정리하고 전화번호 모양을 가린 뒤 글자(code point) 단위로 자른다. 문자열이 아니거나 비면 "". */
function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .normalize("NFKC")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(PHONE.source, "g"), PHONE_MASK);
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * 받은 값(요청 본문의 details, 표에서 읽은 값)을 거른다. 객체가 아니거나 요약과 질문·답이 모두 비면 null.
 * 잘못된 짝(문자열이 아님, 질문이나 답이 빔)은 버리고 앞에서 12개까지만 둔다.
 */
export function cleanRequestDetails(value: unknown): RequestDetailsView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { summary?: unknown; qa?: unknown };
  const summary = cleanLine(record.summary, DETAILS_SUMMARY_MAX);
  const qa: RequestQa[] = [];
  if (Array.isArray(record.qa)) {
    for (const entry of record.qa) {
      if (qa.length >= DETAILS_PAIRS_MAX) break;
      if (!entry || typeof entry !== "object") continue;
      const pair = entry as { q?: unknown; a?: unknown };
      const q = cleanLine(pair.q, DETAILS_Q_MAX);
      const a = cleanLine(pair.a, DETAILS_A_MAX);
      if (q !== "" && a !== "") qa.push({ q, a });
    }
  }
  return summary === "" && qa.length === 0 ? null : { summary, qa };
}

export type SaveDetailsOutcome = "saved" | "exists" | "unavailable" | "failed";

interface TableClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ): { select(columns: string): PromiseLike<{ data: unknown; error: DbError | null }> };
  };
}

type Holder = typeof globalThis & { __lhRequestDetails?: Map<string, RequestDetailsView> };

function memoryMap(): Map<string, RequestDetailsView> {
  const holder = globalThis as Holder;
  holder.__lhRequestDetails ??= new Map();
  return holder.__lhRequestDetails;
}

let unsubscribe: (() => void) | null = null;

/**
 * 메모리 저장소: 요청이 진행 중에서 벗어날 때(내려놓기·보내기·6시간 반환·지워짐) 알림을 받아,
 * 요청이 없어졌거나 done·expired이면 글을 지운다(DB의 request_details_drop_on_close 트리거와 같은 일).
 * 내려놓기로 대기열에 돌아간 요청(waiting)의 글은 다음 봉사자가 봐야 하므로 남긴다.
 */
function watchLeaves(): void {
  if (unsubscribe) return;
  unsubscribe = onRequestLeave((requestId) => {
    // 알림은 지우기 직전에 올 수 있으므로(removeRow) 한 박자 늦춰 저장소가 정리된 뒤의 상태를 본다.
    void Promise.resolve()
      .then(() => getRequestStore().get(requestId))
      .then((found) => {
        if (!found || found.status === "done" || found.status === "expired") memoryMap().delete(requestId);
      })
      .catch(() => undefined);
  });
}

/** Supabase를 쓰는 중이면 그 클라이언트, 아니면 null(메모리). */
function supabaseClient(): RpcClient | null {
  return getRequestStore().storeKind() === "supabase" ? getSupabaseRpcClient() : null;
}

/** 처음 저장한 글을 지킨다(같은 접수를 다시 보내도 덮어쓰지 않는다). 던지지 않는다. */
export async function saveRequestDetails(
  requestId: string,
  details: RequestDetailsView,
): Promise<SaveDetailsOutcome> {
  try {
    const client = supabaseClient() as unknown as TableClient | null;
    if (!client) {
      watchLeaves();
      const map = memoryMap();
      if (map.has(requestId)) return "exists";
      map.set(requestId, details);
      return "saved";
    }
    const { data, error } = await client
      .from("request_details")
      .upsert(
        { request_id: requestId, summary: details.summary, qa: details.qa },
        { onConflict: "request_id", ignoreDuplicates: true },
      )
      .select("request_id");
    if (error) return isMissingSchema(error) ? "unavailable" : "failed";
    return Array.isArray(data) && data.length > 0 ? "saved" : "exists";
  } catch {
    return "failed";
  }
}

/** 저장된 글을 읽는다. 없거나 읽지 못하면 null(오류도 null). 읽은 값도 다시 거른다. */
export async function readRequestDetails(requestId: string): Promise<RequestDetailsView | null> {
  try {
    const client = supabaseClient();
    if (!client) {
      watchLeaves();
      return cleanRequestDetails(memoryMap().get(requestId));
    }
    const read = await client
      .from("request_details")
      .select("summary, qa")
      .eq("request_id", requestId)
      .maybeSingle();
    if (read.error || !read.data) return null;
    return cleanRequestDetails(read.data);
  } catch {
    return null;
  }
}

/** 시험 전용: 메모리 글과 알림 구독을 비운다. */
export function resetRequestDetailsForTest(): void {
  unsubscribe?.();
  unsubscribe = null;
  memoryMap().clear();
}
