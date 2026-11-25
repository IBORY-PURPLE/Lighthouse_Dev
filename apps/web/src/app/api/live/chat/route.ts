import { NextResponse, type NextRequest } from "next/server";
import { callLiveAI, gateLiveResult } from "@/lib/liveChat";
import { isLiveEnabled, LIVE_CHAT_DAILY_CAP, realCallTail, spendRealCalls } from "@/lib/liveConfig";
import { getLlmMode } from "@/lib/llm";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { readLimitedText } from "@/lib/readLimited";
import { readVoiceBody } from "@/lib/voiceChat";

// /live 글자 대화(fallback) 한 턴. 설계서 7.3절. 서버는 대화를 저장하지 않고 화면이 보낸 기록(history)으로 이어 간다.
// history에는 이번 말(message)이 없다. 서버가 한 번 붙인다(/api/voice/chat과 같은 방식).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 65_536;
const NO_STORE = { "Cache-Control": "no-store" };
const DAY_MS = 24 * 60 * 60 * 1000;

// 기존 /api/voice/chat과 제한기가 따로다(13.1절). 메모리 방식이라 인스턴스마다 따로 센다.
const checkIpLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });
const checkDailyCap = createRateLimiter({ limit: LIVE_CHAT_DAILY_CAP, windowMs: DAY_MS });

function failure(status: number, code: string, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error, code }, { status, headers: { ...NO_STORE, ...headers } });
}

async function handleChat(request: NextRequest, note: (text: string) => void) {
  if (!isLiveEnabled()) return failure(404, "disabled", "지금은 음성 도우미를 쓸 수 없습니다.");

  const ipLimit = checkIpLimit(clientKey(request.headers));
  if (!ipLimit.allowed) {
    return failure(429, "rate_limited", "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.", {
      "Retry-After": String(ipLimit.retryAfterSeconds),
    });
  }

  let raw: string | null;
  try {
    raw = await readLimitedText(request, MAX_BODY_BYTES);
  } catch {
    return failure(400, "bad_request", "요청 형식 오류");
  }
  if (raw === null) return failure(413, "too_large", "요청이 너무 큽니다");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure(400, "bad_request", "요청 형식 오류");
  }

  const body = readVoiceBody(parsed);
  if (!body.ok) return failure(400, "bad_request", body.error);
  if (body.reset) return failure(400, "bad_request", "요청 형식 오류");

  const mock = getLlmMode() === "mock";
  if (!mock && !process.env.OPENAI_API_KEY?.trim()) {
    return failure(503, "not_configured", "서버에 OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const dayLimit = checkDailyCap("global");
  if (!dayLimit.allowed) {
    return failure(429, "daily_cap", "오늘 이용량이 다 찼습니다.", {
      "Retry-After": String(dayLimit.retryAfterSeconds),
    });
  }

  if (!mock) {
    const spent = spendRealCalls(1);
    note(realCallTail());
    if (!spent.ok) return failure(429, "budget", "시험 호출 예산이 다 찼습니다.");
  }

  const next = [...body.history, { role: "user" as const, content: body.input }];
  try {
    const result = await callLiveAI(next);
    const gated = gateLiveResult(result, body.input, body.history);
    if (gated.downgraded) note(" gate=downgraded");
    return NextResponse.json(gated.result, { headers: NO_STORE });
  } catch (error) {
    // 이용자 문장과 AI 답은 남기지 않는다. 오류 종류만.
    if (error instanceof Error && error.name === "AbortError") {
      note(" error=timeout");
      return failure(504, "timeout", "AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.");
    }
    note(" error=failed");
    return failure(502, "failed", "AI 요청에 실패했습니다.");
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let extra = "";
  const response = await handleChat(request, (text) => {
    extra += text;
  });
  console.info(`POST /api/live/chat ${response.status} ${Date.now() - startedAt}ms${extra}`);
  return response;
}
