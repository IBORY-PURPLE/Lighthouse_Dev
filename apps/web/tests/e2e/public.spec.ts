import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { checkAnswer } from "../../src/lib/answerRules";
import { MATCH_TIMEOUT_MS } from "../../src/lib/matchHandoff";
import { REQUEST_TIMEOUT_MS } from "../../src/lib/requestRecord";
import { installFakeSpeech, say } from "./helpers/fakeSpeech";
import { completeFlowA, DEFAULT_ANSWERS } from "./helpers/flowA";
import {
  claimDemo,
  FIRST_DEMO_QUOTE,
  makeSyntheticDetailImage,
  refill,
} from "./helpers/volunteerFlow";

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

// ④ 실제 엔진으로 1회 완주한다(실행마다 엔진 호출이 조각 수만큼 든다. 돌리기 전에 누계를 본다).
// 입장 → 시연용 요청 다시 채우기 → 헤드셋 맡기 → 에이전트 창에서 캡처 1장 올리기 → 후보 1에 초안 저장
// → 요약 확인(후보 1 확인) → 보내기 → 완료 화면 → 목록으로. 끝에서 다시 채워 정리한다. 초안 값과 근거 원문은 기록하지 않는다(항목 이름과 check만).
test("④ 입장·맡기·캡처 올리기·초안·보내기 완주", async ({ page }) => {
  test.setTimeout(300_000);
  const samplePath = path.resolve(
    process.cwd(),
    "../..",
    "test-results/vision-samples/public/sample.jpg",
  );
  const hasSample = existsSync(samplePath);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });

  // 입장(코드와 별명). 이 기기가 봉사자가 된다.
  await page.goto("/volunteer");
  await page.getByLabel("입장 코드").fill(readAccessCode());
  await page.getByLabel("별명").fill("시험");
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
  await refill(page);
  await claimDemo(page, FIRST_DEMO_QUOTE);

  const pieces: Array<{ pieceIndex: number; status: number; engineMs: number | null; roundTripMs: number }> = [];
  let engine: string | null = null;
  let llmMs: number | null = null;
  let summarizeStatus: number | null = null;
  let summarizeCalls = 0;
  let draftBody: { fields: Array<{ key: string; label: string; check: string }> } | null = null;
  page.on("response", async (response) => {
    const url = response.url();
    const timing = response.headers()["server-timing"] ?? "";
    if (url.includes("/api/volunteer/extract-text")) {
      const request = response.request();
      const body = (await response.json().catch(() => null)) as { pieceIndex?: number; engine?: string } | null;
      if (body?.engine) engine = body.engine;
      const engineMatch = /engine;dur=(\d+)/.exec(timing);
      pieces.push({
        pieceIndex: body?.pieceIndex ?? request.postDataJSON()?.pieceIndex,
        status: response.status(),
        engineMs: engineMatch ? Number(engineMatch[1]) : null,
        // 요청 시작부터 응답 끝까지(Playwright 요청 시간 기록).
        roundTripMs: Math.round(request.timing().responseEnd),
      });
    }
    if (url.includes("/api/volunteer/summarize")) {
      summarizeCalls += 1;
      summarizeStatus = response.status();
      const llmMatch = /llm;dur=(\d+)/.exec(timing);
      llmMs = llmMatch ? Number(llmMatch[1]) : null;
      draftBody = await response.json().catch(() => null);
    }
  });

  await page.getByRole("button", { name: "쇼핑 에이전트 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "쇼핑 에이전트" });
  await expect(dialog.getByRole("button", { name: "캡처 올리기 · 후보 1에 저장" })).toBeVisible();

  const startedAt = Date.now();
  if (hasSample) {
    await page.getByTestId("capture-input").setInputFiles(samplePath);
  } else {
    const buffer = await makeSyntheticDetailImage(page);
    await page.getByTestId("capture-input").setInputFiles({
      name: "synthetic-detail.png",
      mimeType: "image/png",
      buffer,
    });
  }
  console.log(`이미지: ${hasSample ? "실제 캡처" : "합성 이미지 기준(실제 캡처 없음)"}`);

  await expect(dialog.getByRole("status")).toHaveText(
    /^캡처 1장을 후보 1에 저장했습니다\. 요약 초안이 도착했습니다\./,
    { timeout: 240_000 },
  );
  const totalMs = Date.now() - startedAt;
  await expect(page.locator(".vol-cand").first().locator(".vol-chip-btn")).toHaveText(
    "캡처 읽음 · 확인 전",
  );

  const engineMs = pieces.map((p) => p.engineMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = engineMs.length ? engineMs[Math.floor(engineMs.length / 2)] : null;
  console.log(`엔진: ${engine}`);
  console.log(`조각 수: ${pieces.length}, 상태: ${pieces.map((p) => `${p.pieceIndex}:${p.status}`).join(" ")}`);
  console.log(`조각별 engine ms: ${pieces.map((p) => p.engineMs).join("/")}, 중앙값 ${median}`);
  console.log(`조각별 왕복 ms: ${pieces.map((p) => p.roundTripMs).join("/")}`);
  console.log(`summarize: 호출 ${summarizeCalls}회, 상태 ${summarizeStatus}, llm ms: ${llmMs}`);
  console.log(`전체 ms(올리기부터 초안까지): ${totalMs}`);

  expect(summarizeStatus).toBe(200);
  expect(summarizeCalls).toBe(1);
  const fields = (draftBody as { fields: Array<{ key: string; label: string; check: string }> } | null)?.fields ?? [];
  console.log(`항목 수: ${fields.length}, 확인 안 됨: ${fields.filter((f) => f.check === "unverified").length}`);
  console.log(`항목(key/label/check): ${fields.map((f) => `${f.key}/${f.label}/${f.check}`).join(", ")}`);
  const priceLike = fields.filter((f) => /price|가격|재고|할인|stock|discount/i.test(`${f.key} ${f.label}`));
  console.log(`가격·재고·할인 key·label: ${priceLike.length}건`);
  expect(priceLike).toEqual([]);
  expect(fields.length).toBeGreaterThan(0);
  expect(pieces.length).toBeGreaterThan(0);

  // 보내기까지: 요약 확인 → 후보 1 확인 → 보내기 → 완료 화면 → 목록으로(보낸 요청이 보인다).
  await dialog.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("link", { name: "요약 확인하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "요약 확인" })).toBeVisible();
  await page.getByLabel("구매 가이드", { exact: true }).fill("쇼핑몰에서 ‘구매하기’를 누릅니다.");
  await page.getByRole("button", { name: "후보 1 확인", exact: true }).click();
  await page.getByRole("button", { name: "확인한 1개 보내기", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "완료된 요청" })).toBeVisible();
  await expect(page.getByText("전달 완료", { exact: true })).toBeVisible();
  await expect(page.getByText("이용자가 들음 아직", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "목록으로", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이 기기에서 보낸 요청" })).toBeVisible();
  await expect(page.locator(".vol-card").filter({ hasText: "소니 무선 헤드셋" })).toContainText("전달 완료");

  // 정리: 시연용 요청을 다시 채운다(이 기기에서 보낸 요청도 시연 기본값으로 돌아간다).
  await page.getByRole("button", { name: /^대기열/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "대기열" })).toBeVisible();
  await refill(page);
});
