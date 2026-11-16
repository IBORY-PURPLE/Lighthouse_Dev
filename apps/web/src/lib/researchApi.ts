import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { purchaseBadge, SEARCH_PENDING_MS, type ResearchMessage, type ResearchView } from "./researchSession";
import { SKIP_LABEL } from "./researchTurnText";
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

/** 턴 응답이 화면에 이어서 부르라고 알리는 웹 검색(contract-ui.md "턴 응답 followUp"). */
export type FollowUp = { search: "model" | "alts" | "benefits" };

/**
 * 이번 턴 메시지로 화면이 이어서 부를 검색을 정한다. 한 번에 하나만 알리고, 순서는 model, alts, benefits다.
 * - model: 방금 기종 질문을 만들었다.
 * - alts: 방금 같이 고민한 제품 질문(질문 4)을 만들었다(리서치만 고른 경로와 사진 없는 경로. 사진 뒤는 photos 응답 규칙을 따른다).
 * - benefits: 이번 턴에 혜택 경험 칸이 채워졌거나(AI 채움·짧은 답·패널 고치기) 건너뛰어졌다. 칸이 실제로 찬 상태일 때만 알린다.
 *   [확인했어요](link_check)는 칸 값을 바꾸지 않으므로 알리지 않는다.
 * 이미 찾은 검색을 다시 부르면 서버가 캐시로 답하고 사용량을 세지 않는다. 그래서 저장 응답을 다시 보낼 때도 같은 값이면 된다.
 */
export function followUpOf(
  messages: readonly ResearchMessage[],
  slots: Partial<Record<string, { status?: string } | null>>,
  input?: { type: string; slot?: string } | null,
): FollowUp | null {
  const asked = (slot: string) =>
    messages.some((message) => message.role === "ai" && message.tag === "question" && message.slot === slot);
  if (asked("model")) return { search: "model" };
  if (asked("alts")) return { search: "alts" };
  const status = slots.benefits?.status;
  if (status === "filled" || status === "confirmed" || status === "skipped") {
    const skipLabel = SKIP_LABEL.benefits;
    // 패널에서 고친 칸(edit)은 채움 말풍선이 없어 입력으로 알아본다.
    const edited = input?.type === "edit" && input.slot === "benefits";
    const changed = edited || messages.some(
      (message) =>
        (message.role === "ai" && message.tag === "fill" && message.slot === "benefits") ||
        (message.role === "volunteer" && skipLabel !== undefined && message.body?.text === skipLabel),
    );
    if (changed) return { search: "benefits" };
  }
  return null;
}
