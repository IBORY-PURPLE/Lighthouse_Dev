import type { ResearchMessage, ResearchSessionData } from "./researchSession";

// 보낼 때 남기는 두 가지 기록의 순수 규칙(메모리 저장소가 쓴다). SQL(`research_body_text`, `research_archive_messages`,
// `research_archive_put`, `research_strip_data`)과 같은 규칙이다. 규칙을 바꾸면 마이그레이션
// `20261117010000_research_archive.sql`과 `tests/unit/sql/researchArchiveSql.test.ts`도 함께 바꾼다.
// - research_archives: 대화를 글로만 복사. 30일 보관(AI 질문 품질을 올리는 자료).
// - research_reviews: 검수해 보낸 리뷰. 영구 보관(나중에 같은 품목을 듣고 싶은 이용자에게 바로 전하는 데 다시 쓴다).

export const ARCHIVE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const ARCHIVE_TEXT_MAX = 3000;
export const ARCHIVE_MESSAGES_MAX_BYTES = 190_000;
export const REVIEW_TEXT_MAX = 1000;
export const BENEFIT_LINKS_MAX = 10;

export interface ArchiveMessage {
  seq: number;
  role: string;
  tag: string | null;
  slot: string | null;
  text: string;
}

export interface ResearchArchive {
  id: string;
  requestId: string;
  createdAt: string;
  isDemo: boolean;
  request: Record<string, unknown>;
  purchase: string;
  verified: boolean;
  slots: Record<string, unknown>;
  messages: ArchiveMessage[];
  review: { final: string; draft: string | null; rev: number };
}

export interface BenefitLink {
  title: string;
  url: string;
  kind: string;
  condition: string;
  confirmedAt: string;
}

export interface ResearchReviewRecord {
  id: string;
  requestId: string;
  createdAt: string;
  isDemo: boolean;
  item: string | null;
  brand: string | null;
  product: string | null;
  model: string | null;
  purchase: string;
  verified: boolean;
  reviewText: string;
  alts: string[];
  benefitLinks: BenefitLink[];
  sentAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DATA_URL_VALUE = /^\s*data:/i;
const DATA_URL_INLINE = /data:[A-Za-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/g;

/** "data:"로 시작하는 문자열 값과 thumb 키를 지운다(사진 썸네일이 보관본에 들어가지 않게). */
export function stripData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !(typeof entry === "string" && DATA_URL_VALUE.test(entry)))
      .map((entry) => stripData(entry)) as unknown as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "thumb") continue;
      if (typeof entry === "string" && DATA_URL_VALUE.test(entry)) continue;
      out[key] = stripData(entry);
    }
    return out as T;
  }
  return value;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 메시지 body에서 글이 되는 부분만 뽑는다. 사진·빠른 답·칩은 뺀다. */
export function bodyText(body: unknown): string {
  if (!isRecord(body)) return "";
  const kind = str(body.kind);
  if (kind === "photo") return "";
  const clean = stripData(body);
  const lines: string[] = [];
  if (typeof clean.headline === "string") lines.push(clean.headline);
  if (typeof clean.text === "string") lines.push(clean.text);
  if ((kind === "products" || kind === "benefits") && Array.isArray(clean.items)) {
    for (const item of clean.items) {
      if (!isRecord(item)) continue;
      const parts =
        kind === "products"
          ? [item.name, item.feature, item.pageUrl]
          : [item.title, item.kind, item.condition, item.compare, item.url];
      const line = parts.map(str).filter((part) => part !== "").join(" - ");
      if (line !== "") lines.push(line);
    }
  } else if (kind === "link") {
    const line = [clean.url, clean.note].map(str).filter((part) => part !== "").join(" - ");
    if (line !== "") lines.push(line);
  } else if (kind === "guide") {
    const labels: Array<[string, string]> = [
      ["queries", "검색어"],
      ["checks", "확인할 조건"],
      ["steps", "찾는 순서"],
    ];
    for (const [key, label] of labels) {
      const list = clean[key];
      if (!Array.isArray(list)) continue;
      const values = list.filter((entry): entry is string => typeof entry === "string" && entry !== "");
      if (values.length > 0) lines.push(`${label}: ${values.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 대화를 seq 순서로 글만 뽑는다. 메시지마다 3,000자, 합계 190KB 안(SQL과 같은 한도). */
export function archiveMessages(messages: ResearchMessage[]): ArchiveMessage[] {
  const out: ArchiveMessage[] = [];
  let bytes = 2;
  for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
    let text = bodyText(message.body).replace(DATA_URL_INLINE, "");
    text = text.slice(0, ARCHIVE_TEXT_MAX).trim();
    if (text === "") continue;
    const item: ArchiveMessage = {
      seq: message.seq,
      role: message.role,
      tag: message.tag ?? null,
      slot: message.slot ?? null,
      text,
    };
    const size = byteLength(JSON.stringify(item)) + 2;
    if (bytes + size > ARCHIVE_MESSAGES_MAX_BYTES) break;
    bytes += size;
    out.push(item);
  }
  return out;
}

export interface ArchiveSource {
  requestId: string;
  now: number;
  isDemo: boolean;
  request: {
    product: string;
    budget: string;
    condition: string;
    brand: string | null;
    item: string | null;
    conditionKind: string | null;
  };
  session: ResearchSessionData;
  /** 세션의 메시지 전체(seq 순서). */
  messages: ResearchMessage[];
  photoCount: number;
  /** 보내는 결과 후보 1~3개. 2·3번째 이름이 같이 고민한 제품이다. */
  candidates: unknown[];
}

function trimmed(text: string): string {
  return text.replace(/^\s+|\s+$/g, "");
}

/** 보내는 순간 만들 두 기록. 리뷰 문단이 비어 있으면 review는 null이다(영구 표에 넣지 않는다). */
export function buildArchive(
  source: ArchiveSource,
  newId: () => string,
): { archive: ResearchArchive; review: ResearchReviewRecord | null } {
  const { session } = source;
  const createdAt = new Date(source.now).toISOString();
  const verified = session.purchase === "bought" && source.photoCount > 0;
  const final = trimmed((session.review.text ?? "").slice(0, REVIEW_TEXT_MAX));
  const lastDraft = [...source.messages]
    .filter((message) => message.role === "ai" && message.tag === "review")
    .sort((a, b) => b.seq - a.seq)[0];
  const draft = lastDraft ? bodyText(lastDraft.body).slice(0, 2500) : null;

  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source.request)) {
    if (value !== null && value !== undefined) request[key] = value;
  }

  const archive: ResearchArchive = {
    id: newId(),
    requestId: source.requestId,
    createdAt,
    isDemo: source.isDemo,
    request,
    purchase: session.purchase,
    verified,
    slots: stripData(structuredClone(session.slots)) as unknown as Record<string, unknown>,
    messages: archiveMessages(source.messages),
    review: { final, draft, rev: session.review.rev ?? 0 },
  };
  if (final === "") return { archive, review: null };

  const names = source.candidates
    .slice(1)
    .map((candidate) => (isRecord(candidate) ? str(candidate.name) : ""))
    .filter((name) => name !== "")
    .map((name) => name.slice(0, 100));
  const firstName = isRecord(source.candidates[0]) ? str(source.candidates[0].name) : "";
  const model = (session.slots.model?.value ?? "").trim() || firstName;

  const confirmedAt = session.slots.benefits?.at ?? createdAt;
  const benefitLinks: BenefitLink[] = [];
  const links = Array.isArray(session.slots.benefits?.links) ? session.slots.benefits.links : [];
  links.slice(0, BENEFIT_LINKS_MAX).forEach((url) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    let card: Record<string, unknown> | null = null;
    for (const message of [...source.messages].sort((a, b) => b.seq - a.seq)) {
      if (message.body.kind !== "benefits" || !Array.isArray(message.body.items)) continue;
      const found = message.body.items.find((item) => isRecord(item) && item.url === url);
      if (isRecord(found)) {
        card = found;
        break;
      }
    }
    benefitLinks.push({
      title: str(card?.title).slice(0, 60),
      url: url.slice(0, 500),
      kind: str(card?.kind).slice(0, 40),
      condition: str(card?.condition).slice(0, 80),
      confirmedAt,
    });
  });

  return {
    archive,
    review: {
      id: newId(),
      requestId: source.requestId,
      createdAt,
      isDemo: source.isDemo,
      item: source.request.item,
      brand: source.request.brand,
      product: source.request.product,
      model: model === "" ? null : model.slice(0, 200),
      purchase: session.purchase,
      verified,
      reviewText: final,
      alts: names,
      benefitLinks,
      sentAt: createdAt,
    },
  };
}
