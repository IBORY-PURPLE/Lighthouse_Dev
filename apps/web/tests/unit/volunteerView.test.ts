import { describe, expect, it } from "vitest";
import {
  BRIEF_EMPTY_NOTE,
  briefSteps,
  formatSentAt,
  newRequestIds,
  quoteOf,
  sentDayLabel,
  sentModelOf,
  sentReviewOf,
  structuredLine,
  waitLabel,
} from "@/lib/volunteerView";

const NOW = Date.parse("2026-11-12T03:00:00Z"); // 서울 12일 12:00
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("waitLabel", () => {
  it("1분 미만은 1분으로 본다", () => {
    expect(waitLabel(minutesAgo(0), NOW)).toBe("대기 1분째");
    expect(waitLabel(NOW - 30_000, NOW)).toBe("대기 1분째");
    expect(waitLabel(NOW + 5_000, NOW)).toBe("대기 1분째");
  });

  it("60분 전까지는 분, 그 뒤는 시간과 분", () => {
    expect(waitLabel(minutesAgo(2), NOW)).toBe("대기 2분째");
    expect(waitLabel(minutesAgo(59), NOW)).toBe("대기 59분째");
    expect(waitLabel(minutesAgo(72), NOW)).toBe("대기 1시간 12분째");
    expect(waitLabel(minutesAgo(60), NOW)).toBe("대기 1시간째");
    expect(waitLabel(minutesAgo(23 * 60 + 59), NOW)).toBe("대기 23시간 59분째");
  });
});

describe("quoteOf·structuredLine", () => {
  it("인용문은 제품 · 예산", () => {
    expect(quoteOf("소니 무선 헤드셋 사고 싶어요", "30만 원 안쪽")).toBe(
      "“소니 무선 헤드셋 사고 싶어요 · 30만 원 안쪽”",
    );
  });

  it("구조화 줄: 품목 · 예산 · 조건", () => {
    const base = { item: "헤드셋", budget: "30만 원", conditionKind: "new" as const, condition: "새 제품" };
    expect(structuredLine(base)).toBe("품목 헤드셋 · 예산 30만 원 · 새 제품");
    expect(structuredLine({ ...base, conditionKind: "used" })).toBe("품목 헤드셋 · 예산 30만 원 · 중고");
    expect(structuredLine({ ...base, conditionKind: "any" })).toBe(
      "품목 헤드셋 · 예산 30만 원 · 새 제품·중고 상관없음",
    );
  });

  it("브랜드가 있으면 품목 뒤에 붙는다(이용자가 말한 조건도 그대로 남는다)", () => {
    expect(
      structuredLine({ item: "헤드셋", brand: "소니", budget: "30만 원", conditionKind: "used", condition: "중고" }),
    ).toBe("품목 헤드셋 · 브랜드 소니 · 예산 30만 원 · 중고");
    expect(structuredLine({ item: null, brand: null, budget: "5만 원", conditionKind: null, condition: "상관없어요" })).toBe(
      "예산 5만 원 · 상관없어요",
    );
  });

  it("품목이 없으면 품목 부분을 빼고, 조건 종류를 모르면 원문을 쓴다", () => {
    expect(
      structuredLine({ item: null, budget: "5만 원쯤", conditionKind: null, condition: "깨끗하면 돼요" }),
    ).toBe("예산 5만 원쯤 · 깨끗하면 돼요");
  });
});

describe("sentDayLabel·formatSentAt", () => {
  it("서울 날짜 기준으로 오늘·어제·날짜", () => {
    expect(sentDayLabel(minutesAgo(10), NOW)).toBe("오늘 보냄");
    expect(sentDayLabel(minutesAgo(24 * 60), NOW)).toBe("어제 보냄");
    expect(sentDayLabel(minutesAgo(3 * 24 * 60), NOW)).toBe("11월 9일 보냄");
  });

  it("UTC로는 같은 날이어도 서울 자정을 넘기면 어제다", () => {
    // 서울 11월 12일 00:30 = UTC 11일 15:30
    const now = Date.parse("2026-11-11T15:30:00Z");
    expect(sentDayLabel("2026-11-11T14:30:00Z", now)).toBe("어제 보냄");
    expect(sentDayLabel("2026-11-11T15:10:00Z", now)).toBe("오늘 보냄");
  });

  it("보낸 시각은 서울 시각의 한국어 날짜·오전/오후", () => {
    // 서울 11월 12일 03:42 = UTC 11일 18:42
    expect(formatSentAt("2026-11-11T18:42:00Z")).toBe("11월 12일 오전 3:42");
    expect(formatSentAt("2026-11-12T06:05:00Z")).toBe("11월 12일 오후 3:05");
  });
});

describe("newRequestIds", () => {
  it("직전 목록이 없으면(첫 불러오기) 새 요청이 없다", () => {
    expect([...newRequestIds(null, ["a", "b"])]).toEqual([]);
  });

  it("직전 목록에 없던 id만 새 요청이다", () => {
    expect([...newRequestIds(["a", "b"], ["a", "c", "b", "d"])]).toEqual(["c", "d"]);
    expect([...newRequestIds([], ["a"])]).toEqual(["a"]);
  });
});

describe("sentReviewOf·sentModelOf", () => {
  const sent = (candidates: { name: string; guide: string }[]) => ({
    sentAt: "2026-11-17T06:00:00Z",
    heardAt: null,
    linkOpenedAt: null,
    candidates: candidates.map((candidate) => ({ ...candidate, url: "https://example.com", summary: [] })),
  });

  it("이용자에게 읽히는 것은 첫 후보의 핵심 정리(검증 리뷰 문단) 하나다", () => {
    const result = sent([
      { name: "WH-CH720N", guide: "  실제로 써 본 경험이에요.  " },
      { name: "같이 고민한 제품", guide: "" },
    ]);
    expect(sentReviewOf(result)).toBe("실제로 써 본 경험이에요.");
  });

  it("첫 후보에 문단이 없으면 문단이 있는 다음 후보의 것을 쓰고, 모두 없으면 null", () => {
    expect(sentReviewOf(sent([{ name: "A", guide: "" }, { name: "B", guide: "두 번째 문단" }]))).toBe("두 번째 문단");
    expect(sentReviewOf(sent([{ name: "A", guide: " " }]))).toBeNull();
    expect(sentReviewOf(sent([]))).toBeNull();
  });

  it("기종 이름은 자르지 않고 그대로 준다(짧은 이름 730N도 그대로)", () => {
    expect(sentModelOf(sent([{ name: "730N", guide: "x" }]))).toBe("730N");
    const long = "가".repeat(100);
    expect(sentModelOf(sent([{ name: long, guide: "x" }]))).toBe(long);
    expect(sentModelOf(sent([]))).toBeNull();
  });
});

describe("briefSteps(이용자 요청 카드)", () => {
  const request = {
    product: "소니 무선 헤드셋",
    item: "헤드셋",
    brand: "Sony",
    budget: "십만 원 정도",
    conditionKind: "new" as const,
    condition: "새 제품",
  };
  const details = {
    summary: "소니 무선 헤드셋, 예산 십만 원",
    qa: [
      { q: "어떤 상품을 찾으세요?", a: "소니 무선 헤드셋" },
      { q: "예산은 얼마인가요?", a: "십만 원 정도" },
    ],
  };

  it("1장은 이용자가 확인한 요약과 접수 정보, 2장부터 질문 k/n과 이용자 답이다", () => {
    const steps = briefSteps(request, details);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({
      key: "summary",
      title: "이용자가 확인한 요청",
      lines: [
        { label: "요약", text: "소니 무선 헤드셋, 예산 십만 원" },
        { label: "접수 정보", text: structuredLine(request) },
      ],
    });
    expect(steps[1]).toEqual({
      key: "qa-0",
      title: "질문 1/2",
      lines: [
        { label: "질문", text: "어떤 상품을 찾으세요?" },
        { label: "이용자 답", text: "소니 무선 헤드셋" },
      ],
    });
    expect(steps[2].title).toBe("질문 2/2");
    expect(steps[2].lines[1]).toEqual({ label: "이용자 답", text: "십만 원 정도" });
  });

  it("details가 없으면 1장만, 요약 대신 요청 글과 질문·답 기록이 없다는 안내를 보인다", () => {
    for (const none of [null, { summary: "", qa: [] }]) {
      const steps = briefSteps(request, none);
      expect(steps).toHaveLength(1);
      expect(steps[0].lines[0]).toEqual({ label: "요청", text: "소니 무선 헤드셋" });
      expect(steps[0].note).toBe(BRIEF_EMPTY_NOTE);
      expect(BRIEF_EMPTY_NOTE).toBe("질문·답 기록이 없는 요청이에요");
    }
  });

  it("요약만 있고 질문·답이 없어도 안내를 붙인다. 요약이 비고 질문·답이 있으면 요청 글을 쓴다", () => {
    expect(briefSteps(request, { summary: "요약", qa: [] })[0].note).toBe(BRIEF_EMPTY_NOTE);
    const steps = briefSteps(request, { summary: "", qa: details.qa });
    expect(steps[0].lines[0]).toEqual({ label: "요청", text: "소니 무선 헤드셋" });
    expect(steps[0].note).toBeUndefined();
    expect(steps).toHaveLength(3);
  });
});
