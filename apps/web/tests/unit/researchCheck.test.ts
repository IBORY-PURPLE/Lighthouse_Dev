import { describe, expect, it } from "vitest";
import {
  cleanItems,
  cleanLines,
  cleanLinks,
  cleanQuestion,
  cleanText,
  dropForbiddenSentences,
  hasForbidden,
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

const allowed = (...urls: string[]) => new Set(urls.map((url) => urlKey(url)!));

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
  ])("걸리지 않는다: %s", (text) => {
    expect(hasForbidden(text)).toBe(false);
  });

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
    expect(cleanItems([{ name: "소니 WH-CH720N", url: "https://shop.example/a" }], new Set())).toEqual([]);
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
    expect(items).toEqual([
      { name: "모델 B", note: "", url: "https://shop.example/a", origin: "web" },
      { name: "모델 C", note: "무게가 가벼워요", url: "https://shop.example/a", origin: "web" },
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

  it("주소 키는 호스트 대소문자·끝 슬래시·# 뒤·프로토콜 차이를 무시하고 https만 받는다", () => {
    expect(urlKey("https://A.example/p/#x")).toBe(urlKey("https://a.example/p"));
    expect(urlKey("http://a.example/p")).toBeNull();
    expect(urlKey("ftp://a.example/p")).toBeNull();
    expect(urlKey("글자")).toBeNull();
    expect(urlKey("https://a.example/p?x=1")).not.toBe(urlKey("https://a.example/p?x=2"));
  });
});
