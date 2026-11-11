import { STATUS } from "./speech";
import {
  VOLUNTEER_MESSAGES,
  type QueueData,
  type CandidateView,
  type SentCandidate,
  type SentResult,
  type VolunteerRequestView,
} from "./volunteerView";

// 봉사자 화면이 서버 함수를 부르는 브라우저 쪽 도우미와 기기 저장소 접근. 서버 코드를 가져오지 않는다.

export const NICKNAME_KEY = "lh.vol.nickname.v1";
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
  needsCode: boolean;
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

export interface CandidatesResponse {
  source: "demo";
  candidates: CandidateView[];
}

export function fetchCandidates(requestId: string): Promise<ApiOutcome<CandidatesResponse>> {
  return call<CandidatesResponse>(`/api/volunteer/requests/${requestId}/candidates`);
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

export type SendResult =
  | { kind: "sent"; sentAt: string }
  | { kind: "invalid_url" }
  | { kind: "not_yours" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string };

/** 확인한 후보를 보낸다(요청이 완료된다). 같은 봉사자가 다시 보내도 같은 결과(200)다. */
export async function sendResult(
  requestId: string,
  candidates: SentCandidate[],
): Promise<SendResult> {
  const result = await call<{ sentAt: string }>(`/api/volunteer/requests/${requestId}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates }),
  });
  if (result.kind === "ok") return { kind: "sent", sentAt: result.data.sentAt };
  if (result.kind === "unauthorized") return result;
  if (result.status === 403 || result.status === 404) return { kind: "not_yours" };
  if (result.status === 400 && result.error === "invalid_url") return { kind: "invalid_url" };
  return { kind: "failed", message: result.message };
}

export function resetDemoRequests(): Promise<ApiOutcome<{ ok: true; waiting: number }>> {
  return call("/api/volunteer/demo/reset", { method: "POST" });
}

export type EnterOutcome =
  | { kind: "ok" }
  | { kind: "error"; message: string };

/** 입장. 코드는 lh_access가 없는 기기에서만 보낸다. */
export async function enterVolunteer(
  code: string | null,
  nickname: string,
): Promise<EnterOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/volunteer/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(code === null ? { nickname } : { code, nickname }),
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: VOLUNTEER_MESSAGES.connectFailed };
  }
  if (response.ok) return { kind: "ok" };
  const body = await readJson(response);
  const error = typeof body?.error === "string" ? body.error : "";
  if (response.status === 401 || error === "invalid_code") {
    return { kind: "error", message: VOLUNTEER_MESSAGES.invalidCode };
  }
  if (error === "invalid_nickname") {
    return { kind: "error", message: VOLUNTEER_MESSAGES.invalidNickname };
  }
  if (response.status === 429) {
    return { kind: "error", message: VOLUNTEER_MESSAGES.enterTooMany };
  }
  return { kind: "error", message: VOLUNTEER_MESSAGES.connectFailed };
}

// ----- 기기 저장소(실패해도 화면은 돌아가야 한다) -----

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장하지 못해도 다음에 다시 물을 뿐이다.
  }
}

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

export const readNickname = () => readLocal(NICKNAME_KEY) ?? "";
export const saveNickname = (nickname: string) => writeLocal(NICKNAME_KEY, nickname);

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
