import type { NextRequest } from "next/server";
import { parseResultBody, RESULT_LIMITS } from "@/lib/resultInput";
import { getRequestStore } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 보내기: 지금 맡은 봉사자가 확인한 후보(1~3개)를 결과로 저장하고 요청을 완료한다.
// 같은 봉사자가 다시 보내면 처음 저장한 결과와 보낸 시각을 그대로 돌려준다(200).
// 이미지, 읽은 글자, 근거 문장은 받지 않는다(검사를 통과한 이름·링크·가이드·요약 항목만 저장).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(request, "requests/[id]/result", async ({ volunteerId }) => {
    if (!isUuid(requestId)) return fail(400, "invalid_request");

    let text: string;
    try {
      text = await request.text();
    } catch {
      return fail(400, "invalid_request");
    }
    if (text.length > RESULT_LIMITS.bodyMax) return fail(400, "too_long");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, "invalid_request");
    }
    const checked = parseResultBody(body);
    if (!checked.ok) return fail(400, checked.error);

    const id = requestId.toLowerCase();
    const outcome = await getRequestStore().complete(id, volunteerId, checked.candidates);
    if (!("sentAt" in outcome)) {
      return outcome.outcome === "not_found" ? fail(404, "not_found") : fail(403, "not_yours");
    }
    return succeed(
      { requestId: id, status: "done", sentAt: outcome.sentAt },
      outcome.outcome === "completed" ? 201 : 200,
    );
  });
}
