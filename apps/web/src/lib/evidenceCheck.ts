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

/**
 * needle이 haystack 안에 따로 선 낱말로 들어 있는지 본다. 앞뒤가 숫자·영문이면 다른 낱말이다
 * ("30시간"은 "130시간"에, "LH-200"은 "LH-2000"에 맞지 않는다). 한글 조사가 붙는 것은 허용한다.
 * 두 글은 normalizeText를 거친 것이어야 한다.
 */
export function containsBounded(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(?<![0-9a-z.])${escaped}(?![0-9a-z]|\\.[0-9])`).test(haystack);
}

/**
 * 값의 낱말이 모두 근거 안에 있는지 본다. 근거가 원문에 있어도 값과 무관한 구절이면
 * 원문에 없는 값이 통과하므로, 값과 근거를 묶는다.
 */
export function valueFollowsEvidence(value: string, evidence: string): boolean {
  const normalizedEvidence = normalizeText(evidence);
  const words = normalizeText(value)
    .split(/[\s,/·:;()[\]"'“”‘’]+/)
    .filter((word) => word !== "");
  return words.length > 0 && words.every((word) => containsBounded(normalizedEvidence, word));
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
    if (
      !normalizedEvidence ||
      evidence.length > MAX_EVIDENCE_LENGTH ||
      !containsBounded(normalizedSource, normalizedEvidence) ||
      !valueFollowsEvidence(raw.value, evidence)
    ) {
      // 원문에 없는 근거, 값이 근거에 없는 경우, 근거가 200자를 넘어 화면에서 값을 확인할 수 없는 경우는 지어냈을 수 있으므로 값도 근거도 보여 주지 않는다.
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
      evidence,
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
