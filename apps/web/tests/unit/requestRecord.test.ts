import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRequest,
  clearRequestRecord,
  parseRequestRecord,
  readRequestRecord,
  registerRequest,
  REQUEST_STORAGE_KEY,
  saveRequestRecord,
} from "@/lib/requestRecord";
import { STATUS } from "@/lib/speech";

const ANSWERS = { product: "소니 헤드셋", budget: "10만 원", condition: "새 제품" };
const ID = "11111111-1111-4111-8111-111111111111";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registerRequest", () => {
  it("세 답과 clientRequestId를 한 번에 보내고 대기번호를 받는다", async () => {
    const fetchMock = respond(201, { requestId: ID, queueNumber: 3, status: "waiting" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await registerRequest("cid", ANSWERS)).toEqual({
      kind: "queued",
      requestId: ID,
      queueNumber: 3,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ clientRequestId: "cid", ...ANSWERS });
  });

  it("재전송 200(existing)도 대기번호로 받는다", async () => {
    vi.stubGlobal("fetch", respond(200, { requestId: ID, queueNumber: 3, status: "waiting" }));
    expect((await registerRequest("cid", ANSWERS)).kind).toBe("queued");
  });

  it("401·429·500·모양 이상·네트워크 실패는 다시 보낼 수 있는 실패, 422는 품목 없음", async () => {
    const cases: [ReturnType<typeof vi.fn>, unknown][] = [
      [respond(401, { ok: false }), { kind: "failed", status: STATUS.noAccess }],
      [respond(429, { ok: false }), { kind: "failed", status: STATUS.tooMany }],
      [respond(500, { ok: false }), { kind: "failed", status: STATUS.registerFailed }],
      [respond(503, { ok: false }), { kind: "failed", status: STATUS.registerFailed }],
      [respond(201, { requestId: ID, queueNumber: 0 }), { kind: "failed", status: STATUS.registerFailed }],
      [vi.fn().mockRejectedValue(new TypeError("network")), { kind: "failed", status: STATUS.registerFailed }],
      [respond(422, { ok: false, error: "need_item" }), { kind: "needProduct" }],
    ];
    for (const [fetchMock, expected] of cases) {
      vi.stubGlobal("fetch", fetchMock);
      expect(await registerRequest("cid", ANSWERS)).toEqual(expected);
    }
  });
});

describe("checkRequest", () => {
  it("200 waiting → 기다리는 중, expired → 없음", async () => {
    vi.stubGlobal("fetch", respond(200, { requestId: ID, queueNumber: 5, status: "waiting", product: "x" }));
    expect(await checkRequest(ID)).toEqual({ kind: "waiting", queueNumber: 5 });
    vi.stubGlobal("fetch", respond(200, { requestId: ID, queueNumber: 5, status: "expired", product: "x" }));
    expect(await checkRequest(ID)).toEqual({ kind: "gone" });
  });

  it("404는 없음, 다만 메모리 저장소(persistent:false)면 확인 실패", async () => {
    vi.stubGlobal("fetch", respond(404, { ok: false, error: "not_found", persistent: true }));
    expect(await checkRequest(ID)).toEqual({ kind: "gone" });
    vi.stubGlobal("fetch", respond(404, { ok: false, error: "not_found", persistent: false }));
    expect(await checkRequest(ID)).toEqual({ kind: "failed" });
  });

  it("500·네트워크 실패는 확인 실패", async () => {
    vi.stubGlobal("fetch", respond(500, { ok: false }));
    expect(await checkRequest(ID)).toEqual({ kind: "failed" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect(await checkRequest(ID)).toEqual({ kind: "failed" });
  });
});

describe("기기 안 기록 lh.request.v1", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
  });

  it("저장하고 다시 읽고 지운다", () => {
    saveRequestRecord({ requestId: ID, queueNumber: 2, product: "소니 헤드셋" });
    expect(readRequestRecord()).toMatchObject({ v: 1, requestId: ID, queueNumber: 2, product: "소니 헤드셋" });
    clearRequestRecord();
    expect(readRequestRecord()).toBeNull();
  });

  it("깨진 기록은 null이고 지운다", () => {
    storage.setItem(REQUEST_STORAGE_KEY, "{broken");
    expect(readRequestRecord()).toBeNull();
    expect(storage.values.has(REQUEST_STORAGE_KEY)).toBe(false);
    expect(parseRequestRecord(JSON.stringify({ v: 2, requestId: ID, queueNumber: 1, product: "x", savedAt: 1 }))).toBeNull();
    expect(parseRequestRecord(JSON.stringify({ v: 1, requestId: ID, queueNumber: -1, product: "x", savedAt: 1 }))).toBeNull();
  });

  it("저장소가 막혀도 던지지 않는다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveRequestRecord({ requestId: ID, queueNumber: 1, product: "x" })).not.toThrow();
    expect(readRequestRecord()).toBeNull();
    expect(() => clearRequestRecord()).not.toThrow();
  });
});
