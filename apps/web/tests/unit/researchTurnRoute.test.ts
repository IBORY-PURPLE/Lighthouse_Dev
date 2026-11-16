import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as enter } from "@/app/api/volunteer/enter/route";
import { POST as reset } from "@/app/api/volunteer/demo/reset/route";
import { GET as queue } from "@/app/api/volunteer/queue/route";
import { POST as claim } from "@/app/api/volunteer/requests/[requestId]/claim/route";
import { POST as result } from "@/app/api/volunteer/requests/[requestId]/result/route";
import { GET as getResearch } from "@/app/api/volunteer/requests/[requestId]/research/route";
import { POST as search, maxDuration as searchMaxDuration } from "@/app/api/volunteer/requests/[requestId]/research/search/route";
import { POST as turn, maxDuration as turnMaxDuration } from "@/app/api/volunteer/requests/[requestId]/research/turn/route";
import { getRequestStore, resetRequestStoresForTest } from "@/lib/requestStore";
import { getResearchStore, resetResearchStoresForTest } from "@/lib/researchStore";
import { CAP_DAILY, MODEL_QUESTION_BOUGHT, PURCHASE_QUESTION } from "@/lib/researchTurnText";
import { readVolunteerId, VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

// 대화형 리서치 라우트(GET research, POST turn, POST search). 가짜 AI(LLM_MODE=mock)와 메모리 저장소로 끝까지 돈다.

const { chatCreate, responsesCreate, storeProbe } = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
  storeProbe: { unavailable: false, sweeps: 0 },
}));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    chat = { completions: { create: chatCreate } };
    responses = { create: responsesCreate };
  }
  return { ...actual, default: FakeOpenAI, OpenAI: FakeOpenAI };
});
vi.mock("@/lib/researchStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/researchStore")>();
  const { StoreUnavailableError: Unavailable } = await import("@/lib/requestStore");
  return {
    ...actual,
    getResearchStore: () => {
      if (storeProbe.unavailable) throw new Unavailable("research tables missing");
      const store = actual.getResearchStore();
      return {
        ...store,
        sweep: () => {
          storeProbe.sweeps += 1;
          return store.sweep();
        },
      };
    },
  };
});

const ORIGIN = "http://localhost:3000";
const JSON_HEADERS = { "content-type": "application/json" };

let counter = 0;
const freshClient = () => `203.0.113.${(counter += 1) % 250}-${randomUUID()}`;

async function signIn() {
  const response = await enter(
    new NextRequest(`${ORIGIN}/api/volunteer/enter`, { method: "POST", headers: { "x-forwarded-for": freshClient() } }),
  );
  expect(response.status).toBe(200);
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    if (pair.startsWith(`${VOLUNTEER_COOKIE}=`)) return pair;
  }
  throw new Error("lh_vol 쿠키가 없다");
}

const volunteerOf = (cookie: string) => readVolunteerId(cookie.split("=")[1])!;

async function claimFirst(cookie: string) {
  await reset(
    new NextRequest(`${ORIGIN}/api/volunteer/demo/reset`, { method: "POST", headers: { "x-forwarded-for": freshClient(), cookie } }),
  );
  const list = await (
    await queue(new NextRequest(`${ORIGIN}/api/volunteer/queue`, { headers: { "x-forwarded-for": freshClient(), cookie } }))
  ).json();
  const id: string = list.waiting[0].requestId;
  const response = await claim(
    new NextRequest(`${ORIGIN}/api/volunteer/requests/${id}/claim`, { method: "POST", headers: { "x-forwarded-for": freshClient(), cookie } }),
    { params: Promise.resolve({ requestId: id }) },
  );
  expect(response.status).toBe(200);
  return id;
}

async function claimed() {
  const cookie = await signIn();
  return { cookie, id: await claimFirst(cookie) };
}

type Method = "GET" | "POST";
function req(path: string, method: Method, cookie: string | undefined, body?: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return new NextRequest(`${ORIGIN}/api/volunteer/requests/${path}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": freshClient(), ...headers, ...(cookie ? { cookie } : {}) },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ requestId: id }) });

const get = (id: string, cookie?: string, query = "") => getResearch(req(`${id}/research${query}`, "GET", cookie, undefined, {}), ctx(id));
const post = (id: string, cookie: string | undefined, body: unknown, headers?: Record<string, string>) =>
  turn(req(`${id}/research/turn`, "POST", cookie, body, headers), ctx(id));
const find = (id: string, cookie: string | undefined, body: unknown) =>
  search(req(`${id}/research/search`, "POST", cookie, body), ctx(id));

interface Opened {
  cookie: string;
  id: string;
  sessionId: string;
  version: number;
}
async function opened(): Promise<Opened> {
  const { cookie, id } = await claimed();
  const view = await (await get(id, cookie)).json();
  return { cookie, id, sessionId: view.sessionId, version: view.version };
}

let turnNo = 0;
const body = (o: Opened, input: unknown, extra: Record<string, unknown> = {}) => ({
  clientTurnId: `turn-${(turnNo += 1)}`,
  sessionId: o.sessionId,
  baseVersion: o.version,
  input,
  ...extra,
});

const logs: string[] = [];
const turnLogs = () => logs.filter((line) => line.startsWith("POST /api/volunteer/requests/[id]/research/turn"));

beforeEach(() => {
  vi.stubEnv("DEMO_ACCESS_CODE", "test-signing-secret");
  vi.stubEnv("STORE_MODE", "memory");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("LLM_MODE", "mock");
  vi.stubEnv("OPENAI_API_KEY", "fake-key");
  resetRequestStoresForTest();
  resetResearchStoresForTest();
  chatCreate.mockReset();
  responsesCreate.mockReset();
  storeProbe.unavailable = false;
  storeProbe.sweeps = 0;
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

describe("GET /api/volunteer/requests/{id}/research", () => {
  it("쿠키가 없으면 401", async () => {
    const { id } = await claimed();
    expect((await get(id)).status).toBe(401);
  });

  it("처음 열면 세션을 만들고 히어로 단계, 메시지 없음(E1)", async () => {
    const { cookie, id } = await claimed();
    const response = await get(id, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const view = await response.json();
    expect(view).toMatchObject({
      stage: "hero",
      purchase: "unset",
      verified: false,
      version: 0,
      lastSeq: 0,
      slots: {},
      messages: [],
      photos: [],
      review: {},
    });
    expect(view.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // 다시 열어도 같은 세션이다.
    expect((await (await get(id, cookie)).json()).sessionId).toBe(view.sessionId);
  });

  it("남의 요청은 403, 없는 요청은 404, 형식이 틀리면 400, after가 숫자가 아니면 400", async () => {
    const { id } = await claimed();
    const other = await signIn();
    expect((await get(id, other)).status).toBe(403);
    expect((await get("00000000-0000-4000-8000-000000000000", other)).status).toBe(404);
    expect((await get("nope", other)).status).toBe(400);
    const { cookie, id: mine } = await claimed();
    expect((await get(mine, cookie, "?after=abc")).status).toBe(400);
  });

  it("after가 있으면 그 뒤 메시지만 읽는다(세션을 만들지 않는다)", async () => {
    const o = await opened();
    await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }));
    const view = await (await get(o.id, o.cookie, "?after=1")).json();
    expect(view.messages.every((message: { seq: number }) => message.seq > 1)).toBe(true);
    expect(view.messages.length).toBeGreaterThan(0);
  });

  it("보낸 뒤에는 대화가 지워지므로 stage·sentAt과 빈 messages·slots·photos를 준다", async () => {
    const o = await opened();
    const sent = await result(
      req(`${o.id}/result`, "POST", o.cookie, {
        candidates: [{ name: "소니 WH-CH720N", url: "https://search.11st.co.kr/pc/total-search?kwd=sony", guide: "찾는 순서", summary: [{ label: "옵션", value: "블랙" }] }],
      }),
      ctx(o.id),
    );
    expect(sent.status).toBe(201);
    const view = await (await get(o.id, o.cookie)).json();
    expect(view).toMatchObject({ stage: "sent" });
    expect(typeof view.sentAt).toBe("string");
    expect(view).toMatchObject({ messages: [], slots: {}, photos: [], extras: [], pending: {} });
    // 보낸 뒤의 턴은 거부한다.
    const late = await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }));
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("not_in_progress");
  });

  it("research 표를 못 쓰면 503 store_unavailable", async () => {
    const { cookie, id } = await claimed();
    storeProbe.unavailable = true;
    const response = await get(id, cookie);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("store_unavailable");
  });
});

describe("POST …/research/turn", () => {
  it("라우트 설정: maxDuration 30(턴), 60(검색)", () => {
    expect(turnMaxDuration).toBe(30);
    expect(searchMaxDuration).toBe(60);
  });

  it("쿠키가 없으면 401", async () => {
    const o = await opened();
    expect((await post(o.id, undefined, body(o, { type: "quick", replyId: "purchase.bought" }))).status).toBe(401);
  });

  it("구매했어요 → 기종 질문과 followUp 검색, 버전이 오른다", async () => {
    const o = await opened();
    const response = await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ version: 1, ai: "none", followUp: { search: "model" }, session: { stage: "chat", purchase: "bought" } });
    expect(data.messages.map((message: { role: string }) => message.role)).toEqual(["volunteer", "ai"]);
    expect(data.messages.at(-1)).toMatchObject({ tag: "question", slot: "model", body: { text: MODEL_QUESTION_BOUGHT } });
    expect(turnLogs().at(-1)).toMatch(/kind=turn ai=none in=0 out=0 ws=0$/);
  });

  it("글 한 턴: 가짜 AI가 직전 질문 칸을 채우고 다음 질문을 붙인다", async () => {
    const o = await opened();
    let state = await (await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).json();
    state = await (await post(o.id, o.cookie, body({ ...o, version: state.version }, { type: "text", text: "LH-200" }))).json();
    expect(state.session.slots.model).toMatchObject({ value: "LH-200", status: "filled", by: "ai" });
    expect(state.ai).toBe("ok");
    expect(state.followUp).toBeUndefined();
    expect(state.messages.map((message: { tag: string | null }) => message.tag)).toEqual([null, "fill", "question"]);
    expect(state.messages.at(-1)).toMatchObject({ slot: "pros" });
    expect(turnLogs().at(-1)).toMatch(/kind=turn ai=ok in=0 out=0 ws=0$/);
  });

  it("구매 질문에 구매 여부를 말하면 기종까지 읽는다(가짜 AI)", async () => {
    const o = await opened();
    const state = await (await post(o.id, o.cookie, body(o, { type: "text", text: "LH-200 샀어요" }))).json();
    expect(state.session).toMatchObject({ purchase: "bought" });
    expect(state.session.slots.model.value).toBe("LH-200");
  });

  it("구매 여부가 안 정해졌으면 구매 질문을 다시 한다", async () => {
    const o = await opened();
    const state = await (await post(o.id, o.cookie, body(o, { type: "text", text: "안녕하세요" }))).json();
    expect(state.session.purchase).toBe("unset");
    expect(state.messages.at(-1)).toMatchObject({ slot: "purchase", body: { text: PURCHASE_QUESTION } });
  });

  it("본문 검사: 415, 400, 413", async () => {
    const o = await opened();
    expect((await post(o.id, o.cookie, "x", { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(o.id, o.cookie, "{not json")).status).toBe(400);
    expect((await post(o.id, o.cookie, body(o, { type: "text", text: "   " }))).status).toBe(400);
    expect((await post(o.id, o.cookie, body(o, { type: "text", text: "가".repeat(1001) }))).status).toBe(400);
    expect((await post(o.id, o.cookie, { ...body(o, { type: "quick", replyId: "purchase.bought" }), sessionId: "nope" })).status).toBe(400);
    expect((await post(o.id, o.cookie, { ...body(o, { type: "quick", replyId: "purchase.bought" }), baseVersion: "0" })).status).toBe(400);
    expect((await post(o.id, o.cookie, { pad: "x".repeat(20_000) })).status).toBe(413);
    expect((await post("nope", o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).status).toBe(400);
  });

  it("409 stale: baseVersion이 다르면 세지 않고 현재 version을 준다", async () => {
    const o = await opened();
    const response = await post(o.id, o.cookie, body({ ...o, version: 7 }, { type: "quick", replyId: "purchase.bought" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "stale", version: 0 });
  });

  it("409 session_changed: 다른 sessionId, 403 남의 요청, 404 없는 요청", async () => {
    const o = await opened();
    const wrong = await post(o.id, o.cookie, { ...body(o, { type: "quick", replyId: "purchase.bought" }), sessionId: randomUUID() });
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).error).toBe("session_changed");
    const other = await signIn();
    expect((await post(o.id, other, body(o, { type: "quick", replyId: "purchase.bought" }))).status).toBe(403);
    expect((await post("00000000-0000-4000-8000-000000000000", o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).status).toBe(404);
  });

  it("같은 clientTurnId는 저장된 응답을 그대로 주고 다시 처리하지 않는다", async () => {
    const o = await opened();
    const first = body(o, { type: "quick", replyId: "purchase.bought" });
    const one = await (await post(o.id, o.cookie, first)).json();
    const two = await (await post(o.id, o.cookie, first)).json();
    expect(two.messages).toEqual(one.messages);
    expect(two.version).toBe(one.version);
    const view = await (await get(o.id, o.cookie)).json();
    expect(view.messages).toHaveLength(2);
  });

  it("글 턴을 같은 clientTurnId로 다시 보내면 ai 표시도 첫 응답과 같다", async () => {
    const o = await opened();
    const bought = await (await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).json();
    const first = body({ ...o, version: bought.version }, { type: "text", text: "LH-200" });
    const one = await (await post(o.id, o.cookie, first)).json();
    const two = await (await post(o.id, o.cookie, first)).json();
    expect(one.ai).toBe("ok");
    expect(two.ai).toBe(one.ai);
    expect(two.messages).toEqual(one.messages);
  });

  it("202: 같은 clientTurnId가 처리 중이면 기다리게 한다", async () => {
    const o = await opened();
    const store = getResearchStore();
    const pending = body(o, { type: "text", text: "WH-CH720N 샀어요" });
    await store.begin({ requestId: o.id, volunteerId: volunteerOf(o.cookie), sessionId: o.sessionId, kind: "turn", clientTurnId: pending.clientTurnId, baseVersion: 0 });
    const response = await post(o.id, o.cookie, pending);
    expect(response.status).toBe(202);
  });

  it("apply가 bad_patch여도 처리 중 자리를 닫아 같은 clientTurnId를 다시 보내면 처리된다(202에 갇히지 않음)", async () => {
    const o = await opened();
    const actual = await vi.importActual<typeof import("@/lib/researchStore")>("@/lib/researchStore");
    const real = actual.getResearchStore();
    const spy = vi.spyOn(real, "apply").mockResolvedValueOnce({ outcome: "bad_patch" } as never);
    const first = body(o, { type: "text", text: "WH-CH720N 샀어요" });
    const failed = await post(o.id, o.cookie, first);
    expect(failed.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({ baseVersion: -1, clientTurnId: first.clientTurnId });
    const again = await post(o.id, o.cookie, first);
    expect(again.status).toBe(200);
    expect((await again.json()).session.purchase).toBe("bought");
  });

  it("AI를 부르지 않는 입력은 apply가 bad_patch여도 자리를 남기지 않아 다시 보내면 처리된다", async () => {
    const o = await opened();
    const actual = await vi.importActual<typeof import("@/lib/researchStore")>("@/lib/researchStore");
    const real = actual.getResearchStore();
    const spy = vi.spyOn(real, "apply").mockResolvedValueOnce({ outcome: "bad_patch" } as never);
    const first = body(o, { type: "quick", replyId: "purchase.bought" });
    expect((await post(o.id, o.cookie, first)).status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    const again = await post(o.id, o.cookie, first);
    expect(again.status).toBe(200);
    expect((await again.json()).session.purchase).toBe("bought");
  });

  it("apply가 던져도 처리 중 자리를 닫는다", async () => {
    const o = await opened();
    const actual = await vi.importActual<typeof import("@/lib/researchStore")>("@/lib/researchStore");
    const real = actual.getResearchStore();
    vi.spyOn(real, "apply").mockRejectedValueOnce(new Error("db down"));
    const first = body(o, { type: "text", text: "WH-CH720N 샀어요" });
    expect((await post(o.id, o.cookie, first)).status).toBeGreaterThanOrEqual(500);
    expect((await post(o.id, o.cookie, first)).status).toBe(200);
  });

  it("AI를 부르지 않는 입력(빠른 답·칩·건너뛰기·고치기·링크 확인)은 하루 AI 호출량을 쓰지 않는다", async () => {
    vi.stubEnv("RESEARCH_DAILY_AI_CAP", "1");
    const o = await opened();
    let version = 0;
    const send = async (input: unknown) => {
      const data = await (await post(o.id, o.cookie, body({ ...o, version }, input))).json();
      version = data.version;
      return data;
    };
    expect((await send({ type: "quick", replyId: "purchase.bought" })).ai).toBe("none");
    expect((await send({ type: "chip", slot: "model", value: "소니 WH-CH720N" })).ai).toBe("none");
    expect((await send({ type: "edit", slot: "pros", text: "가벼워요" })).ai).toBe("none");
    expect((await send({ type: "skip", slot: "altReason" })).ai).toBe("none");
    expect((await send({ type: "link_check", url: "https://example.com/review" })).ai).toBe("none");
    // 상한 1회는 그대로 남아 있어 첫 글 턴이 AI를 쓴다.
    expect((await send({ type: "text", text: "가벼워요" })).ai).toBe("ok");
    expect((await send({ type: "text", text: "또 가벼워요" })).ai).toBe("capped");
  });

  it("같은 AI 비호출 턴이 동시에 두 번 와도 한 번만 반영되고 둘 다 같은 응답을 받는다", async () => {
    const o = await opened();
    const same = body(o, { type: "quick", replyId: "purchase.bought" });
    const [one, two] = await Promise.all([post(o.id, o.cookie, same), post(o.id, o.cookie, same)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect((await one.json()).messages).toEqual((await two.json()).messages);
    const view = await (await get(o.id, o.cookie)).json();
    expect(view.messages.filter((message: { role: string }) => message.role === "volunteer")).toHaveLength(1);
  });

  it("AI를 부르지 않는 입력도 기준 version이 어긋나면 409 stale, 없는 세션이면 409 session_changed", async () => {
    const o = await opened();
    const stale = await post(o.id, o.cookie, body({ ...o, version: 9 }, { type: "skip", slot: "pros" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale", version: 0 });
    const other = await post(o.id, o.cookie, { ...body(o, { type: "skip", slot: "pros" }), sessionId: randomUUID() });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: "session_changed" });
  });

  it("요청당 AI 상한: 한도를 넘으면 AI 없이 CAP 문구와 기본 질문으로 이어 간다", async () => {
    vi.stubEnv("RESEARCH_DAILY_AI_CAP", "1");
    const o = await opened();
    // 빠른 답·칩 같은 AI를 부르지 않는 턴은 하루 AI 호출을 쓰지 않는다. 글 턴 하나가 1회를 쓴다.
    const quick = await (await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).json();
    const chip = await (await post(o.id, o.cookie, body({ ...o, version: quick.version }, { type: "chip", slot: "model", value: "소니 WH-CH720N" }))).json();
    expect(chip.ai).toBe("none");
    const first = await (await post(o.id, o.cookie, body({ ...o, version: chip.version }, { type: "text", text: "가벼워요" }))).json();
    expect(first.ai).toBe("ok");
    const capped = await (await post(o.id, o.cookie, body({ ...o, version: first.version }, { type: "text", text: "LH-200" }))).json();
    expect(capped.ai).toBe("capped");
    expect(capped.messages.map((message: { body: { text?: string } }) => message.body.text)).toContain(CAP_DAILY);
    expect(capped.session.slots).toEqual(first.session.slots);
    expect(turnLogs().at(-1)).toMatch(/kind=turn ai=capped cap=daily in=0 out=0 ws=0$/);
  });

  it("분당 20회는 새 턴만 센다: 같은 clientTurnId 재전송은 세지 않고, 21번째 새 턴은 429", async () => {
    const o = await opened();
    const first = body(o, { type: "quick", replyId: "review.more" });
    for (let index = 0; index < 30; index += 1) {
      expect((await post(o.id, o.cookie, first)).status, `재전송 ${index}`).toBe(200);
    }
    // 새 턴 19개를 더하면 20번째까지 받고, 그다음은 429 + Retry-After.
    for (let index = 0; index < 19; index += 1) {
      expect((await post(o.id, o.cookie, body(o, { type: "quick", replyId: "review.more" }))).status).toBe(200);
    }
    const denied = body(o, { type: "quick", replyId: "review.more" });
    const limited = await post(o.id, o.cookie, denied);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // 제한에 닿은 뒤에도: 저장된 응답은 그대로 주고, 틀린 본문은 400이다.
    expect((await post(o.id, o.cookie, first)).status).toBe(200);
    expect((await post(o.id, o.cookie, body(o, { type: "text", text: "   " }))).status).toBe(400);
    // 429로 거절된 턴은 처리 중 자리를 남기지 않는다(202로 갇히지 않고 다시 429), 사용량도 되돌린다.
    expect((await post(o.id, o.cookie, denied)).status).toBe(429);
    const view = await (await get(o.id, o.cookie)).json();
    expect(view.messages.filter((message: { role: string }) => message.role === "volunteer")).toHaveLength(20);
  });

  it("본문이 틀린 요청은 분당 제한에 세지 않는다", async () => {
    const o = await opened();
    for (let index = 0; index < 25; index += 1) {
      expect((await post(o.id, o.cookie, body(o, { type: "text", text: "   " }))).status).toBe(400);
    }
    expect((await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).status).toBe(200);
  });

  it("503: research 표를 못 쓰면 store_unavailable", async () => {
    const o = await opened();
    storeProbe.unavailable = true;
    const response = await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("store_unavailable");
  });

  describe("실제 모드(openai 모듈을 가짜로 바꾼 호출)", () => {
    beforeEach(() => {
      vi.stubEnv("LLM_MODE", "");
    });
    const chatReply = (json: unknown) => ({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(json) } }],
      usage: { prompt_tokens: 321, completion_tokens: 45 },
    });

    it("AI 출력이 검사를 통과하면 ai=ok이고 로그에 토큰 수가 남는다", async () => {
      chatCreate.mockResolvedValueOnce(
        chatReply({
          intent: "reply",
          fills: [{ slot: "model", value: "WH-CH720N", evidence: "WH-CH720N 샀어요" }],
          purchase: { value: "bought", evidence: "WH-CH720N 샀어요" },
        }),
      );
      const o = await opened();
      const state = await (await post(o.id, o.cookie, body(o, { type: "text", text: "WH-CH720N 샀어요" }))).json();
      expect(state.ai).toBe("ok");
      expect(state.session.slots.model.value).toBe("WH-CH720N");
      const params = chatCreate.mock.calls[0][0];
      expect(params).toMatchObject({ reasoning_effort: "none", temperature: 0, max_completion_tokens: 1200, response_format: { type: "json_object" } });
      expect(turnLogs().at(-1)).toMatch(/kind=turn ai=ok in=321 out=45 ws=0$/);
      // 봉사자 글은 지시가 아니라 자료로만 들어간다.
      expect(params.messages[1].content).toContain("봉사자말");
    });

    it("AI가 실패하면 fallback 문구와 원인(up)을 로그에 남기고 대화는 이어진다", async () => {
      chatCreate.mockRejectedValueOnce(Object.assign(new Error("limit"), { status: 429 }));
      const o = await opened();
      const state = await (await post(o.id, o.cookie, body(o, { type: "text", text: "WH-CH720N 샀어요" }))).json();
      expect(state.ai).toBe("fallback");
      expect(state.messages.map((message: { tag: string | null }) => message.tag)).toContain("notice");
      expect(state.messages.at(-1)).toMatchObject({ slot: "purchase" });
      expect(turnLogs().at(-1)).toMatch(/kind=turn ai=fallback up=429 in=0 out=0 ws=0$/);
    });

    it("JSON이 아니면 fallback(up=empty)", async () => {
      chatCreate.mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: "죄송합니다" } }] });
      const o = await opened();
      const state = await (await post(o.id, o.cookie, body(o, { type: "text", text: "안녕" }))).json();
      expect(state.ai).toBe("fallback");
      expect(turnLogs().at(-1)).toContain("up=empty");
    });

    it("길이 초과(length)도 fallback", async () => {
      chatCreate.mockResolvedValueOnce({ choices: [{ finish_reason: "length", message: { content: '{"intent":"re' } }] });
      const o = await opened();
      const state = await (await post(o.id, o.cookie, body(o, { type: "text", text: "안녕" }))).json();
      expect(state.ai).toBe("fallback");
    });

    it("글 입력이 아니면 AI를 부르지 않는다", async () => {
      const o = await opened();
      await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.research" }));
      expect(chatCreate).not.toHaveBeenCalled();
    });
  });
});

describe("POST …/research/search (model)", () => {
  it("기종 후보 칩 메시지를 더하고 version은 올리지 않는다", async () => {
    const o = await opened();
    await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }));
    const response = await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]).toMatchObject({ role: "ai", tag: "search", slot: "model", ai: "ok" });
    expect(data.messages[0].body.chips.map((chip: { value: string }) => chip.value)).toEqual([
      "가짜 헤드셋 LH-200",
      "가짜 헤드셋 LH-300",
      "가짜 헤드셋 LH-400",
    ]);
    expect(data.messages[0].body).toMatchObject({ chipSlot: "model", ownLabel: "직접 적을게요" });
    expect(data.lastSeq).toBe(data.messages[0].seq);
    const view = await (await get(o.id, o.cookie)).json();
    expect(view.version).toBe(1);
    expect(view.pending.shownModels).toEqual(["가짜 헤드셋 LH-200", "가짜 헤드셋 LH-300", "가짜 헤드셋 LH-400"]);
  });

  it("보인 후보를 칩으로 고르면 기종 칸이 확정된다", async () => {
    const o = await opened();
    const bought = await (await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }))).json();
    await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
    const picked = await (
      await post(o.id, o.cookie, body({ ...o, version: bought.version }, { type: "chip", slot: "model", value: "가짜 헤드셋 LH-300" }))
    ).json();
    expect(picked.session.slots.model).toMatchObject({ value: "가짜 헤드셋 LH-300", status: "confirmed", by: "volunteer" });
    expect(picked.messages.at(-1)).toMatchObject({ tag: "question", slot: "pros" });
  });

  it("같은 검색을 다시 부르면 캐시라 새 메시지 없이 마지막 번호만 준다", async () => {
    const o = await opened();
    const first = await (await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).json();
    const again = await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ messages: [], lastSeq: first.lastSeq });
  });

  it("분당 8회는 AI 검색을 부른 요청만 센다: 캐시 적중·처리 중(202)은 세지 않는다", async () => {
    const o = await opened();
    await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
    for (let index = 0; index < 12; index += 1) {
      expect((await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).status, `캐시 ${index}`).toBe(200);
    }
    const second = await opened();
    await getResearchStore().begin({ requestId: second.id, volunteerId: volunteerOf(second.cookie), sessionId: second.sessionId, kind: "search", cacheKey: "model", units: 1 });
    for (let index = 0; index < 12; index += 1) {
      expect((await find(second.id, second.cookie, { sessionId: second.sessionId, kind: "model" })).status, `처리 중 ${index}`).toBe(202);
    }
  });

  it("분당 8회에 닿아도 이미 끝난 검색은 200, 진행 중인 검색은 202로 답하고, 새 검색만 429이며 사용량은 올리지 않는다", async () => {
    const o = await opened();
    const volunteerId = volunteerOf(o.cookie);
    const actor = { requestId: o.id, volunteerId, sessionId: o.sessionId, cacheKey: "model" };
    const store = getResearchStore();
    for (let index = 0; index < 8; index += 1) {
      expect((await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).status, `새 검색 ${index}`).toBe(200);
      await store.addMessage({ ...actor, messages: [], cacheState: "clear" });
    }
    // 새 검색은 한도에 닿아 429(Retry-After)이고, 거절을 몇 번 되풀이해도 요청당 검색 상한(12)을 쓰지 않는다.
    for (let index = 0; index < 10; index += 1) {
      const limited = await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
      expect(limited.status, `거절 ${index}`).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    // 끝난 검색을 다시 부르면 200(새 메시지 없음), 처리 중이면 202.
    await store.addMessage({ ...actor, messages: [], cacheState: "done" });
    const cached = await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
    expect(cached.status).toBe(200);
    expect((await cached.json()).messages).toEqual([]);
    await store.addMessage({ ...actor, messages: [], cacheState: "clear" });
    // 거절 10번이 사용량을 썼다면 여기서 요청당 상한(12) = 8 + 이 begin 1 + 거절분이 넘어 capped가 된다.
    const begun = await store.begin({ ...actor, kind: "search", units: 1 });
    expect(begun.outcome).toBe("ok");
    expect((await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).status).toBe(202);
  });

  it("인용 주소가 아주 길어도 메시지 본문은 8,192바이트 안에 든다(긴 주소는 뺀다)", async () => {
    vi.stubEnv("LLM_MODE", "");
    const longUrl = `https://www.sony.co.kr/headphones/${"a".repeat(9000)}`;
    responsesCreate.mockResolvedValueOnce({
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ url: longUrl }] } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ items: [{ name: "Sony WH-CH720N", note: "가벼운 무선 헤드셋", url: longUrl }] }),
              annotations: [{ type: "url_citation", url: longUrl, title: "Sony WH-CH720N 무선 노이즈캔슬링 헤드폰" }],
            },
          ],
        },
      ],
    });
    const o = await opened();
    const response = await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Buffer.byteLength(JSON.stringify(data.messages[0].body), "utf8")).toBeLessThanOrEqual(8000);
    expect(data.messages[0].body.chips).toEqual([{ label: "Sony WH-CH720N", value: "Sony WH-CH720N", url: null }]);
  });

  it("후보 이름이 인용 제목·출처 주소·요청 글에 없으면 칩에서 버린다", async () => {
    vi.stubEnv("LLM_MODE", "");
    const cited = "https://www.sony.co.kr/headphones/wh-ch720n";
    const invented = "https://shop.example/invented";
    responsesCreate.mockResolvedValueOnce({
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ url: cited }, { url: invented }] } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                items: [
                  { name: "소니 WH-CH720N", note: "가벼운 무선 헤드셋", url: cited },
                  { name: "소니 WH-1000XM9", note: "상위 모델", url: invented },
                ],
              }),
              annotations: [
                { type: "url_citation", url: cited, title: "Sony WH-CH720N 무선 헤드폰" },
                { type: "url_citation", url: invented, title: "헤드폰 구매 가이드" },
              ],
            },
          ],
        },
      ],
    });
    const o = await opened();
    const data = await (await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).json();
    expect(data.messages[0]).toMatchObject({ ai: "ok" });
    expect(data.messages[0].body.chips.map((chip: { value: string }) => chip.value)).toEqual(["소니 WH-CH720N"]);
  });

  it("재현: 요청 '소니', 검색 자료는 보스 QC45 페이지 → AI가 '소니 QC45'를 보스 주소에 붙여도 칩에서 버린다", async () => {
    vi.stubEnv("LLM_MODE", "");
    const bose = "https://shop.example/bose-qc45";
    responsesCreate.mockResolvedValueOnce({
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ url: bose }] } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ items: [{ name: "소니 QC45", note: "가벼워요", url: bose }] }),
              annotations: [{ type: "url_citation", url: bose, title: "보스 QC45 노이즈캔슬링 헤드폰" }],
            },
          ],
        },
      ],
    });
    const o = await opened();
    const data = await (await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).json();
    expect(data.messages[0].body.chips?.map((chip: { value: string }) => chip.value) ?? []).not.toContain("소니 QC45");
  });

  it("검색이 처리 중이면 202", async () => {
    const o = await opened();
    await getResearchStore().begin({ requestId: o.id, volunteerId: volunteerOf(o.cookie), sessionId: o.sessionId, kind: "search", cacheKey: "model", units: 1 });
    expect((await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).status).toBe(202);
  });

  it("model 말고 다른 종류와 잘못된 본문은 400, 쿠키 없으면 401", async () => {
    const o = await opened();
    expect((await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "alts" })).status).toBe(400);
    expect((await find(o.id, o.cookie, { sessionId: "nope", kind: "model" })).status).toBe(400);
    expect((await find(o.id, undefined, { sessionId: o.sessionId, kind: "model" })).status).toBe(401);
    expect((await find(o.id, o.cookie, { sessionId: randomUUID(), kind: "model" })).status).toBe(409);
  });

  it("웹 검색이 실패하면 고정 후보(시연 품목)와 쇼핑몰 바로가기로 이어 간다", async () => {
    vi.stubEnv("LLM_MODE", "");
    responsesCreate.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 500 }));
    const o = await opened();
    const data = await (await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).json();
    expect(data.messages[0].ai).toBe("fallback");
    expect(data.messages[0].body.chips.map((chip: { value: string }) => chip.value)).toContain("소니 WH-CH720N");
    expect(data.messages[0].body.shortcuts.length).toBeGreaterThan(0);
    const line = logs.find((entry) => entry.startsWith("POST /api/volunteer/requests/[id]/research/search"))!;
    expect(line).toMatch(/kind=model ai=fallback up=500 in=0 out=0 ws=0$/);
  });

  it("실제 검색이 돌면 로그에 검색 횟수와 토큰이 남는다", async () => {
    vi.stubEnv("LLM_MODE", "");
    responsesCreate.mockResolvedValueOnce({
      usage: { input_tokens: 900, output_tokens: 120 },
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ url: "https://www.sony.co.kr/headphones/wh-ch720n" }] } },
        { type: "web_search_call", action: { type: "search", sources: [] } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ items: [{ name: "Sony WH-CH720N", note: "가벼운 무선 헤드셋", url: "https://www.sony.co.kr/headphones/wh-ch720n" }] }),
              annotations: [{ type: "url_citation", url: "https://www.sony.co.kr/headphones/wh-ch720n" }],
            },
          ],
        },
      ],
    });
    const o = await opened();
    const data = await (await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).json();
    expect(data.messages[0]).toMatchObject({ ai: "ok" });
    expect(data.messages[0].body.chips).toEqual([
      { label: "Sony WH-CH720N", value: "Sony WH-CH720N", url: "https://www.sony.co.kr/headphones/wh-ch720n" },
    ]);
    const line = logs.find((entry) => entry.startsWith("POST /api/volunteer/requests/[id]/research/search"))!;
    expect(line).toMatch(/kind=model ai=ok in=900 out=120 ws=2$/);
  });

  it("요청당 검색 한도를 넘으면 AI 없이 고정 후보와 CAP 문구를 보인다", async () => {
    const o = await opened();
    const store = getResearchStore();
    const actor = { requestId: o.id, volunteerId: volunteerOf(o.cookie), sessionId: o.sessionId };
    for (let index = 0; index < 12; index += 1) {
      await store.begin({ ...actor, kind: "search", cacheKey: `k${index}`, units: 1 });
    }
    const data = await (await find(o.id, o.cookie, { sessionId: o.sessionId, kind: "model" })).json();
    expect(data.messages[0]).toMatchObject({ ai: "capped" });
    expect(data.messages[0].body.text).toContain("이 요청");
    expect(logs.find((entry) => entry.includes("research/search"))).toMatch(/ai=capped cap=request/);
  });
});

describe("queue 라우트의 6시간 정리", () => {
  it("인스턴스당 1분에 한 번만 sweep을 부르고, 실패해도 목록은 준다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
    const cookie = await signIn();
    const list = () => queue(new NextRequest(`${ORIGIN}/api/volunteer/queue`, { headers: { "x-forwarded-for": freshClient(), cookie } }));
    vi.setSystemTime(new Date("2026-11-17T03:00:00Z"));
    const before = storeProbe.sweeps;
    expect((await list()).status).toBe(200);
    expect(storeProbe.sweeps).toBe(before + 1);
    vi.setSystemTime(new Date("2026-11-17T03:00:30Z"));
    expect((await list()).status).toBe(200);
    expect(storeProbe.sweeps).toBe(before + 1);
    vi.setSystemTime(new Date("2026-11-17T03:01:10Z"));
    storeProbe.unavailable = true;
    expect((await list()).status).toBe(200);
  });

  it("메모리 저장소: 6시간 넘게 활동이 없으면 대기열로 돌아가고 대화가 지워진다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    resetRequestStoresForTest();
    resetResearchStoresForTest();
    const o = await opened();
    await post(o.id, o.cookie, body(o, { type: "quick", replyId: "purchase.bought" }));
    vi.setSystemTime(new Date("2026-11-17T17:00:00Z"));
    const other = await signIn();
    const list = await (await queue(new NextRequest(`${ORIGIN}/api/volunteer/queue`, { headers: { "x-forwarded-for": freshClient(), cookie: other } }))).json();
    expect(list.waiting.map((entry: { requestId: string }) => entry.requestId)).toContain(o.id);
    const detail = await getRequestStore().getForVolunteer(o.id, volunteerOf(o.cookie));
    expect(detail.kind).toBe("not_yours");
  });
});

