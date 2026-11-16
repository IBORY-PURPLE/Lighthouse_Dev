import { describe, expect, it } from "vitest";
import { emptyResearchState, type ResearchPhoto, type ResearchState } from "@/lib/research";
import { buildResultBody, clip } from "@/lib/researchResult";
import { parseResultBody, RESULT_LIMITS } from "@/lib/resultInput";
import { candidateSearchUrl } from "@/lib/shopLinks";

const THUMB = "data:image/jpeg;base64,AAAA";
const photo = (kind: ResearchPhoto["kind"], description = ""): ResearchPhoto => ({ kind, thumb: THUMB, description });

function complete(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    ...emptyResearchState(),
    purchase: "bought",
    model: "소니 WH-CH720N",
    pros: "가벼워서 오래 써도 편해요.",
    photos: [photo("proof", "책상 위 검은 헤드셋")],
    alts: ["소니 WH-CH520", "소니 WH-1000XM4"],
    altReason: "무게와 소리를 비교했어요.",
    benefits: "카드 할인과 무료 배송",
    refs: "블로그 후기를 봤어요",
    summaryText: "소니 WH-CH720N을 추천해요.",
    checked: {
      benefits: [{ title: "혜택 안내", url: "https://a.example/benefit" }],
      refs: [{ title: "후기 영상", url: "https://b.example/review" }],
    },
    ...overrides,
  };
}

/** 만든 본문이 기존 서버 검사(resultInput)를 통과하는지. */
function expectAccepted(state: ResearchState) {
  const body = buildResultBody(state);
  expect(body).not.toBeNull();
  const checked = parseResultBody(JSON.parse(JSON.stringify(body)));
  expect(checked.ok).toBe(true);
  return body!;
}

describe("buildResultBody", () => {
  it("후보 1은 추천 기종, 후보 2~3은 같이 고민한 제품이다", () => {
    const body = expectAccepted(complete());
    expect(body.candidates.map((candidate) => candidate.name)).toEqual([
      "소니 WH-CH720N",
      "소니 WH-CH520",
      "소니 WH-1000XM4",
    ]);
    expect(body.candidates[0].url).toBe(candidateSearchUrl("소니 WH-CH720N"));
    expect(body.candidates[0].guide).toBe("소니 WH-CH720N을 추천해요.");
    expect(body.candidates[0].summary).toEqual([
      { label: "구분", value: "추천 기종" },
      { label: "구매 인증", value: "구매 인증됨" },
      { label: "장점", value: "가벼워서 오래 써도 편해요." },
      { label: "사진", value: "1장 · 책상 위 검은 헤드셋" },
      { label: "같이 고민한 제품", value: "소니 WH-CH520, 소니 WH-1000XM4" },
      { label: "고민한 이유", value: "무게와 소리를 비교했어요." },
      { label: "혜택", value: "카드 할인과 무료 배송" },
      { label: "혜택 링크 1", value: "혜택 안내 https://a.example/benefit" },
      { label: "참고 글", value: "블로그 후기를 봤어요" },
      { label: "참고 링크 1", value: "후기 영상 https://b.example/review" },
    ]);
    for (const alt of body.candidates.slice(1)) {
      expect(alt.guide).toBe("");
      expect(alt.url).toBe(candidateSearchUrl(alt.name));
      expect(alt.summary).toEqual([
        { label: "구분", value: "같이 고민한 제품" },
        { label: "고민한 이유", value: "무게와 소리를 비교했어요." },
      ]);
    }
  });

  it("구매 인증은 구매했고 착샷이 있을 때만 '구매 인증됨', 아니면 '리서치만'이다", () => {
    const value = (state: ResearchState) =>
      buildResultBody(state)!.candidates[0].summary.find((entry) => entry.label === "구매 인증")?.value;
    expect(value(complete())).toBe("구매 인증됨");
    expect(value(complete({ photos: [photo("detail")] }))).toBe("리서치만");
    expect(value(complete({ purchase: "research" }))).toBe("리서치만");
  });

  it("빈 값 항목은 넣지 않고(서버는 빈 값을 거부한다) 선택 카드가 비면 줄어든다", () => {
    const body = expectAccepted(
      complete({ benefits: "", refs: "", checked: { benefits: [], refs: [] }, photos: [photo("detail")], alts: ["제품 B"] }),
    );
    expect(body.candidates[0].summary.map((entry) => entry.label)).toEqual([
      "구분",
      "구매 인증",
      "장점",
      "사진",
      "같이 고민한 제품",
      "고민한 이유",
    ]);
    expect(body.candidates).toHaveLength(2);
  });

  it("필수 카드가 비어 있으면 null이다", () => {
    expect(buildResultBody(complete({ photos: [] }))).toBeNull();
    expect(buildResultBody(emptyResearchState())).toBeNull();
  });

  it("핵심 정리를 비워 두면 답을 이어 만든 기본 글을 쓴다", () => {
    const guide = buildResultBody(complete({ summaryText: "  " }))!.candidates[0].guide;
    expect(guide.startsWith("추천 기종: 소니 WH-CH720N")).toBe(true);
  });

  it("요약 항목은 12개를 넘지 않는다(링크 2+2를 다 채워도)", () => {
    const body = expectAccepted(
      complete({
        checked: {
          benefits: [1, 2, 3].map((n) => ({ title: `혜택 ${n}`, url: `https://a.example/${n}` })),
          refs: [1, 2, 3].map((n) => ({ title: `글 ${n}`, url: `https://b.example/${n}` })),
        },
      }),
    );
    const labels = body.candidates[0].summary.map((entry) => entry.label);
    expect(labels).toHaveLength(12);
    expect(labels.filter((label) => label.startsWith("혜택 링크"))).toHaveLength(2);
    expect(labels.filter((label) => label.startsWith("참고 링크"))).toHaveLength(2);
  });

  it("한도를 넘는 값은 코드포인트 단위로 잘라 서버 검사를 통과한다", () => {
    const emoji = "😀";
    const body = expectAccepted(
      complete({
        model: emoji.repeat(150),
        pros: emoji.repeat(500),
        altReason: "가".repeat(500),
        benefits: "나".repeat(500),
        refs: "다".repeat(500),
        summaryText: emoji.repeat(1500),
        alts: [emoji.repeat(120)],
        photos: [photo("proof", "라".repeat(600))],
      }),
    );
    const [main, alt] = body.candidates;
    expect([...main.name]).toHaveLength(RESULT_LIMITS.nameMax);
    expect([...main.guide]).toHaveLength(RESULT_LIMITS.guideMax);
    expect([...alt.name]).toHaveLength(RESULT_LIMITS.nameMax);
    for (const entry of main.summary) expect([...entry.value].length).toBeLessThanOrEqual(RESULT_LIMITS.valueMax);
    // 잘린 곳은 말줄임표로 보인다.
    expect(main.guide.endsWith("…")).toBe(true);
    expect(main.summary.find((entry) => entry.label === "장점")!.value.endsWith("…")).toBe(true);
    // 검색 주소(인코딩 뒤)도 길이 한도 안이다.
    expect([...main.url].length).toBeLessThanOrEqual(RESULT_LIMITS.urlMax);
  });

  it("줄바꿈이 든 답은 요약 값에서 한 줄로 합치고, 핵심 정리는 줄바꿈을 지킨다", () => {
    const body = expectAccepted(complete({ pros: "가벼워요\n\n편해요", summaryText: "첫 줄\n둘째 줄" }));
    expect(body.candidates[0].summary.find((entry) => entry.label === "장점")!.value).toBe("가벼워요 편해요");
    expect(body.candidates[0].guide).toBe("첫 줄\n둘째 줄");
  });

  it("주소가 값 한도(200자)에 들어가지 않는 링크는 빼고, 들어가면 제목을 줄여 맞춘다", () => {
    const longUrl = `https://a.example/${"x".repeat(250)}`;
    const fitUrl = `https://b.example/${"y".repeat(150)}`;
    const body = expectAccepted(
      complete({
        checked: {
          benefits: [
            { title: "너무 긴 주소", url: longUrl },
            { title: "아주 긴 제목 ".repeat(30), url: fitUrl },
          ],
          refs: [],
        },
      }),
    );
    const links = body.candidates[0].summary.filter((entry) => entry.label.startsWith("혜택 링크"));
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("혜택 링크 1");
    expect(links[0].value.endsWith(fitUrl)).toBe(true);
    expect([...links[0].value].length).toBeLessThanOrEqual(RESULT_LIMITS.valueMax);
  });

  it("https가 아닌 링크는 싣지 않는다", () => {
    const body = expectAccepted(
      complete({ checked: { benefits: [{ title: "x", url: "http://a.example/x" }], refs: [] } }),
    );
    expect(body.candidates[0].summary.some((entry) => entry.label.startsWith("혜택 링크"))).toBe(false);
  });

  it("본문 전체가 서버의 40,000자 한도 안이다(가장 큰 경우)", () => {
    const body = expectAccepted(
      complete({
        pros: "가".repeat(200),
        altReason: "나".repeat(200),
        summaryText: "다".repeat(1000),
        photos: [photo("proof", "라".repeat(200)), photo("detail"), photo("detail")],
      }),
    );
    expect(JSON.stringify(body).length).toBeLessThan(RESULT_LIMITS.bodyMax);
  });
});

describe("clip", () => {
  it("한도 이하면 그대로, 넘으면 max자(말줄임표 포함)로 자른다", () => {
    expect(clip("가나다", 3)).toBe("가나다");
    expect(clip("가나다라", 3)).toBe("가나…");
    expect([...clip("😀".repeat(10), 4)]).toHaveLength(4);
  });
});
