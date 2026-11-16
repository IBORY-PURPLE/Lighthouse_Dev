import { describe, expect, it } from "vitest";
import { isHttpsUrl, RESEARCH_COPY } from "@/lib/research";
import { fallbackResponse, hasBrandWord, knownBrandIn } from "@/lib/researchAi";
import { demoCandidatesFor } from "@/lib/demoCandidates";
import { hasForbidden } from "@/lib/researchCheck";

// 리뷰 반영(review-fixes.md F12)과 화면 코드 리뷰 지적의 단위 시험. 카드형 화면의 상태 시험(F1·F4·F6·F10·F11)은 카드형 화면과 함께 지웠다.

describe("F12: 고정 후보 fallback은 요청의 브랜드를 따른다", () => {
  const id = "6f1c2e4a-1111-4222-8333-444455556666";
  const names = (brand: string | null, item: string | null = "헤드셋", product = "헤드셋 사고 싶어요") => {
    const response = fallbackResponse({ requestId: id, kind: "model" }, { product, brand, item });
    return response.kind === "model" ? response.items.map((entry) => entry.name) : [];
  };

  it("다른 브랜드 요청이면 소니 기종을 후보로 내지 않는다(빈 목록)", () => {
    expect(names("LG")).toEqual([]);
  });

  it("브랜드가 맞으면 그 브랜드의 후보만, 영문 표기(Sony)도 알아본다", () => {
    expect(names("소니")).toHaveLength(3);
    expect(names("Sony")).toHaveLength(3);
    expect(names("로지텍", "키보드").every((name) => name.includes("로지텍"))).toBe(true);
  });

  it("요청의 brand가 비어도(소니 아니면 null) 문장에서 다른 브랜드를 알아보면 후보를 보이지 않는다", () => {
    expect(names(null, "헤드셋", "LG 헤드셋 사고 싶어요")).toEqual([]);
    expect(names(null, "헤드셋", "엘지 헤드셋 사고 싶어요")).toEqual([]);
    expect(names(null, "헤드셋", "Bose 헤드셋 찾아요")).toEqual([]);
    expect(names(null, "헤드셋", "삼성 헤드셋 사고 싶어요")).toEqual([]);
    expect(names(null, "키보드", "로지텍 키보드 사고 싶어요").every((name) => name.includes("로지텍"))).toBe(true);
    expect(names(null, "키보드", "로지텍 키보드 사고 싶어요")).not.toEqual([]);
  });

  it("영문 브랜드 약자는 다른 영문 낱말 안에서 걸리지 않는다", () => {
    expect(names(null, "헤드셋", "algorithm 헤드셋 사고 싶어요")).toHaveLength(3);
  });

  // R3-4: 시연 표의 브랜드(보국·일월·한일·테크·액츠·키친아트)도 요청 문장에서 알아본다
  it("시연 표의 브랜드를 문장에서 알아보면 그 후보만 낸다", () => {
    expect(names(null, "전기요", "일월 전기요 사고 싶어요")).toEqual([
      "일월 프리미엄 탄소 카본 워셔블 전기요 IW-KM59 싱글",
    ]);
    expect(names(null, "세탁세제", "테크 세탁세제 사고 싶어요")).toEqual(["테크 베이킹소다 구연산 액체세제 리필 1.8L"]);
    expect(names(null, "전기포트", "키친아트 전기포트 사고 싶어요")).toEqual(["키친아트 라팔 뉴 멀티 포트 1.7 KP-1007FT"]);
    expect(names(null, "전기요", "보국 전기요 찾아요")).toEqual(["보국전자 에어셀 전기요 BKB-0503S 싱글"]);
    expect(names(null, "전기요", "한일 전기요 찾아요")).toEqual(["한일의료기 EMF 허스트 무자계 열선 전기요 싱글 HLY-202"]);
    expect(names(null, "세탁세제", "액츠 세탁세제 찾아요")).toEqual(["액츠 퍼펙트 딥클린 액체세제 리필 1.5L"]);
  });

  it("다른 한글 낱말 안에 든 브랜드 글자는 브랜드로 보지 않는다", () => {
    expect(hasBrandWord("하이테크 세탁세제", "테크")).toBe(false);
    expect(hasBrandWord("테크 세탁세제", "테크")).toBe(true);
    expect(hasBrandWord("이 테크 세제", "테크")).toBe(true);
    expect(names(null, "세탁세제", "하이테크 세탁세제 사고 싶어요")).toHaveLength(3);
  });

  it("R4-8: 레이저가 각인·포인터·프린터·센서·마우스 앞에 오면 브랜드(Razer)로 보지 않는다", () => {
    expect(names(null, "키보드", "레이저 각인 키보드 찾아요")).toHaveLength(3);
    expect(names(null, "키보드", "레이저로 각인된 키보드 찾아요")).toHaveLength(3);
    for (const text of ["레이저 포인터", "레이저 프린터", "레이저 센서 마우스", "레이저 마우스", "레이저각인 키보드", "레이저로 각인된 키보드", "레이저로 거리 재기"]) {
      expect(hasBrandWord(text, "레이저"), text).toBe(false);
      expect(knownBrandIn(text), text).toBeNull();
    }
    // 브랜드로 쓴 레이저는 그대로 알아본다.
    expect(hasBrandWord("레이저 키보드 찾아요", "레이저")).toBe(true);
    expect(knownBrandIn("레이저 블랙위도우")).toEqual(["razer", "레이저"]);
    expect(knownBrandIn("razer 키보드")).toEqual(["razer", "레이저"]);
    // 같은 문장에 일반 낱말과 브랜드가 함께 있으면 브랜드 쪽을 알아본다.
    expect(hasBrandWord("레이저 포인터 말고 레이저 키보드", "레이저")).toBe(true);
  });

  it("고정 후보 표에 있는 모든 후보의 브랜드를 알려 둔 목록이 알아본다", () => {
    for (const item of ["헤드셋", "전기요", "세탁세제", "키보드", "전기포트"]) {
      for (const candidate of demoCandidatesFor(item)) {
        expect(knownBrandIn(candidate.name), candidate.name).not.toBeNull();
      }
    }
  });

  it("브랜드가 없으면 품목의 고정 후보를 그대로 쓴다", () => {
    expect(names(null)).toHaveLength(3);
    expect(names(null, "모르는 품목")).toEqual([]);
  });

  it("대안 후보는 브랜드를 따르면서 이미 고른 기종을 뺀다", () => {
    const response = fallbackResponse(
      { requestId: id, kind: "alts", model: "소니 WH-CH720N" },
      { product: "소니 헤드셋", brand: "소니", item: "헤드셋" },
    );
    expect(response.kind === "alts" && response.items.map((entry) => entry.name)).toEqual(["소니 WH-CH520", "소니 WH-1000XM4"]);
  });
});

describe("화면이 href에 넣는 주소는 https만 받는다", () => {
  it.each(["http://example.com/a", "javascript:alert(1)", "data:text/html,x", "//example.com/a", "example.com", "", 3, null])(
    "isHttpsUrl 거부: %s",
    (value) => {
      expect(isHttpsUrl(value)).toBe(false);
    },
  );
  it("https 주소는 받는다", () => {
    expect(isHttpsUrl("https://example.com/a?b=1#c")).toBe(true);
  });
});

describe("화면 문구(RESEARCH_COPY)", () => {
  it("시연용 고정 후보 꼬리표가 가격·재고·할인 표현 없이 한 곳에 있다", () => {
    expect(RESEARCH_COPY.fixedNote).toBe("시연용 고정 후보");
    expect(hasForbidden(RESEARCH_COPY.fixedNote)).toBe(false);
  });
});
