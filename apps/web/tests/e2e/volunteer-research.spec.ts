import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";
import {
  aiBox,
  answerModel,
  answerThroughSummary,
  badge,
  BADGE_VERIFIED,
  BOUGHT,
  button,
  expectFits,
  MOCK_MODEL,
  MOCK_PHOTO_DESCRIPTION,
  MOCK_PROS_QUESTION,
  MOCK_SUMMARY_TEXT,
  next,
  openSonyResearch,
  progress,
  question,
  readStored,
  requestIdOf,
  RESEARCH_ONLY,
  SEND,
  shootWhole,
  storageKey,
  uploadPhoto,
} from "./helpers/researchFlow";
import {
  CLAIM_NAME,
  enterAs,
  expectNoBlockingAxe,
  expectNoRemaining,
  FIRST_DEMO_QUOTE,
  openDevice,
} from "./helpers/volunteerFlow";

// 봉사자 리서치 챗: 맡기 → 질문 카드 7장 → 보내기 전 확인 → 보내기 → 완료 화면.
// 전부 가짜 AI 응답 기준이다(LLM_MODE=mock). 실제 웹 검색·실제 사진 설명·실제 아이폰·VoiceOver 낭독은 여기서 판정하지 않는다.
// 스크린샷은 test-results/research-*.png(Playwright가 다음 실행 때 비운다).

const NEEDS_FIRST = "아직 답하지 않은 필수 질문";
const SEND_FAILED = "보내지 못했습니다. 다시 보내기를 눌러 주세요.";

test.describe("봉사자 리서치 챗(가짜 AI 응답 기준)", () => {
  test.setTimeout(120_000);

  test("1. 구매 인증 경로: 카드 7장을 지나 보내면 완료 화면에 핵심 정리와 구매 인증됨이 보인다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);

    // 카드 1: 맡으면 제목에 초점, 구매 인증 전 배지, 가짜 후보 칩 3개.
    await expect(
      page.getByRole("heading", { level: 1, name: "리서치 챗" }),
    ).toBeFocused();
    await expect(badge(page)).toHaveText("구매 인증 전");
    await expect(page.getByText("이용자가 한 말")).toBeVisible();
    await expect(question(page)).toHaveText("소니 헤드셋 기종을 찾아 주세요.");
    await expect(aiBox(page, "model")).toContainText("확인 필요");
    const chips = page.getByTestId("candidate-chip");
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toContainText("가짜 헤드셋 LH-200");
    await expect(chips.nth(1)).toContainText("가짜 헤드셋 LH-300");
    await expect(chips.nth(2)).toContainText("가짜 헤드셋 LH-400");
    await expectNoRemaining(page);
    await expectNoBlockingAxe(page);
    await shootWhole(page, "test-results/research-home.png");

    // 구매 여부를 고르기 전에는 다음으로 갈 수 없고 이유가 읽힌다.
    await expect(button(page, "다음")).toHaveAttribute("aria-disabled", "true");
    await button(page, "다음").click({ force: true });
    await expect(page.getByRole("status")).toHaveText(
      "기종 이름을 쓰고 구매 여부를 골라 주세요.",
    );
    await expect(progress(page)).toHaveText("질문 1 / 7");

    // 칩을 누르면 이름이 채워지고, 구매했어요를 고르면 착샷 안내가 붙는다.
    await chips.first().click();
    await expect(page.getByLabel("기종 이름")).toHaveValue(MOCK_MODEL);
    await button(page, BOUGHT).click();
    await expect(badge(page)).toHaveText("구매 인증 전");
    await expect(page.getByText("착샷을 올리면 인증돼요")).toBeVisible();
    await next(page);

    // 카드 2: AI가 만든 질문으로 초점이 가고, 힌트와 지난 문답이 보인다.
    await expect(progress(page)).toHaveText("질문 2 / 7");
    await expect(question(page)).toHaveText(MOCK_PROS_QUESTION);
    await expect(question(page)).toBeFocused();
    await expect(aiBox(page, "hints")).toContainText("착용감은 어땠나요?");
    await expect(aiBox(page, "hints")).toContainText("확인 필요");
    await expect(page.getByTestId("history")).toContainText(
      `${MOCK_MODEL} · 구매했어요`,
    );
    await expect(button(page, "다음")).toHaveAttribute("aria-disabled", "true");
    await button(page, "다음").click({ force: true });
    await expect(page.getByRole("status")).toHaveText("장점을 적어 주세요.");
    await page
      .getByLabel("장점", { exact: true })
      .fill("오래 써도 귀가 덜 아파요. 버튼이 커서 손으로 찾기 쉬워요.");
    await next(page);

    // 카드 3: 착샷을 올리면 배지가 인증됨으로 바뀐다. 설명 초안은 AI 제안으로 구분된다.
    await expect(progress(page)).toHaveText("질문 3 / 7");
    await expect(question(page)).toHaveText("제품 사진을 올려 주세요.");
    await expect(button(page, "착샷·사용 인증샷")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(button(page, "다음")).toHaveAttribute("aria-disabled", "true");
    await uploadPhoto(page, 0);
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);
    await expect(page.getByRole("status")).toHaveText(BADGE_VERIFIED);
    await page
      .getByRole("button", { name: "AI로 사진 설명 만들기 (사진 1)" })
      .click();
    await expect(page.getByLabel("사진 1 설명")).toHaveValue(
      MOCK_PHOTO_DESCRIPTION,
    );
    await expect(aiBox(page, "photo")).toContainText("확인 필요");
    await button(page, "상세페이지 캡처").click();
    await uploadPhoto(page, 1);
    await expect(page.getByTestId("photo-item").nth(1)).toContainText(
      "상세페이지 캡처",
    );
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);
    await expectNoBlockingAxe(page);
    await shootWhole(page, "test-results/research-photo.png");
    await next(page);

    // 카드 4: 후보 칩과 직접 입력을 합쳐 최대 2개.
    await expect(progress(page)).toHaveText("질문 4 / 7");
    await expect(aiBox(page, "alts")).toContainText("가짜 헤드셋 LH-500");
    await expect(page.getByTestId("candidate-chip")).toHaveCount(2);
    await page.getByTestId("candidate-chip").first().click();
    await page.getByLabel("제품 이름").fill("직접 쓴 제품");
    await button(page, "추가").click();
    await expect(page.getByTestId("alt-list").getByRole("listitem")).toHaveText(
      [/가짜 헤드셋 LH-500/, /직접 쓴 제품/],
    );
    await page.getByLabel("제품 이름").fill("세 번째 제품");
    await button(page, "추가").click({ force: true });
    await expect(page.getByRole("status")).toHaveText(
      "최대 2개까지 넣을 수 있어요.",
    );
    await expect(
      page.getByTestId("alt-list").getByRole("listitem"),
    ).toHaveCount(2);
    await next(page);

    // 카드 5: 대안 이름이 들어간 AI 질문.
    await expect(progress(page)).toHaveText("질문 5 / 7");
    await expect(question(page)).toContainText(
      "가짜 헤드셋 LH-500, 직접 쓴 제품",
    );
    await expect(question(page)).toContainText(
      "왜 같이 고민했는지 알려 주세요.",
    );
    await page
      .getByLabel("고민한 이유", { exact: true })
      .fill("노이즈 캔슬링은 더 좋았지만 무거워서 가벼운 쪽을 골랐어요.");
    await next(page);

    // 카드 6: 링크 2개와 쇼핑몰 바로가기. 선택 카드라 건너뛰기가 있다. 체크한 링크만 결과에 들어간다.
    await expect(progress(page)).toHaveText("질문 6 / 7");
    await expect(button(page, "건너뛰기")).toBeVisible();
    await page
      .getByLabel("혜택", { exact: true })
      .fill("카드 할인과 무료 배송을 받았어요.");
    const benefitRows = page.getByTestId("link-row");
    await expect(benefitRows).toHaveCount(2);
    await expect(benefitRows.first()).toContainText("가짜 혜택 안내 페이지");
    await expect(benefitRows.first()).toContainText("example.com");
    await expect(
      benefitRows.first().getByRole("link", { name: "열기" }),
    ).toHaveAttribute("href", "https://example.com/mock/benefit-1");
    await expect(
      benefitRows.first().getByRole("checkbox", { name: "확인했어요" }),
    ).not.toBeChecked();
    await benefitRows
      .first()
      .getByRole("checkbox", { name: "확인했어요" })
      .check();
    await expect(aiBox(page, "benefits")).toContainText("확인 필요");
    await expect(
      page.getByRole("link", { name: "쿠팡에서 찾기" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "11번가에서 찾기" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "G마켓에서 찾기" }),
    ).toBeVisible();
    await shootWhole(page, "test-results/research-benefits.png");
    await next(page);

    // 카드 7: 읽은 내용 요약과 링크. 마지막 카드의 다음은 요약 보기.
    await expect(progress(page)).toHaveText("질문 7 / 7");
    await expect(aiBox(page, "refs")).toContainText(
      "착용감이 편하다는 이야기가 많아요.",
    );
    await page
      .getByTestId("link-row")
      .nth(1)
      .getByRole("checkbox", { name: "확인했어요" })
      .check();
    await expect(
      page.getByRole("link", { name: "유튜브에서 찾기" }),
    ).toBeVisible();
    await page
      .getByLabel("새로 아는 내용이 있으면 적어 주세요.")
      .fill("통화 품질이 좋다는 후기도 있어요.");
    await next(page, "요약 보기");

    // 요약: 후보 목록, 핵심 정리(가짜 AI 초안), 사진 장수, 구매 인증. 보내기 활성.
    const heading = page.getByRole("heading", {
      level: 2,
      name: "보내기 전 확인",
    });
    await expect(heading).toBeFocused();
    await expect(page.getByTestId("summary-candidates")).toContainText(
      MOCK_MODEL,
    );
    await expect(page.getByTestId("summary-candidates")).toContainText(
      BADGE_VERIFIED,
    );
    await expect(page.getByTestId("summary-candidates")).toContainText(
      "직접 쓴 제품",
    );
    await expect(page.getByRole("textbox", { name: "핵심 정리" })).toHaveValue(
      MOCK_SUMMARY_TEXT,
    );
    await expect(
      page.getByText("이용자는 이 글을 화면 낭독기로 듣습니다."),
    ).toBeVisible();
    await expect(page.getByTestId("summary-photos")).toHaveText(
      "사진 2장 · 착샷·사용 인증샷 1, 상세페이지 캡처 1",
    );
    await expect(page.getByTestId("summary-purchase")).toHaveText(
      `구매 인증: ${BADGE_VERIFIED}`,
    );
    await expect(page.getByTestId("missing-cards")).toHaveCount(0);
    await expect(button(page, SEND)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(button(page, "내려놓기")).toBeVisible();
    await expectNoBlockingAxe(page);
    await shootWhole(page, "test-results/research-summary.png");

    // 보내기: 완료 화면에 핵심 정리와 구매 인증됨. 기기에 남긴 진행 상태는 지워진다.
    await button(page, SEND).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await expect(page.getByText("전달 완료", { exact: true })).toBeVisible();
    await expect(page.getByText("보낸 후보 3개")).toBeVisible();
    await expect(page.getByText("핵심 정리", { exact: true })).toBeVisible();
    await expect(page.locator(".vol-sent-text--lines")).toHaveText(
      MOCK_SUMMARY_TEXT,
    );
    await expect(page.getByText("구매 인증됨", { exact: true })).toBeVisible();
    await expect(page.locator(".vol-sent-item").nth(0)).toContainText(
      MOCK_MODEL,
    );
    await expect(page.locator(".vol-sent-item").nth(1)).toContainText(
      "가짜 헤드셋 LH-500",
    );
    await expect(page.locator(".vol-sent-item").nth(1)).toContainText(
      "같이 고민한 제품",
    );
    await expect(page.locator(".vol-sent-item").nth(2)).toContainText(
      "직접 쓴 제품",
    );
    await expect(page.locator(".vol-sent-item").nth(0)).toContainText(
      "혜택 링크 1 가짜 혜택 안내 페이지",
    );
    await expect(page.getByText("구매 가이드")).toHaveCount(0);
    expect(await readStored(page)).toBeNull();
    await expectNoRemaining(page);
    await shootWhole(page, "test-results/research-sent.png");

    // 이미 보낸 요청에는 리서치를 부를 수 없다(409). 새로 열어도 완료 화면이다.
    const done = await page.request.post("/api/volunteer/research", {
      data: { requestId: requestIdOf(page), kind: "model" },
    });
    expect(done.status()).toBe(409);
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("2. 리서치만 경로: 배지는 리서치만이고 사진은 상세페이지 캡처만, 선택 카드는 건너뛰어도 보낸다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page, RESEARCH_ONLY);
    await expect(badge(page)).toHaveText("리서치만");
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("가볍고 편해요.");
    await next(page);

    // 구매하지 않았으면 착샷·사용 인증샷은 고를 수 없다.
    await expect(button(page, "착샷·사용 인증샷")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(button(page, "상세페이지 캡처")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await button(page, "착샷·사용 인증샷").click({ force: true });
    await expect(page.getByRole("status")).toHaveText(
      "리서치만 하면 상세페이지 캡처만 올릴 수 있어요.",
    );
    await expect(button(page, "상세페이지 캡처")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await uploadPhoto(page);
    await expect(page.getByTestId("photo-item").first()).toContainText(
      "상세페이지 캡처",
    );
    await expect(badge(page)).toHaveText("리서치만");
    await next(page);

    await page.getByTestId("candidate-chip").first().click();
    await next(page);
    await page
      .getByLabel("고민한 이유", { exact: true })
      .fill("더 싸 보여서요.");
    await next(page);
    await button(page, "건너뛰기").click();
    await button(page, "건너뛰기").click();

    await expect(page.getByTestId("summary-purchase")).toHaveText(
      "구매 인증: 리서치만",
    );
    await expect(page.getByTestId("proof-missing")).toHaveCount(0);
    await expect(button(page, SEND)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await button(page, SEND).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await expect(page.getByText("리서치만", { exact: true })).toBeVisible();
    await expect(page.getByText("구매 인증됨", { exact: true })).toHaveCount(0);
    await page.context().close();
  });

  test("2-2. 구매했다고 했지만 착샷이 없으면 요약에서 알리고 리서치만으로 보낸다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page, BOUGHT);
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("편해요.");
    await next(page);
    await button(page, "상세페이지 캡처").click();
    await uploadPhoto(page);
    await expect(badge(page)).toHaveText("구매 인증 전");
    await next(page);
    await page.getByTestId("candidate-chip").first().click();
    await next(page);
    await page.getByLabel("고민한 이유", { exact: true }).fill("가벼워서요.");
    await next(page);
    await button(page, "건너뛰기").click();
    await button(page, "건너뛰기").click();

    await expect(page.getByTestId("proof-missing")).toHaveText(
      "착샷·사용 인증샷이 없어서 '리서치만'으로 보내요.",
    );
    await expect(page.getByTestId("summary-purchase")).toHaveText(
      "구매 인증: 리서치만",
    );
    await button(page, SEND).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await expect(page.getByText("리서치만", { exact: true })).toBeVisible();
    await page.context().close();
  });

  test("3. 필수 질문이 비면 보내기가 잠기고, 빠진 카드 이름을 누르면 그 카드로 간다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerThroughSummary(page);

    // 기기에 남은 상태에서 장점·고민한 이유를 비워 요약 단계로 다시 연다(필수 카드가 빈 채로 요약에 온 경우).
    const key = storageKey(page);
    await page.evaluate((storageName) => {
      const saved = JSON.parse(
        window.localStorage.getItem(storageName) ?? "{}",
      );
      saved.pros = "";
      saved.altReason = "";
      saved.summaryText = "";
      window.localStorage.setItem(storageName, JSON.stringify(saved));
    }, key);
    await page.reload();

    await expect(
      page.getByRole("heading", { level: 2, name: "보내기 전 확인" }),
    ).toBeVisible();
    const missing = page.getByTestId("missing-cards");
    await expect(missing).toContainText(NEEDS_FIRST);
    await expect(missing.getByRole("button")).toHaveText([
      "장점",
      "고민한 이유",
    ]);
    await expect(button(page, SEND)).toHaveAttribute("aria-disabled", "true");
    await button(page, SEND).click({ force: true });
    await expect(page.getByRole("status")).toHaveText(
      `${NEEDS_FIRST}: 장점, 고민한 이유`,
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "보내기 전 확인" }),
    ).toBeVisible();
    await expectNoBlockingAxe(page);

    // 빠진 카드로 가서 채우고, 선택 카드는 건너뛰어 요약으로 돌아오면 보낼 수 있다.
    await missing.getByRole("button", { name: "장점" }).click();
    await expect(progress(page)).toHaveText("질문 2 / 7");
    await expect(question(page)).toBeFocused();
    await page.getByLabel("장점", { exact: true }).fill("착용감이 좋아요.");
    for (let step = 0; step < 3; step += 1) await next(page);
    await expect(progress(page)).toHaveText("질문 5 / 7");
    await page
      .getByLabel("고민한 이유", { exact: true })
      .fill("가격이 비슷해서요.");
    await next(page);
    await button(page, "건너뛰기").click();
    await button(page, "건너뛰기").click();
    await expect(page.getByTestId("missing-cards")).toHaveCount(0);
    await expect(button(page, SEND)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await button(page, SEND).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("4. 이어하기: 중간 카드에서 새로 고쳐도 같은 질문·같은 답이 남고, AI 도움을 다시 부르지 않는다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    const researchKinds: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/volunteer/research") &&
        request.method() === "POST"
      ) {
        researchKinds.push((request.postDataJSON() as { kind: string }).kind);
      }
    });

    await answerModel(page, BOUGHT);
    await next(page);
    await page
      .getByLabel("장점", { exact: true })
      .fill("버튼이 커서 손으로 찾기 쉬워요.");
    await next(page);
    await uploadPhoto(page);
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);
    // 카드 1의 model 요청은 맡을 때 이미 지나갔다(이 감시는 그 뒤부터).
    expect(researchKinds).toEqual(["pros"]);
    // 기기 저장이 끝난 뒤에 새로 고친다(저장은 화면이 바뀐 직후 이어서 일어난다).
    await expect
      .poll(async () => (await readStored(page)) ?? "")
      .toContain('"thumb":"data:image/jpeg');

    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "리서치 챗" }),
    ).toBeVisible();
    await expect(progress(page)).toHaveText("질문 3 / 7");
    await expect(question(page)).toHaveText("제품 사진을 올려 주세요.");
    await expect(page.getByTestId("photo-item")).toHaveCount(1);
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);

    // 새로 고친 뒤 앞 카드로 돌아가도 답과 AI 제안이 남아 있고, 서버를 다시 부르지 않는다.
    const afterReload: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/volunteer/research") &&
        request.method() === "POST"
      ) {
        afterReload.push((request.postDataJSON() as { kind: string }).kind);
      }
    });
    await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 2 / 7");
    await expect(question(page)).toHaveText(MOCK_PROS_QUESTION);
    await expect(page.getByLabel("장점", { exact: true })).toHaveValue(
      "버튼이 커서 손으로 찾기 쉬워요.",
    );
    await expect(aiBox(page, "hints")).toContainText("착용감은 어땠나요?");
    await button(page, "이전").click();
    await expect(page.getByLabel("기종 이름")).toHaveValue(MOCK_MODEL);
    await expect(button(page, BOUGHT)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
    expect(afterReload).toEqual([]);

    // 쇼핑 앱에 다녀온 것처럼 같은 주소를 다시 열어도 같다.
    await page.goto(page.url());
    await expect(progress(page)).toHaveText("질문 1 / 7");
    await expect(page.getByLabel("기종 이름")).toHaveValue(MOCK_MODEL);
    expect(JSON.parse((await readStored(page)) ?? "{}").step).toBe(0);
    await page.context().close();
  });

  test("5. AI가 실패·429·지연돼도 카드는 진행되고 직접 확인 필요와 바로가기가 보인다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const { kind } = route.request().postDataJSON() as { kind: string };
        if (kind === "model") return route.abort();
        if (kind === "alts") {
          return route.fulfill({
            status: 429,
            contentType: "application/json",
            headers: { "Retry-After": "30" },
            body: JSON.stringify({ ok: false, error: "rate_limited" }),
          });
        }
        if (kind === "benefits") {
          return route.fulfill({
            json: {
              kind: "benefits",
              ai: "fallback",
              links: [],
              shortcuts: [
                {
                  label: "쿠팡에서 찾기",
                  url: "https://www.coupang.com/np/search?q=test",
                },
              ],
            },
          });
        }
        if (kind === "refs") {
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "internal_error" }),
          });
        }
        if (kind === "summary") return route.abort();
        return route.fallback();
      }),
    );

    // 카드 1: 후보를 못 찾았다고 알리고 바로가기를 준다. 직접 쓰면 진행된다.
    await expect(page.getByTestId("ai-failed")).toHaveText(
      "AI가 기종 후보를 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.",
    );
    await expect(page.getByTestId("shortcuts").getByRole("link")).toHaveText([
      "쿠팡에서 찾기",
      "11번가에서 찾기",
      "G마켓에서 찾기",
    ]);
    await expect(page.getByRole("status")).toHaveText(
      "AI가 기종 후보를 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.",
    );
    await expect(page.getByTestId("candidate-chip")).toHaveCount(0);
    await page.getByLabel("기종 이름").fill("직접 쓴 기종");
    await button(page, RESEARCH_ONLY).click();
    await next(page);

    // 카드 2: 서버를 지나는 기본 질문(실패하지 않은 종류).
    await expect(progress(page)).toHaveText("질문 2 / 7");
    await expect(question(page)).toContainText("직접 쓴 기종");
    await page.getByLabel("장점", { exact: true }).fill("가벼워요.");
    await next(page);
    await button(page, "상세페이지 캡처").click();
    await uploadPhoto(page);
    await next(page);

    // 카드 4: 429. 같은 안내와 바로가기, 직접 입력으로 진행.
    await expect(progress(page)).toHaveText("질문 4 / 7");
    await expect(page.getByTestId("ai-failed")).toHaveText(
      "AI가 비슷한 기종을 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.",
    );
    await expect(button(page, "다시 찾기")).toBeVisible();
    await page.getByLabel("제품 이름").fill("직접 쓴 대안");
    await button(page, "추가").click();
    await next(page);
    await page
      .getByLabel("고민한 이유", { exact: true })
      .fill("가격이 비슷해서요.");
    await next(page);

    // 카드 6: AI 도움이 fallback 응답.
    await expect(progress(page)).toHaveText("질문 6 / 7");
    await expect(aiBox(page, "benefits")).toContainText("직접 확인 필요");
    await expect(page.getByTestId("link-row")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "쿠팡에서 찾기" }),
    ).toHaveAttribute("href", /coupang\.com/);
    await next(page);

    // 카드 7: 서버 오류(503)여도 바로가기는 화면이 직접 만든다.
    await expect(progress(page)).toHaveText("질문 7 / 7");
    await expect(aiBox(page, "refs")).toContainText("직접 확인 필요");
    await expect(
      page.getByRole("link", { name: "네이버 블로그에서 찾기" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "유튜브에서 찾기" }),
    ).toBeVisible();
    await next(page, "요약 보기");

    // 요약 초안도 실패하면 봉사자가 쓴 말을 이은 기본 글이 들어가고 보낼 수 있다.
    const guide = page.getByRole("textbox", { name: "핵심 정리" });
    await expect(guide).toHaveValue(/추천 기종: 직접 쓴 기종/);
    await expect(guide).toHaveValue(/장점: 가벼워요\./);
    await expect(button(page, SEND)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await button(page, SEND).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("5-2. AI가 응답하지 않는 동안 찾는 중 안내가 보이고, 끝나면 후보가 나온다. 다시 찾기는 눌렀을 때만 부른다", async ({
    browser,
    baseURL,
  }) => {
    let modelCalls = 0;
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const { kind } = route.request().postDataJSON() as { kind: string };
        if (kind === "model") {
          modelCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        await route.fallback();
      }),
    );
    await expect(page.getByTestId("ai-searching")).toContainText(
      "기종 후보를 찾는 중이에요.",
    );
    await expect(page.getByRole("status")).toHaveText(
      "기종 후보를 찾는 중이에요.",
    );
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
    await expect(page.getByRole("status")).toHaveText(
      "3개를 찾았어요. 확인 필요.",
    );
    expect(modelCalls).toBe(1);

    await button(page, "다시 찾기").click();
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
    expect(modelCalls).toBe(2);
    await page.context().close();
  });

  test("6. 이전으로 돌아가 답을 고칠 수 있다: 구매 여부를 바꾸면 사진 종류와 배지가 따라 바뀐다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page, BOUGHT);
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("처음 쓴 장점");
    await next(page);
    await uploadPhoto(page);
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);
    await next(page);
    await expect(progress(page)).toHaveText("질문 4 / 7");

    await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 3 / 7");
    await expect(question(page)).toBeFocused();
    await button(page, "이전").click();
    await expect(page.getByLabel("장점", { exact: true })).toHaveValue(
      "처음 쓴 장점",
    );
    await page.getByLabel("장점", { exact: true }).fill("고친 장점");
    await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 1 / 7");
    await expect(button(page, "이전")).toHaveAttribute("aria-disabled", "true");

    await button(page, RESEARCH_ONLY).click();
    await expect(badge(page)).toHaveText("리서치만");
    await next(page);
    await expect(page.getByLabel("장점", { exact: true })).toHaveValue(
      "고친 장점",
    );
    await next(page);
    await expect(page.getByTestId("photo-item").first()).toContainText(
      "상세페이지 캡처",
    );
    await expect(button(page, "착샷·사용 인증샷")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // 사진을 지우면 다음으로 갈 수 없다.
    await page.getByRole("button", { name: "사진 1 지우기" }).click();
    await expect(page.getByTestId("photo-item")).toHaveCount(0);
    await expect(button(page, "다음")).toHaveAttribute("aria-disabled", "true");
    await page.context().close();
  });

  test("7. 휴대폰 폭 375px: 가로 넘침이 없고, 하단 버튼이 화면에 붙어 있으며, 입력 중에도 질문이 위에 보인다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await page.setViewportSize({ width: 375, height: 667 });
    await answerThroughSummary(page, { checkFit: true });

    // 요약 단계: 긴 글을 넣어도 넘치지 않는다.
    await page
      .getByRole("textbox", { name: "핵심 정리" })
      .fill("가".repeat(300));
    await expectFits(page);
    await page.context().close();
  });

  test("7-2. 입력하는 동안에도 현재 질문과 하단 버튼이 화면 안에 있다(작은 화면)", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await page.setViewportSize({ width: 375, height: 667 });
    await answerModel(page);
    await next(page);
    const pros = page.getByLabel("장점", { exact: true });
    await pros.fill("길게 적어요. ".repeat(12));
    await pros.focus();
    await expect(question(page)).toBeInViewport();
    await expect(button(page, "다음")).toBeInViewport();
    await expect(badge(page)).toBeInViewport();
    await page.context().close();
  });

  test("8. 내려놓기: 대기열로 돌아가고 기기에 남긴 진행 상태가 지워진다. 남의 요청에는 리서치를 부를 수 없다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page);
    const id = requestIdOf(page);
    expect(await readStored(page)).not.toBeNull();

    const other = await openDevice(browser, baseURL);
    await enterAs(other, "다른봉사자");
    const forbidden = await other.request.post("/api/volunteer/research", {
      data: { requestId: id, kind: "model" },
    });
    expect(forbidden.status()).toBe(403);
    await other.goto(`/volunteer/requests/${id}`);
    await expect(other.getByText("이 요청은 내 담당이 아니에요")).toBeVisible();
    expect(
      await other.evaluate(
        (key) => window.localStorage.getItem(key),
        `lh.vol.research.v1.${id}`,
      ),
    ).toBeNull();
    await other.context().close();

    await button(page, "내려놓기").click();
    await expect(page).toHaveURL(/\/volunteer$/);
    await expect(page.getByRole("status")).toHaveText(
      "요청을 대기열로 돌려놓았어요",
    );
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        `lh.vol.research.v1.${id}`,
      ),
    ).toBeNull();
    await expect(
      page
        .locator(".vol-card")
        .filter({ hasText: FIRST_DEMO_QUOTE })
        .getByRole("button", { name: CLAIM_NAME }),
    ).toBeVisible();
    await page.context().close();
  });

  test("9. 보내기가 실패하면 입력이 남고 다시 보내면 성공한다. 403이면 목록 링크를 준다. 입장 정보(401)가 사라지면 입장 화면으로 간다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerThroughSummary(page);
    const guide = page.getByRole("textbox", { name: "핵심 정리" });
    await expect(guide).toHaveValue(MOCK_SUMMARY_TEXT);
    await guide.fill("내가 고친 핵심 정리");

    let calls = 0;
    await page.route("**/api/volunteer/requests/*/result", async (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "store_unavailable" }),
        });
      }
      if (calls === 2) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "invalid_url" }),
        });
      }
      if (calls === 3) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "not_yours" }),
        });
      }
      await route.fallback();
    });

    await button(page, SEND).click();
    await expect(page.getByRole("status")).toHaveText(SEND_FAILED);
    await expect(guide).toHaveValue("내가 고친 핵심 정리");
    await expect(button(page, SEND)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await button(page, SEND).click();
    await expect(page.getByRole("status")).toHaveText(
      "링크는 https://로 시작해야 합니다",
    );

    await button(page, SEND).click();
    await expect(page.getByRole("status")).toHaveText(
      "이 요청은 더 이상 내 담당이 아니에요",
    );
    await expect(
      page.getByRole("link", { name: "목록으로", exact: true }),
    ).toBeVisible();
    await expect(guide).toHaveValue("내가 고친 핵심 정리");

    await button(page, SEND).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await expect(page.locator(".vol-sent-text--lines")).toHaveText(
      "내가 고친 핵심 정리",
    );
    expect(calls).toBe(4);
    await page.context().close();
  });

  test("9-2. 카드를 열었을 때 입장 정보(401)가 사라져 있으면 입장 확인 화면으로 돌아간다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    // 기기에 남은 AI 제안을 지워야 다시 열 때 서버를 부른다.
    await page.evaluate(
      (key) => window.localStorage.removeItem(key),
      storageKey(page),
    );
    await page.route("**/api/volunteer/research", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "unauthorized" }),
      }),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/volunteer$/);
    await page.context().close();
  });

  test("10. 이용자 화면 코드는 봉사자 API를 부르지 않는다(역할 분리)", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/volunteer"))
        requested.push(request.url());
    });
    await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "LightHouse" }),
    ).toBeVisible();
    expect(requested).toEqual([]);

    const root = path.resolve(__dirname, "../../src");
    for (const file of [
      "app/page.tsx",
      "components/SpeechInput.tsx",
      "components/DemoHandoff.tsx",
      "lib/speech.ts",
      "lib/matchHandoff.ts",
    ]) {
      expect(readFileSync(path.join(root, file), "utf8")).not.toContain(
        "/api/volunteer",
      );
    }
  });

  test("11. 접근 쿠키(lh_access)가 끝난 기기도 리서치 카드를 다시 열면 AI 제안이 온다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    // 입장 7일 뒤처럼 lh_access만 지운다. lh_vol은 30일이라 남아 있다.
    await page.context().clearCookies({ name: "lh_access" });
    const names = (await page.context().cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain("lh_access");
    expect(names).toContain("lh_vol");
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "리서치 챗" }),
    ).toBeVisible();
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
    await page.context().close();
  });
});
