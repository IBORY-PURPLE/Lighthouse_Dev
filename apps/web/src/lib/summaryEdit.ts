import type { CandidateEdits, CandidateRecord, CandidateStatus } from "./candidateDraft";
import { MANUAL_MESSAGES } from "./candidateDraft";
import { checkCandidate, isHttpsLink, RESULT_LIMITS } from "./resultInput";
import {
  SUMMARY_FIELD_KEYS,
  SUMMARY_FIELD_LABELS,
  type FieldCheck,
  type SummaryFieldKey,
} from "./summaryDraft";
import type { SentCandidate } from "./volunteerView";

// 화면 5(요약 확인)의 순수 함수: 후보 하나의 입력 칸 만들기, 검사, 보낼 모양으로 바꾸기. 브라우저와 서버가 함께 쓸 수 있다.

/** 상세 요약에 보이는 항목: 상품명(위 입력 칸)을 뺀 옵션·핵심 사양·구성품·주의사항. */
export const EDITABLE_KEYS = SUMMARY_FIELD_KEYS.filter(
  (key): key is Exclude<SummaryFieldKey, "productName"> => key !== "productName",
);

/** 후보 탭 글자(후보 N 뒤에 붙는다). */
export const TAB_STATUS_LABELS: Record<CandidateStatus, string> = {
  confirmed: "확인함",
  read: "확인 전",
  needs_capture: "캡처 없음",
};

export const SUMMARY_MESSAGES = {
  intro: "후보마다 AI 초안을 확인하고 고쳐 주세요. 확인한 후보만 보냅니다.",
  emptyValue: "확인 안 됨",
  needsCheck: "확인 필요",
  noCapture: "캡처가 없는 후보예요. 쇼핑몰에서 본 내용을 직접 적거나, 상품명과 링크만 확인해도 됩니다.",
  confirmFirst: "먼저 후보를 확인해 주세요",
  sendFailed: "보내지 못했습니다. 다시 보내기를 눌러 주세요.",
  invalidUrl: MANUAL_MESSAGES.httpsOnly,
  notYoursAnymore: "이 요청은 더 이상 내 담당이 아니에요",
  urlTooLong: `링크는 ${RESULT_LIMITS.urlMax}자 이내로 넣어 주세요`,
  guideTooLong: `구매 가이드는 ${RESULT_LIMITS.guideMax}자 이내로 적어 주세요`,
  valueTooLong: (label: string) => `${label}은 ${RESULT_LIMITS.valueMax}자 이내로 적어 주세요`,
} as const;

/** 한 항목의 입력 칸. */
export interface EditorItem {
  key: SummaryFieldKey;
  label: string;
  /** 지금 칸에 든 값. */
  value: string;
  /** AI 초안이 근거를 찾아 채운 값(없으면 빈 글자). 고쳤는지 가르는 기준이다. */
  initial: string;
  /** 초안에 적힌 근거 한 줄(없으면 null). 서버로 보내지 않는다. */
  evidence: string | null;
  check: FieldCheck;
  /** "확인 필요" 칩을 보일지: 근거로 확인되지 않았거나 신뢰도가 낮은 항목이고, 아직 고치지 않았다. */
  needsCheck: boolean;
}

export interface EditorForm {
  name: string;
  url: string;
  guide: string;
  items: EditorItem[];
  /** 이 후보에 읽은 캡처 초안이 있는가. */
  hasDraft: boolean;
}

const clip = (value: string, max: number) => [...value].slice(0, max).join("");

/** 후보와 이 기기의 칸으로 입력 칸을 만든다. 고친 값이 있으면 그것을, 없으면 기본값을 쓴다. */
export function buildForm(
  candidate: { name: string; url: string },
  record: CandidateRecord | null,
): EditorForm {
  const edits: CandidateEdits | null = record?.edits ?? null;
  const draft = record?.draft ?? null;
  const items = EDITABLE_KEYS.map((key): EditorItem => {
    const field = draft?.fields.find((entry) => entry.key === key) ?? null;
    const check: FieldCheck = field?.check ?? "missing";
    const initial =
      field && field.check === "matched" && field.value ? clip(field.value, RESULT_LIMITS.valueMax) : "";
    const value = edits?.values?.[key] ?? initial;
    return {
      key,
      label: SUMMARY_FIELD_LABELS[key],
      value,
      initial,
      evidence: field?.evidence ?? null,
      check,
      needsCheck: (check !== "matched" || field?.needsCheck === true) && value === initial,
    };
  });
  return {
    name: edits?.name ?? candidate.name,
    url: edits?.url ?? candidate.url,
    guide: edits?.guide ?? "",
    items,
    hasDraft: draft !== null,
  };
}

/** 입력 칸의 모든 값을 기기에 남길 모양으로. */
export function formEdits(form: EditorForm): CandidateEdits {
  return {
    name: form.name,
    url: form.url,
    guide: form.guide,
    values: Object.fromEntries(form.items.map((item) => [item.key, item.value])),
  };
}

export type FormCheck =
  | { ok: true; candidate: SentCandidate }
  | { ok: false; field: "name" | "url" | "guide" | SummaryFieldKey; message: string };

/** 후보 확인 전 검사. 문제가 있으면 어느 칸이 왜인지 돌려준다. 통과하면 보낼 모양(빈 값 항목은 뺀다). */
export function checkForm(form: EditorForm): FormCheck {
  const name = form.name.trim();
  if (name === "") return { ok: false, field: "name", message: MANUAL_MESSAGES.nameRequired };
  if ([...name].length > RESULT_LIMITS.nameMax) {
    return { ok: false, field: "name", message: MANUAL_MESSAGES.nameTooLong };
  }
  const url = form.url.trim();
  if (!isHttpsLink(url)) return { ok: false, field: "url", message: SUMMARY_MESSAGES.invalidUrl };
  if ([...url].length > RESULT_LIMITS.urlMax) {
    return { ok: false, field: "url", message: SUMMARY_MESSAGES.urlTooLong };
  }
  if ([...form.guide.trim()].length > RESULT_LIMITS.guideMax) {
    return { ok: false, field: "guide", message: SUMMARY_MESSAGES.guideTooLong };
  }
  for (const item of form.items) {
    if ([...item.value.trim()].length > RESULT_LIMITS.valueMax) {
      return { ok: false, field: item.key, message: SUMMARY_MESSAGES.valueTooLong(item.label) };
    }
  }
  const checked = checkCandidate({
    name,
    url,
    guide: form.guide,
    summary: form.items
      .filter((item) => item.value.trim() !== "")
      .map((item) => ({ label: item.label, value: item.value })),
  });
  if (!checked.ok) return { ok: false, field: "name", message: SUMMARY_MESSAGES.sendFailed };
  return { ok: true, candidate: checked.candidate };
}
