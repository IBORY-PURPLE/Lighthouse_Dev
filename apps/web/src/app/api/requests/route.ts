import { NextResponse, type NextRequest } from "next/server";
import { parseRequest } from "@/lib/parseRequest";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { readLimitedText } from "@/lib/readLimited";
import {
  cleanRequestDetails,
  DETAILS_BODY_MAX_BYTES,
  saveRequestDetails,
} from "@/lib/requestDetails";
import {
  getRequestStore,
  normalizeCondition,
  type RegisterResult,
} from "@/lib/requestStore";
import type { RequestDetailsView } from "@/lib/volunteerView";

// 플로우 A 접수. TSD §8.4, notes-flow-a.md C4(검사 순서).
// 본문의 details(이용자가 확인한 요약과 질문·답)는 선택이다. 잘못된 details는 무시하고 접수는 그대로 된다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ANSWER_LENGTH = 200;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkRateLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });

interface Outcome {
  response: NextResponse;
  storeMs?: number;
  /** 로그에 덧붙이는 details 처리 결과(글은 남기지 않는다). */
  detailsLog?: string;
}

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

interface Answers {
  clientRequestId: string;
  product: string;
  budget: string;
  condition: string;
  /** 없으면 undefined, 있는데 쓸 수 없으면 null. */
  details: RequestDetailsView | null | undefined;
}

async function readAnswers(request: NextRequest): Promise<Answers | "too_large" | null> {
  let body: unknown;
  try {
    const raw = await readLimitedText(request, DETAILS_BODY_MAX_BYTES);
    if (raw === null) return "too_large";
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const value = body as Record<string, unknown> | null;
  const fields = [value?.product, value?.budget, value?.condition];
  if (
    typeof value?.clientRequestId !== "string" ||
    !UUID.test(value.clientRequestId) ||
    fields.some((field) => typeof field !== "string" || !field.trim())
  ) {
    return null;
  }
  const [product, budget, condition] = fields as string[];
  return {
    clientRequestId: value.clientRequestId.toLowerCase(),
    product: product.trim(),
    budget: budget.trim(),
    condition: condition.trim(),
    details: value.details === undefined ? undefined : cleanRequestDetails(value.details),
  };
}

async function handleRegister(request: NextRequest): Promise<Outcome> {
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return {
      response: failure(429, "rate_limited", {
        "Retry-After": String(limit.retryAfterSeconds),
      }),
    };
  }

  const read = await readAnswers(request);
  if (read === "too_large") return { response: failure(413, "too_large") };
  if (!read) return { response: failure(400, "invalid_request") };
  const { details, ...answers } = read;
  const { product, budget, condition } = answers;
  if ([product, budget, condition].some((text) => text.length > MAX_ANSWER_LENGTH)) {
    return { response: failure(400, "too_long") };
  }

  const { brand, item } = parseRequest(product);
  if (!item) return { response: failure(422, "need_item") };

  const startedAt = Date.now();
  let result: RegisterResult;
  try {
    result = await getRequestStore().register({
      ...answers,
      brand,
      item,
      conditionKind: normalizeCondition(condition),
    });
  } catch {
    return {
      response: failure(503, "store_unavailable"),
      storeMs: Date.now() - startedAt,
    };
  }
  const storeMs = Date.now() - startedAt;
  // 처음 접수된 대기 요청에만 저장한다. 같은 접수를 다시 보내도 처음 것을 지킨다. 저장하지 못해도 접수는 그대로다.
  let detailsLog = details === undefined ? "none" : details === null ? "ignored" : "none";
  if (details && result.status === "waiting") detailsLog = await saveRequestDetails(result.requestId, details);
  return {
    response: NextResponse.json(
      {
        requestId: result.requestId,
        queueNumber: result.queueNumber,
        status: result.status,
      },
      { status: result.outcome === "created" ? 201 : 200, headers: NO_STORE },
    ),
    storeMs,
    detailsLog,
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const { response, storeMs, detailsLog } = await handleRegister(request);
  if (storeMs !== undefined) {
    response.headers.set("Server-Timing", `store;dur=${storeMs}`);
  }
  // 이용자 답은 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `POST /api/requests ${response.status} ${Date.now() - startedAt}ms` +
      (storeMs !== undefined ? ` store=${storeMs}ms` : "") +
      (detailsLog !== undefined ? ` details=${detailsLog}` : ""),
  );
  return response;
}
