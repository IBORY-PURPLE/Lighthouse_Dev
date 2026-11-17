import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { claimDemo, enterAs, FIRST_DEMO_QUOTE, refill } from "./helpers/volunteerFlow";

// 휴대폰 사진(QR) 시험, 노트북 크롬(e2e-desktop) + 휴대폰 문맥(같은 서버, 쿠키가 따로인 두 번째 브라우저 문맥).
// 노트북이 QR 창을 열면 휴대폰 문맥이 그 링크(#t=토큰)를 열어 사진을 올리고, 노트북 대화에 사진 말풍선이 나타난다.
// 가짜 AI·메모리 저장소 기준이다. 실제 휴대폰 카메라·QR 읽기·iOS 앱 안 브라우저는 여기서 판정하지 않는다(사람 확인).
// RESEARCH_SHOTS가 있으면 그 폴더에 화면 캡처를 남긴다(photo-qr-dialog, photo-phone-page).

const SHOTS = process.env.RESEARCH_SHOTS;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const MODEL = "가짜 헤드셋 LH-200";
const ALT = "가짜 헤드셋 LH-500";

// iPhone 15 설정에서 브라우저 종류(webkit)만 빼고 쓴다(크롬 문맥에 넘기면 오류).
const { defaultBrowserType: _ignored, ...IPHONE } = devices["iPhone 15"];
void _ignored;

async function settle(page: Page) {
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
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function expectNoAxe(page: Page) {
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

async function expectFits(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const composer = (page: Page) => page.getByRole("textbox", { name: "답을 적어 주세요" });
const quickGroup = (page: Page) => page.getByRole("group", { name: "빠른 답" });
const log = (page: Page) => page.getByRole("log", { name: "대화" });

async function sendText(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

/** 입장 → 시연 요청 채우기 → 첫 요청 맡기. 턴 요청 수를 세는 배열을 돌려준다. */
async function begin(page: Page): Promise<{ turns: string[] }> {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `e2e-${randomUUID()}` });
  const turns: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/research\/turn$/.test(new URL(request.url()).pathname)) turns.push(request.url());
  });
  await enterAs(page);
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);
  await expect(page.getByTestId("research-stage")).toBeVisible();
  return { turns };
}

/** 구매함 → 기종 → 장점까지 가서 사진 질문이 지금 질문이 되게 한다. */
async function toPhotoQuestion(page: Page) {
  await quickGroup(page).getByRole("button", { name: "구매했어요", exact: true }).click();
  await expect(log(page).getByText("좋아요. 어떤 기종을 쓰고 계세요?")).toBeVisible();
  await page.getByRole("button", { name: MODEL, exact: true }).click();
  await expect(log(page).getByText(`${MODEL}의 장점이 뭐예요?`)).toBeVisible();
  await sendText(page, "가볍고 귀가 덜 아파요");
  await expect(log(page).getByText("구매 인증에 쓸 사진을 올려 주세요.")).toBeVisible();
}

async function openQrFromSheet(page: Page) {
  await page.getByRole("button", { name: "사진 올리기" }).click();
  await page.getByRole("dialog", { name: "사진 올리기" }).getByRole("button", { name: "휴대폰으로 찍기" }).click();
  const dialog = page.getByRole("dialog", { name: "휴대폰으로 사진 찍기" });
  await expect(dialog.getByRole("img", { name: "휴대폰 카메라로 읽는 QR 코드" })).toBeVisible();
  return dialog;
}

/** QR이 담은 링크(QR이 안 읽힐 때 쓰는 글 링크와 같은 값). */
async function linkOf(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog", { name: "휴대폰으로 사진 찍기" });
  const field = dialog.getByLabel(/휴대폰 브라우저에서 이 링크를 열어 주세요/);
  if (!(await field.isVisible())) await dialog.getByText("QR이 안 읽히나요?").click();
  return field.inputValue();
}

async function phoneContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ ...IPHONE, extraHTTPHeaders: { "x-forwarded-for": `e2e-phone-${randomUUID()}` } });
}

test.describe("휴대폰으로 찍기(QR)", () => {
  test("노트북이 QR을 띄우면 휴대폰이 사진을 올리고 노트북 대화에 사진 말풍선이 생긴다", async ({ page, browser }) => {
    await begin(page);
    await toPhotoQuestion(page);

    const dialog = await openQrFromSheet(page);
    await expect(dialog.getByText(/10분|9:5\d|10:00/).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: "새로 만들기" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "닫기" })).toBeVisible();
    // QR 그림이 실제로 그려졌다.
    expect(await dialog.getByRole("img", { name: "휴대폰 카메라로 읽는 QR 코드" }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
    await shot(page, "photo-qr-dialog");
    await expectNoAxe(page);

    const url = await linkOf(page);
    expect(url).toMatch(/^http:\/\/localhost:\d+\/volunteer\/photo#t=[A-Za-z0-9_-]{43}$/);
    const token = url.split("#t=")[1];

    const phoneCtx = await phoneContext(browser);
    const phone = await phoneCtx.newPage();
    const seen: string[] = [];
    phone.on("request", (request) => seen.push(request.url()));
    const response = await phone.goto(url);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");

    const choose = phone.getByText("사진 찍기·고르기", { exact: true });
    await expect(choose).toBeVisible();
    // 토큰은 메모리로 옮기고 주소에서 지웠다. 서버로 가는 어떤 주소에도 없다.
    await expect.poll(() => phone.evaluate(() => window.location.hash)).toBe("");
    expect(seen.every((address) => !address.includes(token))).toBe(true);
    // 링크는 사진을 고르기 전에는 쓰지 않는다(노트북은 아직 연결 전).
    await expect(dialog.getByText(/QR을 읽고/)).toBeVisible();
    await shot(phone, "photo-phone-page");
    await expectNoAxe(phone);
    await expectFits(phone);

    await phone.locator("input[type=file]").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(phone.getByRole("status").filter({ hasText: "사진을 올렸어요" })).toBeVisible();
    await expect(phone.getByText("사진 더 올리기", { exact: true })).toBeVisible();
    // 휴대폰에는 대화 내용이 보이지 않는다.
    await expect(phone.getByText("같이 고민")).toHaveCount(0);

    // 열쇠 쿠키: HttpOnly·SameSite=Strict·Path=/api/volunteer/photo, 봉사자 쿠키(lh_vol)는 없다.
    const cookies = await phoneCtx.cookies();
    const grant = cookies.find((cookie) => cookie.name === "lh_photo");
    expect(grant).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/volunteer/photo" });
    expect(cookies.some((cookie) => cookie.name === "lh_vol")).toBe(false);

    // 노트북: 사진 말풍선·구매 인증됨·창 닫힘·알림.
    await expect(page.getByRole("img", { name: "올린 사진 1" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("purchase-badge")).toHaveText("구매 인증됨");
    await expect(page.getByRole("dialog", { name: "휴대폰으로 사진 찍기" })).toHaveCount(0);
    await expect(page.getByText("휴대폰에서 사진을 받았어요.")).toBeVisible();
    // 사진 뒤 다음 질문(같이 고민한 제품)과 웹 검색 결과도 노트북 올리기와 똑같이 이어진다.
    await expect(page.getByRole("list", { name: "웹에서 찾은 관련 제품" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: `같이 고민했어요 ${ALT}` })).toBeVisible();

    // 같은 열쇠로 한 장 더(연결 유지). 새로 고쳐도 열쇠가 살아 있어 바로 사진 버튼이 보인다.
    await phone.reload();
    await expect(phone.getByText("사진 찍기·고르기", { exact: true })).toBeVisible();
    await phone.locator("input[type=file]").setInputFiles({ name: "two.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(phone.getByRole("status").filter({ hasText: "사진을 올렸어요" })).toBeVisible();
    await expect(page.getByRole("img", { name: "올린 사진 2" })).toBeVisible({ timeout: 15_000 });

    // 한 번 쓴 링크는 다시 쓸 수 없다(다른 기기에서 같은 주소를 열어도 410).
    const other = await phoneContext(browser);
    const again = await other.newPage();
    await again.goto(url);
    await again.locator("input[type=file]").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(again.getByText(/시간이 지났거나 이미 썼어요/)).toBeVisible();
    await expect(again.locator("input[type=file]")).toHaveCount(0);
    await other.close();
    await phoneCtx.close();
  });

  test("입력창에 QR·휴대폰으로 찍기 같은 말을 쓰면 턴을 보내지 않고 같은 창이 열린다", async ({ page }) => {
    const { turns } = await begin(page);
    // 아직 사진 질문이 아니면 첨부 창에 [휴대폰으로 찍기]가 없다.
    await page.getByRole("button", { name: "사진 올리기" }).click();
    const sheet = page.getByRole("dialog", { name: "사진 올리기" });
    await expect(sheet.getByText("파일 고르기")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "휴대폰으로 찍기" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await toPhotoQuestion(page);
    const before = turns.length;

    await sendText(page, "QR");
    const dialog = page.getByRole("dialog", { name: "휴대폰으로 사진 찍기" });
    await expect(dialog.getByRole("img", { name: "휴대폰 카메라로 읽는 QR 코드" })).toBeVisible();
    await expect(composer(page)).toHaveValue("");
    // 글자가 대화에 올라가지 않았고 턴 요청도 없었다.
    await expect(log(page).getByText("QR", { exact: true })).toHaveCount(0);
    expect(turns.length).toBe(before);

    // Esc로 닫으면 입력창으로 돌아온다. 아직 아무도 읽지 않은 링크는 끊긴다(노트북 상태 none).
    const link = await linkOf(page);
    const token = link.split("#t=")[1];
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(composer(page)).toBeFocused();

    // 같은 말을 한국어로.
    await sendText(page, "휴대폰으로 찍을게요");
    await expect(dialog.getByRole("img", { name: "휴대폰 카메라로 읽는 QR 코드" })).toBeVisible();
    expect(turns.length).toBe(before);
    const second = await linkOf(page);
    expect(second.split("#t=")[1]).not.toBe(token);
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toHaveCount(0);

    // 모델명 같은 보통 답은 턴으로 간다.
    await sendText(page, "아이폰으로 샀어요");
    await expect.poll(() => turns.length).toBe(before + 1);
    await expect(dialog).toHaveCount(0);
  });

  test("닫기·새로 만들기: 안 쓴 링크는 끊기고 새 링크가 앞 링크를 끊는다", async ({ page, browser }) => {
    await begin(page);
    await toPhotoQuestion(page);

    const dialog = await openQrFromSheet(page);
    const first = await linkOf(page);
    await dialog.getByRole("button", { name: "새로 만들기" }).click();
    await expect.poll(async () => linkOf(page)).not.toBe(first);
    const second = await linkOf(page);

    // 앞 링크는 끊겼다.
    const phoneCtx = await phoneContext(browser);
    const old = await phoneCtx.newPage();
    await old.goto(first);
    await old.locator("input[type=file]").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(old.getByText(/시간이 지났거나 이미 썼어요/)).toBeVisible();

    // 창을 닫으면(아직 아무도 안 쓴 링크) 그 링크도 끊긴다. 초점은 사진 올리기 버튼으로 돌아온다.
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "사진 올리기" })).toBeFocused();
    const closed = await phoneContext(browser);
    const late = await closed.newPage();
    await late.goto(second);
    await late.locator("input[type=file]").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(late.getByText(/시간이 지났거나 이미 썼어요/)).toBeVisible();
    await closed.close();
    await phoneCtx.close();
  });

  test("앞서 연결된 휴대폰에서 다른 요청의 QR을 열면 새 링크를 쓰고 사진은 새 요청에 올라간다", async ({ page, browser, baseURL }) => {
    await begin(page);
    await toPhotoQuestion(page);
    await openQrFromSheet(page);
    const urlA = await linkOf(page);

    const phoneCtx = await phoneContext(browser);
    const phone = await phoneCtx.newPage();
    await phone.goto(urlA);
    await phone.locator("input[type=file]").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(phone.getByRole("status").filter({ hasText: "사진을 올렸어요" })).toBeVisible();
    await expect(page.getByRole("img", { name: "올린 사진 1" })).toBeVisible({ timeout: 15_000 });

    // 다른 봉사자가 대기 요청 하나를 맡아 링크를 만든다(화면 없이 서버 함수로).
    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `e2e-b-${randomUUID()}` } });
    expect((await other.request.post(`${baseURL}/api/volunteer/enter`)).ok()).toBe(true);
    const waiting = (await (await other.request.get(`${baseURL}/api/volunteer/queue`)).json()).waiting as { requestId: string }[];
    const idB = waiting[0].requestId;
    expect((await other.request.post(`${baseURL}/api/volunteer/requests/${idB}/claim`)).ok()).toBe(true);
    const base = `${baseURL}/api/volunteer/requests/${idB}/research`;
    const sessionB = (await (await other.request.get(base)).json()).sessionId as string;
    const issued = await other.request.post(`${base}/photo-link`, { data: { sessionId: sessionB } });
    expect(issued.status()).toBe(201);
    const { token } = (await issued.json()) as { token: string };

    // 같은 휴대폰(A의 열쇠가 살아 있다)에서 B의 링크를 연다.
    await phone.goto(`/volunteer/photo#t=${token}`);
    await phone.locator("input[type=file]").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(phone.getByRole("status").filter({ hasText: "사진을 올렸어요" })).toBeVisible();
    const photosB = ((await (await other.request.get(base)).json()).photos as unknown[]).length;
    expect(photosB).toBe(1);
    // A는 그대로 1장이다.
    await expect(page.getByRole("img", { name: "올린 사진 2" })).toHaveCount(0);
    await other.close();
    await phoneCtx.close();
  });

  test("링크 없이 연 휴대폰 페이지는 안내만 보인다", async ({ browser }) => {
    const ctx = await phoneContext(browser);
    const page = await ctx.newPage();
    const response = await page.goto("/volunteer/photo");
    expect(response?.status()).toBe(200);
    await expect(page.getByText(/노트북 화면의 QR을 휴대폰 카메라로 읽어/)).toBeVisible();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await expectNoAxe(page);
    await expectFits(page);
    // 열쇠 없이 올리는 길은 모두 410이다.
    const check = await page.request.get("/api/volunteer/photo");
    expect(check.status()).toBe(410);
    await ctx.close();
  });
});
