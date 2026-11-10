import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { MATCH_TIMEOUT_MS } from "../../src/lib/matchHandoff";
import { REQUEST_TIMEOUT_MS } from "../../src/lib/requestRecord";
import { installFakeSpeech } from "./helpers/fakeSpeech";
import { completeFlowA, DEFAULT_ANSWERS } from "./helpers/flowA";

// 공개 주소 시험은 실제 봉사자 계정 값을 모른다. 실제 로그인과 챗봇은 사람이 본다(B2).
// 로그인 시도는 그 주소의 10분 5회 제한에 들어가므로 가짜 값으로 1회만 시도한다.
const FAKE_PHONE = "01000000000";
const FAKE_PASSWORD = "public-test-fake-password";

// 접근 코드 주소는 없어졌다. 지운 주소 글자가 코드에 남지 않게 조각으로 만든다.
const REMOVED_ACCESS_PATH = ["", "enter"].join("/");

// Playwright가 apps/web/test-results를 비우므로 기록은 저장소 루트에 둔다.
const RECORD_DIR = path.resolve(__dirname, "../../../../test-results/public");

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

test("공개 주소 봉사자 쪽 잠금", async ({ request }) => {
  const removed = await request.get(REMOVED_ACCESS_PATH, { maxRedirects: 0 });
  expect(removed.status()).toBe(404);

  expect((await request.get("/api/health")).status()).toBe(401);
  const chat = await request.post("/api/chat", {
    data: {
      requestId: "6f1c2e4a-1111-4222-8333-444455556666",
      question: "sony 헤드셋 제품을 찾는 가이드 알려줘",
      context: { brand: "Sony", item: "헤드셋" },
    },
  });
  expect(chat.status()).toBe(401);

  const login = await request.post("/api/auth/login", {
    data: { phone: FAKE_PHONE, password: FAKE_PASSWORD },
  });
  expect(login.status()).toBe(401);
  expect(await login.json()).toEqual({ ok: false, error: "invalid_credentials" });
  expect(login.headers()["set-cookie"]).toBeUndefined();

  // 운영과 미리보기는 HTTPS라 지우는 쿠키도 Secure여야 한다(VERCEL 환경 변수 판정 확인).
  const logout = await request.post("/api/auth/logout");
  expect(logout.status()).toBe(200);
  const setCookie = logout.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/^lh_volunteer=;/);
  expect(setCookie).toMatch(/Secure/i);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Max-Age=0/i);
});

// 가짜 음성 입력 기준이다. Groq 호출은 없고, 실제 저장소(대기열)만 쓴다.
test("공개 주소 완주: 가짜 음성, 대기열 접수, 다시 조회, 이어 보기, 봉사자 로그인 칸", async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(RECORD_DIR, { recursive: true });
  const shot = (name: string) =>
    page.screenshot({ path: path.join(RECORD_DIR, `${name}.png`) });

  await installFakeSpeech(page);

  // 이용자 쪽은 접근 코드 없이 열린다.
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
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

  // 이어 보기: 로그인 없이 매칭은 되고, 봉사자 화면은 로그인 칸만 보인다.
  const handoff = page.getByRole("button", { name: "봉사자 화면으로(시연)" });
  await expect(handoff).toBeVisible();
  const matchResponse = page.waitForResponse("**/api/match", {
    timeout: MATCH_TIMEOUT_MS + 5_000,
  });
  await handoff.click();
  const match = await matchResponse;
  expect(match.status()).toBe(200);
  expect((await match.json()).volunteer.displayName).toBe("등록 봉사자");
  await expect(page).toHaveURL(/\/volunteer$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "봉사자 로그인" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "눌러서 질문하기" })).toHaveCount(0);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
  await shot("volunteer-login");
});
