import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_ACCESS_CODE } from "../../playwright.config";
import {
  aiBox,
  answerModel,
  answerRequiredCards,
  answerThroughSummary,
  badge,
  BADGE_VERIFIED,
  BOUGHT,
  button,
  expectFits,
  expectNotCovered,
  expectQuestionPinned,
  MOCK_MODEL,
  MOCK_PHOTO_DESCRIPTION,
  MOCK_PROS_QUESTION,
  MOCK_SUMMARY_TEXT,
  next,
  openSonyResearch,
  pickPhotos,
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
  refill,
} from "./helpers/volunteerFlow";

// 봉사자 리서치 챗: 맡기 → 질문 카드 7장 → 보내기 전 확인 → 보내기 → 완료 화면.
// 전부 가짜 AI 응답 기준이다(LLM_MODE=mock). 실제 웹 검색·실제 사진 설명·실제 아이폰·VoiceOver 낭독은 여기서 판정하지 않는다.
// 스크린샷은 test-results/research-*.png(Playwright가 다음 실행 때 비운다).

const NEEDS_FIRST = "아직 답하지 않은 필수 질문";
const SEND_FAILED = "보내지 못했어요. 완료하고 보내기를 다시 눌러 주세요.";
const SEND_INVALID =
  "보낼 내용에 문제가 있어요. 핵심 정리를 줄이거나 체크한 링크를 빼 주세요.";

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
    // R4-6: 앞 문답은 접혀 있고 펼침 표시(▸)가 보이며, 눌러서 펼치면 문답이 보인다(▾).
    const history = page.getByTestId("history");
    const historyTitle = history.locator("summary");
    const marker = () =>
      historyTitle.evaluate((element) => getComputedStyle(element, "::before").content);
    await expect(history).not.toHaveAttribute("open", "");
    await expect(history.getByText(`${MOCK_MODEL} · 구매했어요`)).toBeHidden();
    expect(await marker()).toContain("▸");
    await historyTitle.click();
    await expect(history.getByText(`${MOCK_MODEL} · 구매했어요`)).toBeVisible();
    expect(await marker()).toContain("▾");
    await historyTitle.click();
    await expect(history.getByText(`${MOCK_MODEL} · 구매했어요`)).toBeHidden();
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
      "상세 캡처",
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
      "상세 캡처",
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

  test("5. AI가 실패·429·503이어도 카드는 진행되고 직접 확인 필요와 바로가기가 보인다", async ({
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
    // 429는 다른 실패와 달리 "잠시 뒤에 다시"라고 알린다.
    await expect(page.getByRole("status")).toHaveText(
      "AI 요청이 너무 많아요. 잠시 뒤에 다시 찾기를 눌러 주세요.",
    );
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
    // 첫 model 요청은 시험이 풀어 줄 때까지 붙잡아 둔다(시간에 기대지 않는다).
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const { kind } = route.request().postDataJSON() as { kind: string };
        if (kind === "model") {
          modelCalls += 1;
          if (modelCalls === 1) await gate;
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
    release();
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
      "상세 캡처",
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

  test("7. 휴대폰 폭 375px: 모든 카드와 요약에서 가로 넘침이 없고, 하단 버튼이 화면 안에 붙고, 현재 질문이 위에 고정돼 있다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await page.setViewportSize({ width: 375, height: 667 });
    // checkFit은 카드마다 가로 넘침·하단 버튼과 함께 현재 질문이 위에 고정돼 있는지(스크롤을 끝까지 내려도 보이는지) 본다.
    await answerThroughSummary(page, { checkFit: true });

    // 요약 단계: 긴 글을 넣어도 넘치지 않는다.
    await page
      .getByRole("textbox", { name: "핵심 정리" })
      .fill("가".repeat(300));
    await expectFits(page);

    // R4-9: 핵심 정리 칸은 글에 맞게 늘어나서 칸 안 스크롤이 없다(낭독기로 듣게 될 글을 봉사자가 끝까지 읽고 보낸다).
    const guide = page.getByRole("textbox", { name: "핵심 정리" });
    const sevenLines = Array.from(
      { length: 7 },
      (_, index) => `${index + 1}줄째: 착용감이 편하고 소리가 또렷해서 오래 써도 귀가 덜 아파요. 버튼이 커서 손으로 찾기 쉬워요.`,
    ).join("\n");
    await guide.fill(sevenLines);
    await expect
      .poll(() => guide.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeLessThanOrEqual(1);
    const lineHeight = await guide.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    const guideBox = await guide.boundingBox();
    expect(guideBox!.height).toBeGreaterThan(lineHeight * 8);
    // 짧은 글에서도 8줄 높이는 지킨다.
    await guide.fill("짧은 정리");
    const shortBox = await guide.boundingBox();
    expect(shortBox!.height).toBeGreaterThanOrEqual(lineHeight * 8);
    await expectFits(page);
    await page.context().close();
  });

  test("7-2. 입력 칸이 띠에 가려지지 않는다: 실제 아이폰 사파리 높이(375×553·375×629·390×664)에서도 질문이 고정이고, 375×667·320×480의 글자 200%는 위 띠 고정이 풀려도 칸이 가려지지 않는다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await page.setViewportSize({ width: 375, height: 667 });
    await answerModel(page);
    await next(page);
    const pros = page.getByLabel("장점", { exact: true });
    await pros.fill("길게 적어요. ".repeat(12));

    // R4-1: 위 띠 고정 여부는 높이 미디어 쿼리가 아니라 JS 판정 하나(두 띠 합이 화면 높이의 절반 초과, 또는 둘을 뺀 남은 높이 220px 미만)다.
    // 375×553·375×629·390×664는 실제 아이폰 사파리의 보이는 높이(주소창·아래 막대를 뺀 값)에 가깝다.
    for (const [width, height, fontSize, position] of [
      [375, 667, "100%", "sticky"],
      [375, 553, "100%", "sticky"],
      [375, 629, "100%", "sticky"],
      [390, 664, "100%", "sticky"],
      [320, 568, "100%", "sticky"],
      [320, 480, "100%", "sticky"],
      [375, 667, "200%", "static"],
      [320, 480, "200%", "static"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, fontSize);
      // 판정은 크기 바뀜(resize·ResizeObserver) 뒤에 반영되므로 기다린다.
      await expect(page.locator(".rc-top"), `${width}×${height} ${fontSize}`).toHaveCSS("position", position);
      // 초점이 이미 칸에 있으면 focus()가 아무 일도 하지 않으므로 먼저 빼고, 화면 맨 아래·맨 위에서 각각 초점을 옮긴다.
      for (const where of ["bottom", "top"] as const) {
        await pros.evaluate((element) => (element as HTMLElement).blur());
        await page.evaluate(
          (edge) =>
            window.scrollTo(0, edge === "bottom" ? document.body.scrollHeight : 0),
          where,
        );
        await pros.focus();
        await expectNotCovered(page, pros, `${width}×${height} ${fontSize} ${where}`);
        // 작은 화면에서 초점을 받은 입력 칸이 띠 밖에 보이는 모습(스크린샷 확인용).
        if (width === 320 && fontSize === "200%" && where === "top") {
          await page.screenshot({ path: "test-results/research-small.png" });
        }
      }
      // 질문이 고정인 크기에서는 장점 칸에 쓰는 동안에도 질문이 화면 위쪽에 보인다.
      if (position === "sticky") {
        await pros.click();
        await pros.pressSequentially("더 적어요. ", { delay: 0 });
        await expect(question(page), `${width}×${height}`).toBeInViewport();
        await expectQuestionPinned(page);
      }
      // 하단 버튼은 화면에 붙어 있고 가로 넘침은 없다.
      await expectFits(page);
    }
    await page.context().close();
  });

  test("7-3. 장점 칸에 글을 쓰는 동안 현재 질문 글이 화면 위쪽에 보인다: 375×812와 실제 아이폰 사파리 높이(375×629, 390×664, 375×553)", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await page.setViewportSize({ width: 375, height: 812 });
    await answerModel(page);
    await next(page);
    await expect(question(page)).toHaveText(MOCK_PROS_QUESTION);

    const pros = page.getByLabel("장점", { exact: true });
    await pros.click();
    await pros.pressSequentially("오래 써도 귀가 덜 아파요. ".repeat(8), { delay: 0 });
    await expect(pros).toBeFocused();
    // 쓰는 동안과 화면을 끝까지 내린 뒤에도 질문이 위쪽에 보이고, 위 띠는 화면의 절반을 넘지 않는다.
    await expect(question(page)).toBeInViewport();
    await expectQuestionPinned(page);
    await expect(page.locator(".rc-top")).toHaveCSS("position", "sticky");
    const top = await page.locator(".rc-top").boundingBox();
    expect(top!.height).toBeLessThan(812 * 0.4);
    // 질문 카드 안에는 질문 글이 중심이다. 이용자가 한 말 상자와 배지 보조 문구는 스크롤 본문에 있다.
    await expect(page.locator(".rc-top").getByText("이용자가 한 말")).toHaveCount(0);
    await expect(page.locator(".rc-body").getByText("이용자가 한 말")).toBeVisible();

    // R4-1: 실제 아이폰 사파리의 보이는 높이에서도 위 띠가 붙어 있고, 쓰는 동안 질문이 화면 위쪽에 보인다.
    for (const [width, height] of [
      [375, 629],
      [390, 664],
      [375, 553],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(page.locator(".rc-top"), `${width}×${height}`).toHaveCSS("position", "sticky");
      await pros.click();
      await pros.pressSequentially("더 적어요. ", { delay: 0 });
      await expect(pros).toBeFocused();
      await expect(question(page), `${width}×${height}`).toBeInViewport();
      await expectQuestionPinned(page);
      const strip = await page.locator(".rc-top").boundingBox();
      expect(strip!.height, `${width}×${height}`).toBeLessThan(height * 0.5);
    }
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
    await button(page, "내려놓기 확인").click();
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

  test("8-2. 내려놓기는 한 번 눌러서는 지워지지 않는다: 안내와 [내려놓기 확인] [취소]가 나오고, 취소하면 아무것도 안 지워지고 초점이 버튼으로 돌아온다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page);
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("오래 써도 귀가 덜 아파요.");
    const id = requestIdOf(page);
    await expect(question(page)).toHaveText(MOCK_PROS_QUESTION);
    await expect.poll(async () => (await readStored(page))?.includes("장점을 알려 주세요")).toBe(true);
    const before = await readStored(page);
    const releaseCalls: string[] = [];
    page.on("request", (request) => {
      if (/\/release/.test(request.url())) releaseCalls.push(request.url());
    });

    const prompt =
      "내려놓으면 이 기기에 적은 답과 사진이 지워지고, 요청은 대기열로 돌아가요.";
    await button(page, "내려놓기").click();
    await expect(page.getByText(prompt)).toBeVisible();
    await expect(page.getByText(prompt)).toBeFocused();
    await expect(button(page, "내려놓기 확인")).toBeVisible();
    await expect(button(page, "취소")).toBeVisible();
    await expectNoBlockingAxe(page);
    await shootWhole(page, "test-results/research-release-confirm.png");

    // 취소: 아무것도 지워지지 않고 같은 카드에 머물며, 초점은 내려놓기 버튼으로 돌아온다.
    await button(page, "취소").click();
    await expect(page.getByText(prompt)).toHaveCount(0);
    await expect(button(page, "내려놓기")).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/volunteer/requests/${id}$`));
    expect(await readStored(page)).toBe(before);
    await expect(page.getByLabel("장점", { exact: true })).toHaveValue("오래 써도 귀가 덜 아파요.");
    expect(releaseCalls).toEqual([]);

    // Esc도 취소다.
    await button(page, "내려놓기").click();
    await expect(page.getByText(prompt)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByText(prompt)).toHaveCount(0);
    await expect(button(page, "내려놓기")).toBeFocused();
    expect(releaseCalls).toEqual([]);

    // R4-5: 확인 단계를 연 채 [다음]이나 [이전]으로 카드를 옮기면 새 카드에는 안내와 [내려놓기 확인]이 남지 않는다.
    await button(page, "내려놓기").click();
    await expect(page.getByText(prompt)).toBeVisible();
    await next(page);
    await expect(progress(page)).toHaveText("질문 3 / 7");
    await expect(page.getByText(prompt)).toHaveCount(0);
    await expect(button(page, "내려놓기 확인")).toHaveCount(0);
    await button(page, "내려놓기").click();
    await expect(page.getByText(prompt)).toBeVisible();
    await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 2 / 7");
    await expect(page.getByText(prompt)).toHaveCount(0);
    await expect(button(page, "내려놓기 확인")).toHaveCount(0);

    // 확인하면 내려놓는다.
    await button(page, "내려놓기").click();
    await button(page, "내려놓기 확인").click();
    await expect(page).toHaveURL(/\/volunteer$/);
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), `lh.vol.research.v1.${id}`),
    ).toBeNull();
    await page.context().close();
  });

  test("9. 보내기가 5xx로 실패하면 입력이 남고, 400이면 다른 안내를 하고, 403이면 목록 링크를 주고, 다시 보내면 성공한다", async ({
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
    await expect(page.getByRole("status")).toHaveText(SEND_INVALID);

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
    // 기기에 남은 AI 제안을 지워야 다시 열 때 서버를 부른다(저장이 끝난 뒤에 지운다).
    await expect
      .poll(async () => (await readStored(page)) ?? "")
      .toContain('"help":{"model"');
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
    // 기기에 남은 AI 제안(캐시)이 있으면 서버를 부르지 않고 그려서 이 시험이 아무것도 확인하지 못한다. 지우고 다시 연다.
    // 먼저 AI 제안이 기기에 저장될 때까지 기다린다(저장이 지운 뒤에 일어나면 지운 것이 되살아난다).
    await expect
      .poll(async () => (await readStored(page)) ?? "")
      .toContain('"help":{"model"');
    await page.evaluate(
      (key) => window.localStorage.removeItem(key),
      storageKey(page),
    );
    const research = page.waitForResponse(
      (response) =>
        response.url().includes("/api/volunteer/research") &&
        response.request().method() === "POST",
    );
    await page.reload();
    expect((await research).status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "리서치 챗" }),
    ).toBeVisible();
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
    await page.context().close();
  });

  test("9-3. 보내기에서 입장 정보(401)가 사라져 있으면 입장 화면으로 돌아간다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerThroughSummary(page);
    await page.route("**/api/volunteer/requests/*/result", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "unauthorized" }),
      }),
    );
    await button(page, SEND).click();
    await expect(page).toHaveURL(/\/volunteer$/);
    await page.context().close();
  });

  test("12. 도움을 받다가 요청이 사라지면(404) 거부 화면으로 가고, 이 기기의 진행 상태도 지워진다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page);
    const id = requestIdOf(page);
    // 다른 봉사자가 시연용 요청 다시 채우기를 누르면 시연 요청이 모두 지워진다.
    const other = await openDevice(browser, baseURL);
    await enterAs(other, "다른봉사자");
    await refill(other);
    await other.context().close();

    await next(page);
    await expect(page.getByText("이 요청은 내 담당이 아니에요")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "목록으로", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("question")).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        `lh.vol.research.v1.${id}`,
      ),
    ).toBeNull();
    await page.context().close();
  });

  test("12-2. 다른 탭에서 이미 보낸 요청이면(409) 완료 화면을 다시 불러오고, 이 기기의 진행 상태를 지운다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page);
    const id = requestIdOf(page);
    expect(await readStored(page)).not.toBeNull();
    const sent = await page.request.post(
      `/api/volunteer/requests/${id}/result`,
      {
        data: {
          candidates: [
            {
              name: "다른 탭에서 보낸 기종",
              url: "https://example.com/other-tab",
              guide: "다른 탭에서 보냈어요.",
              summary: [{ label: "구분", value: "추천 기종" }],
            },
          ],
        },
      },
    );
    expect([200, 201]).toContain(sent.status());

    await next(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await expect(page.getByText("다른 탭에서 보냈어요.")).toBeVisible();
    expect(await readStored(page)).toBeNull();
    await page.context().close();
  });

  test("12-3. 사진 설명이 413·415·429로 실패하면 이유에 맞는 안내를 하고 직접 쓸 수 있다", async ({
    browser,
    baseURL,
  }) => {
    const codes = [413, 415, 429];
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const { kind } = route.request().postDataJSON() as { kind: string };
        if (kind !== "photo") return route.fallback();
        const status = codes.shift() ?? 500;
        return route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "x" }),
        });
      }),
    );
    await answerModel(page);
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("편해요.");
    await next(page);
    await uploadPhoto(page);
    const describe = page.getByRole("button", {
      name: "AI로 사진 설명 만들기 (사진 1)",
    });
    const status = page.getByRole("status");
    await describe.click();
    await expect(status).toHaveText(
      "사진이 너무 커서 설명을 만들지 못했어요. 직접 적어 주세요.",
    );
    await describe.click();
    await expect(status).toHaveText(
      "이 사진 형식으로는 설명을 만들지 못했어요. 직접 적어 주세요.",
    );
    await describe.click();
    await expect(status).toHaveText(
      "AI 요청이 너무 많아요. 잠시 뒤에 다시 찾기를 눌러 주세요.",
    );
    await describe.click();
    await expect(status).toHaveText(
      "사진 설명을 만들지 못했어요. 직접 적어 주세요.",
    );
    await page.getByLabel("사진 1 설명").fill("직접 쓴 설명");
    await next(page);
    await expect(progress(page)).toHaveText("질문 4 / 7");
    await page.context().close();
  });

  test("13. 늦게 온 옛 응답이 새 기종의 후보와 안내를 덮지 않는다(실패 응답도 마찬가지)", async ({
    browser,
    baseURL,
  }) => {
    let altsCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const body = route.request().postDataJSON() as {
          kind: string;
          model?: string;
        };
        if (body.kind !== "alts") return route.fallback();
        altsCalls += 1;
        if (altsCalls === 1) {
          // 옛 기종(LH-200)의 검색은 붙잡아 두었다가, 새 기종 검색이 끝난 뒤 429로 끝낸다.
          await gate;
          return route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "rate_limited" }),
          });
        }
        return route.fulfill({
          json: {
            kind: "alts",
            ai: "ok",
            items: [
              {
                name: "새 기종의 대안 NEW-1",
                note: "",
                url: "https://example.com/new-1",
                origin: "web",
              },
            ],
          },
        });
      }),
    );
    await answerModel(page);
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("편해요.");
    await next(page);
    await uploadPhoto(page);
    await next(page);
    await expect(progress(page)).toHaveText("질문 4 / 7");
    await expect(page.getByTestId("ai-searching")).toBeVisible();

    // 검색이 도는 중에 카드 1로 돌아가 기종을 바꾸고 다시 카드 4로 온다.
    for (let step = 0; step < 3; step += 1) await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 1 / 7");
    await page.getByTestId("candidate-chip").nth(1).click();
    await expect(page.getByLabel("기종 이름")).toHaveValue("가짜 헤드셋 LH-300");
    for (let step = 0; step < 3; step += 1) await next(page);
    await expect(progress(page)).toHaveText("질문 4 / 7");
    await expect(page.getByTestId("candidate-chip")).toHaveText([
      /새 기종의 대안 NEW-1/,
    ]);
    await expect(page.getByRole("status")).toHaveText(
      "1개를 찾았어요. 확인 필요.",
    );

    // 이제 늦은 옛 응답(429)이 도착해도 후보·안내·상태는 그대로다.
    release();
    await expect.poll(() => altsCalls).toBe(2);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("candidate-chip")).toHaveText([
      /새 기종의 대안 NEW-1/,
    ]);
    await expect(page.getByTestId("ai-failed")).toHaveCount(0);
    await expect(page.getByTestId("ai-searching")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText(
      "1개를 찾았어요. 확인 필요.",
    );
    await page.context().close();
  });

  test("14. 사진을 여러 장 한 번에 고르면 남은 자리만큼만 올라가고, 장수와 인증 안내가 맞다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerModel(page, BOUGHT);
    await next(page);
    await page.getByLabel("장점", { exact: true }).fill("편해요.");
    await next(page);
    const status = page.getByRole("status");

    // 한 번에 2장: 인증이 새로 생기고 장수는 2장이다.
    await pickPhotos(page, 2);
    await expect(page.getByTestId("photo-item")).toHaveCount(2);
    await expect(status).toHaveText(`${BADGE_VERIFIED}. 사진 2장을 올렸어요.`);

    // 이어서 2장을 더 고르면 1자리뿐이라 1장만 올라가고 넘친 장수를 알린다.
    await pickPhotos(page, 2);
    await expect(page.getByTestId("photo-item")).toHaveCount(3);
    await expect(status).toHaveText(
      "사진은 3장까지라 1장은 올리지 않았어요.",
    );
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);

    // 자리가 없으면 고르는 버튼이 사라진다. 모두 지우고 3장을 한 번에 고른다.
    for (let count = 3; count > 0; count -= 1) {
      await page.getByRole("button", { name: "사진 1 지우기" }).click();
    }
    await pickPhotos(page, 3);
    await expect(page.getByTestId("photo-item")).toHaveCount(3);
    await expect(status).toHaveText(`${BADGE_VERIFIED}. 사진 3장을 올렸어요.`);
    await page.context().close();
  });

  test("15. 앞 카드에서 기종을 고치면 요약의 핵심 정리 초안이 새 기종으로 다시 채워지고, 직접 고친 글은 남는다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const body = route.request().postDataJSON() as {
          kind: string;
          model?: string;
        };
        if (body.kind !== "summary") return route.fallback();
        return route.fulfill({
          json: { kind: "summary", ai: "ok", text: `${body.model} 정리예요.` },
        });
      }),
    );
    await answerThroughSummary(page);
    const guide = page.getByRole("textbox", { name: "핵심 정리" });
    await expect(guide).toHaveValue("가짜 헤드셋 LH-200 정리예요.");

    // 카드 1로 돌아가 기종을 LH-300으로 고치고 요약으로 돌아온다.
    for (let step = 0; step < 7; step += 1) await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 1 / 7");
    await page.getByTestId("candidate-chip").nth(1).click();
    for (let step = 0; step < 6; step += 1) await next(page);
    await expect(progress(page)).toHaveText("질문 7 / 7");
    await next(page, "요약 보기");
    await expect(guide).toHaveValue("가짜 헤드셋 LH-300 정리예요.");

    // 봉사자가 직접 고친 글은 기종을 또 고쳐도 그대로다.
    await guide.fill("내가 직접 쓴 정리");
    await button(page, "이전").click();
    for (let step = 0; step < 6; step += 1) await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 1 / 7");
    await page.getByTestId("candidate-chip").nth(2).click();
    for (let step = 0; step < 6; step += 1) await next(page);
    await next(page, "요약 보기");
    await expect(guide).toHaveValue("내가 직접 쓴 정리");

    // 보낸 글도 같다.
    await button(page, SEND).click();
    await expect(page.locator(".vol-sent-text--lines")).toHaveText(
      "내가 직접 쓴 정리",
    );
    await page.context().close();
  });

  test("16. 참고 글 요약이 비어도 링크가 있으면 링크 상자를 'AI가 찾은 참고 글'로 보인다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL, (device) =>
      device.route("**/api/volunteer/research", async (route) => {
        const { kind } = route.request().postDataJSON() as { kind: string };
        if (kind !== "refs") return route.fallback();
        return route.fulfill({
          json: {
            kind: "refs",
            ai: "ok",
            digest: [],
            links: [
              {
                title: "후기 글 하나",
                url: "https://example.com/review",
                origin: "web",
              },
            ],
            shortcuts: [],
          },
        });
      }),
    );
    await answerRequiredCards(page);
    await button(page, "건너뛰기").click();
    await expect(progress(page)).toHaveText("질문 7 / 7");
    await expect(page.getByTestId("link-row")).toHaveCount(1);
    await expect(aiBox(page, "refs")).toContainText("AI가 찾은 참고 글");
    await expect(page.getByText("제가 읽은 내용은 여기까지예요")).toHaveCount(0);
    await expect(page.getByTestId("ai-digest")).toHaveCount(0);
    // 서버가 바로가기를 비워 보내도 화면이 직접 만든 바로가기가 보인다.
    await expect(
      page.getByRole("link", { name: "네이버 블로그에서 찾기" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("17. 선택 카드에 답이 있으면 건너뛰기가 사라지고, 구매 여부를 되돌리면 착샷 표시가 살아난다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    await answerRequiredCards(page);
    await expect(progress(page)).toHaveText("질문 6 / 7");
    await expect(button(page, "건너뛰기")).toBeVisible();
    const benefits = page.getByLabel("혜택", { exact: true });
    await benefits.fill("카드 할인");
    await expect(button(page, "건너뛰기")).toHaveCount(0);
    await benefits.fill("");
    await expect(button(page, "건너뛰기")).toBeVisible();
    // 링크를 체크해도 답이 있는 것으로 본다.
    await page.getByTestId("link-row").first().getByRole("checkbox").check();
    await expect(button(page, "건너뛰기")).toHaveCount(0);

    // 구매 여부: 리서치만으로 바꾸면 사진 태그가 상세 캡처, 다시 구매했어요로 돌리면 착샷.
    for (let step = 0; step < 5; step += 1) await button(page, "이전").click();
    await expect(progress(page)).toHaveText("질문 1 / 7");
    await button(page, RESEARCH_ONLY).click();
    await expect(badge(page)).toHaveText("리서치만");
    await button(page, BOUGHT).click();
    await next(page);
    await next(page);
    await expect(page.getByTestId("photo-item").first()).toContainText("착샷");
    await expect(badge(page)).toHaveText(BADGE_VERIFIED);
    await page.context().close();
  });

  test("18. 기기 저장: 보내는 중에 화면을 떠나도 진행 상태가 지워지고, 옛 초안 키가 정리되고, 저장 실패는 한 번 알린다", async ({
    browser,
    baseURL,
  }) => {
    const page = await openSonyResearch(browser, baseURL);
    const id = requestIdOf(page);
    await page.evaluate(() =>
      window.localStorage.setItem("lh.vol.draft.v1.old-request", "{}"),
    );
    await answerThroughSummary(page);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/volunteer/requests/*/result", async (route) => {
      await gate;
      await route.fallback();
    });
    await button(page, SEND).click();
    await expect(page.getByRole("status")).toHaveText("보내는 중이에요.");
    // 한 번 더 눌러도 아무 말이 없는 일이 없다(잠긴 버튼이라 force로 누른다).
    await button(page, SEND).click({ force: true });
    await expect(page.getByRole("status")).toHaveText("보내는 중이에요.");
    // 응답이 오기 전에 목록으로 나간다.
    await page.getByRole("link", { name: "내 담당 목록으로" }).click();
    await expect(page).toHaveURL(/\/volunteer\?tab=mine/);
    release();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => window.localStorage.getItem(key),
          `lh.vol.research.v1.${id}`,
        ),
      )
      .toBeNull();
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("lh.vol.draft.v1.old-request"),
      ),
    ).not.toBeNull();
    // 이 요청의 화면을 다시 열면 옛 초안 키가 정리된다.
    await page.goto(`/volunteer/requests/${id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "완료된 요청" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("lh.vol.draft.v1.old-request"),
        ),
      )
      .toBeNull();
    await page.context().close();
  });

  test("18-2. 기기에 저장하지 못하면 한 번 알린다", async ({
    browser,
    baseURL,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = await openSonyResearch(browser, baseURL, async (device) => {
      await device.route("**/api/volunteer/research", async (route) => {
        await gate;
        await route.fallback();
      });
      // 저장 공간이 가득 찬 기기처럼 리서치 상태 저장만 실패하게 한다.
      await device.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (String(key).startsWith("lh.vol.research.")) {
            throw new DOMException("full", "QuotaExceededError");
          }
          return original.call(this, key, value);
        };
      });
    });
    await expect(page.getByRole("status")).toHaveText(
      "이 기기에 진행 내용을 저장하지 못했어요. 새로 고치면 사라질 수 있어요.",
    );
    release();
    await expect(page.getByTestId("candidate-chip")).toHaveCount(3);
    await page.context().close();
  });

  test("19. 지워진 옛 요약 주소는 봉사자용 한국어 404로, 이용자 쪽 없는 주소는 바뀌지 않는다", async ({
    page,
  }) => {
    await page.goto(`/enter?code=${E2E_ACCESS_CODE}`);
    const gone = await page.goto(
      "/volunteer/requests/6f1c2e4a-1111-4222-8333-444455556666/summary",
    );
    expect(gone?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "페이지를 찾지 못했어요" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "내 담당 목록으로" }),
    ).toBeVisible();

    const other = await page.goto("/no-such-page");
    expect(other?.status()).toBe(404);
    await expect(page.getByText("페이지를 찾지 못했어요")).toHaveCount(0);
  });
});
