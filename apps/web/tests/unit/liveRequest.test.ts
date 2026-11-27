import { describe, expect, it, vi } from "vitest";
import type { LiveDraft } from "@/lib/liveEngine";
import { toDraft } from "@/lib/liveText";
import {
  LIVE_DEVICE_READY_MS,
  LIVE_PUSH_KEY,
  LIVE_RECORDS_KEY,
  LIVE_RECORDS_MAX,
  LIVE_REGISTER_DELAYS_MS,
  LIVE_REGISTER_TIMEOUT_MS,
  UNDECIDED,
  attachPushIfOn,
  classifyRegister,
  conditionOf,
  registerLive,
  saveLiveRecord,
  startDeviceReady,
  toLiveRequest,
  type LiveRequestBody,
} from "@/lib/liveRequest";

// 접수 흐름(설계서 12절). 유료 호출 없이 가짜 fetch·sleep으로 재시도와 분류를 고정한다.
const CID = "11111111-1111-4111-8111-111111111111";
const SERVER_MAX = 200; // /api/requests의 product·budget·condition 길이 상한(route.ts:98-100)

const draft = (o: Partial<LiveDraft> = {}): LiveDraft => ({
  product: "소니 헤드셋",
  info: "노이즈 캔슬링 여부",
  options: "새 제품, 검은색",
  budget: "10만 원",
  summary: "제품은 소니 헤드셋. 알고 싶은 정보는 노이즈 캔슬링 여부. 옵션은 새 제품, 검은색. 예산은 10만 원.",
  ...o,
});

const BODY: LiveRequestBody = {
  clientRequestId: CID,
  product: "소니 헤드셋",
  budget: "10만 원",
  condition: "새 제품",
  details: { summary: "요약", qa: [] },
};

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const OK_BODY = { requestId: "req-1", queueNumber: 3, status: "waiting" };

function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    values,
  };
}

describe("상수", () => {
  it("설계서 12.1절 값", () => {
    expect(LIVE_RECORDS_KEY).toBe("lh-requests");
    expect(LIVE_RECORDS_MAX).toBe(20);
    expect(LIVE_PUSH_KEY).toBe("lh-push");
    expect(LIVE_REGISTER_TIMEOUT_MS).toBe(10_000);
    expect(LIVE_REGISTER_DELAYS_MS).toEqual([0, 1_000, 3_000]);
    expect(LIVE_DEVICE_READY_MS).toBe(4_000);
    expect(UNDECIDED).toBe("정하지 않음");
  });
});

describe("conditionOf", () => {
  it.each([
    ["중고 말고 새 제품", "새 제품"],
    ["새 제품이든 중고든 상관없어요", "상관없음"],
    ["중고", "중고"],
    ["새 제품", "새 제품"],
    ["중고도 새 제품도 괜찮아요", "정하지 않음"],
    ["", "정하지 않음"],
  ])("%s → %s", (text, expected) => {
    expect(conditionOf(text)).toBe(expected);
  });

  it("새 제품만 부정하면 중고, 하나만 나오고 부정되면 반대쪽", () => {
    expect(conditionOf("새 제품 말고 중고")).toBe("중고");
    expect(conditionOf("새 제품은 싫어요")).toBe("중고");
    expect(conditionOf("중고는 안 돼요")).toBe("새 제품");
    expect(conditionOf("중고 빼고")).toBe("새 제품");
  });
  it("신품, 미개봉, 아무거나, 둘 다도 읽는다", () => {
    expect(conditionOf("미개봉이면 좋아요")).toBe("새 제품");
    expect(conditionOf("아무거나 괜찮아요")).toBe("상관없음");
    expect(conditionOf("둘 다 괜찮아요")).toBe("상관없음");
  });
  it("둘 다 부정되면 정하지 않음", () => {
    expect(conditionOf("중고 말고 새 제품 말고")).toBe("정하지 않음");
  });
  it("안전, 안쪽 같은 낱말의 '안'은 부정으로 읽지 않는다", () => {
    expect(conditionOf("새 제품 안전한 걸로")).toBe("새 제품");
  });
});

describe("toLiveRequest", () => {
  it("칸과 요약이 그대로 들어간다", () => {
    const body = toLiveRequest(draft(), CID)!;
    expect(body.clientRequestId).toBe(CID);
    expect(body.product).toBe("소니 헤드셋");
    expect(body.budget).toBe("10만 원");
    expect(body.condition).toBe("새 제품");
    expect(body.details.summary).toBe(draft().summary);
  });
  it("qa는 정해진 순서이고 빈 답은 뺀다", () => {
    const body = toLiveRequest(draft(), CID)!;
    expect(body.details.qa).toEqual([
      { q: "원하는 제품", a: "소니 헤드셋" },
      { q: "알고 싶은 정보", a: "노이즈 캔슬링 여부" },
      { q: "원하는 옵션", a: "새 제품, 검은색" },
      { q: "예산", a: "10만 원" },
    ]);
    const sparse = toLiveRequest(draft({ info: "", options: "", budget: "" }), CID)!;
    expect(sparse.details.qa).toEqual([{ q: "원하는 제품", a: "소니 헤드셋" }]);
  });
  it("예산이 비면 '정하지 않음'이다", () => {
    expect(toLiveRequest(draft({ budget: "" }), CID)!.budget).toBe(UNDECIDED);
  });
  it("조건은 옵션과 예산 글에서 읽는다", () => {
    expect(toLiveRequest(draft({ options: "중고 말고 새 제품" }), CID)!.condition).toBe("새 제품");
    expect(toLiveRequest(draft({ options: "", budget: "상관없어요" }), CID)!.condition).toBe("상관없음");
    expect(toLiveRequest(draft({ options: "검은색", budget: "5만 원" }), CID)!.condition).toBe(UNDECIDED);
  });
  it("제품이 비면 null이다", () => {
    expect(toLiveRequest(draft({ product: "" }), CID)).toBeNull();
    expect(toLiveRequest(draft({ product: "   " }), CID)).toBeNull();
  });
  it("모든 글의 length가 서버 상한 이하다(이모지 포함)", () => {
    const emoji = "😀".repeat(150); // UTF-16으로 300
    const body = toLiveRequest(
      draft({ product: emoji, info: emoji, options: emoji, budget: emoji, summary: emoji.repeat(2) }),
      CID,
    )!;
    expect(body.product.length).toBeLessThanOrEqual(SERVER_MAX);
    expect(body.budget.length).toBeLessThanOrEqual(SERVER_MAX);
    expect(body.condition.length).toBeLessThanOrEqual(SERVER_MAX);
    expect(body.details.summary.length).toBeLessThanOrEqual(300);
    for (const { a } of body.details.qa) expect(a.length).toBeLessThanOrEqual(SERVER_MAX);
  });
  it("200자 이하는 그대로 둔다", () => {
    const p = "가".repeat(70);
    expect(toLiveRequest(draft({ product: p }), CID)!.product).toBe(p);
  });
});

describe("classifyRegister", () => {
  it.each([
    [200, "ok"],
    [201, "ok"],
    [429, "rate_limited"],
    [400, "rejected"],
    [413, "rejected"],
    [409, "conflict"],
    [500, "retryable"],
    [503, "retryable"],
    [404, "retryable"],
    ["network", "unknown"],
    ["timeout", "unknown"],
  ] as const)("%s → %s", (status, expected) => {
    expect(classifyRegister(status)).toBe(expected);
  });
});

describe("startDeviceReady", () => {
  it("쿠키를 받으려고 GET /api/requests를 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { items: [] }));
    await startDeviceReady(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("/api/requests", { cache: "no-store" });
  });
  it("fetch가 실패해도 던지지 않는다", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    await expect(startDeviceReady(f as unknown as typeof fetch)).resolves.toBeUndefined();
  });
  it("fetch가 동기로 던져도 던지지 않는다", async () => {
    const f = vi.fn(() => {
      throw new Error("sync");
    });
    await expect(startDeviceReady(f as unknown as typeof fetch)).resolves.toBeUndefined();
  });
  it("응답이 오지 않으면 4초 뒤에 풀린다", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(() => new Promise<Response>(() => {}));
      let done = false;
      const p = startDeviceReady(f as unknown as typeof fetch).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(LIVE_DEVICE_READY_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("registerLive", () => {
  function setup(responses: (Response | Error)[]) {
    const fetchMock = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("응답 없음");
      if (next instanceof Error) throw next;
      return next;
    });
    const sleeps: number[] = [];
    const deps = {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn(async (ms: number) => void sleeps.push(ms)),
      deviceReady: Promise.resolve(),
      onBusy: vi.fn(),
    };
    return { fetchMock, sleeps, deps };
  }

  it("201이면 성공이고 번호를 돌려준다", async () => {
    const { deps, fetchMock } = setup([json(201, OK_BODY)]);
    const result = await registerLive(BODY, deps);
    expect(result).toEqual({ ok: true, requestId: "req-1", queueNumber: 3, status: "waiting" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("POST /api/requests에 본문 그대로, keepalive:true, 중단 신호와 함께 보낸다", async () => {
    const { deps, fetchMock } = setup([json(201, OK_BODY)]);
    await registerLive(BODY, deps);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/requests");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(BODY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("503 두 번 뒤 201이면 간격 0·1000·3000으로 세 번 보내 성공한다", async () => {
    const { deps, fetchMock, sleeps } = setup([json(503), json(503), json(201, OK_BODY)]);
    const result = await registerLive(BODY, deps);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1_000, 3_000]);
  });
  it("503 세 번이면 retryable이다", async () => {
    const { deps, fetchMock } = setup([json(503), json(500), json(503)]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "retryable" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("시간 초과 세 번이면 unknown이다", async () => {
    const { deps, fetchMock } = setup([abortError(), abortError(), abortError()]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("네트워크 오류도 unknown이다", async () => {
    const { deps } = setup([new TypeError("fail"), new TypeError("fail"), new TypeError("fail")]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "unknown" });
  });
  it("503과 시간 초과가 섞이면 unknown이다", async () => {
    const { deps } = setup([json(503), abortError(), json(503)]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "unknown" });
  });
  it("400은 바로 rejected이고 한 번만 부른다", async () => {
    const { deps, fetchMock } = setup([json(400, { ok: false, error: "too_long" })]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("413도 rejected다", async () => {
    const { deps } = setup([json(413)]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "rejected" });
  });
  it("409는 바로 conflict이고 한 번만 부른다", async () => {
    const { deps, fetchMock } = setup([json(409, { ok: false, error: "conflict" })]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "conflict" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("앞 시도가 끊긴 뒤 409가 와도 conflict로 끝낸다", async () => {
    const { deps, fetchMock } = setup([abortError(), json(409)]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "conflict" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("429는 onBusy를 한 번 부르고 Retry-After 뒤 한 번 더 보낸다", async () => {
    const { deps, fetchMock, sleeps } = setup([json(429, {}, { "Retry-After": "7" }), json(201, OK_BODY)]);
    const result = await registerLive(BODY, deps);
    expect(result.ok).toBe(true);
    expect(deps.onBusy).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([7_000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("Retry-After가 없으면 5초, 너무 크면 30초로 자른다", async () => {
    const a = setup([json(429), json(201, OK_BODY)]);
    await registerLive(BODY, a.deps);
    expect(a.sleeps).toEqual([5_000]);
    const b = setup([json(429, {}, { "Retry-After": "600" }), json(201, OK_BODY)]);
    await registerLive(BODY, b.deps);
    expect(b.sleeps).toEqual([30_000]);
  });
  it("429가 또 오면 retryable이다", async () => {
    const { deps, fetchMock } = setup([json(429), json(429)]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "retryable" });
    expect(deps.onBusy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("앞에 시간 초과가 있었다면 429가 거듭돼도 unknown이다(앞 시도가 등록됐을 수 있다)", async () => {
    const { deps } = setup([abortError(), json(429), json(429)]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: false, kind: "unknown" });
  });
  it("deviceReady를 기다린 뒤에 보낸다", async () => {
    let release!: () => void;
    const deviceReady = new Promise<void>((r) => (release = r));
    const { deps, fetchMock } = setup([json(201, OK_BODY)]);
    const p = registerLive(BODY, { ...deps, deviceReady });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    expect((await p).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("성공 응답에 requestId가 없으면 성공으로 치지 않고 다시 보낸다", async () => {
    const { deps, fetchMock } = setup([json(201, {}), json(201, OK_BODY)]);
    const result = await registerLive(BODY, deps);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("status가 없으면 waiting으로 둔다", async () => {
    const { deps } = setup([json(201, { requestId: "r", queueNumber: 1 })]);
    expect(await registerLive(BODY, deps)).toEqual({ ok: true, requestId: "r", queueNumber: 1, status: "waiting" });
  });
  it("onBusy를 주지 않아도 429를 처리한다", async () => {
    const { deps } = setup([json(429), json(201, OK_BODY)]);
    const { onBusy, ...rest } = deps;
    void onBusy;
    expect((await registerLive(BODY, rest)).ok).toBe(true);
  });
  it("같은 clientRequestId로 다시 보낸다", async () => {
    const { deps, fetchMock } = setup([json(503), json(201, OK_BODY)]);
    await registerLive(BODY, deps);
    const ids = fetchMock.mock.calls.map(
      (c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).clientRequestId,
    );
    expect(ids).toEqual([CID, CID]);
  });
});

describe("saveLiveRecord", () => {
  const record = (o: Partial<{ cid: string; product: string; summary: string; requestId: string; status: string }> = {}) => ({
    cid: CID,
    product: "소니 헤드셋",
    summary: "요약",
    requestId: "req-1",
    status: "waiting",
    ...o,
  });
  const NOW = new Date("2026-11-23T12:00:00+09:00");
  const read = (s: ReturnType<typeof fakeStorage>) => JSON.parse(s.values.get(LIVE_RECORDS_KEY) ?? "null");

  it("/ 의 목록과 같은 모양으로 맨 앞에 넣는다", () => {
    const s = fakeStorage();
    saveLiveRecord(s, record(), NOW);
    expect(read(s)).toEqual([
      {
        cid: CID,
        product: "소니 헤드셋",
        summary: "요약",
        date: NOW.toLocaleDateString("ko-KR"),
        createdAt: NOW.toISOString(),
        status: "waiting",
        requestId: "req-1",
      },
    ]);
  });
  it("새 기록은 기존 기록 앞에 놓인다", () => {
    const s = fakeStorage({ [LIVE_RECORDS_KEY]: JSON.stringify([{ cid: "old", product: "옛것" }]) });
    saveLiveRecord(s, record(), NOW);
    expect(read(s).map((x: { cid: string }) => x.cid)).toEqual([CID, "old"]);
  });
  it("20건까지만 둔다", () => {
    const old = Array.from({ length: 25 }, (_, i) => ({ cid: `c${i}`, product: `p${i}` }));
    const s = fakeStorage({ [LIVE_RECORDS_KEY]: JSON.stringify(old) });
    saveLiveRecord(s, record(), NOW);
    const list = read(s);
    expect(list).toHaveLength(LIVE_RECORDS_MAX);
    expect(list[0].cid).toBe(CID);
    expect(list[19].cid).toBe("c18");
  });
  it("같은 cid가 있으면 새로 늘리지 않고 바꾼다", () => {
    const s = fakeStorage({
      [LIVE_RECORDS_KEY]: JSON.stringify([
        { cid: "other", product: "다른것" },
        { cid: CID, product: "옛 제품", summary: "옛 요약", status: "waiting" },
      ]),
    });
    saveLiveRecord(s, record({ status: "in_progress" }), NOW);
    const list = read(s);
    expect(list).toHaveLength(2);
    const mine = list.find((x: { cid: string }) => x.cid === CID);
    expect(mine.product).toBe("소니 헤드셋");
    expect(mine.status).toBe("in_progress");
    expect(mine.requestId).toBe("req-1");
  });
  it("status가 빈 문자열이면 waiting이다", () => {
    const s = fakeStorage();
    saveLiveRecord(s, record({ status: "" }), NOW);
    expect(read(s)[0].status).toBe("waiting");
  });
  it("저장된 값이 깨졌으면 새로 시작한다", () => {
    const s = fakeStorage({ [LIVE_RECORDS_KEY]: "{깨짐" });
    saveLiveRecord(s, record(), NOW);
    expect(read(s)).toHaveLength(1);
    const t = fakeStorage({ [LIVE_RECORDS_KEY]: JSON.stringify({ not: "array" }) });
    saveLiveRecord(t, record(), NOW);
    expect(read(t)).toHaveLength(1);
  });
  it("저장이 실패해도 던지지 않는다", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => saveLiveRecord(broken, record(), NOW)).not.toThrow();
  });
});

describe("attachPushIfOn", () => {
  function fakeWin(opts: {
    permission?: string;
    pushFlag?: string | null;
    sub?: { toJSON(): unknown } | null;
    keyBody?: unknown;
    withPush?: boolean;
    withSw?: boolean;
  } = {}) {
    const { permission = "granted", pushFlag = "on", withPush = true, withSw = true } = opts;
    const sub = opts.sub === undefined ? { toJSON: () => ({ endpoint: "https://push.example/e1" }) } : opts.sub;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/push/key") return json(200, opts.keyBody ?? { publicKey: "abc" });
      return json(200, { ok: true });
    });
    const reg = { pushManager: { getSubscription: vi.fn(async () => sub), subscribe: vi.fn() } };
    const register = vi.fn(async () => reg);
    const win: Record<string, unknown> = {
      fetch: fetchMock,
      navigator: withSw ? { serviceWorker: { register, ready: Promise.resolve(reg) } } : {},
      localStorage: { getItem: (k: string) => (k === LIVE_PUSH_KEY ? pushFlag : null) },
      Notification: { permission },
    };
    if (withPush) win.PushManager = function PushManager() {};
    return { win: win as unknown as Window, fetchMock, reg, register };
  }

  it("조건이 모두 맞고 구독이 있으면 구독을 서버에 붙인다", async () => {
    const { win, fetchMock, register } = fakeWin();
    await attachPushIfOn("req 1", win);
    expect(register).toHaveBeenCalledWith("/sw.js");
    const post = fetchMock.mock.calls.find((c) => c[0] !== "/api/push/key") as unknown as [string, RequestInit];
    expect(post[0]).toBe("/api/requests/req%201/push");
    expect(post[1].method).toBe("POST");
    expect(JSON.parse(post[1].body as string)).toEqual({ endpoint: "https://push.example/e1" });
  });
  it("구독이 없으면 새로 구독하지 않고 아무것도 보내지 않는다", async () => {
    const { win, fetchMock, reg } = fakeWin({ sub: null });
    await attachPushIfOn("req-1", win);
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every((c) => c[0] === "/api/push/key")).toBe(true);
  });
  it.each([
    ["알림 권한이 허용이 아니면", { permission: "default" }],
    ["lh-push가 on이 아니면", { pushFlag: null }],
    ["PushManager가 없으면", { withPush: false }],
    ["serviceWorker가 없으면", { withSw: false }],
  ])("%s 아무것도 하지 않는다", async (_name, opts) => {
    const { win, fetchMock, register } = fakeWin(opts);
    await attachPushIfOn("req-1", win);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
  it("공개 키를 받지 못하면 멈춘다", async () => {
    const { win, fetchMock, register } = fakeWin({ keyBody: {} });
    await attachPushIfOn("req-1", win);
    expect(register).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("실패는 던지지 않는다", async () => {
    const { win } = fakeWin();
    (win as unknown as { fetch: unknown }).fetch = vi.fn().mockRejectedValue(new Error("network"));
    await expect(attachPushIfOn("req-1", win)).resolves.toBeUndefined();
  });
});

// Codex 3차 지적 2: 확인 요약으로 읽어 준 예산과 접수 본문의 예산이 같아야 한다.
describe("읽어 준 요약과 접수 본문", () => {
  const flatText = (text: string) => text.replace(/[^0-9a-z가-힣]+/g, "");
  it.each([
    { options: "예산 10만 원 이하 무선", budget: "20만 원" },
    { options: "무선", budget: "20만 원 이하" },
    { options: "예산은 20만 원 이하, 무선", budget: "20만 원 이하" },
    { options: "120만 원대", budget: "20만 원" },
  ])("옵션 '$options', 예산 '$budget': 접수되는 예산이 요약에 들어 있다", ({ options, budget }) => {
    const draft = toDraft({ product: "헤드폰", info: "", options, budget });
    expect(draft).not.toBeNull();
    const body = toLiveRequest(draft as LiveDraft, CID);
    expect(body?.budget).toBe(budget);
    // 이 사례들은 옵션 글에 같은 예산이 그대로 있지 않으므로 예산 문장이 따로 읽혀야 한다.
    expect(flatText(draft?.summary ?? "")).toContain(flatText(`예산은 ${budget}`));
    expect(body?.details.summary).toBe(draft?.summary);
  });

  it("옵션 글에 같은 예산이 그대로 있으면 한 번만 읽고, 그 값이 접수 예산이다", () => {
    const draft = toDraft({ product: "헤드폰", info: "", options: "예산 20만 원 이하 무선", budget: "20만 원 이하" });
    const body = toLiveRequest(draft as LiveDraft, CID);
    expect(draft?.summary).toBe("제품은 헤드폰. 옵션은 예산 20만 원 이하 무선.");
    expect(body?.budget).toBe("20만 원 이하");
  });
});
