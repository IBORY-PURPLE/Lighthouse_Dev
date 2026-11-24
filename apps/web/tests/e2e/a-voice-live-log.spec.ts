import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";
import { expectState, installFakeLive, POLL, sayLive, spokenOf, surface, whenListening } from "./helpers/fakeLive";
import { LIVE_LOG_LABEL_KEY, type LiveLogRequest, type LiveLogResponse } from "../../src/lib/liveLogWire";

// /live 대화 기록(QA 분석용) 화면 시험. 가짜 음성 입력 기준(helpers/fakeLive.ts), 가짜 AI(LLM_MODE=mock).
// /api/live/config와 /api/live/log는 page.route로 가짜 응답을 준다(서버 저장은 단위 시험이 본다).
// 화면은 설정 응답의 log 값이 "all"이거나 "label"이고 참가자 표지(?p=)가 있을 때만 서버로 보낸다.

/** 브라우저가 https://api.openai.com/**을 부르면 시험이 실패한다. 모든 시험에 자동으로 걸린다. */
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

interface Setup {
  url: string;
  /** 가짜 설정 응답에 더할 값. log를 주지 않으면 설정 응답에 log 열쇠가 없다 */
  config?: { log?: "label" | "all" };
  /** 가짜 로그 응답. 기본은 받은 줄 수를 stored로 돌려준다 */
  reply?: (body: LiveLogRequest) => LiveLogResponse;
}

interface Live {
  logs: LiveLogRequest[];
}

async function openLive(page: Page, setup: Setup): Promise<Live> {
  const live: Live = { logs: [] };
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
  await installFakeLive(page);
  await page.route("**/api/live/config", (route) =>
    route.fulfill({ json: { enabled: true, realtime: false, maxSessionSec: 270, warnBeforeSec: 60, ...setup.config } }),
  );
  await page.route("**/api/live/log", (route) => {
    const body = route.request().postDataJSON() as LiveLogRequest;
    live.logs.push(body);
    const answer: LiveLogResponse = setup.reply ? setup.reply(body) : { stored: body.entries.length, reason: "saved" };
    return route.fulfill({ json: answer });
  });
  await page.route("**/api/live/hangup", (route) => route.fulfill({ status: 204 }));
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/live/config")), page.goto(setup.url)]);
  await expect(surface(page)).toBeVisible();
  return live;
}

/** 큰 단추: 페이지에서 처음 나오는 조작 요소. */
const bigButton = (page: Page) => surface(page).locator("button").first();

/** 대화를 시작해 듣기까지 가서 한 번 말하고, AI 답을 읽어 줄 때까지 기다린다. */
async function oneTurn(page: Page, said: string): Promise<void> {
  await bigButton(page).click();
  await whenListening(page);
  await expectState(page, "listening");
  const before = (await spokenOf(page)).length;
  await sayLive(page, said);
  await expect.poll(async () => (await spokenOf(page)).length, POLL).toBeGreaterThan(before);
}

const entriesOf = (live: Live) => live.logs.flatMap((r) => r.entries);

test.describe("/live 대화 기록", () => {
  test("참가자 표지가 있고 설정이 log:label이면 대화 글을 보내고 '기록 중 · T01'을 보여 준다", async ({ page }) => {
    const live = await openLive(page, { url: "/live?p=T01", config: { log: "label" } });
    await expect(page.getByTestId("live-log-mark")).toHaveCount(0);   // 저장됐다는 답을 받기 전에는 없다

    await oneTurn(page, "소니 헤드폰");
    await expect.poll(() => entriesOf(live).some((e) => e.kind === "ai" && e.tag === "reply"), POLL).toBe(true);

    expect(live.logs.length).toBeGreaterThan(0);
    for (const req of live.logs) expect(req.label).toBe("T01");
    const entries = entriesOf(live);
    const user = entries.find((e) => e.kind === "user" && e.tag === "heard");
    expect(user?.body).toBe("소니 헤드폰");
    const ai = entries.find((e) => e.kind === "ai" && e.tag === "reply");
    expect((ai?.body ?? "").length).toBeGreaterThan(0);
    // 같은 대화(cid)의 순번은 0부터 이어지고 겹치지 않는다.
    const cids = new Set(entries.map((e) => e.cid));
    expect(cids.size).toBe(1);
    const seqs = entries.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.min(...seqs)).toBe(0);

    const mark = page.getByTestId("live-log-mark");
    await expect(mark).toHaveText("기록 중 · T01", POLL);
    await expect(mark).toBeVisible();
    // 저절로 읽히면 안 되고(live region 아님), 숨기지도 않는다(aria-hidden 아님).
    expect(await mark.evaluate((el) => el.closest('[role="status"],[role="alert"],[aria-live]:not([aria-live="off"]),[aria-hidden="true"]') === null)).toBe(true);
    // 표시가 떠 있어도 접근성 자동 검사(색 대비 포함)에 걸리지 않는다.
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("표지가 없는 /live는 log:label이어도 한 글자도 보내지 않고 표시도 없다", async ({ page }) => {
    const live = await openLive(page, { url: "/live", config: { log: "label" } });
    await oneTurn(page, "소니 헤드폰");
    await page.waitForTimeout(3500);   // 보낸다면 2초 안에 나간다
    await page.reload();
    await expect(surface(page)).toBeVisible();
    expect(live.logs).toHaveLength(0);
    await expect(page.getByTestId("live-log-mark")).toHaveCount(0);
  });

  test("설정 응답에 log가 없으면 표지가 있어도 보내지 않는다", async ({ page }) => {
    const live = await openLive(page, { url: "/live?p=T01" });
    await oneTurn(page, "소니 헤드폰");
    await page.waitForTimeout(3500);
    await page.reload();
    await expect(surface(page)).toBeVisible();
    expect(live.logs).toHaveLength(0);
    await expect(page.getByTestId("live-log-mark")).toHaveCount(0);
  });

  test("설정 응답이 200인데 log가 없으면 기억해 둔 표지를 지우고, log가 있으면 그대로 둔다", async ({ page }) => {
    await openLive(page, { url: "/live?p=T01" });
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), LIVE_LOG_LABEL_KEY), POLL)
      .toBeNull();
    await openLive(page, { url: "/live?p=T02", config: { log: "label" } });
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), LIVE_LOG_LABEL_KEY), POLL)
      .toBe("T02");
  });

  test("log:all이면 표지가 없어도 보내고 '기록 중'만 보여 준다", async ({ page }) => {
    const live = await openLive(page, { url: "/live", config: { log: "all" } });
    await oneTurn(page, "소니 헤드폰");
    await expect.poll(() => entriesOf(live).some((e) => e.kind === "user"), POLL).toBe(true);
    expect(live.logs[0].label).toBe("");
    await expect(page.getByTestId("live-log-mark")).toHaveText("기록 중", POLL);
  });

  test("서버가 저장하지 못했다고 하면(stored 0) 표시는 나오지 않고 대화는 계속된다", async ({ page }) => {
    const live = await openLive(page, {
      url: "/live?p=T01",
      config: { log: "label" },
      reply: () => ({ stored: 0, reason: "unavailable" }),
    });
    await oneTurn(page, "소니 헤드폰");
    await expect.poll(() => live.logs.length, POLL).toBeGreaterThan(0);
    await expect(page.getByTestId("live-log-mark")).toHaveCount(0);
    await expectState(page, "listening");   // 화면에는 오류도 상태 변화도 없다
  });
});
