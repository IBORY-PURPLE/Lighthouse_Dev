import "server-only";
import type { NextResponse } from "next/server";
import { readRequestDetails } from "./requestDetails";
import { getRequestStore } from "./requestStore";
import { guardResponse } from "./researchApi";
import { hasUnresolvedCheck, isPastQuestionSeven, requiredMissing, type ResearchView } from "./researchSession";
import { getResearchStore, type GuardFail } from "./researchStore";
import type { RequestDetailsView } from "./volunteerView";

// 사진·리뷰·보내기 라우트 공통 도우미(A4). 세션을 읽고 소유와 sessionId를 확인한다.

/** DB 정수 열 최대값. open의 after로 주면 메시지는 읽지 않는다. */
const AFTER_NONE = 2_147_483_647;

export type Loaded =
  | { ok: true; view: ResearchView }
  | { ok: false; outcome: GuardFail; response: NextResponse };

/**
 * 세션을 읽고 소유(요청 in_progress, 내 요청)와 sessionId를 확인한다.
 * withMessages면 대화 메시지(최대 500개)와 사진 썸네일까지 읽고, 아니면 칸·상태만 읽는다.
 * sessionId가 null이면 세션 번호는 대조하지 않는다(DELETE가 본문 없이 불린다).
 */
export async function loadSession(
  requestId: string,
  volunteerId: string,
  sessionId: string | null,
  withMessages = false,
): Promise<Loaded> {
  const opened = await getResearchStore().open(requestId, volunteerId, withMessages ? null : AFTER_NONE);
  if (opened.outcome !== "ok") return { ok: false, outcome: opened.outcome, response: guardResponse(opened.outcome) };
  if (sessionId !== null && opened.view.sessionId !== sessionId.toLowerCase()) {
    return { ok: false, outcome: "session_changed", response: guardResponse("session_changed") };
  }
  return { ok: true, view: opened.view };
}

/** 리뷰를 만들고 검수를 마칠 수 있나: 필수가 다 찼고 질문 7을 지났고 확인할 것이 없다. 아니면 409 이유. */
export function notReady(view: ResearchView): { error: "missing_required"; missing: string[] } | { error: "not_ready" } | null {
  const missing = requiredMissing(view);
  // 구매함이면 칸 표시만이 아니라 실제 사진이 1장 이상 있어야 한다(저장소의 보내기 규칙과 같다).
  if (view.purchase === "bought" && view.photos.length === 0 && !missing.includes("photo")) missing.push("photo");
  if (missing.length > 0) return { error: "missing_required", missing };
  // "질문 7을 지났다"는 A1·A2가 정한 뜻 그대로다: 물을 수 있고 아직 안 물은 칸이 없다(칸을 봉사자가 먼저 채워 물을 것이 없어도 지난 것이다).
  if (!isPastQuestionSeven(view) || hasUnresolvedCheck(view.pending)) return { error: "not_ready" };
  return null;
}

export interface RequestText {
  product: string;
  brand: string | null;
  item: string | null;
  /** 이용자가 확인한 요약과 질문·답. withNeeds를 켠 호출에서만, 진행 중인 요청에만 채운다. */
  needs?: RequestDetailsView | null;
}

/**
 * 저장소의 요청 글(화면이 준 값은 쓰지 않는다). 못 읽으면 빈 글.
 * withNeeds: 리뷰 문단 AI에 이용자 조건을 줄 때만 켠다(그 호출은 store:false).
 */
export async function requestText(requestId: string, volunteerId: string, withNeeds = false): Promise<RequestText> {
  const found = await getRequestStore()
    .getForVolunteer(requestId, volunteerId)
    .catch(() => null);
  if (!found || found.kind !== "ok") return { product: "", brand: null, item: null };
  const text: RequestText = { product: found.request.product, brand: found.request.brand, item: found.request.item };
  if (withNeeds) {
    text.needs = found.request.status === "in_progress" ? await readRequestDetails(requestId) : null;
  }
  return text;
}
