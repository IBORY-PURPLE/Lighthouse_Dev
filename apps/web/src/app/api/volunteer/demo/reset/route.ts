import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore } from "@/lib/requestStore";
import { runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 시연 전용: 시연 요청만 지우고 대기 5건과 이 기기의 완료 1건을 새로 채운다. 실제 접수 행은 그대로다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 봉사자 ID별 분당 6회. */
const checkResetLimit = createRateLimiter({ limit: 6, windowMs: 60_000 });

export function POST(request: NextRequest) {
  return runVolunteerRoute(
    request,
    "demo/reset",
    async ({ volunteerId }) => {
      const waiting = await getRequestStore().resetDemo(volunteerId);
      return succeed({ ok: true, waiting });
    },
    checkResetLimit,
  );
}
