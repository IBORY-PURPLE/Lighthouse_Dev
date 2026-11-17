import { randomUUID } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as enter } from "@/app/api/volunteer/enter/route";
import { POST as reset } from "@/app/api/volunteer/demo/reset/route";
import { GET as me } from "@/app/api/volunteer/me/route";
import { GET as queue } from "@/app/api/volunteer/queue/route";
import { POST as claim } from "@/app/api/volunteer/requests/[requestId]/claim/route";
import { POST as release } from "@/app/api/volunteer/requests/[requestId]/release/route";
import { GET as detail } from "@/app/api/volunteer/requests/[requestId]/route";
import { resetRequestStoresForTest } from "@/lib/requestStore";
import { readVolunteerId, VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

const ORIGIN = "http://localhost:3000";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let counter = 0;
const freshClient = () => `203.0.113.${(counter += 1) % 250}-${randomUUID()}`;

function enterRequest(
  body: unknown,
  { client = freshClient(), cookie }: { client?: string; cookie?: string } = {},
) {
  return new NextRequest(`${ORIGIN}/api/volunteer/enter`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client, ...(cookie ? { cookie } : {}) },
  });
}

/** Set-Cookie 한 줄들 → {이름: {value, attributes 원문}}. */
function setCookies(response: NextResponse) {
  const result: Record<string, { value: string; raw: string }> = {};
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    result[pair.slice(0, index)] = { value: pair.slice(index + 1), raw };
  }
  return result;
}

/** 입장해서 lh_vol 쿠키 헤더를 돌려준다. */
async function signIn() {
  const response = await enter(enterRequest(undefined));
  expect(response.status).toBe(200);
  const cookies = setCookies(response);
  return `${VOLUNTEER_COOKIE}=${cookies[VOLUNTEER_COOKIE].value}`;
}

function get(handler: typeof queue | typeof me, path: string, cookie?: string) {
  return handler(
    new NextRequest(`${ORIGIN}${path}`, {
      headers: { "x-forwarded-for": freshClient(), ...(cookie ? { cookie } : {}) },
    }),
  );
}

function idRoute<
  T extends typeof claim | typeof release | typeof detail,
>(
  handler: T,
  method: "GET" | "POST",
  id: string,
  cookie?: string,
) {
  return handler(
    new NextRequest(`${ORIGIN}/api/volunteer/requests/${id}`, {
      method,
      headers: { "x-forwarded-for": freshClient(), ...(cookie ? { cookie } : {}) },
    }),
    { params: Promise.resolve({ requestId: id }) },
  );
}

function post(handler: typeof reset, path: string, cookie?: string) {
  return handler(
    new NextRequest(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "x-forwarded-for": freshClient(), ...(cookie ? { cookie } : {}) },
    }),
  );
}

async function fillDemo(cookie: string) {
  const response = await post(reset, "/api/volunteer/demo/reset", cookie);
  expect(response.status).toBe(200);
  const list = await (await get(queue, "/api/volunteer/queue", cookie)).json();
  return list as {
    waiting: { requestId: string; product: string }[];
    mine: { requestId: string } | null;
    sent: { requestId: string; product: string }[];
    persistent: boolean;
    notice: string | null;
  };
}

describe("봉사자 서버 함수", () => {
  beforeEach(() => {
    // 입장 코드가 아니라 lh_vol 서명 비밀이다.
    vi.stubEnv("DEMO_ACCESS_CODE", "test-signing-secret");
    vi.stubEnv("STORE_MODE", "memory");
    vi.stubEnv("VERCEL", "");
    resetRequestStoresForTest();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("POST /api/volunteer/enter", () => {
    it("200: 코드·별명·본문 없이 lh_vol(HttpOnly·Lax·30일)만 심긴다. lh_access는 심지 않는다", async () => {
      const response = await enter(enterRequest(undefined));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("cache-control")).toBe("no-store");

      const cookies = setCookies(response);
      const vol = cookies[VOLUNTEER_COOKIE];
      expect(vol.raw).toMatch(/HttpOnly/i);
      expect(vol.raw).toMatch(/SameSite=lax/i);
      expect(vol.raw).toMatch(/Max-Age=2592000/);
      expect(vol.raw).toMatch(/Path=\//);
      expect(vol.raw).not.toMatch(/Secure/i); // http://localhost
      expect(readVolunteerId(vol.value)).toMatch(/^d-[0-9a-f]{16}$/);
      expect(Object.keys(cookies)).toEqual([VOLUNTEER_COOKIE]);
    });

    it("본문이 있어도 읽지 않는다(옛 화면이 코드·별명을 보내도 200)", async () => {
      const response = await enter(enterRequest({ code: "anything", nickname: "민지" }));
      expect(response.status).toBe(200);
      expect(setCookies(response)[VOLUNTEER_COOKIE]).toBeDefined();
    });

    it("https 주소나 Vercel에서는 쿠키가 Secure다", async () => {
      vi.stubEnv("VERCEL", "1");
      const response = await enter(enterRequest(undefined));
      expect(setCookies(response)[VOLUNTEER_COOKIE].raw).toMatch(/Secure/i);
    });

    it("이미 입장한 기기는 같은 ID를 유지한다(새 lh_vol을 심지 않는다)", async () => {
      const cookie = await signIn();
      const response = await enter(enterRequest(undefined, { cookie }));
      expect(response.status).toBe(200);
      expect(setCookies(response)[VOLUNTEER_COOKIE]).toBeUndefined();
    });

    it("틀린 lh_vol을 가진 기기는 새 열쇠를 받는다", async () => {
      const response = await enter(
        enterRequest(undefined, { cookie: `${VOLUNTEER_COOKIE}=v1.abc.def` }),
      );
      expect(response.status).toBe(200);
      expect(setCookies(response)[VOLUNTEER_COOKIE]).toBeDefined();
    });

    it("같은 주소에서 몇 번을 불러도 횟수 제한이 없다(행사장 와이파이는 주소를 같이 쓴다)", async () => {
      const client = freshClient();
      for (let index = 0; index < 30; index += 1) {
        expect((await enter(enterRequest(undefined, { client }))).status).toBe(200);
      }
    });

    it("서명 비밀(DEMO_ACCESS_CODE)이 없으면 503 not_configured이고 쿠키가 없다", async () => {
      vi.stubEnv("DEMO_ACCESS_CODE", "");
      const response = await enter(enterRequest(undefined));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it("서명 비밀이 바뀌면 이전 기기 쿠키는 무효가 되고 새로 입장해야 한다", async () => {
      const cookie = await signIn();
      expect(await (await get(me, "/api/volunteer/me", cookie)).json()).toEqual({ entered: true });
      vi.stubEnv("DEMO_ACCESS_CODE", "another-secret");
      expect(await (await get(me, "/api/volunteer/me", cookie)).json()).toEqual({ entered: false });
      expect((await get(queue, "/api/volunteer/queue", cookie)).status).toBe(401);
    });

    it("로그에는 상태 코드와 시간만 남는다", async () => {
      const info = vi.mocked(console.info);
      await enter(enterRequest(undefined));
      const lines = info.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^POST \/api\/volunteer\/enter 200 \d+ms$/);
    });
  });

  describe("GET /api/volunteer/me", () => {
    it("입장 전: entered false(코드 칸 안내 needsCode는 없다)", async () => {
      const response = await get(me, "/api/volunteer/me");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ entered: false });
    });

    it("입장 뒤: entered true", async () => {
      const cookie = await signIn();
      expect(await (await get(me, "/api/volunteer/me", cookie)).json()).toEqual({ entered: true });
    });

    it("위조한 lh_vol은 entered false", async () => {
      for (const forged of [
        `${VOLUNTEER_COOKIE}=v1.abc.def`,
        `${VOLUNTEER_COOKIE}=v2.abc`,
        `${VOLUNTEER_COOKIE}=v1.${"!".repeat(43)}.${"B".repeat(43)}`,
        `${VOLUNTEER_COOKIE}=v1.${"A".repeat(43)}.${"B".repeat(43)}`,
      ]) {
        expect(await (await get(me, "/api/volunteer/me", forged)).json()).toEqual({ entered: false });
      }
    });

    it("응답에 접근 쿠키(lh_access)를 심지 않는다", async () => {
      const cookie = await signIn();
      expect(Object.keys(setCookies(await get(me, "/api/volunteer/me", cookie)))).toEqual([]);
      expect(Object.keys(setCookies(await get(queue, "/api/volunteer/queue", cookie)))).toEqual([]);
    });
  });

  describe("lh_vol이 없거나 틀리면 401 unauthorized", () => {
    it("모든 봉사자용 서버 함수", async () => {
      const forged = `${VOLUNTEER_COOKIE}=v1.${"A".repeat(43)}.${"B".repeat(43)}`;
      for (const cookie of [undefined, forged]) {
        const responses = [
          await get(queue, "/api/volunteer/queue", cookie),
          await idRoute(detail, "GET", MISSING_ID, cookie),
          await idRoute(claim, "POST", MISSING_ID, cookie),
          await idRoute(release, "POST", MISSING_ID, cookie),
          await post(reset, "/api/volunteer/demo/reset", cookie),
        ];
        for (const response of responses) {
          expect(response.status).toBe(401);
          expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
          expect(response.headers.get("cache-control")).toBe("no-store");
        }
      }
    });

    it("옛 접근 쿠키(lh_access)만 있어도 봉사자용 함수는 열리지 않는다", async () => {
      const cookie = "lh_access=legacy-value";
      expect((await get(queue, "/api/volunteer/queue", cookie)).status).toBe(401);
    });
  });

  describe("GET /api/volunteer/queue", () => {
    it("비어 있는 목록과 persistent·notice", async () => {
      const cookie = await signIn();
      const response = await get(queue, "/api/volunteer/queue", cookie);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        waiting: [],
        mine: null,
        sent: [],
        persistent: false,
        notice: null, // 로컬·시험에서는 안내를 보이지 않는다
      });
    });

    it("메모리 저장소 + Vercel이면 임시 저장소 안내(notice)를 내려 준다", async () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "preview");
      const cookie = await signIn();
      const body = await (await get(queue, "/api/volunteer/queue", cookie)).json();
      expect(body.persistent).toBe(false);
      expect(body.notice).toBe(
        "임시 저장소를 쓰고 있습니다. 시연 요청과 맡은 상태가 갑자기 사라질 수 있습니다(DB 적용 전).",
      );
    });
  });

  describe("시연 다시 채우기 · 맡기 · 내려놓기 · 상세", () => {
    it("다시 채우면 대기 5건과 이 기기의 완료 1건이 보인다", async () => {
      const cookie = await signIn();
      const body = await fillDemo(cookie);
      expect(body.waiting.map((item) => item.product)[0]).toBe("소니 무선 헤드셋 사고 싶어요");
      expect(body.waiting).toHaveLength(5);
      expect(body.sent).toHaveLength(1);
      expect(body.mine).toBeNull();
      const reply = await (await post(reset, "/api/volunteer/demo/reset", cookie)).json();
      expect(reply).toEqual({ ok: true, waiting: 5 });
    });

    it("다시 채우기는 봉사자당 분당 6회", async () => {
      const cookie = await signIn();
      for (let index = 0; index < 6; index += 1) {
        expect((await post(reset, "/api/volunteer/demo/reset", cookie)).status).toBe(200);
      }
      const limited = await post(reset, "/api/volunteer/demo/reset", cookie);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
    });

    it("claim: 200 claimed → 다시 누르면 already_mine, 다른 요청은 409 busy, 남이 누르면 409 already_claimed", async () => {
      const a = await signIn();
      const b = await signIn();
      const { waiting } = await fillDemo(a);
      const [first, second] = waiting.map((item) => item.requestId);

      const claimed = await idRoute(claim, "POST", first, a);
      expect(claimed.status).toBe(200);
      expect(await claimed.json()).toEqual({ outcome: "claimed", requestId: first });
      const again = await idRoute(claim, "POST", first, a);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ outcome: "already_mine", requestId: first });

      const busy = await idRoute(claim, "POST", second, a);
      expect(busy.status).toBe(409);
      expect(await busy.json()).toEqual({ ok: false, error: "busy" });

      const taken = await idRoute(claim, "POST", first, b);
      expect(taken.status).toBe(409);
      expect(await taken.json()).toEqual({ ok: false, error: "already_claimed" });

      const missing = await idRoute(claim, "POST", MISSING_ID, b);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ ok: false, error: "not_found" });

      // 맡은 요청은 목록의 mine에 있고 대기에서는 빠진다.
      const list = await (await get(queue, "/api/volunteer/queue", a)).json();
      expect(list.mine.requestId).toBe(first);
      expect(list.waiting.map((item: { requestId: string }) => item.requestId)).not.toContain(first);
    });

    it("경로의 id가 UUID가 아니면 400 invalid_request", async () => {
      const cookie = await signIn();
      for (const handler of [claim, release, detail] as const) {
        const response = await idRoute(handler, handler === detail ? "GET" : "POST", "not-a-uuid", cookie);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
      }
    });

    it("상세: 내 진행 중은 200 {request, result:null}, 남의 것은 403, 없는 것은 404", async () => {
      const a = await signIn();
      const b = await signIn();
      const { waiting } = await fillDemo(a);
      const target = waiting[0].requestId;
      await idRoute(claim, "POST", target, a);

      const mine = await idRoute(detail, "GET", target, a);
      expect(mine.status).toBe(200);
      const body = await mine.json();
      expect(body.result).toBeNull();
      expect(body.request).toMatchObject({
        requestId: target,
        status: "in_progress",
        product: "소니 무선 헤드셋 사고 싶어요",
        budget: "30만 원 안쪽",
        item: "헤드셋",
        conditionKind: "new",
      });

      const others = await idRoute(detail, "GET", target, b);
      expect(others.status).toBe(403);
      expect(await others.json()).toEqual({ ok: false, error: "not_yours" });
      expect((await idRoute(detail, "GET", MISSING_ID, a)).status).toBe(404);
    });

    it("상세: 이 기기에서 보낸 완료 요청은 결과와 함께 보인다. 다른 기기는 403", async () => {
      const a = await signIn();
      const b = await signIn();
      const { sent } = await fillDemo(a);
      const done = await idRoute(detail, "GET", sent[0].requestId, a);
      expect(done.status).toBe(200);
      const body = await done.json();
      expect(body.request.status).toBe("done");
      expect(body.result.candidates).toHaveLength(2);
      expect(body.result.candidates[0].name).toContain("시연용 예시 1");
      expect((await idRoute(detail, "GET", sent[0].requestId, b)).status).toBe(403);
    });

    it("release: 내 것은 200 대기로, 남의 것은 403, 없는 것은 404. 그 뒤 다른 봉사자가 맡을 수 있다", async () => {
      const a = await signIn();
      const b = await signIn();
      const { waiting } = await fillDemo(a);
      const target = waiting[0].requestId;
      await idRoute(claim, "POST", target, a);

      const stranger = await idRoute(release, "POST", target, b);
      expect(stranger.status).toBe(403);
      expect(await stranger.json()).toEqual({ ok: false, error: "not_yours" });

      const released = await idRoute(release, "POST", target, a);
      expect(released.status).toBe(200);
      expect(await released.json()).toEqual({ requestId: target, status: "waiting" });
      expect((await idRoute(release, "POST", MISSING_ID, a)).status).toBe(404);

      const list = await (await get(queue, "/api/volunteer/queue", a)).json();
      expect(list.mine).toBeNull();
      expect(list.waiting).toHaveLength(5);
      expect((await idRoute(claim, "POST", target, b)).status).toBe(200);
    });

    it("봉사자 ID별 분당 60회를 넘으면 429", async () => {
      const cookie = await signIn();
      for (let index = 0; index < 60; index += 1) {
        expect((await get(queue, "/api/volunteer/queue", cookie)).status).toBe(200);
      }
      const limited = await get(queue, "/api/volunteer/queue", cookie);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      // 다른 기기는 영향이 없다.
      expect((await get(queue, "/api/volunteer/queue", await signIn())).status).toBe(200);
    });

    it("로그에는 틀과 상태·시간만 남고 요청 id·상품명·봉사자 ID가 없다", async () => {
      const cookie = await signIn();
      const { waiting } = await fillDemo(cookie);
      vi.mocked(console.info).mockClear();
      await idRoute(claim, "POST", waiting[0].requestId, cookie);
      const volunteerId = readVolunteerId(cookie.split("=")[1]) as string;
      const lines = vi.mocked(console.info).mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^POST \/api\/volunteer\/requests\/\[id\]\/claim 200 \d+ms$/);
      expect(lines.join("\n")).not.toContain(waiting[0].requestId);
      expect(lines.join("\n")).not.toContain(volunteerId);
    });
  });
});
