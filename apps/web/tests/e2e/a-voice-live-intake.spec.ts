import { expect, test, type Page } from "@playwright/test";
import { BUTTONS } from "../../src/lib/liveCommands";
import { script } from "../../src/lib/liveScripts";
import { FASTEST_CONFIRMATION_RATE } from "../../src/lib/liveSpeaker";
import { expectState, heard, installFakeLive, POLL, sayLive, spokenOf, whenListening } from "./helpers/fakeLive";

test.beforeEach(async ({ request, page }) => {
  const config = await (await request.get("/api/live/config")).json();
  test.skip(config.productIntake !== true, "LIVE_PRODUCT_INTAKE=on에서 검사");
  await page.route("https://api.openai.com/**", () => { throw new Error("예상치 않은 외부 요청"); });
});

async function openFromRequest(page: Page) {
  await page.goto("/request");
  await page.getByRole("link", { name: "질문 시작하기" }).click();
  const start = page.getByRole("button", { name: BUTTONS.start, exact: true });
  await expect(start).toBeFocused();
  await start.click();
}

test("첫 안내 음성 끼어들기부터 헤드셋 조건, 예산, 시기와 접수까지", async ({ page }) => {
  await installFakeLive(page);
  await page.addInitScript(() => { window.__fakeLive.tts.hold = true; });
  await openFromRequest(page);
  await heard(page, script("productGuideVoice"));
  await expectState(page, "guiding");
  await sayLive(page, "제가 말하는 중에도 말씀하시면 들을게요");
  await expectState(page, "guiding"); // 읽고 있던 문장이 마이크에 들어온 경우
  await whenListening(page);
  await page.evaluate(() => window.__fakeLive.rec.interim("헤드"));
  await page.evaluate(() => window.__fakeLive.tts.finish());
  await expectState(page, "guiding"); // 안내 끝과 최종 전사 사이에도 입력을 유지한다.
  await sayLive(page, "헤드셋");
  await heard(page, /노이즈 캔슬링이 필요하세요/);

  await page.evaluate(() => {
    window.__fakeLive.tts.hold = false;
    window.__fakeLive.tts.finish();
  });
  const turns = [
    ["꼭 필요해요", /귀를 덮는 방식/],
    ["귀를 덮는 방식이 좋아요", /무선과 유선/],
    ["무선이 좋아요", /어디에 주로 쓰실 거예요/],
    ["재택 통화에 쓸 거예요", /예산은 어느 정도/],
    ["10만 원 이하", /언제까지 필요하세요/],
    ["일주일 안에", /이 내용으로 봉사자에게 보낼까요/],
  ] as const;
  for (const [answer, next] of turns) {
    await expectState(page, "listening");
    await sayLive(page, answer);
    await heard(page, next);
  }
  await expectState(page, "confirming");
  const confirmation = (await spokenOf(page)).at(-1);
  expect(confirmation).toContain("필요한 시기는 일주일 안에");
  expect(confirmation).toContain("예산은 10만 원 이하");
  expect(await page.evaluate(() => window.__fakeLive.tts.rates.at(-1))).toBe(FASTEST_CONFIRMATION_RATE);

  const posted = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/requests"));
  await sayLive(page, "네");
  const body = (await posted).postDataJSON();
  expect(body.details.qa).toContainEqual({ q: "필요한 시기", a: "일주일 안에" });
  await expectState(page, "done");
});

test("끝내기로 상품 요청 화면에 돌아온 뒤에도 첫 방문 안내를 듣는다", async ({ page }) => {
  await installFakeLive(page);
  await openFromRequest(page);
  await heard(page, script("productGuideVoice"));
  await expectState(page, "listening");
  await sayLive(page, "끝내기");
  await expect(page).toHaveURL(/\/request$/);
  await page.getByRole("link", { name: "질문 시작하기" }).click();
  await page.getByRole("button", { name: BUTTONS.start, exact: true }).click();
  await heard(page, script("productGuideVoice"));
});

async function startRealtime(page: Page) {
  await installFakeLive(page, { realtime: true });
  await page.route("**/api/live/config", (route) => route.fulfill({
    json: { enabled: true, realtime: true, productIntake: true },
  }));
  await page.route("**/api/live/call*", (route) => route.fulfill({
    json: { engine: "realtime", sdp: "v=0\r\n", callId: "call_intake", maxSessionSec: 0, warnBeforeSec: 0, maxTurns: null },
  }));
  await page.route("**/api/live/hangup", (route) => route.fulfill({ status: 204 }));
  const config = page.waitForResponse((response) => response.url().endsWith("/api/live/config"));
  await page.goto("/live");
  await config;
  await page.getByRole("button", { name: BUTTONS.start, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fakeLive.rtc.channels), POLL).toBe(1);
  await page.evaluate(() => window.__fakeLive.rtc.open());
  const emit = (event: object) => page.evaluate((event) => window.__fakeLive.rtc.emit(event), event);
  const lastRequest = () => page.evaluate(() => window.__fakeLive.rtc.sent.findLast(({ type }) => type === "response.create"));
  async function speakToRealtime(id: string, transcript: string) {
    await emit({ type: "input_audio_buffer.speech_started" });
    await emit({ type: "input_audio_buffer.committed", item_id: id });
    await emit({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript });
  }
  async function startSpeech() {
    await emit({ type: "response.created" });
    await emit({ type: "output_audio_buffer.started" });
  }
  async function endSpeech() {
    await emit({ type: "response.done", response: { status: "completed", output: [] } });
    await emit({ type: "output_audio_buffer.stopped" });
  }
  await expect.poll(lastRequest, POLL).toMatchObject({
    response: {
      tool_choice: "none", conversation: "none",
      input: [{ content: [{ text: script("productGuideVoice") }] }],
    },
  });
  await startSpeech();
  await endSpeech();
  await expectState(page, "listening");
  return { emit, lastRequest, speakToRealtime, startSpeech, endSpeech };
}

test("가짜 Realtime 재생 중 발화로 끊고 미완성 확인을 거절한다", async ({ page }) => {
  const { emit, speakToRealtime } = await startRealtime(page);
  const mic = () => page.evaluate(() => window.__fakeLive.media.tracks.at(-1)?.enabled);
  const types = () => page.evaluate(() => window.__fakeLive.rtc.sent.map(({ type }) => type));
  await expect.poll(mic, POLL).toBe(true);
  await speakToRealtime("product", "헤드셋");
  await expectState(page, "thinking");
  await emit({ type: "response.created" });
  await emit({ type: "output_audio_buffer.started" });
  await emit({ type: "response.output_audio_transcript.delta", delta: "노이즈 캔슬링이 필요하세요?" });
  await expectState(page, "speaking");
  await expect.poll(mic, POLL).toBe(true);
  await speakToRealtime("interrupt", "꼭 필요해요");
  await expectState(page, "thinking");
  await expect.poll(types, POLL).toContain("output_audio_buffer.clear");
  const sent = await types();
  expect(sent.indexOf("response.cancel")).toBeLessThan(sent.indexOf("output_audio_buffer.clear"));
  await emit({ type: "response.done", response: { status: "cancelled", output: [] } });
  await expectState(page, "thinking");

  await emit({ type: "response.created" });
  await emit({
    type: "response.done",
    response: { status: "completed", output: [{
      type: "function_call",
      name: "confirm_request",
      call_id: "too_soon",
      arguments: JSON.stringify({ product: "헤드셋", conditions: [{ label: "노이즈 캔슬링", answer: "꼭 필요해요" }] }),
    }] },
  });
  await expectState(page, "thinking");
  await expect.poll(() => page.evaluate(() => window.__fakeLive.rtc.sent.at(-1)), POLL).toMatchObject({
    type: "response.create", response: { tool_choice: "none" },
  });
  const question = "착용할 때는 귀를 덮는 방식과 귀에 꽂는 방식 중 어느 쪽이 편하세요?";
  await emit({ type: "response.created" });
  await emit({ type: "output_audio_buffer.started" });
  await emit({ type: "response.output_audio_transcript.done", transcript: question });
  await expectState(page, "speaking");
  await emit({ type: "response.done", response: { status: "completed", output: [] } });
  await emit({ type: "output_audio_buffer.stopped" });
  await expectState(page, "listening");
  expect(await spokenOf(page)).not.toEqual(expect.arrayContaining([expect.stringContaining("귀를 덮는")]));
});

test("Realtime 확인 음성을 다 들은 뒤에만 접수하고 말한 조건을 보낸다", async ({ page }) => {
  const { emit, lastRequest, speakToRealtime, startSpeech, endSpeech } = await startRealtime(page);
  await speakToRealtime("laptop", "맥 OS 노트북, 공부용, 화면은 클수록 좋아, 무게는 가벼웠으면 좋겠어, 150만 원, 한 달 안에 구매.");
  await expectState(page, "thinking");
  expect(await page.evaluate(() => window.__fakeLive.rtc.sent.some(
    (event) => event.type === "conversation.item.create" && JSON.stringify(event.item).includes("휴대성"),
  ))).toBe(true);
  await emit({ type: "response.created" });
  await emit({ type: "response.done", response: { status: "completed", output: [{
    type: "function_call", name: "confirm_request", call_id: "confirm_laptop",
    arguments: JSON.stringify({ product: "노트북" }),
  }] } });
  await expect.poll(lastRequest, POLL).toMatchObject({
    response: {
      tool_choice: "none", conversation: "none",
      input: [{ content: [{ text: expect.stringContaining("봉사자에게 보낼까요") }] }],
    },
  });
  await expectState(page, "speaking");
  await startSpeech();
  await expectState(page, "speaking");
  await endSpeech();
  await expectState(page, "confirming");
  expect(await spokenOf(page)).toEqual([]);
  const posted = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/requests"));
  await speakToRealtime("approve", "요청 보내기");
  const body = (await posted).postDataJSON();
  expect(body.details.qa).toEqual(expect.arrayContaining([
    { q: "주 용도", a: "공부용" },
    { q: "화면 크기", a: "화면은 클수록 좋아" },
    { q: "휴대성", a: "무게는 가벼웠으면 좋겠어" },
    { q: "필요한 시기", a: "한 달 안에" },
  ]));
  await expectState(page, "done");
});
