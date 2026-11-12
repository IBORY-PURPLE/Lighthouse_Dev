import type { NextRequest } from "next/server";
import { SEARCH_KINDS } from "@/lib/research";
import { answerResearch } from "@/lib/researchAi";
import { MAX_BODY_BYTES, parseResearchRequest } from "@/lib/researchRequest";
import { createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore } from "@/lib/requestStore";
import { fail, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 리서치 챗의 AI 도움 한 번(카드 7장 + 사진 설명 + 핵심 정리). 설계 지침 4절.
// 내가 맡은 진행 중 요청에만 답한다. AI가 실패해도 200 + ai:"fallback"으로 답하고, 본문·권한 오류만 4xx다.
// 글·사진·키·봉사자 ID는 로그에 남기지 않는다. 사진은 저장하지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 봉사자별 전체 분당 30회, 웹 검색을 쓰는 종류는 따로 분당 8회(서버 메모리라 인스턴스마다 따로 센다). */
const checkRouteLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });
const checkSearchLimit = createRateLimiter({ limit: 8, windowMs: 60_000 });
/** maxDuration(60초) 안에 모델 호출이 끝나도록 끊는다. */
const AI_DEADLINE_MS = 55_000;

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

async function readBody(request: NextRequest) {
  const tooLarge = { ok: false, status: 413, error: "image_too_large" } as const;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge;
  let parsed: unknown;
  try {
    const raw = await readLimitedText(request);
    if (raw === null) return tooLarge;
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "invalid_request" } as const;
  }
  return parseResearchRequest(parsed);
}

export async function POST(request: NextRequest) {
  // 로그 끝에 붙는 글: kind=<종류> ai=<ok|fallback|none>[ upstream=<코드|none>]
  let logTail = " kind=- ai=none";
  return runVolunteerRoute(
    request,
    "research",
    async ({ volunteerId }) => {
      const checked = await readBody(request);
      if (!checked.ok) return fail(checked.status, checked.error);
      const body = checked.body;
      logTail = ` kind=${body.kind} ai=none`;

      const found = await getRequestStore().getForVolunteer(body.requestId, volunteerId);
      if (found.kind === "not_found") return fail(404, "not_found");
      if (found.kind === "not_yours") return fail(403, "not_yours");
      if (found.request.status !== "in_progress") return fail(409, "not_in_progress");

      if (SEARCH_KINDS.includes(body.kind)) {
        const limit = checkSearchLimit(volunteerId);
        if (!limit.allowed) {
          return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
        }
      }

      const { product, brand, item } = found.request;
      const outcome = await answerResearch(
        body,
        { product, brand, item },
        AbortSignal.any([request.signal, AbortSignal.timeout(AI_DEADLINE_MS)]),
      );
      logTail = ` kind=${body.kind} ai=${outcome.body.ai}${outcome.upstream === null ? "" : ` upstream=${outcome.upstream}`}`;
      return succeed(outcome.body);
    },
    checkRouteLimit,
    () => logTail,
  );
}
