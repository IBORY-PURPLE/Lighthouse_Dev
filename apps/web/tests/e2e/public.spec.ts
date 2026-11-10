import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { checkAnswer } from "../../src/lib/answerRules";
import { MATCH_TIMEOUT_MS } from "../../src/lib/matchHandoff";
import { REQUEST_TIMEOUT_MS } from "../../src/lib/requestRecord";
import { installFakeSpeech, say } from "./helpers/fakeSpeech";
import { completeFlowA, DEFAULT_ANSWERS } from "./helpers/flowA";

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
    "groqKeyConfigured",
    "llmMode",
    "ok",
    "store",
  ]);
  expect(body.llmMode).toBe("live");
  expect(["supabase", "memory"]).toContain(body.store);
  console.log(`groqKeyConfigured=${body.groqKeyConfigured}`);
  // memory면 실패가 아니라 "흉내"다(실제 저장소에 연결되지 않음).
  console.log(`store=${body.store}${body.store === "memory" ? " (흉내)" : ""}`);
});

// 가짜 음성 입력 기준이다. 답변만 실제 Groq이고 실행마다 유료 호출이 1회 든다.
test("공개 주소 완주: 가짜 음성, 대기열 접수, 다시 조회, 이어 보기, 실제 Groq 답변", async ({
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
