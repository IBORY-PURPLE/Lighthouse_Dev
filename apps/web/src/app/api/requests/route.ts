import { NextResponse, type NextRequest } from "next/server";
import { parseRequest } from "@/lib/parseRequest";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import {
  getRequestStore,
  normalizeCondition,
  type RegisterResult,
} from "@/lib/requestStore";

// 플로우 A 접수. TSD §8.4, notes-flow-a.md C4(검사 순서).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ANSWER_LENGTH = 200;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkRateLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });

interface Outcome {
  response: NextResponse;
  storeMs?: number;
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
}

async function readAnswers(request: NextRequest): Promise<Answers | null> {
  let body: unknown;
  try {
    body = await request.json();
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

  const answers = await readAnswers(request);
  if (!answers) return { response: failure(400, "invalid_request") };
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
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const { response, storeMs } = await handleRegister(request);
  if (storeMs !== undefined) {
    response.headers.set("Server-Timing", `store;dur=${storeMs}`);
  }
  // 이용자 답은 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `POST /api/requests ${response.status} ${Date.now() - startedAt}ms` +
      (storeMs !== undefined ? ` store=${storeMs}ms` : ""),
  );
  return response;
}
