import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  hashAccessCode,
  isValidAccessCode,
} from "@/lib/access";

export const runtime = "nodejs";

// 주소에 코드가 있으므로 캐시와 Referer로 새지 않게 한다.
const NO_LEAK_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code || !isValidAccessCode(code)) {
    return new NextResponse("접근 코드가 올바르지 않습니다.", {
      status: 401,
      headers: {
        ...NO_LEAK_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: { ...NO_LEAK_HEADERS, Location: "/" },
  });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: hashAccessCode(code),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
