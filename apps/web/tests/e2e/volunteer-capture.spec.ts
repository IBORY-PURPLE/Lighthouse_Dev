import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";
import {
  claimDemo,
  enterAs,
  expectNoBlockingAxe,
  FIRST_DEMO_QUOTE,
  makeSyntheticDetailImage,
  openDevice,
  refill,
} from "./helpers/volunteerFlow";

// 봉사자 화면 v1 블록 3: 에이전트 창에서 캡처를 올려 후보별 요약 초안을 만든다(와이어프레임 화면 4).
// 전부 가짜 응답 기준이다(EXTRACT_MODE=mock, LLM_MODE=mock). 쇼핑몰 주소는 실제로 열지 않는다(새 탭은 닫는다).
// 실제 엔진, 실제 캡처, 아이폰 canvas 한도, VoiceOver 낭독은 여기서 판정하지 않는다.

const AI_BUTTON = "쇼핑 에이전트 열기";
const PRICE_LIKE = /price|가격|재고|할인|stock|discount/i;
const READING = /^이미지 1\/\d+을 읽고 있습니다\.$/;
const FAKE_NAME = "가짜 헤드셋 LH-200";
const MISMATCH_C1 = `읽은 상품명 ‘${FAKE_NAME}’이 후보 ‘소니 WH-CH720N’와 다릅니다. 맞는 후보로 바꾸세요.`;
const MISMATCH_C2 = `읽은 상품명 ‘${FAKE_NAME}’이 후보 ‘소니 WH-CH520’와 다릅니다. 맞는 후보로 바꾸세요.`;
const MISMATCH_C3 = `읽은 상품명 ‘${FAKE_NAME}’이 후보 ‘소니 WH-1000XM4’와 다릅니다. 맞는 후보로 바꾸세요.`;
const SAVED_HINT =
  "마지막으로 ‘쇼핑몰에서 보기’를 누른 후보입니다. 읽은 상품명이 후보와 다르면 알려 드립니다.";
const MANUAL_TEXT = `상품명: ${FAKE_NAME}\n색상 옵션: 블랙, 화이트\n주의: 물에 닿지 않게 하세요`;

const agentDialog = (page: Page) => page.getByRole("dialog", { name: "쇼핑 에이전트" });
const dialogStatus = (page: Page) => agentDialog(page).getByRole("status");
const captureInput = (page: Page) => page.getByTestId("capture-input");
const savedNotice = (page: Page) => agentDialog(page).getByRole("group");
const chip = (page: Page, index: number): Locator =>
  page.locator(".vol-cand").nth(index).locator(".vol-chip-btn");

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

async function openAgent(page: Page) {
  await page.getByRole("button", { name: AI_BUTTON }).click();
  await expect(agentDialog(page)).toBeVisible();
}

function png(name: string, buffer: Buffer) {
  return { name, mimeType: "image/png", buffer };
}

/** 이 기기에 저장된 요청별 초안(없으면 null). */
async function storedDraft(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((name) => name.startsWith("lh.vol.draft.v1."));
    return key ? (JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown>) : null;
  });
}

/** 가짜 요약 응답(항목 5개). productName이 null이면 못 읽은 것이다. */
function fakeSummary(productName: string | null) {
  const field = (key: string, label: string, value: string | null) => ({
    key,
    label,
    value,
    evidence: value,
    check: value ? "matched" : "missing",
    needsCheck: false,
    reason: null,
  });
  return {
    draftVersion: 1,
    source: "ocr",
    fields: [
      field("productName", "상품명", productName),
      field("option", "옵션", "블랙"),
      field("spec", "핵심 사양", null),
      field("components", "구성품", null),
      field("caution", "주의사항", null),
    ],
    missing: ["spec", "components", "caution"],
    unreadable: [],
  };
}

test.describe("봉사자 캡처 올리기 → 후보별 요약 초안(가짜 응답 기준)", () => {
  test.setTimeout(120_000);

  test("1. 4.5MB보다 큰 긴 합성 이미지가 조각으로 순서대로 읽히고, 첫 '캡처 필요' 후보에 초안이 저장된다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    const posted: Array<{ pieceIndex: number; pieceCount: number; bytes: number }> = [];
    await page.route("**/api/volunteer/extract-text", async (route) => {
      const body = route.request().postDataJSON();
      const base64 = String(body.image).split(",")[1] ?? "";
      posted.push({
        pieceIndex: body.pieceIndex,
        pieceCount: body.pieceCount,
        bytes: Buffer.from(base64, "base64").length,
      });
      expect(String(body.image)).toMatch(/^data:image\/jpeg;base64,/);
      expect(route.request().headers()["x-demo-volunteer"]).toBeUndefined();
      // 가짜 엔진은 너무 빨라 시작 안내를 확인하기 전에 끝난다. 조각마다 조금 늦춘다.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fallback();
    });
    let summarizeCalls = 0;
    await page.route("**/api/volunteer/summarize", async (route) => {
      summarizeCalls += 1;
      await route.fallback();
    });

    await openAgent(page);
    const upload = agentDialog(page).getByRole("button", { name: "캡처 올리기 · 후보 1에 저장" });
    await expect(upload).toBeVisible();
    await expect(chip(page, 0)).toHaveText("캡처 필요");

    const buffer = await makeSyntheticDetailImage(page);
    // 서버 한도(4.5MB)보다 파일 자체가 크다. 그래서 조각으로 나눠야만 보낼 수 있다.
    expect(buffer.length).toBeGreaterThan(4.5 * 1024 * 1024);
    await captureInput(page).setInputFiles(png("synthetic-detail.png", buffer));
    await expect(dialogStatus(page)).toHaveText(READING);
    await expect(dialogStatus(page)).toHaveText(
      `캡처 1장을 후보 1에 저장했습니다. 요약 초안이 도착했습니다. 항목 5개, 확인 필요 1개. ${MISMATCH_C1}`,
      { timeout: 60_000 },
    );

    // 860×4500 → 1,200px 조각, 겹침 100px → 4개, 순서대로 한 장씩. 다 읽은 뒤 요약은 한 번만 부른다.
    expect(posted.length).toBeGreaterThanOrEqual(3);
    expect(posted.map((p) => p.pieceIndex)).toEqual(posted.map((_, i) => i));
    expect(new Set(posted.map((p) => p.pieceCount))).toEqual(new Set([posted.length]));
    expect(posted.every((p) => p.bytes <= 1.5 * 1024 * 1024)).toBe(true);
    expect(summarizeCalls).toBe(1);

    // 저장 알림: 몇 장을 어느 후보에, 다른 후보로 바꾸기, 상품명이 다르다는 경고.
    const notice = savedNotice(page);
    await expect(notice).toContainText("캡처 1장을 후보 1에 저장했습니다");
    await expect(notice).toContainText(SAVED_HINT);
    await expect(notice).toContainText(MISMATCH_C1);
    await expect(notice.getByRole("button", { name: "다른 후보로 바꾸기" })).toBeVisible();

    // 후보 칩이 '캡처 필요'에서 '캡처 읽음 · 확인 전'으로 바뀐다. 다른 후보는 그대로다.
    await expect(chip(page, 0)).toHaveText("캡처 읽음 · 확인 전");
    await expect(chip(page, 1)).toHaveText("캡처 필요");
    await expect(chip(page, 2)).toHaveText("캡처 필요");
    // 이제 첫 '캡처 필요' 후보는 후보 2다.
    await expect(
      agentDialog(page).getByRole("button", { name: "캡처 올리기 · 후보 2에 저장" }),
    ).toBeVisible();

    // 기기에는 요약 초안만 있다. 항목 5개, 가격·재고·할인 항목 없음, 이미지와 읽은 글자 원문 없음.
    const stored = (await storedDraft(page)) as {
      lastOpened: string | null;
      drafts: Record<string, { captureCount: number; confirmed: boolean; draft: { fields: Array<{ key: string; label: string }> } }>;
    };
    expect(Object.keys(stored.drafts)).toEqual(["c1"]);
    expect(stored.drafts.c1.captureCount).toBe(1);
    expect(stored.drafts.c1.confirmed).toBe(false);
    const fields = stored.drafts.c1.draft.fields;
    expect(fields.map((field) => field.key)).toEqual([
      "productName",
      "option",
      "spec",
      "components",
      "caution",
    ]);
    expect(fields.filter((field) => PRICE_LIKE.test(`${field.key} ${field.label}`))).toEqual([]);
    const raw = JSON.stringify(stored);
    expect(raw).not.toContain("data:image");
    expect(raw).not.toContain("[조각");
    expect(raw).not.toContain("39,000");

    await expectNoBlockingAxe(page);

    // 새로 고쳐도 남는다.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "요청 상세" })).toBeVisible();
    await expect(chip(page, 0)).toHaveText("캡처 읽음 · 확인 전");
    await expect(chip(page, 1)).toHaveText("캡처 필요");

    // 내려놓으면 초안이 지워진다.
    await page.getByRole("button", { name: "내려놓기" }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    expect(await storedDraft(page)).toBeNull();
    await page.context().close();
  });

  test("2. 후보 2의 '쇼핑몰에서 보기' → 캡처 2장을 후보 2에 저장 → 경고 → 후보 3으로 바꾸기, 새로 고쳐도 유지", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);

    // 후보 2의 쇼핑몰 링크(새 탭은 닫는다)가 마지막으로 연 후보다.
    const popupPromise = page.waitForEvent("popup");
    await page.locator(".vol-cand").nth(1).getByRole("link", { name: "쇼핑몰에서 보기" }).click();
    await (await popupPromise).close();

    await openAgent(page);
    const dialog = agentDialog(page);
    await expect(
      dialog.getByRole("button", { name: "캡처 올리기 · 후보 2에 저장" }),
    ).toBeVisible();
    let extractCalls = 0;
    await page.route("**/api/volunteer/extract-text", async (route) => {
      extractCalls += 1;
      await route.fallback();
    });
    const first = await makeSyntheticDetailImage(page, { height: 1500, noise: false });
    const second = await makeSyntheticDetailImage(page, { height: 900, noise: false });
    await captureInput(page).setInputFiles([png("a.png", first), png("b.png", second)]);

    const notice = savedNotice(page);
    await expect(notice).toContainText("캡처 2장을 후보 2에 저장했습니다", { timeout: 60_000 });
    await expect(notice).toContainText(SAVED_HINT);
    await expect(notice).toContainText(MISMATCH_C2);
    // 두 장 모두 조각으로 나뉘어 읽혔다(조각 수는 이미지 크기가 정한다).
    expect(extractCalls).toBeGreaterThanOrEqual(2);
    await expect(chip(page, 1)).toHaveText("캡처 읽음 · 확인 전");
    await expect(chip(page, 0)).toHaveText("캡처 필요");
    await expect(chip(page, 2)).toHaveText("캡처 필요");

    // 스크린샷: 첫 안내 + 캡처 저장 알림 + 캡처 올리기 버튼이 한 화면에 보이게(알림이 보이도록 맨 아래로).
    await page.waitForTimeout(250);
    await dialog.locator(".vol-sheet-body").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.screenshot({ path: "test-results/volunteer-capture.png" });

    // 다른 후보로 바꾸기: 후보 3을 고르면 초안이 옮겨 가고, 경고는 새 후보 기준으로 바뀐다.
    const toggle = notice.getByRole("button", { name: "다른 후보로 바꾸기" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const choices = notice.getByRole("button", { name: /^후보 \d+ · / });
    await expect(choices).toHaveText(["후보 1 · 소니 WH-CH720N", "후보 3 · 소니 WH-1000XM4"]);
    await choices.nth(1).click();
    await expect(notice).toContainText("캡처 2장을 후보 3에 저장했습니다");
    await expect(notice).toContainText(MISMATCH_C3);
    await expect(notice).not.toContainText("후보 2에 저장했습니다");
    await expect(toggle).toBeFocused();
    await expect(chip(page, 2)).toHaveText("캡처 읽음 · 확인 전");
    await expect(chip(page, 1)).toHaveText("캡처 필요");
    await expect(chip(page, 0)).toHaveText("캡처 필요");
    await expectNoBlockingAxe(page);

    // 새로 고쳐도 유지된다. 초안은 후보 3에만 있다.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "요청 상세" })).toBeVisible();
    await expect(chip(page, 2)).toHaveText("캡처 읽음 · 확인 전");
    await expect(chip(page, 1)).toHaveText("캡처 필요");
    const stored = (await storedDraft(page)) as {
      lastOpened: string | null;
      drafts: Record<string, { captureCount: number }>;
    };
    expect(Object.keys(stored.drafts)).toEqual(["c3"]);
    expect(stored.drafts.c3.captureCount).toBe(2);
    expect(stored.lastOpened).toBe("c2");
    await page.context().close();
  });

  test("3. 읽은 상품명이 후보와 같으면 경고가 없고, 상품명을 읽지 못하면 어느 후보인지 묻는다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    let name: string | null = "소니 WH-CH720N 블랙";
    await page.route("**/api/volunteer/summarize", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeSummary(name)),
      }),
    );
    await openAgent(page);
    const dialog = agentDialog(page);
    const image = await makeSyntheticDetailImage(page, { height: 900, noise: false });

    // 같다(후보 1 이름을 품는다): 경고 없이 저장만.
    await captureInput(page).setInputFiles(png("a.png", image));
    await expect(savedNotice(page)).toContainText("캡처 1장을 후보 1에 저장했습니다", { timeout: 30_000 });
    await expect(savedNotice(page)).not.toContainText("다릅니다");
    await expect(savedNotice(page)).not.toContainText("읽지 못했습니다");
    await expect(dialogStatus(page)).not.toContainText("다릅니다");
    await expect(chip(page, 0)).toHaveText("캡처 읽음 · 확인 전");

    // 읽지 못했다: 후보를 고르게 한다(후보 2에 저장, 경고 문구가 나온다).
    name = null;
    await expect(dialog.getByRole("button", { name: "캡처 올리기 · 후보 2에 저장" })).toBeVisible();
    await captureInput(page).setInputFiles(png("b.png", image));
    await expect(savedNotice(page)).toContainText("캡처 1장을 후보 2에 저장했습니다", { timeout: 30_000 });
    await expect(savedNotice(page)).toContainText(
      "상품명을 읽지 못했습니다. 어느 후보의 캡처인지 골라 주세요.",
    );
    await expect(dialogStatus(page)).toContainText("어느 후보의 캡처인지 골라 주세요");
    await expect(savedNotice(page).getByRole("button", { name: "다른 후보로 바꾸기" })).toBeVisible();
    await expect(chip(page, 1)).toHaveText("캡처 읽음 · 확인 전");
    await page.context().close();
  });

  test("4. 같은 조각이 3회 실패하면 직접 입력 칸이 열리고, 그 글로 같은 모양의 초안을 만든다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyDetail(browser, baseURL);
    let failedAttempts = 0;
    await page.route("**/api/volunteer/extract-text", async (route) => {
      if (route.request().postDataJSON().pieceIndex === 1) {
        failedAttempts += 1;
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "extract_failed" }),
        });
        return;
      }
      await route.fallback();
    });
    let summarizeBody: { source?: string } | null = null;
    await page.route("**/api/volunteer/summarize", async (route) => {
      summarizeBody = route.request().postDataJSON();
      await route.fallback();
    });

    await openAgent(page);
    const buffer = await makeSyntheticDetailImage(page, { noise: false });
    await captureInput(page).setInputFiles(png("synthetic.png", buffer));
    await expect(dialogStatus(page)).toHaveText(
      "이미지에서 글자를 읽지 못했습니다. 상세 내용을 직접 입력하세요.",
      { timeout: 60_000 },
    );
    expect(failedAttempts).toBe(3);
    const manual = agentDialog(page).getByRole("textbox", { name: "상세 내용을 직접 입력" });
    await expect(manual).toBeFocused();
    // 아직 초안이 없다.
    await expect(chip(page, 0)).toHaveText("캡처 필요");
    expect(await storedDraft(page)).toBeNull();

    // 빈 글은 안내만 한다.
    await agentDialog(page).getByRole("button", { name: "이 글로 요약" }).click();
    await expect(dialogStatus(page)).toHaveText("요약할 글을 입력하세요.");
    await expect(manual).toBeFocused();

    await manual.fill(MANUAL_TEXT);
    await agentDialog(page).getByRole("button", { name: "이 글로 요약" }).click();
    await expect(savedNotice(page)).toContainText("캡처 1장을 후보 1에 저장했습니다", { timeout: 30_000 });
    expect(summarizeBody).toMatchObject({ source: "manual" });
    await expect(manual).toHaveCount(0);
    await expect(chip(page, 0)).toHaveText("캡처 읽음 · 확인 전");
    const stored = (await storedDraft(page)) as {
      drafts: Record<string, { draft: { source: string; fields: unknown[] } }>;
    };
    expect(stored.drafts.c1.draft.source).toBe("manual");
    expect(stored.drafts.c1.draft.fields).toHaveLength(5);
    // 직접 입력한 글 원문은 기기에 저장하지 않는다(초안의 근거 한 줄만 있다).
    expect(JSON.stringify(stored)).not.toContain("색상 옵션: 블랙, 화이트\n주의");
    await expectNoBlockingAxe(page);
    await page.context().close();
  });

  for (const [status, message] of [
    [413, "이미지 조각이 너무 큽니다. 상세 내용을 직접 입력하세요."],
    [415, "이미지 형식을 읽을 수 없습니다. 상세 내용을 직접 입력하세요."],
    [503, "글자 읽기 설정이 끝나지 않았습니다. 상세 내용을 직접 입력하세요."],
  ] as const) {
    test(`5-${status}. 글자 읽기가 ${status}이면 안내하고 직접 입력 칸을 연다`, async ({ browser, baseURL }) => {
      const page = await openSonyDetail(browser, baseURL);
      let calls = 0;
      await page.route("**/api/volunteer/extract-text", (route) => {
        calls += 1;
        return route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "x" }),
        });
      });
      await openAgent(page);
      const buffer = await makeSyntheticDetailImage(page, { height: 1500, noise: false });
      await captureInput(page).setInputFiles(png("synthetic.png", buffer));
      await expect(dialogStatus(page)).toHaveText(message);
      await expect(
        agentDialog(page).getByRole("textbox", { name: "상세 내용을 직접 입력" }),
      ).toBeFocused();
      // 다시 시도해도 소용없는 상태라 한 번만 불렀다.
      expect(calls).toBe(1);
      await page.context().close();
    });
  }

  test("6. 입장 정보(401)가 사라지면 입장 확인 화면으로 돌아간다", async ({ browser, baseURL }) => {
    const page = await openSonyDetail(browser, baseURL);
    await page.route("**/api/volunteer/extract-text", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "unauthorized" }),
      }),
    );
    await openAgent(page);
    const buffer = await makeSyntheticDetailImage(page, { height: 900, noise: false });
    await captureInput(page).setInputFiles(png("synthetic.png", buffer));
    await expect(page).toHaveURL(/\/volunteer$/);
    await page.context().close();
  });

  test("7. 후보가 0개면 캡처 올리기가 잠기고 '후보를 먼저 추가해 주세요'가 나온다. 후보를 추가하면 열린다", async ({
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

    await openAgent(page);
    const dialog = agentDialog(page);
    const locked = dialog.getByRole("button", { name: "캡처 올리기", exact: true });
    await expect(locked).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByText("후보를 먼저 추가해 주세요")).toBeVisible();
    await expect(locked).toHaveAccessibleDescription("후보를 먼저 추가해 주세요");
    await dialog.getByRole("button", { name: "닫기" }).click();

    await page.getByLabel("상품명").fill("직접 찾은 헤드셋");
    await page.getByLabel("구매 링크").fill("https://shop.example/p/1");
    await page.getByRole("button", { name: "후보 추가" }).click();
    await expect(page.locator(".vol-cand")).toHaveCount(1);
    await expect(chip(page, 0)).toHaveText("캡처 필요");

    await openAgent(page);
    await expect(
      agentDialog(page).getByRole("button", { name: "캡처 올리기 · 후보 1에 저장" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await page.context().close();
  });

  test("8. 이용자 화면 코드는 봉사자 API를 부르지 않는다(역할 분리)", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/volunteer")) requested.push(request.url());
    });
    await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "LightHouse" })).toBeVisible();
    expect(requested).toEqual([]);

    const root = path.resolve(__dirname, "../../src");
    for (const file of [
      "app/page.tsx",
      "components/SpeechInput.tsx",
      "components/DemoHandoff.tsx",
      "lib/speech.ts",
      "lib/matchHandoff.ts",
    ]) {
      expect(readFileSync(path.join(root, file), "utf8")).not.toContain("/api/volunteer");
    }
  });
});
