// 이용자 AI 대화 화면의 상태. 순수 함수만 둔다. 서버는 대화를 저장하지 않으므로 기록 전체가 여기(메모리)에만 있다.

import { AI_STATUS, type ChatTurn, type ConverseStatus } from "@/lib/converse";

export interface AiChatModel {
  /** thinking: 서버 답을 기다림. ready: 이용자 차례. failed: 이번 턴이 실패했다. */
  phase: "thinking" | "ready" | "failed";
  /** 확정된 대화. AI 문장으로 시작해 AI 문장으로 끝난다. */
  history: ChatTurn[];
  /** 서버에 보낸(또는 다시 보낼) 대화. 이용자 문장으로 끝나거나 비어 있다(첫 턴). */
  sent: ChatTurn[];
  reply: string;
  replyStatus: ConverseStatus | null;
  /** 받은 AI 문장 수. 새 문장마다 초점을 옮기는 신호다. */
  turn: number;
  /** 상태 영역에 읽을 문구. ready일 때는 비어 있고 음성 입력 쪽 문구를 쓴다. */
  status: string;
  /** failed에서 같은 대화를 다시 보내도 되는지. 아니면 기본 질문으로만 간다. */
  canRetry: boolean;
}

export type AiChatAction =
  | { type: "send"; text: string }
  | { type: "retry" }
  | { type: "replied"; reply: string; status: ConverseStatus }
  | { type: "failed"; status: string; canRetry: boolean };

export function createInitialChat(): AiChatModel {
  return {
    phase: "thinking",
    history: [],
    sent: [],
    reply: "",
    replyStatus: null,
    turn: 0,
    status: AI_STATUS.aiThinking,
    canRetry: true,
  };
}

export function aiChatReducer(model: AiChatModel, action: AiChatAction): AiChatModel {
  switch (action.type) {
    case "send":
      if (model.phase !== "ready") return model;
      return {
        ...model,
        phase: "thinking",
        sent: [...model.history, { role: "user", content: action.text }],
        status: AI_STATUS.aiThinking,
      };
    case "retry":
      if (model.phase !== "failed" || !model.canRetry) return model;
      return { ...model, phase: "thinking", status: AI_STATUS.aiThinking };
    case "replied":
      if (model.phase !== "thinking") return model;
      return {
        ...model,
        phase: "ready",
        history: [...model.sent, { role: "assistant", content: action.reply }],
        reply: action.reply,
        replyStatus: action.status,
        turn: model.turn + 1,
        status: "",
        canRetry: true,
      };
    case "failed":
      if (model.phase !== "thinking") return model;
      return { ...model, phase: "failed", status: action.status, canRetry: action.canRetry };
  }
}
