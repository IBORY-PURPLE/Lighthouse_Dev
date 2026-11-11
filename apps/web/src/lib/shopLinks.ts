// 쇼핑몰 검색 주소. 브라우저와 서버가 함께 쓴다(server-only가 아니다).
// 쿠팡·G마켓 주소 형식은 봇 차단(403)으로 curl로 확인하지 못했다. 브라우저 확인은 사람 판정(B1)이다.

export type ShopId = "coupang" | "11st" | "gmarket";

export const SHOPS: readonly { id: ShopId; name: string; base: string }[] = [
  { id: "coupang", name: "쿠팡", base: "https://www.coupang.com/np/search?q=" },
  { id: "11st", name: "11번가", base: "https://search.11st.co.kr/pc/total-search?kwd=" },
  { id: "gmarket", name: "G마켓", base: "https://www.gmarket.co.kr/n/search?keyword=" },
];

function baseOf(shop: ShopId): string {
  const found = SHOPS.find((entry) => entry.id === shop);
  if (!found) throw new Error(`unknown shop: ${shop}`);
  return found.base;
}

export function shopSearchUrl(shop: ShopId, query: string): string {
  return `${baseOf(shop)}${encodeURIComponent(query)}`;
}

/** 후보 링크: 상품 페이지가 아니라 그 상품명의 11번가 검색 결과다. */
export function candidateSearchUrl(name: string): string {
  return shopSearchUrl("11st", name);
}

/** 직접 찾기의 검색어. 브랜드와 품목을 잇고, 품목이 없으면 제품 답을 쓴다. */
export function searchQueryOf(request: {
  brand: string | null;
  item: string | null;
  product: string;
}): string {
  const item = request.item?.trim();
  if (!item) return request.product.trim();
  return [request.brand?.trim(), item].filter(Boolean).join(" ");
}
