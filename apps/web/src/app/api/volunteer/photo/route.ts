import type { NextRequest } from "next/server";
import { runPhotoGrantRoute } from "@/lib/photoLinkApi";
import { uploadPhoto } from "@/lib/researchPhotoUpload";
import { succeed } from "@/lib/volunteerApi";

// 휴대폰 사진 올리기(design.md 3.3). 봉사자 쿠키(lh_vol)가 아니라 사진 올리기 열쇠(lh_photo)로 연다.
// GET: 열쇠가 살아 있으면 200(휴대폰 화면이 먼저 부른다). 아니면 410 expired_or_revoked.
// POST: 사진 한 장. 요청·세션은 열쇠가 가리키는 것을 쓰고 본문의 값은 믿지 않는다. 응답은 대화 내용 없이 {ok:true}만 준다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runPhotoGrantRoute(request, "photo", async ({ expiresAt }) => succeed({ ok: true, expiresAt }));
}

export async function POST(request: NextRequest) {
  return runPhotoGrantRoute(request, "photo", async ({ requestId, volunteerId, sessionId, grantHash }) => {
    const response = await uploadPhoto(request, { requestId, volunteerId, sessionId, grantHash });
    return response.status === 201 ? succeed({ ok: true }, 201) : response;
  });
}
