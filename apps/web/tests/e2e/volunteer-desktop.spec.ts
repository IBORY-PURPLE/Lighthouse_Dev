import { expect, test } from "@playwright/test";
import {
  CLAIM_NAME,
  enterAs,
  expectNoBlockingAxe,
  FIRST_DEMO_QUOTE,
  openDesktopDevice,
  pane,
  paneToggle,
  queueCard,
  queueCards,
  refill,
  shot,
} from "./helpers/volunteerFlow";

// 봉사자 첫 화면(노트북 1440×900, e2e-desktop). 휴대폰 시험은 volunteer-queue.spec.ts.
// 가짜 서버 저장소(메모리) 기준이다. 화면 증거(volunteer-home, volunteer-claimed-hero)는 저장소 루트 test-results/demo6-shots에 남긴다.

test.describe("봉사자 첫 화면 · 노트북 1440", () => {
  test("왼쪽 창이 열린 채 시작하고 버튼으로 닫고 연다. 닫히면 inert이고 대화 쪽이 넓어진다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDesktopDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);

    const toggle = paneToggle(page);
    await expect(toggle).toHaveAttribute("aria-controls", "vol-mine");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(pane(page)).toBeVisible();
    await expect(pane(page)).not.toHaveAttribute("inert", "");
    await expect(queueCard(page, FIRST_DEMO_QUOTE)).toHaveCount(1);
    await expect(queueCards(page).first().getByRole("button", { name: CLAIM_NAME })).toBeVisible();

    // 창은 대화 옆에 붙어 있다: 가운데 영역이 창 폭만큼 오른쪽에서 시작한다.
    const main = page.locator("main.vc-main");
    const withPane = await main.boundingBox();
    expect(withPane?.x ?? 0).toBeGreaterThanOrEqual(300);
    await shot(page, "volunteer-home");
    await expectNoBlockingAxe(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(pane(page)).toBeHidden();
    await expect(pane(page)).toHaveAttribute("inert", "");
    const without = await main.boundingBox();
    expect(without?.x ?? 99).toBeLessThan(10);

    await toggle.click();
    await expect(pane(page)).toBeVisible();
    await page.context().close();
  });

  test("맡으면 같은 히어로 레이아웃에 제품 제목이 붙고, 왼쪽 창 내 담당에 그 요청이 진행 중으로 있다(aria-current)", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDesktopDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);
    await queueCard(page, FIRST_DEMO_QUOTE).getByRole("button", { name: CLAIM_NAME }).click();
    await expect(page).toHaveURL(/\/volunteer\/requests\/[0-9a-f-]{36}$/);

    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "hero");
    await expect(
      page.getByRole("heading", { level: 2, name: "소니 헤드셋 구매 경험 리서치 어시스턴트" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "구매했어요", exact: true })).toBeVisible();

    // 왼쪽 창은 리서치 화면에서도 열린 채 시작한다. 진행 중 1건에 aria-current="page".
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(pane(page)).toBeVisible();
    await expect(pane(page).getByRole("heading", { name: "진행 중 1" })).toBeVisible();
    const current = pane(page).getByTestId("mine-current");
    await expect(current).toContainText(FIRST_DEMO_QUOTE);
    await expect(current.getByRole("link", { name: "이어서 하기" })).toHaveAttribute("aria-current", "page");
    // 이미 맡았으므로 대기열의 맡기 버튼은 모두 잠긴다.
    await expect(pane(page).getByRole("button", { name: CLAIM_NAME })).toHaveCount(0);
    await shot(page, "volunteer-claimed-hero");
    await expectNoBlockingAxe(page);

    // 위 막대의 뒤로 가기는 첫 화면이다.
    await page.getByRole("link", { name: "첫 화면으로" }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await page.context().close();
  });
});
