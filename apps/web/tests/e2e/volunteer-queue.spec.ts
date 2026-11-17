import { expect, test, type Page } from "@playwright/test";
import {
  CLAIM_NAME,
  closePane,
  DEMO_QUOTES,
  enterAs,
  expectNoBlockingAxe,
  expectNoRemaining,
  FIRST_DEMO_QUOTE,
  homeInput,
  LOCKED_TEXT,
  openDevice,
  openPane,
  pane,
  paneToggle,
  queueCard,
  queueCards,
  refill,
  shot,
  typeCommand,
} from "./helpers/volunteerFlow";

// 봉사자 첫 화면(2026-11-17 이용자 설계): 리서치 히어로와 같은 레이아웃, 대기열과 내 담당은 왼쪽 창. 이 파일은 휴대폰 393px(e2e).
// 가짜 서버 저장소(메모리) 기준이다. 다른 시험 파일이 같은 서버에 실제 접수 요청을 남길 수 있으므로, 시연 카드는 글자로 찾는다.
// 1440px 화면은 volunteer-desktop.spec.ts.

const HINT = "왼쪽 대기열에서 요청을 골라 주세요.";
const status = (page: Page) => page.getByRole("status");

test.describe("봉사자 첫 화면·왼쪽 창·맡기 (휴대폰)", () => {
  test("1. 링크만 열면 입장 화면 없이 첫 화면이 나온다: 제목, 히어로, 하단 탭 없음, 구매 버튼 없음. 열기 전에는 401", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    // 기기 쿠키(lh_vol)를 받기 전에는 봉사자용 서버 기능이 401이다.
    const before = await page.request.get("/api/volunteer/queue");
    expect(before.status()).toBe(401);

    await page.goto("/volunteer");
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "구매 경험 리서치 어시스턴트" }),
    ).toBeVisible();
    await expect(page.getByText("구매했던 경험을 시각장애인 유저에게 공유해 봐요.")).toBeVisible();
    await expect(homeInput(page)).toBeVisible();
    // 요청을 맡기 전에는 구매 버튼이 없고, 하단 탭은 없다.
    await expect(page.getByRole("button", { name: "구매했어요" })).toHaveCount(0);
    await expect(page.locator('nav[aria-label="목록 전환"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "봉사자 입장" })).toHaveCount(0);
    await expect(page.getByLabel("입장 코드")).toHaveCount(0);
    await expect(page.getByLabel("별명")).toHaveCount(0);
    // 좁은 화면에서는 왼쪽 창이 닫힌 채 시작한다.
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "false");

    // 들어오는 움직임이 끝난 뒤(shot이 기다린다) 색 대비를 본다.
    await shot(page, "volunteer-home-phone");
    await expectNoBlockingAxe(page);
    await page.context().close();
  });

  test("2. 기기 쿠키는 HttpOnly이고 접근 쿠키는 없다. 새로 고쳐도 같은 기기 쿠키다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);

    const cookies = await page.context().cookies();
    const vol = cookies.find((cookie) => cookie.name === "lh_vol");
    expect(vol?.httpOnly).toBe(true);
    expect(cookies.some((cookie) => cookie.name === "lh_access")).toBe(false);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    const after = (await page.context().cookies()).find((cookie) => cookie.name === "lh_vol");
    expect(after?.value).toBe(vol?.value);
    await page.context().close();
  });

  test("3. 옛 링크 /enter?code= 는 이용자 화면으로 가고 쿠키를 심지 않는다. 같은 기기에서 /volunteer는 바로 열린다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    const context = page.context();
    await page.goto("/enter?code=old-link-value");
    await expect(page).toHaveURL(/\/$/);
    expect(await context.cookies()).toEqual([]);

    await page.goto("/volunteer");
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await context.close();
  });

  test("4. 다시 채우면 왼쪽 대기열에 시연 카드 5개, 첫 카드가 대기 1시간 12분째 소니이고, 내 담당에 어제 보냄이 있다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);
    await openPane(page);

    // 머리 줄: 기준 시각 · 대기 N건 · 오래 기다린 순.
    await expect(page.getByTestId("queue-asof")).toHaveText(/^\d\d:\d\d 기준 · 대기 \d+건 · 오래 기다린 순$/);
    // 오래 기다린 순: 72분 전인 소니가 맨 위다.
    const first = queueCards(page).first();
    await expect(first).toContainText("대기 1시간 12분째");
    await expect(first).toContainText(FIRST_DEMO_QUOTE);
    await expect(first.getByRole("button", { name: CLAIM_NAME })).toBeVisible();
    // 목록은 20건까지만 보인다. 같은 서버에 다른 시험 파일이 실제 접수를 많이 남겼으면 가장 최근인
    // 다섯 번째 시연 카드(2분 전)가 잘릴 수 있어, 그때는 오래된 네 장만 확인한다(5건은 단위 시험이 확인한다).
    const visibleCards = await queueCards(page).count();
    const expected = visibleCards < 20 ? DEMO_QUOTES : DEMO_QUOTES.slice(0, 4);
    for (const quote of expected) {
      await expect(queueCard(page, quote)).toHaveCount(1);
    }
    // 첫 불러오기와 다시 채우기 직후에는 새 요청 표시를 붙이지 않는다.
    await expect(page.getByText("새 요청", { exact: true })).toHaveCount(0);
    await expect(page.locator('nav[aria-label="목록 전환"]')).toHaveCount(0);
    await shot(page, "volunteer-queue-phone");
    await expectNoBlockingAxe(page);

    // 아래쪽 "내 담당"에 이 기기에서 보낸 요청이 있다.
    const sent = pane(page).getByTestId("mine-sent").filter({ hasText: "아이 실내화 210 사이즈, 흰색" });
    await expect(sent).toContainText("어제 보냄");
    await expect(sent).toContainText("완료");
    await expect(sent).toContainText("전달 완료");
    await expect(pane(page).getByText("이 기기에서 보낸 요청만 보여요.")).toBeVisible();
    await page.context().close();
  });

  test("[새로 보기]를 누르면 직전 목록에 없던 요청에 새 요청 표시가 붙고, 다시 누르면 사라진다", async ({
    browser,
    baseURL,
  }) => {
    const watcher = await openDevice(browser, baseURL);
    await enterAs(watcher);
    await refill(watcher);

    // 다른 기기가 시연 요청을 다시 채운다(시연 행이 새로 만들어져 직전 목록에 없던 id가 된다).
    const other = await openDevice(browser, baseURL);
    await enterAs(other);
    await refill(other);

    await openPane(watcher);
    await pane(watcher).getByRole("button", { name: "새로 보기" }).click();
    await expect(
      queueCard(watcher, FIRST_DEMO_QUOTE).getByText("새 요청", { exact: true }),
    ).toBeVisible();

    // 한 번 더 누르면 직전 목록과 같으므로 표시가 사라진다.
    await pane(watcher).getByRole("button", { name: "새로 보기" }).click();
    await expect(watcher.getByText("새 요청", { exact: true })).toHaveCount(0);
    await watcher.context().close();
    await other.context().close();
  });

  test("5. 기기 두 대: A가 맡은 뒤 B가 옛 목록의 같은 카드를 누르면 방금 다른 봉사자가 맡았어요", async ({
    browser,
    baseURL,
  }) => {
    const a = await openDevice(browser, baseURL);
    await enterAs(a);
    await refill(a);

    const b = await openDevice(browser, baseURL);
    await enterAs(b);
    await openPane(b);
    const bCard = queueCard(b, FIRST_DEMO_QUOTE);
    await expect(bCard).toHaveCount(1);

    // A가 먼저 맡는다.
    await openPane(a);
    await queueCard(a, FIRST_DEMO_QUOTE).getByRole("button", { name: CLAIM_NAME }).click();
    await expect(a).toHaveURL(/\/volunteer\/requests\/[0-9a-f-]{36}$/);

    // B는 새로 읽지 않은 옛 목록에서 같은 카드를 누른다.
    await bCard.getByRole("button", { name: CLAIM_NAME }).click();
    await expect(status(b)).toHaveText("방금 다른 봉사자가 맡았어요");
    // 안내 뒤 목록을 다시 읽어서 그 카드가 빠진다. B는 맡은 게 없으므로 다른 카드는 맡을 수 있다.
    await expect(queueCard(b, FIRST_DEMO_QUOTE)).toHaveCount(0);
    await expect(
      pane(b).getByRole("button", { name: CLAIM_NAME }).first(),
    ).toBeVisible();
    await a.context().close();
    await b.context().close();
  });

  test("6. 맡으면 제품 제목의 히어로로 가고, 첫 화면에서는 모든 맡기 버튼이 잠기고 문구가 바뀐다. 이어서 하기로 돌아온다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);
    await openPane(page);
    await queueCard(page, FIRST_DEMO_QUOTE).getByRole("button", { name: CLAIM_NAME }).click();
    await expect(page).toHaveURL(/\/volunteer\/requests\//);

    // 리서치 챗(대화형): 제목, 같은 히어로 레이아웃(제품 제목), 이용자가 한 말, 구조화 줄, 구매 질문 빠른 답.
    await expect(
      page.getByRole("heading", { level: 1, name: "리서치 챗" }),
    ).toBeFocused();
    await expect(page.getByTestId("research-stage")).toHaveAttribute("data-mode", "hero");
    await expect(
      page.getByRole("heading", { level: 2, name: "소니 헤드셋 구매 경험 리서치 어시스턴트" }),
    ).toBeVisible();
    await expect(
      page.getByText("요청을 맡았어요 · 이용자: “소니 무선 헤드셋 사고 싶어요”"),
    ).toBeVisible();
    // 좁은 화면에서는 구조화 줄을 숨기지만 화면 요소로는 있다.
    await expect(
      page.getByText("품목 헤드셋 · 브랜드 소니 · 예산 30만 원 안쪽"),
    ).toBeAttached();
    await expect(page.getByRole("button", { name: "구매했어요", exact: true })).toBeVisible();
    // 화면 이동 직후에는 문서 제목이 잠깐 비어 있을 수 있어 제목이 채워진 뒤 접근성을 본다.
    await expect(page).toHaveTitle(/.+/);
    await expectNoBlockingAxe(page);

    // 첫 화면으로: 요청을 맡은 채라 모든 맡기 버튼이 잠긴다(왼쪽 창).
    await page.goto("/volunteer");
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await openPane(page);
    await expect(queueCards(page).first()).toBeVisible();
    await expect(pane(page).getByRole("button", { name: CLAIM_NAME })).toHaveCount(0);
    const locked = pane(page).getByRole("button", { name: LOCKED_TEXT });
    await expect(locked.first()).toHaveAttribute("aria-disabled", "true");
    expect(await locked.count()).toBeGreaterThanOrEqual(4);
    await locked.first().click({ force: true });
    await expect(status(page)).toHaveText(LOCKED_TEXT);

    // 아래쪽 내 담당: 진행 중 1, 내가 맡음, 이어서 하기.
    const mine = pane(page).getByTestId("mine-current");
    await expect(pane(page).getByRole("heading", { name: "진행 중 1" })).toBeVisible();
    await expect(mine).toContainText("진행");
    await expect(mine).toContainText("내가 맡음");
    await expect(mine).toContainText(FIRST_DEMO_QUOTE);
    await expectNoBlockingAxe(page);
    await mine.getByRole("link", { name: "이어서 하기" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "리서치 챗" }),
    ).toBeVisible();
    await expect(
      page.getByText("요청을 맡았어요 · 이용자: “소니 무선 헤드셋 사고 싶어요”"),
    ).toBeVisible();
    await page.context().close();
  });

  test("7. 내려놓으면 첫 화면으로 와서 안내가 나오고 왼쪽 대기열이 열려 있다. 내려놓은 요청의 상세는 내 담당이 아니다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await refill(page);
    await openPane(page);
    await queueCard(page, FIRST_DEMO_QUOTE).getByRole("button", { name: CLAIM_NAME }).click();
    await expect(page).toHaveURL(/\/volunteer\/requests\//);
    const detailUrl = page.url();

    // 좁은 화면에서는 "모은 정보" 패널이 접혀 있다. 위 바의 버튼으로 열면 맨 아래에 [요청 내려놓기]가 있다.
    await page.getByRole("button", { name: /^모은 정보 필수/ }).click();
    await page.getByRole("button", { name: "요청 내려놓기" }).click();
    await page.getByRole("button", { name: "돌려놓기" }).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    await expect(status(page)).toHaveText("요청을 대기열로 돌려놓았어요");
    // 안내와 함께 왼쪽 창이 열려 있고, 내려놓은 요청이 대기열에 돌아와 있다.
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(queueCard(page, FIRST_DEMO_QUOTE)).toHaveCount(1);
    await expect(pane(page).getByRole("button", { name: LOCKED_TEXT })).toHaveCount(0);
    await expect(pane(page).getByRole("heading", { name: "진행 중 0" })).toBeVisible();
    await expect(pane(page).getByText("맡은 요청이 없어요.")).toBeVisible();

    await page.goto(detailUrl);
    await expect(page.getByText("이 요청은 내 담당이 아니에요")).toBeVisible();
    await expect(page.getByRole("link", { name: "목록으로", exact: true })).toBeVisible();
    await page.context().close();
  });

  test("8. 남의 요청 상세는 내 담당이 아니에요와 목록 링크, 화면 어디에도 남음 글자가 없다", async ({
    browser,
    baseURL,
  }) => {
    const a = await openDevice(browser, baseURL);
    await enterAs(a);
    await refill(a);
    await expectNoRemaining(a);
    await openPane(a);
    await queueCard(a, FIRST_DEMO_QUOTE).getByRole("button", { name: CLAIM_NAME }).click();
    await expect(a).toHaveURL(/\/volunteer\/requests\//);
    await expect(a.getByTestId("research-stage")).toBeVisible();
    await expectNoRemaining(a);
    const detailUrl = a.url();

    const b = await openDevice(browser, baseURL);
    await enterAs(b);
    await expectNoRemaining(b);
    await b.goto(detailUrl);
    await expect(b.getByText("이 요청은 내 담당이 아니에요")).toBeVisible();
    await b.getByRole("link", { name: "목록으로", exact: true }).click();
    await expect(b.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();

    await openPane(b);
    await expectNoRemaining(b);
    await a.context().close();
    await b.context().close();
  });

  test("세 길이 같은 결과를 낸다: 왼쪽 창이 열리고 상태 줄과 초점이 같다 (대기열 4가지, 내 담당 3가지)", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    const queueHeading = pane(page).getByRole("heading", { name: "대기열", level: 2 });
    const mineHeading = pane(page).getByRole("heading", { name: "내 담당", level: 2 });

    for (const text of ["/대기열", "대기열 보여줘", "새 요청 있어?", "대기열 보기"]) {
      await closePane(page);
      await typeCommand(page, text);
      await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(pane(page)).toBeVisible();
      await expect(queueHeading).toBeFocused();
      await expect(status(page)).toHaveText("대기열을 열었어요");
      await expect(homeInput(page)).toHaveValue("");
    }
    for (const text of ["/내담당", "내 담당", "맡은 요청 보여줘"]) {
      await closePane(page);
      await typeCommand(page, text);
      await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(mineHeading).toBeFocused();
      await expect(status(page)).toHaveText("내 담당 목록을 열었어요");
    }
    await page.context().close();
  });

  test("그 밖의 말은 상태 줄로 안내하고 평소 말로는 시연 초기화를 하지 않는다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await typeCommand(page, "안녕하세요");
    await expect(status(page)).toHaveText(HINT);
    await typeCommand(page, "시연 초기화");
    await expect(status(page)).toHaveText(HINT);
    await expect(page.getByRole("group", { name: "시연 초기화 확인" })).toHaveCount(0);
    await typeCommand(page, "/없는명령");
    await expect(status(page)).toHaveText(HINT);
    await page.context().close();
  });

  test("첫 화면에서 허용 목록 밖 서버 요청이 0건이다(AI 호출 없음)", async ({ browser, baseURL }) => {
    const page = await openDevice(browser, baseURL);
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/api/")) apiCalls.push(`${request.method()} ${pathname}`);
    });
    await enterAs(page);
    await typeCommand(page, "/대기열");
    await typeCommand(page, "안녕하세요");
    await typeCommand(page, "/내담당");
    await refill(page);
    await openPane(page);
    await pane(page).getByRole("button", { name: "새로 보기" }).click();
    await expect(queueCard(page, FIRST_DEMO_QUOTE)).toHaveCount(1);

    const allowed = [
      /^GET \/api\/volunteer\/me$/,
      /^POST \/api\/volunteer\/enter$/,
      /^GET \/api\/volunteer\/queue$/,
      /^POST \/api\/volunteer\/demo\/reset$/,
      /^POST \/api\/volunteer\/requests\/[0-9a-f-]{36}\/claim$/,
    ];
    expect(apiCalls.length).toBeGreaterThan(0);
    expect(apiCalls.filter((call) => !allowed.some((pattern) => pattern.test(call)))).toEqual([]);
    await page.context().close();
  });

  test('"/" 메뉴: "/"만 치면 명령 3개, 앞부분이 맞는 것만 남는다', async ({ browser, baseURL }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    const menu = page.getByRole("group", { name: "명령" });
    await expect(menu).toHaveCount(0);
    await homeInput(page).fill("/");
    await expect(menu.getByRole("button")).toHaveCount(3);
    await expect(menu.getByRole("button", { name: /대기열 보기/ })).toBeVisible();
    await expect(menu.getByRole("button", { name: /내 담당 보기/ })).toBeVisible();
    await expect(menu.getByRole("button", { name: /시연용 요청 다시 채우기/ })).toBeVisible();
    await homeInput(page).fill("/대");
    await expect(menu.getByRole("button")).toHaveCount(1);
    await menu.getByRole("button", { name: /대기열 보기/ }).click();
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(status(page)).toHaveText("대기열을 열었어요");
    await expect(homeInput(page)).toHaveValue("");
    await expect(menu).toHaveCount(0);
    await page.context().close();
  });

  test("시연 초기화는 확인을 거친다: [취소]면 아무것도 지우지 않고, [다시 채우기]면 왼쪽 대기열이 바뀐다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await typeCommand(page, "/시연초기화");
    const confirm = page.getByRole("group", { name: "시연 초기화 확인" });
    await expect(confirm).toContainText("시연 요청을 지우고 새로 채울까요?");
    await confirm.getByRole("button", { name: "취소" }).click();
    await expect(status(page)).toHaveText("초기화하지 않았어요");
    await expect(confirm).toHaveCount(0);

    await refill(page);
    await openPane(page);
    await expect(queueCard(page, FIRST_DEMO_QUOTE)).toHaveCount(1);
    await page.context().close();
  });

  test("왼쪽 창 버튼: aria-expanded·aria-controls, 닫힌 창은 inert로 초점이 못 들어가고, Esc로 닫으면 초점이 버튼으로 돌아온다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    const toggle = paneToggle(page);
    await expect(toggle).toHaveAttribute("aria-controls", "vol-mine");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(pane(page)).toBeHidden();
    await expect(pane(page)).toHaveAttribute("inert", "");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(pane(page)).toBeVisible();
    await expect(pane(page)).not.toHaveAttribute("inert", "");

    // 창 안으로 초점이 가도(Tab) Esc가 닫고 버튼으로 돌려놓는다.
    await pane(page).getByRole("button", { name: "새로 보기" }).focus();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(pane(page)).toBeHidden();
    await page.context().close();
  });

  test("/volunteer?tab=mine 으로 열면 왼쪽 창이 열린 채 시작한다", async ({ browser, baseURL }) => {
    const page = await openDevice(browser, baseURL);
    await page.goto("/volunteer?tab=mine");
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(pane(page)).toBeVisible();
    await page.context().close();
  });

  test("첫 화면은 아무것도 저장하지 않는다: 새로 고치면 처음 모습으로 돌아온다", async ({ browser, baseURL }) => {
    const page = await openDevice(browser, baseURL);
    await enterAs(page);
    await typeCommand(page, "/대기열");
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(status(page)).toHaveText("대기열을 열었어요");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
    await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(status(page)).toHaveText("");
    await page.context().close();
  });
});
