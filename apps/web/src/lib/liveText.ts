// /live 글 다듬기와 기록 칸: 전화번호 가림, 길이 자르기, 칸 읽기, 요약, 기록의 AI 칸. 설계서 6.4절.
// 서버(liveChat.ts)와 화면이 함께 쓰는 순수 함수다.
import type { LiveChatStatus, LiveDraft, LiveSlots } from "@/lib/liveEngine";

export const SLOT_MAX = { product: 70, info: 100, options: 70, budget: 30 } as const;  // UTF-16 길이
export const REPLY_MAX = 400;
export const SUMMARY_MAX = 300;                 // cleanRequestDetails의 요약 상한과 같다
export const EMPTY_SLOTS: LiveSlots = { product: "", info: "", options: "", budget: "" };

// 기록 칸 하나의 상한. voiceChat.ts의 MAX_HISTORY_CONTENT와 같다(그 모듈은 서버 전용이라 값을 복사한다).
const AI_TURN_MAX = 2000;

/**
 * researchCheck.ts의 PHONE과 같은 정규식이다(그 모듈은 서버 전용이라 화면이 가져올 수 없어 복사했다).
 * 단위 시험이 두 정규식의 source가 같은지 본다.
 */
export const PHONE =
  /(?<!\d)0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)|\+82[-\s.]?\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)|(?<!\d)1[5-9]\d{2}[-\s.]\d{4}(?!\d)/;
const PHONE_ALL = new RegExp(PHONE.source, "g");

/** 전화번호를 "(전화번호 가림)"으로 바꾼다. */
export function maskPhone(text: string): string {
  return text.replace(PHONE_ALL, "(전화번호 가림)");
}

/** 결과의 length(UTF-16)가 max 이하다. 넘으면 글자(코드 포인트) 단위로 줄이고 "…"을 붙인다. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 0) return "";
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return out + "…";
}

/** 문자열이 아니면 "". 제어 문자는 공백으로, trim, maskPhone, cutText. */
export function cleanSlot(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const spaced = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  return cutText(maskPhone(spaced), max);
}

/** 객체에서 네 칸을 cleanSlot으로 읽는다. 던지지 않는다. */
export function readSlots(value: unknown): LiveSlots {
  if (typeof value !== "object" || value === null) return { ...EMPTY_SLOTS };
  const o = value as Record<string, unknown>;
  return {
    product: cleanSlot(o.product, SLOT_MAX.product),
    info: cleanSlot(o.info, SLOT_MAX.info),
    options: cleanSlot(o.options, SLOT_MAX.options),
    budget: cleanSlot(o.budget, SLOT_MAX.budget),
  };
}

// ---------- 칸에서 지시문이 샌 문장 빼기 ----------
// 실호출(2026-11-24, gpt-realtime-2.1-mini)에서 모델이 이용자가 하지 않은 말(지시문의 문장과 보기, 자기가 할 질문)을 칸에 섞어 넣는 일이 있었다.
// 원칙: 이용자가 한 말일 수 있는 것은 지우지 않는다. 확인 요약을 읽어 주는 것이 안전장치이므로, 근거가 불확실한 문장은 남겨 이용자가 듣고 고치게 한다.
// 지우는 것은 "이용자 말에 근거가 없고" 동시에 "지시문 표지가 있거나 물음표로 끝나는" 문장뿐이다(Codex 2차 지적 2·3).
// 하나 더: 이용자에게 되묻는 말투의 물음("…원하세요?")은 모델이 한 말이므로, 이용자가 거의 그대로 말했을 때만 남긴다(Codex 3차 지적 3).

/** 근거로 세지 않는 흔한 낱말의 앞 두 글자(어느 요청에나 나온다). */
const GROUND_STOP = new Set(["알고", "싶어", "싶은", "궁금", "정보", "제품", "원하", "있는", "같은", "관련", "대한", "확인", "함께", "좋겠", "좋습", "가능", "여부", "조건", "옵션", "예산", "그리", "또는"]);
/** 지시문에서 온 문장에 흔한 말. */
const LEAK_MARK = /봉사자|지시문|비워|없다면|알려\s*주세요|찾아서|확인\s*가능|같은\s*정보|조건은/;

const flat = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");

/** 문장으로 나눈다. 물음표·느낌표 뒤는 붙어 있어도 나누고, 마침표는 뒤에 공백이 있을 때만 나눈다("1.5리터"를 쪼개지 않는다). */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[!?？])\s*|(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean);
}

/** 문장의 내용 낱말(앞 두 글자) 가운데 이용자 말에 있는 것이 하나라도 있는가. */
function sentenceGrounded(sentence: string, userFlat: string): boolean {
  for (const m of sentence.normalize("NFKC").toLowerCase().matchAll(/[0-9a-z가-힣]{2,}/g)) {
    const head = m[0].slice(0, 2);
    if (GROUND_STOP.has(head)) continue;
    if (userFlat.includes(head)) return true;
  }
  return false;
}

/**
 * 이용자에게 되묻는 말투의 물음: 높임 물음("…원하세요?", "…생각하시나요?"), 보낼지 묻기("등록할까요?"),
 * 더 있는지 묻기("더 필요한 조건이 있나요?"). 되묻는 말은 모델이 한 말이다.
 * 이용자가 알고 싶은 것을 적은 물음("방수가 되나요?", "얼마인가요?", "다른 색도 있나요?")은 해당하지 않는다.
 */
const ASK_USER =
  /(?:세요|시나요|신가요|실까요|시겠어요|셨나요|십니까|드릴까요|(?:등록|접수|전달)할까요)\s*[?？]$|(?:^|\s)(?:더|또|추가로|다른)\s*(?:필요한|필요하신|궁금한|궁금하신|알고\s*싶은|알고\s*싶으신|원하는|원하시는|말씀하실|바라는|바라시는)\s.*[?？]$/;
/** 되묻는 말투의 문장은 글자 쌍의 이 비율 이상이 이용자 말에 있을 때만 남긴다(이용자가 거의 그대로 말한 경우). */
export const ASK_COVER = 0.6;

/** 문장의 글자 쌍 가운데 이용자 말에 있는 비율(0~1). */
function coverage(sentence: string, userFlat: string): number {
  const s = flat(sentence);
  if (s.length < 2) return 0;
  let hit = 0;
  for (let i = 0; i < s.length - 1; i++) if (userFlat.includes(s.slice(i, i + 2))) hit++;
  return hit / (s.length - 1);
}

/**
 * 문장을 남길지 정한다.
 * - 되묻는 말투의 물음: 제품 이름처럼 낱말 하나가 겹치는 것만으로는 남기지 않는다(Codex 3차 지적 3:
 *   이용자가 "소니 헤드폰"만 말했는데 "소니 헤드폰은 어떤 색을 원하세요?"가 정보 칸에 남았다). 거의 그대로 말했을 때만 남긴다.
 * - 그 밖의 물음과 지시문 표지가 있는 문장: 이용자 말에 낱말이 하나라도 있으면 남긴다(바꿔 적은 것일 수 있다).
 * - 표지도 물음표도 없는 문장: 지우지 않는다.
 */
function keepSentence(sentence: string, userFlat: string): boolean {
  if (ASK_USER.test(sentence)) return coverage(sentence, userFlat) >= ASK_COVER;
  if (LEAK_MARK.test(sentence) || /[?？]$/.test(sentence)) return sentenceGrounded(sentence, userFlat);
  return true;
}

/** 지시문이 샌 문장과 모델이 되묻는 물음을 뺀다. 나머지는 그대로 둔다. */
function dropLeaked(text: string, userFlat: string): string {
  if (!text) return text;
  const sentences = sentencesOf(text);
  const kept = sentences.filter((s) => keepSentence(s, userFlat));
  return kept.length === sentences.length ? text : kept.join(" ");
}

/**
 * 칸에서 지시문이 샌 문장과 모델의 질문을 뺀다. userTexts는 이용자가 한 말(받아 적은 글)이다.
 * 이용자 말에 낱말이 하나라도 있는 문장, 표지도 물음표도 없는 문장은 지우지 않는다(바꿔 말한 것일 수 있다).
 * 이용자 말이 너무 짧으면(전사를 못 받은 경우) 판단할 수 없어 그대로 돌려준다. 제품 칸이 통째로 비게 되면 원래 값을 둔다.
 */
export function groundSlots(slots: LiveSlots, userTexts: string[]): LiveSlots {
  const userFlat = flat(userTexts.join(" "));
  if (userFlat.length < 4) return slots;
  return {
    product: dropLeaked(slots.product, userFlat) || slots.product,
    info: dropLeaked(slots.info, userFlat),
    options: dropLeaked(slots.options, userFlat),
    budget: dropLeaked(slots.budget, userFlat),
  };
}

const stripEnd = (s: string) => s.replace(/[.,!?]+$/, "");

/** "…을 알고 싶음", "…이 궁금합니다" 같은 끝말. 요약이 "알고 싶은 정보는 …"으로 읽히므로 뗀다. */
const INFO_TAIL = /\s*(?:(?:을|를|이|가|도)\s*)?(?:알고\s*싶(?:음|어요|습니다|다)|궁금(?:함|해요|합니다|하다)?)$/;
/** 예산만 말하는 마디(예: "예산은 10만 원 이내"). 다른 내용이 섞인 마디는 해당하지 않는다. */
const PURE_BUDGET =
  /^(?:그리고\s*)?예산(?:은|이|도|:)?\s*(?:[\d,.]+|[일이삼사오육칠팔구십백천]+)?\s*(?:만|천|백)?\s*원?\s*(?:이내|이하|미만|정도|쯤|까지|안쪽|내외)?(?:로|으로|입니다|이에요|예요)?$/;

/**
 * 읽어 주기 좋게 칸을 정리한다(실호출에서 모델이 예산을 다른 칸에 되풀이하거나 끝말을 붙이는 일이 있었다).
 * - 예산 칸이 있으면 알고 싶은 정보와 옵션에서 "예산만 말하는 마디"를 뺀다. 다른 내용이 섞인 마디는 그대로 둔다(내용을 잃지 않는다).
 * - 알고 싶은 정보의 끝말("알고 싶음", "궁금합니다")을 뗀다. 떼고 나서 비면 그대로 둔다.
 */
export function tidySlots(slots: LiveSlots): LiveSlots {
  const dropBudget = (text: string) => {
    if (!slots.budget || !text.includes("예산")) return text;
    const parts = text.split(/\s*,\s*|\.\s+|\.$/).map((part) => part.trim()).filter(Boolean);
    const kept = parts.filter((part) => !PURE_BUDGET.test(part));
    return kept.length === parts.length ? text : kept.join(", ");
  };
  let info = dropBudget(slots.info);
  // 끝말이 실제로 있을 때만 바꾼다. 없으면 문장부호까지 그대로 둔다(이용자가 물은 질문의 물음표를 지우지 않는다).
  const base = stripEnd(info);
  const cut = base.replace(INFO_TAIL, "").trim();
  if (cut && cut !== base) info = cut;
  return { product: slots.product, info, options: dropBudget(slots.options), budget: slots.budget };
}

const NUMERAL = /[\d일이삼사오육칠팔구십백천만억]/;

/**
 * 예산 칸의 글이 다른 칸 글에 그대로 들어 있는가(공백·문장부호는 무시).
 * "120만 원" 안의 "20만 원"처럼 숫자가 이어 붙은 자리는 같은 값이 아니다. 헷갈리면 거짓으로 답해 예산을 따로 읽게 한다.
 */
function saysBudget(text: string, budget: string): boolean {
  const b = flat(budget);
  if (!b) return true; // 읽을 예산 글이 없다
  const t = flat(text);
  for (let i = t.indexOf(b); i !== -1; i = t.indexOf(b, i + 1)) {
    const before = t[i - 1] ?? "";
    const after = t[i + b.length] ?? "";
    if (NUMERAL.test(b[0]) && NUMERAL.test(before)) continue;
    if (/\d/.test(b[b.length - 1]) && /\d/.test(after)) continue;
    return true;
  }
  return false;
}

/** 앱이 칸으로 만드는 요약. 가장 긴 경우에도 SUMMARY_MAX 이하(299자)다. */
export function summaryOf(slots: LiveSlots): string {
  const product = stripEnd(slots.product);
  const info = stripEnd(slots.info);
  const options = stripEnd(slots.options);
  const budget = stripEnd(slots.budget);
  const parts: string[] = [];
  if (product) parts.push(`제품은 ${product}.`);
  if (info) parts.push(`알고 싶은 정보는 ${info}.`);
  if (options) parts.push(`옵션은 ${options}.`);
  // 예산 칸의 값이 옵션·정보 글에 그대로 들어 있을 때만 따로 읽지 않는다(같은 말을 두 번 하지 않으려고).
  // 값이 다르면 접수에 쓰는 예산 칸을 반드시 읽는다. 읽어 준 예산과 접수되는 예산이 달라지면 안 된다(Codex 3차 지적 2).
  if (budget && !saysBudget(`${options} ${info}`, budget)) parts.push(`예산은 ${budget}.`);
  return parts.join(" ");
}

/** 제품이 비면 null. */
export function toDraft(slots: LiveSlots): LiveDraft | null {
  if (!slots.product) return null;
  const tidy = tidySlots(slots);
  return { ...tidy, summary: summaryOf(tidy) };
}

const STATUSES: readonly LiveChatStatus[] = ["asking", "confirming", "done", "ended"];

function encode(reply: string, status: LiveChatStatus, s: LiveSlots): string {
  return JSON.stringify({ reply, status, product: s.product, info: s.info, options: s.options, budget: s.budget });
}

/** 기록의 AI 칸. 결과 길이는 항상 2000 이하다(넘으면 reply를 반씩 줄인다). */
export function encodeAiTurn(turn: { reply: string; status: LiveChatStatus; slots: LiveSlots }): string {
  const slots = readSlots(turn.slots);
  let reply = cutText(turn.reply, REPLY_MAX);
  let out = encode(reply, turn.status, slots);
  while (out.length > AI_TURN_MAX && reply.length > 0) {
    reply = reply.length <= 1 ? "" : cutText(reply, Math.floor(reply.length / 2));
    out = encode(reply, turn.status, slots);
  }
  return out;
}

/** JSON 객체이고 reply가 문자열, status가 넷 중 하나일 때만 값을 준다. 아니면 null. */
export function decodeAiTurn(
  content: string,
): { reply: string; status: LiveChatStatus; slots: LiveSlots } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.reply !== "string") return null;
  if (!STATUSES.includes(o.status as LiveChatStatus)) return null;
  return { reply: o.reply, status: o.status as LiveChatStatus, slots: readSlots(o) };
}
