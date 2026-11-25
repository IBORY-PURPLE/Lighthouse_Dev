import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_COOKIE, readDeviceId, resolveDevice } from "@/lib/deviceSession";
import { LIVE_LOG_MAX_BYTES } from "@/lib/liveLogWire";
import type { LiveEventRow } from "@/lib/liveLogStore";
import type { RpcClient } from "@/lib/requestStore";

// POST /api/live/log. 라우트의 제한기는 모듈 메모리라 시험마다 모듈을 새로 불러온다.

const ORIGIN = "http://localhost:3000";
const freshClient = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

type LogRoute = typeof import("@/app/api/live/log/route");
type Store = typeof import("@/lib/liveLogStore");
type RequestStoreModule = typeof import("@/lib/requestStore");
let route: LogRoute;
let store: Store;
// 모듈을 새로 불러오므로 가짜 클라이언트도 새로 불러온 모듈에 건다(시험 위쪽의 import는 다른 인스턴스다).
let requestStore: RequestStoreModule;

const entry = (patch: Record<string, unknown> = {}) => ({
  cid: randomUUID(),
  seq: 0,
  kind: "user",
  tag: "heard",
  body: "소니 헤드셋 찾아 주세요",
  phase: "listening",
  engine: "realtime",
  atMs: 100,
  ...patch,
});

/** 진짜 서명 쿠키(lh_device)를 만든다. 서명 비밀은 DEMO_ACCESS_CODE. */
function deviceCookie(): { cookie: string; deviceId: string } {
  const issued = resolveDevice(new NextRequest(`${ORIGIN}/`)).issued as string;
  return { cookie: `${DEVICE_COOKIE}=${issued}`, deviceId: readDeviceId(issued) as string };
}

interface Options {
  cookie?: string | null;
  client?: string;
  origin?: string;
  host?: string;
}

function post(body: unknown, options: Options = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": options.client ?? freshClient(), "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  if (options.host) headers["x-forwarded-host"] = options.host;
  return route.POST(
    new NextRequest(`${ORIGIN}/api/live/log`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers,
    }),
  );
}

const good = (...entries: unknown[]) => ({ label: "P01", entries });

interface Upsert {
  rows: LiveEventRow[];
}
function fakeDb(upsert?: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>) {
  const upserts: Upsert[] = [];
  const client = {
    from: () => ({
      upsert: (rows: LiveEventRow[]) => {
        upserts.push({ rows });
        return upsert ? upsert() : Promise.resolve({ data: null, error: null });
      },
      select: () => Promise.resolve({ count: 1, error: null }),
    }),
  };
  vi.spyOn(requestStore, "getSupabaseRpcClient").mockReturnValue(client as unknown as RpcClient);
  return upserts;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("LIVE_ENABLED", undefined);
  vi.stubEnv("LIVE_LOG", "on");
  vi.stubEnv("LIVE_LOG_UNTIL", undefined);
  vi.stubEnv("DEMO_ACCESS_CODE", "test-signing-secret");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  route = await import("@/app/api/live/log/route");
  store = await import("@/lib/liveLogStore");
  requestStore = await import("@/lib/requestStore");
  store.resetLiveLogForTest();
  vi.spyOn(requestStore, "getSupabaseRpcClient").mockReturnValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/live/log 문 앞", () => {
  it("라우트 설정: nodejs, 10초", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(10);
  });

  it("LIVE_ENABLED=off면 404(다른 /api/live/*와 같은 본문)", async () => {
    vi.stubEnv("LIVE_ENABLED", "off");
    const response = await post(good(entry()), deviceCookie());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "disabled" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("다른 출처(Origin이 호스트와 다름)면 403, 같은 출처나 Origin 없음은 통과", async () => {
    const device = deviceCookie();
    const forbidden = await post(good(entry()), { ...device, origin: "https://evil.example" });
    expect(forbidden.status).toBe(403);
    expect(store.memoryLiveEventsForTest()).toEqual([]);
    expect((await post(good(entry()), { ...device, origin: ORIGIN })).status).toBe(200);
    expect((await post(good(entry({ seq: 1 })), { ...device, origin: "https://qa.example", host: "qa.example" })).status).toBe(200);
    expect((await post(good(entry({ seq: 2 })), device)).status).toBe(200);
    expect((await post(good(entry()), { ...device, origin: "not a url" })).status).toBe(403);
  });
});

describe("POST /api/live/log 스위치", () => {
  it("LIVE_LOG가 꺼져 있으면 200 off이고 DB를 부르지 않는다", async () => {
    vi.stubEnv("LIVE_LOG", "off");
    const upserts = fakeDb();
    const response = await post(good(entry()), deviceCookie());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: 0, reason: "off" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(upserts).toHaveLength(0);
    expect(store.memoryLiveEventsForTest()).toEqual([]);
  });

  it("끝 날짜가 지났으면 200 ended이고 DB를 부르지 않는다", async () => {
    vi.stubEnv("LIVE_LOG_UNTIL", "2020-01-01");
    const upserts = fakeDb();
    const response = await post(good(entry()), deviceCookie());
    expect(await response.json()).toEqual({ stored: 0, reason: "ended" });
    expect(upserts).toHaveLength(0);
  });

  it("끝 날짜 안이면 저장한다", async () => {
    vi.stubEnv("LIVE_LOG_UNTIL", "2099-12-03");
    const response = await post(good(entry()), deviceCookie());
    expect(await response.json()).toEqual({ stored: 1, reason: "saved" });
  });

  it("on인데 표지가 없거나 틀리면 no_label이다(모양 틀린 표지도)", async () => {
    const device = deviceCookie();
    for (const label of [undefined, "", "toolonglabel!!", "P 01", 5, null]) {
      const response = await post({ label, entries: [entry()] }, device);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ stored: 0, reason: "no_label" });
    }
    expect(store.memoryLiveEventsForTest()).toEqual([]);
  });

  it("all이면 표지가 없어도 저장하고 label은 ''로 남는다", async () => {
    vi.stubEnv("LIVE_LOG", "all");
    const response = await post({ entries: [entry()] }, deviceCookie());
    expect(await response.json()).toEqual({ stored: 1, reason: "saved" });
    expect(store.memoryLiveEventsForTest()[0].label).toBe("");
  });

  it("all이어도 틀린 표지는 ''로 저장한다", async () => {
    vi.stubEnv("LIVE_LOG", "all");
    await post({ label: "bad label!", entries: [entry()] }, deviceCookie());
    expect(store.memoryLiveEventsForTest()[0].label).toBe("");
  });
});

describe("POST /api/live/log 기기", () => {
  it("기기 쿠키가 없으면 200 no_device이고 쿠키를 심지 않는다", async () => {
    const response = await post(good(entry()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: 0, reason: "no_device" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.memoryLiveEventsForTest()).toEqual([]);
  });

  it("서명이 틀린 쿠키도 no_device이고 쿠키를 심지 않는다", async () => {
    const response = await post(good(entry()), { cookie: `${DEVICE_COOKIE}=v1.${"a".repeat(43)}.${"b".repeat(43)}` });
    expect(await response.json()).toEqual({ stored: 0, reason: "no_device" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("서명 비밀이 없으면 쿠키가 있어도 no_device다", async () => {
    const device = deviceCookie();
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const response = await post(good(entry()), device);
    expect(await response.json()).toEqual({ stored: 0, reason: "no_device" });
  });

  it("저장 성공 응답에도 Set-Cookie가 없다", async () => {
    const response = await post(good(entry()), deviceCookie());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("줄마다 쿠키에서 읽은 기기 ID가 붙는다", async () => {
    const { cookie, deviceId } = deviceCookie();
    await post(good(entry({ seq: 0 }), entry({ seq: 1, kind: "ai", tag: "reply" })), { cookie });
    const saved = store.memoryLiveEventsForTest();
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.device_id === deviceId)).toBe(true);
    expect(deviceId).toMatch(/^u-[0-9a-f]{32}$/);
  });
});

describe("POST /api/live/log 본문", () => {
  const empty = { stored: 0, reason: "empty" };

  it("JSON이 아니거나 모양이 틀리면 200 empty(다시 보내지 않게)", async () => {
    const device = deviceCookie();
    for (const body of ["not json", "[]", "null", "5", '{"label":"P01"}', '{"label":"P01","entries":"x"}', '{"entries":{"0":1}}', ""]) {
      const response = await post(body, device);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(empty);
    }
  });

  it("본문이 32KB를 넘으면 200 empty", async () => {
    const big = JSON.stringify({ label: "P01", entries: [entry({ body: "가".repeat(LIVE_LOG_MAX_BYTES) })] });
    expect(Buffer.byteLength(big)).toBeGreaterThan(LIVE_LOG_MAX_BYTES);
    const response = await post(big, deviceCookie());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(empty);
  });

  it("쓸 수 있는 줄이 없으면 200 empty", async () => {
    const response = await post(good(entry({ kind: "robot" }), entry({ body: "  " })), deviceCookie());
    expect(await response.json()).toEqual(empty);
  });

  it("나쁜 줄 1 + 좋은 줄 2 → stored 2, 좋은 줄만 저장", async () => {
    const cid = randomUUID();
    const response = await post(
      good(entry({ cid, seq: 0, body: "하나" }), entry({ cid, seq: 1, kind: "ghost" }), entry({ cid, seq: 2, body: "셋" })),
      deviceCookie(),
    );
    expect(await response.json()).toEqual({ stored: 2, reason: "saved" });
    expect(store.memoryLiveEventsForTest().map((row) => row.body)).toEqual(["하나", "셋"]);
  });

  it("전화번호는 가려서 저장한다", async () => {
    await post(good(entry({ body: "010-1234-5678 로 전화 주세요" })), deviceCookie());
    expect(store.memoryLiveEventsForTest()[0].body).toBe("(전화번호 가림) 로 전화 주세요");
  });

  it("1,001자(이모지)는 1,000자로 자르고 반쪽 글자가 없다", async () => {
    await post(good(entry({ body: "😀".repeat(1001) })), deviceCookie());
    const body = store.memoryLiveEventsForTest()[0].body;
    expect(Array.from(body)).toHaveLength(1000);
    expect(body.isWellFormed()).toBe(true);
  });

  it("event의 body는 비우고 tag는 남긴다", async () => {
    await post(good(entry({ kind: "event", tag: "MIC_DENIED", body: "새면 안 되는 말" })), deviceCookie());
    expect(store.memoryLiveEventsForTest()[0]).toMatchObject({ kind: "event", tag: "MIC_DENIED", body: "" });
  });

  it("DB로 넘기는 모든 줄에 열 11개가 있고 created_at, delete_after는 없다", async () => {
    const upserts = fakeDb();
    await post(
      good(entry({ seq: 0 }), { cid: randomUUID(), seq: 1, kind: "event", tag: "START" }, { cid: randomUUID(), seq: 2, kind: "app", body: "안녕" }),
      deviceCookie(),
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows).toHaveLength(3);
    for (const row of upserts[0].rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["at_ms", "body", "cid", "device_id", "engine", "env", "kind", "label", "phase", "seq", "tag"].sort(),
      );
    }
  });

  it("한 요청은 앞에서 40줄까지만 받는다", async () => {
    const cid = randomUUID();
    const entries = Array.from({ length: 50 }, (_, index) => entry({ cid, seq: index }));
    const response = await post(good(...entries), deviceCookie());
    expect(await response.json()).toEqual({ stored: 40, reason: "saved" });
  });
});

describe("POST /api/live/log 저장 결과", () => {
  it("표가 없으면 200 unavailable이다", async () => {
    fakeDb(() => Promise.resolve({ data: null, error: { code: "PGRST205" } }));
    const response = await post(good(entry()), deviceCookie());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: 0, reason: "unavailable" });
  });

  it("영구 오류(23514)는 200 failed이다", async () => {
    fakeDb(() => Promise.resolve({ data: null, error: { code: "23514" } }));
    const response = await post(good(entry()), deviceCookie());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: 0, reason: "failed" });
  });

  it("그 밖의 오류와 시간 초과는 503이다", async () => {
    fakeDb(() => Promise.resolve({ data: null, error: { code: "08006" } }));
    const response = await post(good(entry()), deviceCookie());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    fakeDb(() => Promise.reject(new Error("fetch failed")));
    store.resetLiveLogForTest();
    expect((await post(good(entry()), deviceCookie())).status).toBe(503);
  });

  it("운영에서 클라이언트가 없으면 200 unavailable이다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LIVE_ENABLED", "on");
    const response = await post(good(entry()), deviceCookie());
    expect(await response.json()).toEqual({ stored: 0, reason: "unavailable" });
    expect(store.memoryLiveEventsForTest()).toEqual([]);
  });

  it("줄 수 어림이 상한을 넘으면 200 capped이다", async () => {
    const client = {
      from: () => ({
        upsert: () => Promise.resolve({ data: null, error: null }),
        select: () => Promise.resolve({ count: 5_000_000, error: null }),
      }),
    };
    vi.spyOn(requestStore, "getSupabaseRpcClient").mockReturnValue(client as unknown as RpcClient);
    const response = await post(good(entry()), deviceCookie());
    expect(await response.json()).toEqual({ stored: 0, reason: "capped" });
  });

  it("같은 줄을 다시 보내도 stored는 센다(멱등은 DB가 지킨다)", async () => {
    const device = deviceCookie();
    const body = good(entry({ seq: 0 }));
    expect(await (await post(body, device)).json()).toEqual({ stored: 1, reason: "saved" });
    expect(await (await post(body, device)).json()).toEqual({ stored: 1, reason: "saved" });
    expect(store.memoryLiveEventsForTest()).toHaveLength(1);
  });
});

describe("POST /api/live/log 횟수 제한", () => {
  it("IP당 1,200회/분을 넘으면 429와 Retry-After", async () => {
    const client = "198.51.100.7";
    for (let index = 0; index < 1200; index += 1) {
      const response = await post("[]", { client });
      expect(response.status).toBe(200);
    }
    const limited = await post("[]", { client });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    // 다른 주소는 막지 않는다.
    expect((await post("[]", { client: "198.51.100.8" })).status).toBe(200);
  });

  it("꺼져 있을 때는 횟수를 세지 않는다(off 응답이 먼저)", async () => {
    vi.stubEnv("LIVE_LOG", "off");
    const client = "198.51.100.9";
    for (let index = 0; index < 1300; index += 1) expect((await post("[]", { client })).status).toBe(200);
  });

  it("기기당 120회/분을 넘으면 429이고 다른 기기는 영향이 없다", async () => {
    const device = deviceCookie();
    for (let index = 0; index < 120; index += 1) {
      expect((await post(good(entry({ seq: index % 1000 })), device)).status).toBe(200);
    }
    const limited = await post(good(entry()), device);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await post(good(entry()), deviceCookie())).status).toBe(200);
  });
});

describe("POST /api/live/log 로그 한 줄", () => {
  it("상태·시간·줄 수·결과·기기 여부만 남기고 글, cid, 기기 ID, 표지는 남기지 않는다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cookie, deviceId } = deviceCookie();
    const cid = randomUUID();
    await post({ label: "SECRETLABEL", entries: [entry({ cid, body: "비밀스러운 이용자 말 하나" })] }, { cookie });
    await post({ label: "SECRETLABEL", entries: [entry({ cid, body: "비밀스러운 이용자 말 하나" })] });
    vi.stubEnv("LIVE_LOG", "off");
    await post({ label: "SECRETLABEL", entries: [entry({ cid })] }, { cookie });
    vi.stubEnv("LIVE_LOG", "on");
    fakeDb(() => Promise.reject(new Error(`secret ${cid} ${deviceId}`)));
    await post({ label: "SECRETLABEL", entries: [entry({ cid, body: "비밀스러운 이용자 말 하나" })] }, { cookie });

    const lines = info.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^POST \/api\/live\/log 200 \d+ms n=1 store=saved device=ok$/);
    expect(lines[1]).toMatch(/^POST \/api\/live\/log 200 \d+ms n=1 store=no_device device=none$/);
    expect(lines[2]).toMatch(/^POST \/api\/live\/log 200 \d+ms n=0 store=off device=none$/);
    expect(lines[3]).toMatch(/^POST \/api\/live\/log 503 \d+ms n=1 store=retry device=ok$/);
    const everything = JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]);
    for (const secret of ["비밀스러운", "SECRETLABEL", cid, deviceId, cookie.split("=")[1]]) {
      expect(everything).not.toContain(secret);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
