// 근거 원문 대조(순수 함수). TSD §8.8 서버 규칙 1~4.
// 블록 1 실험 server.mjs의 checkEvidence를 옮겨 TSD 모양(matched/unverified/missing)으로 바꿨다.

import {
  MAX_EVIDENCE_LENGTH,
  SUMMARY_FIELD_KEYS,
  SUMMARY_FIELD_LABELS,
  type RawSummaryField,
  type SummaryDraft,
  type SummaryField,
} from "@/lib/summaryDraft";

/** 가격·재고·할인으로 보이는 키·라벨. 이런 항목은 초안에 넣지 않는다(규칙 3). */
export const PRICE_LIKE = /price|가격|재고|할인|stock|discount/i;

export const REASON = {
  unverified: "근거가 원문에 없습니다.",
  missing: "이미지에서 못 찾았습니다.",
  lowConfidence: "읽기 신뢰도가 낮은 글자가 들어 있습니다.",
} as const;

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function overlapsLowConfidence(
  field: { value: string; evidence: string },
  lowConfidence: readonly string[],
): boolean {
  const haystack = normalizeText(`${field.value} ${field.evidence}`);
  return lowConfidence.some((word) => {
    const needle = normalizeText(word);
    return needle !== "" && haystack.includes(needle);
  });
}

export interface EvidenceCheckOptions {
  source: "ocr" | "manual";
  lowConfidence?: readonly string[];
  unreadable?: readonly number[];
}

/**
 * LLM 항목을 원문과 대조해 초안을 만든다. source가 manual이어도 같은 대조를 한다(규칙 4).
 * 항목 순서는 SUMMARY_FIELD_KEYS 순서로 고정한다.
 */
export function checkEvidence(
  rawFields: readonly RawSummaryField[],
  sourceText: string,
  { source, lowConfidence = [], unreadable = [] }: EvidenceCheckOptions,
): SummaryDraft {
  const normalizedSource = normalizeText(sourceText);
  const allowed = rawFields.filter(
    (field) => !PRICE_LIKE.test(field.key) && !PRICE_LIKE.test(field.label ?? ""),
  );

  const fields: SummaryField[] = SUMMARY_FIELD_KEYS.map((key) => {
    const label = SUMMARY_FIELD_LABELS[key];
    const raw = allowed.find((field) => field.key === key);
    if (!raw?.value) {
      return {
        key,
        label,
        value: null,
        evidence: null,
        check: "missing",
        needsCheck: false,
        reason: REASON.missing,
      };
    }

    const evidence = raw.evidence?.trim() ?? "";
    const normalizedEvidence = normalizeText(evidence);
    if (!normalizedEvidence || !normalizedSource.includes(normalizedEvidence)) {
      // 원문에 없는 근거는 지어냈을 수 있으므로 값도 근거도 보여 주지 않는다.
      return {
        key,
        label,
        value: null,
        evidence: null,
        check: "unverified",
        needsCheck: true,
        reason: REASON.unverified,
      };
    }

    const lowConfidenceHit = overlapsLowConfidence(
      { value: raw.value, evidence },
      lowConfidence,
    );
    return {
      key,
      label,
      value: raw.value,
      evidence: evidence.slice(0, MAX_EVIDENCE_LENGTH),
      check: "matched",
      needsCheck: lowConfidenceHit,
      reason: lowConfidenceHit ? REASON.lowConfidence : null,
    };
  });

  return {
    draftVersion: 1,
    source,
    fields,
    missing: fields
      .filter((field) => field.check === "missing")
      .map((field) => field.key),
    unreadable: [...unreadable].sort((a, b) => a - b),
  };
}
