import type { NextRequest } from "next/server";
import { guardResponse, logTail, researchPayload } from "@/lib/researchApi";
import { getResearchStore } from "@/lib/researchStore";
import { getRequestStore, StoreUnavailableError } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 대화 읽기(design.md 3.2). `?after` 없이 부르면 세션을 만들고(E1 히어로, 메시지 없음), `?after=<seq>`면 읽기만 한다(폴링).
// 보낸 뒤에는 DB 트리거가 대화를 지우므로, 열기가 not_in_progress를 주면 결과를 보고 {stage:"sent", sentAt}만 돌려준다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 휴대폰 사진 링크 상태(design.md 3.3). 마이그레이션 2가 원격에 아직 없어도 대화 읽기는 되도록,
 * 저장소가 이 상태만 못 읽으면 none으로 둔다(링크를 만들 때는 503이 난다).
 */
async function photoLinkOf(requestId: string, volunteerId: string, sessionId: string) {
  try {
    return await getResearchStore().photoLinkState({ requestId, volunteerId, sessionId });
  } catch (error) {
    if (error instanceof StoreUnavailableError) return { state: "none" as const, expiresAt: null };
    throw error;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const tail = logTail({ kind: "get", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const afterRaw = request.nextUrl.searchParams.get("after");
      let after: number | null = null;
      if (afterRaw !== null) {
        if (!/^\d{1,9}$/.test(afterRaw)) return fail(400, "invalid_request");
        after = Number(afterRaw);
      }
      const opened = await getResearchStore().open(id, volunteerId, after);
      if (opened.outcome === "ok") {
        const photoLink = await photoLinkOf(id, volunteerId, opened.view.sessionId);
        return succeed({ ...researchPayload(opened.view), photoLink });
      }
      if (opened.outcome === "not_in_progress") {
        const detail = await getRequestStore().getForVolunteer(id, volunteerId);
        if (detail.kind === "ok" && detail.result) {
          // 화면이 같은 모양으로 읽도록 빈 값을 함께 준다(대화는 보낸 뒤 지워진다).
          return succeed({ stage: "sent", sentAt: detail.result.sentAt, messages: [], slots: {}, photos: [], extras: [], pending: {} });
        }
      }
      return guardResponse(opened.outcome);
    },
    undefined,
    () => tail,
  );
}
