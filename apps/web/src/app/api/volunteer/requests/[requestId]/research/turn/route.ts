import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { getRequestStore } from "@/lib/requestStore";
import {
  failWith,
  followUpOf,
  guardResponse,
  labelFromMessages,
  logTail,
  readJsonBody,
  sessionSnapshot,
  type AiLabel,
} from "@/lib/researchApi";
import { runTurn, parseTurnBody } from "@/lib/researchTurn";
import { capsFromEnv } from "@/lib/researchSession";
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

function turnBody(response: TurnResponse, ai: AiLabel, input: { type: string; slot?: string }) {
  const followUp = followUpOf(response.messages, response.session.slots, input);
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
          return succeed(turnBody(begun.response, label, input));
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

      // 분당 제한은 새 일을 시작할 때만 센다(저장 응답·처리 중·stale·권한 오류·본문 오류는 세지 않고 제한에 닿은 뒤에도 그대로 답한다).
      // 제한에 닿았으면 begin이 만든 처리 중 자리를 닫고 사용량을 되돌린다: 기준 version이 어긋난 apply는 stale 경로를 타서
      // 두 가지를 모두 처리한다. 세션 version은 0 이상이라 -1은 어떤 동시 턴이 끼어들어도 항상 어긋난다.
      // 그래서 같은 clientTurnId로 나중에 다시 보내도 정상 처리된다.
      // 처리 중 자리를 닫는다(기록 없이 사용량을 되돌림). 실패해도 삼킨다: 닫지 못하면 그 자리는 같은 clientTurnId를 202로 붙잡는다.
      const closeTurn = async () => {
        try {
          await store.apply({ ...actor, clientTurnId, baseVersion: -1, patch: null, messages: [], next: [] });
        } catch {
          // best effort
        }
      };
      const limit = checkTurnLimit(volunteerId);
      if (!limit.allowed) {
        await closeTurn();
        return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
      }

      // begin 뒤에 예외가 나면(DB 지연·시간 초과 등) 자리를 닫고 다시 던진다. apply가 끝난 뒤에는 닫지 않는다.
      let settled = false;
      try {
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
        settled = true;
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
            return succeed(turnBody(applied.response, label, input));
          }
          case "stale":
            return failWith(409, "stale", { version: applied.version });
          case "bad_patch":
            // 서버가 만든 patch가 칸 규칙에 어긋났다(서버 버그). 처리 중 자리를 닫아 같은 clientTurnId가 202에 갇히지 않게 한다.
            await closeTurn();
            return fail(500, "internal_error");
          default:
            return guardResponse(applied.outcome);
        }
      } catch (error) {
        if (!settled) await closeTurn();
        throw error;
      }
    },
    undefined,
    () => tail,
  );
}
