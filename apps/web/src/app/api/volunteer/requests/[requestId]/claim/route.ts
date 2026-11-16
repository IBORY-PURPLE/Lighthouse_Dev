import type { NextRequest } from "next/server";
import { getRequestStore } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 이 요청 맡기. 먼저 누른 1명만 된다(DB 한 문장 갱신). 한 봉사자는 한 번에 1건만 맡는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(request, "requests/[id]/claim", async ({ volunteerId }) => {
    if (!isUuid(requestId)) return fail(400, "invalid_request");
    const id = requestId.toLowerCase();
    const outcome = await getRequestStore().claim(id, volunteerId);
    switch (outcome) {
      case "claimed":
      case "already_mine":
        return succeed({ outcome, requestId: id });
      case "taken":
        return fail(409, "already_claimed");
      case "busy":
        return fail(409, "busy");
      case "not_found":
        return fail(404, "not_found");
    }
  });
}
