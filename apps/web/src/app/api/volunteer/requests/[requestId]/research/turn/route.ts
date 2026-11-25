import type { NextRequest, NextResponse } from "next/server";
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
import { runTurn, parseTurnBody, turnTrace, type TurnInput } from "@/lib/researchTurn";
import { capsFromEnv } from "@/lib/researchSession";
import { getResearchStore, type ResearchStore, type TurnResponse } from "@/lib/researchStore";
import { StoreUnavailableError } from "@/lib/requestStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 대화 한 턴(design.md 3.2, 4.1~4.6). 글 입력 순서: 쿠키 → 본문 검사 → research_begin(소유·한도·중복·stale) → AI → research_apply.
// 같은 clientTurnId는 저장된 응답을 그대로 돌려주고, 처리 중이면 202다. 글·사진·키·봉사자 ID는 로그에 남기지 않는다.
// 빠른 답·칩·건너뛰기·고치기·링크 확인은 AI를 부르지 않으므로 research_begin을 거치지 않는다(하루 AI 호출량·요청당 턴 상한에 세지 않는다).
// begin의 DB 함수는 턴을 항상 AI 호출 1회로 세고 되돌릴 방법이 stale뿐이라(마이그레이션 1은 이미 운영에 적용됨), 앱에서 begin을 건너뛴다.
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

/** 세션 읽기에 쓰는 가장 큰 seq: 메시지 없이 상태만 읽는다(research_view의 p_after). */
const NO_MESSAGES = 2_147_483_647;

type Actor = { requestId: string; volunteerId: string; sessionId: string };

/**
 * AI를 부르지 않는 입력(quick·chip·skip·edit·link_check)의 한 턴. research_begin은 턴을 항상 AI 호출 1회로 세므로 거치지 않고
 * open(소유·세션 확인과 읽기) → 계획 → apply(중복 검사·기준 version 검사·반영)로 간다. 요청당 턴·하루 AI 호출량을 올리지 않는다.
 * 같은 clientTurnId는 apply가 저장된 응답을 그대로 돌려준다. 기준 version이 어긋나거나 분당 제한에 닿았을 때는
 * baseVersion -1로 apply를 불러 "저장된 응답이면 그대로, 아니면 stale"만 알아본다(-1은 어떤 version과도 같지 않아 아무것도 반영하지 않는다).
 */
async function localTurn(
  store: ResearchStore,
  actor: Actor,
  { clientTurnId, baseVersion, input }: { clientTurnId: string; baseVersion: number; input: TurnInput },
): Promise<{ response: NextResponse; label: AiLabel | null }> {
  const opened = await store.open(actor.requestId, actor.volunteerId, NO_MESSAGES);
  if (opened.outcome !== "ok") return { response: guardResponse(opened.outcome), label: null };
  const session = opened.view;
  if (session.sessionId.toLowerCase() !== actor.sessionId.toLowerCase()) {
    return { response: guardResponse("session_changed"), label: null };
  }

  const probe = async (limited: { retryAfterSeconds: number } | null) => {
    const seen = await store.apply({ ...actor, clientTurnId, baseVersion: -1, patch: null, messages: [], next: [] });
    switch (seen.outcome) {
      case "duplicate": {
        const label = labelFromMessages(seen.response.messages);
        return { response: succeed(turnBody(seen.response, label, input)), label };
      }
      case "stale":
        return {
          response: limited
            ? fail(429, "rate_limited", { "Retry-After": String(limited.retryAfterSeconds) })
            : failWith(409, "stale", { version: seen.version }),
          label: null,
        };
      case "ok":
      case "bad_patch":
        return { response: fail(500, "internal_error"), label: null };
      default:
        return { response: guardResponse(seen.outcome), label: null };
    }
  };

  // 분당 제한은 새로 반영되는 턴만 센다: 저장 응답·stale은 세지 않고, 제한에 닿은 뒤에도 저장된 응답은 그대로 답한다.
  const gate = checkTurnLimit.peek(actor.volunteerId);
  if (session.version !== baseVersion) return probe(null);
  if (!gate.allowed) return probe(gate);

  const run = await runTurn({
    session,
    input,
    context: { product: "", brand: null, item: null },
    capped: null,
  });

  const args = { ...actor, clientTurnId, baseVersion, patch: run.plan.patch, messages: run.plan.messages, next: run.plan.next };
  let applied;
  try {
    applied = await store.apply(args);
  } catch (error) {
    // 같은 clientTurnId가 동시에 두 번 들어오면 한쪽이 저장 단계에서 부딪혀 DB 오류가 난다. 한 번 더 부르면 저장된 응답이 온다.
    if (!(error instanceof StoreUnavailableError)) throw error;
    applied = await store.apply(args);
  }
  switch (applied.outcome) {
    case "ok":
    case "duplicate": {
      // 새로 반영된 턴만 센다(저장 응답 재전송은 세지 않는다). 세는 것이 반영 뒤라 동시에 온 요청은 한도를 조금 넘을 수 있다.
      if (applied.outcome === "ok") checkTurnLimit(actor.volunteerId);
      const label = applied.outcome === "ok" ? run.plan.label : labelFromMessages(applied.response.messages);
      return { response: succeed(turnBody(applied.response, label, input)), label };
    }
    case "stale":
      return { response: failWith(409, "stale", { version: applied.version }), label: null };
    case "bad_patch":
      // 서버가 만든 patch가 칸 규칙에 어긋났다(서버 버그). 처리 중 자리를 만들지 않았으므로 닫을 것은 없다.
      return { response: fail(500, "internal_error"), label: null };
    default:
      return { response: guardResponse(applied.outcome), label: null };
  }
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

      if (input.type !== "text") {
        // AI를 부르지 않는 입력: begin 없이 읽고(open) 한 번에 반영(apply)한다. 사용량은 올리지 않는다.
        const local = await localTurn(store, actor, { clientTurnId, baseVersion, input });
        if (local.label) tail = logTail({ kind: "turn", ai: local.label });
        return local.response;
      }
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
            // AI 판단 확인용 한 줄(Vercel 실행 로그에서 "[research-turn]"으로 찾는다). 봉사자 입력·칸 값·ID는 넣지 않는다.
            if (applied.outcome === "ok" && input.type === "text") console.info("[research-turn]", JSON.stringify(turnTrace(run)));
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
