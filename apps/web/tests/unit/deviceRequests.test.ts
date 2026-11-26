import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn(async () => ({ statusCode: 201 })) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

import { GET as getOne } from "@/app/api/requests/[requestId]/route";
import { POST as subscribe } from "@/app/api/requests/[requestId]/push/route";
import { GET as list, POST as register } from "@/app/api/requests/route";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_SECONDS, readDeviceId } from "@/lib/deviceSession";
import * as requestStore from "@/lib/requestStore";
import { VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

// 이용자 기기 쿠키(lh_device): 기기마다 자기 요청만 본다(2026-11-18 이용자 요청).
const ORIGIN = "http://localhost:3000";
const SUB = { endpoint: "https://push.example.com/abc", keys: { p256dh: "BPk3-key_value", auth: "auth-value" } };

let nextClient = 1;
const freshClient = () => `203.0.113.${(nextClient += 1) % 250}-${randomUUID()}`;

function cookieHeader(cookie?: string): Record<string, string> {
  return cookie ? { cookie: `${DEVICE_COOKIE}=${cookie}` } : {};
}

function post(cookie?: string, overrides: Record<string, unknown> = {}) {
  return register(
    new NextRequest(`${ORIGIN}/api/requests`, {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: randomUUID(),
        product: "소니 무선 헤드셋",
        budget: "10만 원",
        condition: "새 제품",
        ...overrides,
      }),
      headers: { "x-forwarded-for": freshClient(), ...cookieHeader(cookie) },
    }),
  );
}

function getList(cookie?: string, client = freshClient()) {
  return list(
    new NextRequest(`${ORIGIN}/api/requests`, { headers: { "x-forwarded-for": client, ...cookieHeader(cookie) } }),
  );
}

function getById(id: string, cookie?: string, view?: "details") {
  return getOne(
    new NextRequest(`${ORIGIN}/api/requests/${id}${view ? "?view=" + view : ""}`, {
      headers: { "x-forwarded-for": freshClient(), ...cookieHeader(cookie) },
    }),
    { params: Promise.resolve({ requestId: id }) },
  );
}

function postPush(id: string, cookie?: string) {
  return subscribe(
    new NextRequest(`${ORIGIN}/api/requests/${id}/push`, {
      method: "POST",
      body: JSON.stringify(SUB),
      headers: { "x-forwarded-for": freshClient(), "content-type": "application/json", ...cookieHeader(cookie) },
    }),
    { params: Promise.resolve({ requestId: id }) },
  );
}

/** 응답이 심은 lh_device 값(없으면 undefined). */
function issued(response: Response): string | undefined {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`${DEVICE_COOKIE}=([^;]+)`).exec(header)?.[1];
}

/** 새 기기: 첫 접수로 쿠키를 받아 돌려준다. */
async function newDevice(): Promise<{ cookie: string; first: { requestId: string; queueNumber: number } }> {
  const response = await post();
  const cookie = issued(response);
  expect(cookie).toBeTruthy();
  return { cookie: cookie as string, first: await response.json() };
}

beforeEach(() => {
  vi.stubEnv("STORE_MODE", "memory");
  vi.stubEnv("DEMO_ACCESS_CODE", "test-signing-secret");
  vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  requestStore.resetRequestStoresForTest();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("기기 쿠키 발급", () => {
  it("쿠키가 없으면 접수 응답에서 lh_device를 심는다(봉사자 쿠키와 같은 속성, 1년)", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(new RegExp(`^${DEVICE_COOKIE}=v1\\.`));
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Path=\//i);
    expect(header).toContain(`Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`);
    expect(DEVICE_COOKIE_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
    // 로컬 http에서는 Secure를 켜지 않는다(봉사자 쿠키와 같다).
    expect(header).not.toMatch(/Secure/i);
    expect(readDeviceId(issued(response))).toMatch(/^u-[0-9a-f]{32}$/);
  });

  it("https 주소에서는 Secure다", async () => {
    const response = await register(
      new NextRequest("https://lighthouse.example/api/requests", {
        method: "POST",
        body: JSON.stringify({ clientRequestId: randomUUID(), product: "키보드", budget: "5만 원", condition: "새 제품" }),
        headers: { "x-forwarded-for": freshClient() },
      }),
    );
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("맞는 쿠키를 보내면 새로 심지 않고, 같은 기기로 접수된다", async () => {
    const { cookie } = await newDevice();
    const again = await post(cookie);
    expect(issued(again)).toBeUndefined();
    expect((await (await getList(cookie)).json()).items).toHaveLength(2);
  });

  it("같은 접수 id를 다른 기기가 다시 보내면 409이고 번호·상태를 알려 주지 않는다(같은 기기는 200)", async () => {
    const a = await newDevice();
    const clientRequestId = randomUUID();
    const first = await post(a.cookie, { clientRequestId });
    expect(first.status).toBe(201);
    const same = await post(a.cookie, { clientRequestId });
    expect(same.status).toBe(200);
    const other = await newDevice();
    const stolen = await post(other.cookie, { clientRequestId });
    expect(stolen.status).toBe(409);
    expect(await stolen.json()).toEqual({ ok: false, error: "conflict" });
  });

  it("틀린 쿠키(서명 불일치·봉사자 쿠키)는 새로 심고 그 기기의 목록은 비어 있다", async () => {
    const { cookie } = await newDevice();
    const forged = `${cookie.slice(0, -2)}xx`;
    const response = await getList(forged);
    expect(issued(response)).toBeDefined();
    expect(issued(response)).not.toBe(forged);
    expect(await response.json()).toMatchObject({ items: [] });

    // 봉사자 쿠키 값을 이용자 쿠키 자리에 넣어도 통하지 않는다(서명 비밀이 다르다).
    const volunteerLike = await import("@/lib/volunteerSession").then((m) => m.issueDeviceCookie());
    expect(VOLUNTEER_COOKIE).toBe("lh_vol");
    const swapped = await getList(volunteerLike as string);
    expect(issued(swapped)).toBeDefined();
    expect(await swapped.json()).toMatchObject({ items: [] });
  });

  it("서명 비밀이 없으면 쿠키 없이도 접수되고(기기 없음), 목록은 빈 목록(200) 대신 503이다(화면이 기록을 지우지 않게)", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const response = await post();
    expect(response.status).toBe(201);
    expect(issued(response)).toBeUndefined();
    const listed = await getList();
    expect(listed.status).toBe(503);
    expect(issued(listed)).toBeUndefined();
    expect(await listed.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("DEMO_ACCESS_CODE를 바꾸면 이전 기기 쿠키는 무효가 된다", async () => {
    const { cookie } = await newDevice();
    vi.stubEnv("DEMO_ACCESS_CODE", "another-secret");
    expect(readDeviceId(cookie)).toBeNull();
  });
});

describe("GET /api/requests (이 기기의 목록)", () => {
  it("기기마다 자기 요청만, 최신순으로 준다", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const second = await (await post(a.cookie, { product: "A의 두 번째" })).json();
    await post(b.cookie, { product: "B의 것" });

    const forA = await getList(a.cookie);
    expect(forA.status).toBe(200);
    expect(forA.headers.get("cache-control")).toBe("no-store");
    expect(issued(forA)).toBeUndefined();
    const { items } = await forA.json();
    expect(items.map((item: { product: string }) => item.product)).toEqual(["A의 두 번째", "소니 무선 헤드셋"]);
    expect(items[0]).toEqual({
      requestId: second.requestId,
      queueNumber: second.queueNumber,
      status: "waiting",
      product: "A의 두 번째",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(JSON.stringify(items)).not.toContain("B의 것");

    const forB = (await (await getList(b.cookie)).json()).items;
    expect(forB.map((item: { product: string }) => item.product)).toEqual(["B의 것", "소니 무선 헤드셋"]);
  });

  it("쿠키가 없으면 빈 목록을 주고 쿠키를 심는다(남의 요청은 보이지 않는다)", async () => {
    await newDevice();
    const response = await getList();
    expect(await response.json()).toMatchObject({ items: [] });
    expect(issued(response)).toBeDefined();
  });

  it("complete는 저장소가 DB일 때만 true다(메모리 저장소의 빈 목록을 기준으로 삼지 않게)", async () => {
    const { cookie } = await newDevice();
    expect((await (await getList(cookie)).json()).complete).toBe(false);
    const real = requestStore.getRequestStore();
    const spy = vi.spyOn(requestStore, "getRequestStore").mockReturnValue(
      new Proxy(real, { get: (target, key) => (key === "persistent" ? true : Reflect.get(target, key)) }),
    );
    try {
      expect((await (await getList(cookie)).json()).complete).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("저장소 오류는 503이다(빈 목록으로 보이지 않는다)", async () => {
    const { cookie } = await newDevice();
    const real = requestStore.getRequestStore();
    const spy = vi.spyOn(requestStore, "getRequestStore").mockReturnValue(
      new Proxy(real, {
        get: (target, key) =>
          key === "listByDevice"
            ? () => Promise.reject(new requestStore.StoreUnavailableError("down"))
            : Reflect.get(target, key),
      }),
    );
    try {
      expect((await getList(cookie)).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });

  it("최대 20건", async () => {
    const { cookie } = await newDevice();
    for (let i = 0; i < 22; i += 1) await post(cookie, { product: `물건 ${i}` });
    const { items } = await (await getList(cookie)).json();
    expect(items).toHaveLength(20);
    expect(items[0].product).toBe("물건 21");
  });

  it("끝난 요청에는 리뷰 문단과 보낸 시각이 붙는다", async () => {
    const { cookie, first } = await newDevice();
    const store = requestStore.getRequestStore();
    await store.claim(first.requestId, "vol-1");
    await store.complete(first.requestId, "vol-1", [
      { name: "WH-1000XM5", url: "", guide: "가볍고 오래 써도 귀가 편했어요.", summary: [] },
    ]);
    const { items } = await (await getList(cookie)).json();
    expect(items[0]).toMatchObject({ status: "done", review: "가볍고 오래 써도 귀가 편했어요." });
    expect(typeof items[0].sentAt).toBe("string");
  });

  it("시연 요청은 어느 기기 목록에도 나오지 않는다", async () => {
    const { cookie } = await newDevice();
    await requestStore.getRequestStore().resetDemo(null);
    const { items } = await (await getList(cookie)).json();
    expect(items).toHaveLength(1);
  });

  it("분당 61번째는 429와 Retry-After", async () => {
    const client = freshClient();
    for (let i = 0; i < 60; i += 1) expect((await getList(undefined, client)).status).toBe(200);
    const limited = await getList(undefined, client);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("저장소 오류는 503", async () => {
    const { cookie } = await newDevice();
    requestStore.resetRequestStoresForTest({
      persistent: true,
      storeKind: () => "supabase",
      register: vi.fn(),
      get: vi.fn(),
      listByDevice: () => Promise.reject(new requestStore.StoreUnavailableError("down")),
    });
    const response = await getList(cookie);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "store_unavailable" });
  });

  it("로그에 상품명과 기기 ID를 남기지 않는다", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args.map(String).join(" "));
      });
    }
    const { cookie } = await newDevice();
    await getList(cookie);
    const joined = logged.join("\n");
    expect(joined).toMatch(/GET \/api\/requests 200 \d+ms/);
    expect(joined).not.toContain("소니");
    expect(joined).not.toContain(readDeviceId(cookie) as string);
    expect(joined).not.toContain(cookie);
  });
});

describe("단건 조회와 푸시 구독은 요청을 보낸 기기만", () => {
  it("다른 기기·쿠키 없음은 404, 보낸 기기는 200", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const own = await getById(a.first.requestId, a.cookie);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ requestId: a.first.requestId, status: "waiting" });

    for (const cookie of [b.cookie, undefined, `${a.cookie.slice(0, -2)}xx`]) {
      const denied = await getById(a.first.requestId, cookie);
      expect(denied.status).toBe(404);
      expect(await denied.json()).toEqual({ ok: false, error: "not_found", persistent: false });
    }
  });

  it("기기 ID가 없는 요청(옛 요청·시연 요청)은 지금처럼 번호만 알면 조회된다", async () => {
    const store = requestStore.getRequestStore();
    const legacy = await store.register({
      clientRequestId: randomUUID(),
      product: "옛 요청",
      budget: "1만 원",
      condition: "새 제품",
      brand: null,
      item: null,
      conditionKind: "new",
      deviceId: null,
    });
    const { cookie } = await newDevice();
    expect((await getById(legacy.requestId)).status).toBe(200);
    expect((await getById(legacy.requestId, cookie)).status).toBe(200);
    expect((await getById(legacy.requestId, cookie, "details")).status).toBe(404);
  });

  it("상세는 보낸 기기에만 요청 조건과 확인한 답변을 주고 완료 뒤에는 발송된 리뷰 정보만 준다", async () => {
    const owner = await newDevice();
    const other = await newDevice();
    const details = {
      summary: "작업용 조용한 키보드",
      qa: [{ q: "사용 목적", a: "사무실 업무" }],
    };
    const registered = await post(owner.cookie, { product: "키보드", details });
    const { requestId } = await registered.json() as { requestId: string };

    const open = await getById(requestId, owner.cookie, "details");
    expect(open.headers.get("cache-control")).toBe("no-store");
    expect(await open.json()).toMatchObject({
      buyer: { budget: "10만 원", condition: "새 제품" }, details,
    });
    expect(await (await getById(requestId, owner.cookie)).json()).not.toHaveProperty("details");
    expect((await getById(requestId, other.cookie, "details")).status).toBe(404);
    expect((await getById(requestId, undefined, "details")).status).toBe(404);

    const store = requestStore.getRequestStore();
    expect(await store.claim(requestId, "volunteer-1")).toBe("claimed");
    const completed = await store.complete(requestId, "volunteer-1", [{
      name: "Quiet Keys",
      url: "https://example.com/search",
      guide: "봉사자가 검수한 리뷰입니다.",
      summary: [
        { label: "구매 인증", value: "구매 인증됨" },
        { label: "장점", value: "키 입력이 조용합니다." },
        { label: "같이 고민한 제품", value: "Silent Keys" },
        { label: "고민한 이유", value: "가격은 59,000원" },
        { label: "참고 링크 1", value: "제조사 https://example.com/product" },
        { label: "혜택 링크 1", value: "https://user:pass@example.com" },
      ],
    }]);
    expect(completed.outcome).toBe("completed");
    const sent = await (await getById(requestId, owner.cookie, "details")).json();
    expect(sent).toMatchObject({
      status: "done",
      review: "봉사자가 검수한 리뷰입니다.",
      details: null,
    });
    expect(sent.buyer.reviewInfo).toEqual({
      model: "Quiet Keys",
      purchase: "구매 인증됨",
      experience: "키 입력이 조용합니다.",
      research: [{ label: "같이 고민한 제품", value: "Silent Keys" }],
      sources: [{ label: "참고 링크 1", url: "https://example.com/product" }],
    });
    expect(await (await getById(requestId, owner.cookie)).json()).not.toHaveProperty("buyer");
  });

  it("푸시 구독도 다른 기기에서는 404이고 보낸 기기에서는 201이다", async () => {
    const a = await newDevice();
    const b = await newDevice();
    expect((await postPush(a.first.requestId, b.cookie)).status).toBe(404);
    expect((await postPush(a.first.requestId)).status).toBe(404);
    expect((await postPush(a.first.requestId, a.cookie)).status).toBe(201);
  });
});
