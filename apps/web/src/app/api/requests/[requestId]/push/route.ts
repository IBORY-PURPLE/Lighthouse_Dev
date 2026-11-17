import { NextResponse, type NextRequest } from "next/server";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore } from "@/lib/requestStore";
import { readJsonBody } from "@/lib/researchApi";
import { parseSubscription, pushPublicKey, savePushSubscription } from "@/lib/webPush";

// 이용자 기기의 웹 푸시 구독을 요청에 붙인다(A13). 리뷰를 보내면 이 구독으로 알림을 한 번 보낸다.
// 요청 번호(UUID)를 가진 기기만 부를 수 있다. 아직 끝나지 않은(waiting·in_progress) 요청만 받는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });

function failure(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!checkRateLimit(clientKey(request.headers)).allowed) return failure(429, "rate_limited");
  if (!UUID.test(requestId)) return failure(400, "invalid_request");
  if (!pushPublicKey()) return failure(404, "not_configured");
  const raw = await readJsonBody(request, 4096);
  if (!raw.ok) return failure(raw.status, raw.error);
  const subscription = parseSubscription(raw.value);
  if (!subscription) return failure(400, "invalid_subscription");
  const id = requestId.toLowerCase();
  try {
    const row = await getRequestStore().get(id);
    if (!row) return failure(404, "not_found");
    if (row.status !== "waiting" && row.status !== "in_progress") return failure(409, "request_closed");
    await savePushSubscription(id, subscription);
  } catch {
    return failure(503, "store_unavailable");
  }
  return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });
}
