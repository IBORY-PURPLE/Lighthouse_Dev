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
  connected: (volunteer: string) => `${volunteer}와 연결됐습니다.`,
  needItem: "찾는 상품을 알아듣지 못했습니다. 상품 이름을 넣어 다시 요청하세요.",
  tooLong: "요청이 너무 깁니다. 짧게 다시 요청하세요.",
  noAccess: "접근 코드가 필요합니다. 시연 주소로 다시 열어 주세요.",
  tooMany: "요청이 많습니다. 1분 뒤 다시 시도해 주세요.",
  matchFailed: "봉사자 연결에 실패했습니다. 다시 시도해 주세요.",
  emptyQuestion: "입력창에 질문을 입력하세요.",
  chatWaiting: "답변을 만들고 있습니다.",
  chatArrived: "답변이 도착했습니다.",
  questionTooLong: "질문이 너무 깁니다. 짧게 다시 말해 주세요.",
  chatFailed: "답변 서버에 연결하지 못했습니다. 다시 시도해 주세요.",
  chatNotConfigured: "챗봇 설정이 끝나지 않았습니다.",
  typedBack: (text: string) => `입력한 내용: ${text}`,
  needProduct:
    "어떤 제품인지 알아듣지 못했습니다. 제품 이름을 넣어 다시 말씀하세요.",
  answerTooLong: "답이 너무 깁니다. 짧게 다시 말씀하세요.",
  summary: (product: string, budget: string, condition: string) =>
    `요청 내용입니다. 제품 ${product}. 예산 ${budget}. ${condition}. 맞으면 봉사자 매칭 요청 버튼을 누르세요.`,
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
  | "text"
  | "matched";

export interface SpeechInputModel {
  state: InputState;
  transcript: string;
  misses: number;
  status: string;
  /** 음성 실패로 입력창에 왔는지. 처음부터 입력창이면 초점을 옮기지 않는다. */
  fellBack: boolean;
  /** 제출한 문장. */
  submitted: string;
  /** 매칭이 안 됐을 때 초점을 보낼 곳. reenter는 새 입력, resend는 같은 문장 다시 보내기. */
  refocus: "reenter" | "resend" | null;
}

export type SpeechInputAction =
  | { type: "press" }
  | { type: "listening" }
  | { type: "result"; transcript: string }
  | { type: "miss" }
  | { type: "unavailable" }
  | { type: "submit"; text: string; status?: string }
  | { type: "emptyText"; status?: string }
  | { type: "matched"; volunteerName: string }
  /** 봉사자 화면: 답변을 받았다. 초점은 답변 영역으로 가므로 입력 쪽에서 옮기지 않는다. */
  | { type: "answered"; status: string }
  | { type: "matchRejected"; status: string }
  | { type: "matchFailed"; status: string }
  /** 이용자 질문 흐름: 질문이 바뀌면 새 질문의 시작 방식으로 처음부터. */
  | { type: "reset"; mode: InputMode }
  /** 입력창 답도 바로 보내지 않고 확인 단계를 거친다. */
  | { type: "typed"; text: string }
  /** 입력창 답 확인에서 "다시 입력". */
  | { type: "reenter" };

export function createInitialModel(mode: InputMode): SpeechInputModel {
  return {
    state: mode === "text" ? "text" : "idle",
    transcript: "",
    misses: 0,
    status: "",
    fellBack: false,
    submitted: "",
    refocus: null,
  };
}

export function speechInputReducer(
  model: SpeechInputModel,
  action: SpeechInputAction,
): SpeechInputModel {
  switch (action.type) {
    case "press":
      return {
        ...model,
        state: "starting",
        transcript: "",
        status: "",
        refocus: null,
      };
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
      // 입력창으로 시작한 질문에서 같은 안내를 다시 읽지 않는다.
      return model.state === "text" && model.fellBack ? model : fallBack(model);
    case "submit":
      return {
        ...model,
        state: "submitting",
        submitted: action.text,
        status: action.status ?? STATUS.matching,
        refocus: null,
      };
    case "emptyText":
      return { ...model, status: action.status ?? STATUS.emptyText };
    case "answered":
      return {
        ...model,
        state: model.transcript ? "idle" : "text",
        transcript: "",
        status: action.status,
        fellBack: false,
        refocus: null,
      };
    case "matched":
      return {
        ...model,
        state: "matched",
        status: STATUS.connected(action.volunteerName),
      };
    // transcript가 있으면 음성으로 낸 요청이고, 없으면 입력창으로 낸 요청이다.
    // 입력창 답을 확인 단계에 올렸으면(fellBack) transcript가 있어도 입력창으로 돌아간다.
    case "matchRejected":
      return {
        ...model,
        state: model.transcript && !model.fellBack ? "idle" : "text",
        transcript: "",
        status: action.status,
        refocus: "reenter",
      };
    case "matchFailed":
      return {
        ...model,
        state: model.transcript ? "confirming" : "text",
        status: action.status,
        refocus: "resend",
      };
    case "reset":
      return { ...createInitialModel(action.mode), fellBack: action.mode === "text" };
    case "typed":
      return {
        ...model,
        state: "confirming",
        transcript: action.text,
        status: STATUS.typedBack(action.text),
        refocus: null,
      };
    case "reenter":
      return {
        ...model,
        state: "text",
        transcript: "",
        status: "",
        refocus: "reenter",
      };
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
