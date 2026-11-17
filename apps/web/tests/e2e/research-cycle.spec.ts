import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { priceStockViolations } from "../../src/lib/answerRules";
import { claimDemo, enterAs, FIRST_DEMO_QUOTE, refill } from "./helpers/volunteerFlow";

// 대화형 리서치 챗 한 사이클(실제 AI, 공개 주소). `npm run test:research-cycle`, BASE_URL이 필요하다.
// 입장 → 시연용 요청 채우기 → 헤드셋 맡기 → 지금 묻는 칸(질문 n)에 맞춰 답하기 → 리뷰 만들기 → 검수 마치기 → 보내기 → 완료 화면.
// 실제 AI는 답이 매번 다르고 fallback으로 답할 수도 있으므로 순서를 정해 두지 않고 "지금 질문"을 읽어 답한다.
// 기록하는 것은 호출 종류·상태·ai 값(ok·fallback·capped)뿐이다. 후보 이름·링크·글은 남기지 않는다.
// 금액·재고 표현(answerRules의 PRICE·STOCK 패턴)은 응답 JSON이 아니라 화면에 보이는 AI 말풍선·카드·리뷰 글에서 본다(새로 고친 GET 화면 포함).
// 설계 7절의 정해진 입력(혜택 카드 [확인했어요] 포함)과 검색 3종(model·alts·benefits) 호출, 제품·혜택 목록이 보였는지도 확인한다.
// 유료 호출이 든다(턴 7~10번, 검색 3번, 리뷰 1번). 돌리기 전에 누계를 본다.

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeAll(() => {
  if (!process.env.BASE_URL) throw new Error("test:research-cycle은 BASE_URL이 필요합니다.");
});

const composer = (page: Page) => page.locator("#vc-composer-input");

/** 화면에 보이는 AI 글(말풍선·카드 안 글)과 리뷰 글에서 가격·재고 표현을 찾아 모은다(주소 글자는 뺀다). 카운트는 건수다. */
async function scanScreen(page: Page, found: Set<string>) {
  const texts = [
    ...(await page.locator(".vc-row--ai").allInnerTexts()),
    ...(await page.locator(".vc-review-body").allInnerTexts()),
  ];
  for (const text of texts) {
    for (const violation of priceStockViolations(text.replace(/https?:\S+/g, ""))) found.add(`${violation.rule}:${violation.detail}`);
  }
}

/** 대화가 한가해질 때까지(생각 중 표시 없음) 기다린다. */
async function idle(page: Page) {
  await expect(page.getByTestId("thinking")).toHaveCount(0, { timeout: 120_000 });
}

async function currentSlotName(page: Page): Promise<string | null> {
  const line = page.getByTestId("current-question");
  if ((await line.count()) === 0) return null;
  const text = (await line.innerText()).replace(/\s+/g, " ");
  const match = /질문 \d · (.+?)\s*(?:필수|선택)?$/.exec(text);
  return match ? match[1].trim() : null;
}

test("공개 주소 리서치 챗 한 사이클: 맡기 → 질문 7개 → 리뷰 검수 → 보내기", async ({ page }) => {
  test.setTimeout(420_000);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `cycle-${randomUUID()}` });

  const records: Array<{ kind: string; status: number; ai: string }> = [];
  const searchKinds: string[] = [];
  const wording = new Set<string>();
  let benefitChecked = false;
  let altsListSeen = false;
  let benefitsListSeen = false;
  page.on("request", (request) => {
    if (request.method() !== "POST" || !/\/research\/search$/.test(new URL(request.url()).pathname)) return;
    try {
      searchKinds.push(String((request.postDataJSON() as { kind?: string }).kind));
    } catch {
      searchKinds.push("?");
    }
  });
  page.on("response", async (response) => {
    const match = /\/research\/(turn|search|photos|review|send)$/.exec(new URL(response.url()).pathname);
    if (!match || response.request().method() !== "POST") return;
    const text = await response.text().catch(() => "");
    let json: { ai?: string; messages?: Array<{ ai?: string | null }> } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    records.push({
      kind: match[1],
      status: response.status(),
      ai: json?.ai ?? json?.messages?.find((message) => message.ai)?.ai ?? "-",
    });
  });

  await enterAs(page);
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);
  await expect(page.getByTestId("research-stage")).toBeVisible();

  // 히어로 → 구매했어요(AI 없음) → 질문 따라 답하기.
  await page.getByRole("group", { name: "빠른 답" }).getByRole("button", { name: "구매했어요", exact: true }).click();

  let reviewProposed = false;
  for (let step = 0; step < 30 && !reviewProposed; step += 1) {
    // 방금 한 입력이 "생각 중" 표시로 바뀌기 전에 다음 판단을 하지 않게 잠깐 둔다.
    await page.waitForTimeout(600);
    await idle(page);
    const quick = page.getByRole("group", { name: "빠른 답" });
    if ((await quick.getByRole("button", { name: "넣기", exact: true }).count()) > 0) {
      await quick.getByRole("button", { name: "넣기", exact: true }).click();
      continue;
    }
    if ((await quick.getByRole("button", { name: "리뷰 만들기" }).count()) > 0) {
      reviewProposed = true;
      break;
    }
    const slot = await currentSlotName(page);
    console.log(`단계 ${step}: 지금 질문 ${slot ?? "없음"}`);
    await scanScreen(page, wording);
    if ((await page.getByRole("list", { name: "웹에서 찾은 관련 제품" }).count()) > 0) altsListSeen = true;
    const type = async (text: string) => {
      await composer(page).fill(text);
      await composer(page).press("Enter");
    };
    if (slot === "기종") {
      const chips = page.locator(".vc-chip--ai:not([aria-disabled=true])");
      if ((await chips.count()) > 0) await chips.first().click();
      else await type("소니 WH-CH720N");
    } else if (slot === "장점") {
      await type("오래 써도 귀가 덜 아파요.");
    } else if (slot === "사진") {
      await page.getByRole("button", { name: "사진 올리기" }).click();
      const dialog = page.getByRole("dialog", { name: "사진 올리기" });
      await dialog.locator("input[type=file]").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1X1 });
      await expect(page.getByTestId("purchase-badge")).toHaveText("구매 인증됨", { timeout: 60_000 });
    } else if (slot === "같이 고민한 제품") {
      const pick = page.getByRole("button", { name: /^같이 고민했어요 / }).first();
      if ((await pick.count()) > 0) await pick.click();
      else await quick.getByRole("button", { name: "같이 고민한 제품 없어요" }).click();
    } else if (slot === "대안 이유") {
      await type("더 가벼운 쪽을 골랐어요.");
    } else if (slot === "혜택") {
      await type("카드 할인 받고 무료 배송이었어요");
      // 혜택 검색이 끝나면(카드가 없어도 끝난다) 혜택 카드 하나를 [확인했어요]로 확인한다.
      const benefitList = page.getByRole("list", { name: "찾은 혜택" }).first();
      await benefitList.waitFor({ timeout: 120_000 }).catch(() => undefined);
      if ((await benefitList.count()) > 0) {
        benefitsListSeen = true;
        const button = benefitList.getByRole("button", { name: /^확인했어요/ }).first();
        if ((await button.count()) > 0) {
          await button.click();
          await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
          benefitChecked = true;
        }
      }
    } else if (slot === "참고 글") {
      await quick.getByRole("button", { name: "건너뛰기" }).click();
    } else {
      // 지금 질문이 없다(칸 채움 뒤 안내 등). 잠깐 뒤 다시 본다.
      await page.waitForTimeout(500);
    }
  }
  expect(reviewProposed).toBe(true);

  // 새로 고쳐 GET으로 다시 그린 화면에서도 금액·재고 표현을 본다. 혜택 카드의 확인 표시는 서버 칸에서 돌아온다.
  await page.reload();
  await expect(page.getByTestId("research-stage")).toBeVisible();
  await idle(page);
  await scanScreen(page, wording);
  if (benefitChecked) await expect(page.getByRole("list", { name: "찾은 혜택" }).first().locator('[aria-pressed="true"]').first()).toBeVisible();

  // 리뷰 만들기 → 초안(AI 또는 틀 문단)을 그대로 검수 마치기 → 보내기.
  await page.getByRole("group", { name: "빠른 답" }).getByRole("button", { name: "리뷰 만들기" }).click();
  const card = page.getByRole("region", { name: "이용자에게 보낼 리뷰" });
  await expect(card).toContainText("AI 초안", { timeout: 120_000 });
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "검수하기" }).click();
  await page.getByRole("button", { name: "검수 마치기" }).click();
  await expect(page.getByText("봉사자 검수 완료")).toBeVisible({ timeout: 30_000 });
  await scanScreen(page, wording);
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  // 보낸 뒤에도 같은 챗봇 화면에 머물며 보낸 리뷰를 읽기 전용으로 보인다.
  await expect(page.getByTestId("sent-review")).toBeVisible();
  await expect(page.getByTestId("sent-review").getByText("전달 완료", { exact: true })).toBeVisible();

  console.log(`리서치 호출 ${records.length}회: ${records.map((record) => `${record.kind}:${record.status}:${record.ai}`).join(" ")}`);
  console.log(`ai=ok ${records.filter((r) => r.ai === "ok").length}회, fallback ${records.filter((r) => r.ai === "fallback").length}회, capped ${records.filter((r) => r.ai === "capped").length}회`);
  console.log(`화면에서 찾은 금액·재고 표현: ${wording.size}건`);
  console.log(`검색 호출: ${searchKinds.join(", ")} · 제품 목록 ${altsListSeen ? "보임" : "안 보임"} · 혜택 목록 ${benefitsListSeen ? "보임" : "안 보임"} · 혜택 확인 ${benefitChecked ? "함" : "못 함"}`);
  // 오류 응답은 429(한도)만 허용한다.
  expect(records.filter((record) => record.status >= 400 && record.status !== 429)).toEqual([]);
  expect(records.filter((record) => record.kind === "send" && record.status === 201)).toHaveLength(1);
  expect([...wording]).toEqual([]);
  // 검색 3종을 모두 불렀고(모델·대안·혜택), 제품·혜택 목록이 보였고, 혜택 카드를 확인했다.
  expect(searchKinds).toEqual(expect.arrayContaining(["model", "alts", "benefits"]));
  expect(altsListSeen).toBe(true);
  expect(benefitsListSeen).toBe(true);
  expect(benefitChecked).toBe(true);

  // 정리: 시연용 요청을 다시 채운다(이 기기에서 보낸 요청도 시연 기본값으로 돌아간다).
  await page.goto("/volunteer");
  await expect(page.getByRole("heading", { level: 1, name: "봉사자" })).toBeVisible();
  await refill(page);
});
