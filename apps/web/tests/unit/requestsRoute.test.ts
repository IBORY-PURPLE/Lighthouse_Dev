import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/requests/[requestId]/route";
import { POST } from "@/app/api/requests/route";
import * as requestStore from "@/lib/requestStore";

const ORIGIN = "http://localhost:3000";
const PRODUCT = "sony껄로 헤드셋 사고싶어";
const BUDGET = "십만원 이하 비밀예산";
const CONDITION = "새 제품 원해요";

let nextClient = 1;
const freshClient = () => `198.51.100.${(nextClient += 1) % 250}-${randomUUID()}`;

function headers(client?: string) {
  return { "x-forwarded-for": client ?? freshClient() };
}

function postRequest(body: unknown, { client }: { client?: string } = {}) {
  return new NextRequest(`${ORIGIN}/api/requests`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: headers(client),
  });
}

function getRequest(id: string, { client }: { client?: string } = {}) {
  return GET(new NextRequest(`${ORIGIN}/api/requests/${id}`, { headers: headers(client) }), {
    params: Promise.resolve({ requestId: id }),
  });
}

function answers(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: randomUUID(),
    product: PRODUCT,
    budget: BUDGET,
    condition: CONDITION,
    ...overrides,
  };
}

describe("POST /api/requests (메모리 저장소)", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("201로 대기번호를 주고, 두 번째 요청은 +1이다", async () => {
    const first = await POST(postRequest(answers()));
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("server-timing")).toMatch(/^store;dur=\d+$/);
    const body = await first.json();
    expect(body).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      queueNumber: 1,
      status: "waiting",
    });
    const second = await POST(postRequest(answers()));
    expect((await second.json()).queueNumber).toBe(2);
  });

  it("같은 clientRequestId를 다시 보내면 200과 같은 본문이고 번호가 늘지 않는다", async () => {
    const body = answers();
    const first = await (await POST(postRequest(body))).json();
    const again = await POST(postRequest(body));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    const next = await (await POST(postRequest(answers()))).json();
    expect(next.queueNumber).toBe(first.queueNumber + 1);
  });

  it("로그인 쿠키 없이도 201로 접수한다(이용자 쪽은 열려 있다)", async () => {
    const response = await POST(postRequest(answers()));
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("분당 31번째는 429와 Retry-After", async () => {
    const client = freshClient();
    for (let i = 0; i < 30; i += 1) {
      expect((await POST(postRequest(answers(), { client }))).status).not.toBe(429);
    }
    const limited = await POST(postRequest(answers(), { client }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("형식이 틀리면 400 invalid_request", async () => {
    for (const body of [
      "{broken",
      answers({ clientRequestId: "not-a-uuid" }),
      answers({ clientRequestId: undefined }),
      answers({ product: "   " }),
      answers({ budget: 10 }),
      answers({ condition: undefined }),
    ]) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
    }
  });

  it("200자 초과는 400 too_long, 200자는 통과", async () => {
    const tooLong = await POST(postRequest(answers({ budget: "가".repeat(201) })));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ ok: false, error: "too_long" });
    const ok = await POST(postRequest(answers({ condition: "가".repeat(200) })));
    expect(ok.status).toBe(201);
  });

  it("품목이 없으면 422 need_item", async () => {
    const response = await POST(postRequest(answers({ product: "sony껄로 사고싶어" })));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "need_item" });
  });

  it("저장소 오류는 503 store_unavailable", async () => {
    requestStore.resetRequestStoresForTest({
      persistent: true,
      storeKind: () => "supabase",
      register: () => Promise.reject(new requestStore.StoreUnavailableError("down")),
      get: () => Promise.reject(new requestStore.StoreUnavailableError("down")),
    });
    const response = await POST(postRequest(answers()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "store_unavailable" });
  });

  it("저장소에는 정규화한 상태·품목을 넘긴다", async () => {
    const register = vi.fn().mockResolvedValue({
      outcome: "created",
      requestId: randomUUID(),
      queueNumber: 1,
      status: "waiting",
    });
    requestStore.resetRequestStoresForTest({
      persistent: true,
      storeKind: () => "supabase",
      register,
      get: vi.fn(),
    });
    const body = answers({ product: `  ${PRODUCT}  `, condition: "중고도 괜찮아" });
    await POST(postRequest(body));
    expect(register).toHaveBeenCalledWith({
      clientRequestId: body.clientRequestId,
      product: PRODUCT,
      budget: BUDGET,
      condition: "중고도 괜찮아",
      brand: "Sony",
      item: "헤드셋",
      conditionKind: "used",
    });
  });

  it("로그에 이용자 답을 남기지 않는다", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args.map(String).join(" "));
      });
    }
    await POST(postRequest(answers()));
    await POST(postRequest(answers({ product: "sony껄로 사고싶어" })));
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      for (const secret of [PRODUCT, BUDGET, CONDITION, "sony껄로"]) {
        expect(line).not.toContain(secret);
      }
    }
  });
});

describe("GET /api/requests/[requestId] (메모리 저장소)", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200으로 번호·상태·제품을 돌려준다", async () => {
    const created = await (await POST(postRequest(answers()))).json();
    const response = await getRequest(created.requestId);
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/^store;dur=\d+$/);
    expect(await response.json()).toEqual({
      requestId: created.requestId,
      queueNumber: created.queueNumber,
      status: "waiting",
      product: PRODUCT,
    });
  });

  it("UUID가 아니면 400", async () => {
    const response = await getRequest("not-a-uuid");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
  });

  it("없으면 404와 persistent(메모리는 false)", async () => {
    const response = await getRequest(randomUUID());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "not_found", persistent: false });
  });

  it("로그인 쿠키 없이도 200으로 다시 열 수 있다(이용자 쪽은 열려 있다)", async () => {
    const created = await (await POST(postRequest(answers()))).json();
    expect((await getRequest(created.requestId)).status).toBe(200);
  });

  it("분당 61번째는 429와 Retry-After", async () => {
    const client = freshClient();
    const id = randomUUID();
    for (let i = 0; i < 60; i += 1) {
      expect((await getRequest(id, { client })).status).toBe(404);
    }
    const limited = await getRequest(id, { client });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("저장소 오류는 503", async () => {
    requestStore.resetRequestStoresForTest({
      persistent: true,
      storeKind: () => "supabase",
      register: vi.fn(),
      get: () => Promise.reject(new requestStore.StoreUnavailableError("down")),
    });
    const response = await getRequest(randomUUID());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "store_unavailable" });
  });
});
