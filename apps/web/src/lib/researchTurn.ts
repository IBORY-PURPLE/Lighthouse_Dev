import { answerTurn, type ResearchContext, type Upstream } from "./researchAi";
import { cleanText, hasForbidden, tokensCovered, unknownModelTokens } from "./researchCheck";
import {
  applyPatch,
  firstValidNext,
  hasUnresolvedCheck,
  isAskable,
  isFilled,
  isSlotKey,
  mergePending,
  questionOrder,
  requiredSlots,
  SLOT_KEYS,
  SLOT_VALUE_MAX,
  type NextCandidate,
  type NextMessage,
  type ResearchPatch,
  type ResearchView,
  type SlotKey,
  type SlotState,
} from "./researchSession";
import {
  CAP_DAILY,
  CAP_REQUEST,
  CONFIRM_FILL,
  CONFIRM_QUICK,
  FALLBACK_NOTICE,
  LINK_CHECKED,
  LINK_FULL,
  LINK_NOTE,
  NO_CONFIRM,
  PENDING_NOTICE,
  PURCHASE_FIXED,
  PURCHASE_QUESTION,
  PURCHASE_QUICK,
  REASK_PREFIX,
  REQUIRED_SKIP,
  REVIEW_MORE,
  REVIEW_PROPOSAL,
  REVIEW_QUICK,
  SKIP_LABEL,
  SKIPPABLE,
  SLOT_NAME,
  questionQuick,
  turnQuestion,
  type QuestionContext,
} from "./researchTurnText";
import { buildTurnMaterial, shownNames } from "./researchTurnPrompt";
import { isUuid } from "./volunteerApi";
import { searchQueryOf } from "./shopLinks";

// 대화형 리서치 챗의 한 턴: 요청 본문 검사, AI 출력 검사(evidence), 칸 채우기·질문 순서·대체 동작 계획. design.md 3.2, 4.1~4.6.
// AI는 봉사자 말에서 칸을 읽고 다음 칸을 "제안"할 뿐이고, 질문 순서와 필수 규칙은 서버(researchSession.ts)가 정한다.
// 카운터와 질문 후보 고르기는 저장소(DB 함수)가 잠근 상태에서 한다. 이 파일은 순수 함수와 AI 호출 한 번만 가진다.

// ---- 요청 본문 -----------------------------------------------------------------------

export const TEXT_MAX = 1000;
const SLOT_VALUE_LIMIT = 120;
const EDIT_MAX = 200;
const URL_MAX = 500;
/** 한 세션에서 확인을 기다리는 링크 카드 수(pending 8,000바이트 안에 든다). */
const SHOWN_LINKS_MAX = 5;
const BODY_BYTES_MAX = 8000;

export const QUICK_IDS = [
  "purchase.bought",
  "purchase.research",
  "confirm.yes",
  "confirm.no",
  "review.more",
] as const;
export type QuickId = (typeof QUICK_IDS)[number];

export type ChipSlot = "model" | "alts";

export type TurnInput =
  | { type: "text"; text: string }
  | { type: "quick"; replyId: QuickId }
  | { type: "chip"; slot: ChipSlot; value: string }
  | { type: "edit"; slot: SlotKey; text: string }
  | { type: "skip"; slot: SlotKey }
  | { type: "link_check"; url: string };

export interface TurnBody {
  clientTurnId: string;
  sessionId: string;
  baseVersion: number;
  input: TurnInput;
}

export type ParsedTurnBody = { ok: true; body: TurnBody } | { ok: false; error: "invalid_request" };

const bad: ParsedTurnBody = { ok: false, error: "invalid_request" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const charCount = (value: string) => [...value].length;
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** 본문 검사(400). 상태에 기대는 검사는 하지 않는다: 처리 중 자리를 만든 뒤 400으로 끝나면 같은 turnId가 막히기 때문이다. */
export function parseTurnBody(raw: unknown): ParsedTurnBody {
  if (!isRecord(raw)) return bad;
  const { clientTurnId, sessionId, baseVersion, input } = raw;
  if (typeof clientTurnId !== "string" || clientTurnId.length < 1 || clientTurnId.length > 100) return bad;
  if (typeof sessionId !== "string" || !isUuid(sessionId)) return bad;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0 || baseVersion > 1_000_000) {
    return bad;
  }
  if (!isRecord(input) || typeof input.type !== "string") return bad;

  const parsed = ((): TurnInput | null => {
    switch (input.type) {
      case "text": {
        if (typeof input.text !== "string") return null;
        const text = input.text.trim();
        return text === "" || charCount(text) > TEXT_MAX ? null : { type: "text", text };
      }
      case "quick": {
        const id = typeof input.replyId === "string" ? input.replyId : "";
        if ((QUICK_IDS as readonly string[]).includes(id)) return { type: "quick", replyId: id as QuickId };
        const skip = /^skip\.(alts|benefits|refs)$/.exec(id);
        return skip ? { type: "skip", slot: skip[1] as SlotKey } : null;
      }
      case "chip": {
        if (input.slot !== "model" && input.slot !== "alts") return null;
        const value = typeof input.value === "string" ? oneLine(input.value) : "";
        return value === "" || charCount(value) > SLOT_VALUE_LIMIT ? null : { type: "chip", slot: input.slot, value };
      }
      case "edit": {
        if (!isSlotKey(input.slot) || input.slot === "photo" || typeof input.text !== "string") return null;
        const text = oneLine(input.text);
        // 금지 표현이 든 문장은 칸에 넣지 않는다. 다 지워지면 거부한다.
        const kept = oneLine(cleanText(text, EDIT_MAX));
        return text === "" || charCount(text) > EDIT_MAX * 2 || kept === ""
          ? null
          : { type: "edit", slot: input.slot, text: kept };
      }
      case "skip":
        return isSlotKey(input.slot) && input.slot !== "photo" ? { type: "skip", slot: input.slot } : null;
      case "link_check": {
        const url = typeof input.url === "string" ? input.url.trim() : "";
        return url !== "" && url.length <= URL_MAX && isHttps(url) ? { type: "link_check", url } : null;
      }
      default:
        return null;
    }
  })();
  if (!parsed) return bad;
  return { ok: true, body: { clientTurnId, sessionId: sessionId.toLowerCase(), baseVersion, input: parsed } };
}

// ---- 글 검사 도우미 -------------------------------------------------------------------

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
const compactText = (value: string) => normalize(value).replace(/[\s\p{P}\p{S}]/gu, "");
const TRAILING_PARTICLE = /(?:이랑|랑|이|가|은|는|을|를|도|요)$/;

/**
 * evidence (b)안(design.md 4.3): 정규화(NFKC·소문자·공백·문장부호 제거)한 뒤 봉사자 말의 부분 문자열이면 통과.
 * 아니면 끝 조사(이/가/은/는/을/를/도/랑/이랑/요)를 뗀 낱말의 80% 이상이 말 안에 있으면 통과.
 */
export function evidenceMatches(evidence: string, text: string): boolean {
  const body = compactText(text);
  const whole = compactText(evidence);
  if ([...whole].length < 2) return false;
  if (body.includes(whole)) return true;
  const words = normalize(evidence)
    .split(/[\s\p{P}\p{S}]+/u)
    .map((word) => word.replace(TRAILING_PARTICLE, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) return false;
  const found = words.filter((word) => body.includes(word)).length;
  return found / words.length >= 0.8;
}

// 부탁형·묻는 말투: AI가 읽은 결과가 있어도 정규식으로 본다.
const REQUEST_END =
  /(?:알려\s?줘요?|알려\s?주세요|찾아\s?줘요?|찾아\s?주세요|추천해\s?줘요?|추천해\s?주세요|가르쳐\s?줘요?)[\s.!]*$/;
// 의문 어미: AI가 없을 때(대체 동작·상한)만 본다. 맨 `나요`·`가요`는 '소리가 잘 나요', '오래가요' 같은 평서문이라 넣지 않는다.
const QUESTION_END =
  /(?:(?:있|없|되|안\s?되|하|맞|같|보이|들리|나오|가능한|어떤|다른|좋은|큰|작은)[나가]요|인가요|까요|는지|을지|ㄹ지|어때요?|뭐예요|뭐야|뭔가요)[\s.!]*$/;
// 물음표 없는 가격·재고·판매처 질문(대체 동작에서도 찾는 방법 카드를 주려고).
const PRICE_STOCK_ASK =
  /(?:얼마(?:야|예요|에요|죠|지)?[\s.!]*$|어디(?:서|에서)\s?(?:사|구매|팔|파)|재고\s?(?:있|없|남)|가격\s?(?:알려|좀|뭐|얼마))/;

/**
 * 봉사자가 AI에게 묻는 말인가(칸에 넣지 않는다). aiRead가 true면 AI가 intent를 읽은 뒤이므로
 * 물음표와 부탁형만 정규식으로 보고 나머지는 AI의 ask_back을 따른다. false면(AI 없음) 의문 어미와 가격·재고 말도 본다.
 */
export function isQuestionLike(text: string, aiRead = false): boolean {
  const trimmed = text.trim();
  if (/[?？]/.test(trimmed) || REQUEST_END.test(trimmed)) return true;
  if (aiRead) return false;
  return QUESTION_END.test(trimmed) || PRICE_STOCK_ASK.test(trimmed) || hasQuestionKa(trimmed);
}

/** 'ㄴ가요'(좋은가요·뭔가요·큰가요): 앞 글자의 받침이 ㄴ일 때만 의문형이다. '오래가요' '들어가요'는 평서문이다. */
function hasQuestionKa(text: string): boolean {
  const match = /([가-힣])가요[\s.!]*$/.exec(text);
  if (!match) return false;
  const code = (match[1] as string).charCodeAt(0) - 0xac00;
  return code >= 0 && code % 28 === 4;
}

/** 재질문 뒤의 짧은 답을 그대로 값으로 넣어도 되는 말인가(design.md 4.5). */
export function isShortAnswer(text: string, slot: SlotKey): boolean {
  // 사진 칸은 사진 올리기로만 채운다(저장소가 patch를 거부한다).
  if (slot === "model" || slot === "alts" || slot === "photo") return false;
  const trimmed = text.trim();
  return charCount(trimmed) >= 2 && !isQuestionLike(trimmed) && !trimmed.includes("건너");
}

/** 주소나 도메인 모양(링크는 참고 글 링크 카드로만 받는다). AI가 만든 글과 칸 값에서 걸러낸다(design.md 9절). */
const LINK_LIKE = /https?:\/\/|www\.|(?<![A-Za-z0-9-])[a-z0-9-]{2,}\.[a-z]{2,24}(?![a-z0-9-])/i;
export const hasLinkLike = (value: string): boolean => LINK_LIKE.test(value.normalize("NFKC"));

/** 봉사자가 이번 말에서 그 칸의 주제를 꺼냈는가(design.md 4.2: 봉사자가 먼저 꺼낸 주제만 순서를 앞지른다). */
const TOPIC_WORDS: Partial<Record<SlotKey, RegExp>> = {
  pros: /장점|좋았|좋아요|좋은|가볍|가벼|편하|편해|착용감|음질|소리|배터리|노이즈|디자인/,
  alts: /비교|고민|다른\s?(?:제품|모델|기종)|대신|말고|보다/,
  altReason: /이유|때문|골랐|고른|선택|그래서/,
  benefits: /할인|혜택|쿠폰|포인트|적립|사은품|카드|프로모션|이벤트/,
  refs: /블로그|후기|리뷰|영상|유튜브|링크|커뮤니티|카페|참고|검색|글/,
};
export const topicRaised = (slot: SlotKey, text: string): boolean => TOPIC_WORDS[slot]?.test(text) ?? false;

const SKIP_WORD = /건너\s?뛰|패스|스킵/;

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// ---- AI 출력 검사 ---------------------------------------------------------------------

export type Intent = "reply" | "ask_back" | "show_review" | "skip" | "other";
const INTENTS: readonly Intent[] = ["reply", "ask_back", "show_review", "skip", "other"];
const FILL_SLOTS: readonly SlotKey[] = SLOT_KEYS.filter((key) => key !== "photo");
const MAX_FILLS = 4;

export interface Guide {
  queries: string[];
  checks: string[];
  steps: string[];
}

export interface AiTurn {
  intent: Intent;
  fills: { slot: SlotKey; value: string }[];
  purchase: "bought" | "research" | null;
  guide: Guide | null;
  next: { action: "ask_slot" | "reask" | "propose_review"; slot: SlotKey | null; text: string | null } | null;
  /** 값·evidence·길이 검사에서 하나라도 버려졌다. 그러면 AI의 next와 text는 쓰지 않는다. */
  dropped: boolean;
}

const GUIDE_LIMITS = { queries: 40, checks: 60, steps: 60 } as const;

function cleanGuideLines(raw: unknown, max: number, material: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const lines: string[] = [];
  for (const entry of raw) {
    if (lines.length >= 3) break;
    const text = typeof entry === "string" ? oneLine(entry) : "";
    if (
      text === "" ||
      charCount(text) > max ||
      hasForbidden(text) ||
      hasLinkLike(text) ||
      unknownModelTokens(text, material).length > 0
    ) {
      continue;
    }
    if (!lines.includes(text)) lines.push(text);
  }
  return lines;
}

/** 요청에서 만든 기본 찾는 방법(design.md 4.4). 가격·재고 문구는 넣지 않는다. */
export function defaultGuide(context: ResearchContext): Guide {
  const subject = searchQueryOf(context);
  const material = [context.product, context.brand ?? "", context.item ?? ""];
  const queries = [subject, `${subject} 후기`].filter(
    (line) => line.trim() !== "" && charCount(line) <= GUIDE_LIMITS.queries && !hasForbidden(line),
  );
  return {
    queries: queries.length > 0 ? queries : [`${context.item?.trim() || "제품"} 후기`],
    checks: ["기종 이름이 같은지", "구성품과 사용 방법", "후기의 장단점"],
    steps: ["공식 페이지를 연다", "상세 페이지를 읽는다", "후기를 2~3개 비교한다"].filter(
      (line) => unknownModelTokens(line, material).length === 0,
    ),
  };
}

/** AI가 준 guide의 빈 부분을 기본 찾는 방법으로 채운다. 줄마다 금지 표현·없는 기종을 거른다. */
export function mergeGuide(raw: unknown, context: ResearchContext, material: readonly string[]): Guide {
  const base = defaultGuide(context);
  const json = isRecord(raw) ? raw : {};
  const pick = (key: keyof Guide) => {
    const lines = cleanGuideLines(json[key], GUIDE_LIMITS[key], material);
    return lines.length > 0 ? lines : base[key];
  };
  return { queries: pick("queries"), checks: pick("checks"), steps: pick("steps") };
}

export interface ValidateInput {
  /** 봉사자가 쓴 말. */
  text: string;
  /** 이 안에 있는 기종 모양 토큰만 AI 글에 나올 수 있다(요청, 보인 후보, 채운 칸, 봉사자 말). */
  material: readonly string[];
  purchase: ResearchView["purchase"];
}

/** design.md 4.3 검사 2~4: 모양·값·길이·evidence. 하나라도 버려지면 dropped. */
export function validateAiTurn(raw: Record<string, unknown> | null, input: ValidateInput, context: ResearchContext): AiTurn | null {
  if (!raw) return null;
  let dropped = false;
  const intent: Intent =
    typeof raw.intent === "string" && (INTENTS as readonly string[]).includes(raw.intent) ? (raw.intent as Intent) : "other";
  const intentInvalid = intent === "other" && raw.intent !== "other";
  if (intentInvalid) dropped = true;

  const fills: AiTurn["fills"] = [];
  const rawFills = Array.isArray(raw.fills) ? raw.fills : null;
  if (rawFills === null && raw.fills !== undefined) dropped = true;
  if ((rawFills?.length ?? 0) > MAX_FILLS) dropped = true;
  const altsSeen: string[] = [];
  for (const entry of (rawFills ?? []).slice(0, MAX_FILLS)) {
    const item = isRecord(entry) ? entry : null;
    const slot = item && typeof item.slot === "string" ? item.slot : "";
    const evidence = item && typeof item.evidence === "string" ? item.evidence : "";
    const rawValue = item && typeof item.value === "string" ? oneLine(item.value) : "";
    const value = oneLine(cleanText(rawValue, SLOT_VALUE_LIMIT));
    // 값 일부가 금지 표현·없는 기종 때문에 지워졌거나 길이로 잘렸으면 버려진 것으로 센다(design.md 4.3-4).
    if (value !== "" && value !== rawValue) dropped = true;
    if (
      !(FILL_SLOTS as readonly string[]).includes(slot) ||
      value === "" ||
      // 링크는 참고 글(refs) 링크 카드로만 받는다. 다른 칸 값의 주소는 버린다.
      (slot !== "refs" && hasLinkLike(value)) ||
      charCount(evidence) > 80 ||
      !evidenceMatches(evidence, input.text) ||
      // 값도 봉사자 말이나 evidence에 근거해야 한다: 핵심 낱말의 절반 이상이 거기 있어야 하고, 아니면 그 fill만 버린다.
      !tokensCovered(value, [input.text, evidence]) ||
      unknownModelTokens(value, input.material).length > 0
    ) {
      dropped = true;
      continue;
    }
    if (slot === "alts") {
      // 쉼표로 이은 값 하나도 이름 여러 개다. 이름 수로 상한 2를 센다.
      altsSeen.push(...value.split(/[,，]/).map((name) => name.trim()).filter(Boolean));
      if (altsSeen.length > 2) {
        dropped = true;
        continue;
      }
    } else if (fills.some((fill) => fill.slot === slot)) {
      dropped = true;
      continue;
    }
    fills.push({ slot: slot as SlotKey, value });
  }

  let purchase: AiTurn["purchase"] = null;
  if (raw.purchase !== undefined && raw.purchase !== null) {
    const item = isRecord(raw.purchase) ? raw.purchase : null;
    const value = item?.value;
    const evidence = item && typeof item.evidence === "string" ? item.evidence : "";
    if ((value === "bought" || value === "research") && charCount(evidence) <= 80 && evidenceMatches(evidence, input.text)) {
      purchase = value;
    } else {
      dropped = true;
    }
  }

  const guide = intent === "ask_back" ? mergeGuide(raw.guide, context, input.material) : null;

  let next: AiTurn["next"] = null;
  if (isRecord(raw.next)) {
    const action = raw.next.action;
    if (action === "ask_slot" || action === "reask" || action === "propose_review") {
      const slotRaw = raw.next.slot;
      const slot = typeof slotRaw === "string" && isSlotKey(slotRaw) ? slotRaw : null;
      let text: string | null = null;
      if (typeof raw.next.text === "string" && raw.next.text.trim() !== "") {
        const line = oneLine(raw.next.text);
        if (charCount(line) <= 120 && !hasForbidden(line) && !hasLinkLike(line) && unknownModelTokens(line, input.material).length === 0) {
          text = line;
        } else {
          dropped = true;
        }
      }
      next = { action, slot, text };
    }
    // ask_extra는 11/18 핵심에서 끈다(P3). 받아도 버린다.
  }
  // 알아볼 수 있는 필드가 하나도 없는 JSON(예: {"answer":"sorry"})은 AI 실패로 본다(대체 동작).
  if (intentInvalid && fills.length === 0 && !purchase && !next) return null;
  return { intent, fills, purchase, guide, next, dropped };
}

// ---- 메시지 만들기 ---------------------------------------------------------------------

type MessageAi = NonNullable<NextMessage["ai"]>;

const textBody = (text: string, extra: Record<string, unknown> = {}) => ({ kind: "text", text, ...extra });

const volunteerMessage = (text: string): NextMessage => ({
  role: "volunteer",
  tag: null,
  slot: null,
  body: textBody(text),
  ai: null,
});

const aiNotice = (text: string, extra: Record<string, unknown> = {}, ai: MessageAi = "none"): NextMessage => ({
  role: "ai",
  tag: "notice",
  slot: null,
  body: textBody(text, extra),
  ai,
});

function questionMessage(slot: SlotKey, context: QuestionContext, text?: string, ai: MessageAi = "none"): NextMessage {
  const quick = questionQuick(slot);
  return {
    role: "ai",
    tag: "question",
    slot,
    body: textBody(text ?? turnQuestion(slot, context), quick ? { quick } : {}),
    ai,
  };
}

const guideMessage = (slot: string | null, guide: Guide, ai: MessageAi): NextMessage => ({
  role: "ai",
  tag: "search",
  slot,
  body: { kind: "guide", queries: guide.queries, checks: guide.checks, steps: guide.steps },
  ai,
});

function fillMessage(slot: SlotKey, value: string, ai: MessageAi): NextMessage {
  return {
    role: "ai",
    tag: "fill",
    slot,
    body: textBody(`${SLOT_NAME[slot]} 칸에 “${value}”라고 적었어요.`),
    ai,
  };
}

const purchaseFillMessage = (purchase: "bought" | "research", ai: MessageAi): NextMessage => ({
  role: "ai",
  tag: "fill",
  slot: "purchase",
  body: textBody(`구매 여부는 “${purchase === "bought" ? "구매했어요" : "리서치만"}”로 적었어요.`),
  ai,
});

/** 한 메시지의 본문이 8KB(DB 한도 8,192바이트)를 넘지 않게 한다. 넘으면 글을 줄이고 목록을 뺀다. */
export function fitMessage(message: NextMessage): NextMessage {
  if (bytesOf(message.body) <= BODY_BYTES_MAX) return message;
  const text = typeof message.body.text === "string" ? [...message.body.text].slice(0, 400).join("") : "";
  return { ...message, body: { kind: "text", text } };
}

// ---- 후보 목록 -------------------------------------------------------------------------

type Post = {
  purchase: ResearchView["purchase"];
  slots: ResearchView["slots"];
  extras: string[];
  counters: ResearchView["counters"];
  pending: ResearchView["pending"];
};

function altNames(slots: ResearchView["slots"]): string[] {
  const value = slots.alts?.status === "skipped" ? "" : (slots.alts?.value ?? "");
  return value
    .split(/[,，]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function questionContext(post: Pick<Post, "purchase" | "slots">, subject: string): QuestionContext {
  return {
    purchase: post.purchase,
    subject,
    model: post.slots.model?.status === "skipped" ? "" : (post.slots.model?.value ?? ""),
    alts: altNames(post.slots),
  };
}

interface NextOptions {
  /** 다음 질문을 붙이지 않는다(확인·링크 확인을 기다림). */
  hold: boolean;
  /** AI가 고른 다음 칸. 검사를 통과한 것만 넣는다. */
  aiNext: { slot: SlotKey; text: string | null; /** 봉사자가 이번 말에서 그 칸의 주제를 꺼냈다. */ topical?: boolean } | null;
  /** 직전 칸을 한 번 더 묻는다. */
  reask: { slot: SlotKey; text: string | null } | null;
}

/**
 * 순서대로 늘어놓은 다음 질문 후보(design.md 4.5). 저장소가 잠근 상태에서 첫 유효 후보를 고른다.
 * 후보 순서: 확인 재촉(다음이 리뷰 제안일 때) → reask → 구매 질문 → AI가 고른 첫 회차 칸 → 서버 순서 → 리뷰 제안.
 */
export function buildCandidates(post: Post, subject: string, options: NextOptions): NextCandidate[] {
  if (options.hold) return [];
  const qctx = questionContext(post, subject);
  const slotCandidate = (slot: SlotKey, text?: string | null, ai: MessageAi = "none"): NextCandidate => ({
    action: "ask_slot",
    slot,
    message: questionMessage(slot, qctx, text ?? undefined, ai),
  });
  const purchaseCandidate: NextCandidate = {
    action: "ask_purchase",
    message: {
      role: "ai",
      tag: "question",
      slot: "purchase",
      body: textBody(PURCHASE_QUESTION, { quick: PURCHASE_QUICK }),
      ai: "none",
    },
  };
  const reaskCandidate: NextCandidate | null = options.reask
    ? {
        action: "reask",
        slot: options.reask.slot,
        message: questionMessage(
          options.reask.slot,
          qctx,
          options.reask.text ?? reaskText(options.reask.slot, qctx),
          options.reask.text ? "ok" : "none",
        ),
      }
    : null;
  // 첫 회차(아직 묻지 않은 칸)를 순서대로, 그다음 둘째 회차(비어 있는 필수 칸)를 순서대로 늘어놓는다.
  // 저장소는 필수 칸이면 이미 물은 칸도 유효로 보므로, 회차를 여기서 나눠 두어야 사진 같은 필수 칸이 뒤 질문을 막지 않는다.
  const order = questionOrder(post.purchase);
  const firstRound = order.filter((slot) => isAskable(post, slot) && !post.counters.asked[slot]);
  const secondRound = order.filter(
    (slot) => requiredSlots(post.purchase).includes(slot) && !isFilled(post.slots, slot) && isAskable(post, slot) && post.counters.asked[slot],
  );
  const ordered = [...firstRound, ...secondRound].map((slot) => slotCandidate(slot));
  const serverList = [...(reaskCandidate ? [reaskCandidate] : []), purchaseCandidate, ...ordered];

  // 다음이 리뷰 제안인데 확인할 것이 남았으면 리뷰 제안 대신 확인을 재촉한다.
  if (post.purchase !== "unset" && hasUnresolvedCheck(post.pending) && !firstValidNext(post, serverList)) {
    // 넣을 칸과 값을 함께 보여 준다(값을 모르고 [넣기]를 누르지 않게).
    const waiting = post.pending.confirmFill;
    const slot = isRecord(waiting) && typeof waiting.slot === "string" && isSlotKey(waiting.slot) ? waiting.slot : null;
    const value = isRecord(waiting) && typeof waiting.value === "string" ? waiting.value : "";
    const notice = slot && value !== "" ? `${PENDING_NOTICE} ${SLOT_NAME[slot]} 칸에 “${value}”라고 적어도 될까요?` : PENDING_NOTICE;
    return [
      {
        action: "pending_notice",
        message: aiNotice(notice, post.pending.confirmFill ? { quick: CONFIRM_QUICK } : {}),
      },
    ];
  }

  const list: NextCandidate[] = [];
  if (reaskCandidate) list.push(reaskCandidate);
  list.push(purchaseCandidate);
  // AI가 고른 칸(봉사자가 이번 말에서 꺼낸 주제)은 순서상 앞선 필수 칸(특히 구매함의 사진)이 아직 안 물렸으면 그 뒤에 둔다.
  // 질문 번호 순서가 기본이다(design.md 4.2). 앞선 필수 칸이 없으면 AI 칸이 먼저다.
  // 순서상 다음 칸이면 AI의 질문 글을 쓰고, 그보다 뒤 칸이면 봉사자가 그 주제를 꺼냈을 때만 앞지른다.
  const aiSlot = options.aiNext?.slot ?? null;
  if (aiSlot && isAskable(post, aiSlot) && !post.counters.asked[aiSlot] && (firstRound[0] === aiSlot || options.aiNext?.topical)) {
    const required = requiredSlots(post.purchase);
    const aiIndex = order.indexOf(aiSlot);
    const blockers = firstRound.filter((slot) => order.indexOf(slot) < aiIndex && required.includes(slot));
    list.push(...blockers.map((slot) => slotCandidate(slot)));
    list.push(slotCandidate(aiSlot, options.aiNext?.text, options.aiNext?.text ? "ok" : "none"));
  }
  list.push(...ordered);
  list.push({
    action: "propose_review",
    message: {
      role: "ai",
      tag: "review",
      slot: null,
      body: textBody(REVIEW_PROPOSAL, { quick: REVIEW_QUICK }),
      ai: "none",
    },
  });
  return list;
}

function reaskText(slot: SlotKey, qctx: QuestionContext): string {
  const question = turnQuestion(slot, qctx);
  const text = `${REASK_PREFIX}${question}`;
  return charCount(text) <= 120 ? text : question;
}

// ---- 한 턴 계획 ------------------------------------------------------------------------

export type AiMode =
  | { state: "none" }
  | { state: "ok"; turn: AiTurn }
  | { state: "fallback" }
  | { state: "capped"; cap: "request" | "daily" };

export interface PlanArgs {
  session: Pick<ResearchView, "purchase" | "slots" | "extras" | "counters" | "pending">;
  input: TurnInput;
  context: ResearchContext;
  ai: AiMode;
}

export interface TurnPlan {
  patch: ResearchPatch;
  messages: NextMessage[];
  next: NextCandidate[];
  /** 이 턴의 ai 표시(로그와 응답). */
  label: "ok" | "fallback" | "capped" | "none";
}

const filledSlot = (value: string, by: SlotState["by"], status: SlotState["status"], short?: boolean): SlotState => ({
  value,
  status,
  by,
  ...(short ? { short: true } : {}),
});

/**
 * 대안 이름을 이어 붙인다(최대 2개). 칸 값은 200자 이하라서 이어 붙인 글이 넘으면 새 이름을 넣지 않는다.
 * 봉사자가 칩으로 직접 고른 이름(preferIncoming)은 넘칠 때 그 이름만 남긴다.
 */
function mergeAlts(slots: ResearchView["slots"], incoming: string[], preferIncoming = false): string[] {
  const names = altNames(slots);
  for (const name of incoming) {
    if (names.length >= 2) break;
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) continue;
    if ([...names, name].join(", ").length > SLOT_VALUE_MAX) {
      if (preferIncoming) return [name];
      continue;
    }
    names.push(name);
  }
  return names;
}

function lastQuestionSlot(pending: ResearchView["pending"]): string | null {
  const slot = pending.lastQuestion?.slot;
  return typeof slot === "string" ? slot : null;
}

function shownLinks(pending: ResearchView["pending"]): { url: string; slot: SlotKey }[] {
  const raw = pending.shownLinks;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.url !== "string" || typeof entry.slot !== "string") return [];
    return isSlotKey(entry.slot) ? [{ url: entry.url, slot: entry.slot }] : [];
  });
}

/** 참고 글 칸에 적는 짧은 표시(호스트와 경로, 200자 이하). */
function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const label = `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    return [...label].slice(0, 120).join("") || "링크 확인함";
  } catch {
    return "링크 확인함";
  }
}

const URL_IN_TEXT = /https:\/\/[^\s<>"'，。]+/i;
/** 문장 끝에 붙은 구두점·닫는 괄호·따옴표는 주소가 아니다(짝이 맞는 괄호 ')'는 주소의 일부로 둔다). */
const URL_TRAILING = /[.,;:!?'"’”」』。，、！？\]}>]$/u;
export function urlInText(text: string): string | null {
  let url = URL_IN_TEXT.exec(text)?.[0] ?? "";
  for (;;) {
    if (URL_TRAILING.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(")") && url.split(")").length > url.split("(").length) url = url.slice(0, -1);
    else break;
  }
  return url === "" || url === "https://" ? null : url;
}

/** 한 턴을 계획한다. 저장소에 넘길 patch·messages·후보 목록을 만든다. 상태를 바꾸지 않는다. */
export function planTurn(args: PlanArgs): TurnPlan {
  const { input, context, ai } = args;
  // 확인(confirmFill)을 기다리는 중에 글이 오면 그 확인은 닫고 새 말로 처리한다. 오래된 값이 남아 새 값을 덮거나,
  // 막힌 칸 때문에 다음 답이 버려지는 일을 막는다.
  const closeConfirm = input.type === "text" && Boolean(args.session.pending.confirmFill);
  const session = closeConfirm
    ? { ...args.session, pending: mergePending(args.session.pending, { confirmFill: null }) }
    : args.session;
  const subject = searchQueryOf(context);
  const messages: NextMessage[] = [];
  const slotsPatch: Partial<Record<SlotKey, SlotState | null>> = {};
  const patch: ResearchPatch = {};
  const pendingPatch: Record<string, unknown> = closeConfirm ? { confirmFill: null } : {};
  const last = lastQuestionSlot(session.pending);
  const lastSlot: SlotKey | null = last && isSlotKey(last) ? last : null;
  let hold = false;
  let reask: NextOptions["reask"] = null;
  let aiNext: NextOptions["aiNext"] = null;
  let purchase = session.purchase;
  /** 이 턴의 칸 변경을 반영한 지금 칸(값이 null인 칸은 지운다). */
  const currentSlots = () => {
    const merged: ResearchView["slots"] = { ...session.slots };
    for (const [key, value] of Object.entries(slotsPatch)) {
      if (value === null) delete merged[key as SlotKey];
      else merged[key as SlotKey] = value;
    }
    return merged;
  };
  const nowPost = (): Post => ({
    purchase,
    slots: currentSlots(),
    extras: session.extras,
    counters: session.counters,
    pending: session.pending,
  });
  const clearConfirm = () => {
    if (session.pending.confirmFill) pendingPatch.confirmFill = null;
  };

  const confirmed = (slot: SlotKey, value: string) => {
    slotsPatch[slot] = filledSlot(value, "volunteer", "confirmed");
    if (isRecord(session.pending.confirmFill) && session.pending.confirmFill.slot === slot) clearConfirm();
  };

  let label: TurnPlan["label"] = "none";

  switch (input.type) {
    case "text": {
      messages.push(volunteerMessage(input.text));
      let turn: AiTurn | null = null;
      if (ai.state === "capped") {
        label = "capped";
        if (!session.pending.capNotice) {
          messages.push(aiNotice(ai.cap === "daily" ? CAP_DAILY : CAP_REQUEST, {}, "capped"));
          pendingPatch.capNotice = true;
        }
      } else if (ai.state === "fallback") {
        label = "fallback";
        if (!session.pending.fallbackNotice) {
          messages.push(aiNotice(FALLBACK_NOTICE, {}, "fallback"));
          pendingPatch.fallbackNotice = true;
        }
      } else if (ai.state === "ok") {
        label = "ok";
        turn = ai.turn;
      }

      // AI에게 묻는 말(AI가 ask_back으로 읽었거나 의문형·부탁형)은 칸을 채우지 않는다. 구매 여부도 읽지 않는다.
      // 아래 4)에서 찾는 방법 카드와 같은 질문을 보인다. 섞인 답은 봉사자가 질문에 다시 답하면 된다.
      const asking = turn?.intent === "ask_back" || isQuestionLike(input.text, turn !== null);

      // 주소가 든 말: 참고 글(refs)에 해당하면 AI가 칸을 채우지 못하게 하고, 아래 3)에서 "직접 확인 필요" 링크 카드로 받는다.
      // (서버는 외부 주소를 열지 않으므로 봉사자가 확인하기 전에는 값으로 넣지 않는다. design.md 4.6, 4.10)
      const url = urlInText(input.text);
      const linkCard =
        url !== null &&
        isHttps(url) &&
        url.length <= URL_MAX &&
        isAskable({ ...nowPost(), slots: session.slots }, "refs") &&
        (lastSlot === "refs" || (turn?.fills.some((fill) => fill.slot === "refs") ?? false));

      // 1) 구매 여부와 칸 채우기(AI가 읽은 것만, evidence 검사를 통과한 것만)
      let filledCount = 0;
      if (turn && !asking) {
        if (session.purchase === "unset" && turn.purchase) {
          purchase = turn.purchase;
          patch.purchase = turn.purchase;
          messages.push(purchaseFillMessage(turn.purchase, "ok"));
          filledCount += 1;
        }
        const altIncoming: string[] = [];
        for (const fill of turn.fills) {
          // 참고 글의 주소는 링크 카드로만 받는다. 카드를 못 만드는 경우(이미 찼음·http 등)에는 주소가 든 값을 넣지 않는다.
          if (fill.slot === "refs" && (linkCard || hasLinkLike(fill.value))) continue;
          if (fill.slot === "alts") {
            altIncoming.push(fill.value);
            continue;
          }
          slotsPatch[fill.slot] = filledSlot(fill.value, "ai", "filled");
          messages.push(fillMessage(fill.slot, fill.value, "ok"));
          filledCount += 1;
        }
        if (altIncoming.length > 0) {
          const names = mergeAlts(session.slots, altIncoming);
          const value = names.join(", ");
          slotsPatch.alts = filledSlot(value, "ai", "filled");
          messages.push(fillMessage("alts", value, "ok"));
          filledCount += 1;
        }
        if (!turn.dropped && turn.next) {
          if (turn.next.action === "ask_slot" && turn.next.slot && turn.next.slot !== "photo") {
            aiNext = { slot: turn.next.slot, text: turn.next.text, topical: topicRaised(turn.next.slot, input.text) };
          }
        }
      }
      // 2) 건너뛰자는 말
      const wantsSkip = turn ? turn.intent === "skip" : SKIP_WORD.test(input.text);
      if (filledCount === 0 && wantsSkip && lastSlot) {
        if (SKIPPABLE.includes(lastSlot)) {
          slotsPatch[lastSlot] = filledSlot("", "volunteer", "skipped");
        } else {
          messages.push(aiNotice(REQUIRED_SKIP));
          messages.push(questionMessage(lastSlot, questionContext(nowPost(), subject)));
          hold = true;
        }
        break;
      }

      // 3) 참고 글에 링크를 붙여 넣음: AI 검색 없이 "직접 확인 필요" 링크 카드
      if (linkCard && url && slotsPatch.refs === undefined) {
        // 화면에 남은 카드는 모두 확인할 수 있어야 하므로, 보인 링크 목록이 차면 새 카드를 만들지 않는다(앞 카드를 조용히 빼지 않는다).
        const known = shownLinks(session.pending).filter((entry) => entry.url !== url);
        if (known.length >= SHOWN_LINKS_MAX) {
          messages.push(aiNotice(LINK_FULL));
        } else {
          messages.push({
            role: "ai",
            tag: "search",
            slot: "refs",
            body: { kind: "link", url, note: LINK_NOTE },
            ai: "none",
          });
          pendingPatch.shownLinks = [...known, { url, slot: "refs" }];
        }
        hold = true;
        break;
      }

      // 4) 묻는 말: 찾는 방법 카드(검색어·확인 조건·찾는 순서, chatbot-quality 합격 기준 2)를 주고 같은 질문을 다시 보인다.
      // 가격·재고에는 답하지 않는다.
      if (asking) {
        const material = [input.text, context.product, context.brand ?? "", context.item ?? "", ...shownNames(session.pending)];
        const guide = turn?.guide ?? mergeGuide(null, context, material);
        messages.push(guideMessage(lastSlot, guide, turn?.guide ? "ok" : "none"));
        if (lastSlot && session.purchase !== "unset") {
          messages.push(questionMessage(lastSlot, questionContext(nowPost(), subject)));
          hold = true;
        }
        break;
      }

      // 5) 직전 질문에 답이 없다: 재질문 한 번, 그다음 짧은 답, AI가 없으면 넣을지 확인
      if (filledCount === 0 && lastSlot && session.purchase !== "unset" && isAskable(nowPost(), lastSlot)) {
        const reasked = (session.counters.reasked[lastSlot] ?? 0) >= 1;
        const cleaned = oneLine(cleanText(input.text, SLOT_VALUE_LIMIT));
        if (reasked && cleaned !== "" && isShortAnswer(input.text, lastSlot)) {
          slotsPatch[lastSlot] = filledSlot(cleaned, "volunteer", "filled", true);
          messages.push(fillMessage(lastSlot, cleaned, "none"));
        } else if (ai.state === "ok" && !reasked) {
          reask = {
            slot: lastSlot,
            text:
              turn && !turn.dropped && turn.next?.action === "reask" && turn.next.slot === lastSlot ? turn.next.text : null,
          };
        } else if (ai.state !== "ok" && cleaned !== "" && lastSlot !== "photo") {
          // AI가 없으면 칸에 바로 넣지 않고 넣을지 먼저 묻는다.
          pendingPatch.confirmFill = { slot: lastSlot, value: cleaned };
          patch.reasked = [lastSlot];
          messages.push({
            role: "ai",
            tag: "question",
            slot: lastSlot,
            body: textBody(`${SLOT_NAME[lastSlot]} 칸에 “${cleaned}”라고 적을게요. ${CONFIRM_FILL}`, { quick: CONFIRM_QUICK }),
            ai: "none",
          });
          hold = true;
        }
      }
      break;
    }

    case "quick": {
      const label0 = ((): string => {
        switch (input.replyId) {
          case "purchase.bought":
            return "구매했어요";
          case "purchase.research":
            return "구매하지 않았어요 · 리서치만";
          case "confirm.yes":
            return "넣기";
          case "confirm.no":
            return "아니요";
          case "review.more":
            return "더 답할게요";
        }
      })();
      messages.push(volunteerMessage(label0));
      if (input.replyId === "purchase.bought" || input.replyId === "purchase.research") {
        if (session.purchase === "unset") {
          purchase = input.replyId === "purchase.bought" ? "bought" : "research";
          patch.purchase = purchase;
        } else {
          messages.push(aiNotice(PURCHASE_FIXED));
          hold = true;
        }
      } else if (input.replyId === "confirm.yes" || input.replyId === "confirm.no") {
        const pending = isRecord(session.pending.confirmFill) ? session.pending.confirmFill : null;
        const slot = pending && typeof pending.slot === "string" && isSlotKey(pending.slot) ? pending.slot : null;
        const value = pending && typeof pending.value === "string" ? pending.value : "";
        if (!slot || value === "") {
          messages.push(aiNotice(NO_CONFIRM));
        } else if (input.replyId === "confirm.yes") {
          slotsPatch[slot] = filledSlot(value, "volunteer", "filled", true);
          pendingPatch.confirmFill = null;
          messages.push(fillMessage(slot, value, "none"));
        } else {
          pendingPatch.confirmFill = null;
          patch.asked = [slot];
        }
      } else {
        // review.more
        messages.push(aiNotice(REVIEW_MORE));
        hold = true;
      }
      break;
    }

    case "chip": {
      messages.push(volunteerMessage(input.value));
      const shown = shownNames(session.pending).map((name) => name.toLowerCase());
      if (!shown.includes(input.value.toLowerCase())) {
        messages.push(aiNotice("목록에 없는 후보예요. 후보를 다시 골라 주세요."));
        hold = true;
      } else if (input.slot === "model") {
        confirmed("model", input.value);
        messages.push(fillMessage("model", input.value, "none"));
      } else {
        const value = mergeAlts(session.slots, [input.value], true).join(", ");
        slotsPatch.alts = filledSlot(value, "volunteer", "confirmed");
        messages.push(fillMessage("alts", value, "none"));
      }
      break;
    }

    case "edit": {
      confirmed(input.slot, input.text);
      // 패널에서 고친 칸이 지금 묻는 칸일 때만 다음 질문으로 이어 간다. 아니면 새 질문을 겹쳐 붙이지 않는다.
      if (lastSlot !== input.slot) hold = true;
      break;
    }

    case "skip": {
      messages.push(volunteerMessage(SKIP_LABEL[input.slot] ?? "건너뛰기"));
      if (!SKIPPABLE.includes(input.slot)) {
        // 필수 칸은 앱에서 거부한다(design.md 4.5). 상태는 바뀌지 않고 같은 질문을 다시 보인다.
        messages.push(aiNotice(REQUIRED_SKIP));
        messages.push(
          questionMessage(input.slot, questionContext(nowPost(), subject)),
        );
        hold = true;
      } else {
        slotsPatch[input.slot] = filledSlot("", "volunteer", "skipped");
        if (isRecord(session.pending.confirmFill) && session.pending.confirmFill.slot === input.slot) clearConfirm();
      }
      break;
    }

    case "link_check": {
      messages.push(volunteerMessage("확인했어요"));
      const entry = shownLinks(session.pending).find((link) => link.url === input.url);
      if (!entry || entry.slot !== "refs") {
        messages.push(aiNotice("확인할 링크를 찾지 못했어요."));
        hold = true;
      } else {
        // 칸 값은 200자 이하라서 200자를 넘는 주소는 줄여 적는다. 전체 주소는 links에만 둔다.
        slotsPatch.refs = { value: [...input.url].length <= SLOT_VALUE_MAX ? input.url : linkLabel(input.url), links: [input.url], status: "confirmed", by: "volunteer" };
        messages.push(aiNotice(LINK_CHECKED));
      }
      break;
    }
  }

  // 이 턴에서 같은 칸이 바뀌면(AI 채움·건너뛰기·짧은 답·칩) 오래된 확인은 닫는다.
  const waiting = session.pending.confirmFill;
  if (isRecord(waiting) && typeof waiting.slot === "string" && isSlotKey(waiting.slot)) {
    if (slotsPatch[waiting.slot] !== undefined && pendingPatch.confirmFill === undefined) pendingPatch.confirmFill = null;
  }

  if (Object.keys(slotsPatch).length > 0) patch.slots = slotsPatch;
  if (Object.keys(pendingPatch).length > 0) patch.pending = pendingPatch;

  // 글 턴의 ai 표시는 봉사자 메시지에도 남긴다: 같은 clientTurnId 재전송이 저장된 메시지에서 첫 응답과 같은 표시를 읽도록.
  // (칸 채움·재질문처럼 AI 글이 없는 턴이나 CAP·fallback 안내가 한 번만 나오는 뒤 턴에서도 표시가 사라지지 않는다.)
  const first = messages[0];
  if (input.type === "text" && label !== "none" && first?.role === "volunteer") messages[0] = { ...first, ai: label };

  const base = {
    purchase: session.purchase,
    slots: session.slots,
    extras: session.extras,
    counters: session.counters,
    pending: session.pending,
  };
  const applied = applyPatch(base, patch);
  const post: Post = applied.ok
    ? { purchase: applied.purchase, slots: applied.slots, extras: applied.extras, counters: applied.counters, pending: applied.pending }
    : base;

  const next = buildCandidates(post, subject, { hold, aiNext, reask });
  return { patch, messages: messages.map(fitMessage), next: next.map((candidate) => ({ ...candidate, message: fitMessage(candidate.message) })), label };
}

// ---- AI 호출까지 묶은 한 턴 ---------------------------------------------------------------

export interface RunTurnArgs {
  session: ResearchView;
  input: TurnInput;
  context: ResearchContext;
  /** begin이 알려 준 AI 사용 가능 여부. capped면 AI를 부르지 않는다. */
  capped: { cap: "request" | "daily" } | null;
  signal?: AbortSignal;
}

export interface TurnRun {
  plan: TurnPlan;
  upstream: Upstream | null;
  usage: { in: number; out: number };
}

/** 글 입력이면 AI를 한 번 부르고(가짜 모드·키 없음·실패는 fallback), 검사를 거쳐 계획한다. 던지지 않는다. */
export async function runTurn({ session, input, context, capped, signal }: RunTurnArgs): Promise<TurnRun> {
  const noUsage = { in: 0, out: 0 };
  if (input.type !== "text") {
    return { plan: planTurn({ session, input, context, ai: { state: "none" } }), upstream: null, usage: noUsage };
  }
  if (capped) {
    return { plan: planTurn({ session, input, context, ai: { state: "capped", cap: capped.cap } }), upstream: null, usage: noUsage };
  }
  const material = buildTurnMaterial({ session, context, text: input.text });
  const result = await answerTurn(material, signal);
  const known = [
    input.text,
    context.product,
    context.brand ?? "",
    context.item ?? "",
    ...shownNames(session.pending),
    ...SLOT_KEYS.map((key) => (isFilled(session.slots, key) ? (session.slots[key]?.value ?? "") : "")),
  ];
  const turn = validateAiTurn(result.json, { text: input.text, material: known, purchase: session.purchase }, context);
  const ai: AiMode = turn ? { state: "ok", turn } : { state: "fallback" };
  return {
    plan: planTurn({ session, input, context, ai }),
    upstream: turn ? null : (result.upstream ?? "empty"),
    usage: result.usage,
  };
}
