import { NextResponse, type NextRequest } from "next/server";
import { getLlmMode } from "@/lib/llm";
import { getRequestStore } from "@/lib/requestStore";
import {
  readVolunteerSession,
  VOLUNTEER_SESSION_COOKIE,
} from "@/lib/volunteerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET(request: NextRequest) {
  if (!readVolunteerSession(request.cookies.get(VOLUNTEER_SESSION_COOKIE)?.value)) {
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
      store: getRequestStore().storeKind(),
    },
    { headers: NO_STORE },
  );
}
