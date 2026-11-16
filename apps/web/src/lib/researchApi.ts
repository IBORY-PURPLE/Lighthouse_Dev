import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { purchaseBadge, SEARCH_PENDING_MS, type ResearchMessage, type ResearchView } from "./researchSession";
import type { GuardFail } from "./researchStore";
import { fail } from "./volunteerApi";

// 대화형 리서치 라우트 공통 도우미: 본문 읽기, 응답 모양(design.md 3.2), 오류 본문. 글·사진·ID는 로그에 남기지 않는다.

const NO_STORE = { "Cache-Control": "no-store" };

/** {ok:false, error, ...extra}. 409 stale은 현재 version을 같이 준다. */
export function failWith(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: NO_STORE });
}

/** 저장소의 소유·세션 확인 실패를 HTTP 응답으로(403 not_yours, 404 not_found, 409 not_in_progress·session_changed). */
export function guardResponse(outcome: GuardFail): NextResponse {
  switch (outcome) {
    case "not_found":
      return fail(404, "not_found");
    case "not_yours":
      return fail(403, "not_yours");
    case "not_in_progress":
      return fail(409, "not_in_progress");
    case "session_changed":
      return failWith(409, "session_changed");
  }
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; status: number; error: string };

/** 본문을 maxBytes까지만 읽는다(413: 너무 큼, 400: JSON이 아님, 415: JSON이 아닌 형식). */
export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<JsonBody> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) return { ok: false, status: 415, error: "unsupported_media_type" };
  const tooLarge = { ok: false, status: 413, error: "too_large" } as const;
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  if (!request.body) return { ok: false, status: 400, error: "invalid_request" };
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return tooLarge;
    }
    pieces.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(pieces).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "invalid_request" };
  }
}

export type ResearchStage = "hero" | "chat" | "review" | "sent";

/** 화면 단계: 메시지가 없고 구매가 정해지지 않았으면 히어로, 리뷰가 시작됐으면 review. */
export function stageOf(session: Pick<ResearchView, "lastSeq" | "purchase" | "review">): ResearchStage {
  if (session.review.status) return "review";
  if (session.lastSeq === 0 && session.purchase === "unset") return "hero";
  return "chat";
}

/** 리뷰 상태에서 화면이 볼 것만(confirmedVersion은 서버 안). */
function publicReview(review: ResearchView["review"]) {
  return { status: review.status, text: review.text, rev: review.rev };
}

type SessionLike = Pick<
  ResearchView,
  "lastSeq" | "purchase" | "slots" | "extras" | "pending" | "review" | "counters"
>;

/**
 * 화면에 주는 pending. 검색 중 표시(search = {kind, at})는 시각을 떼고 {kind}만 주고,
 * 검색이 도중에 끊겨 SEARCH_PENDING_MS(90초)보다 오래된 표시는 걸러 낸다(화면이 끝없이 기다리지 않게).
 */
export function visiblePending(pending: ResearchView["pending"], now = Date.now()): ResearchView["pending"] {
  if (!("search" in pending)) return pending;
  const { search, ...rest } = pending;
  if (typeof search !== "object" || search === null) return rest;
  const { kind, at } = search as { kind?: unknown; at?: unknown };
  if (typeof kind !== "string" || typeof at !== "number" || now - at > SEARCH_PENDING_MS) return rest;
  return { ...rest, search: { kind } };
}

/** 칸·구매·검수 상태(턴·사진 응답이 같이 준다). */
export function sessionSnapshot(session: SessionLike) {
  return {
    stage: stageOf(session),
    purchase: session.purchase,
    verified: purchaseBadge(session) === "verified",
    slots: session.slots,
    extras: session.extras,
    pending: visiblePending(session.pending),
    review: publicReview(session.review),
  };
}

/** GET …/research 응답(design.md 3.2). */
export function researchPayload(view: ResearchView) {
  return {
    sessionId: view.sessionId,
    version: view.version,
    lastSeq: view.lastSeq,
    ...sessionSnapshot(view),
    messages: view.messages,
    photos: view.photos.map((photo) => ({
      id: photo.id,
      thumb: photo.thumb,
      description: photo.description,
      seenModel: photo.seenModel,
      shot: photo.shot,
    })),
  };
}

export type AiLabel = "ok" | "fallback" | "capped" | "none";

/** 저장된 응답(같은 turnId 재요청)에서 ai 표시를 거꾸로 읽는다. */
export function labelFromMessages(messages: readonly Pick<ResearchMessage, "ai">[]): AiLabel {
  for (const label of ["capped", "fallback", "ok"] as const) {
    if (messages.some((message) => message.ai === label)) return label;
  }
  return "none";
}

/** 로그 끝에 붙는 글(design.md 3.1). 글·사진·ID·주소는 넣지 않는다. */
export function logTail(parts: {
  kind: string;
  ai: AiLabel;
  cap?: "request" | "daily" | null;
  up?: string | number | null;
  usage?: { in: number; out: number; ws?: number };
}): string {
  const cap = parts.cap ? ` cap=${parts.cap}` : "";
  const up = parts.up !== null && parts.up !== undefined ? ` up=${parts.up}` : "";
  const usage = parts.usage ?? { in: 0, out: 0 };
  return ` kind=${parts.kind} ai=${parts.ai}${cap}${up} in=${usage.in} out=${usage.out} ws=${usage.ws ?? 0}`;
}
