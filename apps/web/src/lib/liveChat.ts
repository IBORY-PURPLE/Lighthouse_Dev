import "server-only";
import { liveAskName, liveProductIntake } from "@/lib/liveConfig";
import { mockProductIntake } from "@/lib/liveIntake";
import { liveChatInstructions, liveProductChatInstructions } from "@/lib/liveInstructions";
import { hasQuestion, isClearConsent, isPlausibleConsent, isScreenReaderEcho } from "@/lib/liveCommands";
import type { LiveChatStatus, LiveSlots, LiveTurn } from "@/lib/liveEngine";
import { cutText, decodeAiTurn, maskPhone, readSlots, REPLY_MAX } from "@/lib/liveText";
import { getLlmMode } from "@/lib/llm";
import { VOICE_MODEL_DEFAULT } from "@/lib/voiceChat";

// /live 글자 대화(fallback) 한 턴: 모델 글 읽기, 서버 관문, 시험용 가짜 대화, OpenAI 호출. 설계서 7.3절.
// callVoiceAI(voiceChat.ts)와 같은 틀이고 지시문과 응답 읽기만 다르다.

export const LIVE_CHAT_MAX_OUTPUT_TOKENS = 500;
export const LIVE_CHAT_TIMEOUT_MS = 25_000;

export interface LiveChatResult {
  reply: string;
  status: LiveChatStatus;
  slots: LiveSlots;
}

const STATUSES: readonly LiveChatStatus[] = ["asking", "confirming", "done", "ended"];
const ASK_PRODUCT = "어떤 제품을 찾으시는지 말씀해 주시겠어요?";
const ASK_PRODUCT_AGAIN = "어떤 제품을 찾으시는지 한 번만 더 말씀해 주시겠어요?";

/** 모델 글에서 응답을 꺼낸다. 모양이 틀리면 던진다. */
export function parseLiveText(raw: string): LiveChatResult {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI 응답 형식 오류");
  }
  const o = parsed as Record<string, unknown>;
  if (!STATUSES.includes(o.status as LiveChatStatus)) throw new Error("AI 응답 형식 오류");
  if (typeof o.reply !== "string") throw new Error("AI 응답 형식 오류");

  let status = o.status as LiveChatStatus;
  const slots = readSlots(o);
  let reply = cutText(maskPhone(o.reply), REPLY_MAX);
  if (status === "asking" && !reply.trim()) throw new Error("AI 응답 형식 오류");
  // 확인 단계인데 제품이 없으면 확인할 내용이 없다. 다시 묻는다.
  if (status === "confirming" && !slots.product) {
    status = "asking";
    if (!reply.trim()) reply = ASK_PRODUCT;
  }
  return { reply, status, slots };
}

/** 기록에서 마지막 assistant 칸을 읽는다(끝에 이번 이용자 말이 붙어 있어도 된다). */
function lastAiTurn(history: LiveTurn[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return decodeAiTurn(history[i].content);
  }
  return null;
}

/** 기록에서 가장 나중의 확인(confirming) 칸의 칸 내용을 찾는다. */
function lastConfirmSlots(history: LiveTurn[]): LiveSlots | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    const turn = decodeAiTurn(history[i].content);
    if (turn?.status === "confirming") return turn.slots;
  }
  return null;
}

/**
 * 서버 관문: done이 앞 차례의 확인과 이용자의 그럴듯한 동의 없이 나오면 낮춘다.
 * history는 이번 말을 붙이기 전의 기록이다.
 */
export function gateLiveResult(
  result: LiveChatResult,
  input: string,
  history: LiveTurn[],
): { result: LiveChatResult; downgraded: boolean } {
  if (result.status !== "done") return { result, downgraded: false };

  const confirmedBefore = lastAiTurn(history)?.status === "confirming";
  const consented =
    !hasQuestion(input) && !isScreenReaderEcho(input) && (isClearConsent(input) || isPlausibleConsent(input));
  if (confirmedBefore && consented) return { result, downgraded: false };

  const slots = result.slots.product ? result.slots : (lastConfirmSlots(history) ?? result.slots);
  if (slots.product) return { result: { reply: "", status: "confirming", slots }, downgraded: true };
  return { result: { reply: ASK_PRODUCT_AGAIN, status: "asking", slots }, downgraded: true };
}

const BUDGET_PHRASE = /[\d,.]+\s*만?\s*원(\s*(이하|이내|미만|정도))?/;

function mockJson(reply: string, status: LiveChatStatus, s: { product: string; info: string; options: string }): string {
  const budget = BUDGET_PHRASE.exec(s.options)?.[0] ?? "";
  return JSON.stringify({ reply, status, product: s.product, info: s.info, options: s.options, budget });
}

/** 시험용 가짜 대화(LLM_MODE=mock). history는 이번 말을 붙인 뒤의 기록이다. 모델이 내는 것과 같은 JSON 글을 준다. */
export function mockLiveText(history: LiveTurn[]): string {
  const said = history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const [product = "", info = "", options = ""] = said;
  if (said.length === 0) return mockJson(ASK_PRODUCT, "asking", { product: "", info: "", options: "" });
  if (said.length === 1) {
    return mockJson("어떤 점이 궁금하세요? 혜택이나 후기처럼 알고 싶은 정보를 말씀해 주세요.", "asking", {
      product,
      info: "",
      options: "",
    });
  }
  if (said.length === 2) {
    return mockJson("원하는 옵션이나 예산이 있으세요?", "asking", { product, info, options: "" });
  }
  if (said.length === 3) return mockJson("", "confirming", { product, info, options });
  const last = said[said.length - 1];
  if (!hasQuestion(last) && (isClearConsent(last) || isPlausibleConsent(last))) {
    return mockJson("보내 드릴게요.", "done", { product, info, options });
  }
  return mockJson("", "confirming", { product, info, options: last });
}

/** OpenAI Responses API 호출. mock이면 가짜 대화를 쓰고 fetch를 부르지 않는다. */
export async function callLiveAI(history: LiveTurn[]): Promise<LiveChatResult> {
  const productIntake = liveProductIntake();
  if (getLlmMode() === "mock") return parseLiveText(productIntake ? mockProductIntake(history) : mockLiveText(history));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_CHAT_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || VOICE_MODEL_DEFAULT,
        instructions: productIntake ? liveProductChatInstructions() : liveChatInstructions(liveAskName()),
        input: [{ role: "developer", content: "반드시 JSON 객체로 답변하세요." }, ...history],
        max_output_tokens: LIVE_CHAT_MAX_OUTPUT_TOKENS,
        text: { format: { type: "json_object" } },
        store: false,
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      error?: { message?: string };
      output?: { content?: { type: string; text: string }[] }[];
    };
    if (!response.ok) throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
    const raw = (data.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("");
    return parseLiveText(raw);
  } finally {
    clearTimeout(timer);
  }
}
