import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
import { getExtractEngine } from "@/lib/extract";
import { getLlmMode } from "@/lib/llm";
import { getRequestStore } from "@/lib/requestStore";

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
      llmKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      llmMode: getLlmMode(),
      store: getRequestStore().storeKind(),
      // 엔진 이름만 돌려준다. 키 값은 돌려주지 않는다(TSD §8.1).
      extractEngine: getExtractEngine(),
    },
    { headers: NO_STORE },
  );
}
