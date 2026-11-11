import { expect, test, type Page } from "@playwright/test";
import {
  claimDemo,
  enterAs,
  expectNoBlockingAxe,
  expectNoRemaining,
  FIRST_DEMO_QUOTE,
  openDevice,
  refill,
} from "./helpers/volunteerFlow";

// 봉사자 화면 v1 블록 2: 요청 상세의 후보·직접 찾기·쇼핑 에이전트(와이어프레임 화면 3·4).
// 가짜 AI 응답(LLM_MODE=mock)과 메모리 저장소 기준이다. 쇼핑몰 주소는 실제로 열지 않는다(새 탭은 가로채서 닫는다).

const HEADSET_NAMES = ["소니 WH-CH720N", "소니 WH-CH520", "소니 WH-1000XM4"];
const AI_BUTTON = "쇼핑 에이전트 열기";
const CHAT_ARRIVED = "답변이 도착했습니다.";
const CHAT_FAILED = "답변 서버에 연결하지 못했습니다. 다시 시도해 주세요.";

/** 새 기기로 입장해서 소니 헤드셋 요청을 맡고 상세 화면까지 간다. 쇼핑몰 도메인 요청은 막는다. */
async function openSonyDetail(
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
): Promise<Page> {
  const page = await openDevice(browser, baseURL);
  await page.context().route(/https:\/\/(search\.11st\.co\.kr|www\.coupang\.com|www\.gmarket\.co\.kr)\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>shop</title>" }),
  );
  await enterAs(page);
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);
  return page;
}

const agentDialog = (page: Page) => page.getByRole("dialog", { name: "쇼핑 에이전트" });

test.describe("봉사자 요청 상세: 후보·직접 찾기·AI 질문", () => {
  test("1. 소니를 맡으면 요약, 시연용 후보 3개, 새 탭 쇼핑몰 링크, 직접 찾기 3개가 보인다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);

    await expect(page.getByText(FIRST_DEMO_QUOTE)).toBeVisible();
    await expect(page.getByText("품목 헤드셋 · 예산 30만 원 안쪽 · 새 제품")).toBeVisible();
    await expect(page.getByRole("heading", { name: "후보 3개" })).toBeVisible();
    await expect(page.getByText("시연용 예시 후보", { exact: true })).toBeVisible();
    await expect(page.getByText("실제 상품과 가격은 쇼핑몰에서 확인하세요.")).toBeVisible();

    const cards = page.locator(".vol-cand");
    await expect(cards).toHaveCount(3);
    for (const [index, name] of HEADSET_NAMES.entries()) {
      const item = cards.nth(index);
      await expect(item).toContainText(name);
      await expect(item).toContainText("11번가 검색 · 가격은 쇼핑몰에서 확인");
      await expect(item.locator(".vol-cand-photo")).toHaveAttribute("aria-hidden", "true");
      const link = item.getByRole("link", { name: "쇼핑몰에서 보기" });
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("rel", /noreferrer/);
      await expect(link).toHaveAttribute(
        "href",
        `https://search.11st.co.kr/pc/total-search?kwd=${encodeURIComponent(name)}`,
      );
      await expect(item.getByRole("button", { name: "캡처 필요" })).toBeVisible();
    }

    // 직접 찾기: 요청의 브랜드+품목("소니 헤드셋")으로 세 쇼핑몰 검색을 새 탭으로 연다.
    const query = encodeURIComponent("소니 헤드셋");
    const shops: [string, string][] = [
      ["쿠팡", `https://www.coupang.com/np/search?q=${query}`],
      ["11번가", `https://search.11st.co.kr/pc/total-search?kwd=${query}`],
      ["G마켓", `https://www.gmarket.co.kr/n/search?keyword=${query}`],
    ];
    const finder = page.getByRole("region", { name: "직접 찾기" });
    for (const [name, href] of shops) {
      const link = finder.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }

    // 가격·재고 숫자와 남은 시간은 어디에도 없다.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\d,\d{3}|재고 있|재고 없|품절/);
    await expectNoRemaining(page);

    // '쇼핑몰에서 보기'를 누르면 새 탭이 열리고, 마지막으로 연 후보가 기기에 남는다.
    const popupPromise = page.waitForEvent("popup");
    await cards.nth(1).getByRole("link", { name: "쇼핑몰에서 보기" }).click();
    const popup = await popupPromise;
    await popup.close();
    const stored = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((name) =>
        name.startsWith("lh.vol.draft.v1."),
      );
      return key ? JSON.parse(window.localStorage.getItem(key) ?? "null") : null;
    });
    expect(stored).toMatchObject({ v: 1, manual: [], lastOpened: "c2" });

    await expectNoBlockingAxe(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "test-results/volunteer-detail.png" });
    await page.context().close();
  });

  test("2. AI 창에서 글자로 질문하면 가짜 답 '검색어:'가 보이고, 예산은 보내지 않는다. Esc로 닫으면 AI 버튼으로 초점이 돌아간다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    const aiButton = page.getByRole("button", { name: AI_BUTTON });
    await expect(aiButton).toBeVisible();
    const box = await aiButton.boundingBox();
    expect(box?.width).toBe(56);
    expect(box?.height).toBe(56);
    await expect(agentDialog(page)).toHaveCount(0);

    await aiButton.click();
    const dialog = agentDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { name: "쇼핑 에이전트" })).toBeFocused();
    await expect(
      dialog.getByText(
        "검색어, 확인할 조건, 찾는 순서를 알려 드립니다. 가격과 재고는 쇼핑몰에서 확인하세요.",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "닫기" })).toBeVisible();

    const question = "배터리 시간은 어디서 확인해?";
    const input = dialog.getByLabel("찾는 방법을 글자로 물어보세요");
    await expect(input).toHaveAttribute("maxlength", "300");
    const requestPromise = page.waitForRequest("**/api/chat");
    await input.fill(question);
    await dialog.getByRole("button", { name: "보내기" }).click();
    const request = await requestPromise;

    const body = request.postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["context", "question", "requestId"]);
    expect(body.question).toBe(question);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // context에는 brand와 item만 있다. 예산 숫자는 없다.
    expect(body.context).toEqual({ brand: "소니", item: "헤드셋" });
    expect(request.postData()).not.toMatch(/30만|예산/);

    await expect(dialog.getByText(question, { exact: true })).toBeVisible();
    await expect(dialog.getByText("검색어:").first()).toBeVisible();
    await expect(dialog.getByText("찾는 순서:")).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText(CHAT_ARRIVED);

    // 대화는 서버와 기기 저장소에 남지 않는다.
    const stores = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(window.localStorage),
        Object.entries(window.sessionStorage),
      ]),
    );
    expect(stores).not.toContain("배터리");
    expect(stores).not.toContain("검색어:");

    await expectNoBlockingAxe(page);
    // 스크린샷은 대화의 맨 위(첫 안내, 질문, 답의 시작)가 보이게 찍는다.
    await dialog.locator(".vol-sheet-body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: "test-results/volunteer-agent.png" });

    // Esc로 닫으면 AI 버튼으로 초점이 돌아가고, 다시 열면 대화가 그대로 남아 있다.
    await page.keyboard.press("Escape");
    await expect(agentDialog(page)).toHaveCount(0);
    await expect(aiButton).toBeFocused();
    await aiButton.click();
    await expect(agentDialog(page).getByText(question, { exact: true })).toBeVisible();
    await agentDialog(page).getByRole("button", { name: "닫기" }).click();
    await expect(aiButton).toBeFocused();

    // 후보의 '캡처 필요' 칩을 누르면 그 후보를 겨냥해 창이 열린다.
    await page.locator(".vol-cand").nth(2).getByRole("button", { name: "캡처 필요" }).click();
    await expect(agentDialog(page)).toBeVisible();
    await expect(agentDialog(page)).toContainText("선택한 후보: 후보 3 · 소니 WH-1000XM4");
    await page.context().close();
  });

  test("3. 답을 못 받으면 안내와 다시 시도가 나오고, 받다 만 글자는 버린다. 다시 시도하면 성공한다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    let calls = 0;
    await page.route("**/api/chat", async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "llm_failed" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: AI_BUTTON }).click();
    const dialog = agentDialog(page);
    await dialog.getByLabel("찾는 방법을 글자로 물어보세요").fill("검색어는 뭐로 해?");
    await dialog.getByRole("button", { name: "보내기" }).click();

    await expect(dialog.getByRole("status")).toHaveText(CHAT_FAILED);
    const retry = dialog.getByRole("button", { name: "다시 시도" });
    await expect(retry).toBeVisible();
    // 질문은 남고 답 말풍선은 없다.
    await expect(dialog.getByText("검색어는 뭐로 해?", { exact: true })).toHaveCount(1);
    await expect(dialog.getByText("검색어:")).toHaveCount(0);

    await retry.click();
    await expect(dialog.getByText("검색어:").first()).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText(CHAT_ARRIVED);
    await expect(dialog.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
    // 다시 시도해도 질문 말풍선이 겹치지 않는다.
    await expect(dialog.getByText("검색어는 뭐로 해?", { exact: true })).toHaveCount(1);
    expect(calls).toBe(2);
    await page.context().close();
  });

  test("4. 후보가 0개면 직접 추가가 나온다. http는 거절하고 https는 저장하며 새로 고쳐도 남는다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await page.route("**/api/volunteer/requests/*/candidates", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ source: "demo", candidates: [] }),
      }),
    );
    await enterAs(page);
    await refill(page);
    await claimDemo(page, FIRST_DEMO_QUOTE);

    await expect(page.getByRole("heading", { name: "후보 직접 추가" })).toBeVisible();
    await expect(page.getByText("시연용 예시 후보")).toHaveCount(0);
    await expect(page.locator(".vol-cand")).toHaveCount(0);

    await page.getByLabel("상품명").fill("직접 찾은 헤드셋");
    await page.getByLabel("구매 링크").fill("http://shop.example/p/1");
    await page.getByRole("button", { name: "후보 추가" }).click();
    await expect(page.getByText("링크는 https://로 시작해야 합니다")).toBeVisible();
    await expect(page.getByLabel("구매 링크")).toBeFocused();
    await expect(page.locator(".vol-cand")).toHaveCount(0);

    await page.getByLabel("구매 링크").fill("https://shop.example/p/1");
    await page.getByRole("button", { name: "후보 추가" }).click();
    const added = page.locator(".vol-cand");
    await expect(added).toHaveCount(1);
    await expect(added.first()).toContainText("직접 찾은 헤드셋");
    await expect(added.first().getByRole("link", { name: "쇼핑몰에서 보기" })).toHaveAttribute(
      "href",
      "https://shop.example/p/1",
    );
    await expect(page.getByText("링크는 https://로 시작해야 합니다")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "후보 1개" })).toBeVisible();
    // 입력 칸은 비워진다.
    await expect(page.getByLabel("상품명")).toHaveValue("");

    // 새로 고쳐도 남는다(기기 저장소).
    await page.reload();
    await expect(page.locator(".vol-cand")).toHaveCount(1);
    await expect(page.locator(".vol-cand").first()).toContainText("직접 찾은 헤드셋");

    // 최대 3개까지.
    for (const name of ["둘째 후보", "셋째 후보"]) {
      await page.getByLabel("상품명").fill(name);
      await page.getByLabel("구매 링크").fill("https://shop.example/p/2");
      await page.getByRole("button", { name: "후보 추가" }).click();
    }
    await expect(page.locator(".vol-cand")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "후보 추가" })).toHaveCount(0);
    await expect(page.getByText("후보는 최대 3개까지 추가할 수 있어요")).toBeVisible();
    await expectNoBlockingAxe(page);

    // 내려놓으면 이 요청의 기기 초안이 지워진다.
    await page.getByRole("button", { name: "내려놓기" }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    const left = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((name) => name.startsWith("lh.vol.draft.v1.")),
    );
    expect(left).toEqual([]);
    await page.context().close();
  });

  test("5. 후보를 불러오지 못하면 다시 불러오기가 나온다. 화면 어디에도 '남음'이 없다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    let calls = 0;
    await page.route("**/api/volunteer/requests/*/candidates", async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "store_unavailable" }),
        });
      } else {
        await route.continue();
      }
    });
    await enterAs(page);
    await refill(page);
    await claimDemo(page, FIRST_DEMO_QUOTE);

    await expect(page.getByText("후보를 불러오지 못했습니다. 다시 불러와 주세요.")).toBeVisible();
    // 후보가 없어도 직접 찾기와 AI 버튼은 쓸 수 있다.
    await expect(page.getByRole("region", { name: "직접 찾기" })).toBeVisible();
    await expect(page.getByRole("button", { name: AI_BUTTON })).toBeVisible();
    await page.getByRole("button", { name: "후보 다시 불러오기" }).click();
    await expect(page.locator(".vol-cand")).toHaveCount(3);
    await expectNoRemaining(page);
    await expectNoBlockingAxe(page);
    await page.context().close();
  });

  test("6. 접근 쿠키(lh_access)가 끝난 기기도 상세를 다시 열면 AI 질문이 된다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    // 입장 7일 뒤처럼 lh_access만 지운다. lh_vol은 30일이라 남아 있다.
    await page.context().clearCookies({ name: "lh_access" });
    const before = (await page.context().cookies()).map((cookie) => cookie.name);
    expect(before).not.toContain("lh_access");
    expect(before).toContain("lh_vol");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "요청 상세" })).toBeVisible();
    await expect(page.locator(".vol-cand")).toHaveCount(3);
    await page.getByRole("button", { name: AI_BUTTON }).click();
    const dialog = agentDialog(page);
    await dialog.getByLabel("찾는 방법을 글자로 물어보세요").fill("검색어는 뭐로 해?");
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByText("검색어:").first()).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText(CHAT_ARRIVED);
    const after = (await page.context().cookies()).map((cookie) => cookie.name);
    expect(after).toContain("lh_access");
    await page.context().close();
  });
});
