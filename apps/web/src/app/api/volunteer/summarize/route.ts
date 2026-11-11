import { NextResponse, type NextRequest } from "next/server";
import { checkEvidence } from "@/lib/evidenceCheck";
import { ExtractError, isSummaryConfigured, requestSummaryJson } from "@/lib/extract";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { parseSummaryJson, SUMMARY_TEXT_LIMIT } from "@/lib/summaryDraft";
import { requireVolunteer } from "@/lib/volunteerSession";

// ④ 읽은 글자(또는 봉사자가 입력한 글)로 요약 초안을 만든다. 상태가 없다. TSD §8.8.
// 글과 초안은 저장하지도 로그에 남기지도 않는다.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 4,000자 한글(UTF-8 3바이트) + 신뢰도 낮은 단어 목록 + 나머지 칸. */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PRODUCT_LENGTH = 200;
const MAX_LOW_CONFIDENCE_WORDS = 500;
const MAX_UNREADABLE = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

const checkRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

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

interface SummarizeRequest {
  product: string;
  source: "ocr" | "manual";
  text: string;
  lowConfidence: string[];
  unreadable: number[];
}

/**
 * TSD 요청 모양에 선택 칸 두 개를 더했다(11/9 블록 2 결정, PR 본문에 적음):
 * lowConfidence(조각들의 신뢰도 낮은 단어, 규칙 2용)와 unreadable(못 읽은 조각 번호).
 */
async function readSummarize(
  request: NextRequest,
): Promise<SummarizeRequest | { error: "invalid_request" | "empty_text" | "too_long" }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { error: "too_long" };
  }
  let body: Record<string, unknown>;
  try {
    const raw = await readLimitedText(request);
    if (raw === null) return { error: "too_long" };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { error: "invalid_request" };
    body = parsed as Record<string, unknown>;
  } catch {
    return { error: "invalid_request" };
  }

  const { requestId, context, source, text } = body;
  const lowConfidence = body.lowConfidence ?? [];
  const unreadable = body.unreadable ?? [];
  const product = (context as { product?: unknown } | null)?.product ?? "";
  if (
    typeof requestId !== "string" ||
    !UUID.test(requestId) ||
    (source !== "ocr" && source !== "manual") ||
    typeof text !== "string" ||
    typeof product !== "string" ||
    product.length > MAX_PRODUCT_LENGTH ||
    !Array.isArray(lowConfidence) ||
    lowConfidence.length > MAX_LOW_CONFIDENCE_WORDS ||
    !lowConfidence.every((word) => typeof word === "string") ||
    !Array.isArray(unreadable) ||
    unreadable.length > MAX_UNREADABLE ||
    !unreadable.every((index) => Number.isInteger(index) && index >= 0)
  ) {
    return { error: "invalid_request" };
  }
  const trimmed = text.trim();
  if (!trimmed) return { error: "empty_text" };
  if (trimmed.length > SUMMARY_TEXT_LIMIT) return { error: "too_long" };
  return {
    product: product.trim(),
    source,
    text: trimmed,
    lowConfidence: lowConfidence as string[],
    unreadable: unreadable as number[],
  };
}

async function handle(
  request: NextRequest,
  onUpstreamFailed: (status: number | undefined) => void,
): Promise<Response> {
  // 입장한 기기(lh_vol)만 쓴다. 봉사자 ID는 쓰지 않고 로그에도 남기지 않는다.
  if (!requireVolunteer(request)) return failure(401, "unauthorized");
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "rate_limited", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const body = await readSummarize(request);
  if ("error" in body) return failure(400, body.error);
  if (!isSummaryConfigured()) return failure(503, "not_configured");

  const startedAt = Date.now();
  let raw: string;
  try {
    raw = await requestSummaryJson({
      product: body.product,
      text: body.text,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(28_000)]),
    });
  } catch (error) {
    if (
      error instanceof ExtractError &&
      (error.kind === "failed" || error.kind === "rate_limited")
    ) {
      onUpstreamFailed(error.upstreamStatus);
    }
    if (error instanceof ExtractError && error.kind === "rate_limited") {
      return failure(429, "rate_limited", { "Retry-After": "60" });
    }
    if (error instanceof ExtractError && error.kind === "not_configured") {
      return failure(503, "not_configured");
    }
    return failure(502, "llm_failed");
  }
  const llmMs = Date.now() - startedAt;

  const fields = parseSummaryJson(raw);
  if (!fields) return failure(502, "llm_failed");
  const draft = checkEvidence(fields, body.text, {
    source: body.source,
    lowConfidence: body.lowConfidence,
    unreadable: body.unreadable,
  });
  return NextResponse.json(draft, {
    headers: { ...NO_STORE, "Server-Timing": `llm;dur=${llmMs}` },
  });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  // 요약 AI 호출이 실패했을 때만 채운다(원인 확인용, 상위 서버의 상태 코드만).
  let upstream = "";
  const response = await handle(request, (status) => {
    upstream = ` upstream=${status ?? "none"}`;
  });
  console.info(
    `POST /api/volunteer/summarize ${response.status} ${Date.now() - startedAt}ms${upstream}`,
  );
  return response;
}
