// /live 공통 타입과 인터페이스: 엔진, 신호음 재생기, 읽어 주기. 구현은 없다. 설계서 6절.
// 상태 기계, 실행기, 두 엔진, 신호음, 읽어 주기가 모두 이 파일의 타입을 쓴다.

export type EngineKind = "realtime" | "fallback";
export type InputMode = "voice" | "text";
export type LiveChatStatus = "asking" | "confirming" | "done" | "ended";
export type ToolResponse = boolean | "clarify";

/** 모은 내용. 모두 문자열이고 모르면 "". 길이는 SLOT_MAX(6.4절) 이하다. */
export interface LiveConditionAnswer { label: string; answer: string }
export interface LiveSlots {
  product: string;
  info: string;
  options: string;
  budget: string;
  purchaseTiming?: string;
  conditions?: LiveConditionAnswer[];
}
/** 확인받을 내용. summary는 AI가 아니라 앱이 칸으로 만든다(summaryOf). */
export interface LiveDraft extends LiveSlots { summary: string }

/** 대화 기록 한 칸. AI 칸의 content는 encodeAiTurn이 만든 JSON 글이다(6.4절). */
export interface LiveTurn { role: "user" | "assistant"; content: string }

export type LiveErrorKind =
  | "mic_blocked" | "mic_denied" | "speech_unavailable" | "offline" | "rate_limited" | "timeout"
  | "failed" | "bad_request" | "unavailable_today" | "not_configured" | "connect_failed"
  | "register_rejected" | "register_conflict";

export type EngineEvent =
  | { type: "READY"; engine: EngineKind; inputMode: InputMode; textReason?: "mic_denied" | "speech_unavailable" }
  | { type: "LISTEN_STARTED"; late: boolean }          // 듣기가 실제로 시작됨. late: 시작이 LISTEN_LATE_MS보다 늦었다(허용 창)
  | { type: "USER_SPEECH_START" }
  | { type: "NO_SPEECH" }
  | { type: "USER_TURN_END"; text: string; transcribed: boolean }   // transcribed=false: Realtime 전사가 아직 안 옴
  | { type: "USER_TRANSCRIPT"; text: string; final: boolean }        // 자막, 늦게 온 전사
  | { type: "USER_PART"; text: string }                              // Realtime만: 이어 듣기(sticky) 중에 말 한 토막의 전사가 옴. 차례는 끝나지 않았다
  | { type: "TURN_RESULT"; reply: string; status: LiveChatStatus; slots: LiveSlots }   // fallback만: 한 턴의 결과
  | { type: "REPLY_START" }                                          // Realtime만: AI 소리 시작
  | { type: "REPLY_TEXT"; text: string; final: boolean }             // Realtime만: AI 말의 자막
  | { type: "REPLY_END" }                                            // Realtime만: AI 소리 끝(소리 없이 끝난 응답 포함)
  | { type: "INTENT"; kind: "confirm"; slots: LiveSlots; callId: string; audioPending?: true }   // Realtime만
  | { type: "INTENT"; kind: "register" | "end"; callId: string }           // Realtime만
  | { type: "FAILED"; kind: LiveErrorKind; retryAfterMs?: number }
  | { type: "SESSION_WARN" }
  | { type: "LOST"; reason: "connect" | "network" | "session_limit" | "server_fallback" | "budget"; detail?: string };

export interface EngineStartContext {
  cid: string;
  history: LiveTurn[];
  rate: "slow" | "normal" | "fast";
  stream?: MediaStream;        // Realtime만: 실행기가 받은 마이크
  signal: AbortSignal;         // 끊기면 시작을 그만두고 스스로 닫는다
}

export interface LiveEngine {
  readonly kind: EngineKind;
  start(ctx: EngineStartContext): Promise<void>;   // 실패는 던지지 않고 FAILED나 LOST로 알린다
  listen(opts?: { keep?: boolean; sticky?: boolean; bargeIn?: boolean }): void;   // bargeIn: AI가 말하는 중에 별도로 듣는다.
  hold(): void;                                     // 마이크를 잠시 닫는다. 들은 글은 버리지 않는다
  submit(): void;                                   // 지금까지 들은 것으로 차례를 끝낸다
  cancelListen(discard: boolean): void;
  respond(turn: { text: string; source: "voice" | "text" }, history: LiveTurn[]): void;  // history에는 이번 말이 없다
  narrate?(text: string): void;
  cancelResponse(): void;                           // 답 요청을 끊고 AI 소리를 멈춘다
  toolResult(callId: string, output: object, respond: ToolResponse): void;  // fallback은 아무 일도 하지 않는다
  setRate(rate: "slow" | "normal" | "fast"): void;
  close(): void;                                    // 여러 번 불러도 안전
  on(listener: (e: EngineEvent) => void): () => void;
}

export type EarconName = "start" | "turn" | "sent" | "wait" | "confirm" | "done" | "error" | "pause" | "end" | "cancel";
export interface EarconPlayer { unlock(): void; play(name: EarconName): Promise<void>; startWait(): void; stopWait(): void }

export interface LiveSpeaker {
  readonly available: boolean;
  // 앞의 읽기는 끊는다. failed가 참이면 읽지 못했거나 끝까지 읽었는지 알 수 없다(낭독 오류, 끝남 신호 없음).
  speak(id: string, text: string, onEnd: (id: string, failed?: boolean) => void, fastest?: boolean): void;
  stop(): void;
  setRate(rate: "slow" | "normal" | "fast"): void;
}
