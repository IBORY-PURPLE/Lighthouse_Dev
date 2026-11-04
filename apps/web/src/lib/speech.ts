// 브라우저 음성 인식과 입력 상태 전환. TSD §6, §7.

export type InputMode = "speech" | "text";

/** 0블록 결과. 아이폰 시험에서 인식이 동작해 speech로 둔다. */
export const PRIMARY_INPUT: InputMode = "speech";
/**
 * 버튼 낭독이 인식에 섞이지 않게 기다리는 시간. 임시값이다.
 * 0블록에서 어느 버튼으로 시험했는지 확인되지 않아 안전한 쪽(1000)으로 뒀다.
 */
export const SPEECH_START_DELAY_MS = 1000;
/** start() 호출 뒤 이 시간 안에 start 이벤트가 없으면 입력창으로 간다. */
export const SPEECH_START_TIMEOUT_MS = 3000;
/** 듣기 시작 뒤 end 이벤트가 끝내 오지 않아도 버튼이 멈춰 있지 않게 끊는 시간. */
export const SPEECH_LISTEN_TIMEOUT_MS = 15_000;
/** no-speech, nomatch가 연속 이 횟수면 입력창으로 간다. */
export const MAX_CONSECUTIVE_MISSES = 2;

export const STATUS = {
  listening: "듣고 있습니다. 말씀하세요.",
  heard: (transcript: string) => `이렇게 들었습니다: ${transcript}`,
  fallback: "음성 인식을 쓸 수 없습니다. 입력창에 받아쓰기로 입력하세요.",
  missed: "못 들었습니다. 버튼을 눌러 다시 말씀하세요.",
  matching: "봉사자를 찾고 있습니다.",
  emptyText: "입력창에 찾는 상품을 입력하세요.",
} as const;

/** 입력창으로 바로 가는 오류. 그 밖의 오류는 못 들은 것으로 친다. */
const UNAVAILABLE_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "network",
]);

export type InputState =
  | "idle"
  | "starting"
  | "listening"
  | "confirming"
  | "submitting"
  | "text";

export interface SpeechInputModel {
  state: InputState;
  transcript: string;
  misses: number;
  status: string;
  /** 음성 실패로 입력창에 왔는지. 처음부터 입력창이면 초점을 옮기지 않는다. */
  fellBack: boolean;
  /** 제출한 문장. 3블록의 /api/match가 쓴다. */
  submitted: string;
}

export type SpeechInputAction =
  | { type: "press" }
  | { type: "listening" }
  | { type: "result"; transcript: string }
  | { type: "miss" }
  | { type: "unavailable" }
  | { type: "submit"; text: string }
  | { type: "emptyText" };

export function createInitialModel(mode: InputMode): SpeechInputModel {
  return {
    state: mode === "text" ? "text" : "idle",
    transcript: "",
    misses: 0,
    status: "",
    fellBack: false,
    submitted: "",
  };
}

export function speechInputReducer(
  model: SpeechInputModel,
  action: SpeechInputAction,
): SpeechInputModel {
  switch (action.type) {
    case "press":
      return { ...model, state: "starting", transcript: "", status: "" };
    case "listening":
      return { ...model, state: "listening", status: STATUS.listening };
    case "result":
      return {
        ...model,
        state: "confirming",
        transcript: action.transcript,
        misses: 0,
        status: STATUS.heard(action.transcript),
      };
    case "miss": {
      const misses = model.misses + 1;
      return misses >= MAX_CONSECUTIVE_MISSES
        ? fallBack({ ...model, misses })
        : { ...model, state: "idle", misses, status: STATUS.missed };
    }
    case "unavailable":
      return fallBack(model);
    case "submit":
      return {
        ...model,
        state: "submitting",
        submitted: action.text,
        status: STATUS.matching,
      };
    case "emptyText":
      return { ...model, status: STATUS.emptyText };
  }
}

function fallBack(model: SpeechInputModel): SpeechInputModel {
  return { ...model, state: "text", fellBack: true, status: STATUS.fallback };
}

interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

export function getSpeechRecognitionCtor(
  win: object,
): SpeechRecognitionCtor | null {
  const { SpeechRecognition, webkitSpeechRecognition } = win as SpeechWindow;
  return SpeechRecognition ?? webkitSpeechRecognition ?? null;
}

export interface RecognitionHandlers {
  onListening(): void;
  onResult(transcript: string): void;
  onMiss(): void;
  onUnavailable(): void;
}

/**
 * 인식을 한 번 돌린다. 핸들러 중 onResult, onMiss, onUnavailable은 정확히 한 번만
 * 부른다. 돌려주는 함수를 부르면 조용히 취소한다.
 */
export function startRecognition(
  Ctor: SpeechRecognitionCtor,
  handlers: RecognitionHandlers,
  delayMs: number = SPEECH_START_DELAY_MS,
): () => void {
  let recognition: SpeechRecognitionLike | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let latest = "";

  const finish = (outcome: () => void) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    }
    outcome();
  };

  const giveUp = (outcome: () => void) =>
    finish(() => {
      recognition?.abort();
      outcome();
    });

  // 일부 브라우저는 interimResults=false여도 최종이 아닌 결과를 줘서 마지막 값을 들고 있다.
  const deliverHeard = () =>
    latest ? handlers.onResult(latest) : handlers.onMiss();

  const begin = () => {
    const instance = new Ctor();
    recognition = instance;
    instance.lang = "ko-KR";
    instance.continuous = false;
    instance.interimResults = false;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      clearTimeout(timer);
      handlers.onListening();
      timer = setTimeout(() => giveUp(deliverHeard), SPEECH_LISTEN_TIMEOUT_MS);
    };
    instance.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      latest = last?.[0]?.transcript.trim() ?? "";
      if (last?.isFinal) finish(deliverHeard);
    };
    instance.onerror = (event) => {
      finish(
        UNAVAILABLE_ERRORS.has(event.error)
          ? handlers.onUnavailable
          : handlers.onMiss,
      );
    };
    instance.onend = () => finish(deliverHeard);

    try {
      instance.start();
    } catch {
      finish(handlers.onUnavailable);
      return;
    }
    timer = setTimeout(
      () => giveUp(handlers.onUnavailable),
      SPEECH_START_TIMEOUT_MS,
    );
  };

  if (delayMs > 0) {
    timer = setTimeout(begin, delayMs);
  } else {
    begin();
  }

  return () => giveUp(() => {});
}
