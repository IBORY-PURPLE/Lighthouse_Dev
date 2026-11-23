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

const stripEnd = (s: string) => s.replace(/[.,!?]+$/, "");

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
  // 예산 글이 옵션 안에 그대로 들어 있으면 같은 말을 두 번 하지 않는다.
  if (budget && !options.includes(budget)) parts.push(`예산은 ${budget}.`);
  return parts.join(" ");
}

/** 제품이 비면 null. */
export function toDraft(slots: LiveSlots): LiveDraft | null {
  if (!slots.product) return null;
  return { ...slots, summary: summaryOf(slots) };
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
