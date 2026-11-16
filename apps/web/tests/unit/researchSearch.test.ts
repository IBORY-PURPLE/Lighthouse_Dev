import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasForbidden, urlKey } from "@/lib/researchCheck";
import {
  BENEFIT_BRANCHES,
  BENEFITS_UNITS,
  benefitLinkEntries,
  benefitMessages,
  benefitsHeadline,
  cleanBenefitItems,
  cleanProducts,
  experienceBranches,
  hasNoExperience,
  isAiClosedHost,
  productsMessages,
  searchBenefits,
  searchProducts,
  type BenefitGroup,
  type BenefitItem,
  type ProductItem,
} from "@/lib/researchSearch";
import { visiblePending } from "@/lib/researchApi";
import { DEFAULT_CAPS, SEARCH_PENDING_MS } from "@/lib/researchSession";

// 같이 고민한 제품 목록(질문 4)과 혜택 1회차(질문 6)의 항목 검사·메시지 만들기·AI 호출. 가짜 OpenAI(Responses)로 돈다.

const { responsesCreate } = vi.hoisted(() => ({ responsesCreate: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    responses = { create: responsesCreate };
  }
  return { ...actual, default: FakeOpenAI, OpenAI: FakeOpenAI };
});

const allowedOf = (urls: string[]) => new Map(urls.map((url) => [urlKey(url)!, url]));
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const OFFICIAL = BENEFIT_BRANCHES[0];

/** Responses 응답 모양: 검색 소스와 인용 주소·제목, 모델이 낸 JSON 글. */
function reply(json: unknown, urls: string[], titles: string[] = []) {
  return {
    usage: { input_tokens: 100, output_tokens: 40 },
    output: [
      { type: "web_search_call", action: { type: "search", sources: urls.map((url) => ({ url })) } },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(json),
            annotations: urls.map((url, index) => ({ type: "url_citation", url, title: titles[index] ?? "" })),
          },
        ],
      },
    ],
  };
}

describe("하루 상한 기본값", () => {
  it("QA 1회 2.5만 원 기준: 웹 검색 380회, AI 호출 1,500회, 요청당 상한은 그대로", () => {
    expect(DEFAULT_CAPS).toEqual({
      turns: 40,
      searches: 12,
      photoUploads: 6,
      reviews: 3,
      dailySearches: 380,
      dailyAi: 1500,
    });
    // 최악의 검색 비용: 380회 x 약 60원 = 약 2.28만 원(AI 턴 약 1원 x 1,500 포함해도 2.5만 원 안).
    expect(DEFAULT_CAPS.dailySearches * 60 + DEFAULT_CAPS.dailyAi).toBeLessThanOrEqual(25_000);
    expect(BENEFITS_UNITS).toBe(3);
  });
});

describe("cleanProducts: 같이 고민한 제품 이름·특징·주소 검사", () => {
  const material = ["소니 헤드셋", "소니 WH-1000XM4", "소니 WH-CH720N 무선 헤드폰", "https://www.sony.co.kr/headphones/wh-ch720n"];
  const allowed = allowedOf(["https://www.sony.co.kr/headphones/wh-ch720n", "https://www.bose.co.kr/qc45", "https://shop.example.com/cat"]);

  it("검색 결과에 있던 주소만 남기고, 제 주소가 아닌 항목·자료에 없는 기종 이름·금지 표현 이름은 버린다", () => {
    const items = cleanProducts(
      [
        { name: "소니 WH-CH720N", feature: "가볍고 노이즈 캔슬링이 있어요", pageUrl: "https://www.sony.co.kr/headphones/wh-ch720n" },
        { name: "소니 XZ-9999", feature: "지어낸 기종이에요", pageUrl: "https://www.bose.co.kr/qc45" },
        { name: "최저가 헤드셋", feature: "싸요", pageUrl: "https://www.bose.co.kr/qc45" },
        { name: "소니 WH-CH520", feature: "인용에 없는 주소", pageUrl: "https://www.unknown.example.com/x" },
        { name: "보스 헤드셋", feature: "귀가 편해요", pageUrl: "http://www.bose.co.kr/qc45" },
      ],
      allowed,
      material,
    );
    expect(items).toEqual([
      { name: "소니 WH-CH720N", feature: "가볍고 노이즈 캔슬링이 있어요", pageUrl: "https://www.sony.co.kr/headphones/wh-ch720n" },
    ]);
  });

  it("이미 고른 기종은 빼고, 이름이 겹치면 한 번만, 같은 주소를 쓰는 둘째 제품은 버린다", () => {
    const items = cleanProducts(
      [
        { name: "소니 WH-1000XM4", feature: "이미 고른 기종", pageUrl: "https://www.bose.co.kr/qc45" },
        { name: "보스 헤드셋", feature: "귀가 편해요", pageUrl: "https://www.bose.co.kr/qc45" },
        { name: "보스  헤드셋", feature: "같은 이름", pageUrl: "https://www.bose.co.kr/qc45" },
        { name: "젠하이저 헤드셋", feature: "소리가 맑아요", pageUrl: "https://www.bose.co.kr/qc45" },
      ],
      allowed,
      material,
      ["소니 WH-1000XM4"],
    );
    expect(items.map((item) => [item.name, item.pageUrl])).toEqual([
      ["보스 헤드셋", "https://www.bose.co.kr/qc45"],
    ]);
  });

  it("evidence가 있으면 이름은 인용에 근거가 있어야 한다(한글+숫자 이름과 인용에 없는 이름은 버린다)", () => {
    const texts = ["삼성 갤럭시 버즈2 프로 | 삼성닷컴", "https://www.samsung.com/sec/buds2-pro/", "소니 WH-CH720N 무선 헤드폰"];
    const generic = ["Sony", "헤드폰"];
    const urls = ["https://a.example.com/1", "https://a.example.com/2", "https://a.example.com/3", "https://a.example.com/4"];
    const items = cleanProducts(
      [
        { name: "갤럭시 버즈2 프로", feature: "작아요", pageUrl: urls[0] },
        { name: "갤럭시 버즈3", feature: "새 기종이에요", pageUrl: urls[1] },
        { name: "소니 헤드폰 플래그십", feature: "지어낸 이름", pageUrl: urls[2] },
        { name: "소니 WH-CH720N", feature: "가벼워요", pageUrl: urls[3] },
      ],
      allowedOf(urls),
      [...generic, ...texts],
      [],
      { texts, generic },
    );
    expect(items.map((item) => item.name)).toEqual(["갤럭시 버즈2 프로", "소니 WH-CH720N"]);
  });

  it("특징에서 가격·재고 문장과 없는 기종 이름 문장은 버리고 60자로 자르며, 5개까지만 남긴다", () => {
    const urls = Array.from({ length: 7 }, (_, index) => `https://shop.example.com/p/${index}`);
    const raw = urls.map((pageUrl, index) => ({
      name: `제품 ${index + 1}호`,
      feature: index === 0 ? "가벼워요. 19,900원이에요. 재고가 많아요. QX-777과 같아요." : "가".repeat(100),
      pageUrl,
    }));
    const items = cleanProducts(raw, allowedOf(urls), []);
    expect(items).toHaveLength(5);
    expect(items[0]!.feature).toBe("가벼워요.");
    expect([...items[1]!.feature]).toHaveLength(60);
    for (const item of items) {
      expect(hasForbidden(`${item.name} ${item.feature}`)).toBe(false);
    }
  });
});

describe("cleanBenefitItems: 혜택 항목 검사", () => {
  const url = (name: string) => `https://example.com/benefits/${name}`;
  const base = (over: Record<string, unknown> = {}) => ({
    title: "공식몰 사은품 행사",
    condition: "공식몰에서 주문하면 받아요",
    compare: "받으신 경험과 비슷한 종류예요",
    url: url("a"),
    ...over,
  });
  const run = (raw: unknown[], allowedUrls: string[], experience = "카드 할인을 받았어요", seenUrls = new Set<string>()) =>
    cleanBenefitItems(raw, OFFICIAL!, allowedOf(allowedUrls), ["소니 WH-CH720N"], { experience, seenUrls });

  it("금지 표현(금액·할인율·최저가)이 든 항목은 제목·조건·비교 어디에 있어도 버린다", () => {
    const items = run(
      [
        base({ title: "최대 20% 할인 행사", url: url("a") }),
        base({ condition: "19,900원 이상 주문하면", url: url("b") }),
        base({ compare: "최저가보다 싸요", url: url("c") }),
        base({ title: "사은품 행사", url: url("d") }),
      ],
      [url("a"), url("b"), url("c"), url("d")],
    );
    expect(items.map((item) => item.url)).toEqual([url("d")]);
    expect(items.every((item) => ![item.title, item.condition, item.compare].some(hasForbidden))).toBe(true);
  });

  it("인용에 없는 주소와 https가 아닌 주소는 버리고, 같은 주소는 한 번만 남긴다(다른 갈래가 쓴 주소 포함)", () => {
    const seen = new Set<string>([urlKey(url("z"))!]);
    const items = run(
      [
        base({ url: url("a") }),
        base({ title: "또 같은 주소", url: `${url("a")}?utm_source=x` }),
        base({ title: "인용에 없음", url: url("nope") }),
        base({ title: "http 주소", url: "http://example.com/benefits/h" }),
        base({ title: "다른 갈래가 이미 씀", url: url("z") }),
      ],
      [url("a"), url("z"), "http://example.com/benefits/h"],
      "카드 할인을 받았어요",
      seen,
    );
    expect(items.map((item) => item.url)).toEqual([url("a")]);
  });

  it("자료에 없는 기종 이름이 든 항목은 버린다", () => {
    const items = run(
      [base({ title: "소니 QX-777 사은품", url: url("a") }), base({ title: "소니 WH-CH720N 사은품", url: url("b") })],
      [url("a"), url("b")],
    );
    expect(items.map((item) => item.url)).toEqual([url("b")]);
  });

  it("AI가 열 수 없는 곳(쿠팡 등)은 mode check, 그 밖은 ai이고 종류 이름·id가 붙는다", () => {
    const market = BENEFIT_BRANCHES[2]!;
    const items = cleanBenefitItems(
      [
        base({ title: "와우 멤버십 배송", url: "https://www.coupang.com/np/campaigns/1" }),
        base({ title: "오픈마켓 쿠폰", url: "https://www.gmarket.co.kr/event/2" }),
        base({ title: "제조사 안내", url: "https://www.sony.co.kr/event/3" }),
      ],
      market,
      allowedOf(["https://www.coupang.com/np/campaigns/1", "https://www.gmarket.co.kr/event/2", "https://www.sony.co.kr/event/3"]),
      [],
      { experience: "", seenUrls: new Set() },
    );
    expect(items.map((item) => [item.mode, item.kind, item.id])).toEqual([
      ["check", market.label, "market-1"],
      ["check", market.label, "market-2"],
      ["ai", market.label, "market-3"],
    ]);
  });

  it("한 갈래는 3개까지, 비교 줄이 비면 서버 문구로 채운다(경험과 같은 종류·새 종류·경험 없음)", () => {
    const urls = Array.from({ length: 5 }, (_, index) => url(`m${index}`));
    const raw = urls.map((address, index) => base({ title: `혜택 ${index + 1}`, compare: "", url: address }));
    const card = BENEFIT_BRANCHES[1]!;
    const same = cleanBenefitItems(raw, card, allowedOf(urls), [], { experience: "카드 혜택을 받았어요", seenUrls: new Set() });
    expect(same).toHaveLength(3);
    expect(same[0]!.compare).toContain("같은 종류");
    const fresh = cleanBenefitItems(raw, card, allowedOf(urls), [], { experience: "무료 배송을 받았어요", seenUrls: new Set() });
    expect(fresh[0]!.compare).toContain("새 종류");
    const none = cleanBenefitItems(raw, card, allowedOf(urls), [], { experience: "혜택은 없었어요", seenUrls: new Set() });
    expect(none[0]!.compare).toContain("없었다고");
    for (const item of [...same, ...fresh, ...none]) expect(hasForbidden(item.compare)).toBe(false);
  });

  it("긴 글은 자르고(제목 60·조건 80·비교 80), 주소가 300자를 넘는 항목은 버린다", () => {
    const long = `https://example.com/${"a".repeat(400)}`;
    const items = run(
      [base({ title: "가".repeat(100), condition: "나".repeat(200), compare: "다".repeat(200), url: url("a") }), base({ url: long })],
      [url("a"), long],
    );
    expect(items).toHaveLength(1);
    expect([...items[0]!.title]).toHaveLength(60);
    expect([...items[0]!.condition]).toHaveLength(80);
    expect([...items[0]!.compare]).toHaveLength(80);
  });
});

describe("경험 알아보기와 AI가 열 수 없는 곳", () => {
  it("없다는 답은 빈 갈래, 그 밖은 낱말로 갈래를 알아본다", () => {
    expect(hasNoExperience("")).toBe(true);
    expect(hasNoExperience("없었어요")).toBe(true);
    expect(hasNoExperience("혜택은 없었어요")).toBe(true);
    expect(hasNoExperience("카드 할인을 받았어요")).toBe(false);
    expect(experienceBranches("없었어요")).toEqual([]);
    expect(experienceBranches("카드 할인과 무료 배송을 받았어요")).toEqual(["card", "market"]);
    expect(experienceBranches("공식몰 사은품을 받았어요")).toEqual(["official"]);
  });

  it("쿠팡·G마켓·11번가·네이버 쇼핑은 직접 확인, 제조사·카드사는 아니다", () => {
    for (const closed of [
      "https://www.coupang.com/np/search?q=a",
      "https://m.coupang.com/vm/1",
      "https://www.gmarket.co.kr/n/search",
      "https://search.11st.co.kr/pc/total-search",
      "https://smartstore.naver.com/x",
      "not a url",
    ]) {
      expect(isAiClosedHost(closed), closed).toBe(true);
    }
    for (const open of ["https://www.sony.co.kr/event", "https://www.shinhancard.com/x", "https://notcoupang.com.example.org/"]) {
      expect(isAiClosedHost(open), open).toBe(false);
    }
  });
});

describe("메시지 만들기", () => {
  const item = (index: number, branch = "official", size = 80): BenefitItem => ({
    id: `${branch}-${index}`,
    title: "가".repeat(60),
    kind: "공식몰·제조사 행사",
    condition: "나".repeat(size),
    compare: "다".repeat(size),
    url: `https://example.com/${branch}/${"x".repeat(250)}${index}`,
    mode: "ai",
  });
  const group = (branch: BenefitGroup["branch"], count: number, label = branch): BenefitGroup => ({
    branch,
    label,
    items: Array.from({ length: count }, (_, index) => item(index + 1, branch)),
  });

  it("머리 줄에 경험과 같은 종류 n·새 종류 m이 든다", () => {
    const groups = [group("official", 2), group("card", 1), group("market", 3)];
    expect(benefitsHeadline(groups, "카드 할인을 받았어요")).toBe(
      "혜택 6개를 찾았어요. 받으신 경험과 같은 종류 1개, 새 종류 5개예요.",
    );
    expect(benefitsHeadline(groups, "없었어요")).toContain("같은 종류 0개, 새 종류 6개");
    expect(hasForbidden(benefitsHeadline(groups, "카드"))).toBe(false);
  });

  it("갈래마다 메시지 하나로 나눈다: 머리 줄은 첫 메시지에만, 본문은 모두 8,192바이트 안, body.kind는 benefits", () => {
    const messages = benefitMessages(
      [group("official", 3), { branch: "card", label: "카드·결제 혜택", items: [] }, group("market", 3)],
      "카드 할인을 받았어요",
      "소니 헤드셋",
      "ok",
    );
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.slot)).toEqual(["benefits", "benefits"]);
    expect(messages[0]!.body).toMatchObject({ kind: "benefits" });
    expect(String(messages[0]!.body.headline)).toContain("혜택 6개를 찾았어요");
    expect(String(messages[1]!.body.headline)).not.toContain("찾았어요");
    for (const message of messages) {
      expect(message.tag).toBe("search");
      expect(bytes(message.body)).toBeLessThanOrEqual(8192);
    }
  });

  it("한 갈래가 8,192바이트를 넘으면 그 갈래를 더 나누고, 어느 메시지도 한도를 넘지 않는다", () => {
    // 항목 하나가 약 1.2KB라 12개는 한 메시지(7,000바이트 예산)에 다 못 든다.
    const big = group("official", 12);
    const messages = benefitMessages([big], "없었어요", "소니 헤드셋", "ok");
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(bytes(message.body)).toBeLessThanOrEqual(8192);
    const total = messages.reduce((sum, message) => sum + (message.body.items as unknown[]).length, 0);
    expect(total).toBe(12);
    expect(String(messages[1]!.body.headline)).not.toContain("찾았어요");
  });

  it("항목이 하나도 없으면 안내 글과 쇼핑몰 바로가기 한 메시지, 한도에 걸리면 그 안내를 쓴다", () => {
    const [none] = benefitMessages([], "", "소니 헤드셋", "fallback");
    expect(none!.body).toMatchObject({ kind: "text" });
    expect((none!.body.shortcuts as unknown[]).length).toBeGreaterThan(0);
    expect(none!.ai).toBe("fallback");
    const [capped] = benefitMessages([], "", "소니 헤드셋", "capped", "오늘 AI 사용 한도에 닿았어요.");
    expect(capped!.body.text).toBe("오늘 AI 사용 한도에 닿았어요.");
    expect(capped!.ai).toBe("capped");
  });

  it("제품 카드 메시지: products 모양, 건너뛰기·직접 적기 이름표, 비면 안내 글", () => {
    const items: ProductItem[] = [{ name: "소니 WH-CH720N", feature: "가벼워요", pageUrl: "https://www.sony.co.kr/x" }];
    const [card] = productsMessages(items, "ok");
    expect(card).toMatchObject({ role: "ai", tag: "search", slot: "alts", ai: "ok" });
    expect(card!.body).toMatchObject({ kind: "products", items, noneLabel: "같이 고민한 제품 없어요", ownLabel: "직접 적을게요" });
    const [empty] = productsMessages([], "fallback");
    expect(empty!.body).toMatchObject({ kind: "text" });
  });

  it("보인 링크 목록은 혜택 링크만 담는다", () => {
    expect(benefitLinkEntries([group("official", 2)]).map((entry) => entry.slot)).toEqual(["benefits", "benefits"]);
  });
});

describe("visiblePending: 검색 중 표시", () => {
  it("{kind}만 보이고, 오래된 표시는 걸러 낸다", () => {
    const now = 1_000_000;
    expect(visiblePending({ search: { kind: "benefits", at: now - 1000 }, shownAlts: ["a"] }, now)).toEqual({
      search: { kind: "benefits" },
      shownAlts: ["a"],
    });
    expect(visiblePending({ search: { kind: "alts", at: now - SEARCH_PENDING_MS - 1 } }, now)).toEqual({});
    expect(visiblePending({ search: "bad" }, now)).toEqual({});
    const plain = { shownModels: ["a"] };
    expect(visiblePending(plain, now)).toBe(plain);
  });
});

describe("AI 호출(가짜 OpenAI)", () => {
  const context = { product: "소니 헤드셋 찾아줘", brand: "Sony", item: "헤드셋" };

  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("OPENAI_API_KEY", "fake-key");
    responsesCreate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("제품 목록: web_search max_tool_calls 4로 한 번 부르고, 인용에 있는 이름·주소만 남긴다", async () => {
    const url = "https://www.samsung.com/sec/headphones/galaxy-buds";
    responsesCreate.mockResolvedValueOnce(
      reply(
        {
          items: [
            { name: "삼성 Galaxy Buds3", feature: "가볍고 작아요. 19,900원이에요.", pageUrl: url },
            { name: "소니 WH-1000XM4", feature: "이미 고른 기종", pageUrl: url },
            { name: "삼성 QX-123", feature: "지어낸 이름", pageUrl: url },
          ],
        },
        [url],
        ["삼성 Galaxy Buds3 무선 이어폰"],
      ),
    );
    const run = await searchProducts(context, "소니 WH-1000XM4");
    expect(run).toMatchObject({ ai: "ok", upstream: null, usage: { in: 100, out: 40, ws: 1 }, citations: [url] });
    expect(run.data).toEqual([{ name: "삼성 Galaxy Buds3", feature: "가볍고 작아요.", pageUrl: url }]);
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    const params = responsesCreate.mock.calls[0]![0];
    expect(params).toMatchObject({ max_tool_calls: 4, tools: [{ type: "web_search" }] });
    expect(params.input).toContain("소니 WH-1000XM4");
  });

  it("제품 목록: 호출이 실패하거나 쓸 것이 없으면 고정 후보(시연 품목)로 내려가고 이유를 남긴다", async () => {
    responsesCreate.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 500 }));
    const failed = await searchProducts(context, "소니 WH-1000XM4");
    expect(failed).toMatchObject({ ai: "fallback", upstream: 500 });
    expect(failed.data.length).toBeGreaterThan(0);
    expect(failed.data.map((item) => item.name)).not.toContain("소니 WH-1000XM4");

    responsesCreate.mockResolvedValueOnce(reply({ items: [] }, []));
    expect(await searchProducts(context, "")).toMatchObject({ ai: "fallback", upstream: "empty" });

    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await searchProducts(context, "")).toMatchObject({ ai: "fallback", upstream: "nokey" });
  });

  const branchOf = (instructions: string) => (instructions.includes("제조사 공식몰") ? "official" : instructions.includes("카드사") ? "card" : "market");

  it("혜택: 갈래 3개를 함께 부르고(각 max_tool_calls 2), 경험·기종·오늘 날짜를 자료로 보내며, 항목을 거른다", async () => {
    responsesCreate.mockImplementation(async (params: { instructions: string }) => {
      const branch = branchOf(params.instructions);
      if (branch === "official") {
        const urls = ["https://www.sony.co.kr/event/a", "https://www.sony.co.kr/event/b"];
        return reply(
          {
            items: [
              { title: "공식몰 사은품 행사", condition: "공식몰에서 주문하면 받아요", compare: "경험과 다른 종류예요", url: urls[0] },
              { title: "최저가 보장", condition: "공식몰", compare: "", url: urls[1] },
              { title: "인용에 없는 행사", condition: "있어요", compare: "", url: "https://www.sony.co.kr/event/nope" },
            ],
          },
          urls,
        );
      }
      if (branch === "card") {
        const urls = ["https://www.samsungcard.com/benefit/1", "https://www.sony.co.kr/event/a"];
        return reply(
          {
            items: [
              { title: "제휴 카드 청구 할인", condition: "대상 카드로 결제하면 받아요", compare: "", url: urls[0] },
              { title: "공식몰과 같은 주소", condition: "같은 주소", compare: "", url: urls[1] },
            ],
          },
          urls,
        );
      }
      const urls = ["https://www.coupang.com/np/campaigns/9"];
      return reply({ items: [{ title: "와우 멤버십 배송", condition: "멤버십 회원이면 받아요", compare: "", url: urls[0] }] }, urls);
    });
    const run = await searchBenefits(context, { model: "소니 WH-CH720N", experience: "카드 혜택을 받았어요" });
    expect(responsesCreate).toHaveBeenCalledTimes(3);
    for (const call of responsesCreate.mock.calls) {
      expect(call[0]).toMatchObject({ max_tool_calls: 2, tools: [{ type: "web_search" }] });
      expect(call[0].input).toContain("카드 혜택을 받았어요");
      expect(call[0].input).toContain("소니 WH-CH720N");
      expect(call[0].input).toMatch(/오늘날짜[^0-9]*20\d\d-\d\d-\d\d/);
    }
    expect(run.ai).toBe("ok");
    expect(run.usage).toEqual({ in: 300, out: 120, ws: 3 });
    const flat = run.data.flatMap((group) => group.items.map((entry) => [group.branch, entry.title, entry.mode]));
    expect(flat).toEqual([
      ["official", "공식몰 사은품 행사", "ai"],
      ["card", "제휴 카드 청구 할인", "ai"],
      ["market", "와우 멤버십 배송", "check"],
    ]);
    // 모든 항목 주소는 검색 결과(인용·소스)에 있던 것이다.
    for (const group of run.data) for (const entry of group.items) expect(run.citations).toContain(entry.url);
  });

  it("혜택: 갈래 하나가 실패해도 나머지를 쓰고, 셋 다 실패하거나 쓸 것이 없으면 fallback(항목 없음)", async () => {
    responsesCreate.mockImplementation(async (params: { instructions: string }) => {
      if (branchOf(params.instructions) === "official") throw Object.assign(new Error("down"), { status: 500 });
      const url = `https://example.com/${branchOf(params.instructions)}`;
      return reply({ items: [{ title: "혜택", condition: "조건이 있어요", compare: "", url }] }, [url]);
    });
    const partial = await searchBenefits(context, { model: "소니 WH-CH720N", experience: "" });
    expect(partial.ai).toBe("ok");
    expect(partial.data.map((group) => group.branch)).toEqual(["card", "market"]);

    responsesCreate.mockReset();
    responsesCreate.mockRejectedValue(Object.assign(new Error("down"), { status: 500 }));
    expect(await searchBenefits(context, { model: "소니 WH-CH720N", experience: "" })).toMatchObject({
      ai: "fallback",
      upstream: 500,
      data: [],
    });

    responsesCreate.mockReset();
    responsesCreate.mockResolvedValue(reply({ items: [] }, []));
    expect(await searchBenefits(context, { model: "", experience: "" })).toMatchObject({ ai: "fallback", upstream: "empty", data: [] });

    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await searchBenefits(context, { model: "", experience: "" })).toMatchObject({ ai: "fallback", upstream: "nokey" });
  });

  it("가짜 모드(LLM_MODE=mock)에서는 호출 없이 고정 항목을 준다", async () => {
    vi.stubEnv("LLM_MODE", "mock");
    const products = await searchProducts(context, "");
    expect(products.ai).toBe("ok");
    expect(products.data.length).toBeGreaterThanOrEqual(3);
    const benefits = await searchBenefits(context, { model: "", experience: "카드 혜택" });
    expect(benefits.data.map((group) => group.items.length)).toEqual([1, 1, 1]);
    expect(benefits.data[2]!.items[0]!.mode).toBe("check");
    expect(responsesCreate).not.toHaveBeenCalled();
    for (const group of benefits.data) {
      for (const entry of group.items) expect([entry.title, entry.condition, entry.compare].some(hasForbidden)).toBe(false);
    }
  });
});
