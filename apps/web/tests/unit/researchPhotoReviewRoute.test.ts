import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as enter } from "@/app/api/volunteer/enter/route";
import { POST as reset } from "@/app/api/volunteer/demo/reset/route";
import { GET as queue } from "@/app/api/volunteer/queue/route";
import { POST as claim } from "@/app/api/volunteer/requests/[requestId]/claim/route";
import { GET as getResearch } from "@/app/api/volunteer/requests/[requestId]/research/route";
import { POST as postPhoto } from "@/app/api/volunteer/requests/[requestId]/research/photos/route";
import { DELETE as deletePhoto } from "@/app/api/volunteer/requests/[requestId]/research/photos/[photoId]/route";
import {
  POST as postReview,
  PUT as putReview,
  maxDuration as reviewMaxDuration,
} from "@/app/api/volunteer/requests/[requestId]/research/review/route";
import { POST as postSend } from "@/app/api/volunteer/requests/[requestId]/research/send/route";
import { POST as turn } from "@/app/api/volunteer/requests/[requestId]/research/turn/route";
import { getRequestStore, resetRequestStoresForTest } from "@/lib/requestStore";
import { resetResearchStoresForTest } from "@/lib/researchStore";
import { checkCandidate } from "@/lib/resultInput";
import { PHOTO_QUESTION, PURCHASE_QUESTION } from "@/lib/researchTurnText";
import { readVolunteerId, VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

// 사진·리뷰·보내기 라우트(블록 A4). 가짜 AI(LLM_MODE=mock)와 메모리 저장소로 끝까지 돌고, 실제 모드는 openai 모듈을 가짜로 바꿔 부른다.

const { chatCreate, responsesCreate } = vi.hoisted(() => ({ chatCreate: vi.fn(), responsesCreate: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    chat = { completions: { create: chatCreate } };
    responses = { create: responsesCreate };
  }
  return { ...actual, default: FakeOpenAI, OpenAI: FakeOpenAI };
});

const ORIGIN = "http://localhost:3000";
const JSON_HEADERS = { "content-type": "application/json" };

let counter = 0;
const freshClient = () => `198.51.100.${(counter += 1) % 250}-${randomUUID()}`;

async function signIn() {
  const response = await enter(
    new NextRequest(`${ORIGIN}/api/volunteer/enter`, { method: "POST", headers: { "x-forwarded-for": freshClient() } }),
  );
  expect(response.status).toBe(200);
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    if (pair.startsWith(`${VOLUNTEER_COOKIE}=`)) return pair;
  }
  throw new Error("lh_vol 쿠키가 없다");
}
const volunteerOf = (cookie: string) => readVolunteerId(cookie.split("=")[1])!;

async function claimed() {
  const cookie = await signIn();
  await reset(new NextRequest(`${ORIGIN}/api/volunteer/demo/reset`, { method: "POST", headers: { "x-forwarded-for": freshClient(), cookie } }));
  const list = await (await queue(new NextRequest(`${ORIGIN}/api/volunteer/queue`, { headers: { "x-forwarded-for": freshClient(), cookie } }))).json();
  const id: string = list.waiting[0].requestId;
  const response = await claim(
    new NextRequest(`${ORIGIN}/api/volunteer/requests/${id}/claim`, { method: "POST", headers: { "x-forwarded-for": freshClient(), cookie } }),
    { params: Promise.resolve({ requestId: id }) },
  );
  expect(response.status).toBe(200);
  return { cookie, id };
}

type Method = "GET" | "POST" | "PUT" | "DELETE";
function req(path: string, method: Method, cookie: string | undefined, body?: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return new NextRequest(`${ORIGIN}/api/volunteer/requests/${path}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": freshClient(), ...headers, ...(cookie ? { cookie } : {}) },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ requestId: id }) });
const photoCtx = (id: string, photoId: string) => ({ params: Promise.resolve({ requestId: id, photoId }) });

// ---- 사진 자료: 서명(FF D8 FF)이 맞는 가짜 JPEG ----
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const jpegUrl = (extra = 0) => `data:image/jpeg;base64,${Buffer.concat([JPEG_BYTES, Buffer.alloc(extra, 1)]).toString("base64")}`;
const THUMB = jpegUrl(200);
const PNG_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")}`;

interface Opened {
  cookie: string;
  id: string;
  sessionId: string;
  version: number;
}
async function opened(): Promise<Opened> {
  const { cookie, id } = await claimed();
  const view = await (await getResearch(req(`${id}/research`, "GET", cookie, undefined, {}), ctx(id))).json();
  return { cookie, id, sessionId: view.sessionId, version: view.version };
}
const read = async (o: Opened) => (await getResearch(req(`${o.id}/research`, "GET", o.cookie, undefined, {}), ctx(o.id))).json();

let turnNo = 0;
/** 턴 한 번. 성공하면 o.version을 올린다. */
async function say(o: Opened, input: unknown) {
  const response = await turn(
    req(`${o.id}/research/turn`, "POST", o.cookie, { clientTurnId: `t-${(turnNo += 1)}`, sessionId: o.sessionId, baseVersion: o.version, input }),
    ctx(o.id),
  );
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  o.version = data.version;
  return data;
}

const photoBody = (o: Opened, extra: Record<string, unknown> = {}) => ({ sessionId: o.sessionId, image: jpegUrl(), thumb: THUMB, ...extra });
async function upload(o: Opened, extra: Record<string, unknown> = {}) {
  const response = await postPhoto(req(`${o.id}/research/photos`, "POST", o.cookie, photoBody(o, extra)), ctx(o.id));
  const data = await response.json();
  if (response.status === 201) o.version = data.version;
  return { response, data };
}
const review = (o: Opened) => postReview(req(`${o.id}/research/review`, "POST", o.cookie, { sessionId: o.sessionId }), ctx(o.id));
const confirm = (o: Opened, text: string, baseVersion = o.version) =>
  putReview(req(`${o.id}/research/review`, "PUT", o.cookie, { sessionId: o.sessionId, baseVersion, text }), ctx(o.id));
const send = (o: Opened, reviewRev: number, baseVersion = o.version, sessionId = o.sessionId) =>
  postSend(req(`${o.id}/research/send`, "POST", o.cookie, { sessionId, baseVersion, reviewRev }), ctx(o.id));

/** 구매함: 구매 → 기종 → 장점 → (질문 3: 사진) → 사진 올리기 → 건너뛰기 → 고른 이유. 질문 7까지 끝낸다. */
async function fillBought(o: Opened, options: { alts?: string } = {}) {
  await say(o, { type: "quick", replyId: "purchase.bought" });
  await say(o, { type: "text", text: "LH-200" });
  await say(o, { type: "text", text: "가벼워서 오래 써도 편해요" });
  const { response } = await upload(o);
  expect(response.status).toBe(201);
  if (options.alts) await say(o, { type: "edit", slot: "alts", text: options.alts });
  else await say(o, { type: "skip", slot: "alts" });
  await say(o, { type: "edit", slot: "altReason", text: "배터리가 더 오래간다고 해서 같이 봤어요" });
  await say(o, { type: "skip", slot: "benefits" });
  await say(o, { type: "skip", slot: "refs" });
}
/** 리서치만: 구매 → 기종 → 장점 → 건너뛰기 → 고른 이유. */
async function fillResearch(o: Opened) {
  await say(o, { type: "quick", replyId: "purchase.research" });
  await say(o, { type: "edit", slot: "model", text: "LH-200" });
  await say(o, { type: "edit", slot: "pros", text: "소리가 선명하대요" });
  await say(o, { type: "skip", slot: "alts" });
  await say(o, { type: "edit", slot: "altReason", text: "이 제품이 가장 많이 알려져 있어서요" });
  await say(o, { type: "skip", slot: "benefits" });
  await say(o, { type: "skip", slot: "refs" });
}

const EDITED =
  "LH-200은 직접 구매해서 쓰는 봉사자가 사진으로 인증한 헤드셋이에요. 가벼워서 오래 써도 편하고, 같이 본 제품보다 착용감이 좋다고 해요. 최신 판매 정보는 쇼핑몰에서 직접 확인해 주세요.";

const logs: string[] = [];
const logOf = (needle: string) => logs.filter((line) => line.includes(needle));

beforeEach(() => {
  vi.stubEnv("DEMO_ACCESS_CODE", "test-signing-secret");
  vi.stubEnv("STORE_MODE", "memory");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("LLM_MODE", "mock");
  vi.stubEnv("OPENAI_API_KEY", "fake-key");
  resetRequestStoresForTest();
  resetResearchStoresForTest();
  chatCreate.mockReset();
  responsesCreate.mockReset();
  logs.length = 0;
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST …/research/photos", () => {
  it("쿠키가 없으면 401, 형식이 틀린 본문은 400·413·415", async () => {
    const o = await opened();
    expect((await postPhoto(req(`${o.id}/research/photos`, "POST", undefined, photoBody(o)), ctx(o.id))).status).toBe(401);
    const send = (body: unknown, headers?: Record<string, string>) =>
      postPhoto(req(`${o.id}/research/photos`, "POST", o.cookie, body, headers), ctx(o.id));
    expect((await send(photoBody(o), { "content-type": "text/plain" })).status).toBe(415);
    expect((await send("{not json")).status).toBe(400);
    expect((await send({ sessionId: o.sessionId })).status).toBe(400);
    expect((await send(photoBody(o, { sessionId: "nope" }))).status).toBe(400);
    // 본문 2.2MB 초과
    const huge = await send({ ...photoBody(o), image: `data:image/jpeg;base64,${"A".repeat(2_400_000)}` });
    expect(huge.status).toBe(413);
  });

  it("이미지: 형식(415)·base64(400)·1.5MiB 초과(413)·서명 불일치(415), 썸네일: 60,000자 초과(413)·jpeg 아님(415)", async () => {
    const o = await opened();
    const send = async (extra: Record<string, unknown>) => {
      const response = await postPhoto(req(`${o.id}/research/photos`, "POST", o.cookie, photoBody(o, extra)), ctx(o.id));
      return [response.status, (await response.json()).error] as const;
    };
    expect(await send({ image: "data:image/gif;base64,R0lGODlh" })).toEqual([415, "bad_image_format"]);
    expect(await send({ image: "hello" })).toEqual([415, "bad_image_format"]);
    expect(await send({ image: "data:image/jpeg;base64,@@@@" })).toEqual([400, "invalid_request"]);
    // 서명이 맞아도 1.5MiB(1,572,864바이트)를 넘으면 413
    expect(await send({ image: jpegUrl(1_572_864) })).toEqual([413, "image_too_large"]);
    // 선언은 jpeg인데 PNG 바이트
    expect(await send({ image: `data:image/jpeg;base64,${PNG_URL.split(",")[1]}` })).toEqual([415, "bad_image_format"]);
    expect(await send({ thumb: `data:image/jpeg;base64,${"A".repeat(60_000)}` })).toEqual([413, "thumb_too_large"]);
    expect(await send({ thumb: PNG_URL })).toEqual([415, "bad_image_format"]);
    expect(await send({ thumb: "data:image/jpeg;base64,@@@" })).toEqual([415, "bad_image_format"]);
    // 선언은 jpeg이고 base64도 맞지만 실제 JPEG 서명이 아닌 썸네일(AAAA…)은 사진을 남기지 않는다
    expect(await send({ thumb: "data:image/jpeg;base64,AAAA" })).toEqual([415, "bad_image_format"]);
    // 거부된 요청은 사진을 남기지 않는다. PNG 이미지(서명이 맞음)는 받는다.
    expect((await read(o)).photos).toEqual([]);
    expect((await upload(o, { image: PNG_URL })).response.status).toBe(201);
  });

  it("기종 질문 중에 올리면 말풍선만 들어가고(다음 질문 없음), 사진 칸이 차서 구매 인증됨이 된다", async () => {
    const o = await opened();
    await say(o, { type: "quick", replyId: "purchase.bought" });
    const { response, data } = await upload(o);
    expect(response.status).toBe(201);
    expect(data.photo).toMatchObject({ thumb: THUMB, description: null });
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]).toMatchObject({ role: "volunteer", slot: "photo", body: { kind: "photo", photoId: data.photo.id } });
    expect(data.session).toMatchObject({ verified: true, stage: "chat", slots: { photo: { status: "filled" } } });
    const view = await read(o);
    expect(view.photos.map((photo: { id: string }) => photo.id)).toEqual([data.photo.id]);
    expect(view.photos[0].thumb).toBe(THUMB);
    expect(view.version).toBe(data.version);
    // AI를 부르지 않는다.
    expect(chatCreate).not.toHaveBeenCalled();
    expect(responsesCreate).not.toHaveBeenCalled();
    expect(logOf("research/photos").at(-1)).toMatch(/kind=photo ai=none in=0 out=0 ws=0$/);
  });

  it("사진 질문 직후에 올리면 말풍선 다음에 다음 질문(질문 4)이 온다", async () => {
    const o = await opened();
    await say(o, { type: "quick", replyId: "purchase.bought" });
    await say(o, { type: "text", text: "LH-200" });
    const asked = await say(o, { type: "text", text: "가벼워서 좋아요" });
    expect(asked.messages.at(-1)).toMatchObject({ slot: "photo", body: { text: PHOTO_QUESTION } });
    const { response, data } = await upload(o);
    expect(response.status).toBe(201);
    expect(data.messages.map((message: { slot: string; tag: string | null }) => [message.slot, message.tag])).toEqual([
      ["photo", null],
      ["alts", "question"],
    ]);
    expect(data.messages[0].seq).toBeLessThan(data.messages[1].seq);
    expect(data.lastSeq).toBe(data.messages[1].seq);
    // 같은 순서로 GET에도 있다.
    const view = await read(o);
    expect(view.messages.slice(-2).map((message: { seq: number }) => message.seq)).toEqual(data.messages.map((message: { seq: number }) => message.seq));
    // 다음 턴이 baseVersion을 이어받는다(사진이 version을 한 번만 올렸다).
    expect((await say(o, { type: "skip", slot: "alts" })).messages.at(-1)).toMatchObject({ slot: "altReason" });
  });

  it("히어로에서 사진을 먼저 올리면 다음은 구매 질문이다", async () => {
    const o = await opened();
    const { response, data } = await upload(o);
    expect(response.status).toBe(201);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[1]).toMatchObject({ tag: "question", slot: "purchase", body: { text: PURCHASE_QUESTION } });
    expect(data.session.stage).toBe("chat");
  });

  it("리서치만이면 409 photo_not_needed, 4번째는 409 photos_full, 지운 뒤 다시 올리면 요청당 6번에서 429", async () => {
    const research = await opened();
    await say(research, { type: "quick", replyId: "purchase.research" });
    const denied = await upload(research);
    expect(denied.response.status).toBe(409);
    expect(denied.data.error).toBe("photo_not_needed");

    const o = await opened();
    await say(o, { type: "quick", replyId: "purchase.bought" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await upload(o)).data.photo.id);
    const full = await upload(o);
    expect(full.response.status).toBe(409);
    expect(full.data.error).toBe("photos_full");
    for (const id of ids) {
      const removed = await deletePhoto(req(`${o.id}/research/photos/${id}`, "DELETE", o.cookie, undefined, {}), photoCtx(o.id, id));
      expect(removed.status).toBe(200);
    }
    for (let i = 0; i < 3; i += 1) expect((await upload(o)).response.status).toBe(201);
    const capped = await postPhoto(req(`${o.id}/research/photos`, "POST", o.cookie, photoBody(o, { sessionId: o.sessionId })), ctx(o.id));
    // 3장이 차 있어 photos_full이 먼저다. 지워서 자리를 만들면 요청당 6번째 상한이 막는다.
    expect((await capped.json()).error).toBe("photos_full");
    const view = await read(o);
    await deletePhoto(req(`${o.id}/research/photos/${view.photos[0].id}`, "DELETE", o.cookie, undefined, {}), photoCtx(o.id, view.photos[0].id));
    const over = await postPhoto(req(`${o.id}/research/photos`, "POST", o.cookie, photoBody(o, { sessionId: o.sessionId })), ctx(o.id));
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "photo_cap", cap: "request" });
  });

  it("다른 sessionId는 409 session_changed, 남의 요청은 403, 없는 요청은 404", async () => {
    const o = await opened();
    const wrong = await postPhoto(req(`${o.id}/research/photos`, "POST", o.cookie, photoBody(o, { sessionId: randomUUID() })), ctx(o.id));
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).error).toBe("session_changed");
    const other = await signIn();
    expect((await postPhoto(req(`${o.id}/research/photos`, "POST", other, photoBody(o)), ctx(o.id))).status).toBe(403);
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await postPhoto(req(`${missing}/research/photos`, "POST", other, photoBody(o)), ctx(missing))).status).toBe(404);
  });
});

describe("DELETE …/research/photos/{photoId}", () => {
  it("사진을 지우면 마지막 사진일 때 사진 칸도 비고 구매 인증이 풀린다", async () => {
    const o = await opened();
    await say(o, { type: "quick", replyId: "purchase.bought" });
    const first = (await upload(o)).data.photo.id;
    const second = (await upload(o)).data.photo.id;
    const one = await deletePhoto(req(`${o.id}/research/photos/${first}`, "DELETE", o.cookie, undefined, {}), photoCtx(o.id, first));
    expect(one.status).toBe(200);
    const afterOne = await one.json();
    expect(afterOne.session).toMatchObject({ verified: true, slots: { photo: { value: "1장" } } });
    const last = await deletePhoto(req(`${o.id}/research/photos/${second}?sessionId=${o.sessionId}`, "DELETE", o.cookie, undefined, {}), photoCtx(o.id, second));
    const data = await last.json();
    expect(last.status).toBe(200);
    expect(data.session.verified).toBe(false);
    expect(data.session.slots.photo).toBeUndefined();
    expect((await read(o)).photos).toEqual([]);
  });

  it("없는 사진은 404, 형식이 틀리면 400, 남의 요청 403, 다른 sessionId는 409", async () => {
    const o = await opened();
    await say(o, { type: "quick", replyId: "purchase.bought" });
    const photo = (await upload(o)).data.photo.id;
    const del = (cookie: string | undefined, photoId: string, query = "") =>
      deletePhoto(req(`${o.id}/research/photos/${photoId}${query}`, "DELETE", cookie, undefined, {}), photoCtx(o.id, photoId));
    expect((await del(undefined, photo)).status).toBe(401);
    expect((await del(o.cookie, randomUUID())).status).toBe(404);
    expect((await del(o.cookie, "nope")).status).toBe(400);
    expect((await del(o.cookie, photo, "?sessionId=nope")).status).toBe(400);
    expect((await del(o.cookie, photo, `?sessionId=${randomUUID()}`)).status).toBe(409);
    expect((await del(await signIn(), photo)).status).toBe(403);
  });
});

describe("POST …/research/review", () => {
  it("라우트 설정: maxDuration 60", () => {
    expect(reviewMaxDuration).toBe(60);
  });

  it("필수가 비면 409 missing_required(빠진 칸 목록), 구매가 안 정해지면 purchase가 맨 앞", async () => {
    const o = await opened();
    const first = await review(o);
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ error: "missing_required", missing: ["purchase", "model", "pros", "altReason"] });
    await say(o, { type: "quick", replyId: "purchase.bought" });
    expect((await (await review(o)).json()).missing).toEqual(["model", "pros", "altReason", "photo"]);
  });

  it("필수는 찼어도 질문 7을 지나지 않았으면 409 not_ready", async () => {
    const o = await opened();
    await say(o, { type: "quick", replyId: "purchase.research" });
    await say(o, { type: "edit", slot: "model", text: "LH-200" });
    await say(o, { type: "edit", slot: "pros", text: "소리가 선명하대요" });
    await say(o, { type: "edit", slot: "altReason", text: "그냥 이 제품이 좋아서요" });
    const response = await review(o);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("not_ready");
  });

  it("가짜 AI: 검사를 통과한 문단이 draft로 저장되고 단계가 review가 된다", async () => {
    const o = await opened();
    await fillBought(o);
    const response = await review(o);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ ai: "ok", review: { status: "draft", rev: 1 } });
    expect(data.review.text).toContain("LH-200");
    expect(data.review.text).toContain("사진으로 인증");
    expect(data.review.text).not.toMatch(/https?:|[0-9],[0-9]{3}/);
    const view = await read(o);
    expect(view.stage).toBe("review");
    expect(view.review).toMatchObject({ status: "draft", rev: 1, text: data.review.text });
    expect(logOf("research/review").at(-1)).toMatch(/kind=review ai=ok in=0 out=0 ws=0$/);
    // 다시 만들면 rev가 오른다.
    expect((await (await review(o)).json()).review.rev).toBe(2);
  });

  it("쿠키 없음 401, 남의 요청 403, 다른 sessionId 409, 본문 오류 400", async () => {
    const o = await opened();
    await fillResearch(o);
    expect((await postReview(req(`${o.id}/research/review`, "POST", undefined, { sessionId: o.sessionId }), ctx(o.id))).status).toBe(401);
    expect((await postReview(req(`${o.id}/research/review`, "POST", await signIn(), { sessionId: o.sessionId }), ctx(o.id))).status).toBe(403);
    expect((await postReview(req(`${o.id}/research/review`, "POST", o.cookie, { sessionId: randomUUID() }), ctx(o.id))).status).toBe(409);
    expect((await postReview(req(`${o.id}/research/review`, "POST", o.cookie, {}), ctx(o.id))).status).toBe(400);
    expect((await postReview(req(`${o.id}/research/review`, "POST", o.cookie, "{", JSON_HEADERS), ctx(o.id))).status).toBe(400);
  });

  describe("실제 모드(openai 모듈을 가짜로 바꾼 호출)", () => {
    // 대화는 가짜 모드로 채우고(fillBought), 리뷰 호출만 실제 모드로 바꿔 부른다.
    const goLive = () => vi.stubEnv("LLM_MODE", "");
    const reply = (text: string) => ({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ text }) } }],
      usage: { prompt_tokens: 410, completion_tokens: 120 },
    });
    const GOOD =
      "LH-200은 직접 구매해서 쓰는 봉사자가 사진으로 인증한 헤드셋이에요. 가벼워서 오래 써도 편하다고 해요. 같이 본 제품은 배터리가 더 오래간다고 해서 비교했어요. 구매 인증 사진은 한 장 올라와 있어요. 이 내용은 봉사자가 모은 자료를 정리한 것이라서 최신 판매 정보는 쇼핑몰에서 직접 확인해 주세요.";

    it("AI 문단이 검사를 통과하면 ai=ok이고 AI는 한 번만 부른다(로그에 토큰 수)", async () => {
      chatCreate.mockResolvedValueOnce(reply(GOOD));
      const o = await opened();
      await fillBought(o);
      goLive();
      const data = await (await review(o)).json();
      expect(data).toMatchObject({ ai: "ok", review: { status: "draft", text: GOOD } });
      expect(chatCreate).toHaveBeenCalledTimes(1);
      const params = chatCreate.mock.calls[0][0];
      expect(params).toMatchObject({ reasoning_effort: "none", temperature: 0, response_format: { type: "json_object" } });
      // 봉사자 칸은 지시가 아니라 자료로만 들어가고, 주소·전화번호·화면이 준 글은 들어가지 않는다.
      expect(params.messages[0].content).toContain("VoiceOver");
      expect(params.messages[1].content).toContain("가벼워서 오래 써도 편해요");
      expect(logOf("research/review").at(-1)).toMatch(/kind=review ai=ok in=410 out=120 ws=0$/);
    });

    it("가격·재고를 지어낸 AI 문단은 버리고 서버 틀 문단으로 대신한다(ai=fallback, up=empty)", async () => {
      chatCreate.mockResolvedValueOnce(reply(`${GOOD} 지금 29,000원에 팔고 재고도 넉넉해요.`));
      const o = await opened();
      await fillBought(o);
      goLive();
      const data = await (await review(o)).json();
      expect(data.ai).toBe("fallback");
      expect(data.review.text).toContain("리뷰 대상 기종은 LH-200");
      expect(data.review.text).not.toMatch(/29,000|재고/);
      expect(logOf("research/review").at(-1)).toContain("up=empty");
    });

    it("자료에 없는 기종 이름이 든 AI 문단도 틀 문단으로 대신한다", async () => {
      chatCreate.mockResolvedValueOnce(reply(GOOD.replace("같이 본 제품은", "WH-1000XM9은")));
      const o = await opened();
      await fillBought(o);
      goLive();
      const data = await (await review(o)).json();
      expect(data.ai).toBe("fallback");
      expect(data.review.text).not.toContain("WH-1000XM9");
    });

    it("너무 짧거나 목록이거나 JSON이 아니면 틀 문단", async () => {
      const o = await opened();
      await fillBought(o);
      goLive();
      chatCreate.mockResolvedValueOnce(reply("좋은 제품이에요."));
      expect((await (await review(o)).json()).ai).toBe("fallback");
      chatCreate.mockResolvedValueOnce(reply(`- ${GOOD}`));
      expect((await (await review(o)).json()).ai).toBe("fallback");
      chatCreate.mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: "죄송합니다" } }] });
      expect((await (await review(o)).json()).ai).toBe("fallback");
    });

    it("호출이 실패하면(429) 틀 문단이고 원인이 로그에 남는다", async () => {
      const o = await opened();
      await fillBought(o);
      goLive();
      chatCreate.mockRejectedValueOnce(Object.assign(new Error("limit"), { status: 429 }));
      const failed = await (await review(o)).json();
      expect(failed.ai).toBe("fallback");
      expect(logOf("research/review").at(-1)).toContain("up=429");
      expect(failed.review.text).toContain("LH-200");
    });

    it("요청당 리뷰 3번을 넘으면 AI를 부르지 않고 틀 문단(ai=capped)", async () => {
      chatCreate.mockResolvedValue(reply(GOOD));
      const o = await opened();
      await fillBought(o);
      goLive();
      for (let i = 0; i < 3; i += 1) expect((await (await review(o)).json()).ai).toBe("ok");
      const fourth = await (await review(o)).json();
      expect(fourth.ai).toBe("capped");
      expect(fourth.review.status).toBe("draft");
      expect(chatCreate).toHaveBeenCalledTimes(3);
      expect(logOf("research/review").at(-1)).toContain("cap=request");
    });
  });
});

describe("PUT …/research/review", () => {
  it("검수를 마치면 confirmed(rev가 오른다)이고, 칸을 고치면 draft로 돌아간다", async () => {
    const o = await opened();
    await fillBought(o);
    expect((await (await review(o)).json()).review.rev).toBe(1);
    const response = await confirm(o, EDITED);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.review).toMatchObject({ status: "confirmed", text: EDITED, rev: 2 });
    expect((await read(o)).review).toMatchObject({ status: "confirmed", rev: 2 });
    expect(logOf("research/review").at(-1)).toMatch(/kind=review_edit ai=none in=0 out=0 ws=0$/);
    // 칸이 바뀌면 draft로 돌아가고 rev가 오른다(SQL·메모리 저장소가 한다).
    await say(o, { type: "edit", slot: "pros", text: "가볍고 소리도 좋아요" });
    expect((await read(o)).review).toMatchObject({ status: "draft", rev: 3, text: EDITED });
    // 사진을 지워도 draft로 돌아간다.
    expect((await confirm(o, EDITED)).status).toBe(200);
    const photo = (await read(o)).photos[0].id;
    await deletePhoto(req(`${o.id}/research/photos/${photo}`, "DELETE", o.cookie, undefined, {}), photoCtx(o.id, photo));
    expect((await read(o)).review.status).toBe("draft");
  });

  it("422 review_blocked: 가격·전화번호·주소·자료에 없는 기종·길이는 이유와 함께 막는다", async () => {
    const o = await opened();
    await fillBought(o);
    const blocked = async (text: string) => {
      const response = await confirm(o, text);
      expect(response.status, text).toBe(422);
      const data = await response.json();
      expect(data.error).toBe("review_blocked");
      expect(Array.isArray(data.reasons) && data.reasons.length > 0).toBe(true);
      return data.reasons.join(" / ") as string;
    };
    expect(await blocked(`${EDITED} 29,000원이었어요.`)).toContain("가격·재고·할인");
    expect(await blocked(`${EDITED} 전화는 010-1234-5678 이에요.`)).toContain("전화번호");
    expect(await blocked(`${EDITED} https://shop.example.com/a 에서 샀어요.`)).toContain("주소");
    expect(await blocked(`${EDITED} WH-1000XM9도 좋아요.`)).toContain("WH-1000XM9");
    expect(await blocked("너무 짧아요.")).toContain("50자 이상");
    expect(await blocked("가".repeat(1001))).toContain("1,000자 이하");
    // 문장 수(3~7)와 목록·기호는 AI 문단과 같이 건다
    expect(await blocked("LH-200은 직접 구매해서 쓰는 봉사자가 사진으로 인증한 헤드셋이고 가볍고 편하다고 해요")).toContain("문장이");
    expect(await blocked(`${EDITED}
- 가볍다
- 소리가 선명하다`)).toContain("목록이나 기호");
    // 막힌 문단은 저장되지 않는다.
    expect((await read(o)).review).toEqual({});
    // 가격 유도 문구가 칸에 있어도 봉사자가 고쳐 통과하면 저장된다.
    expect((await confirm(o, EDITED)).status).toBe(200);
  });

  it("필수 칸이 비었으면 API로도 검수를 마칠 수 없다(409 missing_required)", async () => {
    const o = await opened();
    const response = await confirm(o, EDITED, o.version);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "missing_required" });
  });

  it("409 stale: baseVersion이 다르면 현재 version을 준다. 형식이 틀리면 400", async () => {
    const o = await opened();
    await fillBought(o);
    const stale = await confirm(o, EDITED, o.version - 1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale", version: o.version });
    const bad = (body: unknown) => putReview(req(`${o.id}/research/review`, "PUT", o.cookie, body), ctx(o.id));
    expect((await bad({ sessionId: o.sessionId, baseVersion: "3", text: EDITED })).status).toBe(400);
    expect((await bad({ sessionId: o.sessionId, baseVersion: -1, text: EDITED })).status).toBe(400);
    expect((await bad({ sessionId: o.sessionId, baseVersion: o.version })).status).toBe(400);
    expect((await bad({ sessionId: randomUUID(), baseVersion: o.version, text: EDITED })).status).toBe(409);
    expect((await putReview(req(`${o.id}/research/review`, "PUT", await signIn(), { sessionId: o.sessionId, baseVersion: o.version, text: EDITED }), ctx(o.id))).status).toBe(403);
  });
});

describe("POST …/research/send", () => {
  it("필수가 비면 409 missing_required, 기준 version이 다르면 409 stale", async () => {
    const o = await opened();
    const missing = await send(o, 0);
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ error: "missing_required", missing: ["purchase", "model", "pros", "altReason"] });
    const stale = await send(o, 0, 9);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale", version: 0 });
  });

  it("검수 전에는 409 review_not_confirmed(draft도 안 된다), 틀린 rev도 안 된다", async () => {
    const o = await opened();
    await fillBought(o);
    expect((await (await send(o, 0)).json()).error).toBe("review_not_confirmed");
    const draft = (await (await review(o)).json()).review;
    expect((await (await send(o, draft.rev)).json()).error).toBe("review_not_confirmed");
    const confirmed = (await (await confirm(o, EDITED)).json()).review;
    expect((await (await send(o, confirmed.rev + 1)).json()).error).toBe("review_not_confirmed");
  });

  it("구매함: 201로 보내고 결과 모양이 한도 안이다. 다시 보내면 200으로 같은 값, 그 뒤 GET은 sent", async () => {
    const o = await opened();
    await fillBought(o, { alts: "LH-300" });
    await review(o);
    const confirmed = (await (await confirm(o, EDITED)).json()).review;
    const first = await send(o, confirmed.rev);
    expect(first.status).toBe(201);
    const sent = await first.json();
    expect(sent).toMatchObject({ status: "done" });
    expect(typeof sent.sentAt).toBe("string");

    const detail = await getRequestStore().getForVolunteer(o.id, volunteerOf(o.cookie));
    expect(detail.kind).toBe("ok");
    const result = detail.kind === "ok" ? detail.result : null;
    expect(result?.sentAt).toBe(sent.sentAt);
    const candidates = result?.candidates ?? [];
    expect(candidates.map((candidate) => candidate.name)).toEqual(["LH-200", "LH-300"]);
    expect(candidates[0].guide).toBe(EDITED);
    expect(candidates[0].summary.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["구분", "구매 인증", "장점", "사진", "같이 고민한 제품", "고민한 이유"]),
    );
    expect(candidates[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("구매 인증됨");
    for (const candidate of candidates) expect(checkCandidate(candidate).ok).toBe(true);

    const again = await send(o, confirmed.rev);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "done", sentAt: sent.sentAt });
    // 다른 sessionId로 다시 불러도(대화는 이미 지워졌다) 처음 값을 준다.
    const lateRetry = await send(o, confirmed.rev, o.version, randomUUID());
    expect(lateRetry.status).toBe(200);
    expect((await lateRetry.json()).sentAt).toBe(sent.sentAt);
    expect(await read(o)).toMatchObject({ stage: "sent", sentAt: sent.sentAt, messages: [], photos: [] });
  });

  it("리서치만: 사진 없이 보낼 수 있고 구매 인증이 아니라 리서치만으로 적힌다", async () => {
    const o = await opened();
    await fillResearch(o);
    await review(o);
    const confirmed = (await (await confirm(o, EDITED)).json()).review;
    expect((await send(o, confirmed.rev)).status).toBe(201);
    const detail = await getRequestStore().getForVolunteer(o.id, volunteerOf(o.cookie));
    const candidates = detail.kind === "ok" ? (detail.result?.candidates ?? []) : [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].summary.find((entry) => entry.label === "구매 인증")?.value).toBe("리서치만");
    expect(candidates[0].summary.some((entry) => entry.label === "사진")).toBe(false);
  });

  it("사진을 지워 칸이 비면(구매함) 검수가 풀리고 보낼 수 없다", async () => {
    const o = await opened();
    await fillBought(o);
    await review(o);
    const confirmed = (await (await confirm(o, EDITED)).json()).review;
    const photo = (await read(o)).photos[0].id;
    const removed = await (await deletePhoto(req(`${o.id}/research/photos/${photo}`, "DELETE", o.cookie, undefined, {}), photoCtx(o.id, photo))).json();
    o.version = removed.version;
    const response = await send(o, confirmed.rev + 1);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "missing_required", missing: ["photo"] });
  });

  it("남의 요청 403, 쿠키 없음 401, 형식 오류 400, 다른 sessionId 409", async () => {
    const o = await opened();
    await fillResearch(o);
    const body = { sessionId: o.sessionId, baseVersion: o.version, reviewRev: 1 };
    expect((await postSend(req(`${o.id}/research/send`, "POST", undefined, body), ctx(o.id))).status).toBe(401);
    expect((await postSend(req(`${o.id}/research/send`, "POST", await signIn(), body), ctx(o.id))).status).toBe(403);
    expect((await postSend(req(`${o.id}/research/send`, "POST", o.cookie, { ...body, reviewRev: "1" }), ctx(o.id))).status).toBe(400);
    expect((await postSend(req(`${o.id}/research/send`, "POST", o.cookie, { ...body, sessionId: "nope" }), ctx(o.id))).status).toBe(400);
    expect((await send(o, 1, o.version, randomUUID())).status).toBe(409);
  });
});
