import "server-only";
import OpenAI, { APIError } from "openai";
import { buildSystemPrompt, type ChatContext } from "@/lib/prompt";

// 답변 스트림. TSD §9. 제품 코드는 streamAnswer만 쓴다.

export type LlmMode = "mock" | "live";

export const LLM_MODEL = "gpt-6-luna";
export const MAX_COMPLETION_TOKENS = 800;
export const TRUNCATED_NOTICE = "답변이 길어 일부가 잘렸습니다.";

export function getLlmMode(): LlmMode {
  if (process.env.VERCEL_ENV === "production") return "live";
  return process.env.LLM_MODE === "mock" ? "mock" : "live";
}

export function isLlmConfigured(): boolean {
  return getLlmMode() === "mock" || Boolean(process.env.OPENAI_API_KEY?.trim());
}

export class LlmError extends Error {
  constructor(
    readonly kind: "rate_limited" | "failed",
    /** 상위 AI 서버가 돌려준 HTTP 상태 코드. 원인 확인용 로그에만 쓴다(본문·키는 담지 않는다). */
    readonly upstreamStatus?: number,
  ) {
    super(`llm_${kind}`);
  }
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  const status = error instanceof APIError ? error.status : undefined;
  return new LlmError(status === 429 ? "rate_limited" : "failed", status);
}

export interface AnswerRequest {
  question: string;
  context: ChatContext;
  signal?: AbortSignal;
}

/**
 * 답변 글자를 조금씩 내놓는다. 실패는 LlmError로 던진다.
 * 글자 없이 끝난 답(토큰을 추론에 다 써서 잘린 경우 포함)도 실패로 친다.
 */
export async function* streamAnswer(
  request: AnswerRequest,
): AsyncGenerator<string, void> {
  if (getLlmMode() === "mock") {
    yield* streamMockAnswer(request);
    return;
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 1,
      timeout: 20_000,
    });
    // 추론을 끈다. 기본 추론이 켜져 있으면 추론 토큰이 max_completion_tokens를 먼저 써서 글자 없이 끝날 수 있다.
    const stream = await client.chat.completions.create(
      {
        model: LLM_MODEL,
        stream: true,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: "none",
        messages: [
          { role: "system", content: buildSystemPrompt(request.context) },
          { role: "user", content: request.question },
        ],
      },
      { signal: request.signal },
    );

    let hasText = false;
    let truncated = false;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const text = choice?.delta?.content;
      if (text) {
        hasText = true;
        yield text;
      }
      if (choice?.finish_reason === "length") truncated = true;
    }
    // 28초 예산이나 브라우저가 끊은 신호로 반복이 오류 없이 끝나면 끊긴 답이 완성된 답처럼 끝나지 않게 한다.
    if (request.signal?.aborted) throw new LlmError("failed");
    if (!hasText) throw new LlmError("failed");
    if (truncated) yield `\n${TRUNCATED_NOTICE}`;
  } catch (error) {
    throw toLlmError(error);
  }
}

const MOCK_CHUNK_DELAY_MS = 40;

export function mockAnswerText({ brand, item }: ChatContext): string {
  const request = brand ? `${brand} ${item}` : item;
  return [
    "검색어:",
    `1. ${request}`,
    `2. ${request} 정품`,
    "",
    "확인할 조건:",
    `1. 상품명에 "${request}" 표기가 그대로 있는지`,
    "2. 판매자가 공식 판매처인지",
    "3. 상품 페이지의 가격과 재고 여부",
    "",
    "찾는 순서:",
    "1. 쇼핑몰 검색창에 검색어를 넣는다.",
    "2. 조건에 맞는 상품을 추린다.",
    "3. 상품 페이지에서 가격과 재고 여부를 확인해 이용자에게 읽어 준다.",
  ].join("\n");
}

/** 시험용 가짜 답변. 실제 스트림처럼 줄 단위로 나눠 조금씩 내놓는다. */
async function* streamMockAnswer({
  context,
  signal,
}: AnswerRequest): AsyncGenerator<string, void> {
  const lines = mockAnswerText(context).split(/(?<=\n)/);
  for (const line of lines) {
    if (signal?.aborted) throw new LlmError("failed");
    yield line;
    await new Promise((resolve) => setTimeout(resolve, MOCK_CHUNK_DELAY_MS));
  }
}
