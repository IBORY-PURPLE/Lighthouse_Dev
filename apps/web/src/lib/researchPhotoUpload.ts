import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { RESEARCH_LIMITS, subjectOf } from "./research";
import { failWith, guardResponse, readJsonBody, sessionSnapshot } from "./researchApi";
import { decodedBytes, matchesImageSignature } from "./researchImage";
import { requestText } from "./researchReviewApi";
import { capsFromEnv, hasUnresolvedCheck, type NextMessage, type ResearchMessage } from "./researchSession";
import { getResearchStore } from "./researchStore";
import { buildCandidates, fitMessage } from "./researchTurn";
import { fail, isUuid, succeed } from "./volunteerApi";

// 구매 인증 사진 올리기(design.md 3.2, 4.7). 노트북 라우트(photos)와 휴대폰 라우트(/api/volunteer/photo)가 함께 쓴다.
// 착샷·실제 소유 사진만 받는다. 사진 원본은 어디에도 저장하지 않고(서명·크기만 검사),
// 작은 썸네일(jpeg data URL 60,000자 이하)만 저장한다. 11/18 핵심에서는 AI 사진 설명을 부르지 않는다(P2).
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

  // 사진 넣기: 칸(photo)을 채우고 version을 올린다. 다음 질문은 말풍선을 넣은 뒤에 고른다.
  const added = await store.addPhoto({ ...actor, thumb, messages: [], next: [], grantHash: who.grantHash });
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
  const bubbled = await store.addMessage({ ...actor, cacheKey: null, messages: [bubble] });
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
      photo: { id: added.photoId, thumb, description: null, seenModel: null, shot: null },
      messages,
      version: session.version,
      lastSeq: session.lastSeq,
      session: sessionSnapshot(session),
    },
    201,
  );
}
