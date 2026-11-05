import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";

test("첫 화면이 열리고 접근성 위반이 없다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "LightHouse" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking).toEqual([]);
});

test("/enter와 /api/health 접근 흐름", async ({ request }) => {
  const wrong = await request.get("/enter?code=wrong", { maxRedirects: 0 });
  expect(wrong.status()).toBe(401);

  const noCookie = await request.get("/api/health");
  expect(noCookie.status()).toBe(401);

  const right = await request.get(`/enter?code=${E2E_ACCESS_CODE}`, {
    maxRedirects: 0,
  });
  expect(right.status()).toBe(303);
  expect(right.headers()["location"]).toBe("/");

  const cookie = (right.headers()["set-cookie"] ?? "").split(";")[0];
  const health = await request.get("/api/health", {
    headers: { cookie },
  });
  expect(health.status()).toBe(200);
  expect((await health.json()).llmMode).toBe("mock");
});

test("브라우저로 맞는 코드를 열면 코드 없는 /로 이동하고 쿠키가 생긴다", async ({
  page,
  context,
}) => {
  await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
  await expect(page).toHaveURL(/\/$/);
  expect(page.url()).not.toContain(E2E_ACCESS_CODE);

  const cookies = await context.cookies();
  const access = cookies.find((cookie) => cookie.name === "lh_access");
  expect(access?.httpOnly).toBe(true);
});

test("음성 시험 페이지가 Next 뒤에서도 열린다", async ({ page }) => {
  const response = await page.goto("/speech-probe/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});
