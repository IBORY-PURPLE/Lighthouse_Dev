import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installResearchMock, PNG_1X1, REQUEST_ID, type MockHandle } from "./helpers/researchMock";

// 대화형 리서치 챗(D안) 화면 시험, 노트북 크롬(e2e-desktop).
// 서버 라우트(design.md 3.2)가 stage에 병합되기 전이라 응답은 Playwright 가로채기(helpers/researchMock.ts)가 돌려준다.
// 통합 단계에서 실제 서버(LLM_MODE=mock)로 바꾼다. 실제 AI·웹 검색·VoiceOver·실제 노트북 크롬 낭독은 여기서 판정하지 않는다.
// RESEARCH_SHOTS가 있으면 그 폴더에 화면 캡처를 남긴다(육안 확인용).

const SHOTS = process.env.RESEARCH_SHOTS;

async function settle(page: Page) {
  // 들어오는 움직임이 끝날 때까지 기다린다(반복하는 점은 제외).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await settle(page);
  // 대화 맨 아래로 부드럽게 스크롤하는 시간(JS 스크롤은 움직임 목록에 없다).
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function open(page: Page, mock?: Parameters<typeof installResearchMock>[1]): Promise<MockHandle> {
  const handle = await installResearchMock(page, mock);
  await page.goto(`/volunteer/requests/${REQUEST_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "리서치 챗" })).toBeVisible();
  return handle;
}

const composer = (page: Page) => page.getByRole("textbox", { name: "답을 적어 주세요" });
const quickGroup = (page: Page) => page.getByRole("group", { name: "빠른 답" });
const log = (page: Page) => page.getByRole("log", { name: "대화" });
const count = (page: Page) => page.getByTestId("required-count");

async function sendText(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

async function expectFits(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** wcag2a·2aa·21aa 위반이 하나도 없다(심각도 구분 없이 0건). */
async function expectNoAxe(page: Page) {
  // 들어오는 움직임이 끝나기 전에는 투명도 때문에 대비가 낮게 재진다.
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => `${node.target.join(" ")} :: ${node.any[0]?.message ?? ""}`),
    })),
  ).toEqual([]);
}

// ----- 흐름 단계(E2 ~ E12). 각 단계는 앞 단계가 끝난 상태에서 시작한다. -----

async function pickBought(page: Page) {
  await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
  await expect(log(page).getByText("좋아요. 어떤 기종을 쓰고 계세요?")).toBeVisible();
}

async function pickModel(page: Page) {
  await page.getByRole("button", { name: "WH-CH720N", exact: true }).click();
  await expect(log(page).getByText("써 보니 어떠셨어요?")).toBeVisible();
}

async function answerPros(page: Page) {
  await sendText(page, "가볍고 귀가 덜 아파요");
  await expect(log(page).getByText("구매 인증에 쓸 사진을 올려 주세요.")).toBeVisible();
}

async function uploadPhoto(page: Page) {
  await page.getByRole("button", { name: "사진 올리기" }).click();
  const dialog = page.getByRole("dialog", { name: "사진 올리기" });
  await expect(dialog).toBeVisible();
  await dialog.locator("input[type=file]").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByTestId("purchase-badge")).toHaveText("구매 인증됨");
  await expect(page.getByRole("img", { name: "올린 사진 1" })).toBeVisible();
}

async function pickAlt(page: Page) {
  await expect(page.getByRole("list", { name: "웹에서 찾은 관련 제품" })).toBeVisible();
  await page.getByRole("button", { name: "같이 고민했어요 WH-CH520" }).click();
  await expect(log(page).getByText("WH-CH520 대신 720N을 고른 이유가 뭐예요?")).toBeVisible();
}

async function answerReason(page: Page) {
  await sendText(page, "소음 차단이 더 좋고, 오래 써도 귀가 편했어요.");
  await expect(log(page).getByText("살 때 받은 혜택이 있었어요?")).toBeVisible();
}

async function answerBenefits(page: Page) {
  await sendText(page, "카드 할인 받고 무료 배송이었어요");
  // 검색이 길 때 문구가 단계별로 바뀐다(첫 문구).
  await expect(page.getByTestId("thinking")).toContainText("공식몰 행사 찾는 중이에요.");
  await expect(page.getByRole("list", { name: "찾은 혜택" })).toBeVisible({ timeout: 15_000 });
}

async function checkBenefit(page: Page) {
  await page.getByRole("button", { name: "확인했어요 공식 스토어 행사와 사은품" }).click();
  await expect(page.getByRole("button", { name: "확인했어요 공식 스토어 행사와 사은품" })).toHaveAttribute("aria-pressed", "true");
  await expect(log(page).getByText("참고할 링크나 글이 있으면 붙여 주세요.")).toBeVisible();
}

async function skipRefs(page: Page) {
  await quickGroup(page).getByRole("button", { name: "건너뛰기" }).click();
  await expect(log(page).getByText("모은 정보로 이용자에게 보낼 리뷰를 만들어 볼까요?")).toBeVisible();
}

async function makeReview(page: Page) {
  await quickGroup(page).getByRole("button", { name: "리뷰 만들기" }).click();
  await expect(page.getByRole("region", { name: "이용자에게 보낼 리뷰" })).toContainText("AI 초안");
}

test.describe("대화형 리서치 챗 · 노트북 1440", () => {
  test("E1 히어로에서 E12 보내기 완료까지 한 흐름으로 간다", async ({ page }) => {
    const mock = await open(page);

    // E1 히어로: 제목, 알림 알약, 입력창, 시작 칩, 패널 없음.
    await expect(page.getByRole("heading", { level: 2, name: /소니 헤드셋 구매경험\s*리서치 어시스턴트/ })).toBeVisible();
    await expect(page.getByText("요청을 맡았어요 · 이용자: “소니 무선 헤드셋 사고 싶어요”")).toBeVisible();
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매 확인 전");
    await expect(composer(page)).toHaveAttribute("placeholder", "소니 헤드셋을 써 본 경험을 편하게 적어 주세요. 사진도 올릴 수 있어요.");
    await expect(quickGroup(page).getByRole("button")).toHaveText(["구매했어요", "구매하지 않았어요 · 리서치만"]);
    await expect(count(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "마이크" })).toHaveCount(0);
    await shot(page, "e1-hero");

    // E2 기종 질문: 질문 1, 패널 0/4, 후보 칩.
    await pickBought(page);
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "chat");
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매함 · 사진 전");
    await expect(count(page)).toHaveText("필수 0/4");
    await expect(page.getByText("AI 제안 · 웹에서 찾은 후보 3개")).toBeVisible();
    await expect(page.getByTestId("current-question")).toContainText("질문 1 · 기종");
    await expect(composer(page)).toBeFocused();
    await shot(page, "e2-model");

    // E3 R1: 칩으로 기종, 글로 장점 → 칸 채움, 사진 요청.
    await pickModel(page);
    await expect(count(page)).toHaveText("필수 1/4");
    await answerPros(page);
    await expect(count(page)).toHaveText("필수 2/4");
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매함 · 사진 전");

    // E4 구매 인증됨: 사진 말풍선, 배지, 다음 질문.
    await uploadPhoto(page);
    await expect(count(page)).toHaveText("필수 3/4");
    await expect(log(page).getByText("같이 고민한 제품이 있었나요?")).toBeVisible();
    await shot(page, "e4-photo");

    // E5 제품 카드(최대 2), 공식 페이지·사진 보기 링크, 대안 이유 질문.
    await expect(page.getByRole("list", { name: "웹에서 찾은 관련 제품" }).getByRole("listitem")).toHaveCount(4);
    const photoLink = page.getByRole("link", { name: /^사진 보기 WH-1000XM5/ });
    await expect(photoLink).toHaveAttribute("href", /google\.com\/search\?tbm=isch&q=WH-1000XM5/);
    await expect(photoLink).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: /^공식 페이지 WH-CH520/ })).toHaveAttribute("href", "https://www.sony.co.kr/ch520");
    await expect(page.getByText("AI 제안", { exact: true }).first()).toBeVisible();
    await pickAlt(page);
    await expect(page.getByText("봉사자가 고름")).toBeVisible();
    await expect(count(page)).toHaveText("필수 3/4");
    await shot(page, "e5-products");

    // E6 혜택 질문 → 경험 → Thinking, E7 혜택 결과.
    await answerReason(page);
    await expect(count(page)).toHaveText("필수 4/4");
    await expect(page.getByTestId("panel-note")).toContainText("필수 칸 4개를 모두 채웠어요");
    await answerBenefits(page);
    await expect(page.getByText("카드 할인과 무료 배송 기준으로 웹에서 4곳을 찾았어요.")).toBeVisible();
    await expect(page.getByText("봉사자 경험과 비교").first()).toBeVisible();
    await expect(page.getByText("직접 확인 필요", { exact: true })).toBeVisible();
    await expect(page.getByText("할인 금액은 링크에서 확인해요.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^열기 공식 스토어 행사와 사은품/ })).toHaveAttribute("rel", /noopener/);
    await expectNoAxe(page);
    await shot(page, "e7-benefits");
    await checkBenefit(page);

    // 질문 7: 건너뛰기 → 리뷰 제안.
    await skipRefs(page);
    await expect(page.getByTestId("research-stage").locator('[data-slot="refs"]')).toHaveAttribute("data-state", "skipped");

    // E9 리뷰 생성: AI 초안과 [검수하기]. 검수 전에는 [보내기]가 없다.
    await makeReview(page);
    await expect(page.getByRole("button", { name: "보내기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "검수하기" })).toBeVisible();
    await shot(page, "e9-review-draft");

    // E10 편집: 글자 수, 막힌 이유(role=alert), 짧으면 [검수 마치기] 막힘.
    await page.getByRole("button", { name: "검수하기" }).click();
    const editor = page.getByRole("textbox", { name: "이용자에게 보낼 리뷰 문단" });
    await expect(editor).toBeFocused();
    await expect(page.getByTestId("review-count")).toContainText("글자 수");
    await expect(composer(page)).toHaveAttribute("readonly", "");
    await editor.fill("짧아요");
    await expect(page.getByRole("button", { name: "검수 마치기" })).toHaveAttribute("aria-disabled", "true");
    await editor.fill("이 리뷰는 WH-CH720N을 직접 쓴 봉사자의 경험이에요. 가볍고 귀가 덜 아파서 오래 써도 편했어요. 가격은 30만 원쯤이었어요. 소음 차단이 더 좋아 보여서 골랐어요.");
    await page.getByRole("button", { name: "검수 마치기" }).click();
    await expect(page.locator(".vc-alert[role=alert]")).toContainText("가격 숫자는 넣을 수 없어요");
    await shot(page, "e10-review-edit");
    await expect(page.getByRole("button", { name: "보내기", exact: true })).toHaveCount(0);
    await editor.fill("이 리뷰는 WH-CH720N을 실제로 구매해 쓰는 봉사자가 직접 겪은 경험이에요. 가볍고 귀가 덜 아파서 두세 시간 써도 편하다고 해요. 소음 차단이 더 좋아 보여 720N을 골랐어요.");
    await expectNoAxe(page);

    // E11 편집 완료: "봉사자 검수 완료" + [보내기], 초점은 [보내기].
    await page.getByRole("button", { name: "검수 마치기" }).click();
    await expect(page.getByText("봉사자 검수 완료")).toBeVisible();
    const send = page.getByRole("button", { name: "보내기", exact: true });
    await expect(send).toBeFocused();
    await expect(page.getByRole("button", { name: "다시 편집하기" })).toBeVisible();
    await shot(page, "e11-review-confirmed");

    // E12 보내기 → 완료 화면(제목에 초점).
    await send.click();
    const done = page.getByRole("heading", { level: 1, name: "완료된 요청" });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(page.getByText("전달 완료")).toBeVisible();

    // 요청 본문 약속: 턴마다 clientTurnId, sessionId, 직전 응답의 version.
    const turns = mock.calls.filter((call) => call.path === "/research/turn");
    expect(turns.length).toBeGreaterThanOrEqual(8);
    const ids = new Set<string>();
    let version = 0;
    for (const turn of turns) {
      expect(turn.body?.sessionId).toBe("11111111-1111-4111-8111-111111111111");
      expect(typeof turn.body?.clientTurnId).toBe("string");
      ids.add(String(turn.body?.clientTurnId));
      expect(turn.body?.baseVersion).toBeGreaterThanOrEqual(version);
      version = Number(turn.body?.baseVersion);
    }
    expect(ids.size).toBe(turns.length);
    const sent = mock.calls.find((call) => call.path === "/research/send");
    expect(sent?.body).toMatchObject({ sessionId: "11111111-1111-4111-8111-111111111111", reviewRev: 1 });
    // 혜택 검색은 202 뒤 폴링으로 받았다.
    expect(mock.calls.filter((call) => call.path === "/research" && call.method === "GET").length).toBeGreaterThanOrEqual(2);
  });

  test("리서치만 경로: 사진 칸·첨부 없음, 필수 3칸", async ({ page }) => {
    await open(page);
    await quickGroup(page).getByRole("button", { name: "구매하지 않았어요 · 리서치만" }).click();
    await expect(log(page).getByText("어떤 기종을 알아보셨어요?")).toBeVisible();
    await expect(count(page)).toHaveText("필수 0/3");
    await expect(page.getByTestId("purchase-badge")).toHaveText("리서치만");
    await expect(page.getByRole("button", { name: "사진 올리기" })).toHaveCount(0);
    await expect(page.locator('[data-slot="photo"]')).toHaveCount(0);
    await expect(page.locator("[data-slot]")).toHaveCount(6);
    await expect(composer(page)).toHaveAttribute("placeholder", "답을 적어 주세요");
    await shot(page, "research-only");
  });

  test("히어로에서 대화로 넘어가도 같은 입력창이고 적던 글이 남는다", async ({ page }) => {
    await open(page);
    const input = page.locator("#vc-composer-input");
    await input.fill("아직 보내지 않은 글");
    const handle = await input.elementHandle();
    await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "chat");
    expect(await handle?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(input).toHaveValue("아직 보내지 않은 글");
    await expect(page.locator("form.vc-composer")).toHaveClass(/vc-composer--docked/);
  });

  test("새로 고쳐도 서버 상태로 이어진다", async ({ page }) => {
    await open(page);
    await pickBought(page);
    await pickModel(page);
    await page.reload();
    await expect(log(page).getByText("써 보니 어떠셨어요?")).toBeVisible();
    await expect(count(page)).toHaveText("필수 1/4");
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "chat");
  });

  test("버전이 어긋나면(409 stale) 다시 읽고 쓰던 글을 그대로 둔다", async ({ page }) => {
    const mock = await open(page);
    mock.failNextTurn(409, "stale");
    await sendText(page, "써 본 경험을 적어요");
    await expect(page.getByText("다른 곳에서 내용이 바뀌어 다시 불러왔어요. 쓴 글은 그대로 두었어요.")).toBeVisible();
    await expect(composer(page)).toHaveValue("써 본 경험을 적어요");
    expect(mock.calls.some((call) => call.path === "/research" && call.method === "GET")).toBe(true);
  });

  test("움직임 줄이기: 점이 멈추고 입력은 막히지 않는다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, { turnDelayMs: 2500 });
    await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
    const thinking = page.getByTestId("thinking");
    await expect(thinking).toContainText("생각하는 중이에요.");
    const dot = thinking.locator(".lh-thinking-dot").first();
    expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    expect(await dot.evaluate((node) => getComputedStyle(node).opacity)).toBe("0.6");
    // 기다리는 동안에도 입력할 수 있다.
    await composer(page).fill("기다리는 중에 쓰는 글");
    await expect(composer(page)).toHaveValue("기다리는 중에 쓰는 글");
    await expect(log(page).getByText("좋아요. 어떤 기종을 쓰고 계세요?")).toBeVisible();
  });

  test("움직임 기본: 생각 중 점이 반복해서 움직인다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page, { turnDelayMs: 2500 });
    await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
    const dot = page.getByTestId("thinking").locator(".lh-thinking-dot").first();
    expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("lh-dot");
    // 점은 낭독기에서 숨긴다.
    await expect(page.getByTestId("thinking").locator(".vc-dots")).toHaveAttribute("aria-hidden", "true");
  });

  test("axe: 히어로와 대화 화면에 위반이 없다(1440)", async ({ page }) => {
    await open(page);
    await expectNoAxe(page);
    await pickBought(page);
    await pickModel(page);
    await expectNoAxe(page);
  });
});

test.describe("대화형 리서치 챗 · 1024", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("패널이 접히고 가로로 넘치지 않으며, 버튼으로 열고 닫는다", async ({ page }) => {
    await open(page);
    await expectFits(page);
    await expectNoAxe(page);
    await pickBought(page);
    await pickModel(page);
    await answerPros(page);
    await uploadPhoto(page);
    await pickAlt(page);
    await answerReason(page);
    await answerBenefits(page);

    // 접힌 패널: 화면에 없고 위 바의 버튼이 필수 개수를 알린다.
    const toggle = page.getByRole("button", { name: /^모은 정보 필수 4\/4/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(count(page)).toBeHidden();
    await expectFits(page);
    await expectNoAxe(page);
    await shot(page, "w1024-benefits");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(count(page)).toBeVisible();
    await expectFits(page);
    await shot(page, "w1024-panel-open");
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(count(page)).toBeHidden();
  });
});
