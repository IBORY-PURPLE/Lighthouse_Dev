import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { claimDemo, enterAs, FIRST_DEMO_QUOTE, refill } from "./helpers/volunteerFlow";

// 대화형 리서치 챗(D안) 화면 시험, 노트북 크롬(e2e-desktop).
// 실제 Next 서버(LLM_MODE=mock, 메모리 저장소, playwright.config의 webServer)에 붙는다. 가로채기로 응답을 꾸미지 않는다
// (움직임·생각 중 표시를 보려고 응답을 늦추는 것만 page.route의 continue로 한다).
// 가짜 AI 기준이다. 실제 AI·웹 검색·VoiceOver·실제 노트북 크롬 낭독은 여기서 판정하지 않는다.
// RESEARCH_SHOTS가 있으면 그 폴더에 화면 캡처를 남긴다(육안 확인·화면 증거용).

const SHOTS = process.env.RESEARCH_SHOTS;

/** 읽을 수 있는 1x1 PNG(사진 올리기 시험용). 화면이 JPEG로 줄여 올린다. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

// 서버의 가짜 AI(src/lib/researchMock.ts, researchSearch.ts)가 주는 이름. 칩·카드는 서버가 보인 목록에서만 고를 수 있다.
const MODEL = "가짜 헤드셋 LH-200";
const ALT = "가짜 헤드셋 LH-500";

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

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** 입장 → 시연용 요청 채우기 → 첫 요청 맡기. 요청 모양(리서치 API 호출)을 기록해 돌려준다. */
async function begin(page: Page): Promise<Call[]> {
  // 주소별 횟수 제한이 시험끼리 번지지 않게 시험마다 다른 주소로 보이게 한다.
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `e2e-${randomUUID()}` });
  const calls: Call[] = [];
  page.on("request", (request) => {
    const match = /\/api\/volunteer\/requests\/[0-9a-f-]{36}(\/research.*)$/.exec(new URL(request.url()).pathname);
    if (!match) return;
    let body: Record<string, unknown> | null = null;
    try {
      body = request.postDataJSON() as Record<string, unknown> | null;
    } catch {
      body = null;
    }
    calls.push({ method: request.method(), path: match[1], body });
  });
  await enterAs(page);
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);
  // 불러오는 화면(제목만 있다)이 아니라 대화 화면이 그려질 때까지 기다린다.
  await expect(page.getByTestId("research-stage")).toBeVisible();
  return calls;
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
  await page.getByRole("button", { name: MODEL, exact: true }).click();
  await expect(log(page).getByText(`${MODEL}의 장점이 뭐예요?`)).toBeVisible();
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
  await page.getByRole("button", { name: `같이 고민했어요 ${ALT}` }).click();
  await expect(log(page).getByText("왜 같이 고민했나요?")).toBeVisible();
}

async function answerReason(page: Page) {
  await sendText(page, "소음 차단이 더 좋고, 오래 써도 귀가 편했어요.");
  await expect(log(page).getByText("살 때 받은 혜택이 있었어요?")).toBeVisible();
}

const REFS_QUESTION = "참고한 블로그 글이나 영상이 있으면 링크나 한 줄로 알려 주세요.";

async function answerBenefits(page: Page) {
  await sendText(page, "카드 할인 받고 무료 배송이었어요");
  await expect(page.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });
}

async function checkBenefit(page: Page) {
  const button = page.getByRole("button", { name: "확인했어요 공식몰 사은품 행사" });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function skipRefs(page: Page) {
  await quickGroup(page).getByRole("button", { name: "건너뛰기" }).click();
  await expect(log(page).getByText("모은 정보로 이용자에게 보낼 리뷰를 만들어 볼까요?")).toBeVisible();
}

async function makeReview(page: Page) {
  await quickGroup(page).getByRole("button", { name: "리뷰 만들기" }).click();
  await expect(page.getByRole("region", { name: "이용자에게 보낼 리뷰" })).toContainText("AI 초안");
}

const GOOD_REVIEW =
  `이 리뷰는 ${MODEL}을 실제로 구매해 쓰는 봉사자가 직접 겪은 경험이에요. 가볍고 귀가 덜 아파서 두세 시간 써도 편하다고 해요. 소음 차단이 더 좋아 보여 이 제품을 골랐어요.`;
const PRICE_REVIEW =
  `이 리뷰는 ${MODEL}을 직접 쓴 봉사자의 경험이에요. 가볍고 귀가 덜 아파서 오래 써도 편했어요. 가격은 30만 원쯤이었어요. 소음 차단이 더 좋아 보여서 골랐어요.`;

test.describe("대화형 리서치 챗 · 노트북 1440", () => {
  test("E1 히어로에서 E12 보내기 완료까지 한 흐름으로 간다", async ({ page }) => {
    test.setTimeout(120_000);
    const calls = await begin(page);

    // E1 히어로: 제목, 알림 알약, 입력창, 시작 칩, 패널 없음.
    await expect(page.getByRole("heading", { level: 2, name: /소니 헤드셋 구매경험\s*리서치 어시스턴트/ })).toBeVisible();
    await expect(page.getByText("요청을 맡았어요 · 이용자: “소니 무선 헤드셋 사고 싶어요”")).toBeVisible();
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매 확인 전");
    // 위 바의 요청 줄에 이용자가 말한 조건(새 제품)이 있다.
    await expect(page.getByText("품목 헤드셋 · 브랜드 소니 · 예산 30만 원 안쪽 · 새 제품")).toBeVisible();
    await expect(composer(page)).toHaveAttribute("placeholder", "소니 헤드셋을 써 본 경험을 편하게 적어 주세요. 사진도 올릴 수 있어요.");
    await expect(quickGroup(page).getByRole("button")).toHaveText(["구매했어요", "구매하지 않았어요 · 리서치만"]);
    await expect(count(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "마이크" })).toHaveCount(0);
    await shot(page, "research-home");

    // E2 기종 질문: 질문 1, 패널 0/4, 서버가 웹 검색(가짜)으로 찾은 후보 칩과 쇼핑몰 바로가기.
    await pickBought(page);
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "chat");
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매함 · 사진 전");
    await expect(count(page)).toHaveText("필수 0/4");
    await expect(page.getByText("AI 제안 · 웹에서 찾은 후보 3개")).toBeVisible();
    await expect(page.getByRole("link", { name: /^쿠팡에서 찾기/ })).toHaveAttribute("href", /coupang\.com/);
    await expect(page.getByTestId("current-question")).toContainText("질문 1 · 기종");
    await expect(composer(page)).toBeFocused();

    // E3: 칩으로 기종, 글로 장점 → 칸 채움, 사진 요청.
    await pickModel(page);
    await expect(count(page)).toHaveText("필수 1/4");
    await answerPros(page);
    await expect(count(page)).toHaveText("필수 2/4");
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매함 · 사진 전");

    // E4 구매 인증됨: 사진 말풍선, 배지, 다음 질문(같이 고민한 제품).
    await uploadPhoto(page);
    await expect(count(page)).toHaveText("필수 3/4");
    await expect(log(page).getByText("같이 고민한 다른 제품이 있나요?")).toBeVisible();

    // E5 제품 카드(서버가 사진 뒤 alts 검색을 시작하게 한다), 공식 페이지·사진 보기 링크, 대안 이유 질문.
    await expect(page.getByRole("list", { name: "웹에서 찾은 관련 제품" }).getByRole("listitem")).toHaveCount(3);
    const photoLink = page.getByRole("link", { name: new RegExp(`^사진 보기 ${ALT}`) });
    await expect(photoLink).toHaveAttribute("href", new RegExp(`google\\.com/search\\?tbm=isch&q=${encodeURIComponent(ALT).replace(/[()]/g, "\\$&")}`));
    await expect(photoLink).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: new RegExp(`^공식 페이지 ${ALT}`) })).toHaveAttribute("href", "https://example.com/products/lh-500");
    await expect(page.getByText("AI 제안", { exact: true }).first()).toBeVisible();
    await pickAlt(page);
    await expect(page.getByText("봉사자가 고름")).toBeVisible();
    await expect(count(page)).toHaveText("필수 3/4");

    // E6 혜택 질문 → 경험 → 생각 중(검색을 늦춰 본다) → E7 혜택 결과. 질문 7은 혜택 카드 뒤에 온다.
    await answerReason(page);
    await expect(count(page)).toHaveText("필수 4/4");
    await expect(page.getByTestId("panel-note")).toContainText("필수 칸 4개를 모두 채웠어요");
    let releaseSearch: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    await page.route("**/research/search", async (route) => {
      await held;
      await route.continue();
    });
    await sendText(page, "카드 할인 받고 무료 배송이었어요");
    await expect(page.getByTestId("thinking")).toContainText("공식몰 행사 찾는 중이에요.");
    await expect(log(page).getByText(REFS_QUESTION)).toHaveCount(0);
    releaseSearch();
    await expect(page.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("혜택 3개를 찾았어요", { exact: false })).toBeVisible();
    await expect(page.getByText("봉사자 경험과 비교").first()).toBeVisible();
    await expect(page.getByText("직접 확인 필요", { exact: true })).toBeVisible();
    await expect(page.getByText("할인 금액은 링크에서 확인해요.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^열기 공식몰 사은품 행사/ })).toHaveAttribute("rel", /noopener/);
    // 질문 7 말풍선이 마지막 혜택 카드 아래에 있다.
    await expect(log(page).getByText(REFS_QUESTION)).toBeVisible();
    const order = await page.evaluate((refs) => {
      const lists = [...document.querySelectorAll('ul[aria-label="찾은 혜택"]')];
      const bubble = [...document.querySelectorAll(".vc-bubble")].find((node) => node.textContent?.includes(refs));
      const last = lists[lists.length - 1];
      return last && bubble ? Boolean(last.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    }, REFS_QUESTION);
    expect(order).toBe(true);
    await expectNoAxe(page);
    await shot(page, "research-benefits");
    await checkBenefit(page);

    // 질문 7: 건너뛰기 → 리뷰 제안.
    await skipRefs(page);
    await expect(page.getByTestId("research-stage").locator('[data-slot="refs"]')).toHaveAttribute("data-state", "skipped");

    // E9 리뷰 생성: AI 초안과 [검수하기]. 검수 전에는 [보내기]가 없다.
    await makeReview(page);
    await expect(page.getByRole("button", { name: "보내기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "검수하기" })).toBeVisible();

    // E10 편집: 글자 수, 막힌 이유(role=alert), 짧으면 [검수 마치기] 막힘.
    await page.getByRole("button", { name: "검수하기" }).click();
    const editor = page.getByRole("textbox", { name: "이용자에게 보낼 리뷰 문단" });
    await expect(editor).toBeFocused();
    await expect(page.getByTestId("review-count")).toContainText("글자 수");
    await expect(composer(page)).toHaveAttribute("readonly", "");
    await editor.fill("짧아요");
    await expect(page.getByRole("button", { name: "검수 마치기" })).toHaveAttribute("aria-disabled", "true");
    await editor.fill(PRICE_REVIEW);
    await page.getByRole("button", { name: "검수 마치기" }).click();
    await expect(page.locator(".vc-alert[role=alert]")).toContainText("가격·재고·할인으로 보이는 표현이 있어요");
    await expect(page.getByRole("button", { name: "보내기", exact: true })).toHaveCount(0);
    await shot(page, "research-review-edit");
    await editor.fill(GOOD_REVIEW);
    await expectNoAxe(page);

    // E11 편집 완료: "봉사자 검수 완료" + [보내기], 초점은 [보내기].
    await page.getByRole("button", { name: "검수 마치기" }).click();
    await expect(page.getByText("봉사자 검수 완료")).toBeVisible();
    const send = page.getByRole("button", { name: "보내기", exact: true });
    await expect(send).toBeFocused();
    await expect(page.getByRole("button", { name: "다시 편집하기" })).toBeVisible();

    // E12 보내기 → 완료 화면(제목에 초점).
    await send.click();
    const done = page.getByRole("heading", { level: 1, name: "완료된 요청" });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(page.getByText("전달 완료")).toBeVisible();
    await shot(page, "volunteer-sent");

    // 요청 본문 약속: 턴마다 clientTurnId(모두 다름), 같은 sessionId, 올라가는 baseVersion. 결과를 쓰는 길은 send 하나다.
    const turns = calls.filter((call) => call.path === "/research/turn" && call.method === "POST");
    expect(turns.length).toBeGreaterThanOrEqual(8);
    const ids = new Set<string>();
    const sessions = new Set<string>();
    let version = 0;
    for (const turn of turns) {
      sessions.add(String(turn.body?.sessionId));
      ids.add(String(turn.body?.clientTurnId));
      expect(Number(turn.body?.baseVersion)).toBeGreaterThanOrEqual(version);
      version = Number(turn.body?.baseVersion);
    }
    expect(ids.size).toBe(turns.length);
    expect(sessions.size).toBe(1);
    const sends = calls.filter((call) => call.path === "/research/send");
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toMatchObject({ sessionId: [...sessions][0] });
    expect(calls.some((call) => call.path.endsWith("/result"))).toBe(false);
    // 서버가 알린 검색(followUp)만 불렀다: 기종, 대안, 혜택.
    expect(calls.filter((call) => call.path === "/research/search").map((call) => call.body?.kind)).toEqual(["model", "alts", "benefits"]);
  });

  test("히어로 글에 혜택 이야기를 앞질러 적어도 혜택 카드가 나오고, [확인했어요]는 서버가 받은 뒤 확인함이 되어 새로 고쳐도 남는다", async ({ page }) => {
    test.setTimeout(90_000);
    const calls = await begin(page);
    // 구매 여부와 혜택 경험을 한 글에 적는다. 서버는 기종 질문(followUp model)을 주고 혜택 칸도 채운다.
    await sendText(page, "소니 헤드셋 샀어요. 카드 할인 받고 무료 배송이었어요");
    await expect(page.getByText("AI 제안 · 웹에서 찾은 후보 3개")).toBeVisible();
    // 기종 검색 뒤에 화면이 혜택 검색을 이어서 부른다(followUp은 하나만 온다).
    await expect(page.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });
    expect(calls.filter((call) => call.path === "/research/search").map((call) => call.body?.kind)).toEqual(["model", "benefits"]);

    // 카드 둘을 잇따라 누른다. 두 번째는 첫 번째 턴이 끝난 뒤에 보내진다(버려지지 않는다).
    // 혜택은 종류별로 묶음이 따로 오므로 화면 전체의 카드 버튼에서 고른다.
    const buttons = page.getByRole("list", { name: "찾은 혜택" }).getByRole("button", { name: /^확인했어요/ });
    const first = buttons.nth(0);
    const second = buttons.nth(1);
    await first.click();
    await second.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    expect(calls.filter((call) => call.path === "/research/turn" && (call.body?.input as { type?: string } | undefined)?.type === "link_check")).toHaveLength(2);

    // 새로 고쳐도 서버 칸에서 둘 다 확인함으로 돌아온다.
    await page.reload();
    const again = page.getByRole("list", { name: "찾은 혜택" }).getByRole("button", { name: /^확인했어요/ });
    await expect(again.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(again.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(again.nth(2)).toHaveAttribute("aria-pressed", "false");
  });

  test("기종 검색이 끝나기 전에 새로 고쳐 혜택 칸만 찬 채 카드가 없어도, 읽은 직후 혜택 검색을 불러 카드가 나온다", async ({ page }) => {
    test.setTimeout(90_000);
    // 기종·혜택 검색 호출을 처음 한 번씩만 네트워크 단계에서 끊어(서버는 못 받음) "혜택 칸은 찼는데 혜택 카드가 없는" 서버 상태를 만든다.
    const cut = new Set<string>();
    await page.route("**/research/search", async (route) => {
      const kind = String((route.request().postDataJSON() as { kind?: string } | null)?.kind);
      if ((kind === "model" || kind === "benefits") && !cut.has(kind)) {
        cut.add(kind);
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    const calls = await begin(page);
    await sendText(page, "소니 헤드셋 샀어요. 카드 할인 받고 무료 배송이었어요");
    await expect.poll(() => cut.size, { timeout: 15_000 }).toBe(2);
    await expect(page.getByRole("list", { name: "찾은 혜택" })).toHaveCount(0);

    // 새로 고치면 처음 읽기만으로 혜택 검색을 부른다(턴·다른 검색 없이).
    const before = calls.length;
    await page.reload();
    await expect(page.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });
    const after = calls.slice(before).filter((call) => call.method === "POST");
    expect(after.map((call) => `${call.path}:${String(call.body?.kind ?? "")}`)).toEqual(["/research/search:benefits"]);
  });

  test("혜택 카드가 없는 채 새로 고치면 혜택 검색이 끝날 때까지 질문 7을 그리지 않고, 카드가 온 뒤 카드 아래에 나온다", async ({ page }) => {
    test.setTimeout(120_000);
    // 처음 혜택 검색 호출은 끊고(서버는 못 받음), 새로 고친 뒤의 호출은 붙들었다 놓는다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let benefitsCalls = 0;
    await page.route("**/research/search", async (route) => {
      const kind = (route.request().postDataJSON() as { kind?: string } | null)?.kind;
      if (kind !== "benefits") {
        await route.continue();
        return;
      }
      benefitsCalls += 1;
      if (benefitsCalls === 1) {
        await route.abort("failed");
        return;
      }
      await gate;
      await route.continue();
    });
    await begin(page);
    await pickBought(page);
    await pickModel(page);
    await answerPros(page);
    await uploadPhoto(page);
    await pickAlt(page);
    await answerReason(page);
    await sendText(page, "카드 할인 받고 무료 배송이었어요");
    await expect(page.getByText("찾지 못했어요. 쇼핑몰에서 직접 찾아도 돼요.")).toBeVisible();
    await expect(log(page).getByText(REFS_QUESTION)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("thinking")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(log(page).getByText(REFS_QUESTION)).toHaveCount(0);
    release();
    await expect(page.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });
    const refs = log(page).getByText(REFS_QUESTION);
    await expect(refs).toBeVisible();
    // 질문 7은 마지막 혜택 카드보다 아래에 있다.
    const lastCard = await page.getByRole("list", { name: "찾은 혜택" }).last().boundingBox();
    const refsBox = await refs.boundingBox();
    expect(refsBox!.y).toBeGreaterThan(lastCard!.y);
    expect(benefitsCalls).toBe(2);
  });

  test("검색을 기다리는 사이 다른 탭에서 요청을 내려놓으면, 기다리던 탭이 폴링에서 바로 알아채고 화면을 바꾼다", async ({ page }) => {
    test.setTimeout(60_000);
    // 기종 검색 호출은 "이미 처리 중"(202)으로만 답하게 해 화면이 상태를 폴링하는 중이 되게 하고, 그 사이 다른 탭이 요청을 내려놓는다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/research/search", async (route) => {
      await gate;
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });
    await begin(page);
    await sendText(page, "소니 헤드셋 샀어요.");
    await expect(page.getByTestId("thinking")).toBeVisible();

    const second = await page.context().newPage();
    await second.goto(page.url());
    await expect(second.getByTestId("research-stage")).toBeVisible();
    await second.getByRole("button", { name: "요청 내려놓기" }).click();
    await second.getByRole("button", { name: "돌려놓기" }).click();
    await expect(second.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();

    release();
    // 폴링 간격(2초) 안팎에 알아챈다. 알아채지 못하면 폴링이 90초 돌고 화면이 그대로다.
    await expect(page.getByText(/내 담당이 아니에요/)).toBeVisible({ timeout: 15_000 });
  });

  test("한 탭의 혜택 검색이 늦는 사이 다른 탭이 검색을 끝내면, 늦은 탭도 서버 캐시 응답 뒤에 카드를 읽어 와 보인다", async ({ page }) => {
    test.setTimeout(90_000);
    // 첫 탭의 혜택 검색 호출을 붙들어 둔다. 그 사이 두 번째 탭이 열리며 같은 검색을 먼저 끝낸다. 붙든 호출을 놓으면 서버는 캐시로(메시지 없이 마지막 번호만) 답한다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route("**/research/search", async (route) => {
      const kind = (route.request().postDataJSON() as { kind?: string } | null)?.kind;
      if (kind === "benefits") {
        held += 1;
        await gate;
      }
      await route.continue();
    });
    await begin(page);
    await sendText(page, "소니 헤드셋 샀어요. 카드 할인 받고 무료 배송이었어요");
    await expect.poll(() => held, { timeout: 15_000 }).toBe(1);

    const second = await page.context().newPage();
    await second.goto(page.url());
    await expect(second.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });

    expect(await page.getByRole("list", { name: "찾은 혜택" }).count()).toBe(0);
    release();
    await expect(page.getByRole("list", { name: "찾은 혜택" }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("사진을 올린 뒤 다시 읽기 직전에 다른 탭이 요청을 내려놓으면, 옛 대화에 머물지 않고 화면을 바꾼다", async ({ page }) => {
    test.setTimeout(90_000);
    await begin(page);
    await pickBought(page);
    await pickModel(page);
    await answerPros(page);
    const second = await page.context().newPage();
    await second.goto(page.url());
    await expect(second.getByTestId("research-stage")).toBeVisible();

    // 사진 올리기 응답을 받은 뒤 화면이 서버 상태를 다시 읽기(GET) 직전에 두 번째 탭이 요청을 내려놓게 한다. 그러면 그 GET은 서버가 409 not_in_progress로 답한다.
    let armed = false;
    let released = false;
    await page.route("**/research/photos", async (route) => {
      const response = await route.fetch();
      armed = true;
      await route.fulfill({ response });
    });
    await page.route(
      (url) => /\/research$/.test(url.pathname),
      async (route) => {
        if (armed && !released && route.request().method() === "GET") {
          released = true;
          await second.getByRole("button", { name: "요청 내려놓기" }).click();
          await second.getByRole("button", { name: "돌려놓기" }).click();
          await expect(second.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
        }
        await route.continue();
      },
    );
    await page.getByRole("button", { name: "사진 올리기" }).click();
    const dialog = page.getByRole("dialog", { name: "사진 올리기" });
    await dialog.locator("input[type=file]").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByText(/내 담당이 아니에요/)).toBeVisible({ timeout: 15_000 });
    expect(released).toBe(true);
  });

  test("혜택 검색이 실패해도 안내하고 질문 7이 제자리에 나오며 다음 턴이 막히지 않는다", async ({ page }) => {
    test.setTimeout(120_000);
    // 서버의 한도(CAP) 응답은 환경 변수로 0에 맞출 수 없어(양의 정수만 받는다) 혜택 검색 호출만 네트워크 단계에서 끊는다.
    let cut = 0;
    await page.route("**/research/search", async (route) => {
      const kind = (route.request().postDataJSON() as { kind?: string } | null)?.kind;
      if (kind === "benefits") {
        cut += 1;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await begin(page);
    await pickBought(page);
    await pickModel(page);
    await answerPros(page);
    await uploadPhoto(page);
    await pickAlt(page);
    await answerReason(page);
    await sendText(page, "카드 할인 받고 무료 배송이었어요");
    await expect(page.getByText("찾지 못했어요. 쇼핑몰에서 직접 찾아도 돼요.")).toBeVisible();
    expect(cut).toBe(1);
    await expect(page.getByTestId("thinking")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "찾은 혜택" })).toHaveCount(0);
    // 혜택 카드가 끝내 안 와도 질문 7이 제자리에 보이고, 다음 턴(건너뛰기)을 보낼 수 있다.
    await expect(log(page).getByText(REFS_QUESTION)).toBeVisible();
    await skipRefs(page);
    await expect(count(page)).toHaveText("필수 4/4");
  });

  test("턴을 보내지 못하면 쓴 글을 되돌려 놓고, 다시 보내면 이어진다", async ({ page }) => {
    await begin(page);
    let cut = true;
    await page.route("**/research/turn", async (route) => {
      if (cut) {
        cut = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await composer(page).fill("소니 헤드셋 샀어요");
    await composer(page).press("Enter");
    await expect(page.getByText("보내지 못했어요. 쓴 글은 그대로 두었어요. 다시 보내 주세요.")).toBeVisible();
    await expect(composer(page)).toHaveValue("소니 헤드셋 샀어요");
    await composer(page).press("Enter");
    await expect(log(page).getByText("좋아요. 어떤 기종을 쓰고 계세요?")).toBeVisible();
  });

  test("히어로에서도 모은 정보 패널을 열어 요청을 내려놓을 수 있다(1440)", async ({ page }) => {
    await begin(page);
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "hero");
    const toggle = page.getByRole("button", { name: /^모은 정보/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.getByRole("button", { name: "요청 내려놓기" }).click();
    await page.getByRole("button", { name: "돌려놓기" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
  });

  test("리서치만 경로: 사진 칸·첨부 없음, 필수 3칸", async ({ page }) => {
    await begin(page);
    await quickGroup(page).getByRole("button", { name: "구매하지 않았어요 · 리서치만" }).click();
    await expect(log(page).getByText("어떤 기종을 알아보셨어요?")).toBeVisible();
    await expect(count(page)).toHaveText("필수 0/3");
    await expect(page.getByTestId("purchase-badge")).toHaveText("리서치만");
    await expect(page.getByRole("button", { name: "사진 올리기" })).toHaveCount(0);
    await expect(page.locator('[data-slot="photo"]')).toHaveCount(0);
    await expect(page.locator("[data-slot]")).toHaveCount(6);
    await expect(composer(page)).toHaveAttribute("placeholder", "답을 적어 주세요");
    // 리서치만도 후보 칩 → 장점 → (사진 없이) 같이 고민한 제품 카드까지 간다.
    await page.getByRole("button", { name: MODEL, exact: true }).click();
    await sendText(page, "가볍고 귀가 덜 아파요");
    await expect(log(page).getByText("같이 고민한 다른 제품이 있나요?")).toBeVisible();
    await expect(page.getByRole("list", { name: "웹에서 찾은 관련 제품" })).toBeVisible();
    await expect(count(page)).toHaveText("필수 2/3");
  });

  test("히어로에서 대화로 넘어가도 같은 입력창이고 적던 글이 남는다", async ({ page }) => {
    await begin(page);
    const input = page.locator("#vc-composer-input");
    await input.fill("아직 보내지 않은 글");
    const handle = await input.elementHandle();
    await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "chat");
    expect(await handle?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(input).toHaveValue("아직 보내지 않은 글");
    await expect(page.locator("form.vc-composer")).toHaveClass(/vc-composer--docked/);
  });

  test("새로 고쳐도 서버 상태로 이어지고, 내려놓으면 빈 대화로 다시 시작한다", async ({ page }) => {
    await begin(page);
    await pickBought(page);
    await pickModel(page);
    await page.reload();
    await expect(log(page).getByText(`${MODEL}의 장점이 뭐예요?`)).toBeVisible();
    await expect(count(page)).toHaveText("필수 1/4");
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "chat");

    // 내려놓기: 대기열로 돌아가고, 다시 맡으면 대화가 지워진 히어로다.
    await page.getByRole("button", { name: "요청 내려놓기" }).click();
    await page.getByRole("button", { name: "돌려놓기" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
    await claimDemo(page, FIRST_DEMO_QUOTE);
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "hero");
    await expect(page.getByRole("heading", { level: 2, name: /소니 헤드셋 구매경험\s*리서치 어시스턴트/ })).toBeVisible();
  });

  test("다른 탭에서 먼저 답해 버전이 어긋나면(409 stale) 다시 읽고 쓰던 글을 그대로 둔다", async ({ page }) => {
    const calls = await begin(page);
    // 같은 기기(쿠키)의 두 번째 탭이 같은 요청을 연다.
    const second = await page.context().newPage();
    await second.goto(page.url());
    await expect(second.getByTestId("research-stage")).toBeVisible();
    await quickGroup(second).getByRole("button", { name: "구매했어요", exact: true }).click();
    await expect(log(second).getByText("좋아요. 어떤 기종을 쓰고 계세요?")).toBeVisible();

    // 첫 탭은 아직 version 0이라 글을 보내면 서버가 409 stale로 거절한다.
    await sendText(page, "써 본 경험을 적어요");
    await expect(page.getByText("다른 곳에서 내용이 바뀌어 다시 불러왔어요. 쓴 글은 그대로 두었어요.")).toBeVisible();
    await expect(composer(page)).toHaveValue("써 본 경험을 적어요");
    expect(calls.filter((call) => call.path === "/research" && call.method === "GET").length).toBeGreaterThanOrEqual(2);
    await expect(log(page).getByText("좋아요. 어떤 기종을 쓰고 계세요?")).toBeVisible();
  });

  test("움직임 줄이기: 점이 멈추고 입력은 막히지 않는다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await begin(page);
    await page.route("**/research/turn", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
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
    await begin(page);
    await page.route("**/research/turn", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
    const dot = page.getByTestId("thinking").locator(".lh-thinking-dot").first();
    expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("lh-dot");
    // 점은 낭독기에서 숨긴다.
    await expect(page.getByTestId("thinking").locator(".vc-dots")).toHaveAttribute("aria-hidden", "true");
  });

  test("axe: 히어로와 대화 화면에 위반이 없다(1440)", async ({ page }) => {
    await begin(page);
    await expectNoAxe(page);
    await pickBought(page);
    await pickModel(page);
    await expectNoAxe(page);
  });
});

test.describe("대화형 리서치 챗 · 1024", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("패널이 접히고 가로로 넘치지 않으며, 버튼으로 열고 닫는다", async ({ page }) => {
    test.setTimeout(90_000);
    await begin(page);
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

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(count(page)).toBeVisible();
    await expectFits(page);
    // 내려놓기 확인 묶음: 눌린 버튼이 사라져도 초점이 body로 떨어지지 않는다.
    await page.getByRole("button", { name: "요청 내려놓기" }).click();
    await expect(page.getByRole("button", { name: "취소" })).toBeFocused();
    await page.getByRole("button", { name: "취소" }).click();
    await expect(page.getByRole("button", { name: "요청 내려놓기" })).toBeFocused();
    // 패널 안에서 Esc: 패널이 닫히고 초점은 열었던 버튼으로 돌아간다.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(count(page)).toBeHidden();
  });
});
