import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
import { logLine, refreshAccessCookie, succeed } from "@/lib/volunteerApi";
import { requireVolunteer } from "@/lib/volunteerSession";

// 이 기기가 이미 입장했는지, 입장 코드를 다시 물어야 하는지. 입장 전에도 부를 수 있다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const startedAt = Date.now();
  const entered = requireVolunteer(request) !== null;
  const response = succeed({
    entered,
    needsCode: !hasAccess(request.cookies.get(ACCESS_COOKIE)?.value),
  });
  // 입장한 기기는 접근 쿠키(7일)가 끝났어도 여기서 다시 받는다(AI 질문이 401이 되지 않게).
  if (entered) refreshAccessCookie(request, response);
  logLine("GET", "me", response.status, startedAt);
  return response;
}
