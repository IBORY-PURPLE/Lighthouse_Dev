import type { NextRequest } from "next/server";
import { readRequestDetails } from "@/lib/requestDetails";
import { getRequestStore } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 요청 상세. 내가 진행 중인 요청, 또는 내가 보낸 결과가 있는 완료 요청만 볼 수 있다.
// details(이용자가 확인한 요약과 질문·답)는 내가 진행 중인 요청에만 싣는다. 보낸 뒤에는 지워지므로 null이다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(request, "requests/[id]", async ({ volunteerId }) => {
    if (!isUuid(requestId)) return fail(400, "invalid_request");
    const outcome = await getRequestStore().getForVolunteer(
      requestId.toLowerCase(),
      volunteerId,
    );
    if (outcome.kind === "not_found") return fail(404, "not_found");
    if (outcome.kind === "not_yours") return fail(403, "not_yours");
    const details =
      outcome.request.status === "in_progress" ? await readRequestDetails(outcome.request.requestId) : null;
    return succeed({ request: outcome.request, result: outcome.result, details });
  });
}
