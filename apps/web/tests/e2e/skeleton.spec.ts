import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginCookie } from "./helpers/volunteerLogin";

// PR #31에서 지운 접근 코드 주소. 404로 남아 있는지만 확인한다.
const REMOVED_ACCESS_PATH = "/enter";

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

test("접근 코드 주소는 없고 /api/health는 로그인 뒤에만 열린다", async ({
  request,
}) => {
  const removed = await request.get(REMOVED_ACCESS_PATH, { maxRedirects: 0 });
  expect(removed.status()).toBe(404);

  const noCookie = await request.get("/api/health");
  expect(noCookie.status()).toBe(401);

  const cookie = await loginCookie(request);
  const health = await request.get("/api/health", {
    headers: { cookie },
  });
  expect(health.status()).toBe(200);
  expect((await health.json()).llmMode).toBe("mock");
});

test("음성 시험 페이지가 Next 뒤에서도 열린다", async ({ page }) => {
  const response = await page.goto("/speech-probe/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});
