import { NextResponse } from "next/server";

export const runtime = "nodejs";

// QA 기간에는 접근 코드가 없다. 이미 퍼진 옛 링크(/enter?code=...)가 깨지지 않게 코드는 읽지 않고 /로 보낸다.
// 되돌리려면 이 변경을 revert한다.
export function GET() {
  return new NextResponse(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      Location: "/",
    },
  });
}
