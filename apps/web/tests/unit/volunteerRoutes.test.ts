import { randomUUID } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as enter } from "@/app/api/volunteer/enter/route";
import { POST as reset } from "@/app/api/volunteer/demo/reset/route";
import { GET as me } from "@/app/api/volunteer/me/route";
import { GET as queue } from "@/app/api/volunteer/queue/route";
import { GET as candidates } from "@/app/api/volunteer/requests/[requestId]/candidates/route";
import { POST as claim } from "@/app/api/volunteer/requests/[requestId]/claim/route";
import { POST as release } from "@/app/api/volunteer/requests/[requestId]/release/route";
import { GET as detail } from "@/app/api/volunteer/requests/[requestId]/route";
import { ACCESS_COOKIE, hashAccessCode } from "@/lib/access";
import { resetRequestStoresForTest } from "@/lib/requestStore";
import { readVolunteerId, VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

const ORIGIN = "http://localhost:3000";
const CODE = "right-code";
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
async function signIn(nickname = "민지") {
  const response = await enter(enterRequest({ code: CODE, nickname }));
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
  T extends typeof claim | typeof release | typeof detail | typeof candidates,
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
    vi.stubEnv("DEMO_ACCESS_CODE", CODE);
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
    it("200: lh_vol(HttpOnly·Lax·30일)와 lh_access가 심긴다", async () => {
      const response = await enter(enterRequest({ code: CODE, nickname: "민지" }));
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

      const access = cookies[ACCESS_COOKIE];
      expect(access.value).toBe(hashAccessCode(CODE));
      expect(access.raw).toMatch(/HttpOnly/i);
      expect(access.raw).toMatch(/Max-Age=604800/);
    });

    it("https 주소나 Vercel에서는 쿠키가 Secure다", async () => {
      vi.stubEnv("VERCEL", "1");
      const response = await enter(enterRequest({ code: CODE, nickname: "민지" }));
      const cookies = setCookies(response);
      expect(cookies[VOLUNTEER_COOKIE].raw).toMatch(/Secure/i);
      expect(cookies[ACCESS_COOKIE].raw).toMatch(/Secure/i);
    });

    it("이미 입장한 기기는 같은 ID를 유지한다(새 lh_vol을 심지 않는다)", async () => {
      const cookie = await signIn();
      const response = await enter(
        enterRequest({ code: CODE, nickname: "다른 별명" }, { cookie }),
      );
      expect(response.status).toBe(200);
      const cookies = setCookies(response);
      expect(cookies[VOLUNTEER_COOKIE]).toBeUndefined();
      expect(cookies[ACCESS_COOKIE]).toBeDefined();
    });

    it("lh_access가 있으면 코드 없이 별명만으로 입장한다", async () => {
      const cookie = `${ACCESS_COOKIE}=${hashAccessCode(CODE)}`;
      const response = await enter(enterRequest({ nickname: "민지" }, { cookie }));
      expect(response.status).toBe(200);
      expect(setCookies(response)[VOLUNTEER_COOKIE]).toBeDefined();
    });

    it("틀린 코드나 코드 없음은 401 invalid_code이고 쿠키가 없다", async () => {
      for (const body of [{ code: "wrong", nickname: "민지" }, { nickname: "민지" }, { code: "", nickname: "민지" }]) {
        const response = await enter(enterRequest(body));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_code" });
        expect(response.headers.getSetCookie()).toEqual([]);
      }
    });

    it("별명이 비었거나 12자를 넘으면 400 invalid_nickname", async () => {
      for (const nickname of ["", "   ", "열두글자를넘는아주긴별명입니다"]) {
        const response = await enter(enterRequest({ code: CODE, nickname }));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_nickname" });
      }
      // 12자는 된다.
      expect((await enter(enterRequest({ code: CODE, nickname: "열두글자별명입니다요요" }))).status).toBe(200);
    });

    it("본문이 JSON이 아니거나 모양이 틀리거나 1KB를 넘으면 400 invalid_request", async () => {
      for (const body of ["not json", "[]", "null", { code: CODE }, { code: 5, nickname: "민지" }, { nickname: 1 }]) {
        const response = await enter(enterRequest(body));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
      }
      const big = await enter(enterRequest({ code: CODE, nickname: "민지", pad: "x".repeat(1100) }));
      expect(big.status).toBe(400);
    });

    it("같은 주소가 10분에 10회를 넘으면 429(Retry-After)", async () => {
      const client = freshClient();
      for (let index = 0; index < 10; index += 1) {
        const response = await enter(enterRequest({ code: "wrong", nickname: "민지" }, { client }));
        expect(response.status).toBe(401);
      }
      const limited = await enter(enterRequest({ code: CODE, nickname: "민지" }, { client }));
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      // 다른 주소는 영향이 없다.
      expect((await enter(enterRequest({ code: CODE, nickname: "민지" }))).status).toBe(200);
    });

    it("입장 코드가 설정되지 않은 서버는 503 not_configured", async () => {
      vi.stubEnv("DEMO_ACCESS_CODE", "");
      const response = await enter(enterRequest({ code: CODE, nickname: "민지" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    });

    it("로그에는 상태 코드와 시간만 남고 별명·코드는 없다", async () => {
      const info = vi.mocked(console.info);
      await enter(enterRequest({ code: CODE, nickname: "비밀별명" }));
      const lines = info.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^POST \/api\/volunteer\/enter 200 \d+ms$/);
      expect(lines[0]).not.toContain("비밀별명");
      expect(lines[0]).not.toContain(CODE);
    });
  });

  describe("GET /api/volunteer/me", () => {
    it("입장 전: entered false, needsCode true", async () => {
      const response = await get(me, "/api/volunteer/me");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ entered: false, needsCode: true });
    });

    it("입장 뒤: entered true. lh_access만 있으면 needsCode false", async () => {
      const cookie = await signIn();
      expect(await (await get(me, "/api/volunteer/me", cookie)).json()).toEqual({
        entered: true,
        needsCode: true, // lh_access 쿠키는 보내지 않았다
      });
      const both = `${cookie}; ${ACCESS_COOKIE}=${hashAccessCode(CODE)}`;
      expect(await (await get(me, "/api/volunteer/me", both)).json()).toEqual({
        entered: true,
        needsCode: false,
      });
      const accessOnly = `${ACCESS_COOKIE}=${hashAccessCode(CODE)}`;
      expect(await (await get(me, "/api/volunteer/me", accessOnly)).json()).toEqual({
        entered: false,
        needsCode: false,
      });
    });

    it("위조한 lh_vol은 entered false", async () => {
      expect(await (await get(me, "/api/volunteer/me", `${VOLUNTEER_COOKIE}=v1.abc.def`)).json()).toMatchObject({
        entered: false,
      });
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
          await idRoute(candidates, "GET", MISSING_ID, cookie),
          await post(reset, "/api/volunteer/demo/reset", cookie),
        ];
        for (const response of responses) {
          expect(response.status).toBe(401);
          expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
          expect(response.headers.get("cache-control")).toBe("no-store");
        }
      }
    });

    it("lh_access만 있어도 봉사자용 함수는 열리지 않는다", async () => {
      const cookie = `${ACCESS_COOKIE}=${hashAccessCode(CODE)}`;
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
        "임시 저장소를 쓰고 있습니다. 서버가 다시 뜨면 시연 요청과 맡은 상태가 사라질 수 있습니다.",
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
      const a = await signIn("가");
      const b = await signIn("나");
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
      const a = await signIn("가");
      const b = await signIn("나");
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
      const a = await signIn("가");
      const b = await signIn("나");
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
      const a = await signIn("가");
      const b = await signIn("나");
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

  describe("GET …/requests/{id}/candidates", () => {
    it("맡은 요청의 시연용 후보 3개(id c1~c3, 11번가 검색 링크)를 준다. 가격·재고는 없다", async () => {
      const a = await signIn("가");
      const { waiting } = await fillDemo(a);
      const headset = waiting.find((item) => item.product.includes("헤드셋"));
      expect(headset).toBeDefined();
      const target = (headset as { requestId: string }).requestId;
      await idRoute(claim, "POST", target, a);

      const response = await idRoute(candidates, "GET", target, a);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body.source).toBe("demo");
      expect(body.candidates.map((entry: { id: string }) => entry.id)).toEqual(["c1", "c2", "c3"]);
      expect(body.candidates[0]).toEqual({
        id: "c1",
        name: "소니 WH-CH720N",
        seller: "11번가 검색",
        url: `https://search.11st.co.kr/pc/total-search?kwd=${encodeURIComponent("소니 WH-CH720N")}`,
      });
      expect(JSON.stringify(body)).not.toMatch(/원|재고|가격/);
    });

    it("품목이 표에 없는 요청은 후보 0개다(내가 보낸 실내화 요청)", async () => {
      const a = await signIn("가");
      const { sent } = await fillDemo(a);
      const response = await idRoute(candidates, "GET", sent[0].requestId, a);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ source: "demo", candidates: [] });
    });

    it("남의 요청은 403, 없는 요청은 404, UUID가 아니면 400", async () => {
      const a = await signIn("가");
      const b = await signIn("나");
      const { waiting } = await fillDemo(a);
      const target = waiting[0].requestId;
      await idRoute(claim, "POST", target, a);
      const others = await idRoute(candidates, "GET", target, b);
      expect(others.status).toBe(403);
      expect(await others.json()).toEqual({ ok: false, error: "not_yours" });
      expect((await idRoute(candidates, "GET", MISSING_ID, a)).status).toBe(404);
      const bad = await idRoute(candidates, "GET", "not-a-uuid", a);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ ok: false, error: "invalid_request" });
    });

    it("대기 중이라 아직 맡지 않은 요청의 후보는 볼 수 없다(403)", async () => {
      const a = await signIn("가");
      const { waiting } = await fillDemo(a);
      expect((await idRoute(candidates, "GET", waiting[0].requestId, a)).status).toBe(403);
    });
  });
});
