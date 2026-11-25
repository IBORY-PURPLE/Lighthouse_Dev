import type { NextRequest } from "next/server";
import { guardResponse, logTail, sessionSnapshot } from "@/lib/researchApi";
import { loadSession } from "@/lib/researchReviewApi";
import { getResearchStore } from "@/lib/researchStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 사진 지우기(design.md 3.2). 요청 번호와 사진 번호가 모두 맞는 사진만 지운다(저장소가 `id and request_id`로만 지운다).
// 화면은 본문 없이 부르므로 sessionId는 선택이다(있으면 대조한다: ?sessionId=).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string; photoId: string }> },
) {
  const { requestId, photoId } = await params;
  const tail = logTail({ kind: "photo_delete", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/photos/[photoId]",
    async ({ volunteerId }) => {
      if (!isUuid(requestId) || !isUuid(photoId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const sessionParam = request.nextUrl.searchParams.get("sessionId");
      if (sessionParam !== null && !isUuid(sessionParam)) return fail(400, "invalid_request");
      const loaded = await loadSession(id, volunteerId, sessionParam);
      if (!loaded.ok) return loaded.response;

      const removed = await getResearchStore().removePhoto(
        { requestId: id, volunteerId, sessionId: loaded.view.sessionId },
        photoId.toLowerCase(),
      );
      if (removed.outcome === "photo_not_found") return fail(404, "photo_not_found");
      if (removed.outcome !== "ok") return guardResponse(removed.outcome);
      return succeed({ session: sessionSnapshot(removed.session), version: removed.session.version });
    },
    undefined,
    () => tail,
  );
}
