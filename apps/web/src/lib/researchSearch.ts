import "server-only";
import OpenAI from "openai";
import { getLlmMode, LLM_MODEL } from "./llm";
import { benefitShortcuts } from "./research";
import { fallbackResponse, parseJsonObject, type ResearchContext, type Upstream } from "./researchAi";
import { clip, hasForbidden, unknownModelTokens, urlKey, type AllowedUrls } from "./researchCheck";
import { COMMON, materialMessage } from "./researchPrompt";
import type { NextMessage } from "./researchSession";
import { OWN_LABEL, SKIP_LABEL } from "./researchTurnText";

// 대화형 리서치 챗의 웹 검색 두 가지(design.md 4.8 같이 고민한 제품 목록, 4.9 혜택 1회차).
// 라우트(…/research/search)가 부르고, AI가 낸 항목을 검사해 메시지 모양(contract-ui.md의 products·benefits)으로 만든다.
// 서버는 외부 페이지를 열지 않는다. 주소는 검색 결과(소스·인용)에 있던 것만 쓰고, 제품 사진은 가져오지 않는다.

const SEARCH_TIMEOUT_MS = 50_000;
/** 메시지 본문 한도(DB 8,192바이트)보다 여유를 둔다. jsonb 글자 모양은 공백이 조금 더 붙는다. */
const BODY_BYTES_BUDGET = 7000;

export const ALTS_CACHE_KEY = "alts";
export const BENEFITS_CACHE_KEY = "benefits1";
/** 혜택 1회차의 웹 검색 호출 수(갈래 3개 × 호출 1번씩). 요청당·하루 상한에서 이만큼 센다. */
export const BENEFITS_UNITS = 3;

const NAME_MAX = 100;
const FEATURE_MAX = 60;
const TITLE_MAX = 60;
const CONDITION_MAX = 80;
const COMPARE_MAX = 80;
/** 한 갈래에서 남기는 항목 수와, 메시지·대기 상태에 담을 주소 길이. */
const BENEFITS_PER_BRANCH = 3;
const PRODUCTS_MAX = 5;
const URL_MAX = 300;

export const ALTS_INTRO = "같이 고민해 볼 만한 제품이에요. 하나를 고르거나 직접 적어 주세요.";
export const ALTS_FALLBACK_INTRO = "AI가 아닌 고정 후보예요. 쇼핑몰에서 직접 확인해 주세요.";
export const ALTS_EMPTY = "비슷한 제품을 찾지 못했어요. 직접 적거나 건너뛰어도 돼요.";
export const BENEFITS_EMPTY = "혜택 페이지를 찾지 못했어요. 아래 쇼핑몰에서 직접 확인해 주세요.";
const COMPARE_SAME = "받으신 경험과 같은 종류예요. 조건이 같은지 확인해 보세요.";
const COMPARE_NEW = "받으신 경험과 다른 새 종류예요.";
const COMPARE_NONE = "받은 혜택이 없었다고 하셨어요. 새로 찾은 종류예요.";

// ---- 갈래 ----------------------------------------------------------------------------

export type BenefitBranchId = "official" | "card" | "market";
export interface BenefitBranch {
  id: BenefitBranchId;
  /** 항목 kind에 그대로 들어가는 종류 이름. */
  label: string;
  /** 봉사자가 말한 경험이 이 갈래인지 알아보는 낱말. */
  experience: RegExp;
  task: string;
}

/** 갈래 3개: 공식몰·제조사 행사 / 카드·결제 혜택 / 오픈마켓 쿠폰·멤버십·배송(design.md 4.9). 이 순서로 보인다. */
export const BENEFIT_BRANCHES: readonly BenefitBranch[] = [
  {
    id: "official",
    label: "공식몰·제조사 행사",
    experience: /공식|제조사|사은품|행사|이벤트|프로모션/,
    task: "제조사 공식몰이나 제조사가 여는 행사·사은품·이벤트",
  },
  {
    id: "card",
    label: "카드·결제 혜택",
    experience: /카드|결제|페이|무이자|캐시백|포인트/,
    task: "카드사나 간편결제의 결제 혜택(청구 할인, 무이자 할부, 포인트 적립 같은 종류)",
  },
  {
    id: "market",
    label: "오픈마켓 쿠폰·멤버십·배송",
    experience: /쿠폰|배송|멤버십|와우|오픈마켓|쿠팡|11번가|지마켓|g마켓|적립/i,
    task: "오픈마켓(쿠팡·11번가·G마켓 등)의 쿠폰·멤버십·배송 혜택",
  },
];

const NO_EXPERIENCE = /^(?:받은\s?)?(?:혜택(?:은|이)?\s?)?(?:없|안\s?받|못\s?받)/;

/** 받은 혜택이 없다는 답("없었어요", "혜택은 없었어요")이거나 비어 있나. */
export function hasNoExperience(experience: string): boolean {
  const text = experience.normalize("NFKC").trim();
  return text === "" || NO_EXPERIENCE.test(text);
}

/** 봉사자의 혜택 경험이 어느 갈래들인지. 없다는 답은 빈 목록이다. */
export function experienceBranches(experience: string): BenefitBranchId[] {
  if (hasNoExperience(experience)) return [];
  const text = experience.normalize("NFKC");
  return BENEFIT_BRANCHES.filter((branch) => branch.experience.test(text)).map((branch) => branch.id);
}

// ---- 주소 ----------------------------------------------------------------------------

/** AI가 내용을 열어 볼 수 없는 곳(봇 차단으로 403). 이런 주소는 "직접 확인 필요"(mode check)로 보인다. */
const AI_CLOSED_HOSTS: readonly string[] = [
  "coupang.com",
  "11st.co.kr",
  "gmarket.co.kr",
  "auction.co.kr",
  "smartstore.naver.com",
  "shopping.naver.com",
  "brand.naver.com",
  "tmon.co.kr",
  "wemakeprice.com",
  "ssg.com",
];

export function isAiClosedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AI_CLOSED_HOSTS.some((closed) => host === closed || host.endsWith(`.${closed}`));
  } catch {
    return true;
  }
}

// ---- 항목 검사(순수 함수) ------------------------------------------------------------------

export interface ProductItem {
  name: string;
  feature: string;
  /** 검색 결과에 있던 그 제품의 페이지 주소. 다른 제품과 같은 주소를 쓰는 제품은 비워 둔다. */
  pageUrl: string;
}

export interface BenefitItem {
  id: string;
  title: string;
  kind: string;
  condition: string;
  compare: string;
  url: string;
  mode: "ai" | "check";
}

export interface BenefitGroup {
  branch: BenefitBranchId;
  label: string;
  items: BenefitItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asObjects = (raw: unknown): Record<string, unknown>[] => (Array.isArray(raw) ? raw.filter(isRecord) : []);
const oneLine = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const charCount = (value: string) => [...value].length;
const nameKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** 글에 금지 표현이나 자료에 없는 기종 이름이 있나. */
function unsafe(text: string, material: readonly string[]): boolean {
  return hasForbidden(text) || unknownModelTokens(text, material).length > 0;
}

const compactKey = (value: string) => value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9가-힣]/g, "");

/**
 * 이름이 검색 인용(evidence)에 근거가 있나. 숫자가 든 토큰(영문 기종 번호뿐 아니라 "버즈3" 같은 한글+숫자도)은 모두 인용에 있어야 한다.
 * 첫 토큰(보통 브랜드)과 브랜드·품목(generic) 토큰을 뺀 나머지 토큰도 모두 인용에 있어야 하고, 남는 토큰이 없으면 첫 토큰이 인용에 있어야 한다.
 */
function nameInEvidence(name: string, evidence: readonly string[], generic: readonly string[]): boolean {
  // 인용마다 따로 대조한다(인용을 이어 붙이면 한 인용의 끝과 다른 인용의 시작이 합쳐져 없는 기종 번호가 생긴다).
  const known = evidence.map(compactKey);
  const found = (key: string) => known.some((text) => text.includes(key));
  const skip = compactKey(generic.join(" "));
  // 한 글자 토큰("버즈 3"의 3)은 앞 토큰에 붙여서 본다.
  const raws: string[] = [];
  for (const raw of name.normalize("NFKC").split(/[\s|·,/()]+/).filter(Boolean)) {
    if (compactKey(raw).length < 2 && raws.length > 0) raws[raws.length - 1] += raw;
    else raws.push(raw);
  }
  const tokens = raws.map((raw) => ({ raw, key: compactKey(raw) })).filter((token) => token.key.length >= 2);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => /\d/.test(token.raw) && !found(token.key))) return false;
  const rest = tokens.slice(1).filter((token) => !skip.includes(token.key));
  return rest.length > 0 ? rest.every((token) => found(token.key)) : found(tokens[0]!.key);
}

/**
 * 같이 고민한 제품 목록. 이름은 금지 표현이 없고 자료(검색 인용의 제목·주소와 요청·기종)에 없는 기종 이름이 없어야 하고,
 * 주소는 검색 결과에 있던 https 주소여야 한다(없으면 버린다). 특징은 금지 표현·없는 기종 이름이 든 문장을 버리고 60자로 자른다.
 * exclude는 뺄 이름(이미 고른 기종). evidence가 있으면 이름은 그 인용(제목·주소)에 근거가 있어야 한다(generic은 브랜드·품목). 같은 주소를 쓰는 둘째 제품은 버린다(주소는 그 제품의 인용 페이지여야 한다).
 */
export function cleanProducts(
  raw: unknown,
  allowed: AllowedUrls,
  material: readonly string[],
  exclude: readonly string[] = [],
  evidence?: { texts: readonly string[]; generic: readonly string[] },
): ProductItem[] {
  const seen = new Set(exclude.map(nameKey).filter(Boolean));
  const usedUrls = new Set<string>();
  const items: ProductItem[] = [];
  for (const entry of asObjects(raw)) {
    if (items.length >= PRODUCTS_MAX) break;
    const name = oneLine(entry.name);
    if (name.length < 2 || charCount(name) > NAME_MAX || unsafe(name, material) || seen.has(nameKey(name))) continue;
    if (evidence && !nameInEvidence(name, evidence.texts, evidence.generic)) continue;
    const key = urlKey(oneLine(entry.pageUrl ?? entry.url));
    const source = key === null ? undefined : allowed.get(key);
    if (key === null || source === undefined || charCount(source) > URL_MAX) continue;
    if (usedUrls.has(key)) continue;
    seen.add(nameKey(name));
    usedUrls.add(key);
    const feature = oneLine(entry.feature ?? entry.note);
    const sentences = feature
      .split(/(?<=[.!?。])\s+/)
      .filter((sentence) => sentence !== "" && !unsafe(sentence, [...material, name]));
    items.push({ name, feature: clip(sentences.join(" "), FEATURE_MAX), pageUrl: source });
  }
  return items;
}

/**
 * 한 갈래의 혜택 항목. 제목·조건·비교에 금지 표현(금액·할인율·최저가 등)이나 없는 기종 이름이 든 항목은 버린다.
 * 주소는 이 갈래의 검색 결과(인용)에 있는 https 주소만 쓰고, seenUrls에 있는 주소(다른 갈래가 이미 쓴 것)는 버린다.
 * AI가 열 수 없는 곳이면 mode는 check(직접 확인 필요)다. 비교 줄이 비면 서버 문구로 채운다.
 */
export function cleanBenefitItems(
  raw: unknown,
  branch: BenefitBranch,
  allowed: AllowedUrls,
  material: readonly string[],
  context: { experience: string; seenUrls: Set<string> },
): BenefitItem[] {
  const sameKind = experienceBranches(context.experience).includes(branch.id);
  const noExperience = hasNoExperience(context.experience);
  const items: BenefitItem[] = [];
  for (const entry of asObjects(raw)) {
    if (items.length >= BENEFITS_PER_BRANCH) break;
    const title = oneLine(entry.title);
    const condition = oneLine(entry.condition);
    const compare = oneLine(entry.compare);
    if (title === "" || condition === "") continue;
    if ([title, condition, compare].some((text) => unsafe(text, material))) continue;
    const key = urlKey(oneLine(entry.url));
    const source = key === null ? undefined : allowed.get(key);
    if (key === null || source === undefined || charCount(source) > URL_MAX || context.seenUrls.has(key)) continue;
    context.seenUrls.add(key);
    items.push({
      id: `${branch.id}-${items.length + 1}`,
      title: clip(title, TITLE_MAX),
      kind: branch.label,
      condition: clip(condition, CONDITION_MAX),
      compare: compare === "" ? (sameKind ? COMPARE_SAME : noExperience ? COMPARE_NONE : COMPARE_NEW) : clip(compare, COMPARE_MAX),
      url: source,
      mode: isAiClosedHost(source) ? "check" : "ai",
    });
  }
  return items;
}

// ---- 메시지 만들기(순수 함수) -----------------------------------------------------------------

/** 항목을 앞에서부터 담되 본문이 예산을 넘지 않게 나눈다. 한 덩이도 못 담는 항목은 버린다. */
function chunkBySize<T>(items: readonly T[], wrap: (chunk: T[]) => unknown): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    if (bytesOf(wrap([item])) > BODY_BYTES_BUDGET) continue;
    if (current.length > 0 && bytesOf(wrap([...current, item])) > BODY_BYTES_BUDGET) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

type SearchAi = "ok" | "fallback" | "capped";

/** 같이 고민한 제품 카드 메시지(질문 4). 목록이 비면 안내 글만 있는 말풍선이다. */
export function productsMessages(items: readonly ProductItem[], ai: SearchAi, notice?: string): NextMessage[] {
  const wrap = (chunk: readonly ProductItem[]) => ({
    kind: "products",
    text: notice ?? (ai === "fallback" ? ALTS_FALLBACK_INTRO : ALTS_INTRO),
    items: chunk,
    noneLabel: SKIP_LABEL.alts,
    ownLabel: OWN_LABEL,
  });
  if (items.length === 0) {
    return [{ role: "ai", tag: "search", slot: "alts", body: { kind: "text", text: notice ?? ALTS_EMPTY }, ai }];
  }
  // 5개까지라 보통 한 덩이다. 주소가 길어 넘치면 뒤 항목을 뺀다(카드는 한 메시지로 보인다).
  const [kept] = chunkBySize(items, wrap);
  if (!kept) return productsMessages([], ai, notice);
  return [{ role: "ai", tag: "search", slot: "alts", body: wrap(kept), ai }];
}

/** 머리 줄: 찾은 개수와 봉사자 경험과 같은 종류 n·새 종류 m. */
export function benefitsHeadline(groups: readonly BenefitGroup[], experience: string): string {
  const same = new Set(experienceBranches(experience));
  let n = 0;
  let m = 0;
  for (const group of groups) {
    if (same.has(group.branch)) n += group.items.length;
    else m += group.items.length;
  }
  return `혜택 ${n + m}개를 찾았어요. 받으신 경험과 같은 종류 ${n}개, 새 종류 ${m}개예요.`;
}

/**
 * 혜택 카드 메시지: 갈래마다 한 메시지(한 갈래가 크면 더 나눈다). 머리 줄은 첫 메시지에 붙는다.
 * 항목이 하나도 없으면 안내 글과 쇼핑몰 바로가기 한 메시지다.
 */
export function benefitMessages(
  groups: readonly BenefitGroup[],
  experience: string,
  subject: string,
  ai: SearchAi,
  notice?: string,
): NextMessage[] {
  const filled = groups.filter((group) => group.items.length > 0);
  if (filled.length === 0) {
    return [
      {
        role: "ai",
        tag: "search",
        slot: "benefits",
        body: { kind: "text", text: notice ?? BENEFITS_EMPTY, shortcuts: benefitShortcuts(subject) },
        ai,
      },
    ];
  }
  const messages: NextMessage[] = [];
  const headline = benefitsHeadline(filled, experience);
  for (const group of filled) {
    const wrap = (chunk: readonly BenefitItem[]) => ({ kind: "benefits", headline: `${group.label}`, items: chunk });
    for (const chunk of chunkBySize(group.items, wrap)) {
      const first = messages.length === 0;
      messages.push({
        role: "ai",
        tag: "search",
        slot: "benefits",
        body: { kind: "benefits", headline: first ? `${headline} ${group.label}` : group.label, items: chunk },
        ai,
      });
    }
  }
  return messages.length > 0
    ? messages
    : [{ role: "ai", tag: "search", slot: "benefits", body: { kind: "text", text: BENEFITS_EMPTY, shortcuts: benefitShortcuts(subject) }, ai }];
}

/** 화면이 [확인했어요]를 누를 수 있는 혜택 링크 목록(pending.shownBenefitLinks에 저장). */
export function benefitLinkEntries(groups: readonly BenefitGroup[]): { url: string; slot: "benefits" }[] {
  return groups.flatMap((group) => group.items.map((item) => ({ url: item.url, slot: "benefits" as const })));
}

// ---- 웹 검색 호출 --------------------------------------------------------------------------

export interface Usage {
  in: number;
  out: number;
  ws: number;
}

export interface SearchRun<T> {
  data: T;
  ai: "ok" | "fallback";
  upstream: Upstream | null;
  usage: Usage;
  /** 검색 결과(인용·소스)에 있던 주소. 시험이 항목 주소가 여기 있는지 본다. */
  citations: string[];
}

const hasKey = () => Boolean(process.env.OPENAI_API_KEY?.trim());

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function upstreamOf(error: unknown, signal: AbortSignal | undefined): Upstream {
  const status = statusOf(error);
  if (status !== undefined) return status;
  const name = (error as { name?: unknown } | null)?.name;
  return signal?.aborted || (typeof name === "string" && /Timeout|Abort/i.test(name)) ? "timeout" : "none";
}

interface WebSearchResult {
  text: string;
  allowed: Map<string, string>;
  /** 인용 제목(기종 이름 확인 자료). */
  titles: string[];
}

/** Responses + web_search 한 번. 글과 검색 결과(소스·인용)에 나온 주소·제목을 돌려준다. */
async function callWebSearch(args: {
  instructions: string;
  material: Record<string, unknown>;
  maxToolCalls: number;
  signal: AbortSignal | undefined;
  usage: Usage;
}): Promise<WebSearchResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: SEARCH_TIMEOUT_MS });
  const response = await client.responses.create(
    {
      model: LLM_MODEL,
      instructions: args.instructions,
      input: materialMessage("자료를 웹에서 검색해 출력 모양대로 답한다.", args.material),
      store: false,
      tools: [
        {
          type: "web_search",
          search_context_size: "low",
          user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" },
        },
      ],
      include: ["web_search_call.action.sources"],
      reasoning: { effort: "low" },
      max_tool_calls: args.maxToolCalls,
      max_output_tokens: 3000,
    },
    { signal: args.signal },
  );
  const allowed = new Map<string, string>();
  const titles: string[] = [];
  const addUrl = (value: unknown) => {
    const key = typeof value === "string" ? urlKey(value) : null;
    if (key && typeof value === "string" && !allowed.has(key)) allowed.set(key, value.trim());
  };
  const texts: string[] = [];
  args.usage.in += response.usage?.input_tokens ?? 0;
  args.usage.out += response.usage?.output_tokens ?? 0;
  for (const output of response.output ?? []) {
    if (output.type === "web_search_call") args.usage.ws += 1;
    if (output.type === "web_search_call" && output.action?.type === "search") {
      for (const source of output.action.sources ?? []) addUrl(source.url);
    } else if (output.type === "message") {
      for (const content of output.content) {
        if (content.type !== "output_text") continue;
        texts.push(content.text);
        for (const note of content.annotations ?? []) {
          if (note.type !== "url_citation") continue;
          addUrl(note.url);
          if (typeof note.title === "string") titles.push(note.title);
        }
      }
    }
  }
  const text = texts.join("\n") || (typeof response.output_text === "string" ? response.output_text : "");
  return { text, allowed, titles };
}

/** 모델이 낸 이름이 자료에 있는지 볼 때 쓰는 글: 검색 인용의 제목·주소와 요청·기종. */
function materialOf(context: ResearchContext, extra: readonly string[], result: WebSearchResult): string[] {
  return [context.product, context.brand ?? "", context.item ?? "", ...extra, ...result.titles, ...result.allowed.values()];
}

const noUsage = (): Usage => ({ in: 0, out: 0, ws: 0 });

// ---- 같이 고민한 제품 목록 --------------------------------------------------------------------

const ALTS_TASK = [
  "이 카드에서 할 일: 자료의 기종과 같은 품목에서 함께 고민할 만한 다른 기종 3~5개를 웹 검색으로 찾는다. 자료의 기종 자신은 뺀다.",
  '출력 모양: {"items":[{"name":"브랜드와 기종 번호(40자 안쪽)","feature":"이 기종의 특징 한 줄(60자 안쪽)","pageUrl":"검색에서 실제로 본 그 기종의 페이지 주소"}]}',
  "- 기종 이름은 페이지에 적힌 그대로 쓴다. 비슷한 이름을 만들어 내지 않는다. 페이지 제목 전체나 '|' 같은 구분 기호를 쓰지 않는다.",
  "- feature에는 가격, 재고, 순위, 판매량을 쓰지 않는다. 페이지에서 확인한 특징만 쓴다.",
  "- pageUrl은 그 기종 자신의 페이지 주소다. 같은 주소를 두 기종에 다시 쓰지 않는다. 그런 페이지를 찾지 못한 기종은 쓰지 않는다.",
].join("\n");

const MOCK_PRODUCTS: ProductItem[] = [
  { name: "가짜 헤드셋 LH-500", feature: "가볍고 접어서 들고 다니기 좋아요", pageUrl: "https://example.com/products/lh-500" },
  { name: "가짜 헤드셋 LH-600", feature: "소음을 줄여 주는 기능이 있어요", pageUrl: "https://example.com/products/lh-600" },
  { name: "가짜 헤드셋 LH-700", feature: "오래 써도 귀가 편해요", pageUrl: "https://example.com/products/lh-700" },
];

/** AI 없이 보이는 고정 후보(시연 품목 표). exclude는 이미 고른 기종. */
export function fixedProducts(context: ResearchContext, model: string): ProductItem[] {
  const body = fallbackResponse({ requestId: "", kind: "alts", model }, context);
  const items = body.kind === "alts" ? body.items : [];
  return items.map((item) => ({ name: item.name, feature: item.note, pageUrl: item.url ?? "" }));
}

/** 같이 고민한 제품 3~5개(질문 4). 던지지 않는다: 실패하면 고정 후보(시연 품목)로 내려간다(ai fallback). */
export async function searchProducts(
  context: ResearchContext,
  model: string,
  signal?: AbortSignal,
): Promise<SearchRun<ProductItem[]>> {
  if (getLlmMode() === "mock") {
    return { data: MOCK_PRODUCTS.map((item) => ({ ...item })), ai: "ok", upstream: null, usage: noUsage(), citations: [] };
  }
  const fixed = (upstream: Upstream, usage: Usage, citations: string[] = []): SearchRun<ProductItem[]> => ({
    data: fixedProducts(context, model),
    ai: "fallback",
    upstream,
    usage,
    citations,
  });
  if (!hasKey()) return fixed("nokey", noUsage());
  const usage = noUsage();
  try {
    const result = await callWebSearch({
      instructions: `${COMMON}\n\n${ALTS_TASK}`,
      material: { 요청: context.product, 브랜드: context.brand, 품목: context.item, 기종: model },
      maxToolCalls: 4,
      signal,
      usage,
    });
    const raw = parseJsonObject(result.text)?.items;
    // 이름 대조 자료는 검색 인용(제목·주소)과 브랜드·품목뿐이다(design 4.8 "자료 = 인용"). 요청 글과 고른 기종은 넣지 않는다.
    const generic = [context.brand ?? "", context.item ?? ""];
    const texts = [...result.titles, ...result.allowed.values()];
    const items = cleanProducts(raw, result.allowed, [...generic, ...texts], [model], { texts, generic });
    const citations = [...result.allowed.values()];
    return items.length > 0
      ? { data: items, ai: "ok", upstream: null, usage, citations }
      : fixed("empty", usage, citations);
  } catch (error) {
    return fixed(upstreamOf(error, signal), usage);
  }
}

// ---- 혜택 1회차 ---------------------------------------------------------------------------

function benefitTask(branch: BenefitBranch): string {
  return [
    `이 카드에서 할 일: 자료의 기종을 살 때 받을 수 있는 ${branch.task}를 웹 검색으로 찾아 최대 3개 알려 준다. 자료의 "봉사자경험"은 봉사자가 이미 받은 혜택이다.`,
    '출력 모양: {"items":[{"title":"혜택 이름(40자 안쪽)","condition":"받는 조건 한 줄(60자 안쪽)","compare":"봉사자가 받은 경험과 같은 종류인지 다른지 한 줄(60자 안쪽)","url":"검색에서 실제로 본 안내 페이지 주소"}]}',
    "- 금액, 할인율, 퍼센트 숫자, 최저가는 쓰지 않는다. 혜택의 종류와 받는 조건만 쓴다.",
    "- 자료의 오늘 날짜 기준으로 이미 끝난 행사는 쓰지 않는다. 확인하지 못한 조건을 지어내지 않는다.",
    "- url은 그 혜택을 안내하는 페이지 주소다. 못 찾으면 items를 빈 배열로 둔다.",
  ].join("\n");
}

const todayKst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

const MOCK_BENEFITS: Record<BenefitBranchId, { title: string; condition: string; url: string }> = {
  official: { title: "공식몰 사은품 행사", condition: "공식몰에서 주문하면 받아요", url: "https://example.com/benefits/official" },
  card: { title: "제휴 카드 청구 할인", condition: "대상 카드로 결제하면 받아요", url: "https://example.com/benefits/card" },
  market: { title: "오픈마켓 멤버십 배송", condition: "멤버십 회원이면 받아요", url: "https://www.coupang.com/benefits/market" },
};

export interface BenefitsArgs {
  model: string;
  /** 봉사자가 답한 혜택 경험(benefits 칸). 없으면 빈 글자. */
  experience: string;
}

/**
 * 혜택 1회차: 갈래 3개를 함께 부른다(각 max_tool_calls 2, 전체 마감 50초). 던지지 않는다.
 * 갈래 하나가 실패해도 나머지는 쓴다. 쓸 항목이 하나도 없으면 groups가 비고 ai는 fallback이다.
 */
export async function searchBenefits(
  context: ResearchContext,
  args: BenefitsArgs,
  signal?: AbortSignal,
): Promise<SearchRun<BenefitGroup[]>> {
  const seenUrls = new Set<string>();
  if (getLlmMode() === "mock") {
    const groups = BENEFIT_BRANCHES.map((branch): BenefitGroup => {
      const mock = MOCK_BENEFITS[branch.id];
      const allowed = new Map([[urlKey(mock.url) ?? mock.url, mock.url]]);
      return {
        branch: branch.id,
        label: branch.label,
        items: cleanBenefitItems([{ ...mock, compare: "" }], branch, allowed, [], { experience: args.experience, seenUrls }),
      };
    });
    return { data: groups, ai: "ok", upstream: null, usage: noUsage(), citations: [] };
  }
  const empty = (upstream: Upstream, usage: Usage, citations: string[] = []): SearchRun<BenefitGroup[]> => ({
    data: [],
    ai: "fallback",
    upstream,
    usage,
    citations,
  });
  if (!hasKey()) return empty("nokey", noUsage());
  const usage = noUsage();
  const material = {
    요청: context.product,
    브랜드: context.brand,
    품목: context.item,
    기종: args.model,
    봉사자경험: args.experience || "없음",
    오늘날짜: todayKst(),
  };
  const settled = await Promise.allSettled(
    BENEFIT_BRANCHES.map((branch) =>
      callWebSearch({
        instructions: `${COMMON}\n\n${benefitTask(branch)}`,
        material,
        maxToolCalls: 2,
        signal,
        usage,
      }),
    ),
  );
  const groups: BenefitGroup[] = [];
  const citations: string[] = [];
  let failure: Upstream | null = null;
  for (const [index, outcome] of settled.entries()) {
    const branch = BENEFIT_BRANCHES[index]!;
    if (outcome.status === "rejected") {
      failure ??= upstreamOf(outcome.reason, signal);
      continue;
    }
    const result = outcome.value;
    citations.push(...result.allowed.values());
    const raw = parseJsonObject(result.text)?.items;
    const items = cleanBenefitItems(raw, branch, result.allowed, materialOf(context, [args.model, args.experience], result), {
      experience: args.experience,
      seenUrls,
    });
    groups.push({ branch: branch.id, label: branch.label, items });
  }
  const kept = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (kept > 0) return { data: groups, ai: "ok", upstream: null, usage, citations };
  return empty(failure ?? "empty", usage, citations);
}
