import type { NextRequest } from "next/server";
import { demoCandidatesFor } from "@/lib/demoCandidates";
import { getRequestStore } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 요청 상세의 후보. 오늘은 품목별로 사람이 골라 둔 시연용 예시 후보만 준다(demoCandidates.ts).
// 내가 맡은(또는 내가 보낸) 요청의 후보만 볼 수 있다. 품목이 표에 없으면 후보 0개다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(request, "requests/[id]/candidates", async ({ volunteerId }) => {
    if (!isUuid(requestId)) return fail(400, "invalid_request");
    const outcome = await getRequestStore().getForVolunteer(
      requestId.toLowerCase(),
      volunteerId,
    );
    if (outcome.kind === "not_found") return fail(404, "not_found");
    if (outcome.kind === "not_yours") return fail(403, "not_yours");
    return succeed({ source: "demo", candidates: demoCandidatesFor(outcome.request.item) });
  });
}
