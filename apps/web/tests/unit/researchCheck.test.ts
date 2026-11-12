import { describe, expect, it } from "vitest";
import {
  cleanItems,
  cleanLines,
  cleanLinks,
  cleanQuestion,
  cleanText,
  dropForbiddenSentences,
  hasForbidden,
  modelTokens,
  unknownModelTokens,
  urlKey,
} from "@/lib/researchCheck";
import { parseJsonObject } from "@/lib/researchAi";
import {
  MOCK_ALT_ITEMS,
  MOCK_BENEFIT_LINKS,
  MOCK_MODEL_ITEMS,
  MOCK_PHOTO_DESCRIPTION,
  MOCK_PROS_HINTS,
  MOCK_REF_DIGEST,
  MOCK_REF_LINKS,
  MOCK_SUMMARY_TEXT,
} from "@/lib/researchMock";
import { demoCandidatesFor } from "@/lib/demoCandidates";

/** 검색 결과 주소 목록: 비교 키 → 검색 결과에 있던 그대로의 주소. */
const allowed = (...urls: string[]) => new Map(urls.map((url) => [urlKey(url)!, url] as const));

describe("hasForbidden: 가격·재고·할인 금액처럼 보이는 표현", () => {
  it.each([
    "29,000원이에요",
    "30만원 안쪽",
    "30만 원 정도",
    "3천 원",
    "$199",
    "199 달러",
    "50% 할인",
    "최저가",
    "할인가로 살 수 있어요",
    "재고가 있어요",
    "재고가 없어요",
    "재고는 충분해요",
    "품절이에요",
    "매진됐어요",
    // review-fixes F2: 우회 표현
    "지금 19,900에 팔아요",
    "정상가 39,000",
    "가격은 1만 9900",
    "3.9만 정도예요",
    "삼만 원이에요",
    "오만원대예요",
    "２９，０００원이에요",
    "10％ 할인돼요",
    "10퍼센트 할인",
    "10프로 할인",
    "39,000₩",
    "199$",
    "199불이에요",
    "1990엔",
    "19,900 won",
    "재고: 있음",
    "재고를 보유하고 있어요",
    "재고 상태 양호",
    "남은 수량 2개",
    "구매 가능해요",
    "판매 종료됐어요",
    "Sold out",
    "out of stock",
    "in stock",
    "쿠폰 적용 시 반값",
    "1+1 행사 중",
    // 1차 점검 지적 F2: 바로 옆 변형
    "지금 19900에 팔아요",
    "20000에서 시작해요",
    "29900짜리예요",
    "재고 거의 없어요",
    "재고 1개 남음",
    "남은 재고 적어요",
    "재고 많아요",
    "구입 가능해요",
    "구매 가능한 곳이에요",
    "쿠폰가 19900",
    "회원가로 사요",
    "삼십 프로 할인",
    "오 프로 적립",
    "이십 퍼센트 싸요",
    "십프로 할인",
    "USD 199",
    "199 dollars",
    "29.99 euros",
    "price is 199",
    "Price: $199",
    "20프로 할인",
    "10프로예요",
  ])("걸린다: %s", (text) => {
    expect(hasForbidden(text)).toBe(true);
  });

  it.each([
    "소니 WH-CH720N",
    "가볍고 오래 써도 편해요",
    "블루투스 5.3, 30시간 재생",
    "테팔 스마트 스텐 무선 주전자 1.7L KI150D",
    "퍼실 딥클린 파워젤 듀얼 액체세탁세제 리필 2L",
    "혜택 안내 페이지",
    "재고 여부는 쇼핑몰에서 확인해요",
    "원래 모델이에요",
    // 기종 이름의 숫자, 시간, 장수, 제품 이름의 프로는 걸리면 안 된다
    "WH-1000XM4",
    "LH-200",
    "배터리가 35시간 가요",
    "사진 3장을 올렸어요",
    "에어팟 프로",
    "에어팟 3 프로",
    "블루투스 5.3+EDR 지원",
    "만족스러워요",
    "5만큼 가벼워요",
    "사원증을 목에 걸어요",
    // 1차 점검 지적 F2: 새 패턴이 잡으면 안 되는 말
    "버즈2프로",
    "아이폰15프로",
    "갤럭시 버즈2 프로 이어폰",
    "5,000mAh 배터리",
    "20,000Hz까지 들려요",
    "10만 화소 카메라",
    "6+6시간 재생",
    "블루투스 5.3 지원",
    "구매 가능 여부는 쇼핑몰에서 확인해요",
    "구매 가능한지 직접 확인해 주세요",
    "2024에 나왔어요",
    "WH-1000XM4",
    "이 프로그램은 쉬워요",
    "오프로드용이에요",
    "삼성 전자 제품이에요",
    "price tag를 살펴봐요",
  ])("걸리지 않는다: %s", (text) => {
    expect(hasForbidden(text)).toBe(false);
  });

  // 3차 점검 R3-3: 숫자만 쓴 금액, 연도 우회, 판매 상태 낱말
  it.each([
    "19900이에요",
    "19900 정도예요",
    "값은 19900이에요",
    "가격이 19900 정도 해요",
    "할인해서 15900",
    "할인받아 15900에 샀대요",
    "2000에 팔아요",
    "지금 1990에 팔아요",
    "2000이에요",
    "29900짜리예요",
    "구매가 가능해요",
    "주문이 가능해요",
    "완판이에요",
    "완판됐어요",
    "솔드아웃이에요",
    "솔드 아웃 상태예요",
    "재입고 예정이에요",
    "입고 예정이래요",
    "10퍼 할인해요",
    "10퍼예요",
    "삼천 원이에요",
  ])("걸린다(3차): %s", (text) => {
    expect(hasForbidden(text)).toBe(true);
  });

  it.each([
    "아이폰 15 프로",
    "아이폰 15 프로 맥스",
    "갤럭시 버즈 2 프로",
    "갤럭시 버즈 2 프로 이어폰이에요",
    "3에서 5시간 걸려요",
    "1에서 5까지 점수를 줘요",
    "10에서 20 사이예요",
    "2023에서 2024로 바뀌었어요",
    "만 원하시면 알려 주세요",
    "더 보고 싶으시면 원하시는 걸 적어 주세요",
    "리뷰 1200개",
    "리뷰 1200개 정도예요",
    "리뷰 수는 1200개예요",
    "쿠폰 1200명이 받았대요",
    "2024년에 나왔어요",
    "2024에 나왔어요",
    "2024에 출시된 모델이에요",
    "2019년형이에요",
    "2024년 정도에 나왔어요",
    "구매가 가능한지 직접 확인해 주세요",
    "구매 가능 여부는 쇼핑몰에서 확인해요",
    "10퍼즐 게임이에요",
    "WH-1000XM4 에서 바뀐 점이에요",
    "5000mAh 배터리예요",
    "에어팟 프로예요",
    "1세대 모델이에요",
    "2개를 비교해요",
  ])("걸리지 않는다(3차): %s", (text) => {
    expect(hasForbidden(text)).toBe(false);
  });

  // 4차 R4-3: 한글 숫자 한 글자 금액, 퍼센트·범위·리뷰 수 오탐
  it.each([
    "만원대 이어폰 중에서 가벼워요",
    "천원짜리 케이스도 있어요",
    "만원이에요",
    "만원에 팔아요",
    "만 원짜리예요",
    "천 원대 제품이에요",
    "가격은 만원대예요",
    "오만원대예요",
    "삼만 원이에요",
    "수만 원 정도 해요",
    "몇천 원이면 사요",
    // 백원 동전처럼 일반 낱말도 걸리지만, 금액 우회를 막는 쪽이 안전해서 받아들인다(문장 하나가 빠질 뿐이다).
    "백원 동전이 필요해요",
    "10% 할인돼요",
    "20% 저렴해요",
    "10%off 행사",
    "할인율 10%",
    "최대 30%까지 할인",
    "리뷰 좋아요 19,900",
    "20000에서 시작해요",
  ])("걸린다(4차): %s", (text) => {
    expect(hasForbidden(text)).toBe(true);
  });

  it.each([
    // 만 원하다(원하다), 만원권, 일반 낱말
    "만 원하시면 알려 주세요",
    "블루투스만 원하시면 골라요",
    "노이즈 캔슬링만 원하시면 말해 주세요",
    "만원권 상품권은 없어요",
    "원하시는 만큼 고르세요",
    "천천히 읽어 보세요",
    "만약 소리가 작으면 올려요",
    "만들어요",
    // 퍼센트 사양: 돈 낱말이 없으면 금액이 아니다
    "배터리 80% 충전",
    "습도 50% 이상에서 써요",
    "효율 95%예요",
    "면 100% 커버예요",
    // 에서 뒤 숫자+단위 범위
    "배터리는 5000에서 6000mAh 사이예요",
    "1000에서 2000 사이 dpi로 바꿔요",
    "20000에서 40000Hz까지 들려요",
    // 리뷰 수, 사람 수
    "리뷰 1,200개",
    "리뷰 1,234",
    "리뷰 수는 1,234예요",
    "1만 이상의 후기가 있어요",
    "판매량 10만 이상이에요",
  ])("걸리지 않는다(4차): %s", (text) => {
    expect(hasForbidden(text)).toBe(false);
  });

  // 4차 재검토: 리뷰 문맥 예외에 조사·'구매자'를 넣어 생긴 우회는 다시 걸리고, 사양 낱말 뒤 큰 수는 통과한다.
  it.each([
    "구매자가 19,900에 샀대요",
    "후기도 19,900이 적당하대요",
    "구매자는 19,900 정도에 샀어요",
    "가격 1200이에요",
  ])("걸린다(4차 재검토): %s", (text) => {
    expect(hasForbidden(text)).toBe(true);
  });

  it.each(["높이 1200이에요", "크기 1200 정도예요", "해상도 1920에 맞춰져 있어요", "무게는 1200이에요"])(
    "걸리지 않는다(4차 재검토, 사양 숫자): %s",
    (text) => {
      expect(hasForbidden(text)).toBe(false);
    },
  );

  it("시연용 고정 후보 이름과 가짜 모드 응답은 모두 통과한다", () => {
    const names = ["헤드셋", "전기요", "세탁세제", "키보드", "전기포트"].flatMap((item) =>
      demoCandidatesFor(item).map((candidate) => candidate.name),
    );
    expect(names).toHaveLength(15);
    const mockTexts = [
      ...MOCK_MODEL_ITEMS.flatMap((item) => [item.name, item.note]),
      ...MOCK_ALT_ITEMS.flatMap((item) => [item.name, item.note]),
      ...MOCK_PROS_HINTS,
      ...MOCK_BENEFIT_LINKS.map((link) => link.title),
      ...MOCK_REF_DIGEST,
      ...MOCK_REF_LINKS.map((link) => link.title),
      MOCK_PHOTO_DESCRIPTION,
      MOCK_SUMMARY_TEXT,
    ];
    for (const text of [...names, ...mockTexts]) expect(hasForbidden(text), text).toBe(false);
  });
});

describe("문장 걸러내기", () => {
  it("금지 표현이 든 문장만 버리고 줄바꿈은 지킨다", () => {
    const text = "가볍고 편해요. 지금 29,000원이에요. 소리가 맑아요.\n재고가 없어요.\n배터리가 오래가요";
    expect(dropForbiddenSentences(text)).toBe("가볍고 편해요. 소리가 맑아요.\n배터리가 오래가요");
  });

  it("남는 글이 없으면 빈 글자다", () => {
    expect(cleanText("29,000원이에요. 품절이에요.", 200)).toBe("");
    expect(cleanText(42, 200)).toBe("");
  });

  it("긴 글은 자른다", () => {
    expect([...cleanText("가".repeat(500), 200)]).toHaveLength(200);
  });
});

describe("cleanItems: 출처가 검색 결과에 있는 후보만", () => {
  const known = allowed("https://shop.example/a", "https://blog.example/b/");

  it("출처 주소가 없거나 목록에 없는 후보는 버린다", () => {
    const items = cleanItems(
      [
        { name: "소니 WH-CH720N", note: "가벼워요", url: "https://shop.example/a" },
        { name: "지어낸 모델 ZX-999", note: "", url: "https://other.example/zz" },
        { name: "주소 없는 모델 QQ-111", note: "", url: null },
        { name: "주소 빈 모델", note: "", url: "" },
        { name: "http 모델 HT-1", note: "", url: "http://shop.example/a" },
        { name: "블로그 모델 BL-2", note: "", url: "https://BLOG.example/b#top" },
      ],
      known,
    );
    expect(items.map((item) => item.name)).toEqual(["소니 WH-CH720N", "블로그 모델 BL-2"]);
    expect(items.every((item) => item.origin === "web" && item.url)).toBe(true);
  });

  it("검색 결과 목록이 비어 있으면 아무것도 남지 않는다", () => {
    expect(cleanItems([{ name: "소니 WH-CH720N", url: "https://shop.example/a" }], new Map())).toEqual([]);
  });

  it("이름에 가격·재고 표현이 있으면 후보를 버리고, 설명에 있으면 설명만 비운다", () => {
    const items = cleanItems(
      [
        { name: "모델 A 29,000원 특가", note: "", url: "https://shop.example/a" },
        { name: "모델 B", note: "지금 품절이에요", url: "https://shop.example/a" },
        { name: "모델 C", note: "무게가 가벼워요", url: "https://shop.example/a" },
      ],
      known,
    );
    // 같은 주소를 두 후보가 쓰면 첫 후보만 주소를 갖는다(그 기종의 페이지가 아니기 때문이다).
    expect(items).toEqual([
      { name: "모델 B", note: "", url: "https://shop.example/a", origin: "web" },
      { name: "모델 C", note: "무게가 가벼워요", url: null, origin: "web" },
    ]);
  });

  it("중복 이름, 제외할 이름(이미 고른 기종), 6번째 이후는 뺀다", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      name: `모델 ${index}`,
      note: "",
      url: "https://shop.example/a",
    }));
    expect(cleanItems(many, known)).toHaveLength(5);
    const items = cleanItems(
      [
        { name: "Sony WH-CH720N", url: "https://shop.example/a" },
        { name: "소니 WH-CH520", url: "https://shop.example/a" },
        { name: "소니 wh-ch520", url: "https://shop.example/a" },
      ],
      known,
      "sony wh-ch720n",
    );
    expect(items.map((item) => item.name)).toEqual(["소니 WH-CH520"]);
  });

  it("배열이 아니거나 모양이 틀린 항목은 무시한다", () => {
    expect(cleanItems("x", known)).toEqual([]);
    expect(cleanItems([null, 3, "a", [], { name: 5, url: "https://shop.example/a" }], known)).toEqual([]);
  });
});

describe("cleanLinks", () => {
  const known = allowed("https://a.example/x", "https://b.example/y");

  it("출처 목록에 있는 링크만 남기고, 같은 주소는 한 번만 남긴다", () => {
    const links = cleanLinks(
      [
        { title: "혜택 안내", url: "https://a.example/x" },
        { title: "같은 주소", url: "https://a.example/x/" },
        { title: "목록에 없음", url: "https://c.example/z" },
        { title: "javascript", url: "javascript:alert(1)" },
      ],
      known,
    );
    expect(links).toEqual([{ title: "혜택 안내", url: "https://a.example/x", origin: "web" }]);
  });

  it("제목에 금지 표현이 있거나 비었으면 도메인 이름으로 바꾼다", () => {
    const links = cleanLinks(
      [
        { title: "지금 50% 할인", url: "https://a.example/x" },
        { title: "", url: "https://b.example/y" },
      ],
      known,
    );
    expect(links.map((link) => link.title)).toEqual(["a.example", "b.example"]);
  });

  it("최대 4개", () => {
    const urls = Array.from({ length: 6 }, (_, index) => `https://s${index}.example/p`);
    const links = cleanLinks(urls.map((url) => ({ title: "t", url })), allowed(...urls));
    expect(links).toHaveLength(4);
  });
});

describe("cleanLines, cleanQuestion", () => {
  it("금지 표현이 든 줄·빈 줄·중복은 버리고 개수와 길이를 맞춘다", () => {
    expect(cleanLines(["착용감은요?", " ", "29,000원인가요?", "착용감은요?", "소리는요?", "배터리는요?", "버튼은요?"], 3, 80)).toEqual([
      "착용감은요?",
      "소리는요?",
      "배터리는요?",
    ]);
    expect(cleanLines(["가".repeat(200)], 3, 80)[0]).toHaveLength(80);
    expect(cleanLines("x", 3, 80)).toEqual([]);
  });

  it("질문은 길이·금지 표현·필수 이름을 확인하고 어긋나면 기본 문구로 바꾼다", () => {
    const fallback = "기본 질문";
    expect(cleanQuestion("소니 WH-CH720N의 장점은 뭔가요?", fallback, ["소니 WH-CH720N"])).toBe(
      "소니 WH-CH720N의 장점은 뭔가요?",
    );
    expect(cleanQuestion("다른 제품의 장점은 뭔가요?", fallback, ["소니 WH-CH720N"])).toBe(fallback);
    expect(cleanQuestion("A, B를 왜 고민했나요?", fallback, ["A", "C"])).toBe(fallback);
    expect(cleanQuestion("29,000원인데 괜찮았나요?", fallback)).toBe(fallback);
    expect(cleanQuestion("가".repeat(300), fallback)).toBe(fallback);
    expect(cleanQuestion(7, fallback)).toBe(fallback);
  });
});

describe("parseJsonObject / urlKey", () => {
  it("코드 블록이나 앞뒤 설명이 붙어도 JSON 객체를 꺼낸다", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('결과예요 {"a":{"b":2}} 끝')).toEqual({ a: { b: 2 } });
    expect(parseJsonObject("[1,2]")).toBeNull();
    expect(parseJsonObject("그냥 글")).toBeNull();
    expect(parseJsonObject('{"잘린":')).toBeNull();
  });

  it("F5: www.·끝 슬래시·utm_* 같은 추적 값이 달라도 같은 출처고, 화면에는 검색 결과의 주소가 간다", () => {
    expect(urlKey("https://www.x.com/a/?utm_source=openai")).toBe(urlKey("https://x.com/a"));
    expect(urlKey("https://x.com/a?utm_medium=a&utm_campaign=b#top")).toBe(urlKey("https://X.com/a/"));
    expect(urlKey("https://x.com/a?id=1&utm_source=openai")).toBe(urlKey("https://x.com/a?id=1"));
    expect(urlKey("https://x.com/a?id=1")).not.toBe(urlKey("https://x.com/a?id=2"));
    expect(urlKey("http://www.x.com/a")).toBeNull();
    const known = allowed("https://www.x.com/a/?utm_source=openai");
    const [item] = cleanItems([{ name: "모델 X-100", url: "https://x.com/a" }], known);
    expect(item.url).toBe("https://www.x.com/a/?utm_source=openai");
    expect(cleanItems([{ name: "모델 X-100", url: "http://x.com/a" }], known)).toEqual([]);
    const [link] = cleanLinks([{ title: "안내", url: "https://X.com/a#frag" }], known);
    expect(link.url).toBe("https://www.x.com/a/?utm_source=openai");
  });

  it("주소 키는 호스트 대소문자·끝 슬래시·# 뒤·프로토콜 차이를 무시하고 https만 받는다", () => {
    expect(urlKey("https://A.example/p/#x")).toBe(urlKey("https://a.example/p"));
    expect(urlKey("http://a.example/p")).toBeNull();
    expect(urlKey("ftp://a.example/p")).toBeNull();
    expect(urlKey("글자")).toBeNull();
    expect(urlKey("https://a.example/p?x=1")).not.toBe(urlKey("https://a.example/p?x=2"));
  });
});

describe("F3: 자료에 없는 기종 이름이 든 문장은 버린다", () => {
  const material = ["소니 헤드셋", "소니", "헤드셋", "소니 WH-CH720N", "Bose QC45", "가볍고 편해요"];

  it("기종 모양 토큰을 뽑는다", () => {
    expect(modelTokens("WH-1000XM5도 함께 고려해 보세요. QC45와 LH-200, ULT WEAR")).toEqual([
      "WH-1000XM5",
      "QC45",
      "LH-200",
    ]);
    expect(modelTokens("블루투스 5.3, 35시간, 40mm, USB-C, mp3, 1.7L")).toEqual([]);
  });

  it("자료에 있는 이름(표기가 달라도)은 알려진 것으로 본다", () => {
    expect(unknownModelTokens("WH-CH720N은 가벼워요", material)).toEqual([]);
    expect(unknownModelTokens("wh ch720n", material)).toEqual([]);
    expect(unknownModelTokens("WH-1000XM5도 함께 고려해 보세요", material)).toEqual(["WH-1000XM5"]);
  });

  it("핵심 정리·사진 설명: 자료에 없는 기종이 든 문장만 빠지고 나머지는 남는다", () => {
    const text = "소니 WH-CH720N은 가벼워요. WH-1000XM5도 함께 고려해 보세요.\n버튼이 커요.";
    expect(cleanText(text, 600, material)).toBe("소니 WH-CH720N은 가벼워요.\n버튼이 커요.");
    expect(cleanText("WH-1000XM5도 함께 고려해 보세요.", 600, material)).toBe("");
    // 자료를 주지 않으면 이 검사는 하지 않는다
    expect(cleanText("WH-1000XM5도 고려해 보세요.", 600)).toBe("WH-1000XM5도 고려해 보세요.");
  });

  it("힌트 줄과 질문도 같다(질문은 기본 문구로 돌아간다)", () => {
    expect(cleanLines(["착용감은요?", "QC35와 비교하면 어떤가요?"], 3, 80, material)).toEqual(["착용감은요?"]);
    expect(cleanQuestion("QC35와 비교한 장점을 알려 주세요.", "기본 질문", [], material)).toBe("기본 질문");
    expect(cleanQuestion("소니 WH-CH720N의 장점을 알려 주세요.", "기본 질문", ["소니 WH-CH720N"], material)).toBe(
      "소니 WH-CH720N의 장점을 알려 주세요.",
    );
  });
});
