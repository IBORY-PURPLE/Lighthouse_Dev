"use client";

// /live 화면: 마크업, 큰 단추, 길게 누르기 표면, 글자 입력, 뒤로가기 기록(pushState). 설계서 4.1절, 5.3절, 8절, 9절, 14절, 22절.
// createLiveRunner를 useSyncExternalStore로 구독한다. 화면은 사건을 보내고 상태를 그리기만 한다.
// 로그와 콘솔에 이용자 말, AI 답, SDP, 기기 ID, 상품명을 남기지 않는다.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { StatusRegion } from "@/components/StatusRegion";
import { BUTTONS, COMMAND_GUIDE, ENDED_HOME_SPEAKING } from "@/lib/liveCommands";
import { createEarconPlayer } from "@/lib/liveEarcons";
import type { EarconPlayer, EngineKind } from "@/lib/liveEngine";
import { createFallbackEngine } from "@/lib/liveFallbackEngine";
import { createHaptic } from "@/lib/liveHaptic";
import { GESTURE_IDLE, HOLD_MS, gestureStep, type GestureOutput, type GestureState } from "@/lib/liveGesture";
import { createInitialLive, type LiveEvent, type LiveState } from "@/lib/liveMachine";
import { createRealtimeEngine } from "@/lib/liveRealtimeEngine";
import {
  attachPushIfOn,
  registerLive,
  startDeviceReady,
} from "@/lib/liveRequest";
import { createLiveLog, forgetLiveLogLabel, readLiveLogLabel } from "@/lib/liveLog";
import { createLiveRunner, type LiveCaption, type LiveRunner } from "@/lib/liveRunner";
import { errorScriptFor, readVisits, script } from "@/lib/liveScripts";
import { createLiveSpeaker } from "@/lib/liveSpeaker";
import { decodeAiTurn } from "@/lib/liveText";
import { createWakeLock, newConversationId, runStartClick, setAudioSession } from "@/lib/liveUnlock";
import { getSpeechRecognitionCtor } from "@/lib/speech";
import styles from "@/app/live/live.module.css";

const WAIT_SOUND_KEY = "lh.live.waitSound.v1";
const CONTROLS = "button,a,input,textarea,select,label,summary";

/** 제목 바로 뒤에 늘 보이는 소개 글. 대화 중에도 바뀌지 않는다(화면 낭독기가 바뀐 글을 다시 읽지 않게). */
const LIVE_INTRO = "사고 싶은 제품의 혜택과 정보를 대신 찾아 드리는 음성 도우미예요.";
/** 화면에 들어오면 화면 낭독기가 한 번 읽는 알림. 브라우저는 첫 누름 전에 소리를 내지 못해 기기 목소리로는 읽지 않는다. */
const LIVE_INTRO_ALERT = `${LIVE_INTRO} ${BUTTONS.start} 단추를 누르면 시작해요.`;
const LIVE_INTRO_DELAY_MS = 700;

// ---------------------------------------------------------------- 상태 저장소(실행기를 화면에 잇는다)

const PLACEHOLDER: LiveState = createInitialLive({ cid: "", visit: "first", tts: false, speechAvailable: false });
const EMPTY_CAPTION: LiveCaption = { user: "", ai: "" };

/** 실행기는 마운트 뒤에 만들어진다. 그 전에는 서버와 같은 빈 상태를 보인다. */
function createStore() {
  let runner: LiveRunner | null = null;
  let unsub: () => void = () => {};
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getState: (): LiveState => (runner ? runner.getState() : PLACEHOLDER),
    getCaption: (): LiveCaption => (runner ? runner.getCaption() : EMPTY_CAPTION),
    getServerState: (): LiveState => PLACEHOLDER,
    getServerCaption: (): LiveCaption => EMPTY_CAPTION,
    attach(r: LiveRunner) {
      runner = r;
      unsub = r.subscribe(notify);
      notify();
    },
    detach() {
      unsub();
      unsub = () => {};
      runner = null;
      notify();
    },
  };
}

// "기다리는 동안 소리 내기" 체크 상자의 값. 기기 저장소가 막혀도 이 페이지 안에서는 값을 지킨다.
const waitListeners = new Set<() => void>();
let waitMemory = true;
function readWaitSound(): boolean {
  try {
    const saved = window.localStorage.getItem(WAIT_SOUND_KEY);
    if (saved !== null) return saved !== "off";
  } catch {
    // 저장소를 못 읽으면 이 페이지의 값을 쓴다.
  }
  return waitMemory;
}
function writeWaitSound(on: boolean): void {
  waitMemory = on;
  try {
    window.localStorage.setItem(WAIT_SOUND_KEY, on ? "on" : "off");
  } catch {
    // 저장이 막혀도 이 페이지에서는 바뀐다.
  }
  for (const l of [...waitListeners]) l();
}
const subscribeWait = (l: () => void) => {
  waitListeners.add(l);
  return () => {
    waitListeners.delete(l);
  };
};

/** 저장소를 못 쓸 때를 위한 메모리 저장소. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}
function pickStorage(win: Window): Storage {
  try {
    const s = win.localStorage;
    s.getItem(WAIT_SOUND_KEY);
    return s;
  } catch {
    return memoryStorage();
  }
}

// ---------------------------------------------------------------- 큰 단추와 글

type MainKind = "start" | "main" | "resume" | "retry" | "new" | "continue" | "home" | "none";
interface MainSpec { label: string; kind: MainKind; disabled: boolean }

const ACTIVE: ReadonlySet<string> = new Set(["guiding", "connecting", "listening", "thinking", "speaking", "confirming"]);
const GESTURE_PHASES: ReadonlySet<string> = new Set([
  "guiding", "connecting", "listening", "thinking", "speaking", "confirming", "paused",
]);

/** 접수 번호를 읽는 낭독 id. 읽는 동안에는 [새 요청]이 눌리지 않는다(상태 기계도 이 동안의 NEW_REQUEST를 무시한다). */
const REGISTERED_SPEAKING: ReadonlySet<string> = new Set(["registered", "registeredEnded", "registeredLate"]);

/** 5.3절 표의 "큰 단추" 열. 음성 모드는 guiding부터 confirming까지 이름이 '말하기' 하나다. */
function mainSpec(s: LiveState): MainSpec {
  // 접수 번호를 끝까지 듣기 전의 누름은 아무 일도 하지 않는다. 듣고 난 뒤의 Space·Enter가 새 요청이다.
  if (s.speaking !== null && REGISTERED_SPEAKING.has(s.speaking)) {
    return { label: BUTTONS.newRequest, kind: "none", disabled: true };
  }
  switch (s.phase) {
    case "idle":
      return { label: BUTTONS.start, kind: "start", disabled: false };
    case "registering":
      return { label: BUTTONS.sending, kind: "none", disabled: true };
    case "done":
      return { label: BUTTONS.newRequest, kind: "new", disabled: false };
    case "error":
      // 다시 시도해도 같은 결과인 오류(오늘 이용량 소진, 서버 설정 없음)는 대본이 단추를 가리키지 않는다. 처음 화면으로 보낸다.
      if (s.error === "unavailable_today" || s.error === "not_configured") {
        return { label: BUTTONS.home, kind: "home", disabled: false };
      }
      return s.error === "bad_request" || s.error === "register_rejected" || s.error === "register_conflict"
        ? { label: BUTTONS.newRequest, kind: "new", disabled: false }
        : { label: BUTTONS.retry, kind: "retry", disabled: false };
    case "paused":
      return { label: BUTTONS.resume, kind: "resume", disabled: false };
    case "ended":
      if (s.sendPending) return { label: BUTTONS.sending, kind: "none", disabled: true };
      if (s.requestId !== null) return { label: BUTTONS.newRequest, kind: "new", disabled: false };
      if (s.history.some((t) => t.role === "user")) return { label: BUTTONS.continueTalk, kind: "continue", disabled: false };
      return { label: BUTTONS.newRequest, kind: "new", disabled: false };
    default: {
      const text = s.inputMode === "text";
      // 연결하는 동안에는 큰 단추가 할 일이 없다. 눌리면 받지 못했다는 신호음만 낸다(activateMain).
      if (s.phase === "connecting") return { label: text ? BUTTONS.stopTalking : BUTTONS.talk, kind: "none", disabled: true };
      return {
        label: text ? BUTTONS.stopTalking : BUTTONS.talk,
        kind: "main",
        disabled: text && s.phase === "listening" && s.speaking === null,
      };
    }
  }
}

/** 큰 글자(상태 글). 5.3절 "화면 큰 글자" 열. 스크린리더 알림이 아니라 화면에 보이는 글이다. */
function headlineOf(s: LiveState, caption: LiveCaption): string {
  const text = s.inputMode === "text";
  switch (s.phase) {
    case "idle":
      return "대화를 시작하면 마이크 허용 창이 뜰 수 있어요. '허용'을 눌러 주세요.";
    case "guiding":
      return text
        ? `안내를 읽어 드리고 있어요. 건너뛰려면 '${BUTTONS.stopTalking}' 단추를 누르세요.`
        : `안내를 들려 드리고 있어요. 바로 말하려면 '${BUTTONS.talk}' 단추를 누르세요.`;
    case "connecting":
      return "연결하고 있어요";
    case "listening":
      if (text) return `아래 '${BUTTONS.textInput}' 칸에 쓰고 '${BUTTONS.sendText}' 단추를 누르세요.`;
      if (s.mic === "held") return "단추를 찾는 동안 잠시 듣기를 멈췄어요.";
      // 마이크가 닫혀 있거나 앱이 말하는 동안에는 '말씀하세요'라고 보이지 않는다. 띵 소리가 나야 듣는다.
      if (s.speaking !== null) {
        return s.speaking === "repeat" && s.lastReply !== "" ? s.lastReply : "안내를 들려 드리고 있어요. 띵 소리가 나면 말씀하세요.";
      }
      if (s.mic !== "on") return "잠시 뒤 띵 소리가 나면 말씀하세요.";
      return `말씀하세요. 다 말했으면 '${BUTTONS.talk}' 단추를 눌러도 돼요.`;
    case "thinking":
      return "생각하고 있어요";
    case "speaking":
      if (s.pendingConfirm && s.draft) return s.draft.summary;
      return caption.ai || s.lastReply || "말하고 있어요";
    case "confirming":
      if (text) return `보낼까요? 맞으면 '네'라고 쓰거나 '${BUTTONS.consent}' 단추를 누르세요.`;
      return s.speaking !== null || s.mic !== "on"
        ? "보낼까요? 띵 소리가 나면 '네'라고 말씀해 주세요."
        : "보낼까요? 맞으면 '네'라고 말씀해 주세요.";
    case "registering":
      return "보내고 있어요";
    case "done":
      return `접수 번호 ${s.queueNumber ?? ""}번`;
    case "error":
      return s.error ? script(errorScriptFor(s.error, s.aiFailures >= 3)) : "";
    case "paused":
      return "멈춰 있어요";
    case "ended":
      return "대화를 마쳤어요";
  }
}

/** 글을 바로 받을 수 있는 때. 글자 모드에서 AI 말을 읽는 중(요약 확인 제외)은 읽기를 끊고 받는다(상태 기계 TEXT_SUBMIT과 같은 조건). */
function canSubmitText(s: LiveState): boolean {
  return s.phase === "listening" || s.phase === "confirming" || (s.phase === "speaking" && s.inputMode === "text" && !s.pendingConfirm);
}

const RATE_LABEL = { normal: BUTTONS.rateNormal, slow: BUTTONS.rateSlow, fast: BUTTONS.rateFast } as const;

// ---------------------------------------------------------------- 화면

interface Ctx {
  runner: LiveRunner;
  earcons: EarconPlayer;
}

export function LiveConversation() {
  const router = useRouter();
  const [store] = useState(createStore);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getServerState);
  const caption = useSyncExternalStore(store.subscribe, store.getCaption, store.getServerCaption);
  const waitSound = useSyncExternalStore(subscribeWait, readWaitSound, () => true);

  const [statusText, setStatusText] = useState("");
  const [alertText, setAlertText] = useState("");
  const [typed, setTyped] = useState("");
  /** ? 단추로 여는 말 명령 안내. */
  const [guideOpen, setGuideOpen] = useState(false);
  const guideOpenRef = useRef(false);         // 초점 이동을 막을지 볼 때 쓴다(패널을 읽는 중에 큰 단추로 끌려가지 않게)
  const setGuide = useCallback((open: boolean) => {
    guideOpenRef.current = open;
    setGuideOpen(open);
  }, []);
  /** 처음 상태에서 소개 알림을 띄울 때가 됐는가. */
  const [introReady, setIntroReady] = useState(false);
  const goHomeRef = useRef(false);            // 말로 끝낸 뒤 마침 안내를 읽는 중인가
  /** 서버가 대화 기록을 받았다고 한 뒤의 표시(진행자 확인용). null이면 그리지 않는다. */
  const [logMark, setLogMark] = useState<{ label: string } | null>(null);

  const mainRef = useRef<HTMLButtonElement>(null);
  const listLinkRef = useRef<HTMLAnchorElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const pushedRef = useRef(false);            // 브라우저 기록에 우리 항목이 있는가(8.2절)
  const gestureRef = useRef<GestureState>(GESTURE_IDLE);
  const holdTimerRef = useRef<number | null>(null);
  const controlPressRef = useRef<{ at: number; mouse: boolean } | null>(null); // 큰 단추 밖 조작 요소를 누른 때(마우스인가, 언제)

  const send = useCallback((event: LiveEvent) => {
    ctxRef.current?.runner.dispatch(event);
  }, []);

  /** 대화를 시작하거나 다시 시작하는 click 안에서 한다: pushState → 신호음 잠금 해제 → audioSession → 사건(5.4절). */
  const startLike = useCallback((event: LiveEvent) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    pushedRef.current = runStartClick({
      pushed: pushedRef.current,
      pushState: () => window.history.pushState({ live: true }, ""),
      earcons: ctx.earcons,
      setAudioSession,
      dispatchStart: () => ctx.runner.dispatch(event),
    });
  }, []);

  /** 큰 단추를 누른 것과 같은 처리. 단추 click, 전역 Space·Enter, idle의 화면 탭이 모두 이 함수를 부른다(22절). */
  const activateMain = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const s = ctx.runner.getState();
    const spec = mainSpec(s);
    // 대화를 시작하거나 이어 가면 말 명령 안내를 닫는다(낭독기가 읽는 명령 낱말이 열린 마이크로 들어가지 않게).
    if (!spec.disabled && spec.kind !== "main" && spec.kind !== "none") setGuide(false);
    if (spec.disabled) {
      // 연결하는 동안의 누름은 받지 못했다는 신호음으로 알린다(눈을 감은 이용자가 눌렀는지 알게). 접수 번호를 읽는 중에는 읽는 소리가 이미 난다.
      if (s.phase === "connecting") void ctx.earcons.play("cancel");
      return;
    }
    switch (spec.kind) {
      case "start": startLike({ type: "START" }); return;
      case "resume": startLike({ type: "RESUME" }); return;
      case "retry": startLike({ type: "RETRY" }); return;
      case "continue": startLike({ type: "CONTINUE" }); return;
      case "new": startLike({ type: "NEW_REQUEST", cid: newConversationId() }); return;
      case "main": ctx.runner.dispatch({ type: "MAIN_BUTTON" }); return;
      case "home": router.push("/"); return;
      case "none": return;
    }
  }, [startLike, router, setGuide]);

  /** [끝내기]와 Escape: 기록에 우리 항목이 있으면 뒤로 가서 popstate가 EXIT를 보낸다. */
  const exitNow = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const phase = ctx.runner.getState().phase;
    if (phase === "idle" || phase === "ended") return;
    if (pushedRef.current) window.history.back();
    else ctx.runner.dispatch({ type: "EXIT" });
  }, []);

  // 마운트: 실행기를 만들고 문서 전체 사건을 잇는다.
  useEffect(() => {
    const win = window;
    const doc = document;
    const storage = pickStorage(win);
    const speaker = createLiveSpeaker(win);
    const rawEarcons = createEarconPlayer(doc, win);
    const haptic = createHaptic(win);
    // 말할 차례(띵)와 말이 넘어간 때에는 진동도 낸다. 신호음이 안 들릴 때가 있다.
    const earcons: EarconPlayer = {
      unlock: () => rawEarcons.unlock(),
      play: (name) => {
        if (name === "turn" || name === "confirm") haptic("turn");
        else if (name === "sent") haptic("sent");
        return rawEarcons.play(name);
      },
      startWait: () => rawEarcons.startWait(),
      stopWait: () => rawEarcons.stopWait(),
    };
    const wakeLock = createWakeLock();
    const focusLater = (get: () => HTMLElement | null) => {
      const el = get();
      if (el) el.focus();
      else queueMicrotask(() => get()?.focus());
    };

    // 대화 기록(QA 분석용): 참가자 표지는 주소 ?p=에서. 서버가 켜 줄 때(설정 응답의 log)만 보낸다.
    const deviceReady = startDeviceReady();
    const label = readLiveLogLabel(win.location.search, storage);
    const liveLog = createLiveLog({
      fetch: (input, init) => win.fetch(input, init),
      deviceReady,
      timers: {
        set: (fn, ms) => win.setTimeout(fn, ms),
        clear: (h) => win.clearTimeout(h as number),
      },
      now: () => Date.now(),
      label,
      onStored: () => setLogMark((cur) => cur ?? { label }),
      onStopped: () => setLogMark(null),
      onNotStored: () => setLogMark(null),
    });

    const runner = createLiveRunner(
      {
        createEngine: (kind: EngineKind) => (kind === "realtime" ? createRealtimeEngine() : createFallbackEngine(win)),
        speaker,
        earcons,
        timers: {
          set: (fn, ms) => win.setTimeout(fn, ms),
          clear: (h) => win.clearTimeout(h as number),
        },
        registerLive,
        deviceReady,
        storage,
        requestStream: async () => {
          try {
            if (!win.navigator.mediaDevices?.getUserMedia) return undefined;
            return await win.navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            return undefined;
          }
        },
        setAudioSession: (type) => setAudioSession(type),
        announce: (channel, text) => {
          const set = channel === "status" ? setStatusText : setAlertText;
          // 같은 글을 다시 알릴 때 빈 글을 먼저 그려야 낭독기가 다시 읽는다.
          if (text === "") flushSync(() => set(""));
          else set(text);
        },
        focus: (target) => {
          if (target === "main") {
            // 말 명령 안내를 읽는 중에는 초점을 큰 단추로 옮기지 않는다.
            if (!guideOpenRef.current) focusLater(() => mainRef.current);
          }
          else if (target === "listLink") focusLater(() => listLinkRef.current);
          else focusLater(() => textRef.current);
        },
        wakeLock,
        waitSoundOn: readWaitSound,
        attachPush: (id) => { void attachPushIfOn(id, win); },
        record: (e, s, fx) => liveLog.record(e, s, fx),
      },
      createInitialLive({
        cid: newConversationId(),
        visit: readVisits(storage) > 0 ? "returning" : "first",
        tts: speaker.available,
        speechAvailable: getSpeechRecognitionCtor(win) !== null,
      }),
    );
    ctxRef.current = { runner, earcons };
    store.attach(runner);
    mainRef.current?.focus(); // 22절 1: 열리면 큰 단추에 초점이 있다.

    let cancelled = false;
    void fetch("/api/live/config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ realtime?: unknown; advance?: unknown; log?: unknown } | null>) : null))
      .then((data) => {
        if (cancelled) return;
        liveLog.setMode(data?.log === "all" ? "all" : data?.log === "label" ? "label" : null);
        // 서버가 200으로 답했는데 log가 없으면 기록이 꺼졌거나 기간이 끝난 것이다. 기억해 둔 표지를 지운다(네트워크 실패·200이 아닌 응답에서는 지우지 않는다).
        if (data && typeof data === "object" && data.log !== "all" && data.log !== "label") forgetLiveLogLabel(storage);
        if (data) runner.dispatch({ type: "CONFIG", realtime: data.realtime === true, ...(data.advance === "manual" ? { advance: "manual" as const } : {}) });
      })
      .catch(() => {
        if (!cancelled) liveLog.setMode(null);
      });

    const onPopState = () => {
      pushedRef.current = false;
      runner.dispatch({ type: "EXIT" });
    };
    const onVisibility = () => {
      runner.dispatch({ type: doc.visibilityState === "hidden" ? "HIDDEN" : "VISIBLE" });
      if (doc.visibilityState === "hidden") liveLog.flush(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exitNow();
        return;
      }
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target;
      // 접수가 끝난 뒤 초점이 [요청 목록 보기] 링크로 가 있어도 Space는 큰 단추([새 요청])다. Enter는 링크를 연다(그대로).
      if (e.key === " " && target !== null && target === listLinkRef.current) {
        e.preventDefault();
        if (!e.repeat) activateMain();
        return;
      }
      // 초점이 입력·단추·링크에 있으면 그 요소의 기본 동작에 맡긴다(큰 단추의 click과 두 번 처리하지 않는다).
      if (target instanceof Element && target.closest("textarea,input,select,button,a,[contenteditable]")) return;
      e.preventDefault(); // 스크롤을 막는다.
      if (e.repeat) return;
      activateMain();
    };
    const onPageHide = () => {
      liveLog.flush(true);
      runner.dispose();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // 뒤로 가기 캐시에서 되살아나면 실행기가 닫힌 상태라 새로 불러온다.
      if (e.persisted) win.location.reload();
    };

    win.addEventListener("popstate", onPopState);
    doc.addEventListener("visibilitychange", onVisibility);
    doc.addEventListener("keydown", onKeyDown);
    win.addEventListener("pagehide", onPageHide);
    win.addEventListener("beforeunload", onPageHide);
    win.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      win.removeEventListener("popstate", onPopState);
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("beforeunload", onPageHide);
      win.removeEventListener("pageshow", onPageShow);
      if (holdTimerRef.current !== null) win.clearTimeout(holdTimerRef.current);
      store.detach();
      ctxRef.current = null;
      liveLog.flush(true);
      liveLog.dispose();
      runner.dispose();
    };
  }, [store, activateMain, exitNow]);

  // 들어오면 화면 낭독기가 소개를 한 번 읽는다. 알림 칸은 화면이 뜬 뒤에 글이 들어와야 읽히므로 잠깐 뒤에 채운다.
  useEffect(() => {
    const timer = window.setTimeout(() => setIntroReady(true), LIVE_INTRO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // 말로 끝냈으면("끝내 줘" → "네") 마침 안내를 다 읽은 뒤 /live 처음 상태로 돌아간다.
  useEffect(() => {
    if (state.phase !== "ended") {
      goHomeRef.current = false;
      return;
    }
    if (state.speaking !== null) {
      if (ENDED_HOME_SPEAKING.has(state.speaking)) goHomeRef.current = true;
      return;
    }
    if (!goHomeRef.current) return;
    goHomeRef.current = false;
    window.location.replace(`${window.location.pathname}${window.location.search}`);
  }, [state.phase, state.speaking]);

  /** ? 단추: 말 명령 안내를 열고 닫는다. 대화 중에 열면 대화를 멈춘다(낭독기가 읽는 명령 낱말이 마이크로 들어가지 않게). */
  const toggleGuide = () => {
    // 대화가 이어지는 동안에는 안내가 보이지 않는다(guideShown). 그때의 누름은 여는 것이다.
    const shown = guideOpen && !ACTIVE.has(state.phase);
    const next = !shown;
    setGuide(next);
    if (!next) return;
    const ctx = ctxRef.current;
    if (ctx && ACTIVE.has(ctx.runner.getState().phase)) ctx.runner.dispatch({ type: "PAUSE" });
  };

  // ---------- 길게 누르기(8.1절) ----------

  const applyGesture = useCallback((out: GestureOutput) => {
    const ctx = ctxRef.current;
    if (!ctx || out === "none" || out === "latch") return;
    if (out === "activate") {
      setGuide(false); // 길게 눌러 이어 갈 때도 말 명령 안내를 닫는다
      // 다시 시작하는 길(멈춤에서 이어 가기)도 소리를 낼 수 있게 신호음과 audioSession을 준비한다.
      ctx.earcons.unlock();
      setAudioSession("playback");
      ctx.runner.dispatch({ type: "HOLD_ACTIVATE" });
    } else if (out === "submit") ctx.runner.dispatch({ type: "HOLD_SUBMIT" });
    else ctx.runner.dispatch({ type: "HOLD_CANCEL" });
  }, [setGuide]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const s = ctx.runner.getState();
    const target = e.target instanceof Element ? e.target : null;
    const control = target?.closest(CONTROLS) ?? null;
    const onMain = control !== null && mainRef.current !== null && mainRef.current.contains(control);

    // 큰 단추 밖 조작 요소를 마우스로 눌렀는지 적어 둔다. click에서 초점을 큰 단추로 되돌리고, 길게 누른 click은 버린다(onClickCapture).
    controlPressRef.current = control && !onMain ? { at: performance.now(), mouse: e.pointerType === "mouse" && e.button === 0 } : null;

    // 듣는 중 큰 단추가 아닌 단추·링크·입력 칸에 닿으면 마이크를 잠시 닫는다(8.2절 단추 찾기).
    if (control && !onMain && target?.closest("button,a,input,textarea,select")) send({ type: "CONTROL_TOUCH" });

    if (!GESTURE_PHASES.has(s.phase) || s.inputMode === "text") return; // 글자 모드와 그 밖의 상태에서는 판정기를 돌리지 않는다.
    const t = performance.now();
    const primary = e.isPrimary && (e.pointerType !== "mouse" || e.button === 0);
    const onControl = control !== null && !onMain;
    const r = gestureStep(gestureRef.current, { type: "down", id: e.pointerId, x: e.clientX, y: e.clientY, t, primary, onControl });
    gestureRef.current = r.state;
    if (r.state.phase === "pressing" && holdTimerRef.current === null) {
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        const tick = gestureStep(gestureRef.current, { type: "tick", t: performance.now() });
        gestureRef.current = tick.state;
        applyGesture(tick.out);
      }, HOLD_MS);
    }
    applyGesture(r.out);
  };

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (gestureRef.current.phase === "idle") return;
    const r = gestureStep(gestureRef.current, { type: "move", id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });
    gestureRef.current = r.state;
    if (r.state.phase === "idle") clearHoldTimer();
    applyGesture(r.out);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLElement>, kind: "up" | "cancel") => {
    if (gestureRef.current.phase === "idle") return;
    const r = gestureStep(gestureRef.current, { type: kind, id: e.pointerId, t: performance.now() });
    gestureRef.current = r.state;
    clearHoldTimer();
    applyGesture(r.out);
  };

  // ---------- 그 밖의 사건 ----------

  const onMainClick = () => {
    // 길게 눌러 발동한 누름에서 이어 오는 click은 버린다.
    if (performance.now() < gestureRef.current.suppressClickUntil) return;
    activateMain();
  };

  /**
   * 마우스로 작은 단추(·링크·체크 상자)를 누른 뒤에는 초점을 큰 단추로 되돌린다. 안 그러면 이어지는 Space가 그 작은 단추를 다시 누른다.
   * 600ms 넘게 누른 click은 "화면을 길게 눌러 말하기"를 하려던 것이므로 그 단추를 실행하지 않고 신호음만 낸다.
   * 터치·키보드·화면 낭독기로 누른 경우는 건드리지 않는다(낭독기가 단추 이름을 읽어 마이크에 들어가는 일을 막으려고 초점을 옮기지 않는다).
   */
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    const press = controlPressRef.current;
    controlPressRef.current = null;
    const ctx = ctxRef.current;
    if (!press || !press.mouse || e.detail === 0 || !ctx) return;
    const s = ctx.runner.getState();
    if (!GESTURE_PHASES.has(s.phase) || s.inputMode === "text") return;
    if (performance.now() - press.at >= HOLD_MS) {
      e.preventDefault(); // label이면 체크 상자도 바뀌지 않는다
      e.stopPropagation(); // 단추의 onClick까지 가지 않는다
      void ctx.earcons.play("cancel");
    }
    mainRef.current?.focus();
    // label의 기본 동작(체크 상자에 초점)이 끝난 뒤에 한 번 더 큰 단추로 보낸다.
    window.setTimeout(() => mainRef.current?.focus(), 0);
  };

  /** 연결하는 동안은 멈춤만 된다. 나머지 작은 단추의 누름은 받지 못했다는 신호음으로 알린다. */
  const sendSmall = (event: LiveEvent) => {
    const ctx = ctxRef.current;
    if (ctx && ctx.runner.getState().phase === "connecting" && event.type !== "PAUSE") {
      void ctx.earcons.play("cancel");
      return;
    }
    send(event);
  };

  const onSurfaceClick = (e: SyntheticEvent<HTMLElement>) => {
    // idle에서만 화면 아무 곳이나 짧게 눌러 시작한다. 단추·링크·입력 칸 위의 click은 그 요소의 것이다(22절 3).
    if (ctxRef.current?.runner.getState().phase !== "idle") return;
    if (e.target instanceof Element && e.target.closest(`${CONTROLS},[data-live-guide]`)) return;
    // 낭독기 초점이 바뀌는 글 위에 남지 않게 큰 단추로 옮긴 뒤 시작한다.
    mainRef.current?.focus();
    activateMain();
  };

  const onFocusIn = (e: SyntheticEvent<HTMLElement>) => {
    const target = e.target instanceof Element ? e.target : null;
    const control = target?.closest("button,a,input,textarea,select") ?? null;
    if (!control) return;
    if (mainRef.current && mainRef.current.contains(control)) return;
    send({ type: "CONTROL_TOUCH" });
  };

  const submitText = () => {
    const ctx = ctxRef.current;
    const text = typed.trim();
    if (!ctx || text === "") return;
    if (!canSubmitText(ctx.runner.getState())) {
      // 받을 수 없는 때(안내·연결·답 기다림·요약 읽기)는 쓴 글을 칸에 그대로 두고, 상태 기계가 받지 못했다는 신호음을 낸다.
      ctx.runner.dispatch({ type: "TEXT_SUBMIT", text });
      return;
    }
    setTyped("");
    ctx.runner.dispatch({ type: "TEXT_SUBMIT", text });
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitText();
  };

  const onTextKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중의 Enter는 글자 확정이다. 조합이 끝난 Enter만 보낸다.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitText();
    }
  };

  // ---------- 그리기 ----------

  const spec = mainSpec(state);
  const active = ACTIVE.has(state.phase);
  const connectingNow = state.phase === "connecting";
  const showInput = active && state.inputMode === "text";
  const showCard = state.phase === "confirming" && state.draft !== null;
  const endedContinue = state.phase === "ended" && spec.kind === "continue";
  const homeLink = state.phase === "idle" || state.phase === "ended";
  const draft = state.draft;
  // 말 명령 안내는 대화가 멈춰 있을 때만 보인다. 대화 중(마이크가 열릴 수 있는 때)에는 DOM에 두지 않는다.
  const guideShown = guideOpen && !active;

  return (
    <main
      className={styles.root}
      data-live-surface=""
      data-live-state={state.phase}
      data-live-engine={state.engine ?? "none"}
      data-live-input={state.inputMode}
      data-live-mic={state.mic}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, "up")}
      onPointerCancel={(e) => onPointerEnd(e, "cancel")}
      onClickCapture={onClickCapture}
      onClick={onSurfaceClick}
      onFocus={onFocusIn}
      onContextMenu={(e) => {
        if (!(e.target instanceof Element && e.target.closest("textarea,input"))) e.preventDefault();
      }}
    >
      <h1 className={styles.title}>음성 도우미</h1>
      <p className={styles.intro}>{LIVE_INTRO}</p>
      {/* 대화 중의 큰 글자는 말마다 바뀐다. 화면 낭독기에는 바뀌지 않는 '대화 중'만 보여 준다(바뀐 글을 읽는 소리가 AI 목소리와 겹치지 않게). */}
      <p className={styles.headline}>
        <span aria-hidden={active ? "true" : undefined}>{headlineOf(state, caption)}</span>
        {active ? <span className={styles.srOnly}>대화 중</span> : null}
      </p>
      {state.phase === "listening" && caption.user !== "" ? <p className={styles.caption} aria-hidden="true">{caption.user}</p> : null}

      <button
        ref={mainRef}
        type="button"
        className={styles.main}
        aria-disabled={spec.disabled ? "true" : undefined}
        onClick={onMainClick}
      >
        {/* 음성 모션(오브). 장식이라 낭독기에는 숨긴다. 단추 이름은 뒤의 글자다. */}
        <span className={styles.orb} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className={styles.mainLabel}>{spec.label}</span>
      </button>

      <button
        type="button"
        className={styles.help}
        aria-label={BUTTONS.commands}
        aria-expanded={guideShown}
        onClick={toggleGuide}
      >
        ?
      </button>
      {guideShown ? (
        <section className={styles.guide} data-live-guide="" aria-label="말 명령어">
          <h2>말 명령어</h2>
          <p>띵 소리가 난 뒤에 이 말만 따로 하면 돼요. 도우미가 말하는 동안에는 {BUTTONS.talk} 단추를 눌러 끊을 수 있어요.</p>
          <ul>
            {COMMAND_GUIDE.map((g) => (
              <li key={g.say}><strong>{g.say}</strong> {g.does}</li>
            ))}
          </ul>
          <button type="button" className={styles.small} onClick={() => setGuide(false)}>{BUTTONS.closeCommands}</button>
        </section>
      ) : null}

      {showInput ? (
        <form className={styles.form} onSubmit={onFormSubmit}>
          <label htmlFor="live-text">{BUTTONS.textInput}</label>
          <textarea
            id="live-text"
            ref={textRef}
            className={styles.input}
            maxLength={1000}
            enterKeyHint="send"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={onTextKeyDown}
          />
          <button type="submit" className={styles.small} aria-disabled={canSubmitText(state) ? undefined : "true"}>{BUTTONS.sendText}</button>
        </form>
      ) : null}

      {showCard && draft ? (
        <section className={styles.card} aria-label="요청 요약">
          <h2>요청 요약</h2>
          <dl>
            {draft.product ? (<><dt>제품</dt><dd>{draft.product}</dd></>) : null}
            {draft.info ? (<><dt>알고 싶은 정보</dt><dd>{draft.info}</dd></>) : null}
            {draft.options ? (<><dt>옵션</dt><dd>{draft.options}</dd></>) : null}
            {draft.budget ? (<><dt>예산</dt><dd>{draft.budget}</dd></>) : null}
          </dl>
          <div className={styles.row}>
            <button type="button" className={styles.small} onClick={() => send({ type: "CONSENT_BUTTON" })}>
              {BUTTONS.consent}
            </button>
            <button type="button" className={styles.small} onClick={() => send({ type: "EDIT_BUTTON" })}>
              {BUTTONS.edit}
            </button>
          </div>
        </section>
      ) : null}

      {active ? (
        <div className={styles.row}>
          <button type="button" className={styles.small} aria-disabled={connectingNow ? "true" : undefined} onClick={() => sendSmall({ type: "REPEAT" })}>{BUTTONS.repeat}</button>
          <button type="button" className={styles.small} onClick={() => sendSmall({ type: "PAUSE" })}>{BUTTONS.pause}</button>
          <button type="button" className={styles.small} aria-disabled={connectingNow ? "true" : undefined} onClick={() => sendSmall({ type: "HELP" })}>{BUTTONS.help}</button>
          <button type="button" className={styles.small} aria-disabled={connectingNow ? "true" : undefined} onClick={() => sendSmall({ type: "RATE_BUTTON" })}>
            {RATE_LABEL[state.rate]}
          </button>
        </div>
      ) : null}

      {state.phase === "done" && state.requestId ? (
        <div className={styles.row}>
          <a
            ref={listLinkRef}
            className={styles.link}
            href={`/?request=${encodeURIComponent(state.requestId)}`}
          >
            {BUTTONS.list}
          </a>
        </div>
      ) : null}

      {endedContinue ? (
        <div className={styles.row}>
          <button
            type="button"
            className={styles.small}
            onClick={() => {
              setGuide(false);
              startLike({ type: "NEW_REQUEST", cid: newConversationId() });
            }}
          >
            {BUTTONS.newRequest}
          </button>
        </div>
      ) : null}

      <label className={styles.wait}>
        <input type="checkbox" checked={waitSound} onChange={(e) => writeWaitSound(e.target.checked)} />
        {BUTTONS.waitSound}
      </label>

      <div className={styles.log} role="log" aria-live="off" aria-label="대화 기록">
        {state.history.map((turn, i) => {
          if (turn.role === "user") {
            return <p key={i} className={styles.me}><strong>나</strong>{turn.content}</p>;
          }
          const ai = decodeAiTurn(turn.content);
          return <p key={i}><strong>도우미</strong>{ai ? ai.reply : turn.content}</p>;
        })}
      </div>

      {homeLink ? (
        <a className={styles.link} href="/">{BUTTONS.home}</a>
      ) : (
        <button type="button" className={styles.small} onClick={exitNow}>{BUTTONS.exit}</button>
      )}

      {logMark ? (
        <p className={styles.logMark} data-testid="live-log-mark">
          {logMark.label !== "" ? `기록 중 · ${logMark.label}` : "기록 중"}
        </p>
      ) : null}

      <div className={styles.srOnly}>
        <StatusRegion quiet message={statusText} />
        <p role="alert">{alertText !== "" ? alertText : state.phase === "idle" && introReady ? LIVE_INTRO_ALERT : ""}</p>
      </div>
    </main>
  );
}
