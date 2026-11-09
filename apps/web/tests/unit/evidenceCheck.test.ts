import { describe, expect, it } from "vitest";
import { checkEvidence, REASON } from "@/lib/evidenceCheck";
import type { RawSummaryField } from "@/lib/summaryDraft";

// 고정 시험값. TSD §8.8 서버 규칙 1~4.
const SOURCE = [
  "상품명: 가짜 헤드셋 LH-200",
  "색상 옵션:   블랙,\n화이트",
  "블루투스 5.3, 최대 30시간 재생",
  "판매가 39,000원 / 재고 3개 / 할인 10%",
  "주의: 물에 닿지 않게 하세요",
].join("\n");

const field = (
  key: string,
  value: string | null,
  evidence: string | null,
  label: string | null = null,
): RawSummaryField => ({ key, label, value, evidence });

describe("checkEvidence", () => {
  it("근거가 원문에 그대로 있으면 matched이고 값을 남긴다", () => {
    const draft = checkEvidence(
      [field("productName", "가짜 헤드셋 LH-200", "상품명: 가짜 헤드셋 LH-200")],
      SOURCE,
      { source: "ocr" },
    );
    expect(draft.fields[0]).toEqual({
      key: "productName",
      label: "상품명",
      value: "가짜 헤드셋 LH-200",
      evidence: "상품명: 가짜 헤드셋 LH-200",
      check: "matched",
      needsCheck: false,
      reason: null,
    });
  });

  it("공백·줄바꿈만 다른 근거도 matched다", () => {
    const draft = checkEvidence(
      [field("option", "블랙, 화이트", "색상 옵션: 블랙, 화이트")],
      SOURCE,
      { source: "ocr" },
    );
    expect(draft.fields.find((f) => f.key === "option")?.check).toBe("matched");
  });

  it("근거가 원문에 없으면 값과 근거를 비우고 unverified, 확인 필요다", () => {
    const draft = checkEvidence(
      [field("spec", "최대 40시간 재생", "최대 40시간 재생")],
      SOURCE,
      { source: "ocr" },
    );
    expect(draft.fields.find((f) => f.key === "spec")).toEqual({
      key: "spec",
      label: "핵심 사양",
      value: null,
      evidence: null,
      check: "unverified",
      needsCheck: true,
      reason: REASON.unverified,
    });
  });

  it("근거가 원문에 있어도 값이 근거에 없으면(무관한 구절) unverified다", () => {
    const draft = checkEvidence(
      [
        field("spec", "노이즈 캔슬링", "블루투스 5.3, 최대 30시간 재생"),
        field("option", "블랙, 레드", "색상 옵션: 블랙, 화이트"),
        field("productName", "LH-200", "상품명: 가짜 헤드셋 LH-200"),
      ],
      SOURCE,
      { source: "ocr" },
    );
    expect(draft.fields.find((f) => f.key === "spec")).toMatchObject({
      check: "unverified",
      value: null,
      evidence: null,
    });
    expect(draft.fields.find((f) => f.key === "option")?.check).toBe("unverified");
    // 값의 낱말이 모두 근거에 있으면(일부만 옮겨도) matched다.
    expect(draft.fields.find((f) => f.key === "productName")?.check).toBe("matched");
  });

  it("값은 있는데 근거가 없으면 unverified다", () => {
    const draft = checkEvidence([field("caution", "물 주의", null)], SOURCE, {
      source: "ocr",
    });
    expect(draft.fields.find((f) => f.key === "caution")?.check).toBe("unverified");
  });

  it("값이 없는 항목과 빠진 항목은 missing이고 missing 목록에 들어간다", () => {
    const draft = checkEvidence([field("components", null, null)], SOURCE, {
      source: "ocr",
    });
    expect(draft.fields.map((f) => f.check)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
    expect(draft.missing).toEqual([
      "productName",
      "option",
      "spec",
      "components",
      "caution",
    ]);
  });

  it("신뢰도 낮은 단어와 겹치면 matched여도 확인 필요다", () => {
    const draft = checkEvidence(
      [field("spec", "블루투스 5.3", "블루투스 5.3, 최대 30시간 재생")],
      SOURCE,
      { source: "ocr", lowConfidence: ["5.3"] },
    );
    const spec = draft.fields.find((f) => f.key === "spec");
    expect(spec?.check).toBe("matched");
    expect(spec?.needsCheck).toBe(true);
    expect(spec?.reason).toBe(REASON.lowConfidence);
  });

  it("가격·재고·할인 항목은 키나 라벨이 무엇이든 초안에 없다", () => {
    const draft = checkEvidence(
      [
        field("price", "39,000원", "판매가 39,000원"),
        field("stock", "3개", "재고 3개"),
        field("discount", "10%", "할인 10%"),
        field("caution", "가격 39,000원", "판매가 39,000원", "가격"),
      ],
      SOURCE,
      { source: "ocr" },
    );
    expect(draft.fields).toHaveLength(5);
    for (const f of draft.fields) {
      expect(f.key).not.toMatch(/price|가격|재고|할인|stock|discount/i);
      expect(f.label).not.toMatch(/price|가격|재고|할인|stock|discount/i);
    }
    // 가격 라벨을 단 caution은 버려져 missing이 된다.
    expect(draft.fields.find((f) => f.key === "caution")?.check).toBe("missing");
  });

  it("source가 manual이어도 같은 대조를 한다", () => {
    const manual = "상품명은 가짜 헤드셋 LH-200 입니다";
    const draft = checkEvidence(
      [
        field("productName", "가짜 헤드셋 LH-200", "가짜 헤드셋 LH-200"),
        field("spec", "노이즈 캔슬링", "노이즈 캔슬링"),
      ],
      manual,
      { source: "manual" },
    );
    expect(draft.source).toBe("manual");
    expect(draft.fields[0].check).toBe("matched");
    expect(draft.fields.find((f) => f.key === "spec")?.check).toBe("unverified");
  });

  it("근거가 200자를 넘으면 화면에서 값을 확인할 수 없으므로 unverified이고, 못 읽은 조각 번호는 정렬해 남긴다", () => {
    const long = "가".repeat(250);
    const draft = checkEvidence([field("caution", "가가가", long)], long, {
      source: "ocr",
      unreadable: [3, 1],
    });
    expect(draft.fields.find((f) => f.key === "caution")).toMatchObject({
      check: "unverified",
      value: null,
      evidence: null,
    });
    expect(draft.unreadable).toEqual([1, 3]);
    expect(draft.draftVersion).toBe(1);
  });

  it("숫자·영문 낱말은 앞뒤가 이어지면 다른 낱말로 본다(30시간 ≠ 130시간, LH-200 ≠ LH-2000)", () => {
    const source = "최대 130시간 재생\n모델 LH-2000\n무게 2.5kg\n헤드셋은 접힙니다";
    const draft = checkEvidence(
      [
        field("spec", "최대 30시간 재생", "최대 130시간 재생"),
        field("productName", "LH-200", "모델 LH-2000"),
        field("option", "2.5kg", "무게 2.5kg"),
        field("caution", "헤드셋 접힘", "헤드셋은 접힙니다"),
      ],
      source,
      { source: "ocr" },
    );
    const check = (key: string) => draft.fields.find((f) => f.key === key)?.check;
    expect(check("spec")).toBe("unverified");
    expect(check("productName")).toBe("unverified");
    expect(check("option")).toBe("matched");
    // "접힘"은 근거에 없는 낱말이라 unverified다(조사만 다른 "헤드셋"은 통과하지만 낱말 하나라도 없으면 안 된다).
    expect(check("caution")).toBe("unverified");
  });

  it("근거 자체도 원문 안에서 숫자가 이어지면 다른 구절로 본다", () => {
    const draft = checkEvidence(
      [field("spec", "30시간 재생", "30시간 재생")],
      "최대 130시간 재생",
      { source: "ocr" },
    );
    expect(draft.fields.find((f) => f.key === "spec")?.check).toBe("unverified");
  });
});

