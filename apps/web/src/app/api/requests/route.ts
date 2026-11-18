import { NextResponse, type NextRequest } from "next/server";
import { applyDeviceCookie, resolveDevice } from "@/lib/deviceSession";
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
  type DeviceListItem,
  type RegisterResult,
} from "@/lib/requestStore";
import type { RequestDetailsView } from "@/lib/volunteerView";

// 플로우 A 접수와 이 기기의 요청 목록. TSD §8.4, notes-flow-a.md C4(검사 순서).
// 기기 쿠키(lh_device)가 없거나 틀리면 접수·목록 응답에서 새로 심는다. 이용자는 코드를 입력하지 않는다.
// 본문의 details(이용자가 확인한 요약과 질문·답)는 선택이다. 잘못된 details는 무시하고 접수는 그대로 된다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ANSWER_LENGTH = 200;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkRateLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });
const checkListRateLimit = createRateLimiter({ limit: 60, windowMs: 60_000 });

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

async function handleRegister(request: NextRequest, deviceId: string | null): Promise<Outcome> {
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

  // 품목 사전(헤드셋)에 없는 물건도 받는다. item은 사전으로 알아본 것만 채우고 나머지는 null이다(2026-11-18 이용자 결정 A6).
  const { brand, item } = parseRequest(product);

  const startedAt = Date.now();
  let result: RegisterResult;
  try {
    result = await getRequestStore().register({
      ...answers,
      brand,
      item,
      conditionKind: normalizeCondition(condition),
      deviceId,
    });
  } catch {
    return {
      response: failure(503, "store_unavailable"),
      storeMs: Date.now() - startedAt,
    };
  }
  // 같은 접수 id를 다른 기기가 보내면 그 행의 번호·상태를 알려 주지 않는다(같은 기기의 재전송과 기기 없는 옛 행은 그대로).
  if (result.outcome === "existing" && deviceId) {
    try {
      if (!(await getRequestStore().getForDevice(result.requestId, deviceId))) {
        return { response: failure(409, "conflict"), storeMs: Date.now() - startedAt };
      }
    } catch {
      return { response: failure(503, "store_unavailable"), storeMs: Date.now() - startedAt };
    }
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
  const device = resolveDevice(request);
  const { response, storeMs, detailsLog } = await handleRegister(request, device.deviceId);
  applyDeviceCookie(response, request, device);
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

function toListItem(row: DeviceListItem) {
  return {
    requestId: row.requestId,
    queueNumber: row.queueNumber,
    status: row.status,
    product: row.product,
    createdAt: row.createdAt,
    // 끝난 요청이면 봉사자가 보낸 리뷰 문단과 보낸 시각(단건 조회와 같은 규칙).
    ...(row.status === "done" ? { review: row.review ?? null, sentAt: row.sentAt ?? null } : {}),
  };
}

// 이 기기가 접수한 요청만 최신순 20건. 다른 기기의 요청은 어떤 경우에도 담기지 않는다.
async function handleList(request: NextRequest, deviceId: string | null): Promise<Outcome> {
  const limit = checkListRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return {
      response: failure(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) }),
    };
  }
  // 기기를 구분할 수 없으면(서명 비밀 없음) 목록을 만들 수 없다. 빈 목록(200)을 주면 화면이 기록을 지우므로 503으로 알린다.
  if (!deviceId) return { response: failure(503, "not_configured") };
  const startedAt = Date.now();
  const store = getRequestStore();
  let rows: DeviceListItem[];
  try {
    rows = await store.listByDevice(deviceId);
  } catch {
    return { response: failure(503, "store_unavailable"), storeMs: Date.now() - startedAt };
  }
  return {
    // complete: 이 목록이 이 기기의 요청 전부일 때만 true(저장소가 DB일 때). false면 화면은 서버가 주지 않은 번호의 기록을 지우지 않는다.
    response: NextResponse.json(
      { items: rows.map(toListItem), complete: store.persistent },
      { headers: NO_STORE },
    ),
    storeMs: Date.now() - startedAt,
  };
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const device = resolveDevice(request);
  const { response, storeMs } = await handleList(request, device.deviceId);
  applyDeviceCookie(response, request, device);
  if (storeMs !== undefined) {
    response.headers.set("Server-Timing", `store;dur=${storeMs}`);
  }
  // 상품명과 기기 ID는 남기지 않는다. 상태 코드와 소요 시간만.
  console.info(
    `GET /api/requests ${response.status} ${Date.now() - startedAt}ms` +
      (storeMs !== undefined ? ` store=${storeMs}ms` : ""),
  );
  return response;
}
