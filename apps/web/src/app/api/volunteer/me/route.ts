import type { NextRequest } from "next/server";
import { logLine, succeed } from "@/lib/volunteerApi";
import { requireVolunteer } from "@/lib/volunteerSession";

// 이 기기가 이미 기기 쿠키를 받았는지. 받기 전에도 부를 수 있다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const startedAt = Date.now();
  const response = succeed({ entered: requireVolunteer(request) !== null });
  logLine("GET", "me", response.status, startedAt);
  return response;
}
