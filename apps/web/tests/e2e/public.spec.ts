import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// 접근 코드는 저장소 루트 .demo-access.local의 첫 줄에서만 읽는다.
function readAccessCode(): string {
  const file = path.resolve(__dirname, "../../../../.demo-access.local");
  return readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
}

test.beforeAll(() => {
  if (!process.env.BASE_URL) {
    throw new Error("test:public은 BASE_URL이 필요합니다.");
  }
});

test("공개 주소 첫 화면과 음성 시험 페이지가 열린다", async ({ page }) => {
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "LightHouse" })).toBeVisible();

  const probe = await page.goto("/speech-probe/");
  expect(probe?.status()).toBe(200);
});

test("공개 주소 접근 코드와 health", async ({ request }) => {
  const wrong = await request.get("/enter?code=wrong", { maxRedirects: 0 });
  expect(wrong.status()).toBe(401);

  const noCookie = await request.get("/api/health");
  expect(noCookie.status()).toBe(401);

  const right = await request.get("/enter", {
    params: { code: readAccessCode() },
    maxRedirects: 0,
  });
  expect(right.status()).toBe(303);
  expect(right.headers()["location"]).toBe("/");

  const setCookie = right.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Secure/i);

  const health = await request.get("/api/health", {
    headers: { cookie: setCookie.split(";")[0] },
  });
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(Object.keys(body).sort()).toEqual([
    "groqKeyConfigured",
    "llmMode",
    "ok",
  ]);
  expect(body.llmMode).toBe("live");
  console.log(`groqKeyConfigured=${body.groqKeyConfigured}`);
});
