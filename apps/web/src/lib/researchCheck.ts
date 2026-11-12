import "server-only";
import { RESEARCH_LIMITS, siteNameOf, type ResearchItem, type ResearchLink } from "./research";

// AI가 만든 리서치 출력의 검사(설계 지침 3절). 화면에 보내기 전에 서버가 모양·길이·금지 패턴을 거른다.
// - 가격·재고·할인 금액처럼 보이는 표현이 든 문장은 버린다(링크 제목은 도메인 이름으로 바꾼다).
// - 웹 검색으로 받은 후보와 링크는 출처 주소가 검색 결과(인용·소스 목록)에 있는 것만 남긴다.
// 기종 이름 모양(WH-1000 등)은 정상 출력이라 거르지 않는다(answerRules.ts의 model 규칙과 다르다).

const FORBIDDEN: readonly RegExp[] = [
  /\d\s*(?:원|만\s?원|천\s?원|억\s?원?|달러)/,
  /\d\s*%/,
  /[$₩￦€¥]\s?\d/,
  /\d\s*(?:KRW|USD)/i,
  /재고\s*(?:가|는|도|이)?\s*(?:있|없|남|부족|충분|넉넉)/,
  /품절|매진|재고\s*소진/,
  /최저가|할인가|특가|판매가|정가|세일가/,
];

/** 가격·재고·할인 금액처럼 보이는 표현이 있나. */
export function hasForbidden(text: string): boolean {
  return FORBIDDEN.some((pattern) => pattern.test(text));
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** 줄 단위로, 줄 안에서는 문장 단위로 금지 표현이 든 문장을 버린다. 남은 글이 없으면 빈 글자. */
export function dropForbiddenSentences(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/(?<=[.!?。])\s+/)
        .filter((sentence) => !hasForbidden(sentence))
        .join(" ")
        .trim(),
    )
    .filter((line) => line !== "")
    .join("\n");
}

/** 주소 비교용 키: 호스트(소문자)+경로(끝 슬래시 제외)+쿼리. 프로토콜·# 뒤는 무시. https가 아니면 null. */
export function urlKey(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

const asObjects = (raw: unknown): Record<string, unknown>[] =>
  Array.isArray(raw)
    ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];

/**
 * 기종·대안 후보. 출처 주소가 allowed에 있는 것만, 이름에 금지 표현이 없는 것만 남긴다. 최대 5개.
 * exclude는 후보에서 뺄 이름(대안 후보에서 이미 정한 기종).
 */
export function cleanItems(raw: unknown, allowed: ReadonlySet<string>, exclude?: string): ResearchItem[] {
  const seen = new Set<string>(exclude ? [exclude.trim().toLowerCase()] : []);
  const items: ResearchItem[] = [];
  for (const entry of asObjects(raw)) {
    if (items.length >= RESEARCH_LIMITS.maxItems) break;
    const name = typeof entry.name === "string" ? oneLine(entry.name) : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    const key = urlKey(url);
    if (name.length < 2 || [...name].length > RESEARCH_LIMITS.nameMax || hasForbidden(name)) continue;
    if (key === null || !allowed.has(key) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const note = typeof entry.note === "string" ? oneLine(entry.note) : "";
    items.push({
      name,
      note: note === "" || hasForbidden(note) ? "" : clip(note, RESEARCH_LIMITS.noteMax),
      url,
      origin: "web",
    });
  }
  return items;
}

/** 링크. 출처 주소가 allowed에 있는 것만. 제목이 비었거나 금지 표현이 있으면 도메인 이름으로 바꾼다. 최대 4개. */
export function cleanLinks(raw: unknown, allowed: ReadonlySet<string>): ResearchLink[] {
  const seen = new Set<string>();
  const links: ResearchLink[] = [];
  for (const entry of asObjects(raw)) {
    if (links.length >= RESEARCH_LIMITS.maxLinks) break;
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    const key = urlKey(url);
    if (key === null || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    const title = typeof entry.title === "string" ? oneLine(entry.title) : "";
    const safe = title === "" || hasForbidden(title) || [...title].length > RESEARCH_LIMITS.nameMax;
    links.push({ title: safe ? siteNameOf(url) : title, url, origin: "web" });
  }
  return links;
}

/** 짧은 줄 목록(힌트·읽은 내용). 금지 표현이 든 줄은 버리고 긴 줄은 자른다. */
export function cleanLines(raw: unknown, maxCount: number, maxLength: number): string[] {
  if (!Array.isArray(raw)) return [];
  const lines: string[] = [];
  for (const entry of raw) {
    if (lines.length >= maxCount) break;
    const text = typeof entry === "string" ? oneLine(entry) : "";
    if (text === "" || hasForbidden(text) || lines.includes(text)) continue;
    lines.push(clip(text, maxLength));
  }
  return lines;
}

/**
 * AI 질문 문장. 길이·금지 표현을 넘거나, mustInclude(기종·대안 이름)가 하나라도 빠졌으면 기본 문구를 쓴다.
 * 대안 이름이 질문에 그대로 들어 있어야 AI가 없는 제품을 지어내지 못한다.
 */
export function cleanQuestion(raw: unknown, fallback: string, mustInclude: readonly string[] = []): string {
  const text = typeof raw === "string" ? oneLine(raw) : "";
  if (text === "" || [...text].length > RESEARCH_LIMITS.questionMax || hasForbidden(text)) return fallback;
  const lower = text.toLowerCase();
  return mustInclude.every((name) => lower.includes(name.trim().toLowerCase())) ? text : fallback;
}

/** 긴 글(사진 설명·핵심 정리). 금지 표현이 든 문장을 버리고 max자로 자른다. 줄바꿈은 남긴다. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const kept = dropForbiddenSentences(raw.trim());
  return clip(kept, max);
}
