import { describe, expect, it } from "vitest";
import {
  formatSentAt,
  newRequestIds,
  quoteOf,
  sentDayLabel,
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
