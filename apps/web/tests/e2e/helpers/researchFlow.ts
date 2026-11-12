import { expect, type Browser, type Page } from "@playwright/test";
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

/** 가로 넘침이 없고, 하단 버튼이 화면 안에 붙어 있다. */
export async function expectFits(page: Page) {
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
}

/**
 * 카드 1부터 7까지 기본 답으로 지나 요약 단계까지 간다. 6·7은 건너뛴다.
 * 구매했다면 착샷 1장, 리서치만이면 상세페이지 캡처 1장을 올린다.
 */
export async function answerThroughSummary(
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
    if (checkFit) await expectFits(page);
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
