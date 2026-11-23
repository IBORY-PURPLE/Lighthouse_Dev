import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import {
  advanceUntil,
  announcedOf,
  earconsOf,
  expectState,
  heard,
  heardCount,
  installFakeLive,
  POLL,
  sayLive,
  spokenOf,
  surface,
  whenListening,
  type FakeLiveOptions,
} from "./helpers/fakeLive";
import { BUTTONS } from "../../src/lib/liveCommands";
import { script } from "../../src/lib/liveScripts";

// /live(시각장애인용 실시간 음성 도우미) 화면 시험. 설계서 16.2절, 22절 5번. 프로젝트 e2e(iPhone 15 WebKit).
// 가짜 음성 인식, 가짜 읽어 주기, 가짜 마이크, 가짜 RTCPeerConnection(helpers/fakeLive.ts)과 가짜 AI(LLM_MODE=mock) 기준이다.
// 실제 음성 인식, 기기 목소리, VoiceOver 낭독, 실제 Realtime 연결은 사람이 판정한다(가짜 음성 입력 기준).
// 파일 이름이 a-로 시작하는 까닭: 봉사자 대기열은 20건(QUEUE_LIMIT)만 보인다. 실제 접수는 사례 2의 1건뿐이고
// 나머지 사례의 POST /api/requests는 page.route로 가짜 응답을 준다.

interface RegisterBody {
  clientRequestId: string;
  product: string;
  budget: string;
  condition: string;
  details: { summary: string; qa: { q: string; a: string }[] };
}
interface ChatBody {
  sessionId: string;
  message: string;
  history: { role: string; content: string }[];
}

/** 브라우저가 https://api.openai.com/**을 부르면 시험이 실패한다(사례 18). 모든 시험에 자동으로 걸린다. */
const test = base.extend<{ openai: string[] }>({
  openai: [
    async ({ page }, use) => {
      const hits: string[] = [];
      await page.route("https://api.openai.com/**", (route) => {
        hits.push(route.request().url());
        return route.abort();
      });
      await use(hits);
      expect(hits, "브라우저가 api.openai.com을 불렀다").toEqual([]);
    },
    { auto: true },
  ],
});

test.describe.configure({ timeout: 120_000 });

const ANSWERS = ["소니 헤드폰", "노이즈 캔슬링 성능", "검정색이면 좋겠어요"] as const;
const CONFIRM_RE = /^제품은 .*보낼까요\?$/;
const DONE_RE = /^등록됐어요\. 접수 번호는 \d+번이에요/;

// ---------------------------------------------------------------- 준비

interface Setup extends FakeLiveOptions {
  /** 가짜 시계를 먼저 깐다(page.clock). 시간을 당기는 시험에서 쓴다 */
  clock?: boolean;
  /** true면 POST /api/requests를 막지 않고 실제 서버로 보낸다(사례 2의 1건) */
  realRegister?: boolean;
}

interface Live {
  chat: ChatBody[];
  register: RegisterBody[];
  hangup: Record<string, unknown>[];
  /** 다음 POST /api/requests가 받을 응답을 순서대로 정한다. 없으면 가짜 201 */
  registerPlan: ((route: Route) => Promise<void> | void)[];
  /** 다음 POST /api/live/chat이 받을 응답을 순서대로 정한다. 없으면 가짜 서버(mock)가 답한다 */
  chatPlan: ((route: Route) => Promise<void> | void)[];
  /** realtime 시험: /api/live/call이 줄 응답(바꿔 끼울 수 있다)과 받은 횟수 */
  call: { reply: object; count: number };
}

const REALTIME_CALL = {
  engine: "realtime",
  sdp: "v=0\r\n",
  callId: "call_test_1",
  maxSessionSec: 270,
  warnBeforeSec: 60,
  maxTurns: 30,
};

const fake201 = (route: Route) =>
  route.fulfill({ status: 201, json: { requestId: "req-live-test", queueNumber: 7, status: "waiting" } });
const failWith = (status: number, code: string, headers: Record<string, string> = {}) => (route: Route) =>
  route.fulfill({ status, headers, json: { error: "시험용 오류", code } });

/** 화면을 열기 전 준비를 하고 /live를 연다. 시험마다 다른 기기 주소를 달아 횟수 제한을 피한다. */
async function openLive(page: Page, setup: Setup = {}): Promise<Live> {
  const live: Live = { chat: [], register: [], hangup: [], registerPlan: [], chatPlan: [], call: { reply: REALTIME_CALL, count: 0 } };
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
  await installFakeLive(page, setup);
  if (setup.clock) await page.clock.install();

  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/live/chat")) {
      live.chat.push(request.postDataJSON() as ChatBody);
    }
  });
  await page.route("**/api/live/chat", (route) => {
    const step = live.chatPlan.shift();
    return step ? step(route) : route.continue();
  });
  await page.route("**/api/live/hangup", (route) => {
    live.hangup.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 204 });
  });
  if (!setup.realRegister) {
    await page.route("**/api/requests", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      live.register.push(route.request().postDataJSON() as RegisterBody);
      const step = live.registerPlan.shift();
      return step ? step(route) : fake201(route);
    });
  }
  if (setup.realtime) {
    await page.route("**/api/live/config", (route) =>
      route.fulfill({ json: { enabled: true, realtime: true, maxSessionSec: 270, warnBeforeSec: 60 } }),
    );
    await page.route("**/api/live/call*", (route) => {
      live.call.count += 1;
      return route.fulfill({ json: live.call.reply });
    });
    // 화면이 설정을 받은 뒤에 시작 단추를 누른다(Realtime 쪽으로 간다).
    await Promise.all([page.waitForResponse((r) => r.url().includes("/api/live/config")), page.goto("/live")]);
    await page.waitForTimeout(200);
  } else {
    await page.goto("/live");
  }
  await expect(surface(page)).toBeVisible();
  return live;
}

/** 큰 단추: 페이지에서 처음 나오는 조작 요소(8.5절). */
const bigButton = (page: Page) => surface(page).locator("button").first();

async function startConversation(page: Page): Promise<void> {
  await bigButton(page).click();
}

/** 대화를 시작해 첫 듣기까지 간다. */
async function startAndListen(page: Page): Promise<void> {
  await startConversation(page);
  await whenListening(page);
  await expectState(page, "listening");
}

/** 말 세 번을 하고 확인 문장을 듣는 데까지 간다(confirming). 확인 문장을 돌려준다. */
async function reachConfirm(page: Page): Promise<string> {
  await startAndListen(page);
  for (const answer of ANSWERS) await sayLive(page, answer);
  await heard(page, CONFIRM_RE);
  await expectState(page, "confirming");
  await whenListening(page);
  const confirms = (await spokenOf(page)).filter((t) => CONFIRM_RE.test(t));
  return confirms[confirms.length - 1];
}

/** 읽기를 붙든다(끼어들기와 안내 중 상태를 시험할 때). 풀면 붙든 글도 끝낸다. */
const holdTts = (page: Page) =>
  page.evaluate(() => {
    window.__fakeLive.tts.hold = true;
  });
const releaseTts = (page: Page) =>
  page.evaluate(() => {
    window.__fakeLive.tts.hold = false;
    window.__fakeLive.tts.finish();
  });

const requestsStored = (page: Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem("lh-requests") ?? "[]") as { requestId?: string }[]);

// ---------------------------------------------------------------- 시험

test.describe("/live 음성 도우미 화면", () => {
  test("사례 1 처음 안내와 다시 온 안내", async ({ page }) => {
    await openLive(page);
    await holdTts(page); // 안내를 읽는 동안을 붙든다
    await startConversation(page);
    await expect.poll(() => spokenOf(page), POLL).toHaveLength(1);
    const first = (await spokenOf(page))[0];
    expect(first.startsWith(script("guideFirstVoice"))).toBe(true);
    expect(first.endsWith(script("micHint"))).toBe(true);
    await expectState(page, "guiding");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__fakeLive.media.calls)).toBe(0);
    expect(await page.evaluate(() => window.__fakeLive.rec.starts)).toBe(0);
    expect(await announcedOf(page)).toEqual([]);

    await releaseTts(page);
    await whenListening(page);
    expect(await page.evaluate(() => window.__fakeLive.rec.starts)).toBeGreaterThan(0);

    // 다시 열면 다시 온 안내다(방문 횟수는 안내가 끝날 때 올랐다).
    await page.reload();
    await expect(surface(page)).toBeVisible();
    await startConversation(page);
    await expect.poll(() => spokenOf(page), POLL).not.toHaveLength(0);
    expect((await spokenOf(page))[0].startsWith(script("guideReturnVoice"))).toBe(true);
  });

  test("22절 가 열리면 큰 단추에 초점이 있다", async ({ page }) => {
    await openLive(page);
    await expect(bigButton(page)).toBeFocused();
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.start);
  });

  test("22절 나 초점이 body일 때 Space를 누르면 대화가 시작된다", async ({ page }) => {
    await openLive(page);
    await holdTts(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press("Space");
    await expectState(page, "guiding");
    await heard(page, new RegExp(`^${script("guideFirstVoice")}`));
    await releaseTts(page);
  });

  test("22절 다 idle에서 화면을 click하면 시작되고, 라 듣는 중 짧은 click은 아무 일도 없다", async ({ page }) => {
    await openLive(page);
    await holdTts(page);
    await page.getByRole("heading", { level: 1 }).click();
    await expectState(page, "guiding");
    await releaseTts(page);
    await whenListening(page);
    await expectState(page, "listening");
    const before = await page.evaluate(() => window.__fakeLive.rec.starts);
    const earcons = (await earconsOf(page)).length;
    await page.getByRole("heading", { level: 1 }).click();
    await page.waitForTimeout(600);
    await expectState(page, "listening");
    expect(await page.evaluate(() => window.__fakeLive.rec.starts)).toBe(before);
    expect((await earconsOf(page)).length).toBe(earcons);
  });
  test("사례 2 전체 흐름(실제 접수 1건)", async ({ page }) => {
    const live = await openLive(page, { realRegister: true });
    const main = await bigButton(page).elementHandle();
    const names: string[] = [];
    const recordName = async () => names.push(await bigButton(page).evaluate((el) => el.textContent ?? ""));

    // 접수 응답이 화면에 닿기 직전에 "등록됐어요"를 읽었는지 본다(201 응답 뒤에 읽혀야 한다).
    let spokenAtResponse: string[] | null = null;
    let posted: RegisterBody | null = null;
    let status = 0;
    await page.route("**/api/requests", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posted = route.request().postDataJSON() as RegisterBody;
      const response = await route.fetch();
      status = response.status();
      spokenAtResponse = await spokenOf(page);
      return route.fulfill({ response });
    });

    await startAndListen(page);
    await recordName();
    for (const answer of ANSWERS) {
      await sayLive(page, answer);
      await recordName();
    }
    await heard(page, CONFIRM_RE);
    await expectState(page, "confirming");
    await recordName();
    const spokenBefore = await spokenOf(page);
    const confirmSentence = spokenBefore.filter((t) => CONFIRM_RE.test(t)).at(-1) as string;
    expect(live.chat).toHaveLength(3);

    await sayLive(page, "네");
    await heard(page, DONE_RE);
    await expectState(page, "done");

    expect(status).toBe(201);
    expect(spokenAtResponse).not.toBeNull();
    expect((spokenAtResponse as unknown as string[]).some((t) => DONE_RE.test(t))).toBe(false); // 응답 전에는 아직 읽지 않았다
    const body = posted as unknown as RegisterBody;
    expect(body.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body.condition).toBe("정하지 않음");
    expect(body.details.qa.map((x) => x.q)).toEqual(["원하는 제품", "알고 싶은 정보", "원하는 옵션"]);
    expect(confirmSentence.startsWith(body.details.summary)).toBe(true);
    expect(body.details.summary.length).toBeGreaterThan(0);

    const stored = await requestsStored(page);
    expect(stored[0]?.requestId).toBeTruthy();
    const earcons = await earconsOf(page);
    for (const name of ["turn", "sent", "confirm", "done"]) expect(earcons).toContain(name);

    // 4번째 차례의 "네"는 서버를 부르지 않는다. 각 요청의 history에 그 요청의 message가 없다.
    expect(live.chat).toHaveLength(3);
    for (const request of live.chat) {
      expect(request.history.some((turn) => turn.role === "user" && turn.content === request.message)).toBe(false);
    }
    expect(live.chat.map((r) => r.message)).toEqual([...ANSWERS]);

    // 큰 단추의 이름은 대화 내내 '말하기'이고(마이크가 닫힌 때만 바뀐다), 같은 요소가 접수가 끝날 때까지 붙어 있다(22절 5 마).
    expect(names).toEqual([BUTTONS.talk, BUTTONS.talk, BUTTONS.talk, BUTTONS.talk, BUTTONS.talk]);
    expect(await main?.evaluate((el) => el.isConnected)).toBe(true);
    expect(await main?.evaluate((el) => el === document.querySelector("[data-live-surface] button"))).toBe(true);
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.newRequest);
  });

  test("사례 3 동의 관문", async ({ page }) => {
    const live = await openLive(page);
    await reachConfirm(page);
    expect(live.chat).toHaveLength(3);
    const confirms = async () => heardCount(page, CONFIRM_RE);
    expect(await confirms()).toBe(1);

    // 새 조건이 붙은 말, 거절하는 말은 접수가 아니라 AI 차례다. 다시 확인 문장을 읽는다.
    await sayLive(page, "예산은 5만 원으로 바꿔 주세요");
    await expect.poll(confirms, POLL).toBe(2);
    expect(live.register).toHaveLength(0);
    await whenListening(page);
    await sayLive(page, "등록하지 마");
    await expect.poll(confirms, POLL).toBe(3);
    expect(live.register).toHaveLength(0);
    expect(live.chat).toHaveLength(5);
    await whenListening(page);

    // "네?"는 되묻는 말이다. AI를 부르지 않고 확인 문장을 다시 읽는다.
    await sayLive(page, "네?");
    await expect.poll(confirms, POLL).toBe(4);
    expect(live.register).toHaveLength(0);
    expect(live.chat).toHaveLength(5);
    await whenListening(page);

    // 화면 낭독이 단추 이름을 읽는 소리, 카드 글을 그대로 읽는 소리는 버리고 계속 듣는다.
    const startsBefore = await page.evaluate(() => window.__fakeLive.rec.starts);
    await sayLive(page, "이대로 보내기 버튼");
    await expect.poll(() => page.evaluate(() => window.__fakeLive.rec.starts), POLL).toBeGreaterThan(startsBefore);
    await whenListening(page);
    expect(live.register).toHaveLength(0);
    expect(live.chat).toHaveLength(5);

    const cardLine = (await spokenOf(page)).filter((t) => CONFIRM_RE.test(t)).at(-1)!.split(" 이 내용으로")[0];
    const startsBefore2 = await page.evaluate(() => window.__fakeLive.rec.starts);
    await sayLive(page, cardLine);
    await expect.poll(() => page.evaluate(() => window.__fakeLive.rec.starts), POLL).toBeGreaterThan(startsBefore2);
    await whenListening(page);
    expect(live.register).toHaveLength(0);
    expect(live.chat).toHaveLength(5);
    expect(await confirms()).toBe(4);

    // 단추로만 보낼 수 있다(음성 동의 없이도 된다).
    await page.getByRole("button", { name: BUTTONS.consent }).click();
    await expectState(page, "done");
    expect(live.register).toHaveLength(1);
    expect(live.chat).toHaveLength(5);
  });

  test("사례 4 AI를 거친 접수", async ({ page }) => {
    const live = await openLive(page);
    await reachConfirm(page);
    await sayLive(page, "네 그렇게 보내 주시면 돼요");
    await expectState(page, "done");
    expect(live.chat).toHaveLength(4);
    expect(live.chat[3].message).toBe("네 그렇게 보내 주시면 돼요");
    expect(live.register).toHaveLength(1);
    await heard(page, DONE_RE);
  });

  test("사례 14 두 번 읽기 없음", async ({ page }) => {
    await openLive(page);
    await reachConfirm(page);
    await sayLive(page, "네");
    await expectState(page, "done");
    await heard(page, DONE_RE);
    const spoken = await spokenOf(page);
    const announced = await announcedOf(page);
    for (const text of announced) expect(spoken, `알림 "${text}"을 기기 목소리도 읽었다`).not.toContain(text);
    expect(announced).not.toContain("연결하고 있어요");
  });

  test("사례 18 바깥 호출: 전체 흐름에서 api.openai.com 요청이 0회", async ({ page, openai }) => {
    const live = await openLive(page);
    await reachConfirm(page);
    await sayLive(page, "네");
    await expectState(page, "done");
    expect(live.register).toHaveLength(1);
    expect(openai).toHaveLength(0);
  });
  test("사례 5 접수 실패 (가) 503 세 번 → 다시 보내면 같은 clientRequestId로 등록", async ({ page }) => {
    const live = await openLive(page);
    live.registerPlan.push(failWith(503, "unavailable"), failWith(503, "unavailable"), failWith(503, "unavailable"));
    await reachConfirm(page);
    await sayLive(page, "네");
    await heard(page, script("registerRetry"));
    await expectState(page, "confirming");
    expect(live.register).toHaveLength(3);
    expect(await requestsStored(page)).toHaveLength(0);

    await sayLive(page, "다시 보내");
    await expectState(page, "done");
    expect(live.register).toHaveLength(4);
    expect(new Set(live.register.map((r) => r.clientRequestId)).size).toBe(1);
    expect((await requestsStored(page))[0]?.requestId).toBe("req-live-test");
  });

  test("사례 5 접수 실패 (나) 응답이 없어 시간 초과 세 번 → registerUnknown", async ({ page }) => {
    const live = await openLive(page, { clock: true });
    const never = () => new Promise<void>(() => {});
    live.registerPlan.push(never, never, never);
    await reachConfirm(page);
    await sayLive(page, "네");
    await expectState(page, "registering");
    await advanceUntil(page, async () => (await spokenOf(page)).includes(script("registerUnknown")), { stepMs: 500, maxMs: 80_000 });
    await expectState(page, "confirming");
    expect(live.register).toHaveLength(3);
    expect(await requestsStored(page)).toHaveLength(0);
  });

  test("사례 5 접수 실패 (다) 400 → registerRejected와 [새 요청]", async ({ page }) => {
    const live = await openLive(page);
    live.registerPlan.push(failWith(400, "bad_request"));
    await reachConfirm(page);
    await sayLive(page, "네");
    await heard(page, script("registerRejected"));
    await expectState(page, "error");
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.newRequest);
    expect(live.register).toHaveLength(1);
  });

  test("사례 5 접수 실패 (라) 409 → registerConflict", async ({ page }) => {
    const live = await openLive(page);
    live.registerPlan.push(failWith(409, "conflict"));
    await reachConfirm(page);
    await sayLive(page, "네");
    await heard(page, script("registerConflict"));
    await expectState(page, "error");
    expect(live.register).toHaveLength(1);
    expect(await requestsStored(page)).toHaveLength(0);
  });

  test("사례 6 AI 오류 (가) 429는 Retry-After 뒤에 저절로 다시 보낸다", async ({ page }) => {
    const live = await openLive(page);
    live.chatPlan.push(failWith(429, "rate_limited", { "Retry-After": "1" }));
    await startAndListen(page);
    await sayLive(page, ANSWERS[0]);
    await heard(page, script("rateLimited", { s: 1 }));
    await expect.poll(() => live.chat.length, POLL).toBe(2);
    expect(live.chat[1].message).toBe(ANSWERS[0]);
    expect(live.chat[1].history).toEqual(live.chat[0].history);
    await heard(page, /^어떤 점이 궁금하세요/);
  });

  test("사례 6 AI 오류 (나) 429가 이어지면 다시 보내기는 2번에서 멈춘다", async ({ page }) => {
    const live = await openLive(page);
    for (let i = 0; i < 4; i++) live.chatPlan.push(failWith(429, "rate_limited", { "Retry-After": "1" }));
    await startAndListen(page);
    await sayLive(page, ANSWERS[0]);
    await heard(page, script("failed"));
    expect(live.chat).toHaveLength(3); // 처음 1번과 다시 보내기 2번
    await page.waitForTimeout(2500);
    expect(live.chat).toHaveLength(3);
    expect(await heardCount(page, script("rateLimited", { s: 1 }))).toBe(2);
  });

  test("사례 6 AI 오류 (다) 429 daily_cap → dailyCap과 error", async ({ page }) => {
    const live = await openLive(page);
    live.chatPlan.push(failWith(429, "daily_cap"));
    await startAndListen(page);
    await sayLive(page, ANSWERS[0]);
    await heard(page, script("dailyCap"));
    await expectState(page, "error");
    expect(live.chat).toHaveLength(1);
  });

  for (const [label, status, code, id] of [
    ["504", 504, "timeout", "timeout"],
    ["502", 502, "failed", "failed"],
    ["400", 400, "bad_request", "tooLong"],
  ] as const) {
    test(`사례 6 AI 오류 (라) ${label} → ${id}`, async ({ page }) => {
      const live = await openLive(page);
      live.chatPlan.push(failWith(status, code));
      await startAndListen(page);
      await sayLive(page, ANSWERS[0]);
      await heard(page, script(id));
      await expectState(page, "listening"); // 한두 번 실패는 오류 상태가 아니라 다시 듣는다
      expect(live.chat).toHaveLength(1);
    });
  }

  test("사례 6 AI 오류 (마) 세 번 연속 실패 → failedRepeated와 error, [다시 시도]로 이어 간다", async ({ page }) => {
    const live = await openLive(page);
    live.chatPlan.push(failWith(502, "failed"), failWith(502, "failed"), failWith(502, "failed"));
    await startAndListen(page);
    await sayLive(page, ANSWERS[0]);
    await heard(page, script("failed"));
    await sayLive(page, ANSWERS[0]);
    await sayLive(page, ANSWERS[0]);
    await heard(page, script("failedRepeated"));
    await expectState(page, "error");
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.retry);
    await bigButton(page).click();
    await heard(page, script("resumed"));
    await whenListening(page);
    await expectState(page, "listening");
    await sayLive(page, ANSWERS[0]);
    await heard(page, /^어떤 점이 궁금하세요/);
    expect(live.chat).toHaveLength(4);
  });

  test("사례 6 AI 오류 문장은 서로 다르다", () => {
    const texts = [
      script("rateLimited", { s: 1 }),
      script("dailyCap"),
      script("timeout"),
      script("failed"),
      script("tooLong"),
      script("failedRepeated"),
    ];
    expect(new Set(texts).size).toBe(texts.length);
  });
  // ---- 사례 7 끼어들기. 마우스는 pointerType mouse이고 왼쪽 단추 600ms로 발동한다(22절 4). ----

  /** 첫 말에 AI가 답하는 동안(읽기를 붙든 채)으로 간다. */
  async function reachSpeaking(page: Page): Promise<void> {
    await startAndListen(page);
    await holdTts(page);
    await sayLive(page, ANSWERS[0]);
    await expectState(page, "speaking");
    await heard(page, /^어떤 점이 궁금하세요/);
  }

  async function centerOf(locator: ReturnType<typeof surface>): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (!box) throw new Error("요소의 자리를 알 수 없다");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** 마우스 왼쪽 단추를 holdMs 동안 누른다. between은 누르는 중에 할 일이다. */
  async function press(page: Page, at: { x: number; y: number }, holdMs: number, between?: () => Promise<void>) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(holdMs);
    if (between) await between();
    await page.mouse.up();
  }

  const turnCount = async (page: Page) => (await earconsOf(page)).filter((n) => n === "turn").length;
  const cancels = (page: Page) => page.evaluate(() => window.__fakeLive.tts.cancels);

  /** 끼어든 뒤의 기대: 읽기가 취소되고, 1초 뒤 신호음 turn이 한 번 나고, 듣는 중이다. */
  async function expectInterrupted(page: Page, turnsBefore: number, cancelsBefore: number): Promise<void> {
    await expectState(page, "listening");
    expect(await cancels(page)).toBeGreaterThan(cancelsBefore);
    await expect.poll(() => turnCount(page), POLL).toBe(turnsBefore + 1);
    await whenListening(page);
    await page.waitForTimeout(1500);
    expect(await turnCount(page)).toBe(turnsBefore + 1); // click이 한 번 더 처리되지 않았다
    await expectState(page, "listening");
  }

  test("사례 7 끼어들기 (가) 화면을 700ms 누르면 읽기를 끊고 듣는다", async ({ page }) => {
    await openLive(page);
    await reachSpeaking(page);
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.talk);
    const turnsBefore = await turnCount(page);
    const cancelsBefore = await cancels(page);
    await press(page, await centerOf(page.getByRole("heading", { level: 1 })), 700);
    await expectInterrupted(page, turnsBefore, cancelsBefore);
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.talk);
  });

  test("사례 7 끼어들기 (나) 300ms 탭은 아무 일도 없다", async ({ page }) => {
    await openLive(page);
    await reachSpeaking(page);
    const turnsBefore = await turnCount(page);
    const cancelsBefore = await cancels(page);
    await press(page, await centerOf(page.getByRole("heading", { level: 1 })), 300);
    await page.waitForTimeout(1500);
    await expectState(page, "speaking");
    expect(await cancels(page)).toBe(cancelsBefore);
    expect(await turnCount(page)).toBe(turnsBefore);
  });

  test("사례 7 끼어들기 (다) 발동 뒤 40px 밀면 취소음", async ({ page }) => {
    await openLive(page);
    await reachSpeaking(page);
    const at = await centerOf(page.getByRole("heading", { level: 1 }));
    await press(page, at, 700, async () => {
      await expectState(page, "listening"); // 발동했다
      await page.mouse.move(at.x + 40, at.y, { steps: 4 });
    });
    await expect.poll(() => earconsOf(page), POLL).toContain("cancel");
  });

  test("사례 7 끼어들기 (라) '말하기' 단추 click도 같은 결과", async ({ page }) => {
    await openLive(page);
    await reachSpeaking(page);
    const turnsBefore = await turnCount(page);
    const cancelsBefore = await cancels(page);
    await page.getByRole("button", { name: BUTTONS.talk, exact: true }).click();
    await expectInterrupted(page, turnsBefore, cancelsBefore);
  });

  test("사례 7 끼어들기 (마) 큰 단추 위에서 700ms 누름도 같은 결과이고 click이 한 번 더 처리되지 않는다", async ({ page }) => {
    await openLive(page);
    await reachSpeaking(page);
    const turnsBefore = await turnCount(page);
    const cancelsBefore = await cancels(page);
    await press(page, await centerOf(bigButton(page)), 700);
    await expectInterrupted(page, turnsBefore, cancelsBefore);
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.talk);
  });

  // ---- 사례 8 뒤로가기 ----

  test("사례 8 뒤로가기 (가) goBack, Escape, [끝내기]는 모두 같은 페이지에서 ended, [이어서 하기]로 되돌린다", async ({ page }) => {
    const live = await openLive(page);
    await startAndListen(page);
    await sayLive(page, ANSWERS[0]);
    await heard(page, /^어떤 점이 궁금하세요/);
    await whenListening(page);

    await page.goBack();
    await expectState(page, "ended");
    expect(new URL(page.url()).pathname).toBe("/live");
    await heard(page, script("endedUnregistered"));
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.continueTalk);

    // [이어서 하기] → 다음 요청의 history에 앞의 말이 있다.
    await bigButton(page).click();
    await sayLive(page, ANSWERS[1]);
    await expect.poll(() => live.chat.length, POLL).toBe(2);
    expect(live.chat[1].history.some((t) => t.role === "user" && t.content === ANSWERS[0])).toBe(true);
    await whenListening(page);

    await page.keyboard.press("Escape");
    await expectState(page, "ended");
    expect(new URL(page.url()).pathname).toBe("/live");
    expect(await heardCount(page, script("endedUnregistered"))).toBe(2);

    await bigButton(page).click();
    await whenListening(page);
    await page.getByRole("button", { name: BUTTONS.exit, exact: true }).click();
    await expectState(page, "ended");
    expect(new URL(page.url()).pathname).toBe("/live");
    expect(await heardCount(page, script("endedUnregistered"))).toBe(3);
  });

  test("사례 8 뒤로가기 (나) 접수 응답을 붙든 채 끝내면 응답 뒤에 registered를 읽는다", async ({ page }) => {
    const live = await openLive(page);
    let release: () => void = () => {};
    live.registerPlan.push(
      (route) =>
        new Promise<void>((resolve) => {
          release = () => void fake201(route).then(() => resolve());
        }),
    );
    await reachConfirm(page);
    await sayLive(page, "네");
    await expectState(page, "registering");
    await page.getByRole("button", { name: BUTTONS.exit, exact: true }).click();
    await expectState(page, "ended");
    await heard(page, script("endedSending"));
    expect((await spokenOf(page)).some((t) => DONE_RE.test(t))).toBe(false);

    release();
    await heard(page, DONE_RE);
    const spoken = await spokenOf(page);
    expect(spoken.indexOf(script("endedSending"))).toBeLessThan(spoken.findIndex((t) => DONE_RE.test(t)));
    expect(await announcedOf(page)).toEqual([]);
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.newRequest);
    expect(await requestsStored(page)).toHaveLength(1);

    // 마친 뒤 [새 요청]으로 시작하고 뒤로 가도 주소는 그대로이고 ended다.
    await bigButton(page).click();
    await expectState(page, "guiding");
    await page.goBack();
    await expectState(page, "ended");
    expect(new URL(page.url()).pathname).toBe("/live");
  });
  // ---- 사례 9 침묵과 다시 듣기(가짜 시계) ----

  const SILENCE_ORDER = ["silence1", "silence2", "extendAsk", "pausedBySilence"] as const;
  const stateOf = (page: Page) => surface(page).getAttribute("data-live-state");
  const fakeNow = (page: Page) => page.evaluate(() => Date.now());

  /** 가짜 시계로 paused가 될 때까지 당긴다. 침묵 대본이 읽힌 차례를 돌려준다. */
  async function silenceUntilPaused(page: Page): Promise<void> {
    await advanceUntil(page, async () => (await stateOf(page)) === "paused", { stepMs: 250, maxMs: 120_000 });
    const spoken = await spokenOf(page);
    const at = SILENCE_ORDER.map((id) => spoken.indexOf(script(id)));
    for (const i of at) expect(i).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at); // 이 순서로 읽혔다
  }

  test("사례 9 침묵 (가) 인식이 결과 없이 바로 끝나기를 되풀이해도 침묵 안내가 순서대로 읽히고 paused", async ({ page }) => {
    await openLive(page, { clock: true });
    await page.evaluate(() => {
      window.__fakeLive.rec.silent = true;
    });
    await startConversation(page);
    await expectState(page, "listening");
    await expect.poll(() => page.evaluate(() => window.__fakeLive.rec.starts), POLL).toBeGreaterThan(0);
    const turnsBefore = await turnCount(page);

    // 처음 10초 동안 인식기를 여러 번 다시 열었지만 신호음 turn은 나지 않았다.
    await page.clock.runFor(8000);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__fakeLive.rec.starts)).toBeGreaterThan(3);
    expect(await turnCount(page)).toBe(turnsBefore);
    expect(await heardCount(page, script("silence1"))).toBe(0);

    await silenceUntilPaused(page);
    expect(await page.evaluate(() => window.__fakeLive.rec.starts)).toBeLessThanOrEqual(40);
    await expectState(page, "paused");
  });

  test("사례 9 침묵 (나) 조용히 듣기만 하면 같은 순서로 읽히고, 멈춘 뒤 100초에 pausedWarn, 120초에 ended", async ({ page }) => {
    await openLive(page, { clock: true });
    await startAndListen(page);
    await silenceUntilPaused(page);
    const pausedAt = await fakeNow(page);
    expect(await heardCount(page, script("pausedWarn"))).toBe(0);

    await advanceUntil(page, async () => (await spokenOf(page)).includes(script("pausedWarn")), { stepMs: 500, maxMs: 110_000 });
    const warnAfter = (await fakeNow(page)) - pausedAt;
    expect(warnAfter).toBeGreaterThanOrEqual(99_500);
    expect(warnAfter).toBeLessThanOrEqual(102_500);
    await expectState(page, "paused");

    await advanceUntil(page, async () => (await stateOf(page)) === "ended", { stepMs: 500, maxMs: 40_000 });
    const endAfter = (await fakeNow(page)) - pausedAt;
    expect(endAfter).toBeGreaterThanOrEqual(119_500);
    expect(endAfter).toBeLessThanOrEqual(122_500);
  });

  test("사례 9 침묵 (다) [계속하기] → listening이고 다시 조용하면 silence1부터 읽힌다", async ({ page }) => {
    await openLive(page, { clock: true });
    await startAndListen(page);
    await silenceUntilPaused(page);
    expect(await heardCount(page, script("silence1"))).toBe(1);
    await expect(bigButton(page)).toHaveAccessibleName(BUTTONS.resume);
    await bigButton(page).click();
    await expectState(page, "listening");
    await advanceUntil(page, async () => (await heardCount(page, script("silence1"))) === 2, { stepMs: 250, maxMs: 30_000 });
    expect(await heardCount(page, script("silence2"))).toBe(1); // 처음 한 번뿐이다(아직 두 번째 힌트로 가지 않았다)
  });

  // ---- 사례 10 말 명령과 빠르기 ----

  test("사례 10 말 명령과 빠르기", async ({ page }) => {
    const live = await openLive(page);
    await startAndListen(page);
    await expect(page.getByRole("button", { name: BUTTONS.rateNormal, exact: true })).toBeVisible();

    await sayLive(page, "도움말");
    await heard(page, script("helpVoice"));
    await sayLive(page, "도움말");
    await heard(page, script("helpMoreVoice"));
    expect(live.chat).toHaveLength(0);

    await sayLive(page, ANSWERS[0]);
    await heard(page, /^어떤 점이 궁금하세요/);
    expect(live.chat).toHaveLength(1);
    const reply = (await spokenOf(page)).find((t) => /^어떤 점이 궁금하세요/.test(t)) as string;
    await sayLive(page, "다시");
    await expect.poll(() => heardCount(page, reply), POLL).toBe(2);
    expect(live.chat).toHaveLength(1);

    await sayLive(page, "천천히");
    await heard(page, script("rateSlow"));
    await expect(page.getByRole("button", { name: BUTTONS.rateSlow, exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__fakeLive.tts.rates.at(-1))).toBe(0.8);
    expect(live.chat).toHaveLength(1);

    await sayLive(page, "그만");
    await heard(page, script("endAsk"));
    await sayLive(page, "네");
    await expectState(page, "ended");
    expect(live.chat).toHaveLength(1);
  });

  // ---- 사례 11 글자 모드 ----

  test("사례 11 글자 모드", async ({ page }) => {
    const live = await openLive(page, { speech: false });
    await startConversation(page);
    await heard(page, script("guideFirstText"));
    await expect(surface(page)).toHaveAttribute("data-live-input", "text");
    await expectState(page, "listening");
    expect(await page.evaluate(() => window.__fakeLive.rec.starts)).toBe(0);

    const input = page.getByLabel(BUTTONS.textInput, { exact: true });
    await expect(input).toHaveAttribute("maxlength", "1000");
    // DOM 순서에서 '답 입력' 칸 바로 다음 조작 요소가 '입력 보내기'다.
    const next = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, [tabindex]"),
      );
      const at = items.findIndex((el) => el.id === "live-text");
      return { at, name: items[at + 1]?.textContent ?? "", tag: items[at + 1]?.tagName ?? "" };
    });
    expect(next.at).toBeGreaterThanOrEqual(0);
    expect(next.tag).toBe("BUTTON");
    expect(next.name).toBe(BUTTONS.sendText);

    // Enter로 보낸다. AI 답을 읽는 동안 초점을 body로 옮겨 두면, 낭독이 끝난 뒤 앱이 초점을 입력 칸으로 돌려놓는다.
    for (const [index, answer] of ANSWERS.entries()) {
      await holdTts(page);
      const spokenBefore = (await spokenOf(page)).length;
      await input.fill(answer);
      await input.press("Enter");
      await expect.poll(() => live.chat.length, POLL).toBe(index + 1);
      await expect.poll(async () => (await spokenOf(page)).length, POLL).toBeGreaterThan(spokenBefore);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(await page.evaluate(() => document.activeElement?.id ?? "")).not.toBe("live-text");
      await releaseTts(page);
      await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? ""), POLL).toBe("live-text");
      await expectState(page, index < ANSWERS.length - 1 ? "listening" : "confirming");
    }
    await heard(page, CONFIRM_RE);
    await input.fill("네");
    await input.press("Enter");
    await expectState(page, "done");
    expect(live.register).toHaveLength(1);
    expect(live.chat).toHaveLength(3);
  });

  // ---- 사례 12 마이크 허용 창 ----

  test("사례 12 마이크 허용 창이 뜬 동안에는 침묵 타이머가 돌지 않는다", async ({ page }) => {
    await openLive(page, { clock: true });
    await page.evaluate(() => {
      window.__fakeLive.rec.startDelayMs = 5000; // 첫 듣기만 허용 창을 기다린다
    });
    await startConversation(page);
    await page.waitForFunction(() => window.__fakeLive.rec.starts === 1, undefined, POLL);
    await page.evaluate(() => {
      window.__fakeLive.rec.startDelayMs = 0;
    });
    const turnsBefore = await turnCount(page);

    await page.clock.runFor(4000); // 허용을 기다리는 동안
    expect(await page.evaluate(() => window.__fakeLive.rec.listening)).toBe(false);
    expect(await heardCount(page, script("silence1"))).toBe(0);

    // 인식이 시작되면 늦었다고 보고 차례를 다시 연다: 신호음 turn이 한 번 더 난다.
    await advanceUntil(
      page,
      () => page.evaluate(() => window.__fakeLive.rec.starts === 2 && window.__fakeLive.rec.listening),
      { stepMs: 250, maxMs: 20_000 },
    );
    expect(await turnCount(page)).toBe(turnsBefore + 1);

    // 침묵 타이머는 다시 열린 듣기가 시작된 때부터 잰다. 시계를 세워 두고 정확히 당긴다.
    await page.clock.pauseAt((await fakeNow(page)) + 200);
    await page.clock.runFor(8600);
    expect(await heardCount(page, script("silence1"))).toBe(0);
    await page.clock.runFor(2600);
    await heard(page, script("silence1"));
  });

  test("사례 12 마이크가 처음 막히면 micRetry, '말하기' 뒤 또 막히면 micDenied와 글자 모드", async ({ page }) => {
    await openLive(page);
    await startAndListen(page);
    await page.evaluate(() => window.__fakeLive.rec.fail("not-allowed"));
    await heard(page, script("micRetry"));
    await expect(surface(page)).toHaveAttribute("data-live-input", "voice");

    await page.getByRole("button", { name: BUTTONS.talk, exact: true }).click();
    await whenListening(page);
    await page.evaluate(() => window.__fakeLive.rec.fail("not-allowed"));
    await heard(page, script("micDenied"));
    await expect(surface(page)).toHaveAttribute("data-live-input", "text");
  });

  // ---- 사례 13 단추 찾기 ----

  test("사례 13 단추를 찾는 동안에는 마이크를 닫고 침묵 안내를 하지 않는다", async ({ page }) => {
    await openLive(page, { clock: true });
    await startAndListen(page);
    const help = page.getByRole("button", { name: BUTTONS.help, exact: true });
    await help.focus();
    await expect(surface(page)).toHaveAttribute("data-live-mic", "held");
    const turnsBefore = await turnCount(page);

    for (let i = 0; i < 20; i++) {
      await page.clock.runFor(3000);
      await help.evaluate((el) => {
        el.blur();
        el.focus();
      });
    }
    expect(await heardCount(page, script("silence1"))).toBe(0);
    await expect(surface(page)).toHaveAttribute("data-live-mic", "held");

    // 마지막 focus 4초 뒤에 마이크가 다시 열린다.
    await advanceUntil(page, async () => (await surface(page).getAttribute("data-live-mic")) === "on", { stepMs: 250, maxMs: 6_000 });
    await expect.poll(() => turnCount(page), POLL).toBe(turnsBefore + 1);
  });
  // ---- 사례 15, 16 가짜 Realtime. 서버 이벤트는 rtc.emit으로 넣고, 화면이 보낸 이벤트는 rtc.sent로 본다. ----

  const emit = (page: Page, event: object) => page.evaluate((e) => window.__fakeLive.rtc.emit(e), event);
  const sentOf = (page: Page) => page.evaluate(() => [...window.__fakeLive.rtc.sent]);
  const sentTypes = async (page: Page) => (await sentOf(page)).map((e) => String(e.type));
  const micEnabled = (page: Page) => page.evaluate(() => window.__fakeLive.media.tracks.at(-1)?.enabled);

  /** 이용자가 말한 것처럼 서버 이벤트를 넣는다(말 시작 → 서버가 commit → 전사 완료). */
  async function userSpeaks(page: Page, itemId: string, transcript: string): Promise<void> {
    await emit(page, { type: "input_audio_buffer.speech_started" });
    await emit(page, { type: "input_audio_buffer.committed", item_id: itemId });
    await emit(page, { type: "conversation.item.input_audio_transcription.completed", item_id: itemId, transcript });
  }

  test("사례 15 가짜 Realtime", async ({ page }) => {
    const live = await openLive(page, { realtime: true });
    await holdTts(page);
    await startConversation(page);
    await heard(page, new RegExp(`^${script("guideFirstVoice")}`));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__fakeLive.media.calls)).toBe(0); // 안내가 끝난 뒤에야 마이크를 청한다
    expect(live.call.count).toBe(0);
    await releaseTts(page);
    await expect.poll(() => page.evaluate(() => window.__fakeLive.media.calls), POLL).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__fakeLive.rtc.channels), POLL).toBe(1);
    await page.evaluate(() => window.__fakeLive.rtc.open());
    await expect(surface(page)).toHaveAttribute("data-live-engine", "realtime", POLL);
    await expect.poll(() => micEnabled(page), POLL).toBe(true);
    await expectState(page, "listening");
    expect(live.call.count).toBe(1);

    // 첫 말: committed와 전사 completed가 오면 response.create를 보낸다.
    await userSpeaks(page, "item_1", ANSWERS[0]);
    await expectState(page, "thinking");
    await expect.poll(async () => (await sentTypes(page)).filter((t) => t === "response.create").length, POLL).toBe(1);

    // AI 소리가 나는 동안 마이크 트랙은 꺼져 있다. 그때 '말하기'를 누르면 response.cancel이 clear보다 앞선다.
    await emit(page, { type: "response.created" });
    await emit(page, { type: "output_audio_buffer.started" });
    await expectState(page, "speaking");
    expect(await micEnabled(page)).toBe(false);
    await page.getByRole("button", { name: BUTTONS.talk, exact: true }).click();
    await expectState(page, "listening");
    const types = await sentTypes(page);
    const cancelAt = types.indexOf("response.cancel");
    const clearAt = types.indexOf("output_audio_buffer.clear");
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(clearAt).toBeGreaterThan(cancelAt);
    await emit(page, { type: "output_audio_buffer.cleared" });
    await emit(page, { type: "response.done", response: { status: "cancelled", output: [] } });
    await expect.poll(() => micEnabled(page), POLL).toBe(true);

    // 둘째 말 → 모델이 확인 도구를 부른다: function_call_output만 보내고 response.create는 더 보내지 않는다.
    await userSpeaks(page, "item_2", ANSWERS[2]);
    await expectState(page, "thinking");
    const createsBefore = (await sentTypes(page)).filter((t) => t === "response.create").length;
    expect(createsBefore).toBe(2);
    await emit(page, { type: "response.created" });
    await emit(page, {
      type: "response.done",
      response: {
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "confirm_request",
            call_id: "call_confirm_1",
            arguments: JSON.stringify({ product: "소니 헤드폰", info: "노이즈 캔슬링 성능", options: "검정색", budget: "" }),
          },
        ],
      },
    });
    await heard(page, CONFIRM_RE);
    await expectState(page, "confirming");
    const sent = await sentOf(page);
    const output = sent.find((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output");
    expect(output?.item).toMatchObject({ call_id: "call_confirm_1", output: JSON.stringify({ ok: true }) });
    expect((await sentTypes(page)).filter((t) => t === "response.create")).toHaveLength(createsBefore);
    await expect.poll(() => micEnabled(page), POLL).toBe(true);

    // 동의("네") → 접수(가짜 201) → done, 통화 끊기 1회(본문에 turns), registered는 기기 목소리로 읽는다.
    await userSpeaks(page, "item_3", "네");
    await expectState(page, "done");
    expect(live.register).toHaveLength(1);
    await heard(page, DONE_RE);
    await expect.poll(() => live.hangup.length, POLL).toBe(1);
    expect(live.hangup[0]).toMatchObject({ callId: "call_test_1" });
    expect(typeof live.hangup[0].turns).toBe("number");
    expect(await sentTypes(page)).not.toContain("session.update");
    expect(await announcedOf(page)).toEqual([]);
  });

  test("사례 16 Realtime을 못 쓸 때 (가) 서버가 fallback이라고 하면 마이크를 놓고 글자 대화로 이어 간다", async ({ page }) => {
    const live = await openLive(page, { realtime: true });
    live.call.reply = { engine: "fallback", reason: "daily_cap" };
    await startConversation(page);
    await expect(surface(page)).toHaveAttribute("data-live-engine", "fallback", POLL);
    expect(await page.evaluate(() => window.__fakeLive.media.stopped)).toBe(true);
    expect(live.hangup).toHaveLength(0); // 통화를 만들지 못했으니 끊을 것도 없다
    await whenListening(page);
    await sayLive(page, ANSWERS[0]);
    await heard(page, /^어떤 점이 궁금하세요/);
    expect(live.chat).toHaveLength(1);
  });

  test("사례 16 Realtime을 못 쓸 때 (나) 마이크 허용 창에 15초가 걸려도 오류 없이 realtime으로 연결된다", async ({ page }) => {
    await openLive(page, { realtime: true, clock: true });
    await page.evaluate(() => {
      window.__fakeLive.media.delayMs = 15_000;
    });
    await startConversation(page);
    await expect.poll(() => page.evaluate(() => window.__fakeLive.media.calls), POLL).toBe(1);
    await advanceUntil(page, () => page.evaluate(() => window.__fakeLive.media.delivered === 1), { stepMs: 250, maxMs: 30_000 });
    // 15초를 넘겨 받은 마이크로 이어서 연결한다(연결 시간 초과 12초는 마이크를 받은 뒤부터 잰다).
    expect(await stateOf(page)).toBe("connecting");
    await expect.poll(() => page.evaluate(() => window.__fakeLive.rtc.channels), { timeout: 5000 }).toBe(1);
    await page.evaluate(() => window.__fakeLive.rtc.open());
    await expect(surface(page)).toHaveAttribute("data-live-engine", "realtime", POLL);
    expect(await stateOf(page)).not.toBe("error");
    expect((await spokenOf(page)).filter((t) => t === script("connectFailed"))).toHaveLength(0);
  });

  test("사례 16 Realtime을 못 쓸 때 (다) 데이터 채널이 12초 안에 열리지 않으면 fallback으로 이어지고 통화를 끊는다", async ({ page }) => {
    const live = await openLive(page, { realtime: true, clock: true });
    await startConversation(page);
    await expect.poll(() => page.evaluate(() => window.__fakeLive.rtc.channels), POLL).toBe(1);
    await advanceUntil(page, async () => (await surface(page).getAttribute("data-live-engine")) === "fallback", { stepMs: 500, maxMs: 30_000 });
    await expect.poll(() => live.hangup.length, POLL).toBe(1);
    expect(live.hangup[0]).toMatchObject({ callId: "call_test_1" });

    // 늦게 열려도 이미 fallback이다.
    await page.evaluate(() => window.__fakeLive.rtc.open());
    await page.waitForTimeout(500);
    await expect(surface(page)).toHaveAttribute("data-live-engine", "fallback");
    expect(live.hangup).toHaveLength(1);
    await whenListening(page);
    await expectState(page, "listening");
  });

  // ---- 사례 17 접근성 자동 검사 ----

  async function expectNoAxe(page: Page, where: string): Promise<void> {
    const results = await new AxeBuilder({ page }).analyze();
    const found = results.violations.map((v) => `${v.id}(${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
    expect(found, `${where}에서 접근성 위반`).toEqual([]);
  }

  test("사례 17 접근성 자동 검사: idle, listening, confirming, done", async ({ page }) => {
    await openLive(page);
    await expectNoAxe(page, "idle");
    await startAndListen(page);
    await expectNoAxe(page, "listening");
    for (const answer of ANSWERS) await sayLive(page, answer);
    await heard(page, CONFIRM_RE);
    await expectState(page, "confirming");
    await expectNoAxe(page, "confirming");
    await sayLive(page, "네");
    await expectState(page, "done");
    await expectNoAxe(page, "done");
  });

  test("사례 17 접근성 자동 검사: 글자 모드 listening", async ({ page }) => {
    await openLive(page, { speech: false });
    await startConversation(page);
    await expectState(page, "listening");
    await expect(surface(page)).toHaveAttribute("data-live-input", "text");
    await expectNoAxe(page, "글자 모드 listening");
  });
  // __APPEND__
});
