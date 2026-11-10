import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech } from "./helpers/fakeSpeech";
import { completeFlowA, HANDOFF_NAME } from "./helpers/flowA";
import { loginVolunteer } from "./helpers/volunteerLogin";

// 플로우 A PR 2: 앱을 다시 열면 지난 접수를 서버에 묻는다(notes-flow-a.md C2 checking·다시 열기 행).
// 가짜 음성 입력·메모리 저장소 기준이다.

const status = (page: Page) => page.getByRole("status");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const queuedHeading = (page: Page) =>
  page.getByRole("heading", { level: 2, name: "접수 완료" });
const storedRequest = (page: Page) =>
  page.evaluate(() => localStorage.getItem("lh.request.v1"));

async function openUserScreen(page: Page) {
  const context = page.context();
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
  await installFakeSpeech(page);
  await page.goto("/");
}

/** 기기 안 기록을 직접 넣고 다시 연다. */
async function reopenWithRecord(page: Page, queueNumber: number) {
  const requestId = randomUUID();
  await page.evaluate(
    (record) => localStorage.setItem("lh.request.v1", JSON.stringify(record)),
    { v: 1, requestId, queueNumber, product: "소니 헤드셋", savedAt: Date.now() },
  );
  await page.reload();
  return requestId;
}

test.describe("다시 열기", () => {
  test("접수 뒤 다시 열면 대기번호를 낭독하고 봉사자 화면으로 이어 볼 수 있다", async ({
    page,
  }) => {
    await loginVolunteer(page);
    await openUserScreen(page);
    const queueNumber = await completeFlowA(page);

    const checked = page.waitForResponse("**/api/requests/*");
    await page.reload();
    const response = await checked;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ queueNumber, status: "waiting" });

    await expect(status(page)).toHaveText(
      `대기번호 ${queueNumber}번, 봉사자를 기다리고 있습니다.`,
    );
    await expect(queuedHeading(page)).toBeFocused();
    await expect(
      page.getByText(`대기번호 ${queueNumber}번`, { exact: true }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => ({ id: v.id, impact: v.impact }))).toEqual([]);
    await page.screenshot({ path: "test-results/user-resumed.png" });

    // 다시 연 뒤에도 기록의 제품으로 봉사자 화면(시연)까지 간다.
    await page.getByRole("button", { name: HANDOFF_NAME }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    await expect(status(page)).toHaveText(
      "시연: 봉사자 화면으로 바뀌었습니다. 이용자 요청: Sony 헤드셋.",
    );
  });

  test("새 요청하기를 누르면 기록을 지우고, 다시 열어도 첫 화면이다", async ({ page }) => {
    await openUserScreen(page);
    await completeFlowA(page);
    await page.reload();
    await expect(queuedHeading(page)).toBeFocused();

    await page.getByRole("button", { name: "새 요청하기" }).click();
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "시작하기" })).toBeVisible();
    expect(await storedRequest(page)).toBeNull();

    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/requests")) calls.push(request.url());
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "시작하기" })).toBeVisible();
    await expect(heading(page)).toBeFocused();
    await page.waitForTimeout(300);
    expect(calls).toEqual([]);
  });

  test("서버에 요청이 없으면(404) 기록을 지우고 첫 화면에서 안내한다", async ({ page }) => {
    await openUserScreen(page);
    // 영구 저장소(Supabase)의 404 응답 모양. 메모리 저장소는 persistent:false를 붙인다.
    await page.route("**/api/requests/*", (route) =>
      route.fulfill({ status: 404, json: { ok: false, error: "not_found", persistent: true } }),
    );
    await reopenWithRecord(page, 9);
    await expect(status(page)).toHaveText(
      "지난 요청을 찾지 못했습니다. 새로 요청하려면 시작하기를 누르세요.",
    );
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "시작하기" })).toBeVisible();
    expect(await storedRequest(page)).toBeNull();
  });

  test("메모리 저장소의 404(persistent:false)는 지우지 않고 저장 번호로 안내한다", async ({
    page,
  }) => {
    await openUserScreen(page);
    await reopenWithRecord(page, 8);
    await expect(status(page)).toHaveText(
      "대기번호 8번입니다. 지금은 상태를 확인하지 못했습니다.",
    );
    await expect(queuedHeading(page)).toBeFocused();
    expect(await storedRequest(page)).not.toBeNull();
  });

  for (const [name, handler] of [
    ["서버 503", (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
      route.fulfill({ status: 503, json: { ok: false, error: "store_unavailable" } })],
    ["네트워크 실패", (route: Parameters<Parameters<Page["route"]>[1]>[0]) => route.abort()],
  ] as const) {
    test(`조회 실패(${name})면 저장 번호로 안내하고 기록을 유지한다`, async ({ page }) => {
      await openUserScreen(page);
      await page.route("**/api/requests/*", handler);
      await reopenWithRecord(page, 7);
      await expect(status(page)).toHaveText(
        "대기번호 7번입니다. 지금은 상태를 확인하지 못했습니다.",
      );
      await expect(queuedHeading(page)).toBeFocused();
      expect(await storedRequest(page)).not.toBeNull();
    });
  }
});
