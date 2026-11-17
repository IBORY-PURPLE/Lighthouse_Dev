import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { RESEARCH_LIMITS, subjectOf } from "./research";
import { checkPurchasePhoto, type PhotoCheckResult } from "./researchAi";
import { failWith, guardResponse, readJsonBody, sessionSnapshot } from "./researchApi";
import { decodedBytes, matchesImageSignature } from "./researchImage";
import { requestText } from "./researchReviewApi";
import { capsFromEnv, hasUnresolvedCheck, type NextMessage, type ResearchMessage } from "./researchSession";
import { getResearchStore } from "./researchStore";
import { buildCandidates, fitMessage } from "./researchTurn";
import { PHOTO_CHECK_QUICK } from "./researchTurnText";
import { fail, isUuid, succeed } from "./volunteerApi";

// 구매 인증 사진 올리기(design.md 3.2, 4.7). 노트북 라우트(photos)와 휴대폰 라우트(/api/volunteer/photo)가 함께 쓴다.
// 착샷·실제 소유 사진만 받는다. 사진 원본은 어디에도 저장하지 않고(서명·크기만 검사),
// 작은 썸네일(jpeg data URL 60,000자 이하)만 저장한다.
// 사진 확인(P2, A12 이용자 결정 2026-11-17): AI가 사진 종류(착샷인지)·대체 텍스트·인쇄된 기종을 본다.
// 착샷이 아니거나 불분명하거나 기종이 다르면 확인 필요(shotCheck·mismatch)로 두어 구매 인증을 보류하고, 봉사자가 [직접 찍은 사진이 맞아요]로 푼다.
// 사진 말풍선 → 다음 질문 순서로 대화에 넣는다. 말풍선의 photoId는 사진을 넣어야 알 수 있어서 add_photo 뒤에 말풍선을 넣고,
// 다음 질문은 apply(후보 목록, AI 없음)가 research_add_photo와 같은 규칙으로 고른다.

/** 이미지 1.5MiB를 base64로 키운 크기에 썸네일 6만 자와 겉모양을 더한 값(약 2.2MB). */
export const MAX_PHOTO_BODY_BYTES = Math.floor(2.2 * 1024 * 1024);
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png);base64,/;
const THUMB_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

export interface PhotoUploadActor {
  requestId: string;
  volunteerId: string;
  /** 정해져 있으면 그 세션(휴대폰: grant가 가리키는 세션). null이면 본문의 sessionId를 쓴다(노트북). */
  sessionId: string | null;
  /** 휴대폰 올리기면 grant의 sha256. 저장소가 잠근 안에서 다시 확인한다. 노트북은 null. */
  grantHash: string | null;
}

/** 기종 이름 비교용: 소문자, 글자·숫자만. */
function modelKey(text: string): string {
  return text.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

/** 사진에 보인 기종이 기종 칸과 다른가(한쪽이 다른 쪽을 품으면 같다고 본다). */
export function modelDiffers(seen: string | null, model: string): boolean {
  if (!seen || !model.trim()) return false;
  const a = modelKey(seen);
  const b = modelKey(model);
  if (!a || !b) return false;
  return !(a.includes(b) || b.includes(a));
}

/** 사진 확인 결과로 확인 필요(pending)와 AI 말풍선을 만든다. 확인할 것이 없으면 pending은 null. */
export function photoCheckOutcome(
  check: PhotoCheckResult,
  model: string,
): { pending: Record<string, unknown> | null; message: NextMessage } {
  const mismatch = modelDiffers(check.seenModel, model) ? check.seenModel : null;
  const shotOk = check.shot === "photo";
  const ai = check.ai === "ok" ? "ok" : check.ai === "none" ? "none" : "fallback";
  if (shotOk && !mismatch) {
    const text = check.description ? `사진을 확인했어요. ${check.description}` : "사진을 확인했어요.";
    return { pending: null, message: { role: "ai", tag: "notice", slot: "photo", body: { kind: "text", text }, ai } };
  }
  const parts: string[] = [];
  if (check.description) parts.push(`사진 설명: ${check.description}`);
  else if (check.ai !== "ok") parts.push("AI가 사진을 확인하지 못했어요.");
  if (check.shot === "screenshot") parts.push("상세 페이지나 화면을 캡처한 사진처럼 보여요.");
  if (check.shot === "unclear" && check.ai === "ok") parts.push("직접 찍은 사진인지 확실하지 않아요.");
  if (mismatch) parts.push(`사진에는 “${mismatch}”라고 보이는데, 기종 칸은 “${model.trim()}”예요.`);
  parts.push("직접 찍은 착샷이나 실제 가지고 있는 모습이 맞으면 [직접 찍은 사진이 맞아요]를 눌러 주세요. 그 전까지는 구매 인증을 보류해요.");
  const pending: Record<string, unknown> = {};
  if (!shotOk) pending.shotCheck = { slot: "photo", shot: check.shot };
  if (mismatch) pending.mismatch = { slot: "photo", seen: mismatch };
  return {
    pending,
    message: { role: "ai", tag: "notice", slot: "photo", body: { kind: "text", text: parts.join(" "), quick: PHOTO_CHECK_QUICK }, ai },
  };
}

/** 본문 읽기·사진 검사·저장·말풍선·다음 질문. 성공하면 201 {photo, messages, version, lastSeq, session}. */
export async function uploadPhoto(request: NextRequest, who: PhotoUploadActor): Promise<NextResponse> {
  if (!isUuid(who.requestId)) return fail(400, "invalid_request");
  const id = who.requestId.toLowerCase();
  const raw = await readJsonBody(request, MAX_PHOTO_BODY_BYTES);
  if (!raw.ok) return fail(raw.status, raw.error);
  const value = raw.value as { sessionId?: unknown; image?: unknown; thumb?: unknown } | null;
  const { image, thumb } = value ?? {};
  const sessionId = who.sessionId ?? value?.sessionId;
  if (typeof sessionId !== "string" || !isUuid(sessionId) || typeof image !== "string" || typeof thumb !== "string") {
    return fail(400, "invalid_request");
  }
  // 이미지: 선언한 형식(jpeg·png) → base64 → 크기 → 실제 바이트 서명 순으로 본다.
  if (!IMAGE_DATA_URL.test(image)) return fail(415, "bad_image_format");
  if (!BASE64_BODY.test(image.slice(image.indexOf(",") + 1))) return fail(400, "invalid_request");
  if (decodedBytes(image) > RESEARCH_LIMITS.imageMaxBytes) return fail(413, "image_too_large");
  if (!matchesImageSignature(image)) return fail(415, "bad_image_format");
  if (thumb.length > RESEARCH_LIMITS.thumbMax) return fail(413, "thumb_too_large");
  // 썸네일도 선언(jpeg)만이 아니라 실제 JPEG 바이트 서명(FF D8 FF)을 본다.
  if (!THUMB_DATA_URL.test(thumb) || !matchesImageSignature(thumb)) return fail(415, "bad_image_format");

  const store = getResearchStore();
  const actor = { requestId: id, volunteerId: who.volunteerId, sessionId: sessionId.toLowerCase() };
  const begun = await store.begin({ ...actor, kind: "photo", caps: capsFromEnv() });
  switch (begun.outcome) {
    case "ok":
      break;
    case "photos_full":
      return fail(409, "photos_full");
    case "photo_not_needed":
      return fail(409, "photo_not_needed");
    case "capped":
      return failWith(429, "photo_cap", { cap: begun.cap });
    case "stale":
    case "pending":
    case "cached":
    case "duplicate":
    case "bad_request":
      return fail(400, "invalid_request");
    default:
      return guardResponse(begun.outcome);
  }

  // 사진 확인(P2): AI가 원본 사진을 본다. 한도(capped)면 부르지 않고 확인 필요로 둔다.
  const model = begun.outcome === "ok" ? (begun.session.slots.model?.value ?? "") : "";
  const check = await checkPurchasePhoto(image, model, { skipAi: begun.outcome === "ok" && begun.ai === "capped" });
  const outcome = photoCheckOutcome(check, model);

  // 사진 넣기: 칸(photo)을 채우고 version을 올린다. 확인 필요가 있으면 구매 인증을 보류한다. 다음 질문은 말풍선을 넣은 뒤에 고른다.
  const added = await store.addPhoto({
    ...actor,
    thumb,
    description: check.description,
    seenModel: check.seenModel,
    shot: check.shot,
    pending: outcome.pending,
    messages: [],
    next: [],
    grantHash: who.grantHash,
  });
  if (added.outcome === "photos_full") return fail(409, "photos_full");
  if (added.outcome === "photo_not_needed") return fail(409, "photo_not_needed");
  if (added.outcome === "bad_request") return fail(400, "invalid_request");
  // grant가 그 사이 끊겼다(시간이 지났거나 노트북이 새 링크를 만들었다). 휴대폰 화면이 안내한다.
  if (added.outcome === "grant_gone") return fail(410, "expired_or_revoked");
  if (added.outcome !== "ok") return guardResponse(added.outcome);

  const bubble: NextMessage = {
    role: "volunteer",
    tag: null,
    slot: "photo",
    body: { kind: "photo", photoId: added.photoId },
    ai: null,
  };
  const bubbled = await store.addMessage({ ...actor, cacheKey: null, messages: [bubble, outcome.message] });
  if (bubbled.outcome !== "ok") return guardResponse(bubbled.outcome);
  const messages: ResearchMessage[] = [...bubbled.messages];
  let session = { ...added.session, lastSeq: bubbled.lastSeq };

  // 직전 질문이 사진이거나 없고 확인할 것이 없을 때만 다음 질문을 잇는다(research_add_photo와 같은 규칙).
  const lastQuestion = session.pending.lastQuestion?.slot;
  if ((lastQuestion === undefined || lastQuestion === "photo") && !hasUnresolvedCheck(session.pending)) {
    const subject = subjectOf(await requestText(id, who.volunteerId));
    const next = buildCandidates(session, subject, { hold: false, aiNext: null, reask: null }).map((candidate) => ({
      ...candidate,
      message: fitMessage(candidate.message),
    }));
    const applied = await store.apply({
      ...actor,
      clientTurnId: `photo-${added.photoId}`,
      baseVersion: session.version,
      patch: null,
      messages: [],
      next,
    });
    // 그 사이 칸이 바뀌어(stale) 다음 질문을 잇지 못해도 사진은 들어갔다. 화면이 GET으로 이어 읽는다.
    if (applied.outcome === "ok" || applied.outcome === "duplicate") {
      messages.push(...applied.response.messages);
      session = { ...added.session, ...applied.response.session, lastSeq: applied.response.lastSeq };
    }
  }

  return succeed(
    {
      photo: { id: added.photoId, thumb, description: check.description, seenModel: check.seenModel, shot: check.shot },
      messages,
      version: session.version,
      lastSeq: session.lastSeq,
      session: sessionSnapshot(session),
    },
    201,
  );
}
