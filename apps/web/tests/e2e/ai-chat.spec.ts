import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, removeSpeechApi, say } from "./helpers/fakeSpeech";
import { HANDOFF_NAME } from "./helpers/flowA";

// 이용자 AI 대화(PR 3). 가짜 음성 입력과 가짜 AI(LLM_MODE=mock) 기준이다.
// 실제 음성 인식, 소리 내어 읽어 주기, VoiceOver 낭독, 실제 OpenAI 응답은 사람이 판정한다.

const PRODUCT = "sony껄로 헤드셋 사고싶어";
const BUDGET = "10만 원 이하";
const CONDITION = "새 제품";
const CONSENT = "네, 등록해 주세요";

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 2, name });
const speechButton = (page: Page) => page.getByRole("button", { name: "눌러서 말하기" });
const sendButton = (page: Page) => page.getByRole("button", { name: "보내기" });
const status = (page: Page) => page.getByRole("status");

async function openUserScreen(page: Page, path = "/") {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
  await installFakeSpeech(page);
  await page.goto(path);
}

/** 음성으로 한 턴 답한다: 말하기 → 보내기 확인 → 다음 AI 문장에 초점. */
async function speakTurn(page: Page, text: string, nextReply: string | RegExp) {
  await speechButton(page).click();
  await say(page, text);
  await expect(sendButton(page)).toBeFocused();
  await sendButton(page).click();
  await expect(heading(page, nextReply)).toBeFocused();
}

/** 시작하기부터 조건 세 개를 답해 등록 확인 질문까지 간다. */
async function chatUntilConfirm(page: Page, product = PRODUCT) {
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(heading(page, "어떤 제품을 찾으세요?")).toBeFocused();
  await speakTurn(page, product, "예산은 얼마인가요?");
  await speakTurn(page, BUDGET, "새 제품과 중고 중 무엇을 원하세요?");
  await speakTurn(page, CONDITION, /이 내용으로 구매 요청을 등록할까요\?$/);
}

const queuedHeading = (page: Page) => heading(page, "접수 완료");

test.describe("AI 대화로 요청", () => {
  test("시작 → 세 조건 → 등록 확인 → 동의 → 접수 → 대기번호", async ({ page }) => {
    const converseBodies: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/requests/converse")) {
        converseBodies.push(request.postDataJSON());
      }
    });
    await openUserScreen(page);

    // 첫 화면: 안내와 두 버튼만. 이 화면에서는 AI를 부르지 않는다.
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByText("AI 서버로 보내지고")).toBeVisible();
    await expect(page.getByRole("button", { name: "기본 질문으로 하기" })).toBeVisible();
    expect(converseBodies).toEqual([]);
    await page.screenshot({ path: "test-results/user-ai-intro.png" });

    await chatUntilConfirm(page);
    // 한 턴마다 대화 기록 전체를 보낸다(서버는 저장하지 않는다).
    expect(converseBodies).toEqual([
      { messages: [] },
      {
        messages: [
          { role: "assistant", content: "어떤 제품을 찾으세요?" },
          { role: "user", content: PRODUCT },
        ],
      },
      {
        messages: [
          { role: "assistant", content: "어떤 제품을 찾으세요?" },
          { role: "user", content: PRODUCT },
          { role: "assistant", content: "예산은 얼마인가요?" },
          { role: "user", content: BUDGET },
        ],
      },
      expect.objectContaining({ messages: expect.arrayContaining([{ role: "user", content: CONDITION }]) }),
    ]);
    // 동의 전에는 접수하지 않았다.
    expect(await page.evaluate(() => localStorage.getItem("lh.request.v1"))).toBeNull();
    await expect(page.getByRole("button", { name: CONSENT })).toBeVisible();
    await page.screenshot({ path: "test-results/user-ai-confirm.png" });

    const registered = page.waitForResponse(
      (response) => response.url().endsWith("/api/requests") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: CONSENT }).click();
    const response = await registered;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      product: PRODUCT,
      budget: BUDGET,
      condition: CONDITION,
    });

    // 기존 대기 상태 화면과 같다: 접수 완료 제목 초점, 대기번호, 이어 보기, 기기 안 기록.
    await expect(queuedHeading(page)).toBeFocused();
    const { queueNumber } = await response.json();
    await expect(status(page)).toHaveText(
      `접수됐습니다. 대기번호 ${queueNumber}번입니다. 앱을 닫아도 됩니다. 다시 열면 대기번호를 알려 드립니다.`,
    );
    await expect(page.getByRole("button", { name: HANDOFF_NAME })).toBeVisible();
    const record = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("lh.request.v1"))) ?? "null",
    );
    expect(record).toMatchObject({ v: 1, queueNumber, product: PRODUCT });
    await page.screenshot({ path: "test-results/user-ai-queued.png" });
  });

  test("동의를 음성으로 말해도 접수된다, 다시 열면 대기번호를 알려 준다", async ({ page }) => {
    await openUserScreen(page);
    await chatUntilConfirm(page);
    await speechButton(page).click();
    await say(page, "네 등록해 주세요");
    await expect(sendButton(page)).toBeFocused();
    await sendButton(page).click();
    await expect(queuedHeading(page)).toBeFocused();
    const text = await page.locator(".queue-number").innerText();

    await page.reload();
    await expect(queuedHeading(page)).toBeVisible();
    await expect(page.locator(".queue-number")).toHaveText(text);
  });

  test("고칠게요를 누르면 접수하지 않고 다시 확인을 묻는다", async ({ page }) => {
    let registered = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/requests") && request.method() === "POST") registered += 1;
    });
    await openUserScreen(page);
    await chatUntilConfirm(page);
    await page.getByRole("button", { name: "아니요, 고치고 싶어요" }).click();
    await expect(heading(page, /고쳐서 다시 확인합니다/)).toBeFocused();
    await expect(page.getByRole("button", { name: CONSENT })).toBeVisible();
    expect(registered).toBe(0);
  });

  test("글자로 입력하기: 입력창으로 답한다", async ({ page }) => {
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(heading(page, "어떤 제품을 찾으세요?")).toBeFocused();
    await page.getByRole("button", { name: "글자로 입력하기" }).click();
    const input = page.getByRole("textbox", { name: "답변" });
    await expect(input).toBeFocused();
    await input.fill(PRODUCT);
    await page.keyboard.press("Enter");
    await expect(sendButton(page)).toBeFocused();
    await sendButton(page).click();
    await expect(heading(page, "예산은 얼마인가요?")).toBeFocused();
    // 다음 턴도 입력창으로 이어진다.
    await expect(page.getByRole("textbox", { name: "답변" })).toBeVisible();
  });

  test("음성 인식이 없는 기기는 처음부터 입력창이고 접근성 위반이 없다", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
    await removeSpeechApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(heading(page, "어떤 제품을 찾으세요?")).toBeFocused();
    await expect(page.getByRole("textbox", { name: "답변" })).toBeVisible();
    await expect(speechButton(page)).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("화면 구성: 장식은 낭독기에서 숨고 버튼은 44px 이상이다", async ({ page }) => {
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(heading(page, "어떤 제품을 찾으세요?")).toBeFocused();
    await expect(page.locator(".ai-orb")).toHaveAttribute("aria-hidden", "true");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    const buttons = page.getByRole("button");
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: "test-results/user-ai-question.png" });
  });
});

test.describe("AI가 안 될 때", () => {
  test("첫 호출 실패: 안내와 다시 시도, 다시 시도하면 대화가 이어진다", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/requests/converse", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({ status: 502, json: { ok: false, error: "llm_failed" } });
      }
      return route.fallback();
    });
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(status(page)).toHaveText(
      "AI와 연결하지 못했습니다. 다시 시도하거나 기본 질문으로 하세요.",
    );
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeFocused();
    await page.screenshot({ path: "test-results/user-ai-failed.png" });
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(heading(page, "어떤 제품을 찾으세요?")).toBeFocused();
    expect(calls).toBe(2);
  });

  test("답한 뒤 실패해도 내 답을 보여 주고 같은 대화를 다시 보낸다", async ({ page }) => {
    const bodies: unknown[] = [];
    let failNext = false;
    await page.route("**/api/requests/converse", (route) => {
      bodies.push(route.request().postDataJSON());
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 502, json: { ok: false, error: "llm_failed" } });
      }
      return route.fallback();
    });
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(heading(page, "어떤 제품을 찾으세요?")).toBeFocused();
    failNext = true;
    await speechButton(page).click();
    await say(page, PRODUCT);
    await sendButton(page).click();
    await expect(page.getByText(`내 답변: ${PRODUCT}`)).toBeVisible();
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(heading(page, "예산은 얼마인가요?")).toBeFocused();
    expect(bodies.at(-1)).toEqual(bodies.at(-2));
  });

  test("실패 → 기본 질문으로 하기 → 고정 질문 3개로 접수까지 간다", async ({ page }) => {
    await page.route("**/api/requests/converse", (route) =>
      route.fulfill({ status: 502, json: { ok: false, error: "llm_failed" } }),
    );
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
    await page.getByRole("button", { name: "기본 질문으로 하기" }).click();

    await expect(heading(page, /^질문 1\/3/)).toBeFocused();
    for (const [title, text, confirm] of [
      ["질문 1/3", PRODUCT, "다음 질문"],
      ["질문 2/3", BUDGET, "다음 질문"],
      ["질문 3/3", CONDITION, "완료"],
    ]) {
      await expect(heading(page, new RegExp(`^${title}`))).toBeFocused();
      await speechButton(page).click();
      await say(page, text);
      await page.getByRole("button", { name: confirm }).click();
    }
    await expect(heading(page, "요청 내용")).toBeFocused();
    await page.getByRole("button", { name: "봉사자 매칭 요청" }).click();
    await expect(queuedHeading(page)).toBeFocused();
  });

  test("첫 화면에서 바로 기본 질문으로 갈 수 있고, ?basic=1은 기존 흐름이다", async ({ page }) => {
    await openUserScreen(page);
    await page.getByRole("button", { name: "기본 질문으로 하기" }).click();
    await expect(heading(page, /^질문 1\/3/)).toBeFocused();

    await page.goto("/?basic=1");
    await expect(page.getByText("질문 3개에 답하면 봉사자에게 요청을 보냅니다.")).toBeVisible();
    await expect(page.getByRole("button", { name: "기본 질문으로 하기" })).toHaveCount(0);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(heading(page, /^질문 1\/3/)).toBeFocused();
  });

  test("대화가 너무 길다는 응답(400)이면 다시 시도 없이 기본 질문으로만 간다", async ({ page }) => {
    await page.route("**/api/requests/converse", (route) =>
      route.fulfill({ status: 400, json: { ok: false, error: "too_long" } }),
    );
    await openUserScreen(page);
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(status(page)).toHaveText("대화가 너무 길어졌습니다. 기본 질문으로 하세요.");
    await expect(page.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "기본 질문으로 하기" })).toBeVisible();
  });

  test("접수가 실패하면 요약에서 같은 요청을 다시 보낼 수 있다", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/requests", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({ status: 503, json: { ok: false, error: "store_unavailable" } });
      }
      return route.fallback();
    });
    await openUserScreen(page);
    await chatUntilConfirm(page);
    await page.getByRole("button", { name: CONSENT }).click();
    await expect(heading(page, "요청 내용")).toBeVisible();
    await expect(page.getByText(`찾는 제품: ${PRODUCT}`)).toBeVisible();
    await page.getByRole("button", { name: "봉사자 매칭 요청" }).click();
    await expect(queuedHeading(page)).toBeFocused();
  });
});

test.describe("봉사자 화면 연동", () => {
  test("AI 대화로 접수한 요청이 봉사자 대기열에 새 카드로 뜬다", async ({ page }) => {
    await openUserScreen(page);
    const unique = `sony 헤드셋 AI대화${randomUUID().slice(0, 8)}`;
    await chatUntilConfirm(page, unique);
    await page.getByRole("button", { name: CONSENT }).click();
    await expect(queuedHeading(page)).toBeFocused();

    const volunteer = await page.context().newPage();
    await volunteer.goto("/volunteer");
    await expect(volunteer.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
    const card = volunteer.locator(".vol-card").filter({ hasText: unique });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("대기", { exact: true })).toBeVisible();
    await expect(card).toContainText(BUDGET);
    await volunteer.screenshot({ path: "test-results/user-ai-volunteer-queue.png" });
  });
});
