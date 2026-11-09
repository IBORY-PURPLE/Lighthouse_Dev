import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
import { ExtractError, extractText } from "@/lib/extract";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { VOLUNTEERS } from "@/lib/volunteers";

// ④ 조각 하나의 글자를 읽는다. 상태가 없다. TSD §8.7.
// 이미지와 읽은 글자는 저장하지도 로그에 남기지도 않는다. 로그는 상태·시간·조각 번호만(TSD §8).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PIECE_COUNT = 30;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
/** base64는 4/3배로 커진다. JSON 나머지 칸 몫을 조금 더한다. */
const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,/;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * 분당 60회(AI 결정: 조각 30개를 2분 안에 보낼 수 있어야 한다).
 * rateLimit.ts는 서버 메모리라 Vercel 인스턴스마다 따로 센다(완화 수단).
 */
const checkRateLimit = createRateLimiter({ limit: 60, windowMs: 60_000 });

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

function decodedBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

type PieceRequest = { pieceIndex: number; pieceCount: number; image: string };

async function readPiece(
  request: NextRequest,
): Promise<PieceRequest | { status: number; error: string }> {
  const invalid = { status: 400, error: "invalid_request" };
  const tooLarge = { status: 413, error: "image_too_large" };
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return tooLarge;
  }
  let body: Record<string, unknown>;
  try {
    const raw = await readLimitedText(request);
    if (raw === null) return tooLarge;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return invalid;
    body = parsed as Record<string, unknown>;
  } catch {
    return invalid;
  }
  const { requestId, pieceIndex, pieceCount, image } = body;
  if (
    typeof requestId !== "string" ||
    !UUID.test(requestId) ||
    !Number.isInteger(pieceCount) ||
    !Number.isInteger(pieceIndex) ||
    typeof image !== "string"
  ) {
    return invalid;
  }
  const count = pieceCount as number;
  const index = pieceIndex as number;
  if (count < 1 || count > MAX_PIECE_COUNT || index < 0 || index >= count) {
    return invalid;
  }
  if (!IMAGE_DATA_URL.test(image)) return { status: 415, error: "bad_image_format" };
  if (decodedBytes(image) > MAX_IMAGE_BYTES) return tooLarge;
  return { pieceIndex: index, pieceCount: count, image };
}

async function handle(
  request: NextRequest,
  onPiece: (pieceIndex: number) => void,
): Promise<Response> {
  if (!hasAccess(request.cookies.get(ACCESS_COOKIE)?.value)) {
    return failure(401, "unauthorized");
  }
  const volunteerId = request.headers.get("x-demo-volunteer");
  if (!VOLUNTEERS.some((volunteer) => volunteer.id === volunteerId)) {
    return failure(403, "unknown_volunteer");
  }
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "rate_limited", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const piece = await readPiece(request);
  if ("error" in piece) return failure(piece.status, piece.error);
  onPiece(piece.pieceIndex);

  const startedAt = Date.now();
  try {
    const result = await extractText({ ...piece, signal: request.signal });
    return NextResponse.json(
      {
        pieceIndex: piece.pieceIndex,
        text: result.text,
        lowConfidence: result.lowConfidence,
        engine: result.engine,
      },
      {
        headers: {
          ...NO_STORE,
          "Server-Timing": `engine;dur=${Date.now() - startedAt}`,
        },
      },
    );
  } catch (error) {
    const kind = error instanceof ExtractError ? error.kind : "failed";
    switch (kind) {
      case "not_configured":
        return failure(503, "not_configured");
      case "no_text":
        return failure(422, "no_text");
      case "rate_limited":
        return failure(429, "rate_limited", { "Retry-After": "30" });
      default:
        return failure(502, "extract_failed");
    }
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let pieceIndex: number | null = null;
  const response = await handle(request, (index) => {
    pieceIndex = index;
  });
  console.info(
    `POST /api/volunteer/extract-text ${response.status} piece=${pieceIndex ?? "-"} ${Date.now() - startedAt}ms`,
  );
  return response;
}
