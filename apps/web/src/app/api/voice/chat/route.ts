import { NextResponse, type NextRequest } from "next/server";
import { getLlmMode } from "@/lib/llm";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import {
  callVoiceAI,
  readVoiceBody,
  toQueueRequest,
  type VoiceTurn,
} from "@/lib/voiceChat";

// 이용자 음성 대화 한 턴. apps/user-voice-ui의 /api/chat 계약을 옮겼다(봉사자용 /api/chat과 경로가 겹쳐 /api/voice/chat).
// 서버는 대화를 저장하지 않는다. 화면이 보낸 기록(history)으로 이어 간다. TSD §8.9.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 대화 36칸(AI 답은 JSON 글)과 JSON 틀이 들어갈 만큼. 원본은 12000자였다. */
const MAX_BODY_BYTES = 65_536;
const NO_STORE = { "Cache-Control": "no-store" };

// 공개 주소의 유료 호출을 막는 수단이 이것뿐이다. 원본에는 없던 것이다.
const checkRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
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

async function handleChat(request: NextRequest, note: (text: string) => void) {
  const limit = checkRateLimit(clientKey(request.headers));
  if (!limit.allowed) {
    return failure(429, "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  let raw: string | null;
  try {
    raw = await readLimitedText(request);
  } catch {
    return failure(400, "요청 형식 오류");
  }
  if (raw === null) return failure(400, "요청이 너무 큽니다");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure(400, "요청 형식 오류");
  }

  const body = readVoiceBody(parsed);
  if (!body.ok) return failure(body.status, body.error);

  if (getLlmMode() !== "mock" && !process.env.OPENAI_API_KEY?.trim()) {
    return failure(503, "서버에 OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const next: VoiceTurn[] = [...body.history, { role: "user", content: body.input }];
  try {
    const result = await callVoiceAI(next);
    const queue =
      result.status === "done" ? toQueueRequest(result.product, result.summary) : null;
    if (result.status === "done" && !queue) note(" queue=skipped");
    return NextResponse.json(queue ? { ...result, request: queue } : result, {
      headers: NO_STORE,
    });
  } catch (error) {
    // 이용자 문장과 AI 답은 남기지 않는다. 오류 종류만.
    const aborted = error instanceof Error && error.name === "AbortError";
    note(aborted ? " error=timeout" : " error=failed");
    return failure(
      500,
      aborted
        ? "AI 응답 시간이 초과되었습니다. 다시 시도해 주세요."
        : "AI 요청에 실패했습니다. 서버 설정과 API 사용량을 확인해 주세요.",
    );
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let extra = "";
  const response = await handleChat(request, (text) => {
    extra += text;
  });
  console.info(
    `POST /api/voice/chat ${response.status} ${Date.now() - startedAt}ms${extra}`,
  );
  return response;
}
