// 리서치 챗 대화 상태의 공용 타입과 순수 규칙(화면·서버·메모리 저장소가 함께 쓴다). design.md 4.5, 5.1.
// SQL(`research_next_valid`, `research_required_missing`, `research_slot_askable`)과 같은 규칙이다.
// 규칙을 바꾸면 SQL 마이그레이션과 `tests/unit/sql/researchSql.test.ts`도 함께 바꾼다.

/** 칸 7개. 이 배열의 순서가 질문 순서 목록 Q다(사진은 구매함일 때만 묻는다). */
export const SLOT_KEYS = ["model", "pros", "photo", "alts", "altReason", "benefits", "refs"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export type Purchase = "unset" | "bought" | "research";
export type SlotStatus = "filled" | "confirmed" | "skipped";

export interface SlotState {
  value: string;
  links?: string[];
  status: SlotStatus;
  by: "volunteer" | "ai";
  /** 재질문 뒤에도 짧은 답이라 봉사자 글을 그대로 넣은 칸. */
  short?: boolean;
  at?: string;
}
export type Slots = Partial<Record<SlotKey, SlotState>>;

export interface ResearchCounters {
  asked: Partial<Record<SlotKey, boolean>>;
  reasked: Partial<Record<SlotKey, number>>;
}

export interface PendingCheck {
  slot?: string;
  [key: string]: unknown;
}
/** 확인 필요(confirmFill, 이후 PR의 mismatch·shotCheck)와 직전 질문(lastQuestion). */
export interface ResearchPending {
  confirmFill?: PendingCheck;
  mismatch?: PendingCheck;
  shotCheck?: PendingCheck;
  lastQuestion?: { slot: string; seq: number };
  [key: string]: unknown;
}

export interface ResearchReview {
  text?: string;
  status?: "draft" | "confirmed";
  rev?: number;
  confirmedVersion?: number;
  at?: string;
}

export interface ResearchMessage {
  seq: number;
  role: "ai" | "volunteer" | "system";
  tag?: string | null;
  slot?: string | null;
  body: Record<string, unknown>;
  turnId?: string | null;
  ai?: "ok" | "fallback" | "none" | "capped" | null;
  createdAt?: string;
}

export interface ResearchPhoto {
  id: string;
  /** 사진 AI 설명은 11/18 뒤(P2)라 지금은 null. */
  description: string | null;
  seenModel: string | null;
  shot: "photo" | "screenshot" | "unclear" | null;
  createdAt: string;
  /** 열기(open)에서만 온다. data:image/jpeg;base64,... */
  thumb?: string;
}

export interface ResearchSessionData {
  sessionId: string;
  volunteerId: string;
  purchase: Purchase;
  slots: Slots;
  extras: string[];
  counters: ResearchCounters;
  pending: ResearchPending;
  review: ResearchReview;
  version: number;
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchView extends ResearchSessionData {
  photos: ResearchPhoto[];
  messages: ResearchMessage[];
}

/** 다음 질문 후보. 서버가 순서대로 늘어놓고 저장소가 잠근 상태에서 첫 유효 후보를 고른다. */
export type NextAction =
  | "ask_purchase"
  | "ask_slot"
  | "reask"
  | "pending_notice"
  | "ask_extra"
  | "propose_review";

export interface NextMessage {
  role: ResearchMessage["role"];
  tag?: string | null;
  slot?: string | null;
  body: Record<string, unknown>;
  ai?: ResearchMessage["ai"];
}
export interface NextCandidate {
  action: NextAction;
  slot?: SlotKey | null;
  message: NextMessage;
}

export interface ResearchPatch {
  purchase?: Exclude<Purchase, "unset">;
  /** 값이 null이면 칸을 비운다. */
  slots?: Partial<Record<SlotKey, SlotState | null>>;
  extras?: string[];
  asked?: SlotKey[];
  reasked?: SlotKey[];
  /** 값이 null이면 그 키를 지운다. */
  pending?: Record<string, unknown>;
}

// ---------- 상한 ----------

export interface ResearchCaps {
  turns: number;
  searches: number;
  photoUploads: number;
  reviews: number;
  dailySearches: number;
  dailyAi: number;
}

/** 요청당·하루 상한(design.md 4.12). 하루 값은 환경변수로 바꿀 수 있다. */
export const DEFAULT_CAPS: ResearchCaps = {
  turns: 40,
  searches: 12,
  photoUploads: 6,
  reviews: 3,
  dailySearches: 60,
  dailyAi: 600,
};

export const MAX_PHOTOS = 3;
export const SLOT_VALUE_MAX = 200;
export const MAX_EXTRAS = 3;
/** 이 시간 동안 활동이 없으면 요청을 대기열로 돌린다(결정 ③). */
export const IDLE_RETURN_MS = 6 * 60 * 60 * 1000;
/** 검색 진행 중 표시를 믿는 시간. 넘으면 다시 시도할 수 있다. */
export const SEARCH_PENDING_MS = 90_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function capsFromEnv(env: Record<string, string | undefined> = process.env): ResearchCaps {
  return {
    ...DEFAULT_CAPS,
    dailySearches: positiveInt(env.RESEARCH_DAILY_SEARCH_CAP, DEFAULT_CAPS.dailySearches),
    dailyAi: positiveInt(env.RESEARCH_DAILY_AI_CAP, DEFAULT_CAPS.dailyAi),
  };
}

// ---------- 칸 규칙 ----------

const REQUIRED_BASE: readonly SlotKey[] = ["model", "pros", "altReason"];

export function isSlotKey(value: unknown): value is SlotKey {
  return typeof value === "string" && (SLOT_KEYS as readonly string[]).includes(value);
}

/** 필수 칸. 구매함이면 사진이 더해지고, 리서치만이면 사진 칸은 없다. purchase가 정해졌는지는 따로 본다. */
export function requiredSlots(purchase: Purchase): SlotKey[] {
  return purchase === "bought" ? [...REQUIRED_BASE, "photo"] : [...REQUIRED_BASE];
}

/** 질문 순서 목록 Q. 리서치만이면 사진이 빠진다. */
export function questionOrder(purchase: Purchase): SlotKey[] {
  return SLOT_KEYS.filter((key) => key !== "photo" || purchase === "bought");
}

export function isFilled(slots: Slots, key: SlotKey): boolean {
  const status = slots[key]?.status;
  return status === "filled" || status === "confirmed";
}

type SessionLike = Pick<ResearchSessionData, "purchase" | "slots" | "extras" | "counters" | "pending">;

/** 비어 있는 필수. 구매 여부가 정해지지 않았으면 "purchase"가 맨 앞에 온다. */
export function requiredMissing(session: Pick<SessionLike, "purchase" | "slots">): string[] {
  const missing: string[] = [];
  if (session.purchase === "unset") missing.push("purchase");
  for (const key of requiredSlots(session.purchase)) {
    if (!isFilled(session.slots, key)) missing.push(key);
  }
  return missing;
}

/** 필수 4칸 가운데 찬 칸 수(와이어의 "n/4"). 리서치만이면 3칸이 분모다. */
export function requiredProgress(session: Pick<SessionLike, "purchase" | "slots">): {
  filled: number;
  total: number;
} {
  const keys = requiredSlots(session.purchase === "bought" ? "bought" : "research");
  return { filled: keys.filter((key) => isFilled(session.slots, key)).length, total: keys.length };
}

const CHECK_KEYS = ["mismatch", "shotCheck", "confirmFill"] as const;

export function hasUnresolvedCheck(pending: ResearchPending): boolean {
  return CHECK_KEYS.some((key) => {
    const value = pending[key];
    return typeof value === "object" && value !== null;
  });
}

/** 질문 가능: 비어 있고, 확인 필요가 걸린 칸이 아니고, 사진 칸은 구매함일 때만. */
export function isAskable(session: SessionLike, key: SlotKey): boolean {
  if (session.slots[key]?.status) return false;
  if (key === "photo" && session.purchase !== "bought") return false;
  for (const checkKey of CHECK_KEYS) {
    const check = session.pending[checkKey];
    if (typeof check === "object" && check !== null && (check as PendingCheck).slot === key) return false;
  }
  return true;
}

/** 질문 7을 지났다 = 첫 회차 후보(질문 가능하고 아직 안 물은 칸)가 없다. 구매 여부가 unset이면 아직이다. */
export function isPastQuestionSeven(session: SessionLike): boolean {
  if (session.purchase === "unset") return false;
  return !questionOrder(session.purchase).some(
    (key) => isAskable(session, key) && !session.counters.asked[key],
  );
}

/** 다음 질문 후보가 지금 상태에서 유효한가(design.md 4.5). */
export function isNextValid(session: SessionLike, candidate: NextCandidate): boolean {
  const { action } = candidate;
  if (action === "ask_purchase") return session.purchase === "unset";
  if (session.purchase === "unset") return false;
  if (action === "pending_notice") return hasUnresolvedCheck(session.pending);
  if (action === "ask_slot" || action === "reask") {
    const key = candidate.slot;
    if (!key || !isSlotKey(key) || !isAskable(session, key)) return false;
    if (action === "reask") return (session.counters.reasked[key] ?? 0) < 1;
    // 이미 물은 칸은 필수일 때만 다시 묻는다(둘째 회차).
    return !session.counters.asked[key] || requiredSlots(session.purchase).includes(key);
  }
  if (action === "ask_extra" || action === "propose_review") {
    if (!isPastQuestionSeven(session)) return false;
    if (requiredMissing(session).length > 0) return false;
    if (action === "ask_extra") return session.extras.length < MAX_EXTRAS;
    return !hasUnresolvedCheck(session.pending);
  }
  return false;
}

/** 후보 목록에서 첫 유효 후보. 없으면 null. */
export function firstValidNext(
  session: SessionLike,
  candidates: readonly NextCandidate[] | null | undefined,
): NextCandidate | null {
  for (const candidate of candidates ?? []) {
    if (isNextValid(session, candidate)) return candidate;
  }
  return null;
}

/** 봉사자가 보는 구매 배지 상태. */
export type PurchaseBadge = "before" | "bought_no_photo" | "verified" | "research";

export function purchaseBadge(session: Pick<SessionLike, "purchase" | "slots" | "pending">): PurchaseBadge {
  if (session.purchase === "research") return "research";
  if (session.purchase === "unset") return "before";
  // 구매 인증됨 = 구매함 + 직접 찍은 사진 1장 이상 + 미해결 사진 확인 없음.
  const photoDone = isFilled(session.slots, "photo");
  const photoCheck = session.pending.mismatch || session.pending.shotCheck;
  return photoDone && !photoCheck ? "verified" : "bought_no_photo";
}

// ---------- patch ----------

export type PatchResult =
  | { ok: true; purchase: Purchase; slots: Slots; extras: string[]; counters: ResearchCounters; pending: ResearchPending; changed: boolean }
  | { ok: false };

/** null 값 키를 지우며 합친다(SQL research_merge와 같다). */
export function mergePending(
  base: ResearchPending,
  patch: Record<string, unknown> | undefined | null,
): ResearchPending {
  const out: Record<string, unknown> = { ...base, ...(patch ?? {}) };
  for (const key of Object.keys(out)) {
    if (out[key] === null) delete out[key];
  }
  return out as ResearchPending;
}

/** 패치를 상태에 적용한다. SQL research_apply의 patch 규칙과 같다. 잘못된 patch면 {ok:false}. */
export function applyPatch(session: SessionLike, patch: ResearchPatch | null | undefined): PatchResult {
  const purchase = patch?.purchase ?? session.purchase;
  if (purchase !== "unset" && purchase !== "bought" && purchase !== "research") return { ok: false };
  const slots: Slots = { ...session.slots };
  for (const [key, value] of Object.entries(patch?.slots ?? {})) {
    // photo 칸은 사진 넣기·지우기만 바꾼다(사진 행과 어긋나지 않게).
    if (!isSlotKey(key) || key === "photo") return { ok: false };
    if (value === null) {
      delete slots[key];
    } else {
      if (typeof value !== "object" || !["filled", "confirmed", "skipped"].includes(value.status)) {
        return { ok: false };
      }
      // 채운 칸은 값이 비면 안 되고, 값은 200자 이하다.
      if (typeof value.value !== "string" || value.value.length > SLOT_VALUE_MAX) return { ok: false };
      if (value.status !== "skipped" && value.value.trim() === "") return { ok: false };
      slots[key] = { ...value };
    }
  }
  let extras = session.extras;
  if (patch && "extras" in patch && patch.extras !== undefined) {
    if (!Array.isArray(patch.extras) || patch.extras.length > MAX_EXTRAS) return { ok: false };
    extras = [...patch.extras];
  }
  const counters: ResearchCounters = {
    asked: { ...session.counters.asked },
    reasked: { ...session.counters.reasked },
  };
  for (const key of patch?.asked ?? []) counters.asked[key] = true;
  for (const key of patch?.reasked ?? []) counters.reasked[key] = 1;
  const pending = mergePending(session.pending, patch?.pending);
  const changed =
    purchase !== session.purchase ||
    JSON.stringify(slots) !== JSON.stringify(session.slots) ||
    JSON.stringify(extras) !== JSON.stringify(session.extras);
  return { ok: true, purchase, slots, extras, counters, pending, changed };
}

/** 고른 후보가 남기는 흔적: asked·reasked와 직전 질문(lastQuestion). */
export function afterAsk(
  counters: ResearchCounters,
  pending: ResearchPending,
  candidate: NextCandidate,
  lastSeq: number,
): { counters: ResearchCounters; pending: ResearchPending } {
  const nextCounters: ResearchCounters = {
    asked: { ...counters.asked },
    reasked: { ...counters.reasked },
  };
  let slot: string | null = null;
  if ((candidate.action === "ask_slot" || candidate.action === "reask") && candidate.slot) {
    nextCounters.asked[candidate.slot] = true;
    if (candidate.action === "reask") nextCounters.reasked[candidate.slot] = 1;
    slot = candidate.slot;
  } else if (candidate.action === "ask_purchase") {
    slot = "purchase";
  } else if (candidate.action === "ask_extra") {
    slot = "extra";
  } else if (candidate.action === "propose_review") {
    slot = "review";
  }
  const nextPending = slot
    ? mergePending(pending, { lastQuestion: { slot, seq: lastSeq } })
    : pending;
  return { counters: nextCounters, pending: nextPending };
}

/** 빈 세션 상태(열기에서 만든 직후). */
export function emptySessionState(): Pick<
  ResearchSessionData,
  "purchase" | "slots" | "extras" | "counters" | "pending" | "review" | "version"
> {
  return {
    purchase: "unset",
    slots: {},
    extras: [],
    counters: { asked: {}, reasked: {} },
    pending: {},
    review: {},
    version: 0,
  };
}
