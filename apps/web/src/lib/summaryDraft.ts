// ④ 요약 초안의 모양과 검사. TSD §8.8. 브라우저와 서버가 함께 쓴다(서버 전용 import 없음).

export const SUMMARY_FIELD_KEYS = [
  "productName",
  "option",
  "spec",
  "components",
  "caution",
] as const;

export type SummaryFieldKey = (typeof SUMMARY_FIELD_KEYS)[number];

/** 화면·낭독용 이름. 가격·재고·할인 항목은 일부러 없다(11/9 결정 2). */
export const SUMMARY_FIELD_LABELS: Record<SummaryFieldKey, string> = {
  productName: "상품명",
  option: "옵션",
  spec: "핵심 사양",
  components: "구성품",
  caution: "주의사항",
};

export type FieldCheck = "matched" | "unverified" | "missing";

export interface SummaryField {
  key: SummaryFieldKey;
  label: string;
  value: string | null;
  evidence: string | null;
  check: FieldCheck;
  needsCheck: boolean;
  reason: string | null;
}

export interface SummaryDraft {
  draftVersion: 1;
  source: "ocr" | "manual";
  fields: SummaryField[];
  missing: string[];
  unreadable: number[];
}

/** LLM이 낸 항목 하나(검사 전). 값이 무엇이든 받아 두고 evidenceCheck가 거른다. */
export interface RawSummaryField {
  key: string;
  label: string | null;
  value: string | null;
  evidence: string | null;
}

export const MAX_EVIDENCE_LENGTH = 200;

/**
 * 요약에 보내는 글 상한. 4,000자(TSD §8.8). 요약 엔진이 OpenAI gpt-6-luna로 바뀌었어도
 * 입력이 길어졌을 때 응답 시간이 제한 안에 드는지 재 보지 못해 올리지 않았다(미확인, 배포 뒤 실측).
 */
export const SUMMARY_TEXT_LIMIT = 4000;

function nullableText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * LLM 출력(JSON 문자열)을 항목 목록으로 바꾼다. 모양이 틀리면 null(라우트는 502 llm_failed).
 * 목록에 없는 키는 버린다. 가격·재고·할인처럼 보이는 항목은 evidenceCheck가 다시 한 번 거른다.
 */
export function parseSummaryJson(raw: string): RawSummaryField[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const fields = (parsed as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) return null;

  const result: RawSummaryField[] = [];
  for (const item of fields) {
    if (typeof item !== "object" || item === null) return null;
    const field = item as Record<string, unknown>;
    if (typeof field.key !== "string") return null;
    const value = nullableText(field.value);
    const evidence = nullableText(field.evidence);
    const label = nullableText(field.label);
    if (value === undefined || evidence === undefined || label === undefined) {
      return null;
    }
    if (!(SUMMARY_FIELD_KEYS as readonly string[]).includes(field.key)) {
      continue;
    }
    result.push({ key: field.key, label, value, evidence });
  }
  return result;
}

const CHECKS: readonly FieldCheck[] = ["matched", "unverified", "missing"];

/** 브라우저가 서버 응답을 그대로 믿지 않게 모양을 본다. */
export function isSummaryDraft(value: unknown): value is SummaryDraft {
  const draft = value as Partial<SummaryDraft> | null;
  return (
    draft?.draftVersion === 1 &&
    (draft.source === "ocr" || draft.source === "manual") &&
    Array.isArray(draft.missing) &&
    Array.isArray(draft.unreadable) &&
    Array.isArray(draft.fields) &&
    draft.fields.every(
      (field) =>
        (SUMMARY_FIELD_KEYS as readonly string[]).includes(field?.key) &&
        typeof field.label === "string" &&
        (field.value === null || typeof field.value === "string") &&
        (field.evidence === null || typeof field.evidence === "string") &&
        CHECKS.includes(field.check) &&
        typeof field.needsCheck === "boolean",
    )
  );
}

/** "확인 필요"로 세는 항목 수. 근거가 원문에 없거나 신뢰도가 낮은 항목. */
export function countNeedsCheck(draft: SummaryDraft): number {
  return draft.fields.filter((field) => field.needsCheck).length;
}
