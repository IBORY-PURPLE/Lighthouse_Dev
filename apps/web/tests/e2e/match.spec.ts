import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";
import { fail, installFakeSpeech, say } from "./helpers/fakeSpeech";
import {
  answerFlowA,
  DEFAULT_ANSWERS,
  MATCH_REQUEST_NAME,
} from "./helpers/flowA";

// 전부 가짜 음성 입력 기준이다. 실제 음성 인식과 VoiceOver 낭독은 사람이 판정한다.

const PASS_SENTENCE = "sony껄로 헤드셋 사고싶어";
const HANDOFF_NAME = "봉사자 화면으로(시연)";
// 플로우 A: 질문 1에서 품목을 기기 안에서 먼저 본다(needProduct). 서버 422(needItem)는 API 시험에 남는다.
const NEED_PRODUCT_STATUS =
  "어떤 제품인지 알아듣지 못했습니다. 제품 이름을 넣어 다시 말씀하세요.";

const speechButton = (page: Page) =>
  page.getByRole("button", { name: "눌러서 말하기" });
const confirmButton = (page: Page) =>
  page.getByRole("button", { name: "다음 질문" });
const matchButton = (page: Page) =>
  page.getByRole("button", { name: MATCH_REQUEST_NAME });
const handoffButton = (page: Page) =>
  page.getByRole("button", { name: HANDOFF_NAME });
const textInput = (page: Page) => page.getByRole("textbox", { name: "찾는 제품" });
const status = (page: Page) => page.getByRole("status");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

const storedMatch = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("lh.match.v1"));

/**
 * 횟수 제한은 주소마다 센다. 시험끼리 서로의 횟수를 쓰지 않게 주소를 나눈다.
 * 실패하면 워커가 다시 시작돼 카운터가 초기화되므로 카운터 대신 임의 값을 쓴다.
 */
const nextClient = () => `test-${randomUUID()}`;

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

/** 이용자 화면(플로우 A)은 태그·영향도와 무관하게 axe 위반 0건이어야 한다. */
async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
    })),
  ).toEqual([]);
}

async function openUserScreen(page: Page) {
  const context = page.context();
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextClient() });
  await installFakeSpeech(page);
  await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
  await expect(page).toHaveURL(/\/$/);

  // Windows WebKit은 Secure 쿠키를 저장은 해도 http://localhost로 보내지 않는다.
  // /enter가 준 값을 그대로 두고 시험 안에서만 Secure를 뺀다. 운영은 HTTPS다.
  const access = (await context.cookies()).find(
    (cookie) => cookie.name === "lh_access",
  );
  expect(access).toBeDefined();
  if (access) await context.addCookies([{ ...access, secure: false }]);
}

/** 플로우 A로 세 질문에 답하고(질문 1 = sentence) 요약에서 매칭을 요청한다. */
async function hearAndConfirm(page: Page, sentence: string) {
  await answerFlowA(page, { ...DEFAULT_ANSWERS, product: sentence });
  await matchButton(page).click();
}

/** 질문 1에서 음성으로 답하고 "다음 질문"을 누른다. */
async function answerFirstQuestion(page: Page, sentence: string) {
  await speechButton(page).click();
  await expect(status(page)).toHaveText("듣고 있습니다. 말씀하세요.");
  await say(page, sentence);
  await expect(confirmButton(page)).toBeFocused();
  await confirmButton(page).click();
}

async function matchThroughUi(page: Page, sentence = PASS_SENTENCE) {
  await openUserScreen(page);
  await hearAndConfirm(page, sentence);
  await expect(handoffButton(page)).toBeFocused();
}

test.describe("매칭 흐름", () => {
  test("합격 문장: 응답, 안내, 초점, 저장", async ({ page }) => {
    await openUserScreen(page);
    await expect(handoffButton(page)).toHaveCount(0);

    const responsePromise = page.waitForResponse("**/api/match");
    await hearAndConfirm(page, PASS_SENTENCE);
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.volunteer).toEqual({
      id: "v-01",
      displayName: "가상 봉사자 A",
    });
    expect(body.request).toEqual({
      brand: "Sony",
      item: "헤드셋",
      raw: PASS_SENTENCE,
    });

    await expect(status(page)).toHaveText("가상 봉사자 A와 연결됐습니다.");
    await expect(handoffButton(page)).toBeFocused();
    expect(
      await page.evaluate(() => document.activeElement?.textContent),
    ).toContain("시연");
    expect(JSON.parse((await storedMatch(page)) ?? "null")).toEqual(body);

    await expect(speechButton(page)).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);
    await expect(matchButton(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: "test-results/match-done.png" });
  });

  for (const sentence of [
    "sony 헤드셋",
    "Sony 헤드셋",
    "SONY 헤드셋",
    "소니 헤드셋",
    "쏘니 헤드셋",
    "소니껄로 헤드셋",
  ]) {
    test(`표기 변형: ${sentence}`, async ({ page }) => {
      const responsePromise = page.waitForResponse("**/api/match");
      await matchThroughUi(page, sentence);
      const body = await (await responsePromise).json();
      expect(body.request).toEqual({
        brand: "Sony",
        item: "헤드셋",
        raw: sentence,
      });
    });
  }

  test("품목 없는 문장: 질문 1에 머물러 안내, 버튼에 초점, 다시 말하면 다음 질문", async ({
    page,
  }) => {
    const matchCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/match")) matchCalls.push(request.url());
    });
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await answerFirstQuestion(page, "sony껄로 사고싶어");

    await expect(status(page)).toHaveText(NEED_PRODUCT_STATUS);
    await expect(speechButton(page)).toBeFocused();
    await expect(
      page.getByRole("heading", { level: 2, name: /^질문 1\/3/ }),
    ).toBeVisible();
    await expect(handoffButton(page)).toHaveCount(0);
    expect(await storedMatch(page)).toBeNull();
    expect(matchCalls).toEqual([]);
    await expectNoAxeViolations(page);

    await answerFirstQuestion(page, PASS_SENTENCE);
    await expect(
      page.getByRole("heading", { level: 2, name: /^질문 2\/3/ }),
    ).toBeFocused();
  });

  test("입력창에서 품목 없는 문장: 입력창에 초점, 고쳐서 다시 요청", async ({
    page,
  }) => {
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await speechButton(page).click();
    await fail(page, "not-allowed");
    await expect(textInput(page)).toBeFocused();

    await textInput(page).fill("sony껄로 사고싶어");
    await confirmButton(page).click();
    await expect(status(page)).toHaveText("입력한 내용: sony껄로 사고싶어");
    await confirmButton(page).click();
    await expect(status(page)).toHaveText(NEED_PRODUCT_STATUS);
    await expect(textInput(page)).toBeFocused();
    await expect(textInput(page)).toHaveValue("sony껄로 사고싶어");

    await textInput(page).fill(PASS_SENTENCE);
    await confirmButton(page).click();
    await confirmButton(page).click();
    await expect(
      page.getByRole("heading", { level: 2, name: /^질문 2\/3/ }),
    ).toBeFocused();
    await expect(page.getByRole("textbox", { name: "예산" })).toBeVisible();
  });

  test("201자 입력은 길다고 안내하고 입력창에 초점", async ({ page }) => {
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await speechButton(page).click();
    await fail(page, "not-allowed");
    await textInput(page).fill("헤드셋".padEnd(201, "가"));
    await confirmButton(page).click();
    await confirmButton(page).click();

    await expect(status(page)).toHaveText(
      "답이 너무 깁니다. 짧게 다시 말씀하세요.",
    );
    await expect(textInput(page)).toBeFocused();
  });
});

test.describe("매칭 실패 안내", () => {
  test("쿠키 없음: 접근 코드 안내, 답 유지, 매칭 요청에 초점", async ({
    page,
  }) => {
    await installFakeSpeech(page);
    await page.goto("/");
    await hearAndConfirm(page, PASS_SENTENCE);

    await expect(status(page)).toHaveText(
      "접근 코드가 필요합니다. 시연 주소로 다시 열어 주세요.",
    );
    await expect(matchButton(page)).toBeFocused();
    await expect(
      page.getByText(`찾는 제품: ${PASS_SENTENCE}`, { exact: true }),
    ).toBeVisible();
    await expect(handoffButton(page)).toHaveCount(0);
  });

  test("횟수 초과: 1분 뒤 안내, 매칭 요청에 초점", async ({ page }) => {
    await page.route("**/api/match", (route) =>
      route.fulfill({ status: 429, json: { ok: false, error: "rate_limited" } }),
    );
    await openUserScreen(page);
    await hearAndConfirm(page, PASS_SENTENCE);

    await expect(status(page)).toHaveText(
      "요청이 많습니다. 1분 뒤 다시 시도해 주세요.",
    );
    await expect(matchButton(page)).toBeFocused();
  });

  test("연결 실패 뒤 같은 문장을 다시 보내면 매칭된다(음성)", async ({ page }) => {
    await page.route("**/api/match", (route) => route.abort());
    await openUserScreen(page);
    await hearAndConfirm(page, PASS_SENTENCE);

    await expect(status(page)).toHaveText(
      "봉사자 연결에 실패했습니다. 다시 시도해 주세요.",
    );
    await expect(matchButton(page)).toBeFocused();
    await expect(matchButton(page)).not.toHaveAttribute("aria-disabled");

    await page.unroute("**/api/match");
    await matchButton(page).click();
    await expect(handoffButton(page)).toBeFocused();
  });

  test("연결 실패 뒤 같은 문장을 다시 보내면 매칭된다(입력창)", async ({
    page,
  }) => {
    await page.route("**/api/match", (route) => route.abort());
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await speechButton(page).click();
    await fail(page, "not-allowed");
    const typedAnswers: [string, string, string][] = [
      ["찾는 제품", PASS_SENTENCE, "다음 질문"],
      ["예산", DEFAULT_ANSWERS.budget, "다음 질문"],
      ["새 제품 또는 중고", DEFAULT_ANSWERS.condition, "완료"],
    ];
    for (const [field, text, confirm] of typedAnswers) {
      await page.getByRole("textbox", { name: field }).fill(text);
      await page.getByRole("button", { name: confirm }).click();
      await page.getByRole("button", { name: confirm }).click();
    }
    await matchButton(page).click();

    await expect(status(page)).toHaveText(
      "봉사자 연결에 실패했습니다. 다시 시도해 주세요.",
    );
    await expect(matchButton(page)).toBeFocused();
    await expect(
      page.getByText(`찾는 제품: ${PASS_SENTENCE}`, { exact: true }),
    ).toBeVisible();

    await page.unroute("**/api/match");
    await matchButton(page).click();
    await expect(handoffButton(page)).toBeFocused();
  });
});

test.describe("봉사자 화면(시연)", () => {
  test("전환 후 제목에 초점, 시연 안내, 같은 탭", async ({ page, context }) => {
    await matchThroughUi(page);
    await handoffButton(page).click();

    await expect(page).toHaveURL(/\/volunteer$/);
    expect(context.pages()).toHaveLength(1);
    await expect(heading(page)).toBeFocused();
    await expect(status(page)).toHaveText(
      "시연: 봉사자 화면으로 바뀌었습니다. 이용자 요청: Sony 헤드셋.",
    );
    await expect(page).toHaveTitle(/시연/);
    await expect(page.getByText(PASS_SENTENCE, { exact: true })).toBeVisible();
    await expectNoBlockingAxe(page);
    await page.screenshot({ path: "test-results/volunteer-skeleton.png" });
  });

  test("브랜드 없는 요청은 품목만 안내한다", async ({ page }) => {
    await matchThroughUi(page, "헤드셋 사고싶어");
    await handoffButton(page).click();
    await expect(status(page)).toHaveText(
      "시연: 봉사자 화면으로 바뀌었습니다. 이용자 요청: 헤드셋.",
    );
  });

  test("낭독 영역은 처음에 비어 있다가 채워진다", async ({ page }) => {
    await matchThroughUi(page);
    await page.evaluate(() => {
      const seen: (string | null)[] = [];
      (window as unknown as { seen: typeof seen }).seen = seen;
      new MutationObserver(() => {
        const region = document.querySelector(
          '.volunteer-screen [role="status"]',
        );
        if (region) seen.push(region.textContent);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    await handoffButton(page).click();
    await expect(status(page)).toHaveText(/^시연: /);
    const seen = await page.evaluate(
      () => (window as unknown as { seen: string[] }).seen,
    );
    expect(seen[0]).toBe("");
  });

  test("저장값 없이 열면 매칭 정보 없음과 이용자 화면 링크", async ({ page }) => {
    await page.goto("/volunteer");
    await expect(heading(page)).toBeFocused();
    await expect(page).toHaveTitle(/시연/);
    await expect(status(page)).toHaveText("매칭 정보가 없습니다.");
    await expectNoBlockingAxe(page);

    const link = page.getByRole("link", { name: "이용자 화면으로 돌아가기" });
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "LightHouse 상품 요청" }),
    ).toBeFocused();
    await expect(page).toHaveTitle("상품 요청 - LightHouse");
  });

  test("깨진 저장값은 매칭 정보 없음으로 처리한다", async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("lh.match.v1", "{broken"),
    );
    await page.goto("/volunteer");
    await expect(status(page)).toHaveText("매칭 정보가 없습니다.");
  });
});

test.describe("역할 분리", () => {
  test("이용자 화면에 챗봇 UI가 없다(매칭 후 포함)", async ({ page }) => {
    await matchThroughUi(page);
    await expect(page.getByText(/챗봇|찾는 가이드|AI 조언/)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.locator("input")).toHaveCount(0);
  });

  test("봉사자 화면에 이용자 요청 작성 UI가 없다", async ({ page }) => {
    await matchThroughUi(page);
    await handoffButton(page).click();
    await expect(heading(page)).toBeFocused();
    await expect(speechButton(page)).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);
    await expect(textInput(page)).toHaveCount(0);
    await expect(page.locator("input, textarea")).toHaveCount(0);
  });

  test("봉사자 화면은 저장값을 바꾸지 않는다", async ({ page }) => {
    await matchThroughUi(page);
    const before = await storedMatch(page);
    await handoffButton(page).click();
    await expect(heading(page)).toBeFocused();
    await expect(status(page)).toHaveText(/^시연: /);
    expect(await storedMatch(page)).toBe(before);
  });
});

test.describe("POST /api/match", () => {
  async function accessCookie(request: APIRequestContext) {
    const entered = await request.get(`/enter?code=${E2E_ACCESS_CODE}`, {
      maxRedirects: 0,
    });
    return (entered.headers()["set-cookie"] ?? "").split(";")[0];
  }

  test("쿠키 없음 401", async ({ request }) => {
    const response = await request.post("/api/match", {
      headers: { cookie: "" },
      data: { text: PASS_SENTENCE },
    });
    expect(response.status()).toBe(401);
  });

  test("길이 초과 400, 200자는 통과, 품목 없음 422", async ({ request }) => {
    const cookie = await accessCookie(request);
    const post = (text: string) =>
      request.post("/api/match", {
        headers: { cookie, "x-forwarded-for": nextClient() },
        data: { text },
      });

    expect((await post("헤드셋".padEnd(200, "가"))).status()).toBe(200);
    expect((await post("헤드셋".padEnd(201, "가"))).status()).toBe(400);

    const needItem = await post("sony껄로 사고싶어");
    expect(needItem.status()).toBe(422);
    expect((await needItem.json()).error).toBe("need_item");
  });

  test("서버 전용 명단의 담당 품목을 응답에 넣지 않는다", async ({ request }) => {
    const cookie = await accessCookie(request);
    const response = await request.post("/api/match", {
      headers: { cookie, "x-forwarded-for": nextClient() },
      data: { text: PASS_SENTENCE },
    });
    expect(Object.keys((await response.json()).volunteer).sort()).toEqual([
      "displayName",
      "id",
    ]);
  });

  test("분당 31번째는 429이고 다른 접속 주소는 영향이 없다", async ({
    request,
  }) => {
    const cookie = await accessCookie(request);
    const client = nextClient();
    const post = (forwardedFor: string) =>
      request.post("/api/match", {
        headers: { cookie, "x-forwarded-for": forwardedFor },
        data: { text: PASS_SENTENCE },
      });

    for (let i = 0; i < 30; i += 1) {
      expect((await post(client)).status()).toBe(200);
    }
    const limited = await post(client);
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);

    expect((await post(nextClient())).status()).toBe(200);
  });
});
