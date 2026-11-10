import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech } from "./helpers/fakeSpeech";
import { completeFlowA, DEFAULT_ANSWERS, HANDOFF_NAME } from "./helpers/flowA";
import {
  E2E_VOLUNTEER_PASSWORD,
  E2E_VOLUNTEER_PHONE,
  fillLogin,
  loginVolunteer,
  VOLUNTEER_LOGIN_HEADING,
} from "./helpers/volunteerLogin";

// 전부 가짜 음성 입력, 가짜 답변(LLM_MODE=mock), 메모리 저장소, 가짜 계정 기준이다.
// 실제 아이폰 로그인과 실제 Groq 답변은 사람이 판정한다(B2).

const WRONG_PASSWORD = "wrong-test-only-password";
const HYPHEN_PHONE = "010-0000-0000";
const LOGIN_FAILED = "전화번호 또는 비밀번호가 올바르지 않습니다.";
const REGISTERED_NAME = "등록 봉사자";

const STORED_MATCH = {
  requestId: "6f1c2e4a-1111-4222-8333-444455556666",
  volunteer: { id: "vol-01", displayName: REGISTERED_NAME },
  request: { brand: "Sony", item: "헤드셋", raw: "sony껄로 헤드셋 사고싶어" },
};

const loginHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: VOLUNTEER_LOGIN_HEADING });
const volunteerHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "봉사자 화면(시연)" });
const phoneInput = (page: Page) => page.getByRole("textbox", { name: "전화번호" });
const passwordInput = (page: Page) => page.getByLabel("비밀번호");
const loginButton = (page: Page) => page.getByRole("button", { name: "로그인" });
const logoutButton = (page: Page) => page.getByRole("button", { name: "로그아웃" });
const askButton = (page: Page) =>
  page.getByRole("button", { name: "눌러서 질문하기" });
const handoffButton = (page: Page) =>
  page.getByRole("button", { name: HANDOFF_NAME });

const sessionCookies = (page: Page) =>
  page
    .context()
    .cookies()
    .then((cookies) => cookies.filter((cookie) => cookie.name === "lh_volunteer"));

/** 로그인은 주소마다 10분에 5번까지라 시험마다 다른 주소 값을 쓴다. */
async function setFreshClient(page: Page) {
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
}

async function expectNoBlockingAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
}

async function expectTouchTarget(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

/** 로그인 없이 이용자 화면에서 접수하고 "봉사자 화면으로(시연)"을 눌러 /volunteer까지 간다. */
async function handoffWithoutLogin(page: Page) {
  await setFreshClient(page);
  await installFakeSpeech(page);
  await page.context().clearCookies();
  await page.goto("/");
  await completeFlowA(page, DEFAULT_ANSWERS);
  await expect(handoffButton(page)).toBeVisible();

  const matchPromise = page.waitForResponse("**/api/match");
  await handoffButton(page).click();
  const match = await matchPromise;
  await expect(page).toHaveURL(/\/volunteer$/);
  return match;
}

test("로그인 안 하면 로그인 칸만 보인다", async ({ page }) => {
  await page.addInitScript((match) => {
    sessionStorage.setItem("lh.match.v1", JSON.stringify(match));
  }, STORED_MATCH);
  await page.goto("/volunteer");

  await expect(loginHeading(page)).toBeVisible();
  await expect(phoneInput(page)).toHaveAttribute("type", "tel");
  await expect(phoneInput(page)).toHaveAttribute("inputmode", "numeric");
  await expect(phoneInput(page)).toHaveAttribute("autocomplete", "username");
  await expect(passwordInput(page)).toHaveAttribute("type", "password");
  await expect(passwordInput(page)).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  // 봉사자 화면 코드와 요청 내용은 아예 그려지지 않는다.
  await expect(page.locator(".match-summary")).toHaveCount(0);
  await expect(askButton(page)).toHaveCount(0);
  await expect(page.getByText(STORED_MATCH.request.raw)).toHaveCount(0);

  await expectTouchTarget(phoneInput(page));
  await expectTouchTarget(passwordInput(page));
  await expectTouchTarget(loginButton(page));
  await expectNoBlockingAxe(page);
  await page.screenshot({ path: "test-results/volunteer-login.png" });
});

test("틀린 번호와 틀린 비밀번호는 같은 안내이고 쿠키가 없다", async ({ page }) => {
  await setFreshClient(page);
  await page.goto("/volunteer");

  const alerts: string[] = [];
  const attempts: [string, string][] = [
    ["010-0000-0001", E2E_VOLUNTEER_PASSWORD],
    [HYPHEN_PHONE, WRONG_PASSWORD],
  ];
  for (const [phone, password] of attempts) {
    const loginResponse = page.waitForResponse("**/api/auth/login");
    await fillLogin(page, phone, password);
    expect((await loginResponse).status()).toBe(401);
    // Next의 경로 안내 영역도 role=alert라 로그인 오류 문단만 고른다.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(LOGIN_FAILED);
    alerts.push((await alert.innerText()).trim());
    // 비밀번호 칸만 비워지고 다시 입력하게 초점이 간다.
    await expect(passwordInput(page)).toHaveValue("");
    await expect(passwordInput(page)).toBeFocused();
    expect(await sessionCookies(page)).toEqual([]);
  }
  expect(alerts[0]).toBe(alerts[1]);
  await expect(phoneInput(page)).toHaveValue(HYPHEN_PHONE);
  await expect(loginHeading(page)).toBeVisible();
});

test("쿠키 없이 접수와 이어 보기 매칭", async ({ page }) => {
  const match = await handoffWithoutLogin(page);
  expect(match.status()).toBe(200);
  expect((await match.json()).volunteer).toEqual({
    id: "vol-01",
    displayName: REGISTERED_NAME,
  });
  expect(await sessionCookies(page)).toEqual([]);
  await expect(loginHeading(page)).toBeVisible();
  await expect(askButton(page)).toHaveCount(0);
});

test("로그인하면 매칭과 챗봇, 연결된 봉사자는 등록 봉사자", async ({ page }) => {
  await handoffWithoutLogin(page);
  await expect(loginHeading(page)).toBeVisible();

  const loginResponse = page.waitForResponse("**/api/auth/login");
  // 하이픈 있는 번호도 받는다.
  await fillLogin(page, HYPHEN_PHONE, E2E_VOLUNTEER_PASSWORD);
  expect((await loginResponse).status()).toBe(200);

  await expect(volunteerHeading(page)).toBeVisible();
  await expect(volunteerHeading(page)).toBeFocused();
  await expect(
    page.getByText("연결된 봉사자", { exact: true }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText(REGISTERED_NAME);
  await expect(askButton(page)).toBeVisible();
  await expect(loginButton(page)).toHaveCount(0);
  expect(await sessionCookies(page)).toHaveLength(1);

  await expectTouchTarget(logoutButton(page));
  await expectNoBlockingAxe(page);
  await page.screenshot({ path: "test-results/volunteer-logged-in.png" });
});

test("로그아웃하면 로그인 칸으로 돌아가고 챗봇 API는 401이다", async ({ page }) => {
  await setFreshClient(page);
  await loginVolunteer(page);
  await page.addInitScript((match) => {
    sessionStorage.setItem("lh.match.v1", JSON.stringify(match));
  }, STORED_MATCH);
  await page.goto("/volunteer");
  await expect(volunteerHeading(page)).toBeVisible();

  const logoutResponse = page.waitForResponse("**/api/auth/logout");
  await logoutButton(page).click();
  expect((await logoutResponse).status()).toBe(200);

  await expect(loginHeading(page)).toBeVisible();
  await expect(askButton(page)).toHaveCount(0);
  expect(await sessionCookies(page)).toEqual([]);

  const chat = await page.request.post("/api/chat", {
    data: {
      requestId: STORED_MATCH.requestId,
      question: "sony 헤드셋 제품을 찾는 가이드 알려줘",
      context: { brand: "Sony", item: "헤드셋" },
    },
    headers: { "x-forwarded-for": `test-${randomUUID()}` },
  });
  expect(chat.status()).toBe(401);
  expect((await chat.json()).error).toBe("unauthorized");
});

test("같은 주소의 6번째 로그인 시도는 429이다", async ({ request }) => {
  const headers = { "x-forwarded-for": `limit-${randomUUID()}` };
  const post = () =>
    request.post("/api/auth/login", {
      headers,
      data: { phone: E2E_VOLUNTEER_PHONE, password: WRONG_PASSWORD },
    });

  for (let i = 0; i < 5; i += 1) {
    expect((await post()).status()).toBe(401);
  }
  const limited = await post();
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);

  // 다른 주소는 영향이 없다.
  const other = await request.post("/api/auth/login", {
    headers: { "x-forwarded-for": `limit-${randomUUID()}` },
    data: { phone: E2E_VOLUNTEER_PHONE, password: E2E_VOLUNTEER_PASSWORD },
  });
  expect(other.status()).toBe(200);
});

test("로그인 쿠키 속성(http): HttpOnly, SameSite=Lax, 7일, Secure 없음", async ({
  request,
}) => {
  const response = await request.post("/api/auth/login", {
    headers: { "x-forwarded-for": `cookie-${randomUUID()}` },
    data: { phone: E2E_VOLUNTEER_PHONE, password: E2E_VOLUNTEER_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const setCookie = response.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/^lh_volunteer=v1\.vol-01\./);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  expect(setCookie).toMatch(/Path=\//i);
  expect(setCookie).toContain("Max-Age=604800");
  expect(setCookie).not.toMatch(/Secure/i);
  expect(setCookie).not.toContain(E2E_VOLUNTEER_PASSWORD);
});
