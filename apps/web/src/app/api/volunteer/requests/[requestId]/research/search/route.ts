import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore } from "@/lib/requestStore";
import { benefitShortcuts, subjectOf, type ResearchResponse } from "@/lib/research";
import { answerResearch, fallbackResponse } from "@/lib/researchAi";
import { guardResponse, logTail, readJsonBody, type AiLabel } from "@/lib/researchApi";
import { capsFromEnv, type NextMessage } from "@/lib/researchSession";
import { getResearchStore } from "@/lib/researchStore";
import { fitMessage } from "@/lib/researchTurn";
import {
  CAP_DAILY,
  CAP_REQUEST,
  MODEL_CHIPS_CAPTION,
  MODEL_CHIPS_EMPTY,
  MODEL_CHIPS_FALLBACK,
  MODEL_CHIPS_INTRO,
  OWN_LABEL,
} from "@/lib/researchTurnText";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 웹 검색 한 번(design.md 3.2, 4.8). 11/18 핵심에서는 kind=model(기종 후보 칩)만 있다. 질문 4·6의 검색은 A3에서 더한다.
// version을 올리지 않고 메시지만 더한다. 캐시 적중과 처리 중(202)은 세지 않는다.
// 실패하면 고정 후보·쇼핑몰 바로가기로 이어 가므로 AI가 죽어도 대화는 막히지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 봉사자별 검색 분당 8회. */
const checkSearchLimit = createRateLimiter({ limit: 8, windowMs: 60_000 });
const MAX_BODY_BYTES = 2 * 1024;
/** maxDuration(60초) 안에 끝나도록 AI를 끊는다. */
const AI_DEADLINE_MS = 50_000;
const MODEL_CACHE_KEY = "model";
const CHIP_URL_MAX = 500;

type ModelBody = Extract<ResearchResponse, { items: unknown }>;

/**
 * 기종 후보 메시지: 칩(이름, 주소)과 쇼핑몰 바로가기. 이름은 pending.shownModels로 따로 저장한다.
 * 후보 이름은 웹 검색에서 온 값이라, 기존 카드형(researchCheck.cleanItems)과 같이 "출처 주소가 검색 결과(인용·소스)에 있는 후보"와
 * 이름의 금지 표현만 거른다. 칩에는 "AI 제안 · 확인이 필요해요" 표시가 붙고, 고른 이름은 봉사자 확정으로 칸에 들어간다.
 * 이름과 인용 내용의 대조(design.md 4.8 unknownModelTokens, 자료 = 인용)는 제품 목록 질문(블록 A3)에서 더한다.
 */
function modelMessage(body: ModelBody, subject: string, notice: string | null): NextMessage {
  const count = body.items.length;
  const caption =
    count === 0 ? MODEL_CHIPS_EMPTY : body.ai === "ok" ? MODEL_CHIPS_CAPTION(count) : MODEL_CHIPS_FALLBACK(count);
  // 인용 주소는 길이 제한이 없어서 너무 길면 뺀다(메시지 본문은 8,192바이트까지다).
  const urlOf = (url: string | null) => (url !== null && url.length <= CHIP_URL_MAX ? url : null);
  return fitMessage({
    role: "ai",
    tag: "search",
    slot: "model",
    body: {
      kind: "text",
      // 후보가 없으면 칩이 없어 화면이 caption을 그리지 않으므로 본문 글이 "후보를 찾지 못함"을 말한다.
      text: notice ?? (count === 0 ? MODEL_CHIPS_EMPTY : MODEL_CHIPS_INTRO),
      chips: body.items.map((item) => ({ label: item.name, value: item.name, url: urlOf(item.url) })),
      chipSlot: "model",
      chipsCaption: caption,
      ownLabel: OWN_LABEL,
      shortcuts: benefitShortcuts(subject),
    },
    ai: body.ai === "ok" ? "ok" : "fallback",
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  let tail = logTail({ kind: "model", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/search",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const raw = await readJsonBody(request, MAX_BODY_BYTES);
      if (!raw.ok) return fail(raw.status, raw.error);
      const value = raw.value as { sessionId?: unknown; kind?: unknown } | null;
      const sessionId = typeof value?.sessionId === "string" ? value.sessionId : "";
      // 11/18 핵심은 model만이다. 다른 종류는 A3에서 더한다.
      if (!isUuid(sessionId) || value?.kind !== "model") return fail(400, "invalid_request");

      const found = await getRequestStore().getForVolunteer(id, volunteerId);
      if (found.kind === "not_found") return fail(404, "not_found");
      if (found.kind === "not_yours") return fail(403, "not_yours");
      if (found.request.status !== "in_progress") return fail(409, "not_in_progress");
      const context = { product: found.request.product, brand: found.request.brand, item: found.request.item };
      const subject = subjectOf(context);

      // 분당 8회는 AI 검색을 새로 부를 때만 센다(캐시 적중·처리 중·한도 응답·틀린 요청은 세지 않는다).
      // 이미 한도에 닿아 있으면 검색 사용량을 올리는 begin 전에 막는다: begin이 올린 요청당·하루 검색 사용량은
      // 되돌릴 방법이 없어서, 거절된 재시도가 한도를 쓰지 않게 하려는 것이다. 한도에 닿으려면 AI 검색을 1분에 8번 새로
      // 불러야 하는데 대화 한 번에 모델 검색은 한 번뿐이라 정상 사용에서는 닿지 않는다.
      const gate = checkSearchLimit.peek(volunteerId);
      if (!gate.allowed) return fail(429, "rate_limited", { "Retry-After": String(gate.retryAfterSeconds) });

      const store = getResearchStore();
      const actor = { requestId: id, volunteerId, sessionId: sessionId.toLowerCase() };
      const begun = await store.begin({ ...actor, kind: "search", cacheKey: MODEL_CACHE_KEY, units: 1, caps: capsFromEnv() });
      if (begun.outcome === "pending") return succeed({ pending: true }, 202);
      if (begun.outcome === "cached") {
        // 이미 찾았다. 메시지는 이미 대화에 있으니 새로 주지 않고 마지막 번호만 알린다.
        const view = await store.open(id, volunteerId, 2_147_483_647);
        return view.outcome === "ok"
          ? succeed({ messages: [], lastSeq: view.view.lastSeq })
          : guardResponse(view.outcome);
      }
      if (begun.outcome === "capped") {
        // 한도에 닿으면 AI 없이 고정 후보와 바로가기만 보인다.
        const body = fallbackResponse({ requestId: id, kind: "model" }, context) as ModelBody;
        const notice = begun.cap === "daily" ? CAP_DAILY : CAP_REQUEST;
        const message = { ...modelMessage(body, subject, notice), ai: "capped" as const };
        const added = await store.addMessage({
          ...actor,
          cacheKey: MODEL_CACHE_KEY,
          messages: [message],
          pending: { shownModels: body.items.map((item) => item.name) },
          cacheState: "done",
        });
        tail = logTail({ kind: "model", ai: "capped", cap: begun.cap });
        return added.outcome === "ok" ? succeed({ messages: added.messages, lastSeq: added.lastSeq }) : guardResponse(added.outcome);
      }
      if (begun.outcome !== "ok") {
        if (begun.outcome === "stale" || begun.outcome === "bad_request" || begun.outcome === "duplicate") {
          return fail(400, "invalid_request");
        }
        if (begun.outcome === "photos_full" || begun.outcome === "photo_not_needed") return fail(400, "invalid_request");
        return guardResponse(begun.outcome);
      }

      // 새로 AI 검색을 부르는 이 순간에 센다. 위 확인과 사이에 다른 요청이 한도를 채웠으면 검색 중 표시만 지운다.
      const limit = checkSearchLimit(volunteerId);
      if (!limit.allowed) {
        await store.addMessage({ ...actor, cacheKey: MODEL_CACHE_KEY, messages: [], cacheState: "clear" });
        return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
      }

      const outcome = await answerResearch(
        { requestId: id, kind: "model" },
        context,
        // 브라우저 연결이 끊겨도 검색은 끝까지 하고 결과를 저장한다(이미 센 검색을 버리지 않고, 새로 고친 뒤 GET으로 보인다).
        AbortSignal.timeout(AI_DEADLINE_MS),
      );
      const body = outcome.body as ModelBody;
      const label: AiLabel = body.ai === "ok" ? "ok" : "fallback";
      tail = logTail({
        kind: "model",
        ai: label,
        up: outcome.upstream,
        usage: outcome.usage,
      });
      const added = await store.addMessage({
        ...actor,
        cacheKey: MODEL_CACHE_KEY,
        messages: [modelMessage(body, subject, null)],
        pending: { shownModels: body.items.map((item) => item.name) },
        cacheState: "done",
      });
      if (added.outcome !== "ok") return guardResponse(added.outcome);
      return succeed({ messages: added.messages, lastSeq: added.lastSeq });
    },
    undefined,
    () => tail,
  );
}
