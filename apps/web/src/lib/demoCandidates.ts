import "server-only";
import { candidateSearchUrl } from "./shopLinks";
import type { CandidateView } from "./volunteerView";

// 시연용 예시 후보(2026-11-12). 품목(item)마다 상품명 3개를 사람이 골라 둔 표다.
// 상품명은 docs/plans/2026-11-12-volunteer-wireframe/demo-candidates.md의 표를 글자 그대로 옮겼다
// (웹 검색으로 존재를 확인한 이름. 상품 페이지의 옵션까지는 보지 않았다).
// 가격·재고는 저장하지도 보여 주지도 않는다. AI가 후보를 만들어 내는 길은 없다.
// 표에 없는 품목은 후보 0개이고, 화면은 "후보 직접 추가"를 보인다.

const TABLE: Record<string, readonly [string, string, string]> = {
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

export const DEMO_SELLER = "11번가 검색";

/** 품목의 시연용 후보. 호출마다 새 객체를 돌려준다. 모르는 품목은 빈 목록. */
export function demoCandidatesFor(item: string | null): CandidateView[] {
  const names = item ? TABLE[item.trim()] : undefined;
  if (!names) return [];
  return names.map((name, index) => ({
    id: `c${index + 1}`,
    name,
    seller: DEMO_SELLER,
    url: candidateSearchUrl(name),
  }));
}
