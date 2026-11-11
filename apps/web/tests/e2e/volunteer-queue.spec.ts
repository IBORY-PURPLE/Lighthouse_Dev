import { expect, test } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";
import {
  CLAIM_NAME,
  DEMO_QUOTES,
  enterAs,
  expectNoBlockingAxe,
  expectNoRemaining,
  FIRST_DEMO_QUOTE,
  LOCKED_TEXT,
  openDevice,
  refill,
} from "./helpers/volunteerFlow";

// 봉사자 화면 v1 블록 1: 입장·목록·맡기(와이어프레임 화면 1·2·2-2·3 일부). 가짜 서버 저장소(메모리) 기준이다.
// 다른 시험 파일이 같은 서버에 실제 접수 요청을 남길 수 있으므로, 시연 카드는 글자로 찾는다.

const card = (page: import("@playwright/test").Page, quote: string) =>
  page.locator(".vol-card").filter({ hasText: quote });

test.describe("봉사자 입장·목록·맡기", () => {
  test("1. 쿠키 없이 열면 입장 화면만 나오고, 틀린 코드에는 정해진 문구 하나만 나온다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await page.goto("/volunteer");
    await expect(
      page.getByRole("heading", { level: 1, name: "봉사자 입장" }),
    ).toBeVisible();
    await expect(page.getByLabel("입장 코드")).toBeVisible();
    await expect(page.getByLabel("별명")).toBeVisible();
    await expect(page.getByRole("heading", { name: "대기열" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: CLAIM_NAME })).toHaveCount(0);

    // 입장 전에는 봉사자용 서버 기능이 401이다.
    const queue = await page.request.get("/api/volunteer/queue");
    expect(queue.status()).toBe(401);

    await page.getByLabel("입장 코드").fill("틀린-코드");
    await page.getByLabel("별명").fill("민지");
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "입장 코드가 올바르지 않습니다",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "봉사자 입장" }),
    ).toBeVisible();

    await expectNoBlockingAxe(page);
    await page.screenshot({ path: "test-results/volunteer-entry.png" });
    await page.context().close();
  });

  test("2. 입장하면 목록이 나오고 새로 고쳐도 목록이다. 쿠키는 HttpOnly다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);

    const cookies = await page.context().cookies();
    const vol = cookies.find((cookie) => cookie.name === "lh_vol");
    expect(vol?.httpOnly).toBe(true);
    expect(
      cookies.find((cookie) => cookie.name === "lh_access")?.httpOnly,
    ).toBe(true);
    // 별명은 서버 쿠키가 아니라 기기 localStorage에만 있다.
    expect(cookies.some((cookie) => cookie.value.includes("민지"))).toBe(false);
    expect(
      await page.evaluate(() => window.localStorage.getItem("lh.vol.nickname.v1")),
    ).toBe("민지");

    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "대기열" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "봉사자 입장" })).toHaveCount(0);
    await page.context().close();
  });

  test("3. /enter?code= 를 거친 기기는 별명 칸만 보인다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    const context = page.context();
    await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
    await expect(page).toHaveURL(/\/$/);
    // Windows WebKit은 Secure 쿠키를 http://localhost로 보내지 않는다. 시험 안에서만 Secure를 뺀다(운영은 HTTPS).
    const access = (await context.cookies()).find(
      (cookie) => cookie.name === "lh_access",
    );
    expect(access).toBeDefined();
    if (access) await context.addCookies([{ ...access, secure: false }]);

    await page.goto("/volunteer");
    await expect(
      page.getByRole("heading", { level: 1, name: "봉사자 입장" }),
    ).toBeVisible();
    await expect(page.getByLabel("별명")).toBeVisible();
    await expect(page.getByLabel("입장 코드")).toHaveCount(0);
    await page.getByLabel("별명").fill("지후");
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "대기열" }),
    ).toBeVisible();
    await context.close();
  });

  test("4. 다시 채우면 시연 카드 5개, 첫 카드가 대기 1시간 12분째 소니이고, 내 담당에 어제 보냄이 있다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);

    // 오래 기다린 순: 72분 전인 소니가 맨 위다.
    const first = page.locator(".vol-card").first();
    await expect(first).toContainText("대기 1시간 12분째");
    await expect(first).toContainText(FIRST_DEMO_QUOTE);
    await expect(first.getByRole("button", { name: CLAIM_NAME })).toBeVisible();
    // 목록은 20건까지만 보인다. 같은 서버에 다른 시험 파일이 실제 접수를 많이 남겼으면 가장 최근인
    // 다섯 번째 시연 카드(2분 전)가 잘릴 수 있어, 그때는 오래된 네 장만 확인한다(5건은 단위 시험이 확인한다).
    const visibleCards = await page.locator(".vol-card").count();
    const expected = visibleCards < 20 ? DEMO_QUOTES : DEMO_QUOTES.slice(0, 4);
    for (const quote of expected) {
      await expect(card(page, quote)).toHaveCount(1);
    }
    // 첫 불러오기와 다시 채우기 직후에는 새 요청 표시를 붙이지 않는다.
    await expect(page.getByText("새 요청", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^대기열 \d+$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "내 담당 0" })).toBeVisible();
    // 카드를 누르려고 아래로 스크롤됐을 수 있으므로 맨 위에서 찍는다.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "test-results/volunteer-queue.png" });
    await expectNoBlockingAxe(page);

    await page.getByRole("button", { name: "내 담당 0" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "내 담당" }),
    ).toBeVisible();
    const sent = card(page, "아이 실내화 210 사이즈, 흰색");
    await expect(sent).toContainText("어제 보냄");
    await expect(sent).toContainText("완료");
    await expect(sent).toContainText("전달 완료");
    await expect(
      page.getByText("이 기기에서 보낸 요청만 보입니다."),
    ).toBeVisible();
    await expect(page).toHaveURL(/tab=mine/);

    // 새로 고쳐도 같은 탭이다.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "내 담당" }),
    ).toBeVisible();
    await expect(card(page, "어제 보냄")).toHaveCount(1);
    await page.context().close();
  });

  test("새로고침을 누르면 직전 목록에 없던 요청에 새 요청 표시가 붙고, 다시 누르면 사라진다", async ({
    browser,
    baseURL,
  }) => {
    const watcher = await openDevice(browser, baseURL);
    await enterAs(watcher, "관찰자");
    await refill(watcher);

    // 다른 기기가 시연 요청을 다시 채운다(시연 행이 새로 만들어져 직전 목록에 없던 id가 된다).
    const other = await openDevice(browser, baseURL);
    await enterAs(other, "다른사람");
    await refill(other);

    await watcher.getByRole("button", { name: "새로고침" }).click();
    await expect(
      card(watcher, FIRST_DEMO_QUOTE).getByText("새 요청", { exact: true }),
    ).toBeVisible();

    // 한 번 더 누르면 직전 목록과 같으므로 표시가 사라진다.
    await watcher.getByRole("button", { name: "새로고침" }).click();
    await expect(watcher.getByText("새 요청", { exact: true })).toHaveCount(0);
    await watcher.context().close();
    await other.context().close();
  });

  test("5. 기기 두 대: A가 맡은 뒤 B가 옛 목록의 같은 카드를 누르면 방금 다른 봉사자가 맡았어요", async ({
    browser,
    baseURL,
  }) => {
    const a = await openDevice(browser, baseURL);
    await enterAs(a, "에이");
    await refill(a);

    const b = await openDevice(browser, baseURL);
    await enterAs(b, "비");
    const bCard = card(b, FIRST_DEMO_QUOTE);
    await expect(bCard).toHaveCount(1);

    // A가 먼저 맡는다.
    await card(a, FIRST_DEMO_QUOTE)
      .getByRole("button", { name: CLAIM_NAME })
      .click();
    await expect(a).toHaveURL(/\/volunteer\/requests\/[0-9a-f-]{36}$/);

    // B는 새로고침하지 않은 옛 목록에서 같은 카드를 누른다.
    await bCard.getByRole("button", { name: CLAIM_NAME }).click();
    await expect(b.getByRole("status")).toHaveText("방금 다른 봉사자가 맡았어요");
    // 안내 뒤 목록을 다시 불러와서 그 카드가 빠진다. B는 맡은 게 없으므로 다른 카드는 맡을 수 있다.
    await expect(card(b, FIRST_DEMO_QUOTE)).toHaveCount(0);
    await expect(
      b.getByRole("button", { name: CLAIM_NAME }).first(),
    ).toBeVisible();
    await a.context().close();
    await b.context().close();
  });

  test("6. 맡은 뒤에는 모든 맡기 버튼이 잠기고 문구가 바뀐다. 이어서 하기로 상세에 돌아온다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);
    await card(page, FIRST_DEMO_QUOTE)
      .getByRole("button", { name: CLAIM_NAME })
      .click();
    await expect(page).toHaveURL(/\/volunteer\/requests\//);

    // 상세: 이용자가 한 말, 구조화 줄, 진행 중.
    await expect(
      page.getByRole("heading", { level: 1, name: "요청 상세" }),
    ).toBeFocused();
    await expect(page.getByText("진행 중", { exact: true })).toBeVisible();
    await expect(page.getByText("이용자가 한 말")).toBeVisible();
    await expect(page.getByText(FIRST_DEMO_QUOTE)).toBeVisible();
    await expect(
      page.getByText("품목 헤드셋 · 예산 30만 원 안쪽 · 새 제품"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "내려놓기" })).toBeVisible();
    await expectNoBlockingAxe(page);

    await page.goto("/volunteer");
    await expect(
      page.getByRole("heading", { level: 1, name: "대기열" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: CLAIM_NAME })).toHaveCount(0);
    const locked = page.getByRole("button", { name: LOCKED_TEXT });
    await expect(locked.first()).toHaveAttribute("aria-disabled", "true");
    expect(await locked.count()).toBeGreaterThanOrEqual(4);
    await locked.first().click({ force: true });
    await expect(page.getByRole("status")).toHaveText(LOCKED_TEXT);
    await expect(page.getByRole("button", { name: "내 담당 1" })).toBeVisible();

    // 내 담당 탭: 진행 중 1, 내가 맡음, 이어서 하기.
    await page.getByRole("button", { name: "내 담당 1" }).click();
    await expect(page.getByRole("heading", { name: "진행 중 1" })).toBeVisible();
    const mine = card(page, "내가 맡음");
    await expect(mine).toContainText("진행");
    await expect(mine).toContainText(FIRST_DEMO_QUOTE);
    // 탭을 바꾼 뒤 목록 읽기가 끝나(새로고침 버튼이 다시 켜져) 화면이 가라앉은 다음 찍는다.
    await expect(page.getByRole("button", { name: "새로고침" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.screenshot({ path: "test-results/volunteer-mine.png" });
    await expectNoBlockingAxe(page);
    await mine.getByRole("link", { name: "이어서 하기" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "요청 상세" }),
    ).toBeVisible();
    await expect(page.getByText(FIRST_DEMO_QUOTE)).toBeVisible();
    await page.context().close();
  });

  test("7. 내려놓으면 대기열로 돌아가고 안내가 나온다. 내려놓은 요청의 상세는 내 담당이 아니다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);
    await card(page, FIRST_DEMO_QUOTE)
      .getByRole("button", { name: CLAIM_NAME })
      .click();
    await expect(page).toHaveURL(/\/volunteer\/requests\//);
    const detailUrl = page.url();

    await page.getByRole("button", { name: "내려놓기" }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    await expect(page.getByRole("status")).toHaveText(
      "요청을 대기열로 돌려놓았어요",
    );
    await expect(card(page, FIRST_DEMO_QUOTE)).toHaveCount(1);
    await expect(page.getByRole("button", { name: LOCKED_TEXT })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "내 담당 0" })).toBeVisible();

    await page.goto(detailUrl);
    await expect(page.getByText("이 요청은 내 담당이 아니에요")).toBeVisible();
    await expect(page.getByRole("link", { name: "목록으로", exact: true })).toBeVisible();
    await page.context().close();
  });

  test("8. 남의 요청 상세는 내 담당이 아니에요와 목록 링크, 화면 어디에도 남음 글자가 없다", async ({
    browser,
    baseURL,
  }) => {
    const a = await openDevice(browser, baseURL);
    await enterAs(a, "에이");
    await refill(a);
    await expectNoRemaining(a);
    await card(a, FIRST_DEMO_QUOTE)
      .getByRole("button", { name: CLAIM_NAME })
      .click();
    await expect(a).toHaveURL(/\/volunteer\/requests\//);
    await expect(a.getByRole("button", { name: "내려놓기" })).toBeVisible();
    await expectNoRemaining(a);
    const detailUrl = a.url();

    const b = await openDevice(browser, baseURL);
    await enterAs(b, "비");
    await expectNoRemaining(b);
    await b.goto(detailUrl);
    await expect(b.getByText("이 요청은 내 담당이 아니에요")).toBeVisible();
    await b.getByRole("link", { name: "목록으로", exact: true }).click();
    await expect(
      b.getByRole("heading", { level: 1, name: "대기열" }),
    ).toBeVisible();

    await b.getByRole("button", { name: /^내 담당/ }).click();
    await expectNoRemaining(b);
    await a.context().close();
    await b.context().close();
  });
});
