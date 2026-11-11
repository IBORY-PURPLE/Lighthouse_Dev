import { describe, expect, it } from "vitest";
import { DEMO_WAITING } from "@/lib/demoRequests";
import { demoCandidatesFor } from "@/lib/demoCandidates";
import { candidateSearchUrl, searchQueryOf, SHOPS, shopSearchUrl } from "@/lib/shopLinks";

// 이름은 docs/plans/2026-11-12-volunteer-wireframe/demo-candidates.md 표를 글자 그대로 옮겼다(웹 검색으로 존재를 확인한 이름).
const EXPECTED: Record<string, string[]> = {
  헤드셋: ["소니 WH-CH720N", "소니 WH-CH520", "소니 WH-1000XM4"],
  전기요: [
    "보국전자 에어셀 전기요 BKB-0503S 싱글",
    "일월 프리미엄 탄소 카본 워셔블 전기요 IW-KM59 싱글",
    "한일의료기 EMF 허스트 무자계 열선 전기요 싱글 HLY-202",
  ],
  세탁세제: [
    "퍼실 딥클린 파워젤 듀얼 액체세탁세제 리필 2L",
    "테크 베이킹소다 구연산 액체세제 리필 1.8L",
    "액츠 퍼펙트 딥클린 액체세제 리필 1.5L",
  ],
  키보드: [
    "로지텍 K380",
    "로지텍 MK295 사일런트 무선 키보드 마우스 세트",
    "로지텍 페블2 K380S",
  ],
  전기포트: [
    "테팔 스마트 스텐 무선 주전자 1.7L KI150D",
    "테팔 노베오 플러스 무선 주전자 1.7L KO2828",
    "키친아트 라팔 뉴 멀티 포트 1.7 KP-1007FT",
  ],
};

describe("시연용 후보", () => {
  it("다섯 품목마다 후보 3개이고 이름이 demo-candidates.md 표와 같다", () => {
    for (const [item, names] of Object.entries(EXPECTED)) {
      const candidates = demoCandidatesFor(item);
      expect(candidates.map((candidate) => candidate.name)).toEqual(names);
      expect(candidates.map((candidate) => candidate.id)).toEqual(["c1", "c2", "c3"]);
    }
  });

  it("시연 대기 요청 다섯 건의 품목이 모두 후보 표에 있다", () => {
    for (const request of DEMO_WAITING) {
      expect(demoCandidatesFor(request.item)).toHaveLength(3);
    }
  });

  it("이름은 비어 있지 않고, 가격·재고 글자가 없고, 링크는 11번가 검색 https다", () => {
    for (const item of Object.keys(EXPECTED)) {
      for (const candidate of demoCandidatesFor(item)) {
        expect(candidate.name.trim()).not.toBe("");
        expect(candidate.seller).toBe("11번가 검색");
        expect(candidate.url).toBe(candidateSearchUrl(candidate.name));
        expect(candidate.url.startsWith("https://search.11st.co.kr/pc/total-search?kwd=")).toBe(true);
        const text = JSON.stringify(candidate);
        expect(text).not.toMatch(/원|재고|₩|\d,\d{3}|가격/);
      }
    }
  });

  it("모르는 품목이나 품목 없음은 후보가 0개다", () => {
    expect(demoCandidatesFor("실내화")).toEqual([]);
    expect(demoCandidatesFor("")).toEqual([]);
    expect(demoCandidatesFor(null)).toEqual([]);
  });

  it("돌려준 목록을 고쳐도 다음 호출에 영향이 없다", () => {
    const first = demoCandidatesFor("헤드셋");
    first[0].name = "바꿈";
    expect(demoCandidatesFor("헤드셋")[0].name).toBe("소니 WH-CH720N");
  });
});

describe("쇼핑몰 검색 주소", () => {
  it("세 쇼핑몰 주소 형식에 검색어를 encodeURIComponent로 붙인다", () => {
    expect(SHOPS.map((shop) => shop.name)).toEqual(["쿠팡", "11번가", "G마켓"]);
    const query = "소니 헤드셋 & 무선";
    const encoded = encodeURIComponent(query);
    expect(shopSearchUrl("coupang", query)).toBe(`https://www.coupang.com/np/search?q=${encoded}`);
    expect(shopSearchUrl("11st", query)).toBe(`https://search.11st.co.kr/pc/total-search?kwd=${encoded}`);
    expect(shopSearchUrl("gmarket", query)).toBe(`https://www.gmarket.co.kr/n/search?keyword=${encoded}`);
    expect(encoded).not.toContain("&");
  });

  it("검색어는 브랜드와 품목을 잇고, 품목이 없으면 제품 답을 쓴다", () => {
    expect(searchQueryOf({ brand: "소니", item: "헤드셋", product: "소니 무선 헤드셋 사고 싶어요" })).toBe("소니 헤드셋");
    expect(searchQueryOf({ brand: null, item: "키보드", product: "무선 키보드, 조용한 것" })).toBe("키보드");
    expect(searchQueryOf({ brand: "소니", item: null, product: "아무거나 제품" })).toBe("아무거나 제품");
    expect(searchQueryOf({ brand: null, item: "  ", product: "아무거나 제품" })).toBe("아무거나 제품");
  });

  it("후보 링크는 11번가 주소에 상품명을 붙인다", () => {
    expect(candidateSearchUrl("로지텍 K380")).toBe(
      `https://search.11st.co.kr/pc/total-search?kwd=${encodeURIComponent("로지텍 K380")}`,
    );
  });
});
