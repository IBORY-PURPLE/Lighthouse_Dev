import { describe, expect, it } from "vitest";
import {
  benefitShortcuts,
  defaultQuestion,
  draftSummaryText,
  refShortcuts,
  siteNameOf,
  withEulReul,
  type SummaryInput,
} from "@/lib/research";

/** 답을 모두 채운 핵심 정리 입력. */
function complete(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    model: "소니 WH-CH720N",
    pros: "가벼워요",
    alts: ["소니 WH-CH520"],
    altReason: "가격 대신 무게를 봤어요",
    benefits: "",
    refs: "",
    ...overrides,
  };
}

describe("질문 문구", () => {
  it("기본 질문은 설계 지침 문구 그대로다", () => {
    const ctx = { subject: "소니 헤드셋", model: "소니 WH-CH720N", alts: ["소니 WH-CH520", "소니 WH-1000XM4"] };
    expect(defaultQuestion("model", ctx)).toBe("소니 헤드셋 기종을 찾아 주세요.");
    expect(defaultQuestion("pros", ctx)).toBe("소니 WH-CH720N의 장점이 뭐예요?");
    expect(defaultQuestion("photo", ctx)).toBe("제품 사진을 올려 주세요.");
    expect(defaultQuestion("alts", ctx)).toBe("소니 WH-CH720N을(를) 살 때 같이 고민한 다른 제품이 있나요?");
    expect(defaultQuestion("altReason", ctx)).toBe(
      "소니 WH-CH520, 소니 WH-1000XM4을(를) 왜 같이 고민했나요?",
    );
    expect(defaultQuestion("benefits", ctx)).toBe("살 때 받은 혜택이 있나요?");
    expect(defaultQuestion("refs", ctx)).toBe("참고한 유튜브나 블로그 글이 있나요?");
  });

  it("기종이 비었을 때도 질문이 깨지지 않는다", () => {
    const ctx = { subject: "", model: "", alts: [] };
    expect(defaultQuestion("model", ctx)).toBe("제품 기종을 찾아 주세요.");
    expect(defaultQuestion("pros", ctx)).toBe("이 제품의 장점이 뭐예요?");
  });

  it("조사: 한글은 받침으로 을/를을 고르고 영문·숫자 끝은 을(를)로 쓴다", () => {
    expect(withEulReul("헤드셋")).toBe("헤드셋을");
    expect(withEulReul("키보드")).toBe("키보드를");
    expect(withEulReul("WH-CH720N")).toBe("WH-CH720N을(를)");
  });
});

describe("바로가기·링크", () => {
  it("혜택 바로가기는 쿠팡·11번가·G마켓 검색 주소이고 검색어가 인코딩된다", () => {
    const shortcuts = benefitShortcuts("소니 WH-CH720N");
    expect(shortcuts.map((entry) => entry.label)).toEqual(["쿠팡에서 찾기", "11번가에서 찾기", "G마켓에서 찾기"]);
    for (const entry of shortcuts) {
      expect(entry.url.startsWith("https://")).toBe(true);
      expect(entry.url).toContain(encodeURIComponent("소니 WH-CH720N"));
    }
  });

  it("참고 글 바로가기는 네이버 블로그와 유튜브 검색 주소다", () => {
    const shortcuts = refShortcuts("소니 WH-CH720N");
    expect(shortcuts.map((entry) => entry.label)).toEqual(["네이버 블로그에서 찾기", "유튜브에서 찾기"]);
    expect(shortcuts[0].url).toContain("search.naver.com");
    expect(shortcuts[1].url).toContain("youtube.com/results");
    for (const entry of shortcuts) expect(entry.url).toContain(encodeURIComponent("소니 WH-CH720N 후기"));
  });

  it("사이트 이름은 도메인에서 www.를 뺀 것이다", () => {
    expect(siteNameOf("https://www.example.com/a?b=1")).toBe("example.com");
    expect(siteNameOf("not a url")).toBe("");
  });
});

describe("핵심 정리 기본 글", () => {
  it("답을 이어 만들고 빈 답은 건너뛴다", () => {
    const text = draftSummaryText(complete({ benefits: "", refs: "블로그 후기를 봤어요" }));
    expect(text.split("\n")).toEqual([
      "추천 기종: 소니 WH-CH720N",
      "장점: 가벼워요",
      "같이 고민한 제품: 소니 WH-CH520",
      "고민한 이유: 가격 대신 무게를 봤어요",
      "참고: 블로그 후기를 봤어요",
    ]);
  });

  it("최대 길이를 넘기지 않는다", () => {
    const text = draftSummaryText(complete({ pros: "가".repeat(900) }), 600);
    expect([...text]).toHaveLength(600);
    expect(text.endsWith("…")).toBe(true);
  });
});
