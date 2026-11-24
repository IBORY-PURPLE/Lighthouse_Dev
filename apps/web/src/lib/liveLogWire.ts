// /live 대화 기록(QA 분석용)에서 화면과 서버가 주고받는 모양. 화면(liveLog.ts)과 서버(/api/live/log)가 같이 쓴다.
// 이 파일은 타입과 상수만 둔다(서버 전용 코드, 브라우저 전용 코드를 넣지 않는다).
// 로그와 콘솔에 이용자 말, AI 답, 기기 ID, 참가자 표지를 남기지 않는다. 대화 글은 live_events 표에만 둔다.

/** user: 이용자 말, ai: AI 말, app: 앱이 읽어 준 글, event: 글 없는 사건(body는 언제나 ""). */
export type LiveLogKind = "user" | "ai" | "app" | "event";

export interface LiveLogEntry {
  /** 대화 id(화면이 만든 UUID). 접수된 요청의 clientRequestId와 같은 값이다. */
  cid: string;
  /** 그 대화 안의 순번. 0부터 1씩 늘어난다. */
  seq: number;
  kind: LiveLogKind;
  /** 사건 꼬리표. 글자·숫자·`_:.-`만, 40자 이하. event는 비울 수 없다. */
  tag: string;
  /** 글. 1,000자 이하. event는 "". */
  body: string;
  /** 사건을 처리한 뒤의 단계(LivePhase). 모르면 "". */
  phase: string;
  engine: "" | "realtime" | "fallback";
  /** 그 대화의 첫 줄부터 흐른 ms(브라우저 시계). */
  atMs: number;
}

/** POST /api/live/log 본문. 기기 ID는 싣지 않는다(서버가 쿠키에서 읽는다). */
export interface LiveLogRequest {
  /** QA 참가자 표지(주소의 ?p=). 없으면 "". */
  label: string;
  entries: LiveLogEntry[];
}

/**
 * 서버가 200으로 답할 때의 결과. 화면은 200을 받으면 그 묶음을 다시 보내지 않는다(no_device와 unavailable만 예외).
 * saved: 저장함 / off: 스위치 꺼짐 / ended: 저장 기간이 끝남 / no_label: 표지가 필요한데 없음
 * no_device: 기기 쿠키가 없음(잠시 뒤 다시 보내 볼 수 있다) / empty: 쓸 수 있는 줄이 없음
 * capped: 상한에 닿음 / unavailable: 표나 연결이 아직 없음(화면은 묶음을 쥐고 쉬었다가 다시 보낸다) / failed: 다시 보내도 안 되는 저장 오류
 * 잠깐의 저장 오류는 503, 횟수 제한은 429로 답한다(화면이 나중에 다시 보낸다).
 */
export type LiveLogReason =
  | "saved"
  | "off"
  | "ended"
  | "no_label"
  | "no_device"
  | "empty"
  | "capped"
  | "unavailable"
  | "failed";

export interface LiveLogResponse {
  /** 이번 요청에서 받아들인 줄 수(이미 있던 줄을 다시 보낸 것도 센다). */
  stored: number;
  reason: LiveLogReason;
}

/** GET /api/live/config 응답의 log 값. label: 참가자 표지가 있는 화면만 보낸다 / all: 모든 화면이 보낸다. 꺼져 있으면 값이 없다. */
export type LiveLogMode = "label" | "all";

export const LIVE_LOG_PATH = "/api/live/log";
/** 한 요청의 줄 수 상한(서버). 화면은 20줄씩 보낸다. */
export const LIVE_LOG_MAX_ENTRIES = 40;
/** 한 요청 본문의 바이트 상한(서버). 화면은 16KB 안에서 보낸다(keepalive 요청은 브라우저가 합쳐서 약 64KB까지만 허용한다). */
export const LIVE_LOG_MAX_BYTES = 32_768;
export const LIVE_LOG_CLIENT_BATCH = 20;
export const LIVE_LOG_CLIENT_BYTES = 16_384;
export const LIVE_LOG_SEQ_MAX = 999;
export const LIVE_LOG_BODY_MAX = 1000;
export const LIVE_LOG_AT_MS_MAX = 86_400_000;
/** 표의 check와 같은 모양이다(supabase/migrations/20261125000000_live_events.sql). */
export const LIVE_LOG_LABEL = /^[A-Za-z0-9_-]{1,12}$/;
export const LIVE_LOG_TAG = /^[A-Za-z0-9_:.-]{1,40}$/;
export const LIVE_LOG_PHASE = /^[a-z]{0,16}$/;
export const LIVE_LOG_CID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 참가자 표지를 끄는 값(주소의 ?p=off). 이 브라우저에 기억해 둔 표지를 지운다. */
export const LIVE_LOG_LABEL_OFF = "off";
/** 참가자 표지를 기억해 두는 기기 저장소 열쇠. */
export const LIVE_LOG_LABEL_KEY = "lh-live-qa";
