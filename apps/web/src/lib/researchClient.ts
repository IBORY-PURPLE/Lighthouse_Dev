// 봉사자 리서치 챗(대화형) 화면이 서버 함수를 부르는 브라우저 쪽 도우미와 응답 타입.
// 타입은 서버 라우트(`researchApi.ts`의 researchPayload·sessionSnapshot, 각 route.ts)가 실제로 주는 모양이다. 여기서 서버 코드를 가져오지 않는다.
// 메시지 body의 세부 모양(kind·quick·chips·shortcuts 등)은 읽는 쪽 `researchChatView.ts`에 모았다.

export const SLOT_KEYS = ["model", "pros", "photo", "alts", "altReason", "benefits", "refs"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export type Purchase = "unset" | "bought" | "research";
export type SlotStatus = "filled" | "confirmed" | "skipped";
export type ResearchStage = "hero" | "chat" | "review" | "sent";
export type SearchKind = "model" | "alts" | "benefits";
export type AiState = "ok" | "fallback" | "none" | "capped";

export interface SlotValue {
  value: string;
  links?: string[];
  status: SlotStatus;
  by: "volunteer" | "ai";
  short?: boolean;
}
export type SlotMap = Partial<Record<SlotKey, SlotValue>>;

export interface ReviewState {
  status?: "draft" | "confirmed";
  text?: string;
  rev?: number;
}

export interface PendingState {
  /** 서버가 웹 검색을 처리 중이면 그 종류. */
  search?: { kind: SearchKind; since?: string } | null;
  confirmFill?: { slot?: string; value?: string } | null;
  [key: string]: unknown;
}

export interface ChatMessage {
  seq: number;
  role: "ai" | "volunteer" | "system";
  /** question | fill | search | review | notice 등. 없으면 꼬리표 없음. */
  tag?: string | null;
  slot?: string | null;
  body: Record<string, unknown>;
  turnId?: string | null;
  ai?: AiState | null;
}

export interface PhotoView {
  id: string;
  thumb?: string;
  description?: string | null;
}

/** 칸·구매·검수 상태(서버가 매 응답에 같이 준다). */
export interface SessionSnapshot {
  stage: ResearchStage;
  purchase: Purchase;
  verified: boolean;
  slots: SlotMap;
  extras: string[];
  pending: PendingState;
  review: ReviewState;
}

/** GET …/research 응답. */
export interface ResearchView extends SessionSnapshot {
  sessionId: string;
  version: number;
  lastSeq: number;
  messages: ChatMessage[];
  photos: PhotoView[];
}

export type TurnInput =
  | { type: "text"; text: string }
  | { type: "quick"; replyId: string }
  | { type: "chip"; slot: SlotKey; value: string }
  | { type: "edit"; slot: SlotKey; text: string }
  | { type: "skip"; slot: SlotKey }
  | { type: "link_check"; url: string };

export interface TurnResponse {
  version: number;
  messages: ChatMessage[];
  session: SessionSnapshot;
  followUp?: { search?: SearchKind } | null;
  ai: AiState;
}

export interface SearchDone {
  messages: ChatMessage[];
  lastSeq: number;
}

export type Outcome<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "accepted" }
  | { kind: "unauthorized" }
  | { kind: "failed"; status: number; error: string; body: Record<string, unknown> };

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store" });
  } catch {
    return { kind: "failed", status: 0, error: "network", body: {} };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 202) return { kind: "accepted" };
  const body = await readBody(response);
  if (response.ok) return { kind: "ok", status: response.status, data: body as T };
  return {
    kind: "failed",
    status: response.status,
    error: typeof body.error === "string" ? body.error : "unknown",
    body,
  };
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function base(requestId: string): string {
  return `/api/volunteer/requests/${encodeURIComponent(requestId)}/research`;
}

/**
 * GET 응답을 화면이 안전하게 쓰는 모양으로 채운다.
 * 보낸 뒤에는 대화가 지워져 `{stage:"sent", sentAt, messages:[], slots:{}, photos:[], extras:[], pending:{}}`만 오므로
 * sessionId·version·purchase·review 같은 값이 없을 수 있다.
 */
export function normalizeView(raw: Partial<ResearchView>): ResearchView {
  return {
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
    version: typeof raw.version === "number" ? raw.version : 0,
    lastSeq: typeof raw.lastSeq === "number" ? raw.lastSeq : 0,
    stage: raw.stage ?? "chat",
    purchase: raw.purchase ?? "unset",
    verified: raw.verified === true,
    slots: raw.slots ?? {},
    extras: raw.extras ?? [],
    pending: raw.pending ?? {},
    review: raw.review ?? {},
    messages: raw.messages ?? [],
    photos: raw.photos ?? [],
  };
}

export async function fetchResearch(requestId: string, after?: number): Promise<Outcome<ResearchView>> {
  const query = after && after > 0 ? `?after=${after}` : "";
  const outcome = await call<Partial<ResearchView>>(`${base(requestId)}${query}`);
  return outcome.kind === "ok" ? { ...outcome, data: normalizeView(outcome.data) } : outcome;
}

export function postTurn(
  requestId: string,
  body: { clientTurnId: string; sessionId: string; baseVersion: number; input: TurnInput },
): Promise<Outcome<TurnResponse>> {
  return call<TurnResponse>(`${base(requestId)}/turn`, json("POST", body));
}

export function postSearch(
  requestId: string,
  body: { sessionId: string; kind: SearchKind; round?: number },
): Promise<Outcome<SearchDone>> {
  return call<SearchDone>(`${base(requestId)}/search`, json("POST", body));
}

export function postPhoto(
  requestId: string,
  body: { sessionId: string; image: string; thumb: string },
): Promise<Outcome<{ photo: PhotoView; messages: ChatMessage[]; session?: SessionSnapshot; version?: number }>> {
  return call(`${base(requestId)}/photos`, json("POST", body));
}

export function deletePhoto(requestId: string, photoId: string): Promise<Outcome<{ session: SessionSnapshot; version?: number }>> {
  return call(`${base(requestId)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
}

export function postReview(
  requestId: string,
  body: { sessionId: string },
): Promise<Outcome<{ review: ReviewState; version: number; ai: AiState }>> {
  return call(`${base(requestId)}/review`, json("POST", body));
}

export function putReview(
  requestId: string,
  body: { sessionId: string; baseVersion: number; text: string },
): Promise<Outcome<{ review: ReviewState; version: number }>> {
  return call(`${base(requestId)}/review`, json("PUT", body));
}

export function postSend(
  requestId: string,
  body: { sessionId: string; baseVersion: number; reviewRev: number },
): Promise<Outcome<{ status: "done"; sentAt: string }>> {
  return call(`${base(requestId)}/send`, json("POST", body));
}

export function newTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ----- 순수 병합 규칙 -----

/** seq 기준으로 합친다(같은 seq는 새 것이 이긴다). 오름차순. */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const bySeq = new Map<number, ChatMessage>();
  for (const message of current) bySeq.set(message.seq, message);
  for (const message of incoming) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function maxSeq(messages: readonly ChatMessage[], floor = 0): number {
  return messages.reduce((top, message) => Math.max(top, message.seq), floor);
}

export function snapshotOf(view: ResearchView): SessionSnapshot {
  return {
    stage: view.stage,
    purchase: view.purchase,
    verified: view.verified,
    slots: view.slots,
    extras: view.extras,
    pending: view.pending,
    review: view.review,
  };
}

/** 응답의 칸·구매 상태를 화면 상태에 덮어쓴다. */
export function applySnapshot(view: ResearchView, session: SessionSnapshot | undefined, version?: number): ResearchView {
  if (!session) return typeof version === "number" ? { ...view, version } : view;
  return { ...view, ...session, version: typeof version === "number" ? version : view.version };
}

export function isStaleFailure(outcome: Outcome<unknown>): boolean {
  return (
    outcome.kind === "failed" &&
    outcome.status === 409 &&
    (outcome.error === "stale" || outcome.error === "session_changed")
  );
}
