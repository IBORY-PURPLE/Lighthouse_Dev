import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import {
  claimDemo,
  enterAs,
  FIRST_DEMO_QUOTE,
  makeSyntheticDetailImage,
  openDevice,
  refill,
} from "./volunteerFlow";

// 리서치 챗 화면 시험 도우미. 전부 가짜 AI 응답(LLM_MODE=mock) 기준이다.
// 가짜 응답의 글자는 src/lib/researchMock.ts와 같다. 쇼핑몰·가짜 링크 주소는 실제로 열지 않는다.

export const BOUGHT = "구매했어요";
export const RESEARCH_ONLY = "구매하지 않았어요 (리서치만)";
export const MOCK_MODEL = "가짜 헤드셋 LH-200";
export const MOCK_PROS_QUESTION = `${MOCK_MODEL}의 장점을 알려 주세요. 어떤 점이 좋았나요?`;
export const MOCK_PHOTO_DESCRIPTION =
  "제품이 책상 위에 놓여 있어요. 시험용 가짜 설명이에요.";
export const MOCK_SUMMARY_TEXT =
  "시험용 가짜 핵심 정리예요.\n장점과 고민한 이유를 확인해 주세요.";
export const BADGE_VERIFIED = "구매 인증됨 · 봉사시간 가산";
export const SEND = "완료하고 보내기";

export const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
export const question = (page: Page) => page.getByTestId("question");
export const progress = (page: Page) => page.getByTestId("progress-label");
export const badge = (page: Page) => page.getByTestId("purchase-badge");
export const aiBox = (page: Page, id: string) => page.getByTestId(`ai-${id}`);

/** 새 기기로 입장해서 소니 헤드셋 요청을 맡고 리서치 챗 첫 카드까지 간다. 쇼핑몰 도메인 요청은 막는다. */
export async function openSonyResearch(
  browser: Browser,
  baseURL: string | undefined,
  // 맡기 전에 AI 응답을 가로채야 하는 시험이 쓴다(맡자마자 첫 카드의 model 요청이 나간다). 그러면 칩을 기다리지 않는다.
  beforeClaim?: (page: Page) => Promise<unknown>,
): Promise<Page> {
  const page = await openDevice(browser, baseURL);
  await page
    .context()
    .route(
      /https:\/\/(search\.11st\.co\.kr|www\.coupang\.com|www\.gmarket\.co\.kr)\/.*/,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<title>shop</title>",
        }),
    );
  await beforeClaim?.(page);
  await enterAs(page);
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);
  await expect(progress(page)).toHaveText("질문 1 / 7");
  // 카드 1의 AI 제안(model 요청)이 끝난 뒤부터 시험이 시작되게 한다.
  if (!beforeClaim)
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
  return page;
}

/** 요청 id(주소 끝). */
export const requestIdOf = (page: Page) => page.url().split("/").pop() ?? "";

export const storageKey = (page: Page) =>
  `lh.vol.research.v1.${requestIdOf(page)}`;

export const readStored = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), storageKey(page));

/** 카드 1: 첫 후보 칩을 눌러 이름을 채우고 구매 여부를 고른다. */
export async function answerModel(
  page: Page,
  purchase: typeof BOUGHT | typeof RESEARCH_ONLY = BOUGHT,
) {
  const chips = page.getByTestId("candidate-chip");
  await expect(chips).toHaveCount(3);
  await chips.first().click();
  await expect(page.getByLabel("기종 이름")).toHaveValue(MOCK_MODEL);
  await button(page, purchase).click();
  await expect(button(page, purchase)).toHaveAttribute("aria-pressed", "true");
}

export async function next(page: Page, label = "다음") {
  await button(page, label).click();
}

/** 사진 한 장을 올린다(합성 PNG). 종류는 먼저 눌러 둔 종류 버튼을 따른다. */
export async function uploadPhoto(page: Page, index = 0) {
  const buffer = await makeSyntheticDetailImage(page, {
    width: 860,
    height: 900,
    noise: false,
  });
  await page.getByTestId("photo-input").setInputFiles({
    name: `synthetic-${index}.png`,
    mimeType: "image/png",
    buffer,
  });
  await expect(page.getByTestId("photo-item")).toHaveCount(index + 1);
}

/** 합성 사진 여러 장을 한 번에 고른다(파일 선택 창에서 여러 장을 고른 것과 같다). 올라간 장수는 호출한 쪽이 본다. */
export async function pickPhotos(page: Page, count: number) {
  const buffer = await makeSyntheticDetailImage(page, {
    width: 860,
    height: 900,
    noise: false,
  });
  await page.getByTestId("photo-input").setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `synthetic-multi-${index}.png`,
      mimeType: "image/png",
      buffer,
    })),
  );
}

/**
 * 입력 칸이 위·아래 고정 띠에 가려지지 않는다. 두 띠 사이 가용 높이를 재서,
 * 칸 높이가 가용 높이 이하면 칸 전체가 보이고(1px 오차), 더 크면 가용 높이만큼 보여야 한다.
 * 띠가 일반 흐름(position이 sticky가 아님)이면 그 띠는 화면을 가리지 않으므로 가용 높이에 넣지 않는다.
 */
export async function expectNotCovered(page: Page, target: Locator, label = "") {
  // 초점 이동으로 인한 스크롤은 잠깐 걸리므로 멈출 때까지 다시 잰다.
  let last = "";
  try {
    await expect
      .poll(
        async () => {
          const box = await target.boundingBox();
          if (!box) return Number.NEGATIVE_INFINITY;
          const viewport = page.viewportSize()!;
          const strip = async (selector: string) => {
            const element = page.locator(selector);
            const rect = await element.boundingBox();
            const sticky = (await element.evaluate((node) => getComputedStyle(node).position)) === "sticky";
            return rect && sticky ? rect : null;
          };
          const top = await strip(".rc-top");
          const bottom = await strip(".rc-bottom");
          const areaTop = top ? Math.max(0, top.y + top.height) : 0;
          const areaBottom = bottom ? Math.min(viewport.height, bottom.y) : viewport.height;
          const available = areaBottom - areaTop;
          const visible = Math.max(0, Math.min(box.y + box.height, areaBottom) - Math.max(box.y, areaTop));
          const expected = Math.min(box.height, available);
          last = `칸 y=${Math.round(box.y)} h=${Math.round(box.height)}, 가용 ${Math.round(areaTop)}~${Math.round(areaBottom)}, 보임 ${Math.round(visible)}`;
          // 0 이상이면 기준을 채운 것이다(1px 오차).
          return Math.round(visible - expected + 1);
        },
        { timeout: 4000 },
      )
      .toBeGreaterThanOrEqual(0);
  } catch (error) {
    throw new Error(`입력 칸이 띠에 가려짐 ${label} (${last}) ${String(error).split("\n")[0]}`);
  }
}

/**
 * 현재 질문이 화면 위쪽에 고정돼 있다(이용자 기획 설계원칙 4): 화면을 맨 아래까지 내려도 질문 글이 화면 윗부분에 보인다.
 * 화면이 짧아 스크롤할 일이 없으면 본문 아래에 빈 자리를 더해 스크롤이 생기게 한 뒤 잰다.
 */
export async function expectQuestionPinned(page: Page) {
  await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".rc-body");
    if (body) body.style.paddingBottom = "1600px";
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  try {
    const target = question(page);
    await expect(target).toBeInViewport();
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height * 0.5);
  } finally {
    await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(".rc-body");
      if (body) body.style.paddingBottom = "";
      window.scrollTo(0, 0);
    });
  }
}

/** 내려놓기를 눌러 화면 안 확인 단계에서 확인까지 누른다. */
export async function confirmRelease(page: Page) {
  await button(page, "내려놓기").click();
  await button(page, "내려놓기 확인").click();
}

/** 가로 넘침이 없고, 하단 버튼이 화면 안에 붙어 있다. */
export async function expectFits(page: Page, withQuestion = false) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const bottom = page.getByRole("button", {
    name: /^(다음|요약 보기|완료하고 보내기)$/,
  });
  await expect(bottom).toBeInViewport();
  // 질문 카드가 있는 화면은 현재 질문이 위에 고정돼 있다(보내기 전 확인에는 질문 카드가 없다).
  if ((await question(page).count()) > 0 && withQuestion) await expectQuestionPinned(page);
}

/**
 * 카드 1부터 7까지 기본 답으로 지나 요약 단계까지 간다. 6·7은 건너뛴다.
 * 구매했다면 착샷 1장, 리서치만이면 상세페이지 캡처 1장을 올린다.
 */
export async function answerThroughSummary(
  page: Page,
  options: {
    purchase?: typeof BOUGHT | typeof RESEARCH_ONLY;
    checkFit?: boolean;
  } = {},
) {
  await answerRequiredCards(page, options);
  const fit = async () => {
    if (options.checkFit) await expectFits(page, true);
  };
  await expect(progress(page)).toHaveText("질문 6 / 7");
  await fit();
  await button(page, "건너뛰기").click();

  await expect(progress(page)).toHaveText("질문 7 / 7");
  await fit();
  await button(page, "건너뛰기").click();

  await expect(
    page.getByRole("heading", { level: 2, name: "보내기 전 확인" }),
  ).toBeVisible();
  await fit();
}

/** 카드 1~5(필수)를 기본 답으로 지나 카드 6(혜택)에 도착한다. */
export async function answerRequiredCards(
  page: Page,
  {
    purchase = BOUGHT,
    checkFit = false,
  }: {
    purchase?: typeof BOUGHT | typeof RESEARCH_ONLY;
    checkFit?: boolean;
  } = {},
) {
  const fit = async () => {
    if (checkFit) await expectFits(page, true);
  };
  await answerModel(page, purchase);
  await fit();
  await next(page);

  await expect(progress(page)).toHaveText("질문 2 / 7");
  await page
    .getByLabel("장점", { exact: true })
    .fill("오래 써도 귀가 덜 아파요.");
  await fit();
  await next(page);

  await expect(progress(page)).toHaveText("질문 3 / 7");
  if (purchase === RESEARCH_ONLY) await button(page, "상세페이지 캡처").click();
  await uploadPhoto(page);
  await fit();
  await next(page);

  await expect(progress(page)).toHaveText("질문 4 / 7");
  await page.getByTestId("candidate-chip").first().click();
  await expect(page.getByTestId("alt-list").getByRole("listitem")).toHaveCount(
    1,
  );
  await fit();
  await next(page);

  await expect(progress(page)).toHaveText("질문 5 / 7");
  await page
    .getByLabel("고민한 이유", { exact: true })
    .fill("더 가벼운 쪽을 골랐어요.");
  await fit();
  await next(page);
}

/**
 * 화면 전체를 한 장으로 찍는다. 위·아래가 붙어 있는 화면이라 fullPage 캡처는 아래 버튼 줄이 가운데에 끼므로,
 * 보이는 영역을 문서 높이만큼 늘려 찍고 되돌린다.
 */
export async function shootWhole(page: Page, file: string) {
  const original = page.viewportSize();
  if (!original) throw new Error("no viewport");
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({
    width: original.width,
    height: Math.max(original.height, height),
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: file });
  await page.setViewportSize(original);
}
