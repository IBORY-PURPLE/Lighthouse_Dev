import { NextResponse, type NextRequest } from "next/server";
import { fail, logLine } from "@/lib/volunteerApi";
import {
  cookieSecure,
  issueDeviceCookie,
  readVolunteerId,
  VOLUNTEER_COOKIE,
  VOLUNTEER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/volunteerSession";

// 입장: 코드도 별명도 없이 기기 열쇠 쿠키(lh_vol)를 심는다(QA 기간). 봉사자 화면이 처음 열릴 때 스스로 부른다.
// 이미 맞는 쿠키가 있는 기기는 새로 심지 않아 같은 ID(맡은 요청)를 유지한다.
// DEMO_ACCESS_CODE는 코드 입력용이 아니라 쿠키 서명 비밀이다(없으면 503 not_configured).
// 추측할 코드가 없으므로 횟수 제한도 없다. 쿠키만 심고 저장소와 AI를 부르지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handle(request: NextRequest): NextResponse {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  if (readVolunteerId(request.cookies.get(VOLUNTEER_COOKIE)?.value)) return response;
  const device = issueDeviceCookie();
  if (!device) return fail(503, "not_configured");
  response.cookies.set({
    name: VOLUNTEER_COOKIE,
    value: device,
    httpOnly: true,
    secure: cookieSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: VOLUNTEER_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export function POST(request: NextRequest) {
  const startedAt = Date.now();
  const response = handle(request);
  logLine("POST", "enter", response.status, startedAt);
  return response;
}
