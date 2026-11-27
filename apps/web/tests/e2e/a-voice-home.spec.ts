import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });

const BUDGET = "10만 원 이하";

test.describe("/ 이용자 홈과 요청 목록", () => {
  test("홈에서 상품 요청 안내를 읽고 운영 음성 대화 화면으로 이동한다", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("LightHouse · 홈");
    const request = page.getByRole("link", { name: "상품 요청", exact: true });
    await expect(request).toHaveAccessibleDescription(/AI와 음성으로 대화/);
    await expect(page.getByRole("button", { name: "내 구매 요청 목록" })).toHaveAccessibleDescription(/봉사자 리뷰/);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: "test-results/voice-home.png" });

    await request.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/request$/);
    await expect(page.getByRole("heading", { name: "진행 안내" })).toBeVisible();
    const guideResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(guideResults.violations).toEqual([]);
    await page.screenshot({ path: "test-results/voice-request-guide.png" });

    await page.getByRole("link", { name: "질문 시작하기" }).click();
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.getByRole("button", { name: "대화 시작", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("link", { name: "질문 시작하기" })).toBeVisible();
    await page.getByRole("link", { name: "뒤로 돌아가기" }).click();
    await expect(request).toBeVisible();

    await page.getByRole("button", { name: "내 구매 요청 목록" }).click();
    await expect(page.getByRole("heading", { name: "내 구매 요청 목록", exact: true })).toBeFocused();
    await expect(page.getByRole("link", { name: "새 구매 요청" })).toHaveAttribute("href", "/request");

    await page.goto("/classic");
    await expect(page.getByRole("heading", { level: 1, name: "LightHouse 상품 요청" })).toBeVisible();
    await expect(page.getByRole("button", { name: "시작하기" })).toBeVisible();
  });

  test("기기 두 대에서 보낸 요청은 기기마다 자기 것만 내 구매 요청 목록에 보인다", async ({ browser }) => {
    const mark = randomUUID().slice(0, 8);
    const productA = `기기A 키보드 ${mark}`;
    const productB = `기기B 마우스 ${mark}`;
    const open = async () => {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `test-${randomUUID()}` } });
      return { context, page: await context.newPage() };
    };
    const send = (page: Page, product: string) =>
      page.request.post("/api/requests", {
        data: { clientRequestId: randomUUID(), product, budget: BUDGET, condition: "새 제품" },
      });

    const a = await open();
    const b = await open();
    try {
      expect((await send(a.page, productA)).status()).toBe(201);
      expect((await send(b.page, productB)).status()).toBe(201);
      // 쿠키는 기기마다 따로 심긴다.
      const cookieOf = async (context: typeof a.context) =>
        (await context.cookies()).find((cookie) => cookie.name === "lh_device");
      const cookieA = await cookieOf(a.context);
      const cookieB = await cookieOf(b.context);
      // SameSite=lax는 단위 시험이 헤더로 확인한다(page.request의 쿠키 해석기는 소문자 lax를 None으로 읽는다).
      expect(cookieA).toMatchObject({ httpOnly: true, path: "/" });
      expect(cookieA?.value).not.toBe(cookieB?.value);

      for (const [device, mine, other] of [
        [a, productA, productB],
        [b, productB, productA],
      ] as const) {
        await device.page.goto("/");
        await device.page.getByRole("button", { name: "내 구매 요청 목록" }).click();
        await expect(device.page.locator("#list")).toHaveClass(/active/);
        await expect(device.page.locator("#requests .request-card", { hasText: mine })).toHaveCount(1);
        await expect(device.page.locator("#requests .request-card", { hasText: other })).toHaveCount(0);
      }
      // 서버가 이 기기 목록을 기준으로 주므로 다른 기기 요청 번호의 단건 조회도 막힌다.
      const listA = (await (await a.page.request.get("/api/requests")).json()).items as { requestId: string }[];
      expect(listA).toHaveLength(1);
      expect((await b.page.request.get(`/api/requests/${listA[0].requestId}`)).status()).toBe(404);
      expect((await a.page.request.get(`/api/requests/${listA[0].requestId}`)).status()).toBe(200);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("서버가 전체 목록(complete)이라고 알리면 서버에 없는 번호는 한 건씩 물어 400·404인 기록만 지운다. 기기 쿠키 전 요청과 번호 없는 기록은 남긴다. 전체가 아니면 그대로 둔다", async ({ browser }) => {
    // 이 화면은 /sw.js를 등록하면 page.route가 요청을 가로채지 못한다. 서비스 워커를 막은 새 기기로 시험한다.
    const context = await browser.newContext({
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": `test-${randomUUID()}` },
    });
    const page = await context.newPage();
    let complete = true;
    let gets = 0;
    await page.route("**/api/requests", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      gets += 1;
      return route.fulfill({ json: { items: [], complete } });
    });
    // 기기 쿠키 전에 접수한 요청(주인 기기 없음)은 기기 목록에 없지만 단건 조회는 된다. 서버에서 지워진 요청은 404다.
    const LEGACY = "11111111-1111-4111-8111-111111111111";
    const DELETED = "22222222-2222-4222-8222-222222222222";
    await page.route(url => /^\/api\/requests\/[^/]+$/.test(url.pathname), (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith(LEGACY)) {
        return route.fulfill({
          json: { requestId: LEGACY, queueNumber: 1, status: "done", product: "기기 쿠키 전 요청", review: "봉사자가 확인한 리뷰 문단" },
        });
      }
      if (pathname.endsWith(DELETED)) return route.fulfill({ status: 404, json: { error: "not_found", persistent: true } });
      return route.fallback();
    });
    await page.addInitScript(
      ({ legacy, deleted }) => {
        if (localStorage.getItem("lh-requests")) return;
        localStorage.setItem(
          "lh-requests",
          JSON.stringify([
            { cid: "c-1", requestId: "gone-1", product: "서버에 없는 요청", summary: "x", date: "2026. 11. 18.", status: "waiting" },
            { cid: "c-2", product: "접수 중인 요청", summary: "x", date: "2026. 11. 18.", status: "waiting" },
            { cid: "c-3", requestId: legacy, product: "기기 쿠키 전 요청", summary: "x", date: "2026. 11. 18.", status: "waiting" },
            { cid: "c-4", requestId: deleted, product: "서버에서 지워진 요청", summary: "x", date: "2026. 11. 18.", status: "waiting" },
          ]),
        );
      },
      { legacy: LEGACY, deleted: DELETED },
    );
    await page.goto("/");
    // 전체 목록이 아니면(저장소 폴백 등) 서버가 빈 목록을 줘도 기록을 지키는 쪽이다.
    complete = false;
    await page.getByRole("button", { name: "내 구매 요청 목록" }).click();
    await expect(page.locator("#requests .request-card", { hasText: "서버에 없는 요청" })).toHaveCount(1);
    await expect.poll(() => gets).toBeGreaterThanOrEqual(1);
    await expect(page.locator("#requests .request-card", { hasText: "서버에 없는 요청" })).toHaveCount(1);
    complete = true;
    await page.evaluate(() => (window as unknown as { refreshRequests: () => Promise<void> }).refreshRequests());
    await expect(page.locator("#requests .request-card", { hasText: "서버에 없는 요청" })).toHaveCount(0);
    await expect(page.locator("#requests .request-card", { hasText: "서버에서 지워진 요청" })).toHaveCount(0);
    await expect(page.locator("#requests .request-card", { hasText: "접수 중인 요청" })).toHaveCount(1);
    // 기기 쿠키 전 요청은 남고, 단건 조회로 받은 상태(done)와 리뷰로 바뀐다.
    await expect(page.locator("#requests .request-card", { hasText: "기기 쿠키 전 요청" })).toHaveCount(1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("lh-requests") || "[]"));
    expect(stored.find((x: { requestId?: string }) => x.requestId === LEGACY)).toMatchObject({
      status: "done",
      review: "봉사자가 확인한 리뷰 문단",
    });
    await page.goto(`/?request=${LEGACY}`);
    await expect(page.getByText("봉사자가 확인한 리뷰 문단")).toBeFocused();
    await context.close();
  });

  test("B 목록에서 내 요청사항과 봉사자 응답을 각각 열 수 있다", async ({ page }) => {
    const pending = {
      requestId: "33333333-3333-4333-8333-333333333333",
      product: "조용한 키보드",
      status: "in_progress",
      queueNumber: 3,
    };
    const completed = {
      requestId: "44444444-4444-4444-8444-444444444444",
      product: "여행용 헤드폰",
      status: "done",
      queueNumber: 4,
      review: "이동할 때 쓰기 편했어요.",
      sentAt: "2026-11-25T16:30:00Z",
    };
    await page.addInitScript(() => {
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: { cancel() {}, speak() { document.body.dataset.spoken = "true"; } },
      });
    });
    await page.route("**/api/requests", route => route.fulfill({ json: { items: [pending, completed], complete: true } }));
    await page.route("**/api/requests/*?view=details", route => route.fulfill({
      json: route.request().url().includes(pending.requestId)
        ? {
            ...pending,
            buyer: { budget: "10만 원 이하", condition: "새 제품" },
            details: { summary: "업무용으로 쓸 조용한 키보드", qa: [{ q: "사용 목적", a: "사무실 업무" }] },
          }
        : {
            ...completed,
            buyer: {
              reviewInfo: {
                model: "Example H2",
                purchase: "구매 인증됨",
                experience: "배터리가 오래 갔어요.",
                research: [{ label: "같이 고민한 제품", value: "Example H3" }],
                sources: [{ label: "참고 링크 1", url: "https://example.com/headphones" }],
              },
            },
          },
    }));

    const audit = async () => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(results.violations).toEqual([]);
    };
    await page.goto("/");
    await page.getByRole("button", { name: "내 구매 요청 목록" }).click();
    const first = page.getByRole("article", { name: pending.product });
    const second = page.getByRole("article", { name: completed.product });
    await expect(first.getByText("상품 탐색 중")).toBeVisible();
    await expect(first.getByRole("button", { name: "봉사자 응답 확인하기" })).toHaveCount(0);
    await expect(second.getByRole("button", { name: "봉사자 응답 확인하기" })).toBeVisible();
    await expect(page.locator("#requests .request-card")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "리뷰가 오면 알림 받기" })).toBeVisible();
    await audit();
    await page.screenshot({ path: "test-results/b-request-list.png", fullPage: true });

    await first.getByRole("button", { name: "내 요청사항 확인하기" }).click();
    await expect(page.getByRole("heading", { name: "내 요청 사항 확인" })).toBeFocused();
    await expect(page.getByText("10만 원 이하", { exact: true })).toBeVisible();
    await expect(page.getByText("사무실 업무", { exact: true })).toBeVisible();
    await audit();
    await page.screenshot({ path: "test-results/b-request-details.png", fullPage: true });
    await page.getByRole("button", { name: "뒤로 돌아가기" }).click();
    await expect(first.getByRole("button", { name: "내 요청사항 확인하기" })).toBeFocused();

    await second.getByRole("button", { name: "봉사자 응답 확인하기" }).click();
    await expect(page.locator("#review-text")).toBeFocused();
    await expect(page.getByText("2026년 11월 26일", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "봉사자의 직접 사용 경험" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "조사 정보" })).toBeVisible();
    await expect(page.getByRole("link", { name: /참고 링크 1 열기/ })).toHaveAttribute("href", "https://example.com/headphones");
    await expect(page.locator("body")).not.toHaveAttribute("data-spoken", "true");
    await audit();
    await page.screenshot({ path: "test-results/b-request-review.png", fullPage: true });
  });

  test("요청 없는 기기에는 빈 화면을 보여 주고 시연 요청을 섞지 않는다", async ({ page }) => {
    await page.route("**/api/requests", route => route.fulfill({ json: { items: [], complete: true } }));
    await page.goto("/");
    await page.getByRole("button", { name: "내 구매 요청 목록" }).click();
    await expect(page.getByText("아직 등록한 상품 요청이 없습니다.")).toBeVisible();
    await expect(page.locator("#requests .request-card")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "새 구매 요청" })).toHaveAttribute("href", "/request");
  });

  test("다른 탭에서 접수한 새 기록은 이전 목록 20건에 밀리지 않는다", async ({ context, page }) => {
    const request = {
      requestId: "55555555-5555-4555-8555-555555555555",
      product: "접이식 키보드",
      status: "waiting",
      queueNumber: 1,
      createdAt: "2026-11-27T15:00:01Z",
    };
    const older = Array.from({ length: 20 }, (_, index) => ({
      requestId: randomUUID(),
      product: "이전 요청 " + (20 - index),
      status: "waiting",
      queueNumber: 20 - index,
      createdAt: "2026-11-27T14:59:59Z",
    }));
    let complete = false;
    let finishList!: () => void;
    const listReady = new Promise<void>(resolve => { finishList = resolve; });
    await page.route("**/api/requests", async route => {
      await listReady;
      await route.fulfill({ json: { items: older, complete } });
    });
    await page.route("**/api/requests/" + request.requestId + "?view=order", route => route.fulfill({ json: request }));
    await page.route("**/api/requests/*?view=details", route => route.fulfill({ status: 404 }));
    const otherTab = await context.newPage();
    await otherTab.goto("/");
    await page.goto("/");
    const listStarted = page.waitForRequest(req => new URL(req.url()).pathname === "/api/requests");
    await page.getByRole("button", { name: "내 구매 요청 목록" }).click();
    await listStarted;
    await otherTab.evaluate(item => localStorage.setItem("lh-requests", JSON.stringify([item])), {
      cid: randomUUID(),
      requestId: request.requestId,
      product: request.product,
      status: request.status,
      summary: "출장에 들고 다닐 작은 키보드",
    });
    finishList();
    await expect(page.locator("#requests .request-card").first()).toHaveAccessibleName(request.product);
    await expect(page.locator("#requests .request-card")).toHaveCount(20);
    await page.evaluate(() => (window as unknown as { refreshRequests: () => Promise<void> }).refreshRequests());
    await expect(page.locator("#requests .request-card").first()).toHaveAccessibleName(request.product);
    complete = true;
    await page.evaluate(() => (window as unknown as { refreshRequests: () => Promise<void> }).refreshRequests());
    await expect(page.locator("#requests .request-card").first()).toHaveAccessibleName(request.product);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lh-requests") ?? "[]")[0]?.createdAt))
      .toBe(request.createdAt);
    await page.getByRole("article", { name: request.product }).getByRole("button", { name: "내 요청사항 확인하기" }).click();
    await expect(page.getByText("출장에 들고 다닐 작은 키보드", { exact: true })).toBeVisible();
  });
});
