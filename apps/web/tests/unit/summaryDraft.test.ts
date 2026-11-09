import { describe, expect, it } from "vitest";
import {
  countNeedsCheck,
  isSummaryDraft,
  parseSummaryJson,
  SUMMARY_FIELD_KEYS,
  SUMMARY_FIELD_LABELS,
} from "@/lib/summaryDraft";

describe("parseSummaryJson", () => {
  it("JSON이 아니거나 fields 배열이 없으면 null(llm_failed)이다", () => {
    for (const raw of ["", "not json", "[]", "null", '{"fields":{}}', '{"other":[]}']) {
      expect(parseSummaryJson(raw)).toBeNull();
    }
  });

  it("항목 모양이 틀리면 null이다", () => {
    expect(parseSummaryJson('{"fields":[{"value":"x"}]}')).toBeNull();
    expect(parseSummaryJson('{"fields":[{"key":"spec","value":{"a":1}}]}')).toBeNull();
    expect(parseSummaryJson('{"fields":["spec"]}')).toBeNull();
  });

  it("목록에 없는 키(가격 포함)는 버리고 빈 문자열은 null로 바꾼다", () => {
    const fields = parseSummaryJson(
      JSON.stringify({
        fields: [
          { key: "productName", label: "상품명", value: "LH-200", evidence: "LH-200" },
          { key: "price", label: "가격", value: "39,000원", evidence: "39,000원" },
          { key: "color", value: "블랙", evidence: "블랙" },
          { key: "option", value: "", evidence: null },
        ],
      }),
    );
    expect(fields).toEqual([
      { key: "productName", label: "상품명", value: "LH-200", evidence: "LH-200" },
      { key: "option", label: null, value: null, evidence: null },
    ]);
  });
});

describe("항목 목록", () => {
  it("가격·재고·할인 키와 라벨이 없다", () => {
    for (const key of SUMMARY_FIELD_KEYS) {
      expect(key).not.toMatch(/price|stock|discount/i);
      expect(SUMMARY_FIELD_LABELS[key]).not.toMatch(/가격|재고|할인/);
    }
  });
});

describe("isSummaryDraft", () => {
  const draft = {
    draftVersion: 1,
    source: "ocr",
    fields: [
      {
        key: "spec",
        label: "핵심 사양",
        value: null,
        evidence: null,
        check: "unverified",
        needsCheck: true,
        reason: "근거가 원문에 없습니다.",
      },
    ],
    missing: [],
    unreadable: [],
  };

  it("맞는 모양을 받고 확인 필요 수를 센다", () => {
    expect(isSummaryDraft(draft)).toBe(true);
    if (isSummaryDraft(draft)) expect(countNeedsCheck(draft)).toBe(1);
  });

  it("틀린 모양은 받지 않는다", () => {
    expect(isSummaryDraft(null)).toBe(false);
    expect(isSummaryDraft({ ...draft, draftVersion: 2 })).toBe(false);
    expect(
      isSummaryDraft({ ...draft, fields: [{ ...draft.fields[0], key: "price" }] }),
    ).toBe(false);
    expect(
      isSummaryDraft({ ...draft, fields: [{ ...draft.fields[0], check: "ok" }] }),
    ).toBe(false);
  });
});
