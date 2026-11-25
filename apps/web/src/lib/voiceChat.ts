import "server-only";
import { getLlmMode } from "@/lib/llm";
import { parseRequest } from "@/lib/parseRequest";
import { cleanRequestDetails } from "@/lib/requestDetails";
import type { RequestDetailsView, RequestQa } from "@/lib/volunteerView";
import { VOICE_INSTRUCTIONS } from "@/lib/voiceInstructions";

// 이용자 음성 대화 한 턴(POST /api/voice/chat). apps/user-voice-ui/server.js의 /api/chat 계약을 옮겼다.
// 요청·응답 JSON, 지시문, asking/confirming/done, 모델 기본값, max_output_tokens, 25초 마감은 원본 그대로다.
// 바뀐 것은 둘뿐이다: (1) 서버리스는 메모리 세션이 인스턴스마다 사라지므로 화면이 대화 기록(history)을 매번 보낸다.
// (2) 확정(done)이면 접수(POST /api/requests)가 받는 모양의 request를 덧붙인다.

export const VOICE_MODEL_DEFAULT = "gpt-4.1-mini";
export const VOICE_MAX_OUTPUT_TOKENS = 450;
export const VOICE_TIMEOUT_MS = 25_000;
export const VOICE_START_MESSAGE = "대화를 시작해 주세요. 첫 질문을 해주세요.";
/** 원본의 `s.history.length >= 36`과 같다. */
export const MAX_HISTORY = 36;
export const MAX_MESSAGE_LENGTH = 1000;
/** 기록 한 칸(AI 답은 JSON 글이라 이용자 문장보다 길다). */
export const MAX_HISTORY_CONTENT = 2000;

export type VoiceStatus = "asking" | "confirming" | "done";

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

export interface VoiceResult {
  reply: string;
  status: VoiceStatus;
  summary: string;
  product: string;
}

/** 접수(POST /api/requests)가 받는 본문(clientRequestId 제외). details는 이용자가 확인한 요약과 질문·답이다. */
export interface QueueRequest {
  product: string;
  budget: string;
  condition: string;
  details?: RequestDetailsView;
}

export type VoiceBody =
  | { ok: true; reset: boolean; input: string; history: VoiceTurn[] }
  | { ok: false; status: number; error: string };

const SAFE_ID = /^[a-zA-Z0-9-]{8,100}$/;

function invalid(error: string): VoiceBody {
  return { ok: false, status: 400, error };
}

/** 원본의 검사 순서와 메시지를 따른다. history만 새로 검사한다. */
export function readVoiceBody(value: unknown): VoiceBody {
  const body = value as Record<string, unknown> | null;
  if (typeof body?.sessionId !== "string" || !SAFE_ID.test(body.sessionId)) {
    return invalid("세션 식별자 오류");
  }
  const { message, reset } = body;
  if (typeof message !== "string" || message.length > MAX_MESSAGE_LENGTH) {
    return invalid("메시지 길이 오류");
  }
  if (!reset && !message.trim()) return invalid("답변을 입력해 주세요");

  let history: VoiceTurn[] = [];
  if (!reset) {
    const raw = body.history;
    if (!Array.isArray(raw)) return invalid("대화 기록 오류");
    if (raw.length >= MAX_HISTORY) {
      return invalid("대화가 너무 길어졌습니다. 새 요청을 시작해 주세요.");
    }
    for (const item of raw) {
      const turn = item as Partial<VoiceTurn> | null;
      if (
        (turn?.role !== "user" && turn?.role !== "assistant") ||
        typeof turn.content !== "string" ||
        turn.content.length > MAX_HISTORY_CONTENT
      ) {
        return invalid("대화 기록 오류");
      }
      history.push({ role: turn.role, content: turn.content });
    }
  } else {
    history = [];
  }
  return {
    ok: true,
    reset: Boolean(reset),
    input: reset ? VOICE_START_MESSAGE : message.trim(),
    history,
  };
}

/** 모델 글에서 응답을 꺼낸다. 원본과 같이 JSON 그대로 읽고 reply·status가 틀리면 형식 오류다. */
export function parseVoiceText(raw: string): VoiceResult {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (
    typeof parsed.reply !== "string" ||
    !parsed.reply ||
    (parsed.status !== "asking" &&
      parsed.status !== "confirming" &&
      parsed.status !== "done")
  ) {
    throw new Error("AI 응답 형식 오류");
  }
  return {
    reply: parsed.reply,
    status: parsed.status,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    product: typeof parsed.product === "string" ? parsed.product : "",
  };
}

/** OpenAI Responses API 호출. 원본 callAI와 같은 값이다. */
export async function callVoiceAI(history: VoiceTurn[]): Promise<VoiceResult> {
  if (getLlmMode() === "mock") return parseVoiceText(mockVoiceText(history));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || VOICE_MODEL_DEFAULT,
        instructions: VOICE_INSTRUCTIONS,
        input: [
          { role: "developer", content: "반드시 JSON 객체로 답변하세요." },
          ...history,
        ],
        max_output_tokens: VOICE_MAX_OUTPUT_TOKENS,
        text: { format: { type: "json_object" } },
        store: false,
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      error?: { message?: string };
      output?: { content?: { type: string; text: string }[] }[];
    };
    if (!response.ok) {
      throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
    }
    const raw = (data.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("");
    return parseVoiceText(raw);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 접수 변환 ----------

const BUDGET_PHRASE =
  /(?:\d[\d,.]*|[일이삼사오육칠팔구십백천]+)\s*만?\s*원(?![하래인본단형리산])(?:\s*(?:이하|이내|안쪽|미만|정도|쯤))?/;
const UNDECIDED = "정하지 않음";

/**
 * 확정한 요청(product, summary)을 접수 본문으로 바꾼다. 품목 사전에 있는 글(헤드셋)이 있으면 그 글을 쓰고,
 * 없으면 product(비었으면 summary)를 그대로 쓴다. 사전에 없는 물건도 봉사자 대기열에 올린다(2026-11-18 이용자 결정 A6).
 * product와 summary가 모두 비었을 때만 null이다(이 화면의 기기 안 목록에만 남는다).
 * 예산·조건은 요약 글에서 찾고 없으면 "정하지 않음"이다(조건은 서버가 모르는 값으로 둔다).
 */
export function toQueueRequest(product: string, summary: string): QueueRequest | null {
  const named = [product, summary].map((text) => text.trim());
  const chosen = named.find((text) => text && parseRequest(text).item) ?? named.find((text) => text);
  if (!chosen) return null;
  const text = [product, summary].join(" ");
  const condition = /중고/.test(text)
    ? "중고"
    : /새\s?(?:제품|상품)|신품/.test(text)
      ? "새 제품"
      : UNDECIDED;
  return {
    product: chosen.slice(0, 200),
    budget: (BUDGET_PHRASE.exec(summary || product)?.[0] ?? UNDECIDED).trim(),
    condition,
  };
}

// ---------- 봉사자 브리핑 ----------

/**
 * 확정한 대화(turns: 이용자 마지막 동의까지 포함)에서 질문·답 짝을 뽑는다. 이용자 화면과 지시문은 바꾸지 않고 서버가 history에서 읽는다.
 * - 짝 = AI가 묻거나 확인한 칸(status asking·confirming의 reply)과 바로 다음 이용자 말. 시작 문장(VOICE_START_MESSAGE)은 짝이 아니다.
 * - 마지막 짝(이용자의 최종 동의)은 뺀다. 확인 중에 고친 말은 남긴다.
 * - 깨진 JSON 칸은 건너뛴다. 길이·개수·전화번호 정리는 cleanRequestDetails가 한다.
 */
export function voiceDetails(turns: VoiceTurn[], summary: string): RequestDetailsView | null {
  const qa: RequestQa[] = [];
  const last = turns.length - 1;
  for (let index = 0; index < last; index += 1) {
    const asked = turns[index];
    const answer = turns[index + 1];
    if (asked.role !== "assistant" || answer.role !== "user") continue;
    if (index + 1 === last || answer.content === VOICE_START_MESSAGE) continue;
    try {
      const parsed = JSON.parse(asked.content) as { reply?: unknown; status?: unknown };
      if (
        typeof parsed.reply === "string" &&
        (parsed.status === "asking" || parsed.status === "confirming")
      ) {
        qa.push({ q: parsed.reply, a: answer.content });
      }
    } catch {
      // 깨진 칸은 건너뛴다.
    }
  }
  return cleanRequestDetails({ summary, qa });
}

// ---------- 시험용 가짜 대화(LLM_MODE=mock) ----------

const CONSENT = /네|예|응|좋아|맞아|등록/;

/** 이용자 문장 수로 단계를 정한다: 상품 → 예산 → 확인 → 동의. 모델이 내는 것과 같은 JSON 글이다. */
export function mockVoiceText(history: VoiceTurn[]): string {
  const said = history
    .filter((turn) => turn.role === "user" && turn.content !== VOICE_START_MESSAGE)
    .map((turn) => turn.content);
  const [product = "", budget = ""] = said;
  const result = (reply: string, status: VoiceStatus, summary = "") =>
    JSON.stringify({ reply, status, summary, product });

  if (said.length === 0) return result("어떤 상품을 찾으세요?", "asking");
  if (said.length === 1) return result("예산은 얼마인가요?", "asking");
  const line = `${product}, 예산 ${budget}`;
  const confirm = (lead: string) =>
    result(`${lead}${line}. 이 내용으로 구매 요청을 등록할까요?`, "confirming");
  if (said.length === 2) return confirm("");
  if (CONSENT.test(said[said.length - 1])) {
    return result("구매 요청을 등록했어요.", "done", line);
  }
  return confirm("고쳐서 다시 확인합니다. ");
}
