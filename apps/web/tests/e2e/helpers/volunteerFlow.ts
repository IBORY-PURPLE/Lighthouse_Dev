import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, type Browser, type Page } from "@playwright/test";

// 봉사자 첫 화면(히어로 + 왼쪽 대기열 창)·맡기 시험 도우미. 컨텍스트마다 x-forwarded-for를 무작위로 해서
// 주소별 횟수 제한이 시험끼리 번지지 않게 한다.

export const FIRST_DEMO_QUOTE = "“소니 무선 헤드셋 사고 싶어요 · 30만 원 안쪽”";
export const DEMO_QUOTES = [
  FIRST_DEMO_QUOTE,
  "“세탁 세제 리필용 큰 것 · 2만 원 안쪽”",
  "“무선 키보드, 조용한 것 · 5만 원쯤”",
  "“전기포트 1.7리터 · 4만 원 안쪽”",
  "“엄마 쓰실 전기요, 싱글 사이즈 · 10만 원 안쪽”",
];
export const CLAIM_NAME = "이 요청 맡기";
export const LOCKED_TEXT = "맡은 요청을 끝내면 맡을 수 있어요";
export const REFILL_NAME = "시연용 요청 다시 채우기";
export const PANE_TOGGLE_NAME = "대기열·내 담당";
export const PANE_ID = "vol-mine";

/** 새 기기(쿠키가 없는 브라우저 컨텍스트)에서 연 페이지. */
export async function openDevice(
  browser: Browser,
  baseURL: string | undefined,
): Promise<Page> {
  const context = await browser.newContext({
    ...devices["iPhone 15"],
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250)}-${randomUUID()}`,
    },
  });
  return context.newPage();
}

/**
 * 왼쪽 창 여닫기 버튼. 닫혀 있으면 위 막대 아래 왼쪽의 [열기](이름 "대기열·내 담당"),
 * 열려 있으면 창 안 토글 옆 [닫기](이름 "왼쪽 창 닫기")다. 보이는 쪽 하나를 고른다(aria-expanded로 상태를 본다).
 */
export const paneToggle = (page: Page) => page.locator(".vc-side-toggle:visible");

/** 왼쪽 창. */
export const pane = (page: Page) => page.locator(`#${PANE_ID}`);

/** 왼쪽 창 안의 대기 요청 카드. */
export const queueCards = (page: Page) => pane(page).getByTestId("queue-card");

/** 인용문이 같은 시연 카드. */
export const queueCard = (page: Page, quote: string) =>
  queueCards(page).filter({ hasText: quote });

/** 왼쪽 창을 연다(이미 열려 있으면 그대로). */
export async function openPane(page: Page): Promise<void> {
  const toggle = paneToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(pane(page)).toBeVisible();
}

/** 왼쪽 창을 닫는다(이미 닫혀 있으면 그대로). 좁은 화면에서 창이 입력창을 가릴 때 쓴다. */
export async function closePane(page: Page): Promise<void> {
  const toggle = paneToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  await expect(pane(page)).toBeHidden();
}

/** /volunteer를 열면 화면이 스스로 기기 쿠키를 받는다(코드·별명 없음). 첫 화면(히어로 제목과 왼쪽 창 버튼)까지 기다린다. */
export async function enterAs(page: Page): Promise<void> {
  await page.goto("/volunteer");
  await expect(
    page.getByRole("heading", { level: 1, name: "봉사자" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "구매 경험 리서치 어시스턴트" }),
  ).toBeVisible();
  await expect(paneToggle(page)).toBeVisible();
}

/** 입력창(첫 화면과 리서치 화면이 같은 이름). */
export const homeInput = (page: Page) =>
  page.getByRole("textbox", { name: "답을 적어 주세요" });

/** 입력창에 글을 쓰고 Enter. */
export async function typeCommand(page: Page, text: string): Promise<void> {
  await homeInput(page).fill(text);
  await homeInput(page).press("Enter");
}

/** 시연용 요청 다시 채우기: "/" 메뉴 → 확인 [다시 채우기] → 상태 줄. 끝나면 왼쪽 대기열이 새 요청으로 바뀐다. */
export async function refill(page: Page): Promise<void> {
  // 좁은 화면에서는 왼쪽 창이 입력창을 가리므로 닫고 시작한다(넓은 화면은 옆에 붙어 있어 그대로 둔다).
  if ((page.viewportSize()?.width ?? 0) < 1180) await closePane(page);
  await homeInput(page).fill("/");
  await page.getByRole("group", { name: "명령" }).getByRole("button", { name: REFILL_NAME }).click();
  await page
    .getByRole("group", { name: "시연 초기화 확인" })
    .getByRole("button", { name: "다시 채우기" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "시연용 요청을 새로 채웠어요",
  );
}

/** 들어오는 움직임(반복하지 않는 것)이 끝날 때까지 기다린다. 움직임 중에는 글자 색이 옅게 보여 색 대비 검사가 흔들린다. */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** wcag2a·2aa·21aa 위반 중 critical·serious가 0건. */
export async function expectNoBlockingAxe(page: Page): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
  ).toEqual([]);
}

/** 화면 어디에도 남은 시간 글자("남음")가 없다. */
export async function expectNoRemaining(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("남음");
}

/** 왼쪽 창에서 인용문이 같은 시연 카드의 "이 요청 맡기"를 눌러 리서치 챗 화면까지 간다. */
export async function claimDemo(page: Page, quote: string): Promise<void> {
  await openPane(page);
  await queueCard(page, quote).getByRole("button", { name: CLAIM_NAME }).click();
  await expect(page).toHaveURL(/\/volunteer\/requests\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "리서치 챗" }),
  ).toBeVisible();
}

/**
 * 구매 여부를 고른 뒤 나오는 이용자 요청 카드를 끝까지 넘기고 [다 봤어요 · 질문 이어 가기]를 누른다.
 * 카드가 여러 장이면 [한 번에 모두 보기]로 연다. 끝나면 카드는 버튼 없이 펼쳐진 채 남고 입력창이 열린다.
 * (새 단계를 거치는 것이다. 기존 시험의 기준을 낮추는 것이 아니다.)
 */
export async function passBrief(page: Page): Promise<void> {
  const brief = page.getByTestId("request-brief");
  await expect(brief).toBeVisible();
  const openAll = brief.getByRole("button", { name: "한 번에 모두 보기" });
  if (await openAll.isVisible()) await openAll.click();
  await brief.getByRole("button", { name: "다 봤어요 · 질문 이어 가기" }).click();
  await expect(brief).toHaveAttribute("data-done", "true");
}

/** 화면 증거: 저장소 루트 test-results/demo6-shots/<name>.png. 들어오는 움직임이 끝난 뒤 찍는다. */
export async function shot(page: Page, name: string): Promise<void> {
  await settleAnimations(page);
  await page.waitForTimeout(400);
  const dir = path.resolve(process.cwd(), "../../test-results/demo6-shots");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** 새 기기(쿠키가 없는 브라우저 컨텍스트)에서 연 노트북 크롬 페이지(1440×900). */
export async function openDesktopDevice(
  browser: Browser,
  baseURL: string | undefined,
): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-for": `198.19.${Math.floor(Math.random() * 250)}-${randomUUID()}`,
    },
  });
  return context.newPage();
}

/**
 * 긴 합성 상세 이미지(PNG)를 브라우저 canvas로 그려 돌려준다. Node에는 canvas가 없어서다.
 * 글자를 넣고 잡음으로 파일 크기를 키운다. 실제 쇼핑몰 이미지는 쓰지 않는다(TSD §10).
 */
export async function makeSyntheticDetailImage(
  page: Page,
  { width = 860, height = 4500, noise = true } = {},
): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, noise }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      if (noise) {
        const image = context.getImageData(0, 0, width, height);
        let seed = 12345;
        for (let i = 0; i < image.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const value = 200 + (seed % 56);
          image.data[i] = value;
          image.data[i + 1] = (value * 7) % 256 | 0x80;
          image.data[i + 2] = (value * 13) % 256 | 0x80;
          image.data[i + 3] = 255;
        }
        context.putImageData(image, 0, 0);
      }
      context.fillStyle = "#111111";
      context.font = "bold 40px sans-serif";
      const lines = [
        "합성 상세 이미지 (시험용)",
        "상품명: 가짜 헤드셋 LH-200",
        "색상 옵션: 블랙, 화이트",
        "블루투스 5.3, 최대 30시간 재생",
        "구성품: 본체, USB-C 케이블, 설명서",
        "주의: 물에 닿지 않게 하세요",
      ];
      for (let y = 120, i = 0; y < height; y += 300, i++) {
        context.fillText(lines[i % lines.length], 40, y);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, noise },
  );
  return Buffer.from(base64, "base64");
}
