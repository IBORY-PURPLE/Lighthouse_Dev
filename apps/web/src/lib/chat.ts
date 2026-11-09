// /api/chat 요청 형식과 브라우저 호출. TSD §8. 봉사자 화면에서만 쓴다.

import type { ChatContext } from "@/lib/prompt";
import { STATUS } from "@/lib/speech";

export const MAX_QUESTION_LENGTH = 300;
/** 서버는 28초 안에 끝낸다. 서버가 끊기지 않고 멈춰도 "답변을 만들고 있습니다"에 머물지 않게 한다. */
export const CHAT_TIMEOUT_MS = 35_000;

export interface ChatRequest {
  requestId: string;
  question: string;
  context: ChatContext;
}

export type ChatOutcome =
  | { kind: "answered" }
  /** 질문을 바꿔 다시 내야 한다. */
  | { kind: "rejected"; status: string }
  /** 같은 질문을 다시 보낼 수 있다. */
  | { kind: "failed"; status: string };

const CONDITION_KINDS: readonly unknown[] = ["new", "used", "any"];

/** 선택 필드(TSD §8.6). 없으면 v1과 같다. 있으면 정해진 값만 받는다. */
function hasValidOptionalContext(context: Partial<ChatContext>): boolean {
  return (
    (context.hasBudget === undefined ||
      typeof context.hasBudget === "boolean") &&
    (context.condition === undefined ||
      context.condition === null ||
      CONDITION_KINDS.includes(context.condition))
  );
}

export function isChatRequest(value: unknown): value is ChatRequest {
  const body = value as Partial<ChatRequest> | null;
  return (
    typeof body?.requestId === "string" &&
    typeof body.question === "string" &&
    (body.context?.brand === null || typeof body.context?.brand === "string") &&
    typeof body.context?.item === "string" &&
    body.context.item.trim().length > 0 &&
    hasValidOptionalContext(body.context)
  );
}

/**
 * 지시문에 넘길 맥락만 골라 낸다. 예산 숫자 같은 다른 필드가 와도 버린다(TSD §8.6).
 * 선택 필드가 없으면 키도 만들지 않아 v1 요청과 같은 모양이 된다.
 */
export function pickChatContext(context: ChatContext): ChatContext {
  const picked: ChatContext = { brand: context.brand, item: context.item };
  if (context.hasBudget !== undefined) picked.hasBudget = context.hasBudget;
  if (context.condition !== undefined) picked.condition = context.condition;
  return picked;
}

function outcomeForStatus(status: number): ChatOutcome {
  switch (status) {
    case 400:
      return { kind: "rejected", status: STATUS.questionTooLong };
    case 401:
      return { kind: "failed", status: STATUS.noAccess };
    case 429:
      return { kind: "failed", status: STATUS.tooMany };
    case 503:
      return { kind: "failed", status: STATUS.chatNotConfigured };
    default:
      return { kind: "failed", status: STATUS.chatFailed };
  }
}

/**
 * 답변을 받는 대로 onText로 넘긴다. 도중에 끊기면 failed이고, 이미 넘긴 글자는
 * 부르는 쪽이 버린다. 잘린 답을 끝난 답처럼 두지 않기 위해서다.
 */
export async function requestAnswer(
  request: ChatRequest,
  onText: (text: string) => void,
  abort: AbortController = new AbortController(),
): Promise<ChatOutcome> {
  const timer = setTimeout(() => abort.abort(), CHAT_TIMEOUT_MS);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: abort.signal,
    });
    if (!response.ok) return outcomeForStatus(response.status);
    if (!response.body) return { kind: "failed", status: STATUS.chatFailed };

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let received = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        received = true;
        onText(text);
      }
    }
    return received
      ? { kind: "answered" }
      : { kind: "failed", status: STATUS.chatFailed };
  } catch {
    return { kind: "failed", status: STATUS.chatFailed };
  } finally {
    clearTimeout(timer);
  }
}
