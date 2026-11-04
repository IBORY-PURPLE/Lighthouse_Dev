import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
import { getLlmMode } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET(request: NextRequest) {
  if (!hasAccess(request.cookies.get(ACCESS_COOKIE)?.value)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      groqKeyConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
      llmMode: getLlmMode(),
    },
    { headers: NO_STORE },
  );
}
