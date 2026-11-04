import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialModel,
  getSpeechRecognitionCtor,
  speechInputReducer,
  SPEECH_LISTEN_TIMEOUT_MS,
  SPEECH_START_DELAY_MS,
  SPEECH_START_TIMEOUT_MS,
  startRecognition,
  STATUS,
  type RecognitionHandlers,
  type SpeechRecognitionLike,
} from "@/lib/speech";

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  static throwOnStart = false;

  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  onstart: SpeechRecognitionLike["onstart"] = null;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  aborted = false;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error("start");
  }
  abort() {
    this.aborted = true;
  }
  emitResult(transcript: string, isFinal: boolean) {
    const item = Object.assign([{ transcript }], { isFinal });
    this.onresult?.({ results: [item] });
  }
}

function makeHandlers() {
  return {
    onListening: vi.fn(),
    onResult: vi.fn(),
    onMiss: vi.fn(),
    onUnavailable: vi.fn(),
  } satisfies RecognitionHandlers;
}

describe("startRecognition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.last = null;
    FakeRecognition.throwOnStart = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("시작 지연 전에는 인식을 만들지 않고, 지난 뒤 정해진 설정으로 시작한다", () => {
    startRecognition(FakeRecognition, makeHandlers(), SPEECH_START_DELAY_MS);
    vi.advanceTimersByTime(SPEECH_START_DELAY_MS - 1);
    expect(FakeRecognition.last).toBeNull();

    vi.advanceTimersByTime(1);
    expect(FakeRecognition.last).toMatchObject({
      lang: "ko-KR",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
    });
  });

  it("start()가 예외를 던지면 입력창으로 간다", () => {
    FakeRecognition.throwOnStart = true;
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    expect(handlers.onUnavailable).toHaveBeenCalledOnce();
  });

  it("start 이벤트가 3초 안에 없으면 끊고 입력창으로 간다", () => {
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    vi.advanceTimersByTime(SPEECH_START_TIMEOUT_MS - 1);
    expect(handlers.onUnavailable).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(handlers.onUnavailable).toHaveBeenCalledOnce();
    expect(FakeRecognition.last?.aborted).toBe(true);
  });

  it("start 이벤트가 오면 무응답 타이머를 끈다", () => {
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    FakeRecognition.last?.onstart?.();
    vi.advanceTimersByTime(SPEECH_START_TIMEOUT_MS);
    expect(handlers.onListening).toHaveBeenCalledOnce();
    expect(handlers.onUnavailable).not.toHaveBeenCalled();
  });

  it("최종 결과의 앞뒤 공백을 지워 넘기고, 뒤따른 end는 무시한다", () => {
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    const recognition = FakeRecognition.last;
    recognition?.onstart?.();
    recognition?.emitResult(" 소니 헤드셋 ", true);
    recognition?.onend?.();
    expect(handlers.onResult).toHaveBeenCalledExactlyOnceWith("소니 헤드셋");
    expect(handlers.onMiss).not.toHaveBeenCalled();
  });

  it("최종이 아닌 결과뿐이어도 end에서 마지막 값을 넘긴다", () => {
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    const recognition = FakeRecognition.last;
    recognition?.emitResult("소니", false);
    expect(handlers.onResult).not.toHaveBeenCalled();
    recognition?.emitResult("소니 헤드셋", false);
    recognition?.onend?.();
    expect(handlers.onResult).toHaveBeenCalledExactlyOnceWith("소니 헤드셋");
  });

  it.each(["not-allowed", "service-not-allowed", "audio-capture", "network"])(
    "%s 오류는 입력창으로 간다",
    (code) => {
      const handlers = makeHandlers();
      startRecognition(FakeRecognition, handlers, 0);
      FakeRecognition.last?.onerror?.({ error: code });
      FakeRecognition.last?.onend?.();
      expect(handlers.onUnavailable).toHaveBeenCalledOnce();
      expect(handlers.onMiss).not.toHaveBeenCalled();
    },
  );

  it.each(["no-speech", "nomatch", "aborted", "language-not-supported"])(
    "%s 오류는 못 들은 것으로 친다",
    (code) => {
      const handlers = makeHandlers();
      startRecognition(FakeRecognition, handlers, 0);
      FakeRecognition.last?.onerror?.({ error: code });
      expect(handlers.onMiss).toHaveBeenCalledOnce();
      expect(handlers.onUnavailable).not.toHaveBeenCalled();
    },
  );

  it("결과 없이 end만 오면 못 들은 것으로 친다", () => {
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    FakeRecognition.last?.onstart?.();
    FakeRecognition.last?.onend?.();
    expect(handlers.onMiss).toHaveBeenCalledOnce();
  });

  it("듣기 시작 뒤 끝이 오지 않으면 끊고 못 들은 것으로 친다", () => {
    const handlers = makeHandlers();
    startRecognition(FakeRecognition, handlers, 0);
    FakeRecognition.last?.onstart?.();
    vi.advanceTimersByTime(SPEECH_LISTEN_TIMEOUT_MS);
    expect(handlers.onMiss).toHaveBeenCalledOnce();
    expect(FakeRecognition.last?.aborted).toBe(true);
  });

  it("취소하면 지연 중이어도 인식을 만들지 않고 아무 핸들러도 부르지 않는다", () => {
    const handlers = makeHandlers();
    const cancel = startRecognition(FakeRecognition, handlers, 1000);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(FakeRecognition.last).toBeNull();
    for (const handler of Object.values(handlers)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("취소하면 듣던 인식을 끊는다", () => {
    const handlers = makeHandlers();
    const cancel = startRecognition(FakeRecognition, handlers, 0);
    FakeRecognition.last?.onstart?.();
    cancel();
    expect(FakeRecognition.last?.aborted).toBe(true);
    expect(handlers.onMiss).not.toHaveBeenCalled();
  });
});

describe("getSpeechRecognitionCtor", () => {
  it("표준 이름을 먼저, 없으면 webkit 이름을 쓴다", () => {
    class Standard extends FakeRecognition {}
    class Webkit extends FakeRecognition {}
    expect(
      getSpeechRecognitionCtor({
        SpeechRecognition: Standard,
        webkitSpeechRecognition: Webkit,
      }),
    ).toBe(Standard);
    expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: Webkit })).toBe(
      Webkit,
    );
  });

  it("둘 다 없으면 null이다", () => {
    expect(getSpeechRecognitionCtor({})).toBeNull();
  });
});

describe("speechInputReducer", () => {
  const speech = createInitialModel("speech");

  it("초기 상태는 입력 방식을 따른다", () => {
    expect(speech.state).toBe("idle");
    const text = createInitialModel("text");
    expect(text.state).toBe("text");
    expect(text.fellBack).toBe(false);
  });

  it("idle → starting → listening → confirming → submitting", () => {
    const starting = speechInputReducer(speech, { type: "press" });
    expect(starting.state).toBe("starting");
    const listening = speechInputReducer(starting, { type: "listening" });
    expect(listening).toMatchObject({
      state: "listening",
      status: "듣고 있습니다. 말씀하세요.",
    });
    const confirming = speechInputReducer(listening, {
      type: "result",
      transcript: "소니 헤드셋",
    });
    expect(confirming).toMatchObject({
      state: "confirming",
      transcript: "소니 헤드셋",
      status: "이렇게 들었습니다: 소니 헤드셋",
    });
    const submitting = speechInputReducer(confirming, {
      type: "submit",
      text: "소니 헤드셋",
    });
    expect(submitting).toMatchObject({
      state: "submitting",
      submitted: "소니 헤드셋",
      status: "봉사자를 찾고 있습니다.",
    });
  });

  describe("매칭 결과", () => {
    const voiceSubmitting = speechInputReducer(
      speechInputReducer(speech, { type: "result", transcript: "소니 헤드셋" }),
      { type: "submit", text: "소니 헤드셋" },
    );
    const textSubmitting = speechInputReducer(createInitialModel("text"), {
      type: "submit",
      text: "소니 헤드셋",
    });

    it("매칭 완료는 봉사자 이름을 안내한다", () => {
      expect(
        speechInputReducer(voiceSubmitting, {
          type: "matched",
          volunteerName: "가상 봉사자 A",
        }),
      ).toMatchObject({
        state: "matched",
        status: "가상 봉사자 A와 연결됐습니다.",
        refocus: null,
      });
    });

    it("다시 내야 하면 음성은 처음 버튼으로, 입력창은 입력창으로 간다", () => {
      const action = { type: "matchRejected", status: "안내" } as const;
      expect(speechInputReducer(voiceSubmitting, action)).toMatchObject({
        state: "idle",
        transcript: "",
        status: "안내",
        refocus: "reenter",
      });
      expect(speechInputReducer(textSubmitting, action)).toMatchObject({
        state: "text",
        status: "안내",
        refocus: "reenter",
      });
    });

    it("다시 보낼 수 있으면 문장을 지우지 않는다", () => {
      const action = { type: "matchFailed", status: "안내" } as const;
      expect(speechInputReducer(voiceSubmitting, action)).toMatchObject({
        state: "confirming",
        transcript: "소니 헤드셋",
        status: "안내",
        refocus: "resend",
      });
      expect(speechInputReducer(textSubmitting, action)).toMatchObject({
        state: "text",
        status: "안내",
        refocus: "resend",
      });
    });

    it("다시 누르거나 다시 내면 초점 지시를 지운다", () => {
      const rejected = speechInputReducer(voiceSubmitting, {
        type: "matchRejected",
        status: "안내",
      });
      expect(speechInputReducer(rejected, { type: "press" }).refocus).toBeNull();
      const failed = speechInputReducer(voiceSubmitting, {
        type: "matchFailed",
        status: "안내",
      });
      expect(
        speechInputReducer(failed, { type: "submit", text: "소니 헤드셋" })
          .refocus,
      ).toBeNull();
    });
  });

  it("다시 말하기는 앞 문장과 안내를 지운다", () => {
    const confirming = speechInputReducer(speech, {
      type: "result",
      transcript: "소니",
    });
    expect(speechInputReducer(confirming, { type: "press" })).toMatchObject({
      state: "starting",
      transcript: "",
      status: "",
    });
  });

  it("못 들음 2회 연속이면 입력창, 그 사이 성공하면 다시 센다", () => {
    const once = speechInputReducer(speech, { type: "miss" });
    expect(once).toMatchObject({ state: "idle", status: STATUS.missed });
    const twice = speechInputReducer(once, { type: "miss" });
    expect(twice).toMatchObject({
      state: "text",
      fellBack: true,
      status: STATUS.fallback,
    });

    const heard = speechInputReducer(once, { type: "result", transcript: "a" });
    expect(speechInputReducer(heard, { type: "miss" }).state).toBe("idle");
  });

  it("전환 안내 문구가 TSD §7과 같다", () => {
    expect(speechInputReducer(speech, { type: "unavailable" }).status).toBe(
      "음성 인식을 쓸 수 없습니다. 입력창에 받아쓰기로 입력하세요.",
    );
  });
});
