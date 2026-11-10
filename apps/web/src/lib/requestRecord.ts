// 플로우 A PR 2: 접수 호출, 다시 열기 조회, 기기 안 기록(localStorage lh.request.v1). notes-flow-a.md C3.
// 기록에는 요청 id, 대기번호, 찾는 제품만 둔다. 저장이 막혀도 화면은 멈추지 않는다.

import type { RequestAnswers } from "@/lib/requestFlow";
import { STATUS } from "@/lib/speech";

export const REQUEST_STORAGE_KEY = "lh.request.v1";
/** 서버가 답하지 않아도 "접수하고 있습니다"에 멈춰 있지 않게 끊는 시간. */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface RequestRecord {
  v: 1;
  requestId: string;
  queueNumber: number;
  product: string;
  savedAt: number;
}

export type RegisterOutcome =
  | { kind: "queued"; requestId: string; queueNumber: number }
  /** 서버가 품목이 없다고 했다(422). 질문 1부터 다시. */
  | { kind: "needProduct" }
  /** 같은 답과 같은 clientRequestId로 다시 보낼 수 있다. */
  | { kind: "failed"; status: string };

export type CheckOutcome =
  | { kind: "waiting"; queueNumber: number }
  /** 요청이 없거나 끝났다. 기록을 지운다. */
  | { kind: "gone" }
  /** 지금은 확인하지 못했다. 기록은 그대로 둔다. */
  | { kind: "failed" };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function failedStatus(status: number): string {
  switch (status) {
    case 429:
      return STATUS.tooMany;
    default:
      return STATUS.registerFailed;
  }
}

export async function registerRequest(
  clientRequestId: string,
  answers: RequestAnswers,
): Promise<RegisterOutcome> {
  try {
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientRequestId, ...answers }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 422) return { kind: "needProduct" };
    if (!response.ok) return { kind: "failed", status: failedStatus(response.status) };
    const body = (await response.json()) as Record<string, unknown> | null;
    if (typeof body?.requestId !== "string" || !isPositiveInteger(body.queueNumber)) {
      return { kind: "failed", status: STATUS.registerFailed };
    }
    return { kind: "queued", requestId: body.requestId, queueNumber: body.queueNumber };
  } catch {
    return { kind: "failed", status: STATUS.registerFailed };
  }
}

export async function checkRequest(requestId: string): Promise<CheckOutcome> {
  try {
    const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as {
        persistent?: unknown;
      } | null;
      // 메모리 저장소의 404는 서버가 바뀐 것일 수 있다. 기록을 지우지 않는다.
      return body?.persistent === false ? { kind: "failed" } : { kind: "gone" };
    }
    if (!response.ok) return { kind: "failed" };
    const body = (await response.json()) as Record<string, unknown> | null;
    if (!isPositiveInteger(body?.queueNumber)) return { kind: "failed" };
    if (body.status === "expired") return { kind: "gone" };
    return { kind: "waiting", queueNumber: body.queueNumber };
  } catch {
    return { kind: "failed" };
  }
}

export function saveRequestRecord(record: Omit<RequestRecord, "v" | "savedAt">): void {
  try {
    const value: RequestRecord = { v: 1, ...record, savedAt: Date.now() };
    localStorage.setItem(REQUEST_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 저장이 막히면 다시 열 때 첫 화면부터 시작한다.
  }
}

export function parseRequestRecord(stored: string | null | undefined): RequestRecord | null {
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<RequestRecord> | null;
    if (
      value?.v !== 1 ||
      typeof value.requestId !== "string" ||
      !isPositiveInteger(value.queueNumber) ||
      typeof value.product !== "string" ||
      typeof value.savedAt !== "number"
    ) {
      return null;
    }
    return value as RequestRecord;
  } catch {
    return null;
  }
}

/** 기록이 없거나 깨졌으면 null. 깨진 기록은 지운다. */
export function readRequestRecord(): RequestRecord | null {
  try {
    const stored = localStorage.getItem(REQUEST_STORAGE_KEY);
    const record = parseRequestRecord(stored);
    if (stored && !record) localStorage.removeItem(REQUEST_STORAGE_KEY);
    return record;
  } catch {
    return null;
  }
}

export function clearRequestRecord(): void {
  try {
    localStorage.removeItem(REQUEST_STORAGE_KEY);
  } catch {
    // 지우지 못해도 화면은 첫 화면으로 간다.
  }
}
