// 요청별 기기 초안: localStorage `lh.vol.draft.v1.<requestId>`. 브라우저에서만 쓴다.
// 블록 2는 manual(직접 추가한 후보)과 lastOpened(마지막으로 '쇼핑몰에서 보기'를 누른 후보)를 쓴다.
// drafts(후보별 요약 초안)는 블록 3, edits·confirmed는 블록 4가 채운다. 여기서는 객체면 그대로 보존한다.
// 값이 없거나 깨졌으면 빈 값으로 읽는다. 내려놓기나 보내기에 성공하면 지운다.

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
