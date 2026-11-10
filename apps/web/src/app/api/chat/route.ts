import { NextResponse, type NextRequest } from "next/server";
import { isChatRequest, MAX_QUESTION_LENGTH } from "@/lib/chat";
import { isLlmConfigured, LlmError, streamAnswer } from "@/lib/llm";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import {
  readVolunteerSession,
  VOLUNTEER_SESSION_COOKIE,
} from "@/lib/volunteerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 2048;
/** maxDuration에 강제로 끊기기 전에 끝내서 브라우저가 정상적인 오류를 받게 한다. */
const LLM_BUDGET_MS = 28_000;
const NO_STORE = { "Cache-Control": "no-store" };

const checkRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });

function failure(
  status: number,
  error: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/** 크기를 밝히지 않은 본문도 있으므로 읽으면서 끊는다. 다 읽은 뒤 재면 이미 메모리에 올라온 뒤다. */
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

async function readChatBody(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return "too_long";

  try {
    const raw = await readLimitedText(request);
    if (raw === null) return "too_long";
    const body: unknown = JSON.parse(raw);
    if (!isChatRequest(body)) return null;
    const question = body.question.trim();
    if (!question) return null;
    if (question.length > MAX_QUESTION_LENGTH) return "too_long";
    return { question, context: body.context };
  } catch {
    return null;
  }
}

/** 첫 글자가 나온 뒤의 실패는 상태 코드를 바꿀 수 없어 스트림 오류로 끝낸다. TSD §8. */
function answerResponse(
  first: string,
  answer: AsyncGenerator<string, void>,
  abort: AbortController,
  onStreamFailed: () => void,
) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(first));
    },
    async pull(controller) {
      try {
        const next = await answer.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch {
        onStreamFailed();
        controller.error(new Error("llm_stream_failed"));
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(body, {
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function handleChat(
  request: NextRequest,
  onStreamFailed: () => void,
): Promise<Response> {
  if (!readVolunteerSession(request.cookies.get(VOLUNTEER_SESSION_COOKIE)?.value)) {
    return failure(401, "unauthorized");
  }

  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "rate_limited", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const body = await readChatBody(request);
  if (body === null) return failure(400, "invalid_request");
  if (body === "too_long") return failure(400, "too_long");

  if (!isLlmConfigured()) return failure(503, "not_configured");

  const abort = new AbortController();
  const answer = streamAnswer({
    ...body,
    signal: AbortSignal.any([
      abort.signal,
      request.signal,
      AbortSignal.timeout(LLM_BUDGET_MS),
    ]),
  });

  try {
    const first = await answer.next();
    if (first.done) return failure(502, "llm_failed");
    return answerResponse(first.value, answer, abort, onStreamFailed);
  } catch (error) {
    if (error instanceof LlmError && error.kind === "rate_limited") {
      return failure(429, "rate_limited", { "Retry-After": "60" });
    }
    return failure(502, "llm_failed");
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt}ms`;
  const response = await handleChat(request, () => {
    console.info(`POST /api/chat stream_failed ${elapsed()}`);
  });
  // 사용자 문장과 답변은 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(`POST /api/chat ${response.status} ${elapsed()}`);
  return response;
}
