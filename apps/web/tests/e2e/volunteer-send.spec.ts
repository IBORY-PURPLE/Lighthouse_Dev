import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  claimDemo,
  enterAs,
  expectNoBlockingAxe,
  expectNoRemaining,
  FIRST_DEMO_QUOTE,
  LOCKED_TEXT,
  makeSyntheticDetailImage,
  openDevice,
  refill,
} from "./helpers/volunteerFlow";

// 봉사자 화면 v1 블록 4: 요약 확인(화면 5) → 보내기 → 보낸 요청(화면 6).
// 전부 가짜 응답 기준이다(EXTRACT_MODE=mock, LLM_MODE=mock). 쇼핑몰 주소는 실제로 열지 않는다.
// 실제 엔진, 실제 캡처, 실제 아이폰, VoiceOver 낭독은 여기서 판정하지 않는다.

const AI_BUTTON = "쇼핑 에이전트 열기";
const SEND_FAILED = "보내지 못했습니다. 다시 보내기를 눌러 주세요.";
const CONFIRM_FIRST = "먼저 후보를 확인해 주세요";
const HTTPS_ONLY = "링크는 https://로 시작해야 합니다";

const agentDialog = (page: Page) => page.getByRole("dialog", { name: "쇼핑 에이전트" });
const savedNotice = (page: Page) => agentDialog(page).getByRole("group");
const chip = (page: Page, index: number) =>
  page.locator(".vol-cand").nth(index).locator(".vol-chip-btn");
const summaryHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "요약 확인" });
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "후보 선택" }).getByRole("button", { name, exact: true });
const sendButton = (page: Page, count: number) =>
  page.getByRole("button", { name: `확인한 ${count}개 보내기`, exact: true });

/** 새 기기로 입장해서 소니 헤드셋 요청을 맡고 상세 화면까지 간다. 쇼핑몰 도메인 요청은 막는다. */
async function openSonyDetail(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const page = await openDevice(browser, baseURL);
  await page
    .context()
    .route(/https:\/\/(search\.11st\.co\.kr|www\.coupang\.com|www\.gmarket\.co\.kr)\/.*/, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>shop</title>" }),
    );
  await enterAs(page);
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);
  return page;
}

/** 에이전트 창에서 합성 캡처 1장을 올려(첫 '캡처 필요' 후보 = 후보 1) 초안을 만들고 창을 닫는다. */
async function captureFirstCandidate(page: Page) {
  await page.getByRole("button", { name: AI_BUTTON }).click();
  await expect(agentDialog(page)).toBeVisible();
  const buffer = await makeSyntheticDetailImage(page, { height: 900, noise: false });
  await page
    .getByTestId("capture-input")
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
  await expect(savedNotice(page)).toContainText("캡처 1장을 후보 1에 저장했습니다", {
    timeout: 60_000,
  });
  await agentDialog(page).getByRole("button", { name: "닫기" }).click();
  await expect(agentDialog(page)).toHaveCount(0);
  await expect(chip(page, 0)).toHaveText("캡처 읽음 · 확인 전");
}

async function openSummary(page: Page) {
  await page.getByRole("link", { name: "요약 확인하기" }).click();
  await expect(page).toHaveURL(/\/volunteer\/requests\/[0-9a-f-]{36}\/summary$/);
  await expect(summaryHeading(page)).toBeVisible();
}

/** 이 기기에 저장된 요청별 초안(없으면 null). */
async function storedDraft(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((name) => name.startsWith("lh.vol.draft.v1."));
    return key ? (JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown>) : null;
  });
}

test.describe("봉사자 요약 확인 → 보내기 → 보낸 요청(가짜 응답 기준)", () => {
  test.setTimeout(150_000);

  test("1. 캡처한 후보를 확인해 보내면 완료 화면이 나오고, 내 담당에 보낸 요청이 보이며 맡기 잠금이 풀린다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    await captureFirstCandidate(page);
    await openSummary(page);

    // 안내, 후보 탭(확인 전 / 캡처 없음), 첫 '캡처 읽음' 후보가 골라져 있다.
    await expect(
      page.getByText("후보마다 AI 초안을 확인하고 고쳐 주세요. 확인한 후보만 보냅니다."),
    ).toBeVisible();
    await expect(tab(page, "후보 1 확인 전")).toHaveAttribute("aria-pressed", "true");
    await expect(tab(page, "후보 2 캡처 없음")).toHaveAttribute("aria-pressed", "false");
    await expect(tab(page, "후보 3 캡처 없음")).toBeVisible();

    // 상품명과 구매 링크는 후보로 채워진다. 상세 요약은 상품명을 뺀 네 항목이다.
    await expect(page.getByLabel("상품명", { exact: true })).toHaveValue("소니 WH-CH720N");
    await expect(page.getByLabel("구매 링크", { exact: true })).toHaveValue(
      /^https:\/\/search\.11st\.co\.kr\/pc\/total-search\?kwd=/,
    );
    await expect(page.locator(".vol-item")).toHaveCount(4);
    await expect(page.getByLabel("옵션", { exact: true })).toHaveValue("블랙, 화이트");
    await expect(page.getByLabel("주의사항", { exact: true })).toHaveValue("물에 닿지 않게 하세요");
    // 근거로 확인되지 않은 항목은 값이 비고 '확인 안 됨'과 '확인 필요'가 보인다.
    await expect(page.getByLabel("핵심 사양", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("핵심 사양", { exact: true })).toHaveAttribute("placeholder", "확인 안 됨");
    await expect(page.getByLabel("구성품", { exact: true })).toHaveAttribute("placeholder", "확인 안 됨");
    await expect(page.getByText("확인 필요", { exact: true })).toHaveCount(2);

    // 근거 보기는 접혀 있다가 누르면 열린다.
    const evidence = page.getByText("색상 옵션: 블랙, 화이트", { exact: true });
    await expect(evidence).toBeHidden();
    await page.locator(".vol-item").nth(0).getByText("근거 보기").click();
    await expect(evidence).toBeVisible();

    // 아직 확인한 후보가 없어서 보내기가 잠긴다.
    await expect(sendButton(page, 0)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(CONFIRM_FIRST)).toBeVisible();
    await sendButton(page, 0).click({ force: true });
    await expect(summaryHeading(page)).toBeVisible();

    // 후보 2(캡처 없음): 상품명·링크로 채워지고 네 항목은 모두 '확인 안 됨'이다. 돌아오면 후보 1 입력이 그대로다.
    await tab(page, "후보 2 캡처 없음").click();
    await expect(page.getByLabel("상품명", { exact: true })).toHaveValue("소니 WH-CH520");
    await expect(page.getByText("확인 필요", { exact: true })).toHaveCount(4);
    await expect(page.getByText(/캡처가 없는 후보예요/)).toBeVisible();
    await tab(page, "후보 1 확인 전").click();

    // 값 고침 + 가이드 입력. 고친 항목의 확인 필요 칩은 사라진다.
    await page.getByLabel("핵심 사양", { exact: true }).fill("블루투스 5.3, 최대 30시간");
    await expect(page.getByText("확인 필요", { exact: true })).toHaveCount(1);
    await page.getByLabel("구매 가이드", { exact: true }).fill("쇼핑몰에서 ‘구매하기’를 누르고 색상을 고릅니다.");

    // 후보 1 확인 → 탭이 확인함으로, 보내기가 열린다. 고치면 다시 확인 전이 된다.
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("후보 1 요약을 확인했습니다");
    await expect(tab(page, "후보 1 확인함")).toBeVisible();
    await expect(sendButton(page, 1)).not.toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("구매 가이드", { exact: true }).fill("쇼핑몰에서 ‘구매하기’를 누르고 색상을 고릅니다. 쿠폰은 결제 화면에서 적용됩니다.");
    await expect(tab(page, "후보 1 확인 전")).toBeVisible();
    await expect(sendButton(page, 0)).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(tab(page, "후보 1 확인함")).toBeVisible();

    // 확인과 고침은 기기에만 남는다. 이미지와 읽은 글자 원문은 없다.
    const stored = (await storedDraft(page)) as {
      drafts: Record<string, { confirmed: boolean; edits: { guide: string; values: Record<string, string> } }>;
    };
    expect(stored.drafts.c1.confirmed).toBe(true);
    expect(stored.drafts.c1.edits.values.spec).toBe("블루투스 5.3, 최대 30시간");
    expect(JSON.stringify(stored)).not.toContain("data:image");
    expect(JSON.stringify(stored)).not.toContain("[조각");

    await expectNoBlockingAxe(page);
    await expectNoRemaining(page);
    await page.waitForTimeout(200);
    await page.screenshot({ path: "test-results/volunteer-summary.png", fullPage: true });

    // 보내기: 요청이 완료되고 화면 6으로 간다. 서버에는 이름·링크·가이드·요약 항목만 간다.
    let sentBody: { candidates: Array<Record<string, unknown>> } | null = null;
    await page.route("**/api/volunteer/requests/*/result", async (route) => {
      sentBody = route.request().postDataJSON();
      await route.fallback();
    });
    await sendButton(page, 1).click();
    await expect(page).toHaveURL(/\/volunteer\/requests\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "완료된 요청" })).toBeVisible();
    expect(sentBody).not.toBeNull();
    const body = sentBody as unknown as { candidates: Array<Record<string, unknown>> };
    expect(body.candidates).toHaveLength(1);
    expect(Object.keys(body.candidates[0]).sort()).toEqual(["guide", "name", "summary", "url"]);
    expect(body.candidates[0].summary).toEqual([
      { label: "옵션", value: "블랙, 화이트" },
      { label: "핵심 사양", value: "블루투스 5.3, 최대 30시간" },
      { label: "주의사항", value: "물에 닿지 않게 하세요" },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/data:image|\[조각|근거|evidence/);

    // 화면 6: 전달 완료, 보낸 시각, 이용자가 들음·구매 링크 열음은 서버 값이 없어서 '아직'이다.
    await expect(page.getByText("전달 완료", { exact: true })).toBeVisible();
    await expect(page.getByText(/^보낸 시각 \d+월 \d+일 (오전|오후) \d+:\d{2}$/)).toBeVisible();
    await expect(page.getByText("이용자가 들음 아직", { exact: true })).toBeVisible();
    await expect(page.getByText("구매 링크 열음 아직", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "보낸 내용 (읽기 전용)" })).toBeVisible();
    await expect(page.getByText(FIRST_DEMO_QUOTE, { exact: true })).toBeVisible();
    await expect(page.getByText("보낸 후보 1개")).toBeVisible();
    // 상품명은 후보 이름 줄에서 찾는다(구매 링크도 읽기 좋게 풀어 보여서 같은 글자가 들어 있다).
    await expect(page.locator(".vol-sent-name").filter({ hasText: "소니 WH-CH720N" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "https://search.11st.co.kr/pc/total-search?kwd=소니 WH-CH720N" }),
    ).toHaveAttribute("href", /kwd=%EC%86%8C%EB%8B%88%20WH-CH720N$/);
    await expect(page.getByRole("link", { name: /^https:\/\/search\.11st\.co\.kr\// })).toBeVisible();
    await expect(
      page.getByText("옵션 블랙, 화이트 · 핵심 사양 블루투스 5.3, 최대 30시간 · 주의사항 물에 닿지 않게 하세요", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("쇼핑몰에서 ‘구매하기’를 누르고 색상을 고릅니다. 쿠폰은 결제 화면에서 적용됩니다.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("이 기기에서 보낸 요청만 보입니다. 기기를 바꾸면 보이지 않습니다."),
    ).toBeVisible();
    // 읽기 전용: 입력 칸이 없다. 가격·재고 글자도 없다.
    await expect(page.locator("input, textarea")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/가격 ?\d|재고 ?\d|[0-9],?[0-9]{3}원/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expectNoRemaining(page);
    await expectNoBlockingAxe(page);
    await page.waitForTimeout(200);
    await page.screenshot({ path: "test-results/volunteer-sent.png", fullPage: true });

    // 이 기기의 초안은 지워졌다.
    expect(await storedDraft(page)).toBeNull();

    // 목록으로: 내 담당에 보낸 요청이 있고, 맡은 요청이 없어서 맡기 잠금이 풀린다.
    await page.getByRole("link", { name: "목록으로", exact: true }).click();
    await expect(page).toHaveURL(/\/volunteer\?tab=mine$/);
    await expect(page.getByRole("heading", { name: "이 기기에서 보낸 요청" })).toBeVisible();
    const sentCard = page.locator(".vol-card").filter({ hasText: FIRST_DEMO_QUOTE });
    await expect(sentCard).toContainText("완료");
    await expect(sentCard).toContainText("오늘 보냄");
    await expect(sentCard).toContainText("전달 완료");
    await expect(page.getByText("맡은 요청이 없어요.")).toBeVisible();
    await page.getByRole("button", { name: /^대기열/ }).click();
    await expect(page.getByText(LOCKED_TEXT)).toHaveCount(0);
    await expect(
      page.locator(".vol-card").filter({ hasText: "세탁 세제 리필용 큰 것" }).getByRole("button", { name: "이 요청 맡기" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    // 보낸 카드를 누르면 다시 완료 화면(읽기 전용)이 열린다. 새로 고쳐도 같다.
    await page.getByRole("button", { name: /^내 담당/ }).click();
    await page.locator(".vol-card").filter({ hasText: FIRST_DEMO_QUOTE }).click();
    await expect(page.getByRole("heading", { level: 1, name: "완료된 요청" })).toBeVisible();
    await page.reload();
    await expect(page.getByText("이용자가 들음 아직", { exact: true })).toBeVisible();
    // 보낸 요청의 요약 확인 주소를 열어도 완료 화면으로 돌아온다.
    await page.goto(`${new URL(page.url()).pathname}/summary`);
    await expect(page.getByRole("heading", { level: 1, name: "완료된 요청" })).toBeVisible();
    await page.context().close();
  });

  test("2. 보내기가 503으로 실패하면 입력이 남고, 다시 보내면 성공한다(캡처 없이 상품명·링크만 확인)", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    await openSummary(page);
    // 캡처가 없으니 후보 1이 '캡처 없음'이다. 후보 2·3과 같다.
    await expect(tab(page, "후보 1 캡처 없음")).toHaveAttribute("aria-pressed", "true");

    await page.getByLabel("구매 가이드", { exact: true }).fill("가이드는 남아야 합니다");
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(tab(page, "후보 1 확인함")).toBeVisible();

    let calls = 0;
    await page.route("**/api/volunteer/requests/*/result", async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "store_unavailable" }),
        });
        return;
      }
      await route.fallback();
    });

    await sendButton(page, 1).click();
    await expect(page.getByRole("status")).toHaveText(SEND_FAILED);
    await expect(summaryHeading(page)).toBeVisible();
    await expect(page.getByLabel("구매 가이드", { exact: true })).toHaveValue("가이드는 남아야 합니다");
    await expect(tab(page, "후보 1 확인함")).toBeVisible();
    await expect(sendButton(page, 1)).not.toHaveAttribute("aria-disabled", "true");

    await sendButton(page, 1).click();
    await expect(page.getByRole("heading", { level: 1, name: "완료된 요청" })).toBeVisible();
    expect(calls).toBe(2);
    // 요약 항목은 비어 있어서 보내지 않았다. 가이드와 링크만 있다.
    await expect(page.getByText("가이드는 남아야 합니다", { exact: true })).toBeVisible();
    await expect(page.getByText("상세 요약", { exact: true })).toHaveCount(0);
    await page.context().close();
  });

  test("3. http 링크에는 안내가 나오고 확인되지 않는다. https로 고치면 확인된다. 서버가 invalid_url이면 같은 안내", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    await openSummary(page);

    const link = page.getByLabel("구매 링크", { exact: true });
    await link.fill("http://shop.example/p/1");
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(page.getByText(HTTPS_ONLY)).toBeVisible();
    await expect(link).toHaveAttribute("aria-invalid", "true");
    await expect(link).toBeFocused();
    await expect(tab(page, "후보 1 캡처 없음")).toBeVisible();
    await expect(sendButton(page, 0)).toHaveAttribute("aria-disabled", "true");
    await expectNoBlockingAxe(page);

    // 빈 상품명도 막는다.
    await link.fill("https://shop.example/p/1");
    await expect(page.getByText(HTTPS_ONLY)).toHaveCount(0);
    const name = page.getByLabel("상품명", { exact: true });
    await name.fill("   ");
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(page.getByText("상품명을 넣어 주세요")).toBeVisible();
    await expect(name).toBeFocused();
    await name.fill("직접 고친 이름");
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(tab(page, "후보 1 확인함")).toBeVisible();

    // 서버가 링크를 거절하면(400 invalid_url) 같은 안내가 나오고 입력은 남는다.
    await page.route("**/api/volunteer/requests/*/result", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "invalid_url" }),
      }),
    );
    await sendButton(page, 1).click();
    await expect(page.getByRole("status")).toHaveText(HTTPS_ONLY);
    await expect(link).toHaveValue("https://shop.example/p/1");
    await expect(name).toHaveValue("직접 고친 이름");
    await page.context().close();
  });

  test("4. 맡은 요청이 아니게 되면(403) 안내하고 목록 링크를 준다. 입력은 남는다", async ({ browser, baseURL }) => {
    const page = await openSonyDetail(browser, baseURL);
    await openSummary(page);
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await page.route("**/api/volunteer/requests/*/result", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "not_yours" }),
      }),
    );
    await sendButton(page, 1).click();
    await expect(page.getByRole("status")).toHaveText("이 요청은 더 이상 내 담당이 아니에요");
    await expect(page.getByRole("link", { name: "목록으로", exact: true })).toBeVisible();
    await expect(tab(page, "후보 1 확인함")).toBeVisible();
    await page.context().close();
  });

  test("5. 요청 상세의 칩 → 그 후보의 요약 확인, 고치면 확인 전·새로 고쳐도 유지, 내려놓으면 초안이 지워진다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    await captureFirstCandidate(page);

    // '캡처 읽음 · 확인 전' 칩을 누르면 요약 확인의 그 후보로 간다.
    await chip(page, 0).click();
    await expect(page).toHaveURL(/\/summary\?c=c1$/);
    await expect(summaryHeading(page)).toBeVisible();
    await expect(tab(page, "후보 1 확인 전")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
    await expect(tab(page, "후보 1 확인함")).toBeVisible();

    // 새로 고쳐도 확인함이다. 상세로 돌아가면 칩이 '요약 확인함'이고, 다시 누르면 같은 후보로 간다.
    await page.reload();
    await expect(summaryHeading(page)).toBeVisible();
    await expect(tab(page, "후보 1 확인함")).toBeVisible();
    await page.getByRole("link", { name: "요청 상세로" }).click();
    await expect(chip(page, 0)).toHaveText("요약 확인함");
    await expect(chip(page, 1)).toHaveText("캡처 필요");
    // '캡처 필요' 칩은 그대로 에이전트 창을 연다.
    await chip(page, 1).click();
    await expect(agentDialog(page)).toBeVisible();
    await agentDialog(page).getByRole("button", { name: "닫기" }).click();

    await chip(page, 0).click();
    await page.getByLabel("구매 가이드", { exact: true }).fill("수정한 가이드");
    await expect(tab(page, "후보 1 확인 전")).toBeVisible();
    await page.getByRole("link", { name: "요청 상세로" }).click();
    await expect(chip(page, 0)).toHaveText("캡처 읽음 · 확인 전");

    // 내려놓으면 초안(확인·고침 포함)이 지워진다.
    await page.getByRole("button", { name: "내려놓기" }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    expect(await storedDraft(page)).toBeNull();
    await page.context().close();
  });

  test("6. 요약 확인 화면의 AI 버튼: 캡처는 지금 고른 탭의 후보에 저장되고 입력 칸이 새 초안으로 바뀐다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    await openSummary(page);
    await tab(page, "후보 2 캡처 없음").click();
    await page.getByRole("button", { name: AI_BUTTON }).click();
    await expect(agentDialog(page)).toBeVisible();
    await expect(
      agentDialog(page).getByRole("button", { name: "캡처 올리기 · 후보 2에 저장" }),
    ).toBeVisible();
    const buffer = await makeSyntheticDetailImage(page, { height: 900, noise: false });
    await page
      .getByTestId("capture-input")
      .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
    await expect(savedNotice(page)).toContainText("캡처 1장을 후보 2에 저장했습니다", {
      timeout: 60_000,
    });
    await agentDialog(page).getByRole("button", { name: "닫기" }).click();
    await expect(agentDialog(page)).toHaveCount(0);

    // 탭과 입력 칸이 바로 새 초안을 반영한다.
    await expect(tab(page, "후보 2 확인 전")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("옵션", { exact: true })).toHaveValue("블랙, 화이트");
    await expect(tab(page, "후보 1 캡처 없음")).toBeVisible();
    await expectNoBlockingAxe(page);
    await page.context().close();
  });
});
