import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";
import { makeSyntheticDetailImage, openVolunteer } from "./helpers/volunteer";

// ④ 올리기·요약. 전부 가짜 응답 기준이다(EXTRACT_MODE=mock, LLM_MODE=mock).
// 실제 엔진, 실제 캡처, 아이폰 canvas 한도, VoiceOver 낭독은 여기서 판정하지 않는다.

const STATUS = {
  reading: /^이미지 1\/\d+을 읽고 있습니다\.$/,
  arrived: "요약 초안이 도착했습니다. 항목 5개, 확인 필요 1개.",
  failed: "이미지에서 글자를 읽지 못했습니다. 상세 내용을 직접 입력하세요.",
  tooLarge: "이미지 조각이 너무 큽니다. 상세 내용을 직접 입력하세요.",
  badFormat: "이미지 형식을 읽을 수 없습니다. 상세 내용을 직접 입력하세요.",
};
const PRICE_LIKE = /price|가격|재고|할인|stock|discount/i;

const summaryStatus = (page: Page) => page.locator(".info-summary__status");
const upload = (page: Page) => page.getByLabel("상세 이미지 올리기");
const draftTitle = (page: Page) => page.getByRole("heading", { level: 3, name: "요약 초안" });
const manualInput = (page: Page) => page.getByRole("textbox", { name: "상세 내용" });
const fieldRow = (page: Page, label: string) =>
  page.locator(".info-summary__fields li", {
    has: page.locator(".info-summary__label", { hasText: label }),
  });

async function uploadLongImage(page: Page) {
  const buffer = await makeSyntheticDetailImage(page);
  // 서버 한도(4.5MB)보다 파일 자체가 크다. 그래서 조각으로 나눠야만 보낼 수 있다(C8).
  expect(buffer.length).toBeGreaterThan(4.5 * 1024 * 1024);
  await upload(page).setInputFiles({
    name: "synthetic-detail.png",
    mimeType: "image/png",
    buffer,
  });
  return buffer;
}

/** 봉사자 화면 axe 위반은 영향도와 상관없이 0건이어야 한다(위반 수를 출력에 남긴다). */
async function expectNoBlockingAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const byImpact = results.violations.map((violation) => `${violation.id}:${violation.impact}`);
  console.log(`axe 위반(전체 영향도): ${results.violations.length}건 ${byImpact.join(" ")}`);
  expect(results.violations).toEqual([]);
}

test.describe("④ 상세 이미지 올리기·요약(가짜 응답 기준)", () => {
  test.setTimeout(120_000);

  test("4.5MB보다 큰 긴 합성 이미지가 조각으로 순서대로 읽히고 초안이 도착한다", async ({
    page,
  }) => {
    await openVolunteer(page, { code: E2E_ACCESS_CODE });
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
      // 가짜 엔진은 너무 빨라 시작 안내를 확인하기 전에 끝난다. 조각마다 조금 늦춘다.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fallback();
    });

    let summarizeCalls = 0;
    await page.route("**/api/volunteer/summarize", async (route) => {
      summarizeCalls += 1;
      await route.fallback();
    });

    await uploadLongImage(page);
    await expect(summaryStatus(page)).toHaveText(STATUS.reading);
    await expect(summaryStatus(page)).toHaveText(STATUS.arrived, { timeout: 60_000 });
    await expect(draftTitle(page)).toBeFocused();

    // 860×4500 → 1,200px 조각, 겹침 100px → 4개, 순서대로 한 장씩.
    expect(posted.length).toBeGreaterThanOrEqual(3);
    expect(posted.map((p) => p.pieceIndex)).toEqual(posted.map((_, i) => i));
    expect(new Set(posted.map((p) => p.pieceCount))).toEqual(new Set([posted.length]));
    expect(posted.every((p) => p.bytes <= 1.5 * 1024 * 1024)).toBe(true);
    // 다 읽은 뒤 summarize는 한 번만 부른다.
    expect(summarizeCalls).toBe(1);

    // 항목 이름, 값, 확인 필요 여부 순서. 근거가 원문에 없는 항목은 "확인 안 됨".
    await expect(fieldRow(page, "상품명")).toContainText("가짜 헤드셋 LH-200");
    await expect(fieldRow(page, "핵심 사양")).toContainText("확인 안 됨");
    await expect(fieldRow(page, "핵심 사양")).not.toContainText("40시간");
    await expect(fieldRow(page, "구성품")).toContainText("이미지에서 못 찾음");
    await expect(page.locator(".info-summary__fields li")).toHaveCount(5);

    // 가격·재고·할인 항목은 초안 어디에도 없다(가짜 LLM은 일부러 가격 항목을 낸다).
    const labels = await page.locator(".info-summary__label").allTextContents();
    expect(labels.filter((label) => PRICE_LIKE.test(label))).toEqual([]);
    await expect(page.locator(".info-summary__draft")).not.toContainText("39,000");

    // 근거는 항목마다 펼쳐 본다.
    const evidence = fieldRow(page, "상품명").locator("details");
    await evidence.locator("summary").click();
    await expect(evidence).toContainText("상품명: 가짜 헤드셋 LH-200");

    await expect(page.locator(".info-summary__timing")).toContainText("올리기부터 초안까지");
    await expectNoBlockingAxe(page);
  });

  test("같은 조각이 3회 실패하면 입력창이 열리고, 그 글로 같은 모양의 초안을 받는다", async ({
    page,
  }) => {
    await openVolunteer(page, { code: E2E_ACCESS_CODE });
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

    const buffer = await makeSyntheticDetailImage(page, { noise: false });
    await upload(page).setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
    await expect(summaryStatus(page)).toHaveText(STATUS.failed, { timeout: 60_000 });
    expect(failedAttempts).toBe(3);
    await expect(manualInput(page)).toBeFocused();

    await manualInput(page).fill(
      "상품명: 가짜 헤드셋 LH-200\n색상 옵션: 블랙, 화이트\n주의: 물에 닿지 않게 하세요",
    );
    await page.getByRole("button", { name: "이 글로 요약" }).click();
    await expect(summaryStatus(page)).toHaveText(STATUS.arrived);
    await expect(draftTitle(page)).toBeFocused();
    expect(summarizeBody).toMatchObject({ source: "manual" });
    await expect(page.locator(".info-summary__fields li")).toHaveCount(5);
    await expect(fieldRow(page, "핵심 사양")).toContainText("확인 안 됨");
    await expectNoBlockingAxe(page);
  });

  test("텍스트 직접 입력 버튼은 이미지 없이도 항상 있다", async ({ page }) => {
    await openVolunteer(page, { code: E2E_ACCESS_CODE });
    await page.getByRole("button", { name: "텍스트 직접 입력" }).click();
    await expect(manualInput(page)).toBeFocused();
    await expectNoBlockingAxe(page);
  });

  for (const [status, message] of [
    [413, STATUS.tooLarge],
    [415, STATUS.badFormat],
  ] as const) {
    test(`글자 읽기 ${status} 응답이면 안내하고 입력창을 연다`, async ({ page }) => {
      await openVolunteer(page, { code: E2E_ACCESS_CODE });
      await page.route("**/api/volunteer/extract-text", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "x" }),
        }),
      );
      const buffer = await makeSyntheticDetailImage(page, { height: 1500, noise: false });
      await upload(page).setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
      await expect(summaryStatus(page)).toHaveText(message);
      await expect(manualInput(page)).toBeFocused();
    });
  }

  test("이용자 화면 코드는 봉사자 API를 부르지 않는다(역할 분리)", async ({ page }) => {
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
