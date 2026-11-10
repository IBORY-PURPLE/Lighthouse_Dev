import { NextResponse, type NextRequest } from "next/server";
import { volunteerCookie } from "@/lib/volunteerAuth";

// 봉사자 로그아웃. 그 기기의 쿠키만 지운다. TSD §8.9.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  const startedAt = Date.now();
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(
    volunteerCookie("", {
      secure:
        request.nextUrl.protocol === "https:" || process.env.VERCEL === "1",
      maxAge: 0,
    }),
  );
  console.info(`POST /api/auth/logout 200 ${Date.now() - startedAt}ms`);
  return response;
}
