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
import { completeFlowA, DEFAULT_ANSWERS } from "./helpers/flowA";

// 전부 가짜 음성 입력과 가짜 답변(LLM_MODE=mock) 기준이다.
// 실제 음성 인식, VoiceOver 낭독, 실제 Groq 답변은 여기서 판정하지 않는다.

const REQUEST_SENTENCE = "sony껄로 헤드셋 사고싶어";
const PASS_QUESTION = "sony 헤드셋 제품을 찾는 가이드 알려줘";

const STATUS = {
  waiting: "답변을 만들고 있습니다.",
  arrived: "답변이 도착했습니다.",
  tooLong: "질문이 너무 깁니다. 짧게 다시 말해 주세요.",
  noAccess: "접근 코드가 필요합니다. 시연 주소로 다시 열어 주세요.",
  tooMany: "요청이 많습니다. 1분 뒤 다시 시도해 주세요.",
  failed: "답변 서버에 연결하지 못했습니다. 다시 시도해 주세요.",
  notConfigured: "챗봇 설정이 끝나지 않았습니다.",
};

const status = (page: Page) => page.getByRole("status");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const askButton = (page: Page) =>
  page.getByRole("button", { name: "눌러서 질문하기" });
const confirmQuestion = (page: Page) =>
  page.getByRole("button", { name: "이대로 질문" });
const retryButton = (page: Page) =>
  page.getByRole("button", { name: "다시 시도" });
const questionInput = (page: Page) => page.getByRole("textbox", { name: "질문" });
const answer = (page: Page) => page.locator(".chat-answer");

const nextClient = () => `test-${randomUUID()}`;

/** 봉사자 챗봇 화면은 태그·영향도와 무관하게 axe 위반 0건이어야 한다. */
async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
    })),
  ).toEqual([]);
}

/** 이용자 화면에서 실제로 매칭한 뒤 같은 탭으로 봉사자 화면을 연다. */
async function openVolunteer(page: Page) {
  const context = page.context();
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextClient() });
  await installFakeSpeech(page);
  await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
  await expect(page).toHaveURL(/\/$/);

  // Windows WebKit은 Secure 쿠키를 http://localhost로 보내지 않는다(match.spec.ts 참고).
  const access = (await context.cookies()).find(
    (cookie) => cookie.name === "lh_access",
  );
  expect(access).toBeDefined();
  if (access) await context.addCookies([{ ...access, secure: false }]);

  await completeFlowA(page, { ...DEFAULT_ANSWERS, product: REQUEST_SENTENCE });
  const handoff = page.getByRole("button", { name: "봉사자 화면으로(시연)" });
  await expect(handoff).toBeFocused();
  await handoff.click();
  await expect(page).toHaveURL(/\/volunteer$/);
  await expect(heading(page)).toBeFocused();
}

async function hearQuestion(page: Page, question: string) {
  await askButton(page).click();
  await expect(status(page)).toHaveText("듣고 있습니다. 말씀하세요.");
  await say(page, question);
  await expect(confirmQuestion(page)).toBeFocused();
}

async function ask(page: Page, question = PASS_QUESTION) {
  await hearQuestion(page, question);
  await confirmQuestion(page).click();
}

/** 입력창으로 넘어가 질문을 넣는다. */
async function typeQuestion(page: Page, question: string) {
  await askButton(page).click();
  await fail(page, "not-allowed");
  await expect(questionInput(page)).toBeFocused();
  await questionInput(page).fill(question);
}

test.describe("봉사자 챗봇", () => {
  test("합격 질문: 안내, 답변 세 항목, 답변 영역 초점, 다음 질문 버튼", async ({
    page,
  }) => {
    await openVolunteer(page);
    const requestPromise = page.waitForRequest("**/api/chat");
    await ask(page);
    const request = await requestPromise;

    const body = request.postDataJSON();
    expect(Object.keys(body).sort()).toEqual([
      "context",
      "question",
      "requestId",
    ]);
    expect(body.question).toBe(PASS_QUESTION);
    expect(body.context).toEqual({ brand: "Sony", item: "헤드셋" });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);

    await expect(status(page)).toHaveText(STATUS.arrived);
    await expect(answer(page)).toBeFocused();
    await expect(answer(page)).toHaveAttribute("tabindex", "-1");
    for (const section of ["검색어:", "확인할 조건:", "찾는 순서:"]) {
      await expect(answer(page)).toContainText(section);
    }
    await expect(answer(page)).toContainText("Sony 헤드셋");
    await expect(askButton(page)).toBeVisible();
    await expect(page.getByText(REQUEST_SENTENCE, { exact: true })).toBeVisible();

    await expectNoAxeViolations(page);
    await answer(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/volunteer-chat.png",
      fullPage: true,
    });
  });

  test("기다리는 동안 안내하고 버튼을 눌러도 두 번 보내지 않는다", async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    await page.route("**/api/chat", async (route) => {
      calls += 1;
      await held;
      await route.continue();
    });

    await openVolunteer(page);
    await ask(page);

    await expect(status(page)).toHaveText(STATUS.waiting);
    await expect(confirmQuestion(page)).toHaveAttribute("aria-disabled", "true");
    await confirmQuestion(page).dispatchEvent("click");
    await expect(answer(page)).toHaveCount(0);
    expect(calls).toBe(1);

    release();
    await expect(status(page)).toHaveText(STATUS.arrived);
    expect(calls).toBe(1);
  });

  test("답변은 조금씩 나타나고 낭독 영역 밖에 있으며 끝난 뒤에 초점이 온다", async ({
    page,
  }) => {
    await openVolunteer(page);
    await page.evaluate(() => {
      const seen: { length: number; focused: boolean }[] = [];
      (window as unknown as { seen: typeof seen }).seen = seen;
      new MutationObserver(() => {
        const region = document.querySelector(".chat-answer");
        if (region) {
          seen.push({
            length: region.textContent?.length ?? 0,
            focused: document.activeElement === region,
          });
        }
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await ask(page);
    await expect(status(page)).toHaveText(STATUS.arrived);

    const seen = await page.evaluate(
      () =>
        (window as unknown as { seen: { length: number; focused: boolean }[] })
          .seen,
    );
    const lengths = new Set(seen.map((entry) => entry.length));
    expect(lengths.size).toBeGreaterThan(2);
    expect(seen.some((entry) => entry.focused)).toBe(false);

    await expect(
      page.locator('[role="status"] .chat-answer, [aria-live] .chat-answer'),
    ).toHaveCount(0);
    await expect(answer(page)).not.toHaveAttribute("aria-live");
    await expect(answer(page)).not.toHaveAttribute("role");
  });

  test("두 번째 질문: 대화 기록 없이 보내고 답변 영역에 다시 초점", async ({
    page,
  }) => {
    await openVolunteer(page);
    await ask(page);
    await expect(answer(page)).toBeFocused();

    const requestPromise = page.waitForRequest("**/api/chat");
    await ask(page, "소니 헤드셋 재고 확인 방법 알려줘");
    const body = (await requestPromise).postDataJSON();
    expect(Object.keys(body).sort()).toEqual([
      "context",
      "question",
      "requestId",
    ]);
    expect(body.question).toBe("소니 헤드셋 재고 확인 방법 알려줘");

    await expect(status(page)).toHaveText(STATUS.arrived);
    await expect(answer(page)).toBeFocused();
    await expect(answer(page)).toHaveCount(1);
  });

  test("다음 질문을 누르면 시연 안내가 다시 나오지 않는다(마이크에 섞임 방지)", async ({
    page,
  }) => {
    await openVolunteer(page);
    await ask(page);
    await expect(status(page)).toHaveText(STATUS.arrived);

    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      const region = document.querySelector('[role="status"]');
      if (!region) throw new Error("낭독 영역 없음");
      new MutationObserver(() => seen.push(region.textContent ?? "")).observe(
        region,
        { subtree: true, childList: true, characterData: true },
      );
    });

    await askButton(page).click();
    await expect(status(page)).toHaveText("듣고 있습니다. 말씀하세요.");
    const seen = await page.evaluate(
      () => (window as unknown as { seen: string[] }).seen,
    );
    expect(seen.filter((text) => text.startsWith("시연:"))).toEqual([]);
    expect(seen[0]).toBe("");
  });

  test("입력창으로도 물을 수 있다(빈 입력 안내 포함)", async ({ page }) => {
    await openVolunteer(page);
    await typeQuestion(page, "   ");
    await confirmQuestion(page).click();
    await expect(status(page)).toHaveText("입력창에 질문을 입력하세요.");
    await expect(questionInput(page)).toBeFocused();

    await questionInput(page).fill(PASS_QUESTION);
    await confirmQuestion(page).click();
    await expect(status(page)).toHaveText(STATUS.arrived);
    await expect(answer(page)).toBeFocused();
    await expectNoAxeViolations(page);
  });

  test("매칭 정보가 없으면 챗봇을 보여 주지 않는다", async ({ page }) => {
    await page.goto("/volunteer");
    await expect(status(page)).toHaveText("매칭 정보가 없습니다.");
    await expect(askButton(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  });
});

test.describe("챗봇 오류 안내", () => {
  test("쿠키 없음: 접근 코드 안내, 다시 시도에 초점", async ({ page, context }) => {
    await openVolunteer(page);
    await context.clearCookies();
    await ask(page);

    await expect(status(page)).toHaveText(STATUS.noAccess);
    await expect(retryButton(page)).toBeFocused();
    await expect(page.getByText(PASS_QUESTION, { exact: true })).toBeVisible();
    await expect(answer(page)).toHaveCount(0);
  });

  test("질문 301자: 입력창에 안내와 초점, 글자 유지", async ({ page }) => {
    await openVolunteer(page);
    const question = "가".repeat(301);
    await typeQuestion(page, question);
    await confirmQuestion(page).click();

    await expect(status(page)).toHaveText(STATUS.tooLong);
    await expect(questionInput(page)).toBeFocused();
    await expect(questionInput(page)).toHaveValue(question);
    await expect(retryButton(page)).toHaveCount(0);
  });

  test("음성으로 낸 질문이 400이면 다시 말할 버튼에 초점", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 400, json: { ok: false, error: "too_long" } }),
    );
    await openVolunteer(page);
    await ask(page);

    await expect(status(page)).toHaveText(STATUS.tooLong);
    await expect(askButton(page)).toBeFocused();
    await expect(retryButton(page)).toHaveCount(0);
  });

  for (const [code, error, message] of [
    [429, "rate_limited", STATUS.tooMany],
    [503, "not_configured", STATUS.notConfigured],
  ] as const) {
    test(`${code}: 표의 문구, 다시 시도에 초점`, async ({ page }) => {
      await page.route("**/api/chat", (route) =>
        route.fulfill({ status: code, json: { ok: false, error } }),
      );
      await openVolunteer(page);
      await ask(page);

      await expect(status(page)).toHaveText(message);
      await expect(retryButton(page)).toBeFocused();
      await expect(answer(page)).toHaveCount(0);
    });
  }

  test("Groq 실패 502: 안내와 다시 시도, 다시 시도하면 답변", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 502, json: { ok: false, error: "llm_failed" } }),
    );
    await openVolunteer(page);
    await ask(page);

    await expect(status(page)).toHaveText(STATUS.failed);
    await expect(retryButton(page)).toBeFocused();
    await expect(retryButton(page)).not.toHaveAttribute("aria-disabled");
    await expectNoAxeViolations(page);

    await page.unroute("**/api/chat");
    await retryButton(page).click();
    await expect(status(page)).toHaveText(STATUS.arrived);
    await expect(answer(page)).toBeFocused();
    await expect(retryButton(page)).toHaveCount(0);
  });

  test("입력창에서 502: 글자 유지, 다시 시도에 초점", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 502, json: { ok: false, error: "llm_failed" } }),
    );
    await openVolunteer(page);
    await typeQuestion(page, PASS_QUESTION);
    await confirmQuestion(page).click();

    await expect(status(page)).toHaveText(STATUS.failed);
    await expect(retryButton(page)).toBeFocused();
    await expect(questionInput(page)).toHaveValue(PASS_QUESTION);

    await page.unroute("**/api/chat");
    await retryButton(page).click();
    await expect(status(page)).toHaveText(STATUS.arrived);
    await expect(answer(page)).toBeFocused();
  });

  test("연결 실패: 502와 같은 안내", async ({ page }) => {
    await page.route("**/api/chat", (route) => route.abort());
    await openVolunteer(page);
    await ask(page);

    await expect(status(page)).toHaveText(STATUS.failed);
    await expect(retryButton(page)).toBeFocused();
  });

  test("답변 도중 끊기면 보이던 글자를 지우고 다시 시도", async ({ page }) => {
    // 응답을 도중에 끊는 것은 page.route로 흉내 낼 수 없어 첫 호출의 fetch만 바꾼다.
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      let chatCalls = 0;
      window.fetch = (input, init) => {
        if (String(input).includes("/api/chat")) {
          chatCalls += 1;
          if (chatCalls === 1) {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("검색어:\n1. 일부"));
                setTimeout(() => controller.error(new Error("끊김")), 300);
              },
            });
            return Promise.resolve(new Response(body));
          }
        }
        return realFetch(input, init);
      };
    });
    await openVolunteer(page);
    await ask(page);

    await expect(answer(page)).toContainText("1. 일부");
    await expect(status(page)).toHaveText(STATUS.waiting);

    await expect(status(page)).toHaveText(STATUS.failed);
    await expect(answer(page)).toHaveCount(0);
    await expect(retryButton(page)).toBeFocused();

    await retryButton(page).click();
    await expect(status(page)).toHaveText(STATUS.arrived);
    await expect(answer(page)).toContainText("찾는 순서:");
  });
});

test.describe("역할 분리", () => {
  test("이용자 화면은 매칭까지 /api/chat을 부르지 않는다", async ({ page }) => {
    const chatCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/chat")) chatCalls.push(request.url());
    });

    const context = page.context();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": nextClient() });
    await installFakeSpeech(page);
    await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
    const access = (await context.cookies()).find(
      (cookie) => cookie.name === "lh_access",
    );
    if (access) await context.addCookies([{ ...access, secure: false }]);

    await completeFlowA(page, { ...DEFAULT_ANSWERS, product: REQUEST_SENTENCE });
    await expect(
      page.getByRole("button", { name: "봉사자 화면으로(시연)" }),
    ).toBeFocused();

    expect(chatCalls).toEqual([]);
    await expect(askButton(page)).toHaveCount(0);
  });
});

test.describe("POST /api/chat", () => {
  const VALID = {
    requestId: "6f1c2e4a-1111-4222-8333-444455556666",
    question: PASS_QUESTION,
    context: { brand: "Sony", item: "헤드셋" },
  };

  async function accessCookie(request: APIRequestContext) {
    const entered = await request.get(`/enter?code=${E2E_ACCESS_CODE}`, {
      maxRedirects: 0,
    });
    return (entered.headers()["set-cookie"] ?? "").split(";")[0];
  }

  test("쿠키 없음 401", async ({ request }) => {
    const response = await request.post("/api/chat", {
      headers: { cookie: "" },
      data: VALID,
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe("unauthorized");
  });

  test("가짜 답변 text/plain, 질문 301자와 2KB 초과는 400", async ({
    request,
  }) => {
    const cookie = await accessCookie(request);
    const post = (data: unknown) =>
      request.post("/api/chat", {
        headers: { cookie, "x-forwarded-for": nextClient() },
        data: data as object,
      });

    const pass = await post({ ...VALID, question: "가".repeat(300) });
    expect(pass.status()).toBe(200);
    expect(pass.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    expect(await pass.text()).toContain("찾는 순서:");

    const tooLong = await post({ ...VALID, question: "가".repeat(301) });
    expect(tooLong.status()).toBe(400);

    const tooBig = await post({
      ...VALID,
      context: { brand: "S".repeat(2100), item: "헤드셋" },
    });
    expect(tooBig.status()).toBe(400);
    expect((await tooBig.json()).error).toBe("too_long");

    const invalid = await post({ question: "가" });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toBe("invalid_request");
  });

  test("분당 21번째는 429이고 다른 접속 주소는 영향이 없다", async ({
    request,
  }) => {
    const cookie = await accessCookie(request);
    const client = nextClient();
    const post = (forwardedFor: string) =>
      request.post("/api/chat", {
        headers: { cookie, "x-forwarded-for": forwardedFor },
        data: VALID,
      });

    for (let i = 0; i < 20; i += 1) {
      expect((await post(client)).status()).toBe(200);
    }
    const limited = await post(client);
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);

    expect((await post(nextClient())).status()).toBe(200);
  });
});
