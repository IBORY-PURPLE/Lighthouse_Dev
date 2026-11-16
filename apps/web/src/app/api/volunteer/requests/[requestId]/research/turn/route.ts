import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore } from "@/lib/requestStore";
import {
  failWith,
  guardResponse,
  labelFromMessages,
  logTail,
  readJsonBody,
  sessionSnapshot,
  type AiLabel,
} from "@/lib/researchApi";
import { runTurn, parseTurnBody } from "@/lib/researchTurn";
import { capsFromEnv, type ResearchMessage } from "@/lib/researchSession";
import { getResearchStore, type TurnResponse } from "@/lib/researchStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 대화 한 턴(design.md 3.2, 4.1~4.6). 순서: 쿠키 → 본문 검사 → research_begin(소유·한도·중복·stale) → AI → research_apply.
// 같은 clientTurnId는 저장된 응답을 그대로 돌려주고, 처리 중이면 202다. 글·사진·키·봉사자 ID는 로그에 남기지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 봉사자별 턴 분당 20회(서버 메모리라 인스턴스마다 따로 센다). */
const checkTurnLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });
/** 본문은 글 1,000자(최대 3KB)와 JSON 겉모양이라 16KB면 넉넉하다. */
const MAX_BODY_BYTES = 16 * 1024;
/** AI 한 번의 마감(design.md 3.2). */
const AI_DEADLINE_MS = 15_000;

/** 방금 만든 질문이 기종 질문이면 화면이 이어서 웹 검색(model)을 부르게 알린다. A3 이후 alts·benefits도 여기서 알린다. */
function followUpOf(messages: readonly ResearchMessage[]) {
  const asksModel = messages.some(
    (message) => message.role === "ai" && message.tag === "question" && message.slot === "model",
  );
  return asksModel ? { search: "model" as const } : null;
}

function turnBody(response: TurnResponse, ai: AiLabel) {
  const followUp = followUpOf(response.messages);
  return {
    version: response.version,
    lastSeq: response.lastSeq,
    messages: response.messages,
    session: sessionSnapshot(response.session),
    ...(followUp ? { followUp } : {}),
    ai,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  let tail = logTail({ kind: "turn", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/turn",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const raw = await readJsonBody(request, MAX_BODY_BYTES);
      if (!raw.ok) return fail(raw.status, raw.error);
      const parsed = parseTurnBody(raw.value);
      if (!parsed.ok) return fail(400, parsed.error);
      const { clientTurnId, sessionId, baseVersion, input } = parsed.body;

      const store = getResearchStore();
      const actor = { requestId: id, volunteerId, sessionId };
      // 요청 글은 AI가 읽을 때만 필요하다. begin과 같이 읽되, 실패해도 begin이 만든 처리 중 자리를 닫아야 하므로 삼킨다.
      const detail =
        input.type === "text"
          ? getRequestStore()
              .getForVolunteer(id, volunteerId)
              .catch(() => null)
          : null;
      const begun = await store.begin({ ...actor, kind: "turn", baseVersion, clientTurnId, caps: capsFromEnv() });

      switch (begun.outcome) {
        case "duplicate": {
          const label = labelFromMessages(begun.response.messages);
          tail = logTail({ kind: "turn", ai: label });
          return succeed(turnBody(begun.response, label));
        }
        case "pending":
          return succeed({ pending: true }, 202);
        case "stale":
          return failWith(409, "stale", { version: begun.version });
        case "bad_request":
          return fail(400, "invalid_request");
        case "ok":
          break;
        case "capped":
        case "cached":
        case "photos_full":
        case "photo_not_needed":
          // 턴은 한도에 닿아도 ok(ai: capped)로 온다. 이 값들은 오지 않지만 닫아 둔다.
          return fail(409, "not_in_progress");
        default:
          return guardResponse(begun.outcome);
      }

      const found = detail ? await detail : null;
      const context =
        found && found.kind === "ok"
          ? { product: found.request.product, brand: found.request.brand, item: found.request.item }
          : { product: "", brand: null, item: null };
      const run = await runTurn({
        session: begun.session,
        input,
        context,
        capped: begun.ai === "capped" ? { cap: begun.cap ?? "request" } : null,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(AI_DEADLINE_MS)]),
      });

      const applied = await store.apply({
        ...actor,
        clientTurnId,
        baseVersion,
        patch: run.plan.patch,
        messages: run.plan.messages,
        next: run.plan.next,
      });
      switch (applied.outcome) {
        case "ok":
        case "duplicate": {
          const label = applied.outcome === "ok" ? run.plan.label : labelFromMessages(applied.response.messages);
          tail = logTail({
            kind: "turn",
            ai: label,
            cap: begun.ai === "capped" ? (begun.cap ?? "request") : null,
            up: label === "fallback" ? run.upstream : null,
            usage: run.usage,
          });
          return succeed(turnBody(applied.response, label));
        }
        case "stale":
          return failWith(409, "stale", { version: applied.version });
        case "bad_patch":
          return fail(500, "internal_error");
        default:
          return guardResponse(applied.outcome);
      }
    },
    checkTurnLimit,
    () => tail,
  );
}
