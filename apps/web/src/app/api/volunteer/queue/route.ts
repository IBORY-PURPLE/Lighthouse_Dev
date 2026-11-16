import type { NextRequest } from "next/server";
import { getRequestStore } from "@/lib/requestStore";
import { runVolunteerRoute, succeed } from "@/lib/volunteerApi";
import { VOLUNTEER_MESSAGES } from "@/lib/volunteerView";

// 목록: 대기 요청, 내가 맡은 1건, 이 기기에서 보낸 요청. 화면을 열 때·탭을 바꿀 때·새로고침을 누를 때만 부른다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return runVolunteerRoute(request, "queue", async ({ volunteerId }) => {
    const store = getRequestStore();
    const data = await store.listQueue(volunteerId);
    // 목록을 읽다가 메모리로 떨어질 수 있으므로 읽은 뒤에 본다.
    const persistent = store.volunteerPersistent;
    // 임시 저장소 안내는 배포 환경에서만. 로컬·시험에서는 늘 메모리라 보이지 않는다.
    const notice = !persistent && process.env.VERCEL === "1" ? VOLUNTEER_MESSAGES.tempStore : null;
    return succeed({ ...data, persistent, notice });
  });
}
