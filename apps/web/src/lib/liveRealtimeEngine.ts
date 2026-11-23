// /live Realtime 엔진: WebRTC 연결, 데이터 채널, 타이머만 다룬다. 설계서 6.3절, 7.4절(call), 7.6절(hangup).
// 무엇을 보내고 무엇을 낼지는 liveRealtimeEvents.ts의 순수 함수가 정한다. 이 파일은 그 결과를 실행한다.
// 로그와 콘솔에 이용자 말, AI 답, SDP, 기기 ID를 남기지 않는다(꼬리표만).
import type { EngineEvent, EngineStartContext, LiveEngine } from "@/lib/liveEngine";
import {
  createRealtimeTracker, realtimeOp, realtimeStep, realtimeTranscriptTimeout,
  type EngineOp, type RealtimeAction, type RealtimeResult, type RealtimeTracker,
} from "@/lib/liveRealtimeEvents";
import { REALTIME_OPEN_TIMEOUT_MS, REALTIME_TURN_MAX_MS } from "@/lib/liveTiming";

const DISCONNECT_GRACE_MS = 5_000;   // disconnected가 이만큼 이어지면 끊긴 것으로 본다(6.3절 8번)
const CALL_PATH = "/api/live/call";
const HANGUP_PATH = "/api/live/hangup";

/** 시험에서 바꿔 끼울 수 있는 바깥 의존. 기본은 브라우저 것이다. */
export interface RealtimeEngineDeps {
  fetchFn?: typeof fetch;
  createPeer?: () => RTCPeerConnection;
  createAudio?: () => HTMLAudioElement;
}

interface CallInfo { sdp: string; callId: string; maxSessionSec: number; warnBeforeSec: number; maxTurns: number }

function positive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function createRealtimeEngine(deps: RealtimeEngineDeps = {}): LiveEngine {
  const fetchFn = deps.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const listeners = new Set<(e: EngineEvent) => void>();

  let tracker: RealtimeTracker = createRealtimeTracker(0);
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let stream: MediaStream | undefined;
  let callId = "";
  let started = false;
  let ready = false;
  let closed = false;
  let abortListener: (() => void) | null = null;
  let abortSignal: AbortSignal | null = null;
  let sessionWarnTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionEndTimer: ReturnType<typeof setTimeout> | null = null;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let transcriptTimer: ReturnType<typeof setTimeout> | null = null;
  let turnCapTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(e: EngineEvent): void {
    for (const l of [...listeners]) {
      try {
        l(e);
      } catch {
        // 듣는 쪽의 오류가 엔진을 멈추지 않게 한다.
      }
    }
  }

  function clearTimers(): void {
    for (const t of [sessionWarnTimer, sessionEndTimer, disconnectTimer, transcriptTimer, turnCapTimer]) {
      if (t !== null) clearTimeout(t);
    }
    sessionWarnTimer = sessionEndTimer = disconnectTimer = transcriptTimer = turnCapTimer = null;
  }

  /** 여러 번 불러도 안전. 통화를 만들었으면 hangup을 한 번 보낸다. */
  function close(): void {
    if (closed) return;
    closed = true;
    clearTimers();
    if (abortSignal && abortListener) abortSignal.removeEventListener("abort", abortListener);
    abortListener = null;
    try { dc?.close(); } catch { /* 이미 닫힘 */ }
    try { pc?.close(); } catch { /* 이미 닫힘 */ }
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* 이미 멈춤 */ }
    if (audioEl) {
      try { audioEl.pause(); audioEl.srcObject = null; } catch { /* 요소가 이미 정리됨 */ }
    }
    if (callId) {
      const body = JSON.stringify({ callId, turns: tracker.turnsSent });
      try {
        void Promise.resolve(fetchFn(HANGUP_PATH, {
          method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body,
        })).catch(() => undefined);
      } catch {
        // 보내지 못해도 서버 예약 끊기가 정리한다(7.4절).
      }
    }
  }

  /** 먼저 닫고 LOST를 낸다. 이미 닫혔으면 아무것도 하지 않는다(LOST는 한 번만). */
  function lost(reason: Extract<EngineEvent, { type: "LOST" }>["reason"], detail?: string): void {
    if (closed) return;
    close();
    emit(detail === undefined ? { type: "LOST", reason } : { type: "LOST", reason, detail });
  }

  function send(body: object): void {
    if (!dc || dc.readyState !== "open") return;
    try {
      dc.send(JSON.stringify(body));
    } catch {
      // 보내기 실패는 연결 감시가 잡는다.
    }
  }

  function setMic(on: boolean): void {
    try {
      stream?.getAudioTracks().forEach((t) => { t.enabled = on; });
    } catch {
      // 트랙이 이미 멈춤
    }
  }

  function applyResult(res: RealtimeResult): void {
    tracker = res.tracker;
    for (const a of res.actions) applyAction(a);
  }

  function applyAction(a: RealtimeAction): void {
    if ("send" in a) send(a.send);
    else if ("emit" in a) {
      // LOST(턴 상한 등)는 먼저 닫고 낸다(6.3절). lost()가 닫은 뒤 한 번만 알린다.
      if (a.emit.type === "LOST") lost(a.emit.reason, a.emit.detail);
      else emit(a.emit);
    } else if ("mic" in a) setMic(a.mic);
    else if ("waitTranscript" in a) {
      if (transcriptTimer !== null) clearTimeout(transcriptTimer);
      const { itemId, ms } = a.waitTranscript;
      transcriptTimer = setTimeout(() => {
        transcriptTimer = null;
        if (closed) return;
        applyResult(realtimeTranscriptTimeout(tracker, itemId));
      }, ms);
    } else if ("turnCap" in a) {
      if (turnCapTimer !== null) clearTimeout(turnCapTimer);
      turnCapTimer = null;
      if (a.turnCap) {
        turnCapTimer = setTimeout(() => {
          turnCapTimer = null;
          if (closed) return;
          applyOp({ op: "submit" });   // 말이 시작된 뒤 60초 동안 committed가 없으면 차례를 끝낸다
        }, REALTIME_TURN_MAX_MS);
      }
    } else if ("log" in a) {
      console.info(`live realtime ${a.log}`);
    }
  }

  function applyOp(op: EngineOp): void {
    if (closed) return;
    applyResult(realtimeOp(tracker, op));
  }

  function onMessage(ev: MessageEvent): void {
    if (closed || typeof ev.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    applyResult(realtimeStep(tracker, parsed));
  }

  /** 연결 단계를 지나기 전의 끊김은 connect, 지난 뒤는 network로 센다. */
  function lostByMonitor(): void {
    lost(ready ? "network" : "connect");
  }

  async function postOffer(sdp: string, rate: string, signal: AbortSignal): Promise<CallInfo | { fallback: string }> {
    const res = await fetchFn(`${CALL_PATH}?rate=${encodeURIComponent(rate)}`, {
      method: "POST", headers: { "Content-Type": "application/sdp" }, body: sdp, signal,
    });
    if (!res.ok) return { fallback: `http_${res.status}` };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { fallback: "bad_response" };
    }
    const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
    if (d.engine !== "realtime") return { fallback: typeof d.reason === "string" ? d.reason.slice(0, 40) : "unknown" };
    if (typeof d.sdp !== "string" || typeof d.callId !== "string" || !d.callId
      || !positive(d.maxSessionSec) || typeof d.warnBeforeSec !== "number" || !Number.isFinite(d.warnBeforeSec)
      || typeof d.maxTurns !== "number" || !Number.isFinite(d.maxTurns)) {
      return { fallback: "bad_response" };
    }
    return {
      sdp: d.sdp, callId: d.callId, maxSessionSec: d.maxSessionSec,
      warnBeforeSec: Math.max(0, d.warnBeforeSec), maxTurns: Math.max(0, Math.floor(d.maxTurns)),
    };
  }

  async function start(ctx: EngineStartContext): Promise<void> {
    if (started) return;
    started = true;
    abortSignal = ctx.signal;
    abortListener = () => close();     // 끊기면 스스로 닫는다. 통화를 만들었으면 hangup이 간다.
    if (ctx.signal.aborted) {
      close();
      return;
    }
    ctx.signal.addEventListener("abort", abortListener);

    if (!ctx.stream) {
      lost("connect");
      return;
    }
    stream = ctx.stream;

    try {
      const tracks = ctx.stream.getAudioTracks();
      pc = deps.createPeer ? deps.createPeer() : new RTCPeerConnection();
      for (const track of tracks) {
        track.enabled = false;         // 단추를 눌러 차례를 열 때 켠다
        pc.addTrack(track, ctx.stream);
      }
      const audio = deps.createAudio ? deps.createAudio() : document.createElement("audio");
      audio.autoplay = true;
      audioEl = audio;
      pc.ontrack = (e) => {
        const remote = e.streams[0];
        if (!remote || !audioEl) return;
        audioEl.srcObject = remote;
        void audioEl.play?.()?.catch?.(() => undefined);
      };
      pc.onconnectionstatechange = () => {
        if (closed || !pc) return;
        const state = pc.connectionState;
        if (state === "failed") {
          lostByMonitor();
        } else if (state === "disconnected") {
          if (disconnectTimer === null) {
            disconnectTimer = setTimeout(() => {
              disconnectTimer = null;
              if (!closed && pc && pc.connectionState === "disconnected") lostByMonitor();
            }, DISCONNECT_GRACE_MS);
          }
        } else if (disconnectTimer !== null) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      };

      const channel = pc.createDataChannel("oai-events");
      dc = channel;
      channel.onmessage = onMessage;
      channel.onclose = () => { if (!closed) lostByMonitor(); };
      const opened = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), REALTIME_OPEN_TIMEOUT_MS);
        channel.onopen = () => { clearTimeout(timer); resolve(true); };
        // 연결 시간 초과나 닫기로 끝나도 타이머가 남지 않게 한다.
        ctx.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(false); }, { once: true });
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (closed) return;
      const info = await postOffer(offer.sdp ?? "", ctx.rate, ctx.signal);
      if (closed) return;
      if ("fallback" in info) {
        lost("server_fallback", info.fallback);
        return;
      }
      callId = info.callId;
      tracker = createRealtimeTracker(info.maxTurns);
      await pc.setRemoteDescription({ type: "answer", sdp: info.sdp });
      if (closed) return;

      const isOpen = await opened;
      if (closed) return;
      if (!isOpen) {
        lost("connect");
        return;
      }

      ready = true;
      if (ctx.history.length > 0) applyOp({ op: "restore", history: ctx.history });
      if (closed) return;
      emit({ type: "READY", engine: "realtime", inputMode: "voice" });
      const endSec = info.maxSessionSec;
      const warnSec = Math.max(0, endSec - info.warnBeforeSec);
      sessionWarnTimer = setTimeout(() => { sessionWarnTimer = null; if (!closed) emit({ type: "SESSION_WARN" }); }, warnSec * 1000);
      sessionEndTimer = setTimeout(() => { sessionEndTimer = null; lost("session_limit"); }, endSec * 1000);
    } catch {
      // 취소(abort)로 끝난 경우는 이미 닫혀 있어 조용히 넘어간다.
      lost("connect");
    }
  }

  return {
    kind: "realtime",
    start,
    listen: (opts) => applyOp({ op: "listen", keep: opts?.keep === true }),
    hold: () => applyOp({ op: "hold" }),
    submit: () => applyOp({ op: "submit" }),
    cancelListen: (discard) => applyOp({ op: "cancelListen", discard }),
    respond: (turn) => applyOp({ op: "respond", text: turn.text, source: turn.source }),
    cancelResponse: () => applyOp({ op: "cancelResponse" }),
    toolResult: (id, output, respond) => applyOp({ op: "toolResult", callId: id, output, respond }),
    setRate: (rate) => applyOp({ op: "setRate", rate }),
    close,
    on(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
