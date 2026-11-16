// 리서치 챗 화면의 순수 규칙: 칸 이름·번호, 구매 배지, 메시지 body 읽기, 지난 대화 접기. 브라우저 코드 없음(단위 시험 대상).

import type { ChatMessage, Purchase, SessionSnapshot, SlotKey, SlotMap, SlotValue } from "./researchClient";
import { SLOT_KEYS } from "./researchClient";

export const SLOT_LABEL: Record<SlotKey, string> = {
  model: "기종",
  pros: "장점",
  photo: "사진",
  alts: "같이 고민한 제품",
  altReason: "대안 이유",
  benefits: "혜택",
  refs: "참고 글",
};

export const SLOT_QUESTION_NAME: Record<SlotKey, string> = {
  model: "기종",
  pros: "장점",
  photo: "사진",
  alts: "같이 고민한 제품",
  altReason: "대안 이유",
  benefits: "혜택",
  refs: "참고 글",
};

export function isSlotKey(value: unknown): value is SlotKey {
  return typeof value === "string" && (SLOT_KEYS as readonly string[]).includes(value);
}

/** 질문 번호(1~7). 칸 순서와 같다. */
export function questionNumber(slot: SlotKey): number {
  return SLOT_KEYS.indexOf(slot) + 1;
}

/** 필수 칸. 구매함이면 사진이 더해지고 리서치만이면 사진 칸이 없다. */
export function requiredSlots(purchase: Purchase): SlotKey[] {
  return purchase === "bought" ? ["model", "pros", "photo", "altReason"] : ["model", "pros", "altReason"];
}

/** 패널에 보이는 칸. 리서치만이면 사진 칸을 숨긴다. */
export function panelSlots(purchase: Purchase): SlotKey[] {
  return SLOT_KEYS.filter((key) => key !== "photo" || purchase !== "research");
}

export function isFilled(slots: SlotMap, key: SlotKey): boolean {
  const status = slots[key]?.status;
  return status === "filled" || status === "confirmed";
}

export function requiredProgress(session: Pick<SessionSnapshot, "purchase" | "slots">): { filled: number; total: number } {
  const keys = requiredSlots(session.purchase);
  return { filled: keys.filter((key) => isFilled(session.slots, key)).length, total: keys.length };
}

export type BadgeKind = "before" | "bought" | "verified" | "research";

export function badgeOf(session: Pick<SessionSnapshot, "purchase" | "verified">): { kind: BadgeKind; label: string } {
  if (session.purchase === "research") return { kind: "research", label: "리서치만" };
  if (session.purchase === "unset") return { kind: "before", label: "구매 확인 전" };
  return session.verified
    ? { kind: "verified", label: "구매 인증됨" }
    : { kind: "bought", label: "구매함 · 사진 전" };
}

/** 칸 상태 꼬리표. 점선(AI 제안)과 실선(봉사자 확정)은 글자로도 구분한다. */
export function slotTag(slot: SlotValue | undefined): { text: string; tone: "mine" | "ai" | "skipped" | "empty" } {
  if (!slot) return { text: "비어 있음", tone: "empty" };
  if (slot.status === "skipped") return { text: "건너뜀", tone: "skipped" };
  if (slot.by === "ai" && slot.status === "filled") return { text: "AI 제안", tone: "ai" };
  return { text: "봉사자 확정", tone: "mine" };
}

/** 같이 고민한 제품 칸 값("A, B")을 이름 목록으로. */
export function altNames(slots: SlotMap): string[] {
  const value = slots.alts?.status === "skipped" ? "" : (slots.alts?.value ?? "");
  return value
    .split(/[,，]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** 확인했어요를 누른 링크(혜택·참고 글 칸에 쌓인다). */
export function checkedUrls(slots: SlotMap): Set<string> {
  return new Set([...(slots.benefits?.links ?? []), ...(slots.refs?.links ?? [])]);
}

/** 제품 사진 보기: 새 탭에서 열 이미지 검색 주소. 서버는 외부 페이지를 열지 않는다(design.md 3.4). */
export function imageSearchUrl(name: string): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// ----- 메시지 body 읽기(서버와 맞출 약속) -----

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function bodyKind(body: Record<string, unknown>): string {
  return str(body.kind) || "text";
}

export function textOf(body: Record<string, unknown>): string {
  return str(body.text);
}

export interface QuickReply {
  id: string;
  label: string;
  tone: "primary" | "normal";
  /** review_make이면 turn이 아니라 review POST를 부른다. */
  action: "turn" | "review_make";
}

export function quickOf(body: Record<string, unknown>): QuickReply[] {
  return list(body.quick).flatMap((entry): QuickReply[] => {
    const item = record(entry);
    const id = str(item.id);
    const label = str(item.label);
    if (!id || !label) return [];
    return [
      {
        id,
        label,
        tone: item.tone === "primary" ? "primary" : "normal",
        action: item.action === "review_make" ? "review_make" : "turn",
      },
    ];
  });
}

export interface ChipView {
  label: string;
  value: string;
  slot: SlotKey;
}

export function chipsOf(body: Record<string, unknown>): { caption: string; chips: ChipView[]; ownLabel: string } | null {
  const raw = list(body.chips);
  if (raw.length === 0) return null;
  const slot: SlotKey = isSlotKey(body.chipSlot) ? body.chipSlot : "model";
  const chips = raw.flatMap((entry): ChipView[] => {
    const item = record(entry);
    const label = str(item.label) || str(item.value);
    const value = str(item.value) || label;
    return label ? [{ label, value, slot }] : [];
  });
  return chips.length === 0
    ? null
    : { caption: str(body.chipsCaption) || `AI 제안 · 웹에서 찾은 후보 ${chips.length}개`, chips, ownLabel: str(body.ownLabel) || "직접 적을게요" };
}

export interface ProductView {
  name: string;
  feature: string;
  pageUrl: string;
}

export function productsOf(body: Record<string, unknown>): { items: ProductView[]; noneLabel: string; ownLabel: string } | null {
  if (bodyKind(body) !== "products") return null;
  const items = list(body.items).flatMap((entry): ProductView[] => {
    const item = record(entry);
    const name = str(item.name);
    return name ? [{ name, feature: str(item.feature), pageUrl: str(item.pageUrl) }] : [];
  });
  return { items, noneLabel: str(body.noneLabel) || "같이 고민한 제품 없어요", ownLabel: str(body.ownLabel) || "직접 적을게요" };
}

export type BenefitMode = "ai" | "check";

export interface BenefitItem {
  id: string;
  title: string;
  kind: string;
  condition: string;
  compare: string;
  url: string;
  /** check = 직접 확인 필요(AI가 열 수 없는 사이트). */
  mode: BenefitMode;
}

export function benefitsOf(body: Record<string, unknown>): { headline: string; items: BenefitItem[] } | null {
  if (bodyKind(body) !== "benefits") return null;
  const items = list(body.items).flatMap((entry, index): BenefitItem[] => {
    const item = record(entry);
    const title = str(item.title);
    const url = str(item.url);
    if (!title) return [];
    return [
      {
        id: str(item.id) || `b${index}`,
        title,
        kind: str(item.kind),
        condition: str(item.condition),
        compare: str(item.compare),
        url,
        mode: item.mode === "check" || item.status === "check" ? "check" : "ai",
      },
    ];
  });
  return { headline: str(body.headline) || str(body.text), items };
}

export function linkOf(body: Record<string, unknown>): { url: string; note: string } | null {
  if (bodyKind(body) !== "link") return null;
  const url = str(body.url);
  return url ? { url, note: str(body.note) || "AI가 열 수 없는 주소라 직접 확인이 필요해요." } : null;
}

export function guideOf(body: Record<string, unknown>): { queries: string[]; checks: string[]; steps: string[] } | null {
  if (bodyKind(body) !== "guide") return null;
  const strings = (value: unknown) => list(value).map(str).filter(Boolean);
  return { queries: strings(body.queries), checks: strings(body.checks), steps: strings(body.steps) };
}

export function photoIdOf(body: Record<string, unknown>): string | null {
  return bodyKind(body) === "photo" ? str(body.photoId) || null : null;
}

// ----- 꼬리표·접기 -----

export function tagLabel(message: ChatMessage): { chip: string; note: string } | null {
  const slot = isSlotKey(message.slot) ? message.slot : null;
  switch (message.tag) {
    case "question":
      return slot ? { chip: "칸 질문", note: `질문 ${questionNumber(slot)} · ${SLOT_QUESTION_NAME[slot]}` } : { chip: "질문", note: "" };
    case "fill":
      return { chip: "칸 채움", note: slot ? SLOT_LABEL[slot] : "" };
    case "search":
      return { chip: "찾는 방법", note: slot ? `웹 검색 · ${SLOT_LABEL[slot]}` : "웹 검색" };
    case "review":
      return { chip: "요약 제안", note: "이용자에게 보낼 리뷰" };
    default:
      return null;
  }
}

export interface FoldPlan {
  /** 접힌 메시지의 seq 상한(이 값 이하가 접힌다). 접을 것이 없으면 0. */
  foldedUpTo: number;
  foldedCount: number;
  summary: string;
}

/**
 * 지난 질문을 접는다. 칸 질문이 4개 이상이면 마지막 두 질문 앞의 대화를 한 줄로 줄인다.
 * 읽기 전용 낭독을 위해 접힌 줄도 펼치기 버튼으로 모두 볼 수 있다.
 */
export function planFold(messages: readonly ChatMessage[], verified: boolean): FoldPlan {
  const questions = messages.filter((message) => message.role === "ai" && message.tag === "question" && isSlotKey(message.slot));
  if (questions.length < 4) return { foldedUpTo: 0, foldedCount: 0, summary: "" };
  const keep = questions[questions.length - 2];
  const folded = messages.filter((message) => message.seq < keep.seq);
  if (folded.length === 0) return { foldedUpTo: 0, foldedCount: 0, summary: "" };
  const foldedQuestions = questions.filter((message) => message.seq < keep.seq);
  const numbers = foldedQuestions.map((message) => questionNumber(message.slot as SlotKey));
  const names = foldedQuestions.map((message) => SLOT_QUESTION_NAME[message.slot as SlotKey]);
  const range = numbers.length === 1 ? `질문 ${numbers[0]}` : `질문 ${numbers[0]}~${numbers[numbers.length - 1]}`;
  const summary = `${range} · ${names.join(", ")} — 칸 채움 완료${verified ? ", 구매 인증됨" : ""}`;
  return { foldedUpTo: keep.seq - 1, foldedCount: folded.length, summary };
}

/** 마지막 AI 메시지가 묻는 칸(지금 질문). */
export function currentSlot(messages: readonly ChatMessage[]): SlotKey | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "ai" && message.tag === "question" && isSlotKey(message.slot)) return message.slot;
  }
  return null;
}

/** 검색 중 문구(웹 검색이 길 때 0초 → 4초 → 10초로 바꾼다). */
export const THINKING_COPY = {
  turn: ["생각하는 중이에요.", "조금만 더 기다려 주세요.", "답이 늦어지고 있어요. 잠시 뒤 다시 확인해 볼게요."],
  model: ["웹에서 기종 후보를 찾는 중이에요.", "찾은 후보를 정리하는 중이에요.", "조금만 더 기다려 주세요. 오래 걸리면 쇼핑몰에서 직접 찾아도 돼요."],
  alts: ["웹에서 같이 고민할 만한 제품을 찾는 중이에요.", "찾은 제품을 정리하는 중이에요.", "조금만 더 기다려 주세요. 오래 걸리면 쇼핑몰에서 직접 찾아도 돼요."],
  benefits: ["공식몰 행사 찾는 중이에요.", "카드 혜택 찾는 중이에요.", "쿠폰·배송 혜택 찾는 중이에요."],
  photo: ["사진을 올리는 중이에요.", "사진을 올리는 중이에요.", "사진을 올리는 중이에요."],
  review: ["리뷰 초안을 만드는 중이에요.", "리뷰 초안을 다듬는 중이에요.", "조금만 더 기다려 주세요."],
} as const;

export type ThinkingKind = keyof typeof THINKING_COPY;

/** 시작 뒤 경과 ms에 맞는 단계(0, 1, 2). */
export function thinkingPhase(elapsedMs: number): 0 | 1 | 2 {
  if (elapsedMs >= 10_000) return 2;
  if (elapsedMs >= 4_000) return 1;
  return 0;
}

/** 검수 글자 수 한도(서버 PUT과 같은 50~1000). */
export const REVIEW_MIN = 50;
export const REVIEW_MAX = 1000;
