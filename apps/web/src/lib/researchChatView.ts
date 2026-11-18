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

/**
 * 서버는 혜택을 종류별 메시지 여러 개로 보낸다(메시지 크기 상한). 화면은 연달아 온 혜택 메시지를 첫 메시지 하나로 모아 한 장씩 넘겨 본다.
 * 값: 첫 메시지 seq → 모은 묶음, 뒤 메시지 seq → null(그리지 않음). 혜택이 아닌 메시지는 들어 있지 않다.
 * 첫 머리 줄 끝의 종류 이름("… 공식몰·제조사 행사")은 카드마다 "출처"로 나오므로 뺀다.
 */
export function mergeBenefitRuns(
  messages: readonly ChatMessage[],
): Map<number, { headline: string; items: BenefitItem[] } | null> {
  const out = new Map<number, { headline: string; items: BenefitItem[] } | null>();
  let head: { headline: string; items: BenefitItem[] } | null = null;
  for (const message of messages) {
    const benefits = benefitsOf(message.body);
    if (!benefits) {
      head = null;
      continue;
    }
    if (head) {
      head.items.push(...benefits.items);
      out.set(message.seq, null);
      continue;
    }
    const label = benefits.items[0]?.kind ?? "";
    const headline =
      label && benefits.headline.endsWith(` ${label}`) ? benefits.headline.slice(0, -label.length - 1) : benefits.headline;
    head = { headline, items: [...benefits.items] };
    out.set(message.seq, head);
  }
  return out;
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
    case "brief":
      return { chip: "이용자 요청", note: "기종 질문 전에 확인" };
    default:
      return null;
  }
}

const isBrief = (message: ChatMessage) => message.role === "ai" && message.tag === "brief";

/** 이용자 요청 확인 표시 메시지(brief)가 대화에 있는가. */
export function hasBrief(messages: readonly ChatMessage[]): boolean {
  return messages.some(isBrief);
}

/**
 * 봉사자가 이용자 요청 카드를 다 보기 전에는 첫 brief 메시지까지만 보인다(그 뒤 기종 질문 등은 숨긴다).
 * done이거나 brief가 없으면 그대로. 서버 대화 기록은 바꾸지 않는다(화면이 잠시 숨기는 것이다).
 */
export function holdAfterBrief(messages: readonly ChatMessage[], done: boolean): ChatMessage[] {
  if (done) return [...messages];
  const index = messages.findIndex(isBrief);
  return index === -1 ? [...messages] : messages.slice(0, index + 1);
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

// ----- 서버 응답에 맞춘 읽기(서버 코드가 기준이다: researchTurn·researchSearch·researchApi) -----

/** 말풍선 아래 쇼핑몰·검색 바로가기(서버가 `shortcuts: [{label, url}]`로 준다). https 주소만 쓴다. */
export function shortcutsOf(body: Record<string, unknown>): { label: string; url: string }[] {
  return list(body.shortcuts).flatMap((entry) => {
    const item = record(entry);
    const label = str(item.label);
    const url = str(item.url);
    return label && isHttpsUrl(url) ? [{ label, url }] : [];
  });
}

const isBenefitsSearch = (message: ChatMessage) => message.role === "ai" && message.tag === "search" && message.slot === "benefits";
const isRefsQuestion = (message: ChatMessage) => message.role === "ai" && message.tag === "question" && message.slot === "refs";

/**
 * 혜택 칸이 정해졌는데(채움·확인·건너뜀) 대화에 혜택 검색 결과가 아직 없는가.
 * 턴 응답의 followUp은 한 번에 하나만 와서, 같은 턴에 기종·대안 질문이 함께 나오면 혜택 검색이 빠진다(contract-ui.md).
 * 그때 화면이 직접 `benefits`를 부른다(서버가 캐시로 답해 한 번만 센다).
 */
export function needsBenefitsSearch(view: { slots: SlotMap; messages: readonly ChatMessage[] }): boolean {
  const status = view.slots.benefits?.status;
  if (status !== "filled" && status !== "confirmed" && status !== "skipped") return false;
  return !view.messages.some(isBenefitsSearch);
}

/**
 * 질문 7을 보류해야 하는가(혜택 검색이 진행 중이거나 곧 불릴 때).
 * 진행 중: 이 화면이 부른 검색(thinkingKind) 또는 서버가 알린 진행(pending.search).
 * 곧 불림: 혜택 칸은 찼는데 카드가 없고 혜택 검색이 아직 끝난 적 없다(benefitsEnded가 false). 다른 검색이 도는 동안 대기열에서 기다리는 때와
 * 새로 고친 직후 호출 전이 여기에 든다. 혜택 검색이 한 번 끝나면(성공·실패·폴링 시간 초과) 카드가 안 와도, 서버 pending이 남아 있어도 보류하지 않는다.
 */
export function holdsRefsQuestion(
  view: { slots: SlotMap; messages: readonly ChatMessage[]; pending: { search?: { kind: string } | null } } | null,
  thinkingKind: string | null,
  benefitsEnded: boolean,
): boolean {
  if (thinkingKind === "benefits") return true;
  if (!view || benefitsEnded) return false;
  if (view.pending.search?.kind === "benefits") return true;
  return needsBenefitsSearch(view);
}

/**
 * 질문 7(참고 글) 말풍선은 혜택 카드 뒤에 그린다(contract-ui.md "질문 7 말풍선 그리기 순서").
 * 혜택 칸을 채운 턴 응답에는 질문 7이 이미 들어 있어 메시지 번호는 질문 7이 혜택 카드보다 앞이다.
 * - 혜택 검색이 진행 중이면(searching) 질문 7을 아직 그리지 않는다. 검색이 실패해 카드가 끝내 안 와도 진행이 끝나면 제자리에 보인다.
 * - 혜택 카드가 뒤에 있으면 질문 7을 마지막 혜택 카드 아래로 옮긴다.
 */
export function arrangeMessages(messages: readonly ChatMessage[], searchingBenefits: boolean): ChatMessage[] {
  const refsIndex = messages.findIndex(isRefsQuestion);
  if (refsIndex === -1) return [...messages];
  const refs = messages[refsIndex];
  let lastCard = -1;
  messages.forEach((message, index) => {
    if (index > refsIndex && isBenefitsSearch(message)) lastCard = index;
  });
  if (lastCard === -1) return searchingBenefits ? messages.filter((message) => message !== refs) : [...messages];
  return [...messages.slice(0, refsIndex), ...messages.slice(refsIndex + 1, lastCard + 1), refs, ...messages.slice(lastCard + 1)];
}

const SLOT_MISSING_NAME: Record<SlotKey, string> = { ...SLOT_LABEL, photo: "구매 인증 사진" };

/** 서버가 `missing`으로 주는 빠진 필수 칸(purchase 포함)을 글로. */
export function missingText(missing: unknown): string {
  const names = list(missing).flatMap((entry) => {
    if (entry === "purchase") return ["구매 여부"];
    return isSlotKey(entry) ? [SLOT_MISSING_NAME[entry]] : [];
  });
  return names.join(", ");
}

/** 서버 오류 이유(error, body)를 봉사자에게 보일 글로. 모르는 이유는 fallback. */
export function failureText(
  context: "turn" | "search" | "photo" | "review" | "send",
  status: number,
  error: string,
  body: Record<string, unknown>,
  fallback: string,
): string {
  if (status === 429) return error === "photo_cap" ? "이 요청에서 올릴 수 있는 사진 횟수를 다 썼어요." : "요청이 많아요. 잠시 뒤에 다시 해 주세요.";
  if (status === 413 || error === "too_large" || error === "image_too_large" || error === "thumb_too_large") {
    return "사진이 너무 커요. 다른 사진을 골라 주세요.";
  }
  if (status === 415 || error === "bad_image_format") return "이 사진 형식은 받을 수 없어요. JPEG나 PNG 사진을 골라 주세요.";
  if (error === "photos_full") return "사진은 3장까지 올릴 수 있어요.";
  if (error === "photo_not_needed") return "리서치만 고르셨어요. 사진은 필요 없어요.";
  if (error === "missing_required") {
    const names = missingText(body.missing);
    return `필수 칸이 비어 있어요${names ? `: ${names}` : ""}. 채운 뒤에 ${context === "send" ? "보내 주세요" : "다시 눌러 주세요"}.`;
  }
  if (error === "not_ready") return "질문 7(참고 글)까지 답하거나 건너뛰고, 확인할 내용을 마친 뒤에 만들 수 있어요.";
  if (error === "review_not_confirmed") return "검수를 마친 글이 아니에요. [검수 마치기]를 먼저 눌러 주세요.";
  return fallback;
}

/** 서버가 422 review_blocked로 주는 막힌 이유 목록. */
export function reasonsOf(body: Record<string, unknown>): string[] {
  return list(body.reasons).filter((reason): reason is string => typeof reason === "string" && reason !== "");
}

/**
 * 지금 눌러 답할 수 있는 빠른 답. 맨 뒤에서부터 거슬러 올라가며 AI 말풍선의 `quick`을 찾는다.
 * - 꼬리표가 notice·fill·search인 말풍선(확인 안내, 칸 채움, 검색 결과)과 봉사자 말은 지나친다.
 * - 칸 질문(question)이나 리뷰 제안(review)에서 멈춘다. 그 질문에 `quick`이 없으면 빠른 답도 없다.
 * 그래서 [확인했어요]를 누른 뒤에도(안내 말풍선이 뒤에 붙어도) 질문 7의 [건너뛰기]가 남는다.
 */
export function activeQuick(messages: readonly ChatMessage[]): QuickReply[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "ai") continue;
    const quick = quickOf(message.body);
    if (quick.length > 0) return quick;
    if (message.tag === "question" || message.tag === "review") return [];
  }
  return [];
}
