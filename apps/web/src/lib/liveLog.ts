// /live 대화 기록(QA 분석용)의 브라우저 쪽: 사건을 줄로 바꾸고, 모아서, /api/live/log로 보낸다.
// React·DOM에 기대지 않는 순수 모듈이라 node에서 시험한다. 약속(타입·상수)은 liveLogWire.ts.
// 허용 목록에 있는 사건·효과만 글로 남긴다(새 사건이 생겨도 글이 새지 않는다).
// 콘솔에 아무것도 찍지 않는다. 어떤 경우에도 던지지 않는다. 러너에 사건을 넣지 않는다. 대화는 기록 때문에 끊기지 않는다.
import type { LiveEffect, LiveEvent, LiveState } from "@/lib/liveMachine";
import {
  LIVE_LOG_BODY_MAX,
  LIVE_LOG_CID,
  LIVE_LOG_CLIENT_BATCH,
  LIVE_LOG_CLIENT_BYTES,
  LIVE_LOG_LABEL,
  LIVE_LOG_LABEL_KEY,
  LIVE_LOG_LABEL_OFF,
  LIVE_LOG_PATH,
  LIVE_LOG_SEQ_MAX,
  LIVE_LOG_TAG,
  type LiveLogEntry,
  type LiveLogKind,
  type LiveLogMode,
  type LiveLogRequest,
} from "@/lib/liveLogWire";

/** 사건 하나가 만든 줄(cid·seq 같은 위치 정보는 createLiveLog가 붙인다). */
export interface LogCore {
  kind: LiveLogKind;
  tag: string;
  body: string;
}

/** 큐에 쌓을 수 있는 줄 수 상한. 넘으면 오래된 것부터 버린다. */
export const LIVE_LOG_QUEUE_MAX = 300;
/** 글이 든 줄이나 오류 사건이 들어온 뒤 모아서 보내기까지의 시간. */
export const LIVE_LOG_SEND_DELAY_MS = 2000;
/** 기기 번호를 아직 못 받았을 때(no_device) 다시 보내기까지의 시간. */
export const LIVE_LOG_NO_DEVICE_MS = 5000;
/** 실패한 뒤 다시 보내기까지의 시간(처음 두 번). */
export const LIVE_LOG_RETRY_MS = 5000;
/** 연속 3번 실패한 뒤 쉬는 시간. */
export const LIVE_LOG_REST_MS = 30_000;
/** 평소 전송 하나가 응답 없이 이만큼 지나면 끊고 실패로 본다(떠날 때 보내는 keepalive 요청에는 걸지 않는다). */
export const LIVE_LOG_SEND_TIMEOUT_MS = 10_000;
/**
 * 떠날 때 보내는 keepalive 본문 합계 상한(바이트). 브라우저는 응답이 안 온 keepalive 본문을 합쳐 약 64KB까지만 허용하고,
 * 그 몫을 Realtime hangup 요청과 나눠 쓰므로 절반만 쓴다. 넘는 줄은 큐에 남긴다.
 */
export const LIVE_LOG_LEAVE_BYTES = 32_768;
/** 같은 묶음을 no_device로 받아도 다시 보내는 최대 횟수(처음 보낸 것 포함). */
const NO_DEVICE_MAX = 3;
const FAIL_REST_AFTER = 3;

// ---------------------------------------------------------------- 사건 → 줄

const EVENT_ONLY: ReadonlySet<string> = new Set([
  "START", "RESUME", "RETRY", "CONTINUE", "NEW_REQUEST", "EXIT", "PAUSE", "HIDDEN", "VISIBLE",
  "MAIN_BUTTON", "CONSENT_BUTTON", "EDIT_BUTTON", "REPEAT", "HELP", "HOLD_SUBMIT", "HOLD_CANCEL",
  "MIC_DENIED", "NO_SPEECH", "SESSION_WARN", "REGISTER_OK",
]);

/** tag 모양(LIVE_LOG_TAG)에 맞춘다: 다른 글자는 `_`, 40자까지. */
function cleanTag(raw: string): string {
  const t = raw.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 40);
  return LIVE_LOG_TAG.test(t) ? t : "";
}

/** 1,000자(코드 포인트 기준)까지. JS slice는 이모지 반쪽을 남겨 JSON 오류를 낸다. */
function cutBody(text: string): string {
  const t = text.trim();
  return Array.from(t).length > LIVE_LOG_BODY_MAX ? Array.from(t).slice(0, LIVE_LOG_BODY_MAX).join("") : t;
}

function ev(tag: string): LogCore[] {
  const t = cleanTag(tag);
  return t === "" ? [] : [{ kind: "event", tag: t, body: "" }];
}

function textLine(kind: "user" | "ai" | "app", tag: string, text: unknown): LogCore[] {
  if (typeof text !== "string") return [];
  const body = cutBody(text);
  const t = cleanTag(tag);
  return body === "" || t === "" ? [] : [{ kind, tag: t, body }];
}

function fromEvent(e: LiveEvent): LogCore[] {
  switch (e.type) {
    case "USER_TURN_END": {
      const text = typeof e.text === "string" ? e.text.trim() : "";
      if (!e.transcribed || text === "") return ev("heard_empty");
      return textLine("user", "heard", text);
    }
    case "USER_PART":
      return textLine("user", "part", e.text);
    case "USER_TRANSCRIPT":
      return e.final ? textLine("user", "late", e.text) : [];
    case "TEXT_SUBMIT":
      return textLine("user", "typed", e.text);
    case "REPLY_TEXT":
      return e.final ? textLine("ai", "reply", e.text) : [];
    case "TURN_RESULT":
      return ev(`TURN_RESULT:${e.status}`);   // reply는 글로 남기지 않는다. 같은 글이 SPEAK id 'ai'로 다시 나온다.
    case "READY":
      return ev(`READY:${e.engine}`);
    case "INTENT":
      return ev(`INTENT:${e.kind}`);
    case "FAILED":
      return ev(`FAILED:${e.kind}`);
    case "LOST":
      return ev(`LOST:${e.reason}`);
    case "REGISTER_FAIL":
      return ev(`REGISTER_FAIL:${e.kind}`);
    default:
      return EVENT_ONLY.has(e.type) ? ev(e.type) : [];
  }
}

function fromEffect(fx: LiveEffect, event: LiveEvent): LogCore[] {
  switch (fx.type) {
    case "SPEAK":
    case "ANNOUNCE": {
      const id = fx.type === "SPEAK" ? fx.id : fx.endId;
      if (id === undefined || id === "") return [];   // endId 없는 ANNOUNCE는 남기지 않는다
      // 읽기 실패 뒤의 다시 읽기·알림 대체는 같은 글이 또 나온 것이다. 한 번만 남긴다.
      if (event.type === "SPEAK_END" && event.id === id) return [];
      // 예비 엔진의 AI 답은 SPEAK(또는 목소리가 없을 때 ANNOUNCE) id 'ai'로 나온다.
      if (id === "ai") return textLine("ai", "reply", fx.text);
      return textLine("app", `say:${id}`, fx.text);
    }
    case "ENGINE_START":
      return ev(`ENGINE_START:${fx.kind}`);
    case "ENGINE_RESPOND":
      return ev(`sent:${fx.source}`);
    case "ENGINE_TOOL_RESULT":
      return fx.respond === "clarify" ? ev("CLARIFY:realtime") : [];
    case "ENGINE_CANCEL_RESPONSE":
      return ev("ENGINE_CANCEL_RESPONSE");
    case "REGISTER":
      return ev("REGISTER");   // 접수를 보낸 사실. 화면이 닫힌 뒤 끝난 접수는 REGISTER_OK가 남지 않는다.
    default:
      return [];
  }
}

/** 사건과 효과를 기록할 줄로 바꾼다. 허용 목록에 없으면 빈 배열. 순수 함수. */
export function toLogEntries(event: LiveEvent, _state: LiveState, effects: LiveEffect[]): LogCore[] {
  const out: LogCore[] = [...fromEvent(event)];
  for (const fx of effects) out.push(...fromEffect(fx, event));
  return out;
}

/** 글이 든 줄이거나 오류 사건이면 곧 보낼 만하다. */
function worthy(c: { kind: LiveLogKind; tag: string }): boolean {
  return c.kind !== "event" || c.tag.startsWith("FAILED") || c.tag.startsWith("LOST") || c.tag.startsWith("REGISTER_");
}

// ---------------------------------------------------------------- 참가자 표지

/**
 * 주소의 ?p=를 읽어 참가자 표지를 정한다. 모양(LIVE_LOG_LABEL)이 맞으면 기기 저장소에 기억하고,
 * 주소에 p가 없거나 모양이 틀리면 기억해 둔 값을 쓴다. ?p=off(대소문자 무관)면 기억을 지우고 표지 없음. 저장소가 던져도 삼킨다.
 */
export function readLiveLogLabel(search: string, storage: Storage | null): string {
  let param: string | null = null;
  try {
    param = new URLSearchParams(search).get("p");
  } catch {
    param = null;
  }
  if (param !== null && param.toLowerCase() === LIVE_LOG_LABEL_OFF) {
    try {
      storage?.removeItem(LIVE_LOG_LABEL_KEY);
    } catch {
      // 지우지 못해도 이 화면은 표지 없음이다.
    }
    return "";
  }
  if (param !== null && LIVE_LOG_LABEL.test(param)) {
    try {
      storage?.setItem(LIVE_LOG_LABEL_KEY, param);
    } catch {
      // 기억하지 못해도 이 화면에서는 쓴다.
    }
    return param;
  }
  try {
    const remembered = storage?.getItem(LIVE_LOG_LABEL_KEY) ?? "";
    return LIVE_LOG_LABEL.test(remembered) ? remembered : "";
  } catch {
    return "";
  }
}

/** 서버가 기록을 끈 것이 확인되면(설정 응답에 log가 없음) 기억해 둔 표지를 지운다. 저장소가 던져도 삼킨다. */
export function forgetLiveLogLabel(storage: Storage | null): void {
  try {
    storage?.removeItem(LIVE_LOG_LABEL_KEY);
  } catch {
    // 지우지 못해도 이 화면은 보내지 않는다.
  }
}

// ---------------------------------------------------------------- 모으고 보내기

export interface LiveLogDeps {
  fetch: typeof fetch;
  /** 기기 쿠키 발급을 기다리는 약속. 평소 전송의 첫 번째는 이 뒤로 미룬다. */
  deviceReady: Promise<void>;
  timers: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  now(): number;
  /** 참가자 표지. 없으면 "". */
  label: string;
  /** 서버가 stored > 0을 답할 때마다 부른다(저장된 줄 수). */
  onStored?(count: number): void;
  /** 서버 답(off·ended·no_label·404)이나 설정 때문에 이 화면에서 보내기를 멈출 때 한 번 부른다(표시를 내리는 용도). */
  onStopped?(): void;
  /** 서버가 받았지만 저장하지 못했다고 답할 때(capped·failed·unavailable) 부른다(표시를 내리는 용도). 다시 저장되면 onStored가 불린다. */
  onNotStored?(): void;
}

export interface LiveLog {
  record(event: LiveEvent, state: LiveState, effects: LiveEffect[]): void;
  setMode(mode: LiveLogMode | null): void;
  /** 쌓인 줄을 바로 보낸다. leaving이면 떠나는 중이다(기기 쿠키를 기다리지 않고, 끊긴 AI 답도 남긴다). */
  flush(leaving?: boolean): void;
  /** 타이머를 지우고 더 보내지 않는다. */
  dispose(): void;
}


type Mode = "unknown" | "on" | "off";

const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const byteLength = (s: string): number => (encoder ? encoder.encode(s).length : s.length * 3);

/** 한 묶음의 열쇠: 첫 줄의 cid:seq. no_device 다시 보내기 횟수를 묶음마다 센다. */
const batchKey = (batch: LiveLogEntry[]): string => (batch.length > 0 ? `${batch[0].cid}:${batch[0].seq}` : "");

interface PostResult {
  status: number;
  data: unknown;
}

export function createLiveLog(deps: LiveLogDeps): LiveLog {
  let mode: Mode = "unknown";
  let queue: LiveLogEntry[] = [];
  let timer: { handle: unknown } | null = null;
  let inflight = 0;
  let failures = 0;
  /** 실패·no_device 뒤 이 시각(deps.now 기준) 전에는 평소 전송을 하지 않는다. 재시도 타이머만 보낸다. */
  let retryAt = 0;
  /** 떠날 때 보낸 뒤 아직 응답이 안 온 keepalive 본문 바이트 합계. */
  let keepaliveBytes = 0;
  const noDevice = new Map<string, number>();
  let deviceSettled = false;
  let disposed = false;
  let stopped = false;
  /** 쉬는 구간 번호. 평소 전송이 실패해 새로 쉬기 시작하거나 성공하면 올라간다(떠날 때 전송의 실패는 구간을 바꾸지 않는다). */
  let restEpoch = 0;
  /** 떠날 때 전송을 이미 한 쉬는 구간 번호. 쉬는 구간 하나에 한 번만 허용한다. */
  let leaveEpoch = -1;
  /** 응답을 아직 못 받은 평소 묶음. 페이지를 닫으면 브라우저가 취소하므로 떠날 때 한 번 더 보낸다. */
  let active: { batch: LiveLogEntry[]; dup: boolean } | null = null;
  const cids = new Map<string, { seq: number; startAt: number }>();
  /** 끊겼을지 모르는 AI 답(final이 아닌 REPLY_TEXT 중 마지막 것). */
  let pendingCut: { cid: string; text: string; phase: string; engine: LiveLogEntry["engine"] } | null = null;
  /** 방금 끊긴 것으로 남긴 글. 곧 같은 응답의 전체 글(final)이 오면 reply_after_cut으로 표시한다. */
  let lastCut: string | null = null;

  const stopSending = () => {
    mode = "off";
    queue = [];
    pendingCut = null;
    lastCut = null;
    noDevice.clear();
    clearTimer();
    if (!stopped) {
      stopped = true;
      try {
        deps.onStopped?.();
      } catch {
        // 표시 오류가 멈춤을 막지 않게 한다.
      }
    }
  };

  function clearTimer(): void {
    if (!timer) return;
    try {
      deps.timers.clear(timer.handle);
    } catch {
      // 지우지 못해도 다음 호출은 mode를 보고 멈춘다.
    }
    timer = null;
  }

  /** 실패·no_device 뒤 쉬는 시간 안이면 true. */
  function resting(): boolean {
    return deps.now() < retryAt;
  }

  /**
   * ms 뒤에 보내는 타이머를 건다. 이미 있으면 그대로 둔다.
   * 타이머가 보내는 것은 쉬는 시간이 끝난 뒤의 재시도이므로 쉬는 시간 검사를 건너뛴다.
   */
  function arm(ms: number): void {
    if (timer || mode !== "on" || disposed) return;
    const slot: { handle: unknown } = { handle: null };
    timer = slot;
    try {
      slot.handle = deps.timers.set(() => {
        if (timer === slot) timer = null;
        void sendNext(true);
      }, ms);
    } catch {
      timer = null;
    }
  }

  function push(entry: LiveLogEntry): void {
    queue.push(entry);
    trim();
  }

  /** 큐가 상한을 넘으면 오래된 것(앞)부터 버린다. */
  function trim(): void {
    if (queue.length > LIVE_LOG_QUEUE_MAX) queue.splice(0, queue.length - LIVE_LOG_QUEUE_MAX);
  }

  const bodyOf = (batch: LiveLogEntry[]): string => JSON.stringify({ label: deps.label, entries: batch } satisfies LiveLogRequest);

  /** 앞에서부터 줄 수·바이트 한도 안에서 한 묶음을 꺼낸다. 한 줄도 못 담으면 빈 묶음(큐는 그대로). */
  function take(maxBytes: number = LIVE_LOG_CLIENT_BYTES): LiveLogEntry[] {
    const batch: LiveLogEntry[] = [];
    for (const entry of queue) {
      if (batch.length >= LIVE_LOG_CLIENT_BATCH) break;
      const size = byteLength(bodyOf([...batch, entry]));
      // 평소 한도에서는 첫 줄을 항상 담는다(큐가 막히지 않게). 떠날 때 남은 몫이 모자라면 담지 않는다.
      if (size > maxBytes && (batch.length > 0 || maxBytes < LIVE_LOG_CLIENT_BYTES)) break;
      batch.push(entry);
    }
    queue.splice(0, batch.length);
    return batch;
  }

  /** 요청 하나를 보내고 응답을 모은다. 평소 전송은 10초 안에 끝나지 않으면 끊고 실패(status 0)로 돌려준다. 던지지 않는다. */
  function post(body: string, leaving: boolean): Promise<PostResult> {
    let ctl: AbortController | null = null;
    if (!leaving) {
      try {
        ctl = typeof AbortController === "undefined" ? null : new AbortController();
      } catch {
        ctl = null;
      }
    }
    const work = (async (): Promise<PostResult> => {
      try {
        const res = await deps.fetch(LIVE_LOG_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: leaving, // keepalive는 떠날 때만(브라우저 합계 한도를 아낀다)
          ...(ctl ? { signal: ctl.signal } : {}),
        });
        let data: unknown = null;
        if (res.status === 200) {
          try {
            data = await res.json();
          } catch {
            data = null;
          }
        }
        return { status: res.status, data };
      } catch {
        return { status: 0, data: null };
      }
    })();
    if (leaving) return work;
    return new Promise<PostResult>((resolve) => {
      let done = false;
      let handle: unknown = null;
      const finish = (r: PostResult) => {
        if (done) return;
        done = true;
        if (handle !== null) {
          try {
            deps.timers.clear(handle);
          } catch {
            // 지우지 못해도 이미 끝났다.
          }
        }
        resolve(r);
      };
      try {
        handle = deps.timers.set(() => {
          try {
            ctl?.abort();
          } catch {
            // 끊지 못해도 응답은 버린다.
          }
          finish({ status: 0, data: null });
        }, LIVE_LOG_SEND_TIMEOUT_MS);
      } catch {
        handle = null;
      }
      void work.then(finish);
    });
  }

  /** 한 묶음을 보내고 응답을 처리한다. 던지지 않는다. leaving이면 reservedBytes(예약한 keepalive 본문)를 응답 뒤 돌려준다. */
  async function sendBatch(batch: LiveLogEntry[], leaving: boolean, reservedBytes: number): Promise<void> {
    inflight += 1;
    const mine = leaving ? null : { batch, dup: false };
    if (mine) active = mine;
    try {
      if (!leaving && !deviceSettled) {
        try {
          await deps.deviceReady;
        } catch {
          // 쿠키를 못 받아도 보내 본다. 서버가 no_device로 답하면 다시 보낸다.
        }
        deviceSettled = true;
      }
      if (mode !== "on" || disposed) return;
      const result = await post(bodyOf(batch), leaving);
      handle(batch, result.status, result.data, leaving);
    } catch {
      requeue(batch);
      fail(leaving);
    } finally {
      inflight -= 1;
      if (mine && active === mine) active = null;
      if (leaving) keepaliveBytes = Math.max(0, keepaliveBytes - reservedBytes);
    }
  }

  function requeue(batch: LiveLogEntry[]): void {
    if (mode !== "on") return;
    queue.unshift(...batch);
    trim();
  }

  /** 실패한 뒤: 5초(1·2번째)·30초(3번째부터) 쉰다. 그동안 평소 전송은 막고 재시도 타이머만 보낸다. */
  function fail(leaving = false): void {
    if (mode !== "on" || disposed) return;
    notStored(); // 지금은 저장되지 않고 있다. 다시 저장되면 onStored가 표시를 올린다.
    failures += 1;
    if (!leaving) restEpoch += 1; // 평소 전송의 실패는 새 쉬는 구간이다. 떠날 때 전송의 실패는 같은 구간을 늘릴 뿐이다.
    const ms = failures >= FAIL_REST_AFTER ? LIVE_LOG_REST_MS : LIVE_LOG_RETRY_MS;
    retryAt = deps.now() + ms;
    clearTimer();
    arm(ms);
  }

  function succeed(): void {
    failures = 0;
    retryAt = 0;
    restEpoch += 1;
  }

  function handle(batch: LiveLogEntry[], status: number, data: unknown, leaving: boolean): void {
    if (mode !== "on") return;
    if (status === 404) {
      stopSending();
      return;
    }
    if (status === 429 || status === 408 || status >= 500 || status === 0) {
      requeue(batch);
      fail(leaving);
      return;
    }
    if (status !== 200) {
      // 400·403·413처럼 다시 보내도 안 되는 답은 그 묶음을 버린다.
      noDevice.delete(batchKey(batch));
      succeed();
      afterDone();
      return;
    }
    onReply(batch, data, leaving);
  }

  function notStored(): void {
    try {
      deps.onNotStored?.();
    } catch {
      // 표시 오류가 보내기를 멈추지 않게 한다.
    }
  }

  function onReply(batch: LiveLogEntry[], data: unknown, leaving: boolean): void {
    try {
      if (mode !== "on") return;
      const obj = (data && typeof data === "object" ? data : {}) as { stored?: unknown; reason?: unknown };
      const reason = typeof obj.reason === "string" ? obj.reason : "";
      const stored = typeof obj.stored === "number" && Number.isFinite(obj.stored) ? obj.stored : 0;
      if (reason === "off" || reason === "ended" || reason === "no_label") {
        stopSending();
        return;
      }
      if (reason === "unavailable") {
        // 표가 아직 없다. 대화 중에 생길 수 있으니 실패와 같이 되돌려 놓고 쉬었다 다시 보낸다(onStored는 부르지 않는다).
        requeue(batch);
        fail(leaving); // fail이 표시도 내린다
        return;
      }
      succeed();
      const key = batchKey(batch);
      if (reason === "no_device") {
        notStored();
        const tries = (noDevice.get(key) ?? 0) + 1;
        if (tries < NO_DEVICE_MAX) {
          noDevice.set(key, tries);
          requeue(batch);
          retryAt = deps.now() + LIVE_LOG_NO_DEVICE_MS;
          clearTimer();
          arm(LIVE_LOG_NO_DEVICE_MS);
          return;
        }
        noDevice.delete(key); // 같은 묶음을 3번 보냈다. 버린다.
        afterDone();
        return;
      }
      noDevice.delete(key);
      if (stored > 0) {
        try {
          deps.onStored?.(stored);
        } catch {
          // 표시 오류가 보내기를 멈추지 않게 한다.
        }
      } else if (reason === "capped" || reason === "failed") {
        notStored();
      }
      afterDone();
    } catch {
      // 응답 처리 중 오류는 삼킨다.
    }
  }

  /** 한 묶음이 끝난 뒤: 남은 것이 많거나 보낼 만한 줄이 있으면 이어서 보낸다. */
  function afterDone(): void {
    if (mode !== "on" || queue.length === 0) return;
    // 아직 이 요청의 inflight가 남아 있으므로, 끝난 뒤(다음 마이크로태스크)에 이어서 보낸다.
    if (queue.length >= LIVE_LOG_CLIENT_BATCH) void Promise.resolve().then(() => sendNext());
    else if (queue.some(worthy)) arm(LIVE_LOG_SEND_DELAY_MS);
  }

  /** 평소 전송 한 묶음. retry는 재시도 타이머가 부른 것(쉬는 시간 검사를 건너뛴다). 떠날 때 전송은 flush가 따로 한다. */
  async function sendNext(retry = false): Promise<void> {
    if (mode !== "on" || disposed || queue.length === 0) return;
    if (inflight > 0) return; // 평소에는 한 번에 하나만(직렬)
    if (!retry && resting()) {
      arm(Math.max(0, retryAt - deps.now())); // 쉬는 중에는 보내지 않는다. 쉬는 시간이 끝나면 타이머가 보낸다.
      return;
    }
    const batch = take();
    if (batch.length === 0) return;
    await sendBatch(batch, false, 0);
  }

  function emit(cid: string, core: LogCore, phase: string, engine: LiveLogEntry["engine"]): void {
    let c = cids.get(cid);
    if (!c) {
      c = { seq: 0, startAt: deps.now() };
      cids.set(cid, c);
    }
    if (c.seq > LIVE_LOG_SEQ_MAX) return;
    const atMs = Math.max(0, Math.min(86_400_000, Math.round(deps.now() - c.startAt)));
    push({ cid, seq: c.seq, kind: core.kind, tag: core.tag, body: core.body, phase, engine, atMs });
    c.seq += 1;
  }

  function emitCut(): void {
    const cut = pendingCut;
    if (!cut) return;
    pendingCut = null;
    lastCut = cut.text;
    emit(cut.cid, { kind: "ai", tag: "reply_cut", body: cutBody(cut.text) }, cut.phase, cut.engine);
  }

  function record(event: LiveEvent, state: LiveState, effects: LiveEffect[]): void {
    try {
      if (mode === "off" || disposed) return;
      const cid = typeof state.cid === "string" ? state.cid : "";
      if (!LIVE_LOG_CID.test(cid)) return;
      const phase = typeof state.phase === "string" ? state.phase : "";
      const engine: LiveLogEntry["engine"] = state.engine === "realtime" || state.engine === "fallback" ? state.engine : "";
      const before = queue.length;

      // 끊긴 AI 답: 답이 취소되거나 엔진이 닫히면 한 줄로 남긴다. REPLY_START는 끊김 신호가 아니다
      // (Realtime에서는 자막이 소리 시작 신호보다 먼저 올 수 있다).
      if (effects.some((fx) => fx.type === "ENGINE_CANCEL_RESPONSE" || fx.type === "ENGINE_CLOSE")) emitCut();
      let afterCut = false;
      if (event.type === "REPLY_TEXT" && typeof event.text === "string") {
        if (event.final) {
          // 끊긴 글로 시작하는 전체 글이면 같은 응답의 마지막 모습이다(이용자가 듣지 못한 뒷부분이 들어 있다).
          afterCut = lastCut !== null && event.text.startsWith(lastCut);
          lastCut = null;
          pendingCut = null;
        } else if (event.text.trim() !== "") {
          // 기억해 둔 글로 시작하지 않는 누적 글은 새 응답이다. 앞 응답은 끊긴 것으로 남긴다.
          if (pendingCut !== null && !event.text.startsWith(pendingCut.text)) emitCut();
          if (lastCut !== null && !event.text.startsWith(lastCut)) lastCut = null;
          pendingCut = { cid, text: event.text, phase, engine };
        }
      }

      let hasWorthy = queue.length > before && queue.slice(before).some(worthy);
      for (const core of toLogEntries(event, state, effects)) {
        emit(cid, afterCut && core.kind === "ai" && core.tag === "reply" ? { ...core, tag: "reply_after_cut" } : core, phase, engine);
        if (worthy(core)) hasWorthy = true;
      }
      if (mode !== "on") return; // 설정 응답 전에는 쌓기만 한다.
      if (queue.length >= LIVE_LOG_CLIENT_BATCH) void sendNext(); // 쉬는 중이면 sendNext가 보내지 않는다
      else if (hasWorthy) arm(LIVE_LOG_SEND_DELAY_MS);
    } catch {
      // 기록 오류가 대화를 막지 않는다.
    }
  }

  function setMode(next: LiveLogMode | null): void {
    try {
      if (disposed) return;
      if (next === "all" || (next === "label" && deps.label !== "")) {
        mode = "on";
        stopped = false;
        if (queue.length >= LIVE_LOG_CLIENT_BATCH) void sendNext();
        else if (queue.some(worthy)) arm(LIVE_LOG_SEND_DELAY_MS);
        return;
      }
      stopSending();
    } catch {
      // 삼킨다.
    }
  }

  /** 응답을 못 받은 평소 묶음의 응답 처리(떠날 때 한 번 더 보낸 사본). 서버가 같은 cid·seq를 한 번만 저장하므로 결과는 가볍게만 본다. */
  async function sendDuplicate(batch: LiveLogEntry[], reservedBytes: number): Promise<void> {
    try {
      const { status, data } = await post(bodyOf(batch), true);
      if (mode !== "on" || disposed) return;
      if (status === 404) {
        stopSending();
        return;
      }
      if (status !== 200) return; // 실패해도 평소 요청이 자기 몫을 처리한다(큐로 되돌림).
      const obj = (data && typeof data === "object" ? data : {}) as { stored?: unknown; reason?: unknown };
      if (obj.reason === "off" || obj.reason === "ended" || obj.reason === "no_label") {
        stopSending();
        return;
      }
      if (typeof obj.stored === "number" && obj.stored > 0) {
        try {
          deps.onStored?.(obj.stored);
        } catch {
          // 표시 오류는 삼킨다.
        }
      }
    } catch {
      // 삼킨다.
    } finally {
      keepaliveBytes = Math.max(0, keepaliveBytes - reservedBytes);
    }
  }

  function flush(leaving = false): void {
    try {
      if (leaving) emitCut();
      if (mode !== "on" || disposed) return;
      if (leaving && failures > 0) {
        // 연속 실패로 쉬는 중: 떠날 때 전송은 쉬는 구간 하나에 한 번만(탭을 숨겼다 보였다 해도 그때마다 서버를 부르지 않는다).
        if (resting() && leaveEpoch === restEpoch) return;
        leaveEpoch = restEpoch;
      }
      clearTimer();
      if (leaving) {
        // 떠나는 중: 기기 쿠키를 기다리지 않고, 쌓인 것을 바로 보낸다. keepalive 본문 합계는 LIVE_LOG_LEAVE_BYTES까지만.
        // 응답을 못 받은 평소 묶음은 페이지가 닫히면 취소되므로 먼저 한 번 더 보낸다(한 묶음에 한 번).
        const act = active;
        if (act && !act.dup) {
          const size = byteLength(bodyOf(act.batch));
          if (size <= LIVE_LOG_LEAVE_BYTES - keepaliveBytes) {
            act.dup = true;
            keepaliveBytes += size;
            void sendDuplicate(act.batch, size);
          }
        }
        // 못 보낸 줄은 큐에 남겨 두고(화면이 돌아오면 평소 전송으로 나간다) 타이머를 다시 건다.
        while (queue.length > 0) {
          const batch = take(Math.min(LIVE_LOG_CLIENT_BYTES, LIVE_LOG_LEAVE_BYTES - keepaliveBytes));
          if (batch.length === 0) break;
          const size = byteLength(bodyOf(batch));
          keepaliveBytes += size;
          void sendBatch(batch, true, size);
        }
        if (queue.length > 0) arm(Math.max(LIVE_LOG_SEND_DELAY_MS, retryAt - deps.now()));
      } else {
        void sendNext();
      }
    } catch {
      // 삼킨다.
    }
  }

  function dispose(): void {
    disposed = true;
    clearTimer();
  }

  return { record, setMode, flush, dispose };
}
