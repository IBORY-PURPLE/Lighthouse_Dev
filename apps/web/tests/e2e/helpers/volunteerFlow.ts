import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, type Browser, type Page } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../../playwright.config";

// 봉사자 화면 v1(입장·목록·맡기) 시험 도우미. 컨텍스트마다 x-forwarded-for를 무작위로 해서
// 입장 횟수 제한(주소별 10분 10회)이 시험끼리 번지지 않게 한다.

export const FIRST_DEMO_QUOTE = "“소니 무선 헤드셋 사고 싶어요 · 30만 원 안쪽”";
export const DEMO_QUOTES = [
  FIRST_DEMO_QUOTE,
  "“세탁 세제 리필용 큰 것 · 2만 원 안쪽”",
  "“무선 키보드, 조용한 것 · 5만 원쯤”",
  "“전기포트 1.7리터 · 4만 원 안쪽”",
  "“엄마 쓰실 전기요, 싱글 사이즈 · 10만 원 안쪽”",
];
export const CLAIM_NAME = "이 요청 맡기";
export const LOCKED_TEXT = "맡은 요청을 끝내면 맡을 수 있어요";
export const REFILL_NAME = "시연용 요청 다시 채우기";

/** 새 기기(쿠키가 없는 브라우저 컨텍스트)에서 연 페이지. */
export async function openDevice(
  browser: Browser,
  baseURL: string | undefined,
): Promise<Page> {
  const context = await browser.newContext({
    ...devices["iPhone 15"],
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250)}-${randomUUID()}`,
    },
  });
  return context.newPage();
}

/** /volunteer를 열어 입장 코드(필요하면)와 별명으로 입장하고 대기열 화면까지 간다. */
export async function enterAs(
  page: Page,
  nickname = "민지",
  { needsCode = true }: { needsCode?: boolean } = {},
): Promise<void> {
  await page.goto("/volunteer");
  await expect(
    page.getByRole("heading", { level: 1, name: "봉사자 입장" }),
  ).toBeVisible();
  if (needsCode) {
    await page.getByLabel("입장 코드").fill(E2E_ACCESS_CODE);
    await expect(page.getByLabel("입장 코드")).toHaveValue(E2E_ACCESS_CODE);
  }
  await page.getByLabel("별명").fill(nickname);
  await expect(page.getByLabel("별명")).toHaveValue(nickname);
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "대기열" }),
  ).toBeVisible();
}

/** 시연용 요청 다시 채우기를 누르고 끝날 때까지 기다린다. */
export async function refill(page: Page): Promise<void> {
  await page.getByRole("button", { name: REFILL_NAME }).click();
  await expect(page.getByRole("status")).toHaveText(
    "시연용 요청을 새로 채웠어요",
  );
}

/** wcag2a·2aa·21aa 위반 중 critical·serious가 0건. */
export async function expectNoBlockingAxe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
  ).toEqual([]);
}

/** 화면 어디에도 남은 시간 글자("남음")가 없다. */
export async function expectNoRemaining(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("남음");
}
