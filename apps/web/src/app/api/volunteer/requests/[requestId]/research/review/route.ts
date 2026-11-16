import type { NextRequest } from "next/server";
import { failWith, guardResponse, logTail, readJsonBody, type AiLabel } from "@/lib/researchApi";
import {
  buildReviewMaterial,
  buildTemplateReview,
  checkReviewText,
  reviewKnownMaterial,
  writeReview,
} from "@/lib/researchReview";
import { loadSession, requestText } from "@/lib/researchReviewApi";
import {
  capsFromEnv,
  hasUnresolvedCheck,
  isPastQuestionSeven,
  requiredMissing,
  type ResearchView,
} from "@/lib/researchSession";
import { getResearchStore } from "@/lib/researchStore";
import { fail, isUuid, runVolunteerRoute, succeed } from "@/lib/volunteerApi";

// 검증 리뷰(design.md 3.2, 4.11). POST: AI 한 번으로 문단 초안(draft)을 만들고, 검사에 걸리거나 AI가 안 되면 서버 틀 문단으로 대신한다.
// PUT: 봉사자가 고친 문단을 검사해 통과하면 confirmed(보내기 가능), 걸리면 422 review_blocked {reasons}. AI 없음.
// 칸이 바뀌면 confirmed가 draft로 돌아가는 일은 저장소(SQL·메모리)가 한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1024;
/** maxDuration(60초) 안에 끝나도록 AI를 끊는다. */
const AI_DEADLINE_MS = 50_000;

/** 화면이 볼 리뷰 상태(confirmedVersion은 서버 안). */
const publicReview = (review: { status?: "draft" | "confirmed"; text?: string; rev?: number }) => ({
  status: review.status,
  text: review.text,
  rev: review.rev,
});

/** 리뷰를 만들 수 있나: 필수가 다 찼고 질문 7을 지났고 확인할 것이 없다. 아니면 409 이유. */
function notReady(view: ResearchView): { error: "missing_required"; missing: string[] } | { error: "not_ready" } | null {
  const missing = requiredMissing(view);
  // 구매함이면 칸 표시만이 아니라 실제 사진이 1장 이상 있어야 한다(저장소의 보내기 규칙과 같다).
  if (view.purchase === "bought" && view.photos.length === 0 && !missing.includes("photo")) missing.push("photo");
  if (missing.length > 0) return { error: "missing_required", missing };
  if (!isPastQuestionSeven(view) || hasUnresolvedCheck(view.pending)) return { error: "not_ready" };
  return null;
}

function sessionIdOf(value: unknown): string | null {
  const sessionId = (value as { sessionId?: unknown } | null)?.sessionId;
  return typeof sessionId === "string" && isUuid(sessionId) ? sessionId.toLowerCase() : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  let tail = logTail({ kind: "review", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/review",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const raw = await readJsonBody(request, MAX_BODY_BYTES);
      if (!raw.ok) return fail(raw.status, raw.error);
      const sessionId = sessionIdOf(raw.value);
      if (!sessionId) return fail(400, "invalid_request");

      const loaded = await loadSession(id, volunteerId, sessionId, true);
      if (!loaded.ok) return loaded.response;
      const view = loaded.view;
      const blocked = notReady(view);
      if (blocked) return failWith(409, blocked.error, "missing" in blocked ? { missing: blocked.missing } : {});

      const store = getResearchStore();
      const actor = { requestId: id, volunteerId, sessionId };
      // 요청당 리뷰 3번·하루 AI 호출 상한을 여기서 센다. 상한에 닿으면 AI 없이 틀 문단으로 만든다.
      const begun = await store.begin({ ...actor, kind: "review", caps: capsFromEnv() });
      if (begun.outcome !== "ok" && begun.outcome !== "capped") {
        if (begun.outcome === "stale" || begun.outcome === "pending" || begun.outcome === "cached" || begun.outcome === "duplicate") {
          return fail(400, "invalid_request");
        }
        if (begun.outcome === "photos_full" || begun.outcome === "photo_not_needed" || begun.outcome === "bad_request") {
          return fail(400, "invalid_request");
        }
        return guardResponse(begun.outcome);
      }

      const source = { view, context: await requestText(id, volunteerId) };
      const material = buildReviewMaterial(source);
      let text: string;
      let label: AiLabel;
      if (begun.outcome === "capped") {
        text = buildTemplateReview(material);
        label = "capped";
        tail = logTail({ kind: "review", ai: "capped", cap: begun.cap });
      } else {
        const written = await writeReview(
          material,
          reviewKnownMaterial(source),
          AbortSignal.any([request.signal, AbortSignal.timeout(AI_DEADLINE_MS)]),
        );
        text = written.text ?? buildTemplateReview(material);
        label = written.text ? "ok" : "fallback";
        tail = logTail({ kind: "review", ai: label, up: written.text ? null : written.upstream, usage: written.usage });
      }

      const saved = await store.setReview({ ...actor, baseVersion: null, text, status: "draft" });
      if (saved.outcome === "bad_request" || saved.outcome === "stale") return fail(500, "internal_error");
      if (saved.outcome !== "ok") return guardResponse(saved.outcome);
      return succeed({ review: publicReview(saved.review), version: view.version, ai: label });
    },
    undefined,
    () => tail,
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const tail = logTail({ kind: "review_edit", ai: "none" });
  return runVolunteerRoute(
    request,
    "requests/[id]/research/review",
    async ({ volunteerId }) => {
      if (!isUuid(requestId)) return fail(400, "invalid_request");
      const id = requestId.toLowerCase();
      const raw = await readJsonBody(request, MAX_BODY_BYTES);
      if (!raw.ok) return fail(raw.status, raw.error);
      const sessionId = sessionIdOf(raw.value);
      const { baseVersion, text } = (raw.value ?? {}) as { baseVersion?: unknown; text?: unknown };
      if (!sessionId || typeof text !== "string" || typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
        return fail(400, "invalid_request");
      }

      const loaded = await loadSession(id, volunteerId, sessionId, true);
      if (!loaded.ok) return loaded.response;
      const source = { view: loaded.view, context: await requestText(id, volunteerId) };
      const trimmed = text.trim();
      const reasons = checkReviewText(trimmed, reviewKnownMaterial(source), "edit");
      if (reasons.length > 0) return failWith(422, "review_blocked", { reasons });

      const saved = await getResearchStore().setReview({
        requestId: id,
        volunteerId,
        sessionId,
        baseVersion,
        text: trimmed,
        status: "confirmed",
      });
      if (saved.outcome === "stale") return failWith(409, "stale", { version: saved.version });
      if (saved.outcome === "bad_request") return fail(400, "invalid_request");
      if (saved.outcome !== "ok") return guardResponse(saved.outcome);
      return succeed({ review: publicReview(saved.review), version: baseVersion });
    },
    undefined,
    () => tail,
  );
}
