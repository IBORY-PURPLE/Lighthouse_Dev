import { describe, expect, it } from "vitest";
import { BUTTONS, COMMANDS } from "@/lib/liveCommands";
import type { LiveErrorKind } from "@/lib/liveEngine";
import {
  LIVE_VISITS_KEY,
  SCRIPT_IDS,
  SCRIPT_MAX_SYLLABLES,
  countSyllables,
  errorScriptFor,
  guideFor,
  markVisit,
  readVisits,
  script,
  type ScriptId,
} from "@/lib/liveScripts";

// 안내 문구 대본(설계서 10절). 단추 이름은 BUTTONS에서만 끼워 넣고, 길이는 100음절 이하다.
const text = (id: ScriptId) => script(id, { n: 3, s: 5, summary: "" });

const NOT_LISTENING: ScriptId[] = [
  "registered", "registerRejected", "registerConflict", "registerRetryText", "registerUnknownText",
  "pausedBySilence", "pausedByUser", "pausedWarn",
  "endedRegistered", "endedUnregistered", "endedSending", "endedSendFailed", "endedEmpty",
  "offline", "notConfigured", "connectFailed", "failedRepeated", "conversationBroken", "dailyCap", "sessionOver", "micRetry",
];
const TEXT_MODE: ScriptId[] = [
  "guideFirstText", "guideReturnText", "guideNewText", "helpText", "editPromptText",
  "registerRetryText", "registerUnknownText", "tooLongText", "engineSwitchedText",
];

describe("대본 표", () => {
  it("모든 대본 id가 글을 가진다", () => {
    expect(SCRIPT_IDS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(SCRIPT_IDS).size).toBe(SCRIPT_IDS.length);
    for (const id of SCRIPT_IDS) expect(text(id).length).toBeGreaterThan(0);
  });

  it("작은따옴표 안 글은 단추 이름, 말 명령 낱말, '네', '다시 보내', '허용'뿐이다", () => {
    const allowed = new Set<string>([
      ...Object.values(BUTTONS),
      ...COMMANDS.flatMap((c) => c.words),
      "네", "다시 보내", "허용",
    ]);
    for (const id of SCRIPT_IDS) {
      for (const m of text(id).matchAll(/'([^']+)'/g)) {
        expect(allowed.has(m[1]), `${id}: '${m[1]}'`).toBe(true);
      }
    }
  });

  it("자리 말(아래, 위, 가운데, 왼쪽, 오른쪽)이 없다", () => {
    for (const id of SCRIPT_IDS) {
      expect(/아래|위|가운데|왼쪽|오른쪽/.test(text(id)), id).toBe(false);
    }
  });

  it("듣지 않는 상태와 글자 모드 대본에 말하라는 안내가 없다", () => {
    for (const id of [...NOT_LISTENING, ...TEXT_MODE]) {
      expect(/라고 하세요|라고 말씀|말씀하세요/.test(text(id)), id).toBe(false);
    }
  });

  it("모든 대본이 100음절 이하다({summary} 제외)", () => {
    for (const id of SCRIPT_IDS) {
      expect(countSyllables(text(id)), id).toBeLessThanOrEqual(SCRIPT_MAX_SYLLABLES);
    }
  });

  it("guideFirstVoice는 링키지랩 예시 두 문장으로 시작하고 '말하기'가 든다", () => {
    const t = text("guideFirstVoice");
    expect(
      t.startsWith(
        "저는 사고 싶은 제품의 혜택과 정보를 대신 찾아 드리는 도우미예요. 원하는 제품과 알고 싶은 정보, 원하는 옵션을 말씀해 주시면 리서치 봉사자에게 전달해 답을 받아 드릴게요.",
      ),
    ).toBe(true);
    expect(t).toContain(`'${BUTTONS.talk}'`);
    // 설계서 10절이 2026-11-23에 센 값
    expect(countSyllables(t)).toBe(98);
    expect(countSyllables(text("guideFirstText"))).toBe(97);
  });

  it("음성 안내에 말로 끼어들 수 있다는 문장이 없다", () => {
    for (const id of ["guideFirstVoice", "guideReturnVoice", "guideNewVoice", "helpVoice", "helpMoreVoice"] as ScriptId[]) {
      expect(text(id).includes("말하는 중에"), id).toBe(false);
    }
  });

  it("끼워 넣는 값이 들어간다", () => {
    expect(script("registered", { n: 7 })).toContain("접수 번호는 7번이에요");
    expect(script("rateLimited", { s: 12 })).toContain("12초 뒤에");
    expect(script("confirmAgain", { summary: "제품은 TV." })).toBe("제품은 TV. 이 내용으로 봉사자에게 보낼까요?");
    expect(script("confirmRetell", { summary: "제품은 TV." })).toBe(
      "요약을 다시 들려 드릴게요. 제품은 TV. 이 내용으로 봉사자에게 보낼까요?",
    );
  });

  it("단추 이름이 BUTTONS에서 온다", () => {
    expect(script("pausedByUser")).toContain(`'${BUTTONS.resume}'`);
    expect(script("registerRejected")).toContain(`'${BUTTONS.newRequest}'`);
    expect(script("endedUnregistered")).toContain(`'${BUTTONS.continueTalk}'`);
  });
});

describe("guideFor", () => {
  it("여섯 가지를 고른다", () => {
    expect(guideFor("first", "voice")).toBe("guideFirstVoice");
    expect(guideFor("first", "text")).toBe("guideFirstText");
    expect(guideFor("returning", "voice")).toBe("guideReturnVoice");
    expect(guideFor("returning", "text")).toBe("guideReturnText");
    expect(guideFor("new", "voice")).toBe("guideNewVoice");
    expect(guideFor("new", "text")).toBe("guideNewText");
  });
});

describe("errorScriptFor", () => {
  const rows: [LiveErrorKind, boolean, ScriptId][] = [
    ["mic_blocked", false, "micRetry"],
    ["mic_denied", false, "micDenied"],
    ["speech_unavailable", false, "speechUnavailable"],
    ["offline", false, "offline"],
    ["rate_limited", false, "rateLimited"],
    ["timeout", false, "timeout"],
    ["timeout", true, "failedRepeated"],
    ["failed", false, "failed"],
    ["failed", true, "failedRepeated"],
    ["bad_request", false, "tooLong"],
    ["bad_request", true, "conversationBroken"],
    ["unavailable_today", false, "dailyCap"],
    ["not_configured", false, "notConfigured"],
    ["connect_failed", false, "connectFailed"],
    ["register_rejected", false, "registerRejected"],
    ["register_conflict", false, "registerConflict"],
  ];
  it.each(rows)("%s repeated=%s → %s", (kind, repeated, id) => {
    expect(errorScriptFor(kind, repeated)).toBe(id);
  });
  it("모든 오류 종류가 대본을 가진다", () => {
    const kinds: LiveErrorKind[] = [
      "mic_blocked", "mic_denied", "speech_unavailable", "offline", "rate_limited", "timeout", "failed", "bad_request",
      "unavailable_today", "not_configured", "connect_failed", "register_rejected", "register_conflict",
    ];
    for (const k of kinds) for (const r of [false, true]) expect(SCRIPT_IDS).toContain(errorScriptFor(k, r));
  });
});

describe("방문 횟수", () => {
  const store = (init?: string) => {
    const data = new Map<string, string>();
    if (init !== undefined) data.set(LIVE_VISITS_KEY, init);
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };
  it("저장이 없으면 0이다", () => {
    expect(readVisits(store())).toBe(0);
  });
  it("망가진 값은 0이다", () => {
    expect(readVisits(store("abc"))).toBe(0);
    expect(readVisits(store("-3"))).toBe(0);
  });
  it("markVisit이 1씩 올린다", () => {
    const s = store();
    markVisit(s);
    markVisit(s);
    expect(readVisits(s)).toBe(2);
  });
  it("저장이 막혀도 던지지 않는다", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readVisits(broken)).toBe(0);
    expect(() => markVisit(broken)).not.toThrow();
  });
});

describe("countSyllables", () => {
  it("한글 음절 1, 숫자 1, 라틴 낱말은 2자당 1(올림)", () => {
    expect(countSyllables("20초")).toBe(3);
    expect(countSyllables("VoiceOver")).toBe(5);
    expect(countSyllables("가나다")).toBe(3);
    expect(countSyllables("OK 해요")).toBe(3);
    expect(countSyllables("... , ")).toBe(0);
  });
});
