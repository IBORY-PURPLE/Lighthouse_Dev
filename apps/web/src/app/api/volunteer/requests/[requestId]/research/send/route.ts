import type { NextRequest } from "next/server";
import { getRequestStore } from "@/lib/requestStore";
import { failWith, guardResponse, logTail, readJsonBody } from "@/lib/researchApi";
import { buildResultFromSession } from "@/lib/researchResult";
import { loadSession, notReady } from "@/lib/researchReviewApi";
import { getResearchStore } from "@/lib/researchStore";
import { checkCandidate } from "@/lib/resultInput";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 보내기(design.md 3.2, 4.11). 검수를 마친 리뷰와 칸으로 결과를 만들어 research_send로 저장한다(필수·confirmed·version·rev를 저장소가 확인).
// 처음 보내면 201, 다시 보내면 처음 저장한 값으로 200이다. 결과를 쓰는 길은 이 라우트 하나다(옛 POST …/result는 지웠다).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const tail = logTail({ kind: "send", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/send",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const raw = await readJsonBody(request, MAX_BODY_BYTES);
      if (!raw.ok) return fail(raw.status, raw.error);
      const { sessionId, baseVersion, reviewRev } = (raw.value ?? {}) as Record<string, unknown>;
      if (typeof sessionId !== "string" || !isUuid(sessionId) || !isCount(baseVersion) || !isCount(reviewRev)) {
        return fail(400, "invalid_request");
      }

      const loaded = await loadSession(id, volunteerId, sessionId);
      if (!loaded.ok) {
        // 이미 보낸 요청이면 대화는 지워졌다. 다시 보내는 것은 처음 저장한 값을 그대로 돌려준다(200).
        if (loaded.outcome === "not_in_progress") {
          const detail = await getRequestStore().getForVolunteer(id, volunteerId);
          if (detail.kind === "ok" && detail.result) return succeed({ status: "done", sentAt: detail.result.sentAt }, 200);
        }
        return loaded.response;
      }

      // 화면이 본 version·rev와 다르거나 검수가 안 끝났으면 결과를 만들기 전에 막는다(저장소도 같은 확인을 한다).
      const view = loaded.view;
      if (view.version !== baseVersion) return failWith(409, "stale", { version: view.version });
      const blocked = notReady(view);
      if (blocked) return failWith(409, blocked.error, "missing" in blocked ? { missing: blocked.missing } : {});
      if (view.review.status !== "confirmed" || view.review.rev !== reviewRev) return fail(409, "review_not_confirmed");

      // 칸·검수된 문단에서 결과 후보를 만든다. 기종이 비었으면 빈 목록이고 저장소가 missing_required로 막는다.
      const candidates = buildResultFromSession(view);
      for (const candidate of candidates) {
        if (!checkCandidate(candidate).ok) return fail(500, "internal_error");
      }
      const sent = await getResearchStore().send({
        requestId: id,
        volunteerId,
        sessionId: sessionId.toLowerCase(),
        baseVersion,
        reviewRev,
        candidates,
      });
      switch (sent.outcome) {
        case "sent":
          return succeed({ status: "done", sentAt: sent.sentAt }, 201);
        case "existing":
          return succeed({ status: "done", sentAt: sent.sentAt }, 200);
        case "stale":
          return failWith(409, "stale", { version: sent.version });
        case "missing_required":
          return failWith(409, "missing_required", { missing: sent.missing });
        case "review_not_confirmed":
          return fail(409, "review_not_confirmed");
        case "bad_request":
          return fail(500, "internal_error");
        default:
          return guardResponse(sent.outcome);
      }
    },
    undefined,
    () => tail,
  );
}
