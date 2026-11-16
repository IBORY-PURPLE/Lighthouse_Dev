import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test("/api/health는 쿠키 없이 열리고, 옛 /enter 링크는 /로 이동한다", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect((await health.json()).llmMode).toBe("mock");

  const old = await request.get("/enter?code=old-link-value", { maxRedirects: 0 });
  expect(old.status()).toBe(303);
  expect(old.headers()["location"]).toBe("/");
});

test("브라우저로 옛 /enter 링크를 열면 코드 없는 /로 이동하고 쿠키는 생기지 않는다", async ({
  page,
  context,
}) => {
  await page.goto("/enter?code=old-link-value");
  await expect(page).toHaveURL(/\/$/);
  expect(page.url()).not.toContain("old-link-value");
  expect(await context.cookies()).toEqual([]);
});

test("음성 시험 페이지가 Next 뒤에서도 열린다", async ({ page }) => {
  const response = await page.goto("/speech-probe/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});
