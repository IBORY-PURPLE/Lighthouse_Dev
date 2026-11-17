import type { NextRequest } from "next/server";
import { logTail } from "@/lib/researchApi";
import { uploadPhoto } from "@/lib/researchPhotoUpload";
import { runVolunteerRoute } from "@/lib/volunteerApi";

// 구매 인증 사진 올리기, 노트북(lh_vol) 쪽(design.md 3.2, 4.7). 본문 검사·저장·말풍선·다음 질문은 휴대폰 올리기와 같이 쓰는
// lib/researchPhotoUpload.ts에 있다. 세션은 본문의 sessionId를 따른다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const tail = logTail({ kind: "photo", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/photos",
    ({ volunteerId }) => uploadPhoto(request, { requestId, volunteerId, sessionId: null, grantHash: null }),
    undefined,
    () => tail,
  );
}
