import type { NextRequest } from "next/server";
import { hashPhotoSecret, newPhotoSecret } from "@/lib/photoLink";
import { guardResponse, readJsonBody } from "@/lib/researchApi";
import { getResearchStore } from "@/lib/researchStore";
import { createRateLimiter } from "@/lib/rateLimit";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 노트북이 휴대폰 사진 링크를 만들고(POST) 끊는다(DELETE)(design.md 3.3). lh_vol 필요.
// POST는 새 토큰을 만든다. 토큰 원문은 이 응답에만 있고(QR 주소의 #t=), 저장소에는 sha256만 남는다. 앞 링크는 끊긴다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 새 링크 만들기는 봉사자 ID별 분당 6번. */
const checkIssueLimit = createRateLimiter({ limit: 6, windowMs: 60_000 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(
    request,
    "requests/[id]/research/photo-link",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const raw = await readJsonBody(request, 1024);
      if (!raw.ok) return fail(raw.status, raw.error);
      const sessionId = (raw.value as { sessionId?: unknown } | null)?.sessionId;
      if (typeof sessionId !== "string" || !isUuid(sessionId)) return fail(400, "invalid_request");
      const token = newPhotoSecret();
      const out = await getResearchStore().issuePhotoLink(
        { requestId: requestId.toLowerCase(), volunteerId, sessionId: sessionId.toLowerCase() },
        hashPhotoSecret(token),
      );
      if (out.outcome === "ok") return succeed({ token, expiresAt: out.expiresAt }, 201);
      if (out.outcome === "photo_not_needed") return fail(409, "photo_not_needed");
      if (out.outcome === "photos_full") return fail(409, "photos_full");
      if (out.outcome === "bad_request") return fail(400, "invalid_request");
      return guardResponse(out.outcome);
    },
    (volunteerId) => checkIssueLimit(volunteerId),
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  return runVolunteerRoute(request, "requests/[id]/research/photo-link", async ({ volunteerId }) => {
    if (!isUuid(requestId)) return fail(400, "invalid_request");
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    if (!sessionId || !isUuid(sessionId)) return fail(400, "invalid_request");
    const out = await getResearchStore().revokePhotoLinks({
      requestId: requestId.toLowerCase(),
      volunteerId,
      sessionId: sessionId.toLowerCase(),
    });
    if (out.outcome === "ok") return succeed({ revoked: out.revoked });
    if (out.outcome === "bad_request") return fail(400, "invalid_request");
    return guardResponse(out.outcome);
  });
}
