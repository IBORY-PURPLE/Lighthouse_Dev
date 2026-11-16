import { NextResponse, type NextRequest } from "next/server";
import { readTurns } from "@/lib/converse";
import { interpretTurn } from "@/lib/converseModel";
import { converseTurn, isLlmConfigured, LlmError } from "@/lib/llm";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";

// 이용자 AI 대화 한 턴. TSD §8.9. 서버는 대화를 저장하지 않는다(무상태): 브라우저가 대화 기록 전체를 보낸다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 대화 30턴(한글 3바이트)과 JSON 틀이 들어갈 만큼. */
const MAX_BODY_BYTES = 16_384;
/** maxDuration에 강제로 끊기기 전에 끝내서 브라우저가 정상적인 오류를 받게 한다. */
const LLM_BUDGET_MS = 28_000;
const NO_STORE = { "Cache-Control": "no-store" };

// 유료 호출을 막는 수단이 이것뿐이다. 대화 한 번이 5~8턴이라 주소당 분당 12회로 둔다.
const checkRateLimit = createRateLimiter({ limit: 12, windowMs: 60_000 });

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/** 크기를 밝히지 않은 본문도 있으므로 읽으면서 끊는다. */
async function readLimitedText(request: NextRequest): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(pieces).toString("utf8");
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    pieces.push(value);
  }
}

async function readBody(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, error: "too_long" } as const;
  try {
    const raw = await readLimitedText(request);
    if (raw === null) return { ok: false, error: "too_long" } as const;
    const body = JSON.parse(raw) as { messages?: unknown } | null;
    return readTurns(body?.messages);
  } catch {
    return { ok: false, error: "invalid_request" } as const;
  }
}

async function handleConverse(
  request: NextRequest,
  note: (text: string) => void,
): Promise<Response> {
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "rate_limited", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const body = await readBody(request);
  if (!body.ok) return failure(400, body.error);

  if (!isLlmConfigured()) return failure(503, "not_configured");

  let raw: string;
  try {
    raw = await converseTurn(
      body.turns,
      AbortSignal.any([request.signal, AbortSignal.timeout(LLM_BUDGET_MS)]),
    );
  } catch (error) {
    // 상위 AI 서버의 상태 코드만 남긴다(본문·키·이용자 문장은 남기지 않는다).
    const upstream = error instanceof LlmError ? error.upstreamStatus : undefined;
    note(` upstream=${upstream ?? "none"}`);
    if (error instanceof LlmError && error.kind === "rate_limited") {
      return failure(429, "rate_limited", { "Retry-After": "60" });
    }
    return failure(502, "llm_failed");
  }

  const verdict = interpretTurn(raw, body.turns);
  if (!verdict.ok) {
    note(` rejected=${verdict.reason}`);
    return failure(502, "llm_failed");
  }
  return NextResponse.json(verdict.result, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let extra = "";
  const response = await handleConverse(request, (text) => {
    extra += text;
  });
  // 이용자 문장과 AI 답은 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `POST /api/requests/converse ${response.status} ${Date.now() - startedAt}ms${extra}`,
  );
  return response;
}
