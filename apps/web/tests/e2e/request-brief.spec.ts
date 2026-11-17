import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enterAs, expectNoBlockingAxe, openDevice } from "./helpers/volunteerFlow";

// 이용자 요청 브리핑 화면 시험(가짜 AI·메모리 저장소). 접수 본문(details)을 서버에 바로 넣고
// 봉사자 입장 → 맡기 → [구매했어요] → 카드를 한 장씩 확인 → [다 봤어요] → 기종 질문이 열리는 흐름을 본다.
// 이용자 화면(음성 대화)이 details를 접수에 싣는 부분은 a-voice-home.spec.ts가 본다. 실제 음성·VoiceOver는 여기서 판정하지 않는다.
// BRIEF_SHOTS가 있으면 그 폴더에 화면 캡처를 남긴다(brief-*.png).

const SHOTS = process.env.BRIEF_SHOTS;

const DETAILS = {
  summary: "소니 무선 헤드셋, 노이즈 캔슬링, 예산 십만 원 정도",
  qa: [
    { q: "어떤 상품을 찾으세요?", a: "소니 무선 헤드셋" },
    { q: "어디에 쓰세요?", a: "출퇴근 지하철에서 써요" },
    { q: "무선이어야 하나요?", a: "네, 무선이요" },
    { q: "예산은 얼마인가요?", a: "십만 원 정도" },
  ],
};

const HINT = "구매 여부를 고르면 이용자 답 4개를 차례로 보여 드려요";
const BOUGHT_QUESTION = "좋아요. 어떤 기종을 쓰고 계세요?";
const RESEARCH_QUESTION = "좋아요. 어떤 기종을 알아보셨어요?";
const EMPTY_NOTE = "질문·답 기록이 없는 요청이에요";

const quick = (page: Page) => page.getByRole("group", { name: "빠른 답" });
const brief = (page: Page) => page.getByTestId("request-brief");
const composer = (page: Page) => page.locator("#vc-composer-input");
const sees = (page: Page, text: string) => page.getByTestId("chat-log").getByText(text);

async function capture(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** 이용자 접수(POST /api/requests)를 흉내 내 요청을 만든다. details는 선택. */
async function register(page: Page, details?: unknown): Promise<string> {
  const response = await page.request.post("/api/requests", {
    headers: { "x-forwarded-for": `198.51.${Math.floor(Math.random() * 250)}-${randomUUID()}` },
    data: {
      clientRequestId: randomUUID(),
      product: `소니 무선 헤드셋 ${randomUUID().slice(0, 6)}`,
      budget: "십만 원 정도",
      condition: "새 제품",
      ...(details === undefined ? {} : { details }),
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).requestId as string;
}

/** 봉사자 입장 → 요청 맡기(API) → 리서치 챗 첫 화면(히어로). */
async function claimAndOpen(page: Page, requestId: string) {
  await enterAs(page);
  const claimed = await page.request.post(`/api/volunteer/requests/${requestId}/claim`);
  expect(claimed.status()).toBe(200);
  await page.goto(`/volunteer/requests/${requestId}`);
  await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "hero");
}

test.describe("이용자 요청 브리핑", () => {
  test("구매했어요 → 카드를 한 장씩 → 다 봤어요 → 기종 질문이 열린다", async ({ page, browser, baseURL }) => {
    const requestId = await register(page, DETAILS);
    await claimAndOpen(page, requestId);

    // 히어로: 구매 여부를 고르면 이용자 답을 차례로 보여 준다는 안내.
    await expect(page.getByTestId("hero-brief-hint")).toHaveText(HINT);
    await capture(page, "brief-1-hero");
    // 390 폭에서도 [열기] 버튼·알약·제목·안내·입력창이 겹치지 않는다(폰 Safari 높이 659 포함).
    for (const height of [659, 844]) {
      await page.setViewportSize({ width: 390, height });
      await page.waitForTimeout(300);
      const open = await page.locator(".vc-side-open").boundingBox();
      const pill = await page.locator(".vc-pill").boundingBox();
      const hintBox = await page.getByTestId("hero-brief-hint").boundingBox();
      const dock = await page.locator(".vc-dock").boundingBox();
      expect(pill!.y).toBeGreaterThanOrEqual(open!.y + open!.height);
      expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(dock!.y);
      if (height === 844) await capture(page, "brief-1-hero-390");
    }
    await page.setViewportSize({ width: 393, height: 659 });

    await quick(page).getByRole("button", { name: "구매했어요", exact: true }).click();

    // 1장: 이용자가 확인한 요약. 기종 질문은 아직 없고 입력은 잠겨 있다.
    await expect(brief(page)).toBeVisible();
    await expect(brief(page).getByRole("heading", { name: "이용자가 확인한 요청" })).toBeFocused();
    await expect(brief(page)).toContainText(DETAILS.summary);
    await expect(brief(page).getByTestId("brief-card")).toHaveCount(1);
    await expect(brief(page).getByText("이용자 요청 1/5")).toBeVisible();
    await expect(sees(page, BOUGHT_QUESTION)).toHaveCount(0);
    await expect(composer(page)).toHaveAttribute("readonly", "");
    await expect(composer(page)).toHaveAttribute("placeholder", "이용자 요청을 먼저 확인해 주세요");
    await expect(quick(page)).toHaveCount(0);
    await expect(page.getByTestId("current-question")).toHaveCount(0);
    await expectNoBlockingAxe(page);

    // [다음]: 새 장(질문 1/4)이 열리고 제목으로 초점이 간다. 앞 장은 그대로 남는다.
    await brief(page).getByRole("button", { name: "다음", exact: true }).click();
    await expect(brief(page).getByRole("heading", { name: "질문 1/4" })).toBeFocused();
    await expect(brief(page).getByTestId("brief-card")).toHaveCount(2);
    await expect(brief(page).getByText("이용자 요청 2/5")).toBeVisible();
    await expect(brief(page)).toContainText("어떤 상품을 찾으세요?");
    await brief(page).getByRole("button", { name: "다음", exact: true }).click();
    await expect(brief(page).getByRole("heading", { name: "질문 2/4" })).toBeFocused();
    await expect(brief(page)).toContainText("출퇴근 지하철에서 써요");
    await capture(page, "brief-2-card");
    await expect(sees(page, BOUGHT_QUESTION)).toHaveCount(0);

    await brief(page).getByRole("button", { name: "다음", exact: true }).click();
    await brief(page).getByRole("button", { name: "다음", exact: true }).click();
    await expect(brief(page).getByRole("heading", { name: "질문 4/4" })).toBeFocused();
    await expect(brief(page).getByText("이용자 요청 5/5")).toBeVisible();
    // 마지막 장에서는 [다음] 대신 [다 봤어요]만 있다.
    await expect(brief(page).getByRole("button", { name: "다음", exact: true })).toHaveCount(0);
    await expect(sees(page, BOUGHT_QUESTION)).toHaveCount(0);
    await expectNoBlockingAxe(page);

    await brief(page).getByRole("button", { name: "다 봤어요 · 질문 이어 가기" }).click();

    // 다 본 뒤: 기종 질문이 열리고 초점이 그 질문으로 간다. 카드는 버튼 없이 펼쳐 남는다.
    await expect(sees(page, BOUGHT_QUESTION)).toBeVisible();
    await expect(brief(page)).toHaveAttribute("data-done", "true");
    await expect(brief(page).getByTestId("brief-card")).toHaveCount(5);
    await expect(brief(page).getByRole("button")).toHaveCount(0);
    await expect(composer(page)).not.toHaveAttribute("readonly", "");
    await expect(page.getByTestId("current-question")).toContainText("기종");
    await expect(page.locator("[id^=vc-q-]").first()).toBeFocused();
    await expectNoBlockingAxe(page);
    await capture(page, "brief-3-model-question");

    // 새로 고쳐도 다 본 상태가 이어진다(이 기기에만 "다 봤다"는 표시가 있다).
    await page.reload();
    await expect(sees(page, BOUGHT_QUESTION)).toBeVisible();
    await expect(brief(page)).toHaveAttribute("data-done", "true");

    // 맡은 봉사자 아닌 기기는 details를 못 본다. 이용자 상태 조회에도 없다.
    const other = await openDevice(browser, baseURL);
    await enterAs(other);
    expect((await other.request.get(`/api/volunteer/requests/${requestId}`)).status()).toBe(403);
    const status = await page.request.get(`/api/requests/${requestId}`);
    expect(status.status()).toBe(200);
    const statusText = await status.text();
    expect(statusText).not.toContain("출퇴근");
    expect(Object.keys(JSON.parse(statusText))).not.toContain("details");
    await other.context().close();
  });

  test("리서치만도 같은 흐름이고 [한 번에 모두 보기]로 한꺼번에 연다", async ({ page }) => {
    const requestId = await register(page, DETAILS);
    await claimAndOpen(page, requestId);
    await quick(page).getByRole("button", { name: "구매하지 않았어요 · 리서치만" }).click();

    await expect(brief(page)).toBeVisible();
    await expect(sees(page, RESEARCH_QUESTION)).toHaveCount(0);
    await brief(page).getByRole("button", { name: "한 번에 모두 보기" }).click();
    await expect(brief(page).getByTestId("brief-card")).toHaveCount(5);
    await expect(brief(page).getByRole("heading", { name: "질문 1/4" })).toBeFocused();
    await expect(brief(page).getByRole("button", { name: "다음", exact: true })).toHaveCount(0);
    await expect(brief(page).getByText("이용자 요청 5/5")).toBeVisible();
    await expect(sees(page, RESEARCH_QUESTION)).toHaveCount(0);

    await brief(page).getByRole("button", { name: "다 봤어요 · 질문 이어 가기" }).click();
    await expect(sees(page, RESEARCH_QUESTION)).toBeVisible();
    await expect(page.getByTestId("purchase-badge")).toHaveText("리서치만");
  });

  test("질문·답 기록이 없는 요청은 1장과 안내만 보이고 히어로 안내는 없다", async ({ page }) => {
    const requestId = await register(page);
    await claimAndOpen(page, requestId);
    await expect(page.getByTestId("hero-brief-hint")).toHaveCount(0);
    await capture(page, "brief-0-hero-nohint");
    await quick(page).getByRole("button", { name: "구매했어요", exact: true }).click();

    await expect(brief(page).getByTestId("brief-card")).toHaveCount(1);
    await expect(brief(page)).toContainText(EMPTY_NOTE);
    await expect(brief(page)).toContainText("접수 정보");
    await expect(brief(page).getByRole("button", { name: "다음", exact: true })).toHaveCount(0);
    await expect(sees(page, BOUGHT_QUESTION)).toHaveCount(0);
    await brief(page).getByRole("button", { name: "다 봤어요 · 질문 이어 가기" }).click();
    await expect(sees(page, BOUGHT_QUESTION)).toBeVisible();
  });

  test("잘못된 details는 무시하고 접수되어 카드는 1장과 안내만 보인다", async ({ page }) => {
    const requestId = await register(page, { summary: 3, qa: "x" });
    await claimAndOpen(page, requestId);
    await quick(page).getByRole("button", { name: "구매했어요", exact: true }).click();
    await expect(brief(page)).toContainText(EMPTY_NOTE);
    await expect(brief(page).getByTestId("brief-card")).toHaveCount(1);
  });
});
