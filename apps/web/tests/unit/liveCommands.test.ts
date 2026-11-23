import { describe, expect, it } from "vitest";
import {
  BUTTONS,
  COMMANDS,
  hasQuestion,
  isCardEcho,
  isClearConsent,
  isDecline,
  isPlausibleConsent,
  isScreenReaderEcho,
  matchLocalCommand,
  normalizeSpeech,
} from "@/lib/liveCommands";
import { toDraft } from "@/lib/liveText";

// 단추 이름 표, 말 명령, 동의·메아리 판정(설계서 8.3~8.4절).
describe("BUTTONS", () => {
  it("값에 중복이 없다", () => {
    const values = Object.values(BUTTONS);
    expect(new Set(values).size).toBe(values.length);
  });
  it("음성 모드 큰 단추 이름은 '말하기'다", () => {
    expect(BUTTONS.talk).toBe("말하기");
  });
});

describe("COMMANDS", () => {
  it("일곱 명령이 모두 있다", () => {
    expect(COMMANDS.map((c) => c.command).sort()).toEqual(["end", "fast", "help", "normal", "pause", "repeat", "slow"]);
  });
});

describe("normalizeSpeech", () => {
  it("NFKC, 소문자, 공백·문장부호를 없앤다", () => {
    expect(normalizeSpeech("  OK, 좋아요! ")).toBe("ok좋아요");
    expect(normalizeSpeech("말 빠르기: 보통")).toBe("말빠르기보통");
    expect(normalizeSpeech("ＯＫ？")).toBe("ok");
  });
});

describe("matchLocalCommand", () => {
  it.each([
    ["도움말", "help"],
    ["다시 말해 줘", "repeat"],
    ["뭐라고요", "repeat"],
    ["잠깐만요", "pause"],
    ["그만해", "end"],
    ["천천히 말해 주세요", "slow"],
    ["빠르게 해줘", "fast"],
    ["보통 속도로", "normal"],
    ["종료", "end"],
  ])("%s → %s", (text, expected) => {
    expect(matchLocalCommand(text)).toBe(expected);
  });
  it.each(["다시마 과자 찾아 줘", "다시 보내", "그만큼 큰 거", "끝이 둥근 가위", "", "전기밥솥", "도움말 알려 줘"])(
    "%j는 명령이 아니다",
    (text) => {
      expect(matchLocalCommand(text)).toBeNull();
    },
  );
});

describe("hasQuestion", () => {
  it("물음표가 있으면 참이다", () => {
    expect(hasQuestion("네?")).toBe(true);
    expect(hasQuestion("네？")).toBe(true);
    expect(hasQuestion("네")).toBe(false);
  });
});

// 8.4절 사례 표 전부: [글, isClearConsent, isPlausibleConsent]
describe("동의 판정 사례 표", () => {
  const rows: [string, boolean, boolean][] = [
    ["네", true, true],
    ["예", true, true],
    ["응 맞아", true, true],
    ["네 보내 주세요", true, true],
    ["이대로 보내 줘", true, true],
    ["등록해 주세요", true, true],
    ["다시 보내", true, true],
    ["네 그렇게 보내 주시면 돼요", false, true],
    ["네?", false, false],
    ["응?", false, false],
    ["네 빨간색으로요", false, false],
    ["예 32인치요", false, false],
    ["이대로 보내기 버튼", false, false],
    ["이대로 보내기", false, false],
    ["보내기", false, false],
    ["말하기 버튼", false, false],
    ["예산은 5만 원", false, false],
    ["아니요", false, false],
    ["아니요 보내지 마", false, false],
    ["등록하지 마", false, false],
    ["네 아니 잠깐", false, false],
    ["네, 근데 빨강으로", false, false],
    ["네 그리고 색은 빨강으로요", false, false],
    ["", false, false],
    ["다시", false, false],
    // 자연스러운 동의(A11). '괜찮아요'·'됐어요'는 거절로도 쓰이므로 AI도 동의로 본 경우에만 통과한다.
    ["네, 부탁드립니다", true, true],
    ["네 부탁 드립니다", true, true],
    ["네 부탁합니다", true, true],
    ["네 보내세요", true, true],
    ["보내세요", true, true],
    ["네 보내 주십시오", true, true],
    ["이대로 보내 주십시오", true, true],
    ["그렇게 해 주십시오", true, true],
    ["네, 괜찮아요", false, true],
    ["네 괜찮습니다", false, true],
    ["네 됐어요", false, true],
    ["네 할게요", false, true],
    ["괜찮아요", false, false],
    ["됐어요", false, false],
    ["아니요 괜찮아요", false, false],
    ["네, 괜찮아요?", false, false],
    ["아니요 보내지 마세요", false, false],
    ["부탁드립니다", false, false],
  ];
  it.each(rows)("%j → clear=%s plausible=%s", (text, clear, plausible) => {
    expect(isClearConsent(text)).toBe(clear);
    expect(isPlausibleConsent(text)).toBe(plausible);
  });
  it("글자 수가 40을 넘으면 그럴듯한 동의가 아니다", () => {
    expect(isPlausibleConsent("네 " + "그렇게 ".repeat(20) + "보내 주세요")).toBe(false);
  });
  it("영문 OK도 동의다", () => {
    expect(isClearConsent("OK")).toBe(true);
  });
});

describe("isScreenReaderEcho", () => {
  it.each(["말하기 버튼", "도움말 버튼", "이대로 보내기 버튼", "버튼", "이대로 보내기", "말하기", "음성 도우미 링크", "말 빠르기: 보통 버튼"])(
    "%j는 메아리다",
    (text) => {
      expect(isScreenReaderEcho(text)).toBe(true);
    },
  );
  it.each(["도움말", "전기밥솥", "네", "", "말하기 버튼 말고 전기밥솥"])("%j는 메아리가 아니다", (text) => {
    expect(isScreenReaderEcho(text)).toBe(false);
  });
});

describe("isCardEcho", () => {
  const draft = toDraft({ product: "무선 이어폰", info: "배터리 시간", options: "흰색", budget: "" });
  it("카드 줄 그대로는 참이다", () => {
    expect(isCardEcho("제품은 무선 이어폰", draft)).toBe(true);
    expect(isCardEcho("알고 싶은 정보는 배터리 시간", draft)).toBe(true);
  });
  it("고치는 말은 거짓이다", () => {
    expect(isCardEcho("옵션은 흰색 말고 검정색으로", draft)).toBe(false);
  });
  it("낱말 하나는 거짓이다", () => {
    expect(isCardEcho("무선", draft)).toBe(false);
  });
  it("draft가 없으면 거짓이다", () => {
    expect(isCardEcho("제품은 무선 이어폰", null)).toBe(false);
  });

  // Codex 3차 지적 1: 60% 기준에서는 아래 첫 문장이 메아리로 판정돼 이용자의 수정이 버려졌다.
  const sony = toDraft({ product: "소니 헤드폰", info: "노이즈 캔슬링 성능", options: "무선", budget: "20만 원" });
  it("카드 낱말이 많아도 고치는 말, 새 낱말, 답하는 말, 물음은 거짓이다", () => {
    expect(isCardEcho("소니 헤드폰 말고 보스 헤드폰", sony)).toBe(false);
    expect(isCardEcho("소니 헤드폰 대신 보스 헤드폰", sony)).toBe(false);
    expect(isCardEcho("예산 30만 원", sony)).toBe(false); // 새 금액
    expect(isCardEcho("소니 헤드폰 유선", sony)).toBe(false); // 새 낱말 하나(세 낱말 중)
    expect(isCardEcho("소니 헤드폰 맞아요", sony)).toBe(false); // 답하는 말
    expect(isCardEcho("소니 헤드폰은 무선인가요?", sony)).toBe(false); // 물음
  });
  it("요약 글의 이어진 한 구간과 낱말이 모두 같은 낭독만 참이다", () => {
    expect(isCardEcho("제품은 소니 헤드폰", sony)).toBe(true);
    expect(isCardEcho("옵션은 무선 예산은 20만 원", sony)).toBe(true);
    expect(isCardEcho("제품은 소니 헤드폰 알고 싶은 정보는 노이즈 캔슬링 성능 옵션은 무선 예산은 20만 원", sony)).toBe(true);
    // 낱말 하나라도 다르면 이용자 말로 받는다(잘못 받아 적힌 낭독도 AI로 간다).
    expect(isCardEcho("제품은 소니 헤드폰 알고 싶은 정보는 노이즈 캔슬린 성능", sony)).toBe(false);
  });
  it("요약을 되풀이하며 금액만 바꾼 말은 거짓이다(Codex 4차 지적 1)", () => {
    expect(isCardEcho("제품은 소니 헤드폰 알고 싶은 정보는 노이즈 캔슬링 성능 옵션은 무선 예산은 30만 원", sony)).toBe(false);
    expect(isCardEcho("옵션은 무선 예산은 30만 원", sony)).toBe(false);
    expect(isCardEcho("옵션은 유선 예산은 20만 원", sony)).toBe(false);
  });
  it("중간을 건너뛴 말은 거짓이다", () => {
    expect(isCardEcho("소니 헤드폰 무선", sony)).toBe(false);
    expect(isCardEcho("제품은 소니 헤드폰 예산은 20만 원", sony)).toBe(false);
  });
  it("카드 화면의 이름표(제품, 옵션, 예산)로 읽혀도 참이다", () => {
    expect(isCardEcho("제품 소니 헤드폰", sony)).toBe(true);
    expect(isCardEcho("옵션 무선 예산 20만 원", sony)).toBe(true);
  });
  it("카드 낱말만 쓰더라도 순서가 다르면 거짓이다(뒤집어 고치는 말)", () => {
    const wired = toDraft({ product: "헤드폰", info: "", options: "유선 말고 무선", budget: "" });
    expect(isCardEcho("옵션은 유선 말고 무선", wired)).toBe(true); // 카드에 있는 "말고"는 낭독이다
    expect(isCardEcho("무선 말고 유선", wired)).toBe(false);
    expect(isCardEcho("헤드폰 무선 말고 유선", wired)).toBe(false);
  });
  it("카드 밖 낱말이 하나뿐이어도 고치는 말이면 거짓이다", () => {
    expect(isCardEcho("제품은 소니 헤드폰 말고 노이즈 캔슬링 성능", sony)).toBe(false);
  });
});

describe("isDecline: '끝낼까요?'에 대한 거절(A36)", () => {
  it("아니요·계속하겠다는 말이면 참", () => {
    for (const text of ["아니요", "아니", "아뇨", "아니요.", "계속할게요", "계속해요", "계속", "아니요 계속할게요", "안 끝낼래요", "끝내지 마세요"]) {
      expect(isDecline(text), text).toBe(true);
    }
  });
  it("다른 말이 섞이거나 물음표가 있으면 거짓", () => {
    for (const text of ["", "네", "그만", "아니 전기밥솥 찾아 주세요", "계속 전기밥솥 얘기할게요", "아니요?", "전기밥솥"]) {
      expect(isDecline(text), text).toBe(false);
    }
  });
});

describe("동의 판정 보강(실호출 2026-11-24)", () => {
  it("가리키는 말 + 해 달라는 말은 동의다. 망설이는 말이 앞에 붙어도 된다", () => {
    for (const text of ["그렇게 해 주세요", "음, 그렇게 해주세요.", "어 그렇게 해줘", "이대로 부탁해요", "그대로 해요", "아 그걸로 해 주세요"]) {
      expect(isClearConsent(text), text).toBe(true);
      expect(isPlausibleConsent(text), text).toBe(true);
    }
  });

  it("동의가 아닌 말은 그대로 아니다", () => {
    for (const text of ["그렇게", "음", "다시 해 주세요", "그렇게 하지 마세요", "그렇게 해 주세요?", "그렇게 말고 흰색으로 해 주세요", "음 글쎄요"]) {
      expect(isClearConsent(text), text).toBe(false);
    }
  });
});
