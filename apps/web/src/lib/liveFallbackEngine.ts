// /live fallback 엔진: 브라우저 음성 인식(SpeechRecognition)과 POST /api/live/chat 한 턴. 설계서 6.2절, 7.3절.
// 기기 목소리는 liveSpeaker가 맡는다. 이 엔진은 결과(TURN_RESULT)만 내고, 로그에 이용자 말과 AI 답을 남기지 않는다.
import type {
  EngineEvent,
  EngineStartContext,
  LiveChatStatus,
  LiveEngine,
  LiveErrorKind,
  LiveTurn,
} from "@/lib/liveEngine";
import { readSlots } from "@/lib/liveText";
import {
  CHAT_FETCH_TIMEOUT_MS,
  HISTORY_SEND_MAX,
  LISTEN_LATE_MS,
} from "@/lib/liveTiming";
import {
  MAX_CONSECUTIVE_MISSES,
  SPEECH_FIRST_START_TIMEOUT_MS,
  SPEECH_LISTEN_TIMEOUT_MS,
  SPEECH_START_TIMEOUT_MS,
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from "@/lib/speech";

export type LiveRecognition = SpeechRecognitionLike & { stop?(): void; onspeechstart?: (() => void) | null };

type ResultEvent = Parameters<NonNullable<SpeechRecognitionLike["onresult"]>>[0];

/** stop() 뒤 끝남 신호가 오지 않을 때 기다리는 시간. 지나면 들은 글로 끝낸다. */
const STOP_GRACE_MS = 3_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const CHAT_PATH = "/api/live/chat";
const STATUSES: readonly LiveChatStatus[] = ["asking", "confirming", "done", "ended"];

// 페이지 단위 변수. 엔진을 새로 만들어도 남는다. 기기 저장소(SPEECH_STARTED_KEY)는 쓰지 않는다.
// Safari가 페이지를 열 때마다 허용을 다시 물을 수 있기 때문이다.
let startedOnce = false;
let blockedOnce = false;

/** 시험 전용: 페이지 단위 변수를 처음으로 되돌린다. */
export function resetFallbackPageState(): void {
  startedOnce = false;
  blockedOnce = false;
}

type Mode = "listening" | "holding" | "submitting";

/** 인식기 한 번의 듣기. */
interface Session {
  rec: LiveRecognition;
  mode: Mode;
  done: boolean;
  listenAt: number;
  spoke: boolean;
  final: string;
  interim: string;
  /** hold() 때 붙든 글의 바탕(이 듣기 이전의 붙든 글). */
  heldBase: string;
  startTimer?: ReturnType<typeof setTimeout>;
  listenTimer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>;
}

/** 진행 중인 /api/live/chat 요청. */
interface Pending {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  finished: boolean;
}

export interface FallbackEngineOptions {
  /** 시험용. 기본은 전역 fetch(부를 때 찾는다). */
  fetch?: typeof fetch;
  createRecognition?: () => LiveRecognition;
}

const join = (a: string, b: string): string => [a, b].filter(Boolean).join(" ");

export function createFallbackEngine(win: Window, options: FallbackEngineOptions = {}): LiveEngine {
  const listeners = new Set<(e: EngineEvent) => void>();
  let closed = false;
  let cid = "";
  let session: Session | null = null;
  let held = "";
  let heldMode = false;
  let misses = 0;
  let pending: Pending | null = null;
  let startSignal: AbortSignal | undefined;
  let onAbort: (() => void) | undefined;

  const Ctor = getSpeechRecognitionCtor(win);
  const createRecognition = options.createRecognition ?? (Ctor ? () => new Ctor() : null);

  const emit = (e: EngineEvent) => {
    if (closed) return;
    for (const l of [...listeners]) l(e);
  };

  /** 듣기를 끝낸다. 이후 이 인식기의 신호는 모두 버린다. abort가 참이면 인식기도 끊는다. */
  const dispose = (s: Session, abort: boolean) => {
    if (s.done) return;
    s.done = true;
    clearTimeout(s.startTimer);
    clearTimeout(s.listenTimer);
    clearTimeout(s.stopTimer);
    s.rec.onstart = null;
    if ("onspeechstart" in s.rec) s.rec.onspeechstart = null;
    s.rec.onresult = null;
    s.rec.onerror = null;
    s.rec.onend = null;
    if (abort) {
      try {
        s.rec.abort();
      } catch {
        // 이미 끝난 인식기다.
      }
    }
    if (session === s) session = null;
  };

  /** 실패 1회로 센다. 연속 MAX_CONSECUTIVE_MISSES회면 음성 인식을 쓸 수 없는 것으로 본다. */
  const countMiss = () => {
    misses += 1;
    if (misses >= MAX_CONSECUTIVE_MISSES) {
      misses = 0;
      emit({ type: "FAILED", kind: "speech_unavailable" });
    } else {
      emit({ type: "NO_SPEECH" });
    }
  };

  /** 차례를 끝낸다. 글이 있으면 USER_TURN_END, 없으면 NO_SPEECH. 붙든 글은 비운다. */
  const turnEnd = (text: string) => {
    held = "";
    heldMode = false;
    if (text) emit({ type: "USER_TURN_END", text, transcribed: true });
    else emit({ type: "NO_SPEECH" });
  };

  /** 인식기를 끊고, 들은 글(확정 글, 없으면 마지막 중간 글)로 차례를 끝낸다. */
  const finishWithCandidate = (s: Session) => {
    const text = join(held, s.final || s.interim);
    dispose(s, true);
    turnEnd(text);
  };

  const onResult = (s: Session, event: ResultEvent) => {
    if (s.done) return;
    const results = event.results;
    const finals: string[] = [];
    let interim = "";
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      const text = r?.[0]?.transcript.trim() ?? "";
      if (!text) continue;
      if (r.isFinal) finals.push(text);
      else if (i === results.length - 1) interim = text;
    }
    s.final = finals.join(" ");
    s.interim = interim;
    if (s.mode === "holding") {
      held = join(s.heldBase, s.final || s.interim);
      return;
    }
    if (!s.spoke && (s.final || s.interim)) {
      s.spoke = true;
      emit({ type: "USER_SPEECH_START" });
    }
    if (!s.final && s.interim) emit({ type: "USER_TRANSCRIPT", text: s.interim, final: false });
  };

  const onError = (s: Session, error: string) => {
    if (s.done || s.mode === "holding") return;
    switch (error) {
      case "not-allowed":
      case "audio-capture": {
        dispose(s, false);
        // WebKit은 페이지가 보이지 않을 때도 not-allowed를 낸다. 곧 HIDDEN으로 멈춘다.
        if ((win.document?.visibilityState ?? "visible") !== "visible") return;
        if (!blockedOnce) {
          blockedOnce = true;
          emit({ type: "FAILED", kind: "mic_blocked" });
        } else {
          emit({ type: "FAILED", kind: "mic_denied" });
        }
        return;
      }
      case "service-not-allowed":
        dispose(s, false);
        emit({ type: "FAILED", kind: "speech_unavailable" });
        return;
      case "no-speech":
      case "aborted":
        // 표시만 한다. 이어서 오는 end가 확정 글 유무로 사건을 낸다.
        return;
      default:
        dispose(s, false);
        countMiss();
    }
  };

  const onEnd = (s: Session) => {
    if (s.done) return;
    if (s.mode === "holding") {
      // 우리가 끊은 것이다. 붙든 글은 이미 held에 있다.
      dispose(s, false);
      return;
    }
    const final = s.final;
    dispose(s, false);
    turnEnd(final ? join(held, final) : "");
  };

  /** submit()과 같게 지금 듣는 것을 끝낸다. */
  const submitListening = (s: Session) => {
    if (s.stopTimer) return;
    if (typeof s.rec.stop === "function") {
      s.mode = "submitting";
      clearTimeout(s.listenTimer);
      try {
        s.rec.stop();
      } catch {
        finishWithCandidate(s);
        return;
      }
      s.stopTimer = setTimeout(() => finishWithCandidate(s), STOP_GRACE_MS);
    } else {
      finishWithCandidate(s);
    }
  };

  const cancelSession = (abort: boolean) => {
    if (session) dispose(session, abort);
  };

  /** 진행 중인 요청을 끊는다. 끊긴 응답의 사건은 내지 않는다. */
  const cancelPending = () => {
    const p = pending;
    if (!p) return;
    pending = null;
    p.finished = true;
    clearTimeout(p.timer);
    p.controller.abort();
  };

  const failKind = (status: number, code: string | undefined): LiveErrorKind => {
    if (code === "rate_limited") return "rate_limited";
    if (code === "daily_cap" || code === "budget") return "unavailable_today";
    if (code === "bad_request" || code === "too_large") return "bad_request";
    if (code === "not_configured" || code === "disabled") return "not_configured";
    if (code === "timeout") return "timeout";
    if (status === 429) return "rate_limited";
    if (status === 400 || status === 413) return "bad_request";
    if (status === 503 || status === 404) return "not_configured";
    if (status === 504) return "timeout";
    return "failed";
  };

  const retryAfterMs = (res: Response): number => {
    const sec = Number(res.headers.get("Retry-After"));
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : DEFAULT_RETRY_AFTER_MS;
  };

  const doFetch = (init: RequestInit) => (options.fetch ?? ((i, o) => fetch(i, o)))(CHAT_PATH, init);

  const engine: LiveEngine = {
    kind: "fallback",

    async start(ctx: EngineStartContext) {
      cid = ctx.cid;
      if (ctx.signal.aborted) {
        engine.close();
        return;
      }
      startSignal = ctx.signal;
      onAbort = () => engine.close();
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      // 네트워크를 쓰지 않는다.
      if (createRecognition) emit({ type: "READY", engine: "fallback", inputMode: "voice" });
      else emit({ type: "READY", engine: "fallback", inputMode: "text", textReason: "speech_unavailable" });
    },

    listen(opts) {
      if (closed) return;
      cancelSession(true);
      heldMode = false;
      if (!opts?.keep) held = "";
      if (!createRecognition) {
        emit({ type: "FAILED", kind: "speech_unavailable" });
        return;
      }
      const rec = createRecognition();
      rec.lang = "ko-KR";
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      const s: Session = {
        rec,
        mode: "listening",
        done: false,
        listenAt: Date.now(),
        spoke: false,
        final: "",
        interim: "",
        heldBase: held,
      };
      session = s;
      rec.onstart = () => {
        if (s.done) return;
        startedOnce = true;
        misses = 0;
        clearTimeout(s.startTimer);
        s.listenTimer = setTimeout(() => {
          if (!s.done && s.mode === "listening") submitListening(s);
        }, SPEECH_LISTEN_TIMEOUT_MS);
        emit({ type: "LISTEN_STARTED", late: Date.now() - s.listenAt > LISTEN_LATE_MS });
      };
      rec.onresult = (event) => onResult(s, event);
      if ("onspeechstart" in rec) rec.onspeechstart = () => {
        if (s.done || s.spoke) return;
        s.spoke = true;
        emit({ type: "USER_SPEECH_START" });
      };
      rec.onerror = (event) => onError(s, event.error);
      rec.onend = () => onEnd(s);
      try {
        rec.start();
      } catch {
        dispose(s, false);
        countMiss();
        return;
      }
      // 허용 창이 떠 있는 동안에는 onstart가 오지 않으므로 처음에는 길게 기다린다.
      s.startTimer = setTimeout(
        () => {
          if (s.done) return;
          dispose(s, true);
          countMiss();
        },
        startedOnce ? SPEECH_START_TIMEOUT_MS : SPEECH_FIRST_START_TIMEOUT_MS,
      );
    },

    hold() {
      if (closed) return;
      heldMode = true;
      const s = session;
      if (!s || s.done || s.mode === "holding") return;
      s.mode = "holding";
      s.heldBase = held;
      held = join(s.heldBase, s.final || s.interim);
      clearTimeout(s.startTimer);
      clearTimeout(s.listenTimer);
      if (typeof s.rec.stop === "function") {
        // 끊는 중에 확정 글이 오면 onResult가 붙든 글을 고친다.
        try {
          s.rec.stop();
        } catch {
          dispose(s, true);
        }
      } else {
        dispose(s, true);
      }
    },

    submit() {
      if (closed) return;
      if (heldMode) {
        cancelSession(true);
        turnEnd(held);
        return;
      }
      const s = session;
      if (s && !s.done) {
        submitListening(s);
        return;
      }
      turnEnd(held);
    },

    cancelListen(discard) {
      if (closed) return;
      cancelSession(true);
      if (discard) {
        held = "";
        heldMode = false;
      }
    },

    respond(turn, history: LiveTurn[]) {
      if (closed) return;
      cancelPending();
      const controller = new AbortController();
      const req: Pending = {
        controller,
        finished: false,
        timer: setTimeout(() => {
          if (req.finished) return;
          req.finished = true;
          if (pending === req) pending = null;
          controller.abort();
          emit({ type: "FAILED", kind: "timeout" });
        }, CHAT_FETCH_TIMEOUT_MS),
      };
      pending = req;
      const settle = (e: EngineEvent) => {
        if (req.finished || closed) return;
        req.finished = true;
        clearTimeout(req.timer);
        if (pending === req) pending = null;
        emit(e);
      };
      // history에는 이번 말이 없다. 서버가 message를 한 번 붙인다(7.3절).
      const body = JSON.stringify({
        sessionId: cid,
        message: turn.text,
        history: history.slice(-HISTORY_SEND_MAX),
      });
      void (async () => {
        let res: Response;
        try {
          res = await doFetch({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
        } catch (err) {
          if (req.finished) return;
          const aborted = controller.signal.aborted || (err as { name?: string } | null)?.name === "AbortError";
          if (aborted) settle({ type: "FAILED", kind: "timeout" });
          else if (win.navigator?.onLine === false) settle({ type: "FAILED", kind: "offline" });
          else settle({ type: "FAILED", kind: "failed" });
          return;
        }
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (req.finished) return;
        const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        if (!res.ok) {
          const code = typeof obj.code === "string" ? obj.code : undefined;
          const kind = failKind(res.status, code);
          settle(
            kind === "rate_limited"
              ? { type: "FAILED", kind, retryAfterMs: retryAfterMs(res) }
              : { type: "FAILED", kind },
          );
          return;
        }
        const status = obj.status;
        if (typeof obj.reply !== "string" || !STATUSES.includes(status as LiveChatStatus)) {
          settle({ type: "FAILED", kind: "failed" });
          return;
        }
        settle({
          type: "TURN_RESULT",
          reply: obj.reply,
          status: status as LiveChatStatus,
          slots: readSlots(obj.slots),
        });
      })();
    },

    cancelResponse() {
      cancelPending();
    },

    toolResult() {},
    setRate() {},

    close() {
      if (closed) return;
      cancelSession(true);
      cancelPending();
      closed = true;
      listeners.clear();
      if (startSignal && onAbort) startSignal.removeEventListener("abort", onAbort);
    },

    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return engine;
}
