import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/requests/[requestId]/route";
import { POST } from "@/app/api/requests/route";
import { readRequestDetails, resetRequestDetailsForTest } from "@/lib/requestDetails";
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

  it("품목 사전에 없는 물건도 201로 접수하고 item은 비워 둔다(A6)", async () => {
    const response = await POST(postRequest(answers({ product: "sony껄로 사고싶어" })));
    expect(response.status).toBe(201);
    const { requestId } = await response.json();
    const queue = await requestStore.getRequestStore().listQueue("volunteer-test");
    expect(queue.waiting).toContainEqual(
      expect.objectContaining({ requestId, product: "sony껄로 사고싶어", item: null }),
    );
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
      // 서명 비밀(DEMO_ACCESS_CODE)이 없으면 기기를 구분하지 못한다.
      deviceId: null,
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

describe("POST /api/requests의 details(이용자 요청 브리핑)", () => {
  const DETAILS = {
    summary: "소니 무선 헤드셋, 노이즈 캔슬링",
    qa: [
      { q: "어디에 쓰세요?", a: "출퇴근 지하철에서 써요" },
      { q: "예산은 얼마인가요?", a: "십만 원 정도" },
    ],
  };

  beforeEach(() => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
    resetRequestDetailsForTest();
  });
  afterEach(() => {
    resetRequestDetailsForTest();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function spyLogs(): string[] {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args.map(String).join(" "));
      });
    }
    return logged;
  }

  it("details를 저장하고 응답 모양은 그대로다(details를 돌려주지 않는다)", async () => {
    const body = answers({ details: DETAILS });
    const response = await POST(postRequest(body));
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toEqual({ requestId: expect.any(String), queueNumber: 1, status: "waiting" });
    expect(await readRequestDetails(created.requestId)).toEqual(DETAILS);
  });

  it("details가 없으면 지금처럼 접수하고 저장하지 않는다", async () => {
    const created = await (await POST(postRequest(answers()))).json();
    expect(await readRequestDetails(created.requestId)).toBeNull();
  });

  it("잘못된 details는 무시하고 접수는 201이다", async () => {
    for (const details of ["문자열", 3, [], { summary: 3, qa: "x" }, { summary: "", qa: [{ q: "답이 빔", a: "" }] }, null]) {
      const response = await POST(postRequest(answers({ details })));
      expect(response.status).toBe(201);
      expect(await readRequestDetails((await response.json()).requestId)).toBeNull();
    }
  });

  it("같은 접수를 다시 보내면(200) 처음 details를 지킨다", async () => {
    const body = answers({ details: DETAILS });
    const first = await (await POST(postRequest(body))).json();
    const again = await POST(postRequest({ ...body, details: { summary: "다른 말", qa: [] } }));
    expect(again.status).toBe(200);
    expect((await again.json()).requestId).toBe(first.requestId);
    expect(await readRequestDetails(first.requestId)).toEqual(DETAILS);
  });

  it("긴 말·전화번호는 다듬어서 저장한다", async () => {
    const created = await (
      await POST(
        postRequest(
          answers({ details: { summary: "가".repeat(400), qa: [{ q: "연락처는요?", a: "010-1234-5678" }] } }),
        ),
      )
    ).json();
    const saved = await readRequestDetails(created.requestId);
    expect([...(saved?.summary ?? "")]).toHaveLength(300);
    expect(saved?.qa).toEqual([{ q: "연락처는요?", a: "(전화번호 가림)" }]);
  });

  it("본문이 32KB를 넘으면 413 too_large이고 접수하지 않는다", async () => {
    const register = vi.fn();
    requestStore.resetRequestStoresForTest({ persistent: true, storeKind: () => "memory", register, get: vi.fn() });
    const big = answers({ details: { summary: "요약", qa: [], pad: "가".repeat(40_000) } });
    const response = await POST(postRequest(big));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "too_large" });
    expect(register).not.toHaveBeenCalled();
  });

  it("content-type이 없어도 받는다(검사하지 않는다). 깨진 JSON은 그대로 400이다", async () => {
    expect((await POST(postRequest(answers({ details: DETAILS })))).status).toBe(201);
    expect((await POST(postRequest("{깨진"))).status).toBe(400);
    expect((await POST(postRequest(""))).status).toBe(400);
  });

  it("로그에 이용자 답(요약·질문·답)을 남기지 않고 저장 결과만 남긴다", async () => {
    const logged = spyLogs();
    await POST(postRequest(answers({ details: DETAILS })));
    await POST(postRequest(answers({ details: "문자열" })));
    await POST(postRequest(answers()));
    const joined = logged.join("\n");
    expect(logged.length).toBeGreaterThan(0);
    for (const secret of [PRODUCT, BUDGET, CONDITION, DETAILS.summary, "출퇴근", "지하철", "십만 원 정도", "어디에 쓰세요"]) {
      expect(joined).not.toContain(secret);
    }
    expect(joined).toMatch(/POST \/api\/requests 201 \d+ms store=\d+ms details=saved/);
    expect(joined).toMatch(/details=ignored/);
    expect(joined).toMatch(/details=none/);
  });

  it("이용자 상태 조회(GET)는 details를 돌려주지 않는다", async () => {
    const created = await (await POST(postRequest(answers({ details: DETAILS })))).json();
    const body = await (await getRequest(created.requestId)).json();
    expect(Object.keys(body).sort()).toEqual(["product", "queueNumber", "requestId", "status"]);
    expect(JSON.stringify(body)).not.toContain("출퇴근");
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

  it("봉사자가 맡으면 in_progress, 보내면 done과 리뷰 문단·보낸 시각을 돌려준다(이용자 화면이 읽어 준다)", async () => {
    const created = await (await POST(postRequest(answers()))).json();
    const store = requestStore.getRequestStore();
    expect(await store.claim(created.requestId, "vol-1")).toBe("claimed");
    expect((await (await getRequest(created.requestId)).json()).status).toBe("in_progress");
    const outcome = await store.complete(created.requestId, "vol-1", [
      { name: "WH-1000XM5", url: "", guide: "가볍고 오래 써도 귀가 편했어요.", summary: [] },
    ]);
    expect(outcome.outcome).toBe("completed");
    const body = await (await getRequest(created.requestId)).json();
    expect(body.status).toBe("done");
    expect(body.review).toBe("가볍고 오래 써도 귀가 편했어요.");
    expect(typeof body.sentAt).toBe("string");
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
      getForDevice: () => Promise.reject(new requestStore.StoreUnavailableError("down")),
    });
    const response = await getRequest(randomUUID());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "store_unavailable" });
  });
});
