import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { checkAnswer } from "../../src/lib/answerRules";
import { MATCH_TIMEOUT_MS } from "../../src/lib/matchHandoff";
import { installFakeSpeech, say } from "./helpers/fakeSpeech";
import { makeSyntheticDetailImage, openVolunteer } from "./helpers/volunteer";

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
  expect(Object.keys(body).sort()).toEqual([
    "extractEngine",
    "groqKeyConfigured",
    "llmMode",
    "ok",
  ]);
  expect(body.llmMode).toBe("live");
  console.log(`groqKeyConfigured=${body.groqKeyConfigured}`);
  console.log(`extractEngine=${body.extractEngine}`);
});

// 가짜 음성 입력 기준이다. 답변만 실제 Groq이고 실행마다 유료 호출이 1회 든다.
test("공개 주소 완주: 가짜 음성, 매칭, 이어 보기, 실제 Groq 답변", async ({
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

  await page.getByRole("button", { name: "눌러서 말하기" }).click();
  await say(page, "sony껄로 헤드셋 사고싶어");
  await page.getByRole("button", { name: "이대로 요청" }).click();
  const handoff = page.getByRole("button", { name: "봉사자 화면으로(시연)" });
  await expect(handoff).toBeFocused({ timeout: MATCH_TIMEOUT_MS + 5_000 });
  await shot("match-done");

  await handoff.click();
  await expect(page).toHaveURL(/\/volunteer$/);
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
// 봉사자 화면은 이용자 화면을 거치지 않고 연다. 초안 값과 근거 원문은 기록하지 않는다(항목 이름과 check만).
test("④ 올리기·요약 완주", async ({ page }) => {
  test.setTimeout(300_000);
  const samplePath = path.resolve(
    process.cwd(),
    "../..",
    "test-results/vision-samples/public/sample.jpg",
  );
  const hasSample = existsSync(samplePath);
  await openVolunteer(page, { code: readAccessCode() });

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

  const startedAt = Date.now();
  if (hasSample) {
    await page.getByLabel("상세 이미지 올리기").setInputFiles(samplePath);
  } else {
    const buffer = await makeSyntheticDetailImage(page);
    await page.getByLabel("상세 이미지 올리기").setInputFiles({
      name: "synthetic-detail.png",
      mimeType: "image/png",
      buffer,
    });
  }
  console.log(`이미지: ${hasSample ? "실제 캡처" : "합성 이미지 기준(실제 캡처 없음)"}`);

  await expect(page.locator(".info-summary__status")).toHaveText(/^요약 초안이 도착했습니다\./, {
    timeout: 240_000,
  });
  const totalMs = Date.now() - startedAt;
  await expect(page.getByRole("heading", { level: 3, name: "요약 초안" })).toBeFocused();

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
});
