import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  fail,
  installFakeSpeech,
  never,
  recognitionConfig,
  removeSpeechApi,
  say,
  startCount,
} from "./helpers/fakeSpeech";

// 전부 가짜 음성 입력 기준이다. 실제 음성 인식과 VoiceOver 낭독은 사람이 판정한다.

const PASS_SENTENCE = "sony껄로 헤드셋 사고싶어";
const FALLBACK_STATUS =
  "음성 인식을 쓸 수 없습니다. 입력창에 받아쓰기로 입력하세요.";

const speechButton = (page: Page) =>
  page.getByRole("button", { name: "눌러서 말하기" });
const confirmButton = (page: Page) =>
  page.getByRole("button", { name: "이대로 요청" });
const respeakButton = (page: Page) =>
  page.getByRole("button", { name: "다시 말하기" });
const textInput = (page: Page) => page.getByRole("textbox", { name: "찾는 상품" });
const status = (page: Page) => page.getByRole("status");

async function expectNoBlockingAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking).toEqual([]);
}

async function expectFellBackToInput(page: Page) {
  await expect(status(page)).toHaveText(FALLBACK_STATUS);
  await expect(textInput(page)).toBeFocused();
  await expect(textInput(page)).toHaveAttribute("lang", "ko");
  await expect(speechButton(page)).toHaveCount(0);
}

/** /api/match 응답을 주지 않아 "찾고 있습니다" 상태에 머물게 하고, 보낸 본문을 모은다. */
async function holdMatchResponse(page: Page) {
  const sent: unknown[] = [];
  await page.route("**/api/match", (route) => {
    sent.push(route.request().postDataJSON());
  });
  return sent;
}

async function hearSentence(page: Page, sentence: string) {
  await speechButton(page).click();
  await expect(status(page)).toHaveText("듣고 있습니다. 말씀하세요.");
  await say(page, sentence);
  await expect(status(page)).toHaveText(`이렇게 들었습니다: ${sentence}`);
}

test.describe("음성 API가 있을 때", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeSpeech(page);
    await page.goto("/");
  });

  test("첫 화면: 제목에 초점, 음성 버튼만, 시작은 누를 때만", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page).toHaveTitle("상품 요청 - LightHouse");
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(speechButton(page)).toBeVisible();
    await expect(textInput(page)).toHaveCount(0);
    await expect(status(page)).toBeEmpty();
    expect(await startCount(page)).toBe(0);
    await expectNoBlockingAxe(page);
    await page.screenshot({ path: "test-results/user-first-screen.png" });
  });

  test("음성 버튼이 제목 아래 남는 영역을 채운다", async ({ page }) => {
    const button = await speechButton(page).boundingBox();
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
    const viewport = page.viewportSize();
    expect(button && heading && viewport).toBeTruthy();
    if (!button || !heading || !viewport) return;
    expect(button.y).toBeGreaterThan(heading.y + heading.height - 1);
    expect(button.height).toBeGreaterThan(viewport.height * 0.6);
    expect(button.y + button.height).toBeGreaterThan(viewport.height - 40);
  });

  test("화면 확대를 막지 않는다", async ({ page }) => {
    const viewport = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });

  test("합격 문장: 설정, 확인 단계, 초점, 바로 보내지 않음", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await hearSentence(page, PASS_SENTENCE);

    expect(await recognitionConfig(page)).toEqual({
      lang: "ko-KR",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
    });
    await expect(page.getByText(PASS_SENTENCE, { exact: true })).toBeVisible();
    await expect(confirmButton(page)).toBeFocused();
    await expect(respeakButton(page)).toBeVisible();
    await expectNoBlockingAxe(page);
    expect(requests.filter((url) => url.includes("/api/"))).toEqual([]);
  });

  for (const sentence of ["sony 헤드셋", "소니 헤드셋", "쏘니 헤드셋", "소니껄로 헤드셋"]) {
    test(`표기 변형을 그대로 확인 단계에 보인다: ${sentence}`, async ({ page }) => {
      await hearSentence(page, sentence);
      await expect(confirmButton(page)).toBeFocused();
    });
  }

  test("다시 말하기: 이전 문장을 지우고 새 문장을 확인한다", async ({ page }) => {
    await hearSentence(page, "처음 문장");
    await respeakButton(page).click();

    await expect(page.getByText("처음 문장", { exact: true })).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);
    await expect(speechButton(page)).toBeFocused();
    await expect(status(page)).toHaveText("듣고 있습니다. 말씀하세요.");
    await say(page, PASS_SENTENCE);

    await expect(status(page)).toHaveText(`이렇게 들었습니다: ${PASS_SENTENCE}`);
    await expect(confirmButton(page)).toBeFocused();
    expect(await startCount(page)).toBe(2);
  });

  test("이대로 요청: 찾는 중 안내, 초점 유지, 문장을 한 번만 보낸다", async ({
    page,
  }) => {
    const sent = await holdMatchResponse(page);
    await hearSentence(page, PASS_SENTENCE);

    await confirmButton(page).click();

    await expect(status(page)).toHaveText("봉사자를 찾고 있습니다.");
    await expect(confirmButton(page)).toBeFocused();
    await expect(confirmButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => sent).toEqual([{ text: PASS_SENTENCE }]);

    // aria-disabled라 Playwright의 click은 기다리기만 하므로 이벤트를 직접 보낸다.
    await confirmButton(page).dispatchEvent("click");
    await page.waitForTimeout(200);
    expect(sent).toHaveLength(1);
  });

  for (const code of [
    "not-allowed",
    "service-not-allowed",
    "audio-capture",
    "network",
  ]) {
    test(`${code} → 입력창 전환과 초점`, async ({ page }) => {
      await speechButton(page).click();
      await fail(page, code);
      await expectFellBackToInput(page);
    });
  }

  test("3초 무응답(never) → 입력창 전환과 초점", async ({ page }) => {
    await never(page);
    await speechButton(page).click();
    // 시작 지연 1초 + 무응답 3초 전에는 바뀌지 않는다.
    await page.waitForTimeout(2000);
    await expect(speechButton(page)).toBeVisible();
    await expectFellBackToInput(page);
  });

  for (const code of ["no-speech", "nomatch"]) {
    test(`${code} 1회는 다시 시도, 2회 연속이면 입력창`, async ({ page }) => {
      await speechButton(page).click();
      await fail(page, code);
      await expect(status(page)).toHaveText(
        "못 들었습니다. 버튼을 눌러 다시 말씀하세요.",
      );
      await expect(speechButton(page)).toBeFocused();
      await expect(textInput(page)).toHaveCount(0);

      await speechButton(page).click();
      await fail(page, code);
      await expectFellBackToInput(page);
    });
  }

  test("못 들은 뒤 인식에 성공하면 연속 횟수를 다시 센다", async ({ page }) => {
    await speechButton(page).click();
    await fail(page, "no-speech");
    await expect(status(page)).toHaveText(/^못 들었습니다/);

    await hearSentence(page, "처음 문장");
    await respeakButton(page).click();
    await fail(page, "no-speech");

    await expect(status(page)).toHaveText(/^못 들었습니다/);
    await expect(textInput(page)).toHaveCount(0);
  });

  test("입력창: 빈 값은 안내, 입력하면 요청 상태로", async ({ page }) => {
    await speechButton(page).click();
    await fail(page, "not-allowed");
    await expectFellBackToInput(page);
    await expectNoBlockingAxe(page);

    await confirmButton(page).click();
    await expect(status(page)).toHaveText("입력창에 찾는 상품을 입력하세요.");
    await expect(textInput(page)).toBeFocused();

    await holdMatchResponse(page);
    await textInput(page).fill(PASS_SENTENCE);
    await confirmButton(page).click();
    await expect(status(page)).toHaveText("봉사자를 찾고 있습니다.");
    await expect(textInput(page)).toHaveValue(PASS_SENTENCE);
  });

  test("눌림 영역이 모두 44px 이상이다", async ({ page }) => {
    await hearSentence(page, PASS_SENTENCE);
    for (const locator of [confirmButton(page), respeakButton(page)]) {
      const box = await locator.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("이용자 화면에 챗봇 UI가 없다", async ({ page }) => {
    await expect(page.getByText(/챗봇|찾는 가이드|AI 조언/)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
    await hearSentence(page, PASS_SENTENCE);
    await expect(page.getByText(/챗봇|찾는 가이드|AI 조언/)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
  });
});

test("음성 API 없음 → 입력창 전환과 초점", async ({ page }) => {
  await removeSpeechApi(page);
  await page.goto("/");
  await expectFellBackToInput(page);
  await expectNoBlockingAxe(page);
  const box = await textInput(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
