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
const DATA_URL_INLINE = /data:[A-Za-z0-9.+/-]*(;[A-Za-z0-9=._+-]+)*,[^\s"')]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![0-9])(?:\+82[- ]?0?|0)[0-9]{1,2}[- .]?[0-9]{3,4}[- .]?[0-9]{4}(?![0-9])/g;

const URL_TOKEN = /([hH][tT][tT][pP][sS]?:\/\/[^\s"'<>)]+)|([^hH]+|[hH])/g;

/** 주소 안의 %XX(ASCII 0x01~0x7F)를 더 바뀌지 않을 때까지(최대 20번) 푼다(SQL `research_url_decode`). */
export function urlDecode(text: string): string {
  let out = text;
  for (let pass = 0; pass < 20; pass += 1) {
    if (!/%[0-7][0-9A-Fa-f]/.test(out)) break;
    const prev = out;
    out = out.replace(/%([0-7][0-9A-Fa-f])/g, (whole, hex: string) =>
      hex === "00" ? whole : String.fromCharCode(parseInt(hex, 16)),
    );
    if (out === prev) break;
  }
  return out;
}

// 20번을 풀어도 남는 %XX(%00 제외)는 여러 겹으로 숨긴 주소로 보고 주소를 뺀다.
const STILL_ENCODED = /%(0[1-9A-Fa-f]|[1-7][0-9A-Fa-f])/;

function scrubPlain(text: string): string {
  return text.replace(DATA_URL_INLINE, "").replace(EMAIL, "[이메일]").replace(PHONE, "[전화번호]");
}

/**
 * 보관할 글에서 사진 데이터(data URL)는 지우고 이메일·전화번호는 [이메일]·[전화번호]로 바꾼다(SQL `research_scrub_text`).
 * 글 속 http(s) 주소에 연락처·data URL이 섞여 있으면(%40처럼 인코딩된 것도 푼 뒤 본다) 가리면 깨지므로 주소 전체를 뺀다.
 */
export function scrubText(text: string): string {
  let out = "";
  for (const match of text.matchAll(URL_TOKEN)) {
    const url = match[1];
    if (url === undefined) {
      out += match[2];
    } else {
      const decoded = urlDecode(url);
      if (scrubPlain(url) === url && scrubPlain(decoded) === decoded && !STILL_ENCODED.test(decoded)) out += url;
    }
  }
  return scrubPlain(out);
}

/** 문자(유니코드 코드 포인트) 수로 자른다. SQL `left()`와 같다(UTF-16 코드 단위로 자르지 않는다). */
export function cutChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/**
 * "data:"로 시작하는 문자열 값과 thumb 키를 지우고 나머지 글은 scrubText로 가린다(SQL `research_strip_data`).
 * 가리면 깨지는 주소(http로 시작하는데 전화번호·이메일·data URL이 섞인 값)는 값 자체를 뺀다.
 */
function dropString(value: string): boolean {
  return DATA_URL_VALUE.test(value) || (/^https?:\/\//i.test(value) && scrubText(value) !== value);
}

export function stripData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !(typeof entry === "string" && dropString(entry)))
      .map((entry) => stripData(entry)) as unknown as T;
  }
  if (typeof value === "string") return scrubText(value) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "thumb") continue;
      if (typeof entry === "string" && dropString(entry)) continue;
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
    let text = scrubText(bodyText(message.body));
    text = trimmed(cutChars(text, ARCHIVE_TEXT_MAX));
    if (text === "") continue;
    const item: ArchiveMessage = {
      seq: message.seq,
      role: message.role,
      tag: typeof message.tag === "string" ? scrubText(message.tag) : null,
      slot: typeof message.slot === "string" ? scrubText(message.slot) : null,
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

/**
 * 영구 리뷰에 들어갈 최종 문단(SQL `research_final_review`). 세션 리뷰를 쓰고, 공백뿐이면 보내는 결과의
 * 후보 1 가이드(= 리뷰 문단)를 쓴다. 가려야 할 글은 가리고 1,000자로 자른다. 둘 다 비면 빈 글.
 */
export function finalReview(reviewText: string | undefined, candidates: unknown[]): string {
  const final = trimmed(scrubText(cutChars(reviewText ?? "", REVIEW_TEXT_MAX)));
  if (final !== "" || !isRecord(candidates[0])) return final;
  return trimmed(scrubText(cutChars(str(candidates[0].guide), REVIEW_TEXT_MAX)));
}

/** 보내는 순간 만들 두 기록. 리뷰 문단이 비어 있으면 review는 null이다(영구 표에 넣지 않는다). */
export function buildArchive(
  source: ArchiveSource,
  newId: () => string,
): { archive: ResearchArchive; review: ResearchReviewRecord | null } {
  const { session } = source;
  const createdAt = new Date(source.now).toISOString();
  const verified = session.purchase === "bought" && source.photoCount > 0;
  const final = finalReview(session.review.text, source.candidates);
  const lastDraft = [...source.messages]
    .filter((message) => message.role === "ai" && message.tag === "review")
    .sort((a, b) => b.seq - a.seq)[0];
  const draft = lastDraft ? cutChars(scrubText(bodyText(lastDraft.body)), 2500) : null;

  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source.request)) {
    if (value === null || value === undefined) continue;
    request[key] = key === "conditionKind" ? value : scrubText(String(value));
  }
  const clean = (value: string | null): string | null => (value === null ? null : scrubText(value));

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
    .map((name) => cutChars(scrubText(name), 100));
  const firstName = isRecord(source.candidates[0]) ? str(source.candidates[0].name) : "";
  const model = scrubText((session.slots.model?.value ?? "").trim() || firstName);

  const confirmedAt = cutChars(scrubText(session.slots.benefits?.at ?? createdAt), 40);
  const benefitLinks: BenefitLink[] = [];
  const links = Array.isArray(session.slots.benefits?.links) ? session.slots.benefits.links : [];
  links.slice(0, BENEFIT_LINKS_MAX).forEach((url) => {
    // 주소에 전화번호·이메일·data URL이 섞여 있으면(가리면 주소가 깨지므로) 그 링크는 영구 기록에 넣지 않는다.
    if (typeof url !== "string" || !/^https?:\/\//.test(url) || scrubText(url) !== url) return;
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
      title: cutChars(scrubText(str(card?.title)), 60),
      url: cutChars(url, 500),
      kind: cutChars(scrubText(str(card?.kind)), 40),
      condition: cutChars(scrubText(str(card?.condition)), 80),
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
      item: clean(source.request.item),
      brand: clean(source.request.brand),
      product: clean(source.request.product),
      model: model === "" ? null : cutChars(model, 200),
      purchase: session.purchase,
      verified,
      reviewText: final,
      alts: names,
      benefitLinks,
      sentAt: createdAt,
    },
  };
}
