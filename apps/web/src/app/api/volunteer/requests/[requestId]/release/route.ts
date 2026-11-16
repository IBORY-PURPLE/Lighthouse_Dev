import type { NextRequest } from "next/server";
import { getRequestStore } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 내려놓기: 내가 맡은 요청을 대기열로 돌려놓는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(request, "requests/[id]/release", async ({ volunteerId }) => {
    if (!isUuid(requestId)) return fail(400, "invalid_request");
    const id = requestId.toLowerCase();
    const outcome = await getRequestStore().release(id, volunteerId);
    if (outcome === "not_found") return fail(404, "not_found");
    if (outcome === "not_yours") return fail(403, "not_yours");
    return succeed({ requestId: id, status: "waiting" });
  });
}
