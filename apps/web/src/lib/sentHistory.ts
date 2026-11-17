import type { ChatMessage } from "./researchClient";
import { bodyKind, tagLabel, textOf } from "./researchChatView";

/**
 * 보낸 요청의 대화 이력(봉사자 기기 localStorage `lh.vol.sentHistory.v1`). A8 결정: 기기 보관, 30일 뒤 지움.
 * 서버는 보내는 순간 대화를 지우므로(TSD §8.3) 보내기 직전에 화면이 가진 대화 글만 이 기기에 적어 둔다.
 * 사진은 넣지 않고 "사진을 올렸어요"라는 글로만 남긴다. 보낸 그 기기·브라우저에서만 보인다.
 */
export const SENT_HISTORY_KEY = "lh.vol.sentHistory.v1";
export const SENT_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 한 요청에 남길 줄 수 상한(저장소 보호). */
const MAX_LINES = 200;
/** 한 줄 글자 수 상한. */
const MAX_TEXT = 2000;

export interface HistoryLine {
  role: "ai" | "volunteer" | "system";
  chip?: string;
  note?: string;
  text: string;
}

interface Entry {
  savedAt: number;
  lines: HistoryLine[];
}

type Store = Record<string, Entry>;

function isEntry(value: unknown): value is Entry {
  const entry = value as Entry | null;
  return Boolean(entry) && typeof entry!.savedAt === "number" && Array.isArray(entry!.lines);
}

/** 30일 지난 항목을 뺀 저장값. 고장 난 값은 버린다. */
function load(now: number): Store {
  try {
    const raw = window.localStorage.getItem(SENT_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Store = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(value) && now - value.savedAt < SENT_HISTORY_TTL_MS) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    if (Object.keys(store).length === 0) window.localStorage.removeItem(SENT_HISTORY_KEY);
    else window.localStorage.setItem(SENT_HISTORY_KEY, JSON.stringify(store));
  } catch {
    // 저장소가 막히거나 가득 차면 이력 없이 지나간다(보내기는 이미 끝났다).
  }
}

/** 대화 메시지를 이력 줄로. 글이 없는 줄(후보 칩만 있는 등)은 뺀다. */
export function toHistoryLines(messages: readonly ChatMessage[]): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const message of messages) {
    const text = bodyKind(message.body) === "photo" ? "사진을 올렸어요." : textOf(message.body).trim();
    if (!text) continue;
    const tag = tagLabel(message);
    lines.push({
      role: message.role,
      ...(tag ? { chip: tag.chip, note: tag.note } : {}),
      text: text.slice(0, MAX_TEXT),
    });
  }
  return lines.slice(-MAX_LINES);
}

/** 보내기에 성공했을 때 부른다. 같은 요청이면 덮어쓰고, 30일 지난 다른 요청은 이때 같이 지운다. */
export function saveSentHistory(requestId: string, messages: readonly ChatMessage[], now = Date.now()): void {
  const lines = toHistoryLines(messages);
  const store = load(now);
  if (lines.length > 0) store[requestId] = { savedAt: now, lines };
  save(store);
}

/** 이 기기에 남은 이력. 없거나 30일이 지났으면 null(지난 것은 이때 지운다). */
export function readSentHistory(requestId: string, now = Date.now()): HistoryLine[] | null {
  const store = load(now);
  save(store);
  return store[requestId]?.lines ?? null;
}
