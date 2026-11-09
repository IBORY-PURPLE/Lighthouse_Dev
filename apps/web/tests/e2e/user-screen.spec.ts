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
import { answerFlowA, DEFAULT_ANSWERS } from "./helpers/flowA";

// 전부 가짜 음성 입력 기준이다. 실제 음성 인식과 VoiceOver 낭독은 사람이 판정한다.
// 플로우 A(PR 1): 시작하기 → 질문 1/3·2/3·3/3 → 요약 → 봉사자 매칭 요청.
// 기존 한 문장 요청 시험은 질문 1 기준으로 옮겼다(흐름 변경, PR 본문 "시험 변경").

const PASS_SENTENCE = "sony껄로 헤드셋 사고싶어";
const FALLBACK_STATUS =
  "음성 인식을 쓸 수 없습니다. 입력창에 받아쓰기로 입력하세요.";
const NEED_PRODUCT_STATUS =
  "어떤 제품인지 알아듣지 못했습니다. 제품 이름을 넣어 다시 말씀하세요.";

const startButton = (page: Page) =>
  page.getByRole("button", { name: "시작하기" });
const speechButton = (page: Page) =>
  page.getByRole("button", { name: "눌러서 말하기" });
const nextButton = (page: Page) =>
  page.getByRole("button", { name: "다음 질문" });
const doneButton = (page: Page) => page.getByRole("button", { name: "완료" });
const respeakButton = (page: Page) =>
  page.getByRole("button", { name: "다시 말하기" });
const reenterButton = (page: Page) =>
  page.getByRole("button", { name: "다시 입력" });
const matchButton = (page: Page) =>
  page.getByRole("button", { name: "봉사자 매칭 요청" });
const productInput = (page: Page) =>
  page.getByRole("textbox", { name: "찾는 제품" });
const budgetInput = (page: Page) => page.getByRole("textbox", { name: "예산" });
const conditionInput = (page: Page) =>
  page.getByRole("textbox", { name: "새 제품 또는 중고" });
const status = (page: Page) => page.getByRole("status");
const questionHeading = (page: Page, n: 1 | 2 | 3) =>
  page.getByRole("heading", { level: 2, name: new RegExp(`^질문 ${n}/3`) });
const summaryHeading = (page: Page) =>
  page.getByRole("heading", { level: 2, name: "요청 내용" });

/** 이용자 화면(intro·질문·요약)은 영향도와 무관하게 axe 위반 0건이어야 한다. */
async function expectNoBlockingAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
    })),
  ).toEqual([]);
}

async function expectTouchTargets(page: Page) {
  const buttons = page.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
}

async function expectFellBackToInput(page: Page) {
  await expect(status(page)).toHaveText(FALLBACK_STATUS);
  await expect(productInput(page)).toBeFocused();
  await expect(productInput(page)).toHaveAttribute("lang", "ko");
  await expect(speechButton(page)).toHaveCount(0);
}

/**
 * 이 시점 뒤의 모든 네트워크 요청(주소 종류 무관)을 page.route로 모은다.
 * /api/match는 응답하지 않아 "찾고 있습니다"에 머물게 하고, 나머지는 그대로 보낸다.
 */
async function recordApi(page: Page) {
  const calls: { url: string; body: unknown }[] = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    calls.push({ url: request.url(), body: request.postDataJSON() });
    if (!request.url().includes("/api/match")) return route.continue();
  });
  return calls;
}

async function startQuestions(page: Page) {
  await startButton(page).click();
  await expect(questionHeading(page, 1)).toBeFocused();
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

  test("첫 화면: 제목에 초점, 안내와 시작하기만, 듣기는 시작하지 않음", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page).toHaveTitle("상품 요청 - LightHouse");
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByText(
        "질문 3개에 답하면 봉사자에게 요청을 보냅니다. 답하는 동안에는 아무것도 보내지 않습니다.",
      ),
    ).toBeVisible();
    await expect(startButton(page)).toBeVisible();
    await expect(speechButton(page)).toHaveCount(0);
    await expect(productInput(page)).toHaveCount(0);
    await expect(status(page)).toBeEmpty();
    expect(await startCount(page)).toBe(0);
    await expectNoBlockingAxe(page);
    await expectTouchTargets(page);
    await page.screenshot({ path: "test-results/user-first-screen.png" });
  });

  test("시작하기: 질문 1 제목에 초점, 음성 버튼, 시작은 누를 때만", async ({
    page,
  }) => {
    await startQuestions(page);
    await expect(questionHeading(page, 1)).toHaveText(
      "질문 1/3. 어떤 제품을 찾으세요?",
    );
    await expect(speechButton(page)).toBeVisible();
    await expect(productInput(page)).toHaveCount(0);
    await expect(status(page)).toBeEmpty();
    expect(await startCount(page)).toBe(0);
    await expectNoBlockingAxe(page);
    await expectTouchTargets(page);
    await page.screenshot({ path: "test-results/user-question-1.png" });
  });

  test("음성 버튼이 질문 아래 남는 영역을 채운다", async ({ page }) => {
    await startQuestions(page);
    const button = await speechButton(page).boundingBox();
    const heading = await questionHeading(page, 1).boundingBox();
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

  test("합격 문장: 설정, 확인 단계, 초점, 바로 넘어가지 않음", async ({
    page,
  }) => {
    const calls = await recordApi(page);
    await startQuestions(page);

    await hearSentence(page, PASS_SENTENCE);

    expect(await recognitionConfig(page)).toEqual({
      lang: "ko-KR",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
    });
    await expect(page.getByText(PASS_SENTENCE, { exact: true })).toBeVisible();
    await expect(nextButton(page)).toBeFocused();
    await expect(respeakButton(page)).toBeVisible();
    await expect(questionHeading(page, 1)).toBeVisible();
    await expectNoBlockingAxe(page);
    await expectTouchTargets(page);
    expect(calls).toEqual([]);
  });

  for (const sentence of ["sony 헤드셋", "소니 헤드셋", "쏘니 헤드셋", "소니껄로 헤드셋"]) {
    test(`표기 변형을 그대로 확인 단계에 보인다: ${sentence}`, async ({ page }) => {
      await startQuestions(page);
      await hearSentence(page, sentence);
      await expect(nextButton(page)).toBeFocused();
    });
  }

  test("다시 말하기: 이전 문장을 지우고 새 문장을 확인한다", async ({ page }) => {
    await startQuestions(page);
    await hearSentence(page, "처음 문장");
    await respeakButton(page).click();

    await expect(page.getByText("처음 문장", { exact: true })).toHaveCount(0);
    await expect(nextButton(page)).toHaveCount(0);
    await expect(speechButton(page)).toBeFocused();
    await expect(status(page)).toHaveText("듣고 있습니다. 말씀하세요.");
    await say(page, PASS_SENTENCE);

    await expect(status(page)).toHaveText(`이렇게 들었습니다: ${PASS_SENTENCE}`);
    await expect(nextButton(page)).toBeFocused();
    expect(await startCount(page)).toBe(2);
  });

  test("질문 1 품목 없음: 넘어가지 않고 안내, 말하기 버튼에 초점", async ({
    page,
  }) => {
    const calls = await recordApi(page);
    await startQuestions(page);
    await hearSentence(page, "sony껄로 사고싶어");
    await nextButton(page).click();

    await expect(status(page)).toHaveText(NEED_PRODUCT_STATUS);
    await expect(questionHeading(page, 1)).toBeVisible();
    await expect(questionHeading(page, 2)).toHaveCount(0);
    await expect(speechButton(page)).toBeFocused();
    await expectNoBlockingAxe(page);

    await hearSentence(page, PASS_SENTENCE);
    await nextButton(page).click();
    await expect(questionHeading(page, 2)).toBeFocused();
    expect(calls).toEqual([]);
  });

  test("세 질문을 차례로: 다음 질문·완료, 요약에 세 답, 답하는 동안 요청 없음", async ({
    page,
  }) => {
    const calls = await recordApi(page);
    await startQuestions(page);

    await hearSentence(page, DEFAULT_ANSWERS.product);
    await nextButton(page).click();
    await expect(questionHeading(page, 2)).toBeFocused();
    await expect(questionHeading(page, 2)).toHaveText(
      "질문 2/3. 예산은 얼마인가요?",
    );
    await expect(status(page)).toBeEmpty();
    await expectNoBlockingAxe(page);

    await hearSentence(page, DEFAULT_ANSWERS.budget);
    await expect(nextButton(page)).toBeFocused();
    await nextButton(page).click();
    await expect(questionHeading(page, 3)).toBeFocused();
    await expect(questionHeading(page, 3)).toHaveText(
      "질문 3/3. 새 제품과 중고 중 무엇을 원하세요?",
    );
    await expectNoBlockingAxe(page);

    await hearSentence(page, DEFAULT_ANSWERS.condition);
    await expect(doneButton(page)).toBeFocused();
    await expect(nextButton(page)).toHaveCount(0);
    await expectTouchTargets(page);
    await doneButton(page).click();

    await expect(summaryHeading(page)).toBeFocused();
    const list = page.locator(".flow-summary li");
    await expect(list).toHaveText([
      `찾는 제품: ${DEFAULT_ANSWERS.product}`,
      `예산: ${DEFAULT_ANSWERS.budget}`,
      `새 제품 또는 중고: ${DEFAULT_ANSWERS.condition}`,
    ]);
    await expect(status(page)).toHaveText(
      `요청 내용입니다. 제품 ${DEFAULT_ANSWERS.product}. 예산 ${DEFAULT_ANSWERS.budget}. ${DEFAULT_ANSWERS.condition}. 맞으면 봉사자 매칭 요청 버튼을 누르세요.`,
    );
    await expect(matchButton(page)).toBeVisible();
    await expectNoBlockingAxe(page);
    await expectTouchTargets(page);
    await page.screenshot({ path: "test-results/user-summary.png" });
    expect(calls).toEqual([]);
  });

  test("봉사자 매칭 요청: 찾는 중 안내, 초점 유지, 제품 답을 한 번만 보낸다", async ({
    page,
  }) => {
    const calls = await recordApi(page);
    await answerFlowA(page);
    expect(calls).toEqual([]);

    await matchButton(page).click();

    await expect(status(page)).toHaveText("봉사자를 찾고 있습니다.");
    await expect(matchButton(page)).toBeFocused();
    await expect(matchButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect
      .poll(() => calls.map((call) => call.body))
      .toEqual([{ text: DEFAULT_ANSWERS.product }]);
    expect(new URL(calls[0].url).pathname).toBe("/api/match");

    // aria-disabled라 Playwright의 click은 기다리기만 하므로 이벤트를 직접 보낸다.
    await matchButton(page).dispatchEvent("click");
    await page.waitForTimeout(200);
    expect(calls).toHaveLength(1);
  });

  for (const code of [
    "not-allowed",
    "service-not-allowed",
    "audio-capture",
    "network",
  ]) {
    test(`${code} → 입력창 전환과 초점`, async ({ page }) => {
      await startQuestions(page);
      await speechButton(page).click();
      await fail(page, code);
      await expectFellBackToInput(page);
    });
  }

  test("3초 무응답(never) → 입력창 전환과 초점", async ({ page }) => {
    await startQuestions(page);
    await never(page);
    await speechButton(page).click();
    // 시작 지연 1초 + 무응답 3초 전에는 바뀌지 않는다.
    await page.waitForTimeout(2000);
    await expect(speechButton(page)).toBeVisible();
    await expectFellBackToInput(page);
  });

  for (const code of ["no-speech", "nomatch"]) {
    test(`${code} 1회는 다시 시도, 2회 연속이면 입력창`, async ({ page }) => {
      await startQuestions(page);
      await speechButton(page).click();
      await fail(page, code);
      await expect(status(page)).toHaveText(
        "못 들었습니다. 버튼을 눌러 다시 말씀하세요.",
      );
      await expect(speechButton(page)).toBeFocused();
      await expect(productInput(page)).toHaveCount(0);

      await speechButton(page).click();
      await fail(page, code);
      await expectFellBackToInput(page);
    });
  }

  test("못 들은 뒤 인식에 성공하면 연속 횟수를 다시 센다", async ({ page }) => {
    await startQuestions(page);
    await speechButton(page).click();
    await fail(page, "no-speech");
    await expect(status(page)).toHaveText(/^못 들었습니다/);

    await hearSentence(page, "처음 문장");
    await respeakButton(page).click();
    await fail(page, "no-speech");

    await expect(status(page)).toHaveText(/^못 들었습니다/);
    await expect(productInput(page)).toHaveCount(0);
  });

  test("입력창: 빈 값은 안내, 입력한 답도 확인 단계, 다시 입력, 다음 질문도 입력창", async ({
    page,
  }) => {
    const calls = await recordApi(page);
    await startQuestions(page);
    await speechButton(page).click();
    await fail(page, "not-allowed");
    await expectFellBackToInput(page);
    await expectNoBlockingAxe(page);

    await nextButton(page).click();
    await expect(status(page)).toHaveText("입력창에 찾는 제품을 입력하세요.");
    await expect(productInput(page)).toBeFocused();

    await productInput(page).fill("처음 입력");
    await nextButton(page).click();
    await expect(status(page)).toHaveText("입력한 내용: 처음 입력");
    await expect(page.getByText("처음 입력", { exact: true })).toBeVisible();
    await expect(nextButton(page)).toBeFocused();
    await expect(reenterButton(page)).toBeVisible();
    await expect(respeakButton(page)).toHaveCount(0);
    await expect(questionHeading(page, 1)).toBeVisible();
    await expectNoBlockingAxe(page);
    await expectTouchTargets(page);

    await reenterButton(page).click();
    await expect(productInput(page)).toBeFocused();
    await expect(productInput(page)).toHaveValue("처음 입력");
    await productInput(page).fill(PASS_SENTENCE);
    await nextButton(page).click();
    await expect(status(page)).toHaveText(`입력한 내용: ${PASS_SENTENCE}`);
    await nextButton(page).click();

    await expect(questionHeading(page, 2)).toBeFocused();
    await expect(budgetInput(page)).toBeVisible();
    await expect(speechButton(page)).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test("질문 2에서 2회 못 들음 → 입력창 → 입력한 내용 → 질문 3은 입력창으로 시작", async ({
    page,
  }) => {
    const calls = await recordApi(page);
    await startQuestions(page);
    await hearSentence(page, DEFAULT_ANSWERS.product);
    await nextButton(page).click();
    await expect(questionHeading(page, 2)).toBeFocused();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await speechButton(page).click();
      await fail(page, "no-speech");
    }
    await expect(status(page)).toHaveText(FALLBACK_STATUS);
    await expect(budgetInput(page)).toBeFocused();

    await budgetInput(page).fill(DEFAULT_ANSWERS.budget);
    await nextButton(page).click();
    await expect(status(page)).toHaveText(
      `입력한 내용: ${DEFAULT_ANSWERS.budget}`,
    );
    await expect(nextButton(page)).toBeFocused();
    await nextButton(page).click();

    await expect(questionHeading(page, 3)).toBeFocused();
    await expect(conditionInput(page)).toBeVisible();
    await expect(speechButton(page)).toHaveCount(0);
    // 같은 폴백 안내를 질문마다 다시 읽지 않는다.
    await expect(status(page)).toBeEmpty();

    await conditionInput(page).fill(DEFAULT_ANSWERS.condition);
    await doneButton(page).click();
    await expect(status(page)).toHaveText(
      `입력한 내용: ${DEFAULT_ANSWERS.condition}`,
    );
    await expect(doneButton(page)).toBeFocused();
    await doneButton(page).click();

    await expect(summaryHeading(page)).toBeFocused();
    await expect(page.locator(".flow-summary li")).toHaveText([
      `찾는 제품: ${DEFAULT_ANSWERS.product}`,
      `예산: ${DEFAULT_ANSWERS.budget}`,
      `새 제품 또는 중고: ${DEFAULT_ANSWERS.condition}`,
    ]);
    expect(calls).toEqual([]);
  });

  test("질문 2의 200자 초과 답은 넘어가지 않는다", async ({ page }) => {
    await startQuestions(page);
    await hearSentence(page, DEFAULT_ANSWERS.product);
    await nextButton(page).click();
    await hearSentence(page, "가".repeat(201));
    await nextButton(page).click();

    await expect(status(page)).toHaveText(
      "답이 너무 깁니다. 짧게 다시 말씀하세요.",
    );
    await expect(questionHeading(page, 2)).toBeVisible();
    await expect(speechButton(page)).toBeFocused();
  });

  test("이용자 화면에 챗봇 UI가 없다", async ({ page }) => {
    await expect(page.getByText(/챗봇|찾는 가이드|AI 조언/)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
    await answerFlowA(page);
    await expect(page.getByText(/챗봇|찾는 가이드|AI 조언/)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
  });
});

test("음성 API 없음 → 입력창 전환과 초점", async ({ page }) => {
  await removeSpeechApi(page);
  await page.goto("/");
  await startButton(page).click();
  await expectFellBackToInput(page);
  await expectNoBlockingAxe(page);
  const box = await productInput(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
