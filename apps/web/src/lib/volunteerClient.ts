import { STATUS } from "./speech";
import {
  VOLUNTEER_MESSAGES,
  type QueueData,
  type SentResult,
  type VolunteerRequestView,
} from "./volunteerView";

// 봉사자 화면이 서버 함수를 부르는 브라우저 쪽 도우미와 기기 저장소 접근. 서버 코드를 가져오지 않는다.

export const SEEN_KEY = "lh.vol.seen.v1";
export const FLASH_KEY = "lh.vol.flash.v1";

export type ApiOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized" }
  | { kind: "failed"; status: number; error: string; message: string };

export interface QueueResponse extends QueueData {
  persistent: boolean;
  notice: string | null;
}

export interface MeResponse {
  entered: boolean;
}

export interface DetailResponse {
  request: VolunteerRequestView;
  result: SentResult | null;
}

/** 실패 상태 코드에 맞는 안내 글자. 429는 이용자 화면과 같은 문구. */
export function failureMessage(status: number): string {
  return status === 429 ? STATUS.tooMany : VOLUNTEER_MESSAGES.connectFailed;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<ApiOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store" });
  } catch {
    return {
      kind: "failed",
      status: 0,
      error: "network",
      message: VOLUNTEER_MESSAGES.connectFailed,
    };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  const body = await readJson(response);
  if (response.ok) return { kind: "ok", data: body as T };
  return {
    kind: "failed",
    status: response.status,
    error: typeof body?.error === "string" ? body.error : "unknown",
    message: failureMessage(response.status),
  };
}

export function fetchMe(): Promise<ApiOutcome<MeResponse>> {
  return call<MeResponse>("/api/volunteer/me");
}

export function fetchQueue(): Promise<ApiOutcome<QueueResponse>> {
  return call<QueueResponse>("/api/volunteer/queue");
}

export function fetchRequest(requestId: string): Promise<ApiOutcome<DetailResponse>> {
  return call<DetailResponse>(`/api/volunteer/requests/${requestId}`);
}

export type ClaimResult =
  | { kind: "claimed"; requestId: string }
  | { kind: "taken" }
  | { kind: "busy" }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string };

export async function claimRequest(requestId: string): Promise<ClaimResult> {
  const result = await call<{ requestId: string }>(
    `/api/volunteer/requests/${requestId}/claim`,
    { method: "POST" },
  );
  if (result.kind === "ok") return { kind: "claimed", requestId: result.data.requestId };
  if (result.kind === "unauthorized") return result;
  if (result.status === 409) {
    return result.error === "busy" ? { kind: "busy" } : { kind: "taken" };
  }
  if (result.status === 404) return { kind: "not_found" };
  return { kind: "failed", message: result.message };
}

export type ReleaseResult =
  | { kind: "released" }
  | { kind: "not_yours" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string };

export async function releaseRequest(requestId: string): Promise<ReleaseResult> {
  const result = await call<{ requestId: string }>(
    `/api/volunteer/requests/${requestId}/release`,
    { method: "POST" },
  );
  if (result.kind === "ok") return { kind: "released" };
  if (result.kind === "unauthorized") return result;
  if (result.status === 403 || result.status === 404) return { kind: "not_yours" };
  return { kind: "failed", message: result.message };
}

export function resetDemoRequests(): Promise<ApiOutcome<{ ok: true; waiting: number }>> {
  return call("/api/volunteer/demo/reset", { method: "POST" });
}

export type EnterOutcome =
  | { kind: "ok" }
  | { kind: "error"; message: string };

/** 입장. 코드와 별명 없이 기기 쿠키(lh_vol)만 받는다. 이미 받은 기기는 같은 ID를 유지한다. */
export async function enterVolunteer(): Promise<EnterOutcome> {
  try {
    const response = await fetch("/api/volunteer/enter", { method: "POST", cache: "no-store" });
    return response.ok
      ? { kind: "ok" }
      : { kind: "error", message: VOLUNTEER_MESSAGES.connectFailed };
  } catch {
    return { kind: "error", message: VOLUNTEER_MESSAGES.connectFailed };
  }
}

// ----- 기기 저장소(실패해도 화면은 돌아가야 한다) -----

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // 새 요청 표시와 한 번 보이는 안내만 잃는다.
  }
}

/**
 * 옛 화면이 기기에 남긴 글(요약 초안 lh.vol.draft.v1.<id>, 카드형 리서치 진행 상태 lh.vol.research.v1.<id>)은 읽는 코드가 없어졌다.
 * 저장 공간만 차지하므로(사진 썸네일 포함) 지운다.
 */
export function clearLegacyDrafts() {
  try {
    const stale: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("lh.vol.draft.v1.") || key?.startsWith("lh.vol.research.v1.")) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // 지우지 못해도 화면은 돌아간다.
  }
}

/** 직전 목록의 대기 요청 id. 없으면 첫 불러오기다. */
export function readSeen(): string[] | null {
  const raw = readSession(SEEN_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

export function saveSeen(ids: readonly string[]) {
  writeSession(SEEN_KEY, JSON.stringify(ids));
}

/** 다음 화면에서 한 번만 보일 안내. */
export function saveFlash(message: string) {
  writeSession(FLASH_KEY, message);
}

export function takeFlash(): string | null {
  const message = readSession(FLASH_KEY);
  if (message !== null) writeSession(FLASH_KEY, null);
  return message;
}
