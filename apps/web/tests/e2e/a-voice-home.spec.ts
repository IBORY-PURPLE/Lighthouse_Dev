import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./helpers/fakeSpeech";

// 이용자 화면(/)은 apps/user-voice-ui의 음성 대화 화면이다(PR 합병). 가짜 음성 인식과 가짜 AI(LLM_MODE=mock) 기준이다.
// 원본 화면에는 텍스트 답변 입력이 없어(음성 인식만) 가짜 음성 인식으로 답한다.
// 실제 음성 인식, 소리 내어 읽어 주기, VoiceOver 낭독, 실제 OpenAI 응답은 사람이 판정한다.
// 파일 이름이 a-로 시작하는 까닭: 봉사자 대기열은 오래 기다린 순으로 20건(QUEUE_LIMIT)만 보인다.
// 다른 시험 파일이 접수 요청을 쌓기 전에 돌아야 새 카드가 목록에 보인다(Playwright는 파일 이름순으로 돈다).

const BUDGET = "10만 원 이하";

declare global {
  interface Window {
    __spoken: string[];
  }
}

/** 읽어 주기를 가짜로 바꾼다: 읽은 글을 모으고 바로 끝났다고 알린다(헤드리스 브라우저에는 목소리가 없다). */
async function installFakeSynthesis(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    window.__spoken = spoken;
    class FakeUtterance {
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    const target = window as unknown as Record<string, unknown>;
    target.SpeechSynthesisUtterance = FakeUtterance;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance: FakeUtterance) {
          spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 0);
        },
      },
    });
  });
}

async function openVoiceHome(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
  await installFakeSpeech(page);
  await installFakeSynthesis(page);
  await page.goto("/");
}

const spoken = (page: Page) => page.evaluate(() => window.__spoken);
const heardAI = (page: Page, text: string) =>
  expect.poll(() => spoken(page)).toContain(text);

test.describe("/ 이용자 화면(음성 대화)", () => {
  test("/는 동료 화면(홈: 상품 요청·저장된 상품 목록)이고 고정 질문 화면은 /classic이다", async ({
    page,
  }) => {
    await openVoiceHome(page);
    await expect(page).toHaveTitle("LightHouse MVP");
    await expect(page.getByRole("button", { name: "상품 요청", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "저장된 상품 목록" })).toBeVisible();
    await expect(page.getByRole("button", { name: "시작하기" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/voice-home.png" });

    await page.goto("/classic");
    await expect(page.getByRole("heading", { level: 1, name: "LightHouse 상품 요청" })).toBeVisible();
    await expect(page.getByRole("button", { name: "시작하기" })).toBeVisible();
  });

  test("AI 대화 → 확정 → 접수 → 봉사자 목록에 새 카드", async ({ page }) => {
    const chatBodies: { sessionId: string; message: string; reset: boolean; history: unknown[] }[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/voice/chat")) chatBodies.push(request.postDataJSON());
    });
    await openVoiceHome(page);
    const product = `sony 헤드셋 연동${randomUUID().slice(0, 8)}`;

    await page.getByRole("button", { name: "상품 요청", exact: true }).click();
    await expect(page.locator("#conversation")).toHaveClass(/active/);
    await expect(page.locator(".orb")).toHaveAttribute("aria-hidden", "true");
    await heardAI(page, "어떤 상품을 찾으세요?");
    await expect(page.locator("#conversation")).toHaveClass(/listening/);
    await page.screenshot({ path: "test-results/voice-conversation.png" });

    await say(page, product);
    await heardAI(page, "예산은 얼마인가요?");
    await say(page, BUDGET);
    await heardAI(page, `${product}, 예산 ${BUDGET}. 이 내용으로 구매 요청을 등록할까요?`);

    // 동의 전에는 접수하지 않았다.
    expect(await page.evaluate(() => localStorage.getItem("lh-requests"))).toBeNull();

    const registered = page.waitForResponse(
      (response) => response.url().endsWith("/api/requests") && response.request().method() === "POST",
    );
    await say(page, "네, 등록해 주세요");
    const response = await registered;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({
      clientRequestId: chatBodies[0].sessionId,
      product,
      budget: BUDGET,
      condition: "정하지 않음",
    });

    // 원본 흐름 그대로: 읽어 준 뒤 목록 화면으로 가고 기기 안 목록에 카드가 생긴다.
    await heardAI(page, "구매 요청을 등록했어요.");
    await expect(page.locator("#list")).toHaveClass(/active/);
    await expect(page.locator("#requests .card").first()).toContainText(product);
    await page.screenshot({ path: "test-results/voice-list.png" });

    // 서버는 기록을 저장하지 않는다: 매 호출이 같은 대화 id로 기록 전체를 보냈다.
    expect(chatBodies.map((body) => [body.reset, body.history.length])).toEqual([
      [true, 0],
      [false, 2],
      [false, 4],
      [false, 6],
    ]);
    expect(new Set(chatBodies.map((body) => body.sessionId)).size).toBe(1);
    expect(chatBodies.map((body) => body.message)).toEqual(["", product, BUDGET, "네, 등록해 주세요"]);

    // 봉사자 화면: 방금 접수한 요청이 대기열에 뜬다.
    const volunteer = await page.context().newPage();
    await volunteer.goto("/volunteer");
    await expect(volunteer.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await volunteer.getByRole("button", { name: "대기열·내 담당" }).click();
    const card = volunteer.getByTestId("queue-card").filter({ hasText: product });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("대기", { exact: true })).toBeVisible();
    await expect(card).toContainText(BUDGET);
    await volunteer.screenshot({ path: "test-results/voice-volunteer-queue.png" });
  });

  test("저장된 상품 상세에는 검증 리뷰 한 문단만 있고 후보 목록·구매 링크·가격이 없다", async ({ page }) => {
    await openVoiceHome(page);
    await page.getByRole("button", { name: "저장된 상품 목록" }).click();
    await expect(page.locator("#list")).toHaveClass(/active/);
    // 이용자 화면은 정적 시연 화면이라 저장된 정보 카드는 모두 이 소니 헤드셋 상세를 연다(서버에서 결과를 받아 그리는 곳은 아직 없다).
    await page.locator("#list .card:not(.pending)", { hasText: "소니 무선 헤드셋" }).click();
    const detail = page.locator("#detail");
    await expect(detail).toHaveClass(/active/);
    // 읽히는 것은 봉사자가 검수한 리뷰 문단 하나다.
    const review = detail.getByRole("article", { name: "봉사자 리뷰" });
    await expect(review).toBeVisible();
    await expect(review.locator("#review-text")).toContainText("봉사자가 직접 구매해 사용한 제품");
    await expect(detail.getByRole("link")).toHaveCount(0);
    // 버튼은 뒤로 가기와 목록으로 이동 둘뿐이다("상품 링크 바로가기"는 없다).
    await expect(detail.getByRole("button")).toHaveCount(2);
    await expect(detail.getByRole("button", { name: "요청 목록으로 이동" })).toBeVisible();
    // 리뷰 상자(article)는 제목과 리뷰 문단 하나뿐이다.
    await expect(review.locator("p")).toHaveCount(1);
    const text = await detail.innerText();
    expect(text).not.toMatch(/링크|\d[\d,]*\s*원|후보|상세 요약/);
    await page.screenshot({ path: "../../test-results/demo6-shots/user-result-review-only.png", fullPage: true });
  });

  test("AI 호출이 실패하면 원본처럼 안내하고 다시 듣는다", async ({ page }) => {
    await page.route("**/api/voice/chat", (route) =>
      route.fulfill({ status: 500, json: { error: "AI 요청에 실패했습니다." } }),
    );
    await openVoiceHome(page);
    await page.getByRole("button", { name: "상품 요청", exact: true }).click();
    await heardAI(page, "연결에 문제가 생겼어요. 다시 말씀해 주세요.");
    await expect(page.locator("#conversation")).toHaveClass(/listening/);
  });

  test("접수가 실패해도 원본 흐름(목록 화면)은 그대로다", async ({ page }) => {
    await page.route("**/api/requests", (route) =>
      route.fulfill({ status: 503, json: { ok: false, error: "store_unavailable" } }),
    );
    await openVoiceHome(page);
    await page.getByRole("button", { name: "상품 요청", exact: true }).click();
    await heardAI(page, "어떤 상품을 찾으세요?");
    await say(page, "sony 헤드셋");
    await heardAI(page, "예산은 얼마인가요?");
    await say(page, BUDGET);
    await heardAI(page, "sony 헤드셋, 예산 10만 원 이하. 이 내용으로 구매 요청을 등록할까요?");
    await say(page, "네");
    await expect(page.locator("#list")).toHaveClass(/active/);
    await expect(page.locator("#requests .card").first()).toContainText("sony 헤드셋");
  });
});
