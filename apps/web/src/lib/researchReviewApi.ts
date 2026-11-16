import "server-only";
import type { NextResponse } from "next/server";
import { getRequestStore } from "./requestStore";
import { guardResponse } from "./researchApi";
import type { ResearchView } from "./researchSession";
import { getResearchStore, type GuardFail } from "./researchStore";

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

export interface RequestText {
  product: string;
  brand: string | null;
  item: string | null;
}

/** 저장소의 요청 글(화면이 준 값은 쓰지 않는다). 못 읽으면 빈 글. */
export async function requestText(requestId: string, volunteerId: string): Promise<RequestText> {
  const found = await getRequestStore()
    .getForVolunteer(requestId, volunteerId)
    .catch(() => null);
  return found && found.kind === "ok"
    ? { product: found.request.product, brand: found.request.brand, item: found.request.item }
    : { product: "", brand: null, item: null };
}
