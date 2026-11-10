import { NextResponse, type NextRequest } from "next/server";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore, type StoredRequest } from "@/lib/requestStore";

// 다시 열기 조회. TSD §8.4, notes-flow-a.md C4.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkRateLimit = createRateLimiter({ limit: 60, windowMs: 60_000 });

function failure(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, ...body },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

interface Outcome {
  response: NextResponse;
  storeMs?: number;
}

async function handleGet(request: NextRequest, requestId: string): Promise<Outcome> {
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return {
      response: failure(
        429,
        { error: "rate_limited" },
        { "Retry-After": String(limit.retryAfterSeconds) },
      ),
    };
  }

  if (!UUID.test(requestId)) {
    return { response: failure(400, { error: "invalid_request" }) };
  }

  const store = getRequestStore();
  const startedAt = Date.now();
  let row: StoredRequest | null;
  try {
    row = await store.get(requestId.toLowerCase());
  } catch {
    return {
      response: failure(503, { error: "store_unavailable" }),
      storeMs: Date.now() - startedAt,
    };
  }
  const storeMs = Date.now() - startedAt;
  if (!row) {
    // 메모리 저장소면 서버가 바뀌어 못 찾은 것일 수 있다. 클라이언트는 기록을 지우지 않는다.
    return {
      response: failure(404, { error: "not_found", persistent: store.persistent }),
      storeMs,
    };
  }
  return {
    response: NextResponse.json(
      {
        requestId: row.requestId,
        queueNumber: row.queueNumber,
        status: row.status,
        product: row.product,
      },
      { headers: NO_STORE },
    ),
    storeMs,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const startedAt = Date.now();
  const { requestId } = await params;
  const { response, storeMs } = await handleGet(request, requestId);
  if (storeMs !== undefined) {
    response.headers.set("Server-Timing", `store;dur=${storeMs}`);
  }
  // 요청 id와 상품명은 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `GET /api/requests/[id] ${response.status} ${Date.now() - startedAt}ms` +
      (storeMs !== undefined ? ` store=${storeMs}ms` : ""),
  );
  return response;
}
