import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { checkAnswer } from "../../src/lib/answerRules";
import { MATCH_TIMEOUT_MS } from "../../src/lib/matchHandoff";
import { REQUEST_TIMEOUT_MS } from "../../src/lib/requestRecord";
import { installFakeSpeech, say } from "./helpers/fakeSpeech";
import { completeFlowA, DEFAULT_ANSWERS } from "./helpers/flowA";
import { BOUGHT, button, next, SEND } from "./helpers/researchFlow";
import { claimDemo, FIRST_DEMO_QUOTE, makeSyntheticDetailImage, refill } from "./helpers/volunteerFlow";

// 접근 코드는 저장소 루트 .demo-access.local의 첫 줄에서만 읽는다.
function readAccessCode(): string {
  const file = path.resolve(__dirname, "../../../../.demo-access.local");
  return readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
}

// Playwright가 apps/web/test-results를 비우므로 기록은 저장소 루트에 둔다.
const RECORD_DIR = path.resolve(__dirname, "../../../../test-results/public");
const CHAT_TIMEOUT_MS = 40_000;

test.beforeAll(() => {
  if (!process.env.BASE_URL) {
    throw new Error("test:public은 BASE_URL이 필요합니다.");
  }
});

test("공개 주소 첫 화면과 음성 시험 페이지가 열린다", async ({ page }) => {
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "LightHouse" })).toBeVisible();

  const probe = await page.goto("/speech-probe/");
  expect(probe?.status()).toBe(200);
});

test("공개 주소 접근 코드와 health", async ({ request }) => {
  const wrong = await request.get("/enter?code=wrong", { maxRedirects: 0 });
  expect(wrong.status()).toBe(401);

  const noCookie = await request.get("/api/health");
  expect(noCookie.status()).toBe(401);

  const right = await request.get("/enter", {
    params: { code: readAccessCode() },
    maxRedirects: 0,
  });
  expect(right.status()).toBe(303);
  expect(right.headers()["location"]).toBe("/");

  const setCookie = right.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Secure/i);

  const health = await request.get("/api/health", {
    headers: { cookie: setCookie.split(";")[0] },
  });
  expect(health.status()).toBe(200);
  const body = await health.json();
  // PR 2: health에 저장소 종류(store)를 더했다(시험 변경). 키 값은 없다.
  expect(Object.keys(body).sort()).toEqual([
    "extractEngine",
    "llmKeyConfigured",
    "llmMode",
    "ok",
    "store",
  ]);
  expect(body.llmMode).toBe("live");
  expect(["supabase", "memory"]).toContain(body.store);
  console.log(`llmKeyConfigured=${body.llmKeyConfigured}`);
  // memory면 실패가 아니라 "흉내"다(실제 저장소에 연결되지 않음).
  console.log(`store=${body.store}${body.store === "memory" ? " (흉내)" : ""}`);
  console.log(`extractEngine=${body.extractEngine}`);
});

// 가짜 음성 입력 기준이다. 답변만 실제 OpenAI이고 실행마다 유료 호출이 1회 든다.
test("공개 주소 완주: 가짜 음성, 대기열 접수, 다시 조회, 이어 보기, 실제 OpenAI 답변", async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(RECORD_DIR, { recursive: true });
  const shot = (name: string) =>
    page.screenshot({ path: path.join(RECORD_DIR, `${name}.png`) });

  await installFakeSpeech(page);

  // 주소에 접근 코드가 있으므로 오류 내용과 주소 전체를 출력하지 않는다.
  const entered = await page
    .goto(`/enter?code=${encodeURIComponent(readAccessCode())}`)
    .catch(() => null);
  expect(entered?.status(), "접근 코드로 입장").toBe(200);
  expect(new URL(page.url()).pathname).toBe("/");
  await shot("user-first-screen");

  // 대기열 접수(POST /api/requests) 1회와 조회(GET) 2회의 저장소 시간을 잰다(결정 11).
  const registerResponse = page.waitForResponse("**/api/requests");
  const registerStartedAt = Date.now();
  const queueNumber = await completeFlowA(page, DEFAULT_ANSWERS, {
    timeout: REQUEST_TIMEOUT_MS + 5_000,
  });
  const registered = await registerResponse;
  const registerMs = Date.now() - registerStartedAt;
  expect(registered.status()).toBe(201);
  const { requestId } = await registered.json();
  console.log(
    `POST /api/requests status=${registered.status()} queueNumber=${queueNumber} ` +
      `server-timing="${registered.headers()["server-timing"] ?? ""}" ` +
      `flow-ms(답 확인부터 대기번호까지, 근사)=${registerMs}`,
  );
  for (const round of [1, 2]) {
    const startedAt = Date.now();
    const checked = await page.request.get(`/api/requests/${requestId}`);
    const roundTripMs = Date.now() - startedAt;
    expect(checked.status()).toBe(200);
    expect((await checked.json()).queueNumber).toBe(queueNumber);
    console.log(
      `GET /api/requests/[id] #${round} status=${checked.status()} ` +
        `server-timing="${checked.headers()["server-timing"] ?? ""}" round-trip-ms=${roundTripMs}`,
    );
  }
  await shot("user-queued");

  const handoff = page.getByRole("button", { name: "봉사자 화면으로(시연)" });
  await expect(handoff).toBeVisible();
  const matchResponse = page.waitForResponse("**/api/match", {
    timeout: MATCH_TIMEOUT_MS + 5_000,
  });
  await handoff.click();
  expect((await matchResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/volunteer\/demo$/);
  await page.getByRole("button", { name: "눌러서 질문하기" }).click();
  await say(page, "sony 헤드셋 제품을 찾는 가이드 알려줘");
  const confirm = page.getByRole("button", { name: "이대로 질문" });
  await expect(confirm).toBeFocused();

  const chatResponse = page.waitForResponse("**/api/chat");
  const startedAt = Date.now();
  await confirm.click();
  expect((await chatResponse).status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("답변이 도착했습니다.", {
    timeout: CHAT_TIMEOUT_MS,
  });
  const elapsedMs = Date.now() - startedAt;

  const answer = page.locator(".chat-answer");
  await expect(answer).toBeFocused();
  const text = (await answer.innerText()).trim();
  expect(text.length).toBeGreaterThan(0);

  // 아래 접근성 검사가 실패해도 유료로 받은 답변이 남도록 먼저 기록한다.
  writeFileSync(path.join(RECORD_DIR, "answer.txt"), `${text}\n`, "utf8");
  console.log(`답변 첫 줄: ${text.split(/\r?\n/)[0]}`);
  console.log(`소요 시간: ${elapsedMs}ms`);
  const violations = checkAnswer(text);
  console.log(`답변 규칙 위반: ${JSON.stringify(violations)}`);
  // 위반이면 시험은 실패하되, 아래 화면 기록과 접근성 검사까지는 마친다.
  expect.soft(violations, "답변 규칙 위반").toEqual([]);
  await answer.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(RECORD_DIR, "volunteer-answer.png"),
    fullPage: true,
  });

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
});

// ④ 리서치 챗을 공개 주소에서 실제 엔진(gpt-6-luna)으로 1회 완주한다. 실행마다 검색 호출이 4번(기종·대안·혜택·참고 글),
// 그 밖의 호출이 몇 번 든다. 돌리기 전에 누계를 본다.
// 입장 → 시연용 요청 다시 채우기 → 헤드셋 맡기 → 카드 1~7 → 보내기 전 확인 → 보내기 → 완료 화면 → 목록으로.
// 실제 AI가 fallback으로 답해도 흐름은 끝까지 가야 한다(기본 질문·직접 입력·바로가기). 기록하는 것은 종류별 상태와 ai 값(ok·fallback)뿐이고,
// 후보 이름·링크·글은 남기지 않는다. 금액·재고 표현이 응답에 없는지만 확인한다.
test("④ 입장·맡기·리서치 챗 카드 1~7·보내기 완주", async ({ page }) => {
  test.setTimeout(420_000);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });

  // 입장(코드와 별명). 이 기기가 봉사자가 된다.
  await page.goto("/volunteer");
  await page.getByLabel("입장 코드").fill(readAccessCode());
  await page.getByLabel("별명").fill("시험");
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
  await refill(page);

  const records: Array<{ kind: string; status: number; ai: string; ms: number }> = [];
  // 값은 남기지 않고, 응답 글에 금액·재고 표현이 있었는지만 센다.
  let moneyLike = 0;
  // 서버 검사(researchCheck.hasForbidden)의 부분집합이다. 맨 '재고'나 쉼표 숫자(5,000mAh)처럼 서버가 통과시키는 글은 세지 않는다.
  const MONEY_LIKE = /\d\s*(?:원(?!칙|색|소)|%|달러)|품절|매진|최저가|할인가|재고\s*(?:[:：]|가|는|도|를|을|이)/;
  page.on("response", async (response) => {
    if (!response.url().includes("/api/volunteer/research") || response.request().method() !== "POST") return;
    const text = await response.text().catch(() => "");
    let json: { kind?: string; ai?: string } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    // 바로가기 주소의 검색어(예: 소니 WH 후기)는 지나가므로 URL 글자를 뺀 글만 본다.
    const plain = text.replace(/https?:[^"\s]+/g, "");
    if (MONEY_LIKE.test(plain)) moneyLike += 1;
    records.push({
      kind: json?.kind ?? "-",
      status: response.status(),
      ai: json?.ai ?? "-",
      ms: Math.round(response.request().timing().responseEnd),
    });
  });

  await claimDemo(page, FIRST_DEMO_QUOTE);
  const settled = async () => {
    // 카드의 AI 제안이 끝날 때까지(찾는 중이 사라질 때까지) 기다린다. 실패해도 사라진다.
    await expect(page.getByTestId("ai-searching")).toHaveCount(0, { timeout: 90_000 });
  };

  // 카드 1: 후보 칩이 있으면 누르고, fallback이면 직접 쓴다.
  await settled();
  const chips = page.getByTestId("candidate-chip");
  if ((await chips.count()) > 0) await chips.first().click();
  else await page.getByLabel("기종 이름").fill("소니 WH-CH720N");
  await button(page, BOUGHT).click();
  await next(page);

  // 카드 2: 장점. AI 질문이 와도 입력 칸은 같다.
  await expect(page.getByLabel("장점", { exact: true })).toBeVisible();
  await page.getByLabel("장점", { exact: true }).fill("오래 써도 귀가 덜 아파요.");
  await next(page);

  // 카드 3: 합성 사진 1장(착샷). 사진 설명 만들기는 부르지 않는다.
  const buffer = await makeSyntheticDetailImage(page, { width: 860, height: 900, noise: false });
  await page.getByTestId("photo-input").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
  await expect(page.getByTestId("photo-item")).toHaveCount(1);
  await next(page);

  // 카드 4: 대안 후보 또는 직접 입력.
  await settled();
  if ((await chips.count()) > 0) await chips.first().click();
  else {
    await page.getByLabel("제품 이름").fill("소니 WH-CH520");
    await button(page, "추가").click();
  }
  await next(page);

  // 카드 5: 이유.
  await page.getByLabel("고민한 이유", { exact: true }).fill("더 가벼운 쪽을 골랐어요.");
  await next(page);

  // 카드 6·7: 건너뛴다(AI 제안이 끝난 뒤).
  await settled();
  await button(page, "건너뛰기").click();
  await settled();
  await button(page, "건너뛰기").click();

  // 보내기 전 확인: 핵심 정리 초안(실제 AI 또는 기본 글)이 채워지면 보낸다.
  await expect(page.getByRole("heading", { level: 2, name: "보내기 전 확인" })).toBeVisible();
  const guide = page.getByRole("textbox", { name: "핵심 정리" });
  await expect(guide).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(guide).not.toHaveValue("");
  await expect(button(page, SEND)).not.toHaveAttribute("aria-disabled", "true");
  await button(page, SEND).click();
  await expect(page.getByRole("heading", { level: 1, name: "완료된 요청" })).toBeVisible();
  await expect(page.getByText("전달 완료", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "목록으로", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이 기기에서 보낸 요청" })).toBeVisible();
  await expect(page.locator(".vol-card").filter({ hasText: "소니 무선 헤드셋" })).toContainText("전달 완료");

  const summary = records.map((record) => `${record.kind}:${record.status}:${record.ai}:${record.ms}ms`);
  console.log(`리서치 호출 ${records.length}회: ${summary.join(" ")}`);
  console.log(`ai=ok ${records.filter((r) => r.ai === "ok").length}회, fallback ${records.filter((r) => r.ai === "fallback").length}회`);
  console.log(`금액·재고 표현이 든 응답: ${moneyLike}건`);
  // 오류 응답(4xx·5xx)은 429(한도)만 허용한다. 429여도 카드는 진행됐다.
  expect(records.filter((record) => record.status !== 200 && record.status !== 429)).toEqual([]);
  expect(records.length).toBeGreaterThanOrEqual(6);
  expect(moneyLike).toBe(0);

  // 정리: 시연용 요청을 다시 채운다(이 기기에서 보낸 요청도 시연 기본값으로 돌아간다).
  await page.getByRole("button", { name: /^대기열/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
  await refill(page);
});
