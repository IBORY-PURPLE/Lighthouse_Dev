import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as enter } from "@/app/api/volunteer/enter/route";
import { POST as reset } from "@/app/api/volunteer/demo/reset/route";
import { GET as queue } from "@/app/api/volunteer/queue/route";
import { POST as claim } from "@/app/api/volunteer/requests/[requestId]/claim/route";
import { GET as getResearch } from "@/app/api/volunteer/requests/[requestId]/research/route";
import { DELETE as revokeLink, POST as issueLink } from "@/app/api/volunteer/requests/[requestId]/research/photo-link/route";
import { POST as turn } from "@/app/api/volunteer/requests/[requestId]/research/turn/route";
import { GET as phoneCheck, POST as phoneUpload } from "@/app/api/volunteer/photo/route";
import { POST as redeem } from "@/app/api/volunteer/photo/redeem/route";
import { resetRequestStoresForTest } from "@/lib/requestStore";
import { resetResearchStoresForTest } from "@/lib/researchStore";
import { VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

// 휴대폰 사진 라우트(PR4): 링크 만들기·끊기, redeem(Origin·JSON·한 번만), lh_photo 열쇠로 올리기·확인.
// 가짜 AI(LLM_MODE=mock)와 메모리 저장소로 돈다. 시각은 가짜 시계(Date만)로 앞당긴다.

const ORIGIN = "http://localhost:3000";
const JSON_HEADERS = { "content-type": "application/json" };

let counter = 0;
const freshClient = () => `198.51.100.${(counter += 1) % 250}-${randomUUID()}`;

async function signIn() {
  const response = await enter(
    new NextRequest(`${ORIGIN}/api/volunteer/enter`, { method: "POST", headers: { "x-forwarded-for": freshClient() } }),
  );
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    if (pair.startsWith(`${VOLUNTEER_COOKIE}=`)) return pair;
  }
  throw new Error("lh_vol 쿠키가 없다");
}

/** 시연 요청 하나를 맡는다. again이면 시연 초기화를 건너뛰어(앞 요청을 지우지 않고) 다음 대기 요청을 다른 봉사자로 맡는다. */
async function claimed(again = false) {
  const cookie = await signIn();
  if (!again) await reset(new NextRequest(`${ORIGIN}/api/volunteer/demo/reset`, { method: "POST", headers: { "x-forwarded-for": freshClient(), cookie } }));
  const list = await (await queue(new NextRequest(`${ORIGIN}/api/volunteer/queue`, { headers: { "x-forwarded-for": freshClient(), cookie } }))).json();
  const id: string = list.waiting[0].requestId;
  const response = await claim(
    new NextRequest(`${ORIGIN}/api/volunteer/requests/${id}/claim`, { method: "POST", headers: { "x-forwarded-for": freshClient(), cookie } }),
    { params: Promise.resolve({ requestId: id }) },
  );
  expect(response.status).toBe(200);
  return { cookie, id };
}

const ctx = (id: string) => ({ params: Promise.resolve({ requestId: id }) });

function laptop(path: string, method: string, cookie: string | undefined, body?: unknown) {
  return new NextRequest(`${ORIGIN}/api/volunteer/requests/${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": freshClient(), ...JSON_HEADERS, ...(cookie ? { cookie } : {}) },
  });
}

function phone(path: string, method: string, options: { cookie?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) {
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  return new NextRequest(`${ORIGIN}/api/volunteer/${path}`, {
    method,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    headers: {
      "x-forwarded-for": freshClient(),
      ...(options.body === undefined ? {} : JSON_HEADERS),
      ...(origin ? { origin } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
  });
}

interface Opened {
  cookie: string;
  id: string;
  sessionId: string;
}
async function opened(again = false): Promise<Opened> {
  const { cookie, id } = await claimed(again);
  const view = await (await getResearch(laptop(`${id}/research`, "GET", cookie), ctx(id))).json();
  return { cookie, id, sessionId: view.sessionId };
}
const readView = async (o: Opened) => (await getResearch(laptop(`${o.id}/research`, "GET", o.cookie), ctx(o.id))).json();
const makeLink = (o: Opened, sessionId = o.sessionId) =>
  issueLink(laptop(`${o.id}/research/photo-link`, "POST", o.cookie, { sessionId }), ctx(o.id));

async function newToken(o: Opened): Promise<string> {
  const response = await makeLink(o);
  expect(response.status).toBe(201);
  return (await response.json()).token as string;
}

/** 링크를 만들고 휴대폰이 쓴다. lh_photo 쿠키 문자열을 돌려준다. */
async function connect(o: Opened): Promise<string> {
  const token = await newToken(o);
  const response = await redeem(phone("photo/redeem", "POST", { body: { token } }));
  expect(response.status).toBe(200);
  const raw = response.headers.getSetCookie().find((line) => line.startsWith("lh_photo="));
  expect(raw).toBeTruthy();
  return (raw as string).split(";")[0];
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const jpegUrl = (extra = 0) => `data:image/jpeg;base64,${Buffer.concat([JPEG_BYTES, Buffer.alloc(extra, 1)]).toString("base64")}`;
const upload = (cookie: string | undefined, extra: Record<string, unknown> = {}) =>
  phoneUpload(phone("photo", "POST", { cookie, body: { image: jpegUrl(), thumb: jpegUrl(200), ...extra } }));

const logs: string[] = [];

beforeEach(() => {
  vi.stubEnv("DEMO_ACCESS_CODE", "test-signing-secret");
  vi.stubEnv("STORE_MODE", "memory");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("LLM_MODE", "mock");
  resetRequestStoresForTest();
  resetResearchStoresForTest();
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

describe("POST …/research/photo-link", () => {
  it("쿠키가 없으면 401, 본문이 틀리면 400·415", async () => {
    const o = await opened();
    expect((await issueLink(laptop(`${o.id}/research/photo-link`, "POST", undefined, { sessionId: o.sessionId }), ctx(o.id))).status).toBe(401);
    expect((await makeLink(o, "not-a-uuid")).status).toBe(400);
    const noType = new NextRequest(`${ORIGIN}/api/volunteer/requests/${o.id}/research/photo-link`, {
      method: "POST",
      body: "{}",
      headers: { cookie: o.cookie, "x-forwarded-for": freshClient() },
    });
    expect((await issueLink(noType, ctx(o.id))).status).toBe(415);
  });

  it("토큰 원문을 한 번 주고, 읽기 응답이 waiting과 만료 시각을 보인다", async () => {
    const o = await opened();
    expect(await readView(o)).toMatchObject({ photoLink: { state: "none", expiresAt: null } });
    const response = await makeLink(o);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await readView(o);
    expect(view.photoLink.state).toBe("waiting");
    expect(Date.parse(view.photoLink.expiresAt)).toBe(Date.parse(body.expiresAt));
    // 토큰 원문은 어느 응답에도 다시 나오지 않고 로그에도 없다.
    expect(JSON.stringify(view)).not.toContain(body.token);
    expect(logs.join("\n")).not.toContain(body.token);
  });

  it("다른 세션이면 409 session_changed, 남의 요청이면 403, 리서치만이면 409 photo_not_needed", async () => {
    const o = await opened();
    const other = await opened(true);
    expect((await makeLink(o, randomUUID())).status).toBe(409);
    const foreign = await issueLink(laptop(`${o.id}/research/photo-link`, "POST", other.cookie, { sessionId: o.sessionId }), ctx(o.id));
    expect(foreign.status).toBe(403);

    const purchase = await turn(
      laptop(`${o.id}/research/turn`, "POST", o.cookie, {
        clientTurnId: "t-1", sessionId: o.sessionId, baseVersion: 0, input: { type: "quick", replyId: "purchase.research" },
      }),
      ctx(o.id),
    );
    expect(purchase.status).toBe(200);
    const blocked = await makeLink(o);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("photo_not_needed");
  });

  it("분당 6번을 넘으면 429", async () => {
    const o = await opened();
    for (let i = 0; i < 6; i += 1) expect((await makeLink(o)).status).toBe(201);
    expect((await makeLink(o)).status).toBe(429);
  });
});

describe("POST /api/volunteer/photo/redeem", () => {
  it("같은 사이트 Origin이 아니면 403, JSON이 아니면 415, 토큰 모양이 틀리면 400", async () => {
    const o = await opened();
    const token = await newToken(o);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token }, origin: null }))).status).toBe(403);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token }, origin: "https://evil.example" }))).status).toBe(403);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token }, origin: "null" }))).status).toBe(403);
    const form = new NextRequest(`${ORIGIN}/api/volunteer/photo/redeem`, {
      method: "POST",
      body: `token=${token}`,
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshClient() },
    });
    expect((await redeem(form)).status).toBe(415);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token: "short" } }))).status).toBe(400);
    expect((await redeem(phone("photo/redeem", "POST", { body: "not json" }))).status).toBe(400);
    // 위 실패는 링크를 쓰지 않았다.
    expect((await redeem(phone("photo/redeem", "POST", { body: { token } }))).status).toBe(200);
  });

  it("열쇠 쿠키는 HttpOnly·SameSite=Strict·Path=/api/volunteer/photo·30분이고 두 번째는 410", async () => {
    const o = await opened();
    const token = await newToken(o);
    const response = await redeem(phone("photo/redeem", "POST", { body: { token } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith("lh_photo=")) as string;
    expect(cookie).toMatch(/^lh_photo=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Path=\/api\/volunteer\/photo(;|$)/);
    expect(cookie).toMatch(/Max-Age=1800/i);
    // http 로컬에서는 Secure를 켜지 않는다(Vercel·https에서만).
    expect(cookie).not.toMatch(/Secure/i);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain(token);

    const second = await redeem(phone("photo/redeem", "POST", { body: { token } }));
    expect(second.status).toBe(410);
    expect((await second.json()).error).toBe("expired_or_revoked");
    expect(second.headers.getSetCookie()).toEqual([]);
  });

  it("https에서는 Secure를 켠다", async () => {
    const o = await opened();
    const token = await newToken(o);
    const request = new NextRequest("https://localhost:3000/api/volunteer/photo/redeem", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { ...JSON_HEADERS, origin: "https://localhost:3000", "x-forwarded-for": freshClient() },
    });
    const response = await redeem(request);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().find((line) => line.startsWith("lh_photo="))).toMatch(/Secure/i);
  });

  it("모르는 링크·10분 지난 링크·새로 만들어 끊긴 링크는 410", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const o = await opened();
    const unknown = "A".repeat(43);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token: unknown } }))).status).toBe(410);

    const old = await newToken(o);
    const latest = await newToken(o);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token: old } }))).status).toBe(410);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    expect((await redeem(phone("photo/redeem", "POST", { body: { token: latest } }))).status).toBe(410);
  });

  it("접속 주소별로 분당 20번을 넘으면 429", async () => {
    const same = "203.0.113.77-limit";
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await redeem(phone("photo/redeem", "POST", { body: { token: "A".repeat(43) }, headers: { "x-forwarded-for": same } }));
      last = response.status;
    }
    expect(last).toBe(429);
  });
});

describe("휴대폰 GET·POST /api/volunteer/photo", () => {
  it("열쇠가 없거나 틀리면 410, 있으면 200", async () => {
    const o = await opened();
    expect((await phoneCheck(phone("photo", "GET"))).status).toBe(410);
    expect((await phoneCheck(phone("photo", "GET", { cookie: `lh_photo=${"B".repeat(43)}` }))).status).toBe(410);
    expect((await phoneCheck(phone("photo", "GET", { cookie: "lh_photo=short" }))).status).toBe(410);
    // 봉사자 쿠키(lh_vol)로는 열 수 없다.
    expect((await phoneCheck(phone("photo", "GET", { cookie: o.cookie }))).status).toBe(410);
    const grant = await connect(o);
    const ok = await phoneCheck(phone("photo", "GET", { cookie: grant }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    expect((await readView(o)).photoLink.state).toBe("connected");
  });

  it("사진을 올리면 노트북 대화에 사진 말풍선과 칸이 생기고 휴대폰 응답은 {ok:true}만 준다", async () => {
    const o = await opened();
    const grant = await connect(o);
    const response = await upload(grant);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    const view = await readView(o);
    expect(view.photos).toHaveLength(1);
    expect(view.photos[0].thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(view.slots.photo).toMatchObject({ status: "filled", by: "volunteer" });
    const bubble = view.messages.find((m: { slot: string; body: { kind?: string } }) => m.slot === "photo" && m.body.kind === "photo");
    expect(bubble?.role).toBe("volunteer");
    expect(bubble?.body.photoId).toBe(view.photos[0].id);
    // 노트북은 ?after로도 새 말풍선을 받는다.
    const after = await (await getResearch(laptop(`${o.id}/research?after=0`, "GET", o.cookie), ctx(o.id))).json();
    expect(after.messages.some((m: { body: { kind?: string } }) => m.body.kind === "photo")).toBe(true);
  });

  it("본문의 sessionId·requestId는 믿지 않고 열쇠가 가리키는 세션에 올린다", async () => {
    const a = await opened();
    const b = await opened(true);
    const grant = await connect(a);
    expect((await upload(grant, { sessionId: b.sessionId, requestId: b.id })).status).toBe(201);
    expect((await readView(a)).photos).toHaveLength(1);
    expect((await readView(b)).photos).toHaveLength(0);
  });

  it("검사: 크기·형식은 노트북과 같고, 사진이 3장이면 409 photos_full", async () => {
    const o = await opened();
    const grant = await connect(o);
    expect((await upload(grant, { image: "data:text/plain;base64,AAAA" })).status).toBe(415);
    expect((await upload(grant, { thumb: "data:image/jpeg;base64,AAAA" })).status).toBe(415);
    expect((await phoneUpload(phone("photo", "POST", { cookie: grant, body: { image: jpegUrl() } }))).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await upload(grant)).status).toBe(201);
    const full = await upload(grant);
    expect(full.status).toBe(409);
    expect((await full.json()).error).toBe("photos_full");
  });

  it("노트북이 새 링크를 만들거나 끊으면 옛 열쇠는 410이다", async () => {
    const o = await opened();
    const first = await connect(o);
    expect((await upload(first)).status).toBe(201);
    await newToken(o);
    const gone = await upload(first);
    expect(gone.status).toBe(410);
    expect((await gone.json()).error).toBe("expired_or_revoked");
    expect((await phoneCheck(phone("photo", "GET", { cookie: first }))).status).toBe(410);

    const second = await connect(o);
    const del = await revokeLink(laptop(`${o.id}/research/photo-link?sessionId=${o.sessionId}`, "DELETE", o.cookie), ctx(o.id));
    expect(del.status).toBe(200);
    expect((await del.json()).revoked).toBeGreaterThanOrEqual(1);
    expect((await upload(second)).status).toBe(410);
    expect((await readView(o)).photoLink.state).toBe("none");
  });

  it("30분이 지나면 410, 요청을 내려놓아도 410", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const o = await opened();
    const grant = await connect(o);
    vi.setSystemTime(Date.now() + 30 * 60_000 - 1000);
    expect((await upload(grant)).status).toBe(201);
    vi.setSystemTime(Date.now() + 2000);
    expect((await upload(grant)).status).toBe(410);
    expect((await readView(o)).photoLink.state).toBe("expired");

    const p = await opened();
    const second = await connect(p);
    const released = await (await import("@/app/api/volunteer/requests/[requestId]/release/route")).POST(
      laptop(`${p.id}/release`, "POST", p.cookie),
      ctx(p.id),
    );
    expect(released.status).toBe(200);
    expect((await upload(second)).status).toBe(410);
  });

  it("열쇠가 가리키는 봉사자별로 분당 10번을 넘으면 429", async () => {
    const o = await opened();
    const grant = await connect(o);
    let status = 0;
    for (let i = 0; i < 11; i += 1) status = (await phoneCheck(phone("photo", "GET", { cookie: grant }))).status;
    expect(status).toBe(429);
  });

  it("로그에 토큰·열쇠·ID가 남지 않는다", async () => {
    const o = await opened();
    const token = await newToken(o);
    const redeemed = await redeem(phone("photo/redeem", "POST", { body: { token } }));
    const grant = redeemed.headers.getSetCookie().find((line) => line.startsWith("lh_photo="))!.split(";")[0];
    await upload(grant);
    const text = logs.join("\n");
    expect(text).toContain("POST /api/volunteer/photo/redeem 200");
    expect(text).toContain("POST /api/volunteer/photo 201");
    expect(text).not.toContain(token);
    expect(text).not.toContain(grant.split("=")[1]);
    expect(text).not.toContain(o.id);
  });
});
