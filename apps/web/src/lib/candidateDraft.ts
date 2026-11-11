// 요청별 기기 초안: localStorage `lh.vol.draft.v1.<requestId>`. 브라우저에서만 쓴다.
// 블록 2는 manual(직접 추가한 후보)과 lastOpened(마지막으로 '쇼핑몰에서 보기'를 누른 후보)를 쓴다.
// drafts(후보별 요약 초안)는 블록 3이 채우고, edits(요약 확인 화면에서 고친 값)와 confirmed(후보 확인)는 블록 4가 채운다.
// 캡처가 없는 후보는 draft 없이 `{ confirmed, edits }`만 둘 수 있다.
// 이미지와 읽은 글자 원문은 저장하지 않는다. 요약 초안(SummaryDraft)만 둔다.
// 값이 없거나 깨졌으면 빈 값으로 읽는다. 내려놓기나 보내기에 성공하면 지운다.

import { isSummaryDraft, type SummaryDraft } from "./summaryDraft";

export const DRAFT_VERSION = 1;
export const MAX_MANUAL = 3;
export const MAX_NAME_LENGTH = 100;
export const MAX_URL_LENGTH = 2048;

export interface ManualCandidate {
  id: string;
  name: string;
  url: string;
}

export interface DraftStore {
  v: 1;
  manual: ManualCandidate[];
  lastOpened: string | null;
  drafts: Record<string, Record<string, unknown>>;
}

export const MANUAL_MESSAGES = {
  nameRequired: "상품명을 넣어 주세요",
  nameTooLong: `상품명은 ${MAX_NAME_LENGTH}자 이내로 넣어 주세요`,
  httpsOnly: "링크는 https://로 시작해야 합니다",
  full: `후보는 최대 ${MAX_MANUAL}개까지 추가할 수 있어요`,
} as const;

export const draftKey = (requestId: string) => `lh.vol.draft.v1.${requestId}`;

export function emptyDraftStore(): DraftStore {
  return { v: DRAFT_VERSION, manual: [], lastOpened: null, drafts: {} };
}

/** 링크는 https://로 시작하고 URL로 읽히며 2048자 이하여야 한다. */
export function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://") || value.length > MAX_URL_LENGTH) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export type ManualValidation =
  | { ok: true; name: string; url: string }
  | { ok: false; field: "name" | "url"; message: string };

export function validateManual(name: string, url: string): ManualValidation {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName) {
    return { ok: false, field: "name", message: MANUAL_MESSAGES.nameRequired };
  }
  if ([...trimmedName].length > MAX_NAME_LENGTH) {
    return { ok: false, field: "name", message: MANUAL_MESSAGES.nameTooLong };
  }
  if (!isHttpsUrl(trimmedUrl)) {
    return { ok: false, field: "url", message: MANUAL_MESSAGES.httpsOnly };
  }
  return { ok: true, name: trimmedName, url: trimmedUrl };
}

function isManualCandidate(value: unknown): value is ManualCandidate {
  const entry = value as Partial<ManualCandidate> | null;
  return (
    typeof entry?.id === "string" &&
    entry.id !== "" &&
    typeof entry.name === "string" &&
    entry.name.trim() !== "" &&
    [...entry.name].length <= MAX_NAME_LENGTH &&
    typeof entry.url === "string" &&
    isHttpsUrl(entry.url)
  );
}

/** 저장된 글자를 읽는다. 없거나 깨졌으면 빈 값, 깨진 후보는 그 후보만 버린다. */
export function parseDraftStore(raw: string | null): DraftStore {
  if (!raw) return emptyDraftStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyDraftStore();
  }
  const body = parsed as Partial<Record<keyof DraftStore, unknown>> | null;
  if (!body || typeof body !== "object" || body.v !== DRAFT_VERSION) return emptyDraftStore();

  const manual: ManualCandidate[] = [];
  if (Array.isArray(body.manual)) {
    for (const entry of body.manual) {
      if (
        manual.length < MAX_MANUAL &&
        isManualCandidate(entry) &&
        !manual.some((kept) => kept.id === entry.id)
      ) {
        manual.push({ id: entry.id, name: entry.name, url: entry.url });
      }
    }
  }
  const drafts =
    body.drafts && typeof body.drafts === "object" && !Array.isArray(body.drafts)
      ? (body.drafts as DraftStore["drafts"])
      : {};
  return {
    v: DRAFT_VERSION,
    manual,
    lastOpened: typeof body.lastOpened === "string" ? body.lastOpened : null,
    drafts,
  };
}

export function serializeDraftStore(store: DraftStore): string {
  return JSON.stringify(store);
}

/** 직접 추가한 후보를 더한다. 이미 3개면 그대로 돌려준다. id는 비어 있는 첫 m1~m3. */
export function addManualCandidate(store: DraftStore, name: string, url: string): DraftStore {
  if (store.manual.length >= MAX_MANUAL) return store;
  const taken = new Set(store.manual.map((entry) => entry.id));
  let id = "m1";
  for (let number = 1; number <= MAX_MANUAL; number += 1) {
    id = `m${number}`;
    if (!taken.has(id)) break;
  }
  return { ...store, manual: [...store.manual, { id, name, url }] };
}

// ----- 후보별 요약 초안(블록 3)과 확인·고침(블록 4) -----

/** 요약 확인 화면에서 봉사자가 고친 값. 없는 칸은 후보·초안의 기본값을 쓴다. values의 키는 요약 항목 키(option 등). */
export interface CandidateEdits {
  name?: string;
  url?: string;
  guide?: string;
  values?: Record<string, string>;
}

/** 한 후보의 초안 칸(캡처를 읽은 초안이 있는 경우). */
export interface CandidateDraftEntry {
  draft: SummaryDraft;
  captureCount: number;
  edits?: CandidateEdits;
  confirmed: boolean;
}

/**
 * 한 후보의 칸 전체. 캡처가 없는 후보도 상품명·링크만으로 확인할 수 있어서 draft가 없을 수 있다
 * (이때 captureCount는 0, 칸은 `{ confirmed, edits }`로만 저장된다).
 */
export interface CandidateRecord {
  draft: SummaryDraft | null;
  captureCount: number;
  edits: CandidateEdits | null;
  confirmed: boolean;
}

export type CandidateStatus = "needs_capture" | "read" | "confirmed";

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  needs_capture: "캡처 필요",
  read: "캡처 읽음 · 확인 전",
  confirmed: "요약 확인함",
};

/** 저장된 edits를 모양대로 거른다. 쓸 수 있는 값이 없으면 null. */
export function readEdits(raw: unknown): CandidateEdits | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const edits: CandidateEdits = {};
  if (typeof source.name === "string") edits.name = source.name;
  if (typeof source.url === "string") edits.url = source.url;
  if (typeof source.guide === "string") edits.guide = source.guide;
  const values = source.values;
  if (values && typeof values === "object" && !Array.isArray(values)) {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string") kept[key] = value;
    }
    edits.values = kept;
  }
  return Object.keys(edits).length > 0 ? edits : null;
}

/** 후보의 초안 칸. 없거나 초안 모양이 아니면 null. */
export function readCandidateDraft(store: DraftStore, candidateId: string): CandidateDraftEntry | null {
  const entry = store.drafts[candidateId];
  if (!entry || typeof entry !== "object" || !isSummaryDraft(entry.draft)) return null;
  const edits = readEdits(entry.edits);
  return {
    draft: entry.draft,
    captureCount: typeof entry.captureCount === "number" ? entry.captureCount : 0,
    ...(edits ? { edits } : {}),
    confirmed: entry.confirmed === true,
  };
}

/** 후보의 칸 전체(초안이 없어도 확인·고침이 있으면 값이 있다). 아무것도 없으면 null. */
export function readCandidateRecord(store: DraftStore, candidateId: string): CandidateRecord | null {
  const entry = store.drafts[candidateId];
  if (!entry || typeof entry !== "object") return null;
  const draft = isSummaryDraft(entry.draft) ? entry.draft : null;
  const edits = readEdits(entry.edits);
  const confirmed = entry.confirmed === true;
  if (!draft && !edits && !confirmed) return null;
  return {
    draft,
    captureCount: draft && typeof entry.captureCount === "number" ? entry.captureCount : 0,
    edits,
    confirmed,
  };
}

/**
 * 후보 상태: 확인했으면 확인함, 초안이 있으면 읽음(확인 전), 아니면 캡처 필요.
 * 캡처가 없는 후보도 상품명·링크를 맞게 넣고 확인하면 확인함이 된다.
 */
export function candidateStatus(store: DraftStore, candidateId: string): CandidateStatus {
  const record = readCandidateRecord(store, candidateId);
  if (!record) return "needs_capture";
  if (record.confirmed) return "confirmed";
  return record.draft ? "read" : "needs_capture";
}

/**
 * 후보에 새 초안을 둔다(그 후보의 옛 초안은 바뀐다. 확인 표시는 지워진다).
 * 상품명·링크·가이드를 고쳐 둔 것은 남기고, 항목 값은 옛 초안 것이라 버린다.
 */
export function setCandidateDraft(
  store: DraftStore,
  candidateId: string,
  draft: SummaryDraft,
  captureCount: number,
): DraftStore {
  const kept = readEdits(store.drafts[candidateId]?.edits);
  const carried: CandidateEdits = {};
  if (kept?.name !== undefined) carried.name = kept.name;
  if (kept?.url !== undefined) carried.url = kept.url;
  if (kept?.guide !== undefined) carried.guide = kept.guide;
  return {
    ...store,
    drafts: {
      ...store.drafts,
      [candidateId]: {
        draft,
        captureCount,
        ...(Object.keys(carried).length > 0 ? { edits: carried } : {}),
        confirmed: false,
      },
    },
  };
}

/** 확인 화면에서 값을 고친다. 고치면 다시 확인 전이다. 초안이 있으면 그대로 둔다. */
export function setCandidateEdits(
  store: DraftStore,
  candidateId: string,
  edits: CandidateEdits,
  confirmed = false,
): DraftStore {
  const previous = store.drafts[candidateId];
  return {
    ...store,
    drafts: { ...store.drafts, [candidateId]: { ...previous, edits, confirmed } },
  };
}

/** 초안을 다른 후보로 옮긴다. 받는 후보에 있던 초안은 바뀌고, 보내는 후보는 '캡처 필요'로 돌아간다. 고친 값과 확인 표시는 옮기지 않는다. */
export function moveCandidateDraft(store: DraftStore, fromId: string, toId: string): DraftStore {
  if (fromId === toId || !store.drafts[fromId]) return store;
  const { [fromId]: moved, ...rest } = store.drafts;
  return {
    ...store,
    drafts: { ...rest, [toId]: { draft: moved.draft, captureCount: moved.captureCount, confirmed: false } },
  };
}

/**
 * 캡처를 저장할 후보. 마지막으로 '쇼핑몰에서 보기'를 누른 후보, 없으면 첫 '캡처 필요' 후보, 그것도 없으면 첫 후보.
 * 후보가 없으면 null.
 */
export function captureTargetId(store: DraftStore, candidateIds: readonly string[]): string | null {
  if (candidateIds.length === 0) return null;
  if (store.lastOpened && candidateIds.includes(store.lastOpened)) return store.lastOpened;
  return candidateIds.find((id) => candidateStatus(store, id) === "needs_capture") ?? candidateIds[0];
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** 영문과 숫자가 모두 든 덩어리(WH-CH720N의 ch720n 같은 모델 글자). */
function modelTokens(value: string): Set<string> {
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/);
  return new Set(tokens.filter((token) => /[a-z]/.test(token) && /[0-9]/.test(token)));
}

/**
 * 읽은 상품명이 후보 이름과 다른가. 공백과 기호를 빼고 소문자로 비교해서, 어느 쪽도 다른 쪽을 품지 않고
 * 영문+숫자 모델 글자도 겹치지 않으면 다름이다. 어느 쪽이 비어 있으면 비교하지 않는다(false).
 */
export function nameMismatch(readName: string, candidateName: string): boolean {
  const read = normalizeName(readName);
  const candidate = normalizeName(candidateName);
  if (!read || !candidate) return false;
  if (read.includes(candidate) || candidate.includes(read)) return false;
  const candidateModels = modelTokens(candidateName);
  for (const token of modelTokens(readName)) {
    if (candidateModels.has(token)) return false;
  }
  return true;
}

export type NameCheck =
  | { kind: "ok" }
  | { kind: "mismatch"; readName: string }
  | { kind: "missing" };

/** 초안의 상품명 항목을 후보 이름과 견준다. 읽지 못했으면 missing(어느 후보인지 물어야 한다). */
export function checkProductName(draft: SummaryDraft, candidateName: string): NameCheck {
  const field = draft.fields.find((entry) => entry.key === "productName");
  const value = field?.value?.trim();
  if (!value) return { kind: "missing" };
  return nameMismatch(value, candidateName) ? { kind: "mismatch", readName: value } : { kind: "ok" };
}

export const CAPTURE_MESSAGES = {
  noCandidates: "후보를 먼저 추가해 주세요",
  saved: (count: number, candidateNumber: number) =>
    count > 0
      ? `캡처 ${count}장을 후보 ${candidateNumber}에 저장했습니다`
      : `요약 초안을 후보 ${candidateNumber}에 저장했습니다`,
  savedHint:
    "마지막으로 ‘쇼핑몰에서 보기’를 누른 후보입니다. 읽은 상품명이 후보와 다르면 알려 드립니다.",
  mismatch: (readName: string, candidateName: string) =>
    `읽은 상품명 ‘${readName}’이 후보 ‘${candidateName}’와 다릅니다. 맞는 후보로 바꾸세요.`,
  missingName: "상품명을 읽지 못했습니다. 어느 후보의 캡처인지 골라 주세요.",
} as const;

/** 상품명 확인 결과에 맞는 경고 글자. 문제가 없으면 null. */
export function nameWarning(check: NameCheck, candidateName: string): string | null {
  if (check.kind === "mismatch") return CAPTURE_MESSAGES.mismatch(check.readName, candidateName);
  if (check.kind === "missing") return CAPTURE_MESSAGES.missingName;
  return null;
}

// ----- 기기 저장소(실패해도 화면은 돌아가야 한다) -----

export function readDraftStore(requestId: string): DraftStore {
  try {
    return parseDraftStore(window.localStorage.getItem(draftKey(requestId)));
  } catch {
    return emptyDraftStore();
  }
}

export function writeDraftStore(requestId: string, store: DraftStore) {
  try {
    window.localStorage.setItem(draftKey(requestId), serializeDraftStore(store));
  } catch {
    // 저장하지 못하면 이 화면을 닫을 때까지만 남는다.
  }
}

export function clearDraftStore(requestId: string) {
  try {
    window.localStorage.removeItem(draftKey(requestId));
  } catch {
    // 지우지 못해도 다음에 덮어쓸 뿐이다.
  }
}
