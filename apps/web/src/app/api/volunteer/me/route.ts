import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
import { logLine, succeed } from "@/lib/volunteerApi";
import { requireVolunteer } from "@/lib/volunteerSession";

// 이 기기가 이미 입장했는지, 입장 코드를 다시 물어야 하는지. 입장 전에도 부를 수 있다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const startedAt = Date.now();
  const response = succeed({
    entered: requireVolunteer(request) !== null,
    needsCode: !hasAccess(request.cookies.get(ACCESS_COOKIE)?.value),
  });
  logLine("GET", "me", response.status, startedAt);
  return response;
}
