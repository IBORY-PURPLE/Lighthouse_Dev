import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as enter } from "@/app/api/volunteer/enter/route";
import { POST as reset } from "@/app/api/volunteer/demo/reset/route";
import { GET as queue } from "@/app/api/volunteer/queue/route";
import { POST as claim } from "@/app/api/volunteer/requests/[requestId]/claim/route";
import { GET as detail } from "@/app/api/volunteer/requests/[requestId]/route";
import { POST as result } from "@/app/api/volunteer/requests/[requestId]/result/route";
import { resetRequestStoresForTest } from "@/lib/requestStore";
import { VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

// POST /api/volunteer/requests/{id}/result: 보내기(결과 저장 + 완료).

const ORIGIN = "http://localhost:3000";
const CODE = "right-code";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let counter = 0;
const freshClient = () => `203.0.113.${(counter += 1) % 250}-${randomUUID()}`;

async function signIn(nickname = "민지") {
  const response = await enter(
    new NextRequest(`${ORIGIN}/api/volunteer/enter`, {
      method: "POST",
      body: JSON.stringify({ code: CODE, nickname }),
      headers: { "x-forwarded-for": freshClient() },
    }),
  );
  expect(response.status).toBe(200);
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    if (pair.startsWith(`${VOLUNTEER_COOKIE}=`)) return pair;
  }
  throw new Error("lh_vol 쿠키가 없다");
}

function call(
  handler: typeof claim | typeof detail | typeof result,
  method: "GET" | "POST",
  id: string,
  cookie?: string,
  body?: unknown,
) {
  return handler(
    new NextRequest(`${ORIGIN}/api/volunteer/requests/${id}`, {
      method,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      headers: { "x-forwarded-for": freshClient(), ...(cookie ? { cookie } : {}) },
    }),
    { params: Promise.resolve({ requestId: id }) },
  );
}

const good = (name = "소니 WH-CH720N") => ({
  name,
  url: "https://search.11st.co.kr/pc/total-search?kwd=sony",
  guide: "구매하기를 누르고 색상을 고릅니다.",
  summary: [{ label: "옵션", value: "블랙" }],
});

/** 입장해서 시연 요청을 채우고 첫 대기 요청을 맡는다. */
async function claimFirst(cookie: string) {
  const filled = await reset(
    new NextRequest(`${ORIGIN}/api/volunteer/demo/reset`, {
      method: "POST",
      headers: { "x-forwarded-for": freshClient(), cookie },
    }),
  );
  expect(filled.status).toBe(200);
  const list = await (
    await queue(
      new NextRequest(`${ORIGIN}/api/volunteer/queue`, {
        headers: { "x-forwarded-for": freshClient(), cookie },
      }),
    )
  ).json();
  const id: string = list.waiting[0].requestId;
  expect((await call(claim, "POST", id, cookie)).status).toBe(200);
  return id;
}

describe("POST /api/volunteer/requests/{id}/result", () => {
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

  it("201: 결과를 저장하고 요청을 완료한다. GET 상세에는 result가 있다", async () => {
    const cookie = await signIn();
    const id = await claimFirst(cookie);
    const response = await call(result, "POST", id, cookie, { candidates: [good(), good("소니 WH-CH520")] });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ requestId: id, status: "done" });
    expect(Number.isNaN(Date.parse(body.sentAt))).toBe(false);

    const shown = await (await call(detail, "GET", id, cookie)).json();
    expect(shown.request.status).toBe("done");
    expect(shown.result.sentAt).toBe(body.sentAt);
    expect(shown.result.heardAt).toBeNull();
    expect(shown.result.linkOpenedAt).toBeNull();
    expect(shown.result.candidates.map((candidate: { name: string }) => candidate.name)).toEqual([
      "소니 WH-CH720N",
      "소니 WH-CH520",
    ]);

    // 맡기 잠금이 풀리고, 보낸 요청에 올라간다.
    const list = await (
      await queue(
        new NextRequest(`${ORIGIN}/api/volunteer/queue`, {
          headers: { "x-forwarded-for": freshClient(), cookie },
        }),
      )
    ).json();
    expect(list.mine).toBeNull();
    expect(list.sent.map((item: { requestId: string }) => item.requestId)).toContain(id);
  });

  it("같은 봉사자가 다시 보내면 200이고 처음 저장한 결과와 보낸 시각을 돌려준다", async () => {
    const cookie = await signIn();
    const id = await claimFirst(cookie);
    const first = await (await call(result, "POST", id, cookie, { candidates: [good()] })).json();
    const again = await call(result, "POST", id, cookie, { candidates: [good("다른 이름")] });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    const shown = await (await call(detail, "GET", id, cookie)).json();
    expect(shown.result.candidates).toHaveLength(1);
    expect(shown.result.candidates[0].name).toBe("소니 WH-CH720N");
  });

  it("400: 후보 0개·글자가 아닌 본문은 invalid_request, 4개·101자 이름·1001자 가이드·13항목은 too_long, http 링크는 invalid_url", async () => {
    const cookie = await signIn();
    const id = await claimFirst(cookie);
    const send = async (body: unknown) => {
      const response = await call(result, "POST", id, cookie, body);
      expect(response.status).toBe(400);
      return (await response.json()) as { ok: false; error: string };
    };
    expect(await send({ candidates: [] })).toEqual({ ok: false, error: "invalid_request" });
    expect(await send("not json")).toEqual({ ok: false, error: "invalid_request" });
    expect(await send({})).toEqual({ ok: false, error: "invalid_request" });
    expect(await send({ candidates: [good(), good(), good(), good()] })).toEqual({ ok: false, error: "too_long" });
    expect(await send({ candidates: [good("가".repeat(101))] })).toEqual({ ok: false, error: "too_long" });
    expect(await send({ candidates: [{ ...good(), guide: "가".repeat(1001) }] })).toEqual({
      ok: false,
      error: "too_long",
    });
    const many = Array.from({ length: 13 }, (_, index) => ({ label: `항목${index}`, value: "값" }));
    expect(await send({ candidates: [{ ...good(), summary: many }] })).toEqual({ ok: false, error: "too_long" });
    expect(await send({ candidates: [{ ...good(), url: "http://shop.example/a" }] })).toEqual({
      ok: false,
      error: "invalid_url",
    });
    // 이미지 같은 큰 값은 본문 한도에서 막힌다.
    expect(await send({ candidates: [good()], image: "x".repeat(50_000) })).toEqual({
      ok: false,
      error: "too_long",
    });
    // 실패해도 요청은 그대로 진행 중이다.
    expect((await (await call(detail, "GET", id, cookie)).json()).request.status).toBe("in_progress");
  });

  it("결과에는 이름·링크·가이드·요약 항목만 저장된다(이미지·읽은 글자·근거는 버려진다)", async () => {
    const cookie = await signIn();
    const id = await claimFirst(cookie);
    const response = await call(result, "POST", id, cookie, {
      candidates: [
        {
          ...good(),
          image: "data:image/png;base64,AAAA",
          text: "읽은 글자 원문",
          evidence: "근거 문장",
          summary: [{ label: "옵션", value: "블랙", evidence: "근거 문장" }],
        },
      ],
    });
    expect(response.status).toBe(201);
    const shown = await (await call(detail, "GET", id, cookie)).json();
    expect(shown.result.candidates).toEqual([good()]);
    expect(JSON.stringify(shown.result)).not.toMatch(/data:image|읽은 글자|근거/);
  });

  it("403: 남이 맡은 요청은 보낼 수 없다. 404: 없는 요청. 400: UUID가 아님", async () => {
    const a = await signIn("가");
    const b = await signIn("나");
    const id = await claimFirst(a);
    const others = await call(result, "POST", id, b, { candidates: [good()] });
    expect(others.status).toBe(403);
    expect(await others.json()).toEqual({ ok: false, error: "not_yours" });
    expect((await call(result, "POST", MISSING_ID, a, { candidates: [good()] })).status).toBe(404);
    const bad = await call(result, "POST", "not-a-uuid", a, { candidates: [good()] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "invalid_request" });
    // 남이 보낸 것으로는 b의 상세가 열리지 않는다.
    expect((await call(detail, "GET", id, b)).status).toBe(403);
  });

  it("401: lh_vol이 없거나 위조면 unauthorized", async () => {
    const forged = `${VOLUNTEER_COOKIE}=v1.${"A".repeat(43)}.${"B".repeat(43)}`;
    for (const cookie of [undefined, forged]) {
      const response = await call(result, "POST", MISSING_ID, cookie, { candidates: [good()] });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
    }
  });

  it("로그에는 틀과 상태·시간만 남고 요청 id·상품명·링크가 없다", async () => {
    const cookie = await signIn();
    const id = await claimFirst(cookie);
    const info = vi.mocked(console.info);
    info.mockClear();
    await call(result, "POST", id, cookie, { candidates: [good()] });
    const lines = info.mock.calls.map((args) => String(args[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^POST \/api\/volunteer\/requests\/\[id\]\/result 201 \d+ms$/);
    expect(lines[0]).not.toContain(id);
  });
});
