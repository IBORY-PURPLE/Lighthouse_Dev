// 이용자 AI 대화 한 턴: 요청·응답 형식, 상한, 브라우저 호출. POST /api/requests/converse, TSD §8.9.
// 서버는 대화를 저장하지 않는다. 브라우저가 대화 기록 전체를 보낸다(무상태).

import type { RequestAnswers } from "@/lib/requestFlow";

/** AI 대화 상태 영역 문구. 실패해도 기본 질문으로 갈 수 있다고 알린다. */
export const AI_STATUS = {
  aiThinking: "AI가 답을 준비하고 있습니다.",
  aiFailed: "AI와 연결하지 못했습니다. 다시 시도하거나 기본 질문으로 하세요.",
  aiTooLong: "대화가 너무 길어졌습니다. 기본 질문으로 하세요.",
  aiNotConfigured: "AI 대화 설정이 끝나지 않았습니다. 기본 질문으로 하세요.",
  aiTooMany: "요청이 많습니다. 1분 뒤 다시 시도하거나 기본 질문으로 하세요.",
  aiEmptyAnswer: "입력창에 답변을 입력하세요.",
} as const;

export type ConverseStatus = "asking" | "confirming" | "done";

export const CONVERSE_STATUSES: readonly ConverseStatus[] = [
  "asking",
  "confirming",
  "done",
];

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ConverseResult {
  reply: string;
  status: ConverseStatus;
  /** status가 done일 때만. 접수(/api/requests)가 받는 값과 같은 모양이다. */
  request?: RequestAnswers;
}

/** 대화 기록의 상한. 넘으면 400. 공개 주소의 유료 호출을 막는 수단이다. */
export const MAX_TURNS = 30;
/** 이용자 한 턴. 기본 질문의 답 상한(requestFlow MAX_ANSWER_LENGTH)과 같다. */
export const MAX_USER_LENGTH = 200;
/** AI 한 턴(브라우저가 되돌려 보내는 값). */
export const MAX_REPLY_LENGTH = 400;
export const MAX_TOTAL_LENGTH = 6000;
/** 서버는 28초 안에 끝낸다. 서버가 끊기지 않고 멈춰도 "준비하고 있습니다"에 머물지 않게 한다. */
export const CONVERSE_TIMEOUT_MS = 32_000;

export type TurnsCheck =
  | { ok: true; turns: ChatTurn[] }
  | { ok: false; error: "invalid_request" | "too_long" };

/**
 * 대화 기록 검사. 비어 있거나(첫 턴), AI 문장으로 시작해 AI·이용자가 번갈아 나오고 이용자 문장으로 끝나야 한다.
 * 이용자 문장은 첫 질문 뒤에만 있으므로 길이는 항상 짝수다.
 */
export function readTurns(value: unknown): TurnsCheck {
  if (!Array.isArray(value)) return { ok: false, error: "invalid_request" };
  if (value.length > MAX_TURNS) return { ok: false, error: "too_long" };
  if (value.length % 2 !== 0) return { ok: false, error: "invalid_request" };

  const turns: ChatTurn[] = [];
  let total = 0;
  for (const [index, item] of value.entries()) {
    const turn = item as Partial<ChatTurn> | null;
    const role = index % 2 === 0 ? "assistant" : "user";
    if (turn?.role !== role || typeof turn.content !== "string") {
      return { ok: false, error: "invalid_request" };
    }
    const content = turn.content.trim();
    if (!content) return { ok: false, error: "invalid_request" };
    const limit = role === "user" ? MAX_USER_LENGTH : MAX_REPLY_LENGTH;
    total += content.length;
    if (content.length > limit || total > MAX_TOTAL_LENGTH) {
      return { ok: false, error: "too_long" };
    }
    turns.push({ role, content });
  }
  return { ok: true, turns };
}

export type ConverseOutcome =
  | { kind: "ok"; result: ConverseResult }
  /** 같은 내용을 다시 보내도 소용없다(대화가 너무 길다). 기본 질문으로 가야 한다. */
  | { kind: "rejected"; status: string }
  /** 같은 대화를 다시 보낼 수 있다. */
  | { kind: "failed"; status: string };

function outcomeForStatus(status: number): ConverseOutcome {
  switch (status) {
    case 400:
      return { kind: "rejected", status: AI_STATUS.aiTooLong };
    case 429:
      return { kind: "failed", status: AI_STATUS.aiTooMany };
    case 503:
      return { kind: "rejected", status: AI_STATUS.aiNotConfigured };
    default:
      return { kind: "failed", status: AI_STATUS.aiFailed };
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 서버 응답 본문이 약속한 모양인지 본다. 아니면 null. */
export function readConverseResult(body: unknown): ConverseResult | null {
  const value = body as Record<string, unknown> | null;
  if (!isText(value?.reply)) return null;
  const status = value.status;
  if (status !== "asking" && status !== "confirming" && status !== "done") return null;
  if (status !== "done") return { reply: value.reply, status };
  const request = value.request as Record<string, unknown> | null | undefined;
  if (!isText(request?.product) || !isText(request.budget) || !isText(request.condition)) {
    return null;
  }
  return {
    reply: value.reply,
    status,
    request: {
      product: request.product,
      budget: request.budget,
      condition: request.condition,
    },
  };
}

/** 대화 기록 전체를 보내고 AI의 다음 한 턴을 받는다. 시작할 때는 빈 배열이다. */
export async function requestConverse(
  messages: ChatTurn[],
  signal?: AbortSignal,
): Promise<ConverseOutcome> {
  try {
    const response = await fetch("/api/requests/converse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(CONVERSE_TIMEOUT_MS)])
        : AbortSignal.timeout(CONVERSE_TIMEOUT_MS),
    });
    if (!response.ok) return outcomeForStatus(response.status);
    const result = readConverseResult(await response.json());
    return result
      ? { kind: "ok", result }
      : { kind: "failed", status: AI_STATUS.aiFailed };
  } catch {
    return { kind: "failed", status: AI_STATUS.aiFailed };
  }
}
