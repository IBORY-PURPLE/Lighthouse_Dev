import "server-only";
import OpenAI from "openai";
import { demoCandidatesFor } from "./demoCandidates";
import { getLlmMode, LLM_MODEL } from "./llm";
import {
  benefitShortcuts,
  defaultQuestion,
  draftSummaryText,
  emptyResearchState,
  refShortcuts,
  RESEARCH_COPY,
  RESEARCH_LIMITS,
  subjectOf,
  type ResearchItem,
  type ResearchRequestBody,
  type ResearchResponse,
} from "./research";
import {
  cleanItems,
  cleanLines,
  cleanLinks,
  cleanQuestion,
  cleanText,
  countObjects,
  urlKey,
  type AllowedUrls,
} from "./researchCheck";
import { mockResponse } from "./researchMock";
import {
  askInstructions,
  materialMessage,
  searchInstructions,
  VISION_INSTRUCTIONS,
  type AskCard,
  type SearchCard,
} from "./researchPrompt";

// 리서치 AI 호출 3종(search·ask·vision), 가짜 모드, fallback. 운영 모델은 llm.ts의 LLM_MODEL 하나다.
// search는 gpt-6-luna가 web_search를 받는다(2026-11-13 실호출 확인). 실패하면 조용히 fallback으로 내려간다.

/**
 * fallback일 때의 원인(로그용). 숫자는 상위 서버의 HTTP 상태 코드, timeout은 마감·중단,
 * empty는 호출은 성공했지만 검사 뒤 쓸 것이 없음, nokey는 키 없음, none은 그 밖의 실패.
 */
export type Upstream = number | "timeout" | "empty" | "nokey" | "none";

/** 모델 호출이 끝난 뒤의 결과. upstream은 fallback일 때만 있다. detail은 empty일 때 버려진 개수(kept=<n>/<m>, 숫자만). */
export interface ResearchOutcome {
  body: ResearchResponse;
  upstream: Upstream | null;
  detail?: string;
}

/** 저장소에서 읽은 요청 값. 요청 문장·브랜드·품목은 저장소 값만 쓴다(화면이 준 값은 쓰지 않는다). */
export interface ResearchContext {
  product: string;
  brand: string | null;
  item: string | null;
}

const SEARCH_TIMEOUT_MS = 50_000;
const ASK_TIMEOUT_MS = 25_000;
const VISION_TIMEOUT_MS = 45_000;

const hasKey = () => Boolean(process.env.OPENAI_API_KEY?.trim());

function newClient(timeout: number): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout });
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** 시간 초과·중단으로 끝났나(SDK의 시간 초과 오류, 중단 신호). */
function isTimeout(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && /Timeout|Abort/i.test(name);
}

/** 모델이 낸 글에서 JSON 객체를 꺼낸다(코드 블록 표시나 앞뒤 설명이 붙어도). 못 꺼내면 null. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const attempt = (value: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? attempt(cleaned.slice(start, end + 1)) : null;
}

// ---- 호출 3종 --------------------------------------------------------------------

/** search: Responses API + web_search. 글과, 검색 결과(소스 목록·인용)에 나온 주소(비교 키 → 검색 결과의 주소)를 돌려준다. */
async function callSearch(
  card: SearchCard,
  material: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{ text: string; urls: AllowedUrls }> {
  const response = await newClient(SEARCH_TIMEOUT_MS).responses.create(
    {
      model: LLM_MODEL,
      instructions: searchInstructions(card),
      input: materialMessage("자료를 웹에서 검색해 출력 모양대로 답한다.", material),
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
      max_tool_calls: 4,
      max_output_tokens: 3000,
    },
    { signal },
  );

  const urls = new Map<string, string>();
  const addUrl = (value: unknown) => {
    const key = typeof value === "string" ? urlKey(value) : null;
    if (key && typeof value === "string" && !urls.has(key)) urls.set(key, value.trim());
  };
  const texts: string[] = [];
  for (const output of response.output ?? []) {
    if (output.type === "web_search_call" && output.action?.type === "search") {
      for (const source of output.action.sources ?? []) addUrl(source.url);
    } else if (output.type === "message") {
      for (const content of output.content) {
        if (content.type !== "output_text") continue;
        texts.push(content.text);
        for (const note of content.annotations ?? []) {
          if (note.type === "url_citation") addUrl(note.url);
        }
      }
    }
  }
  const text = texts.join("\n") || (typeof response.output_text === "string" ? response.output_text : "");
  return { text, urls };
}

/** ask: Chat Completions JSON 모드(기존 요약 호출과 같은 방식). */
async function callAsk(
  card: AskCard,
  material: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  // 추론을 끈다. 켜 두면 추론 토큰이 먼저 쓰여 글자 없이 끝날 수 있다. temperature는 추론이 none일 때만 둘 수 있다.
  const completion = await newClient(ASK_TIMEOUT_MS).chat.completions.create(
    {
      model: LLM_MODEL,
      max_completion_tokens: 1200,
      reasoning_effort: "none",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: askInstructions(card) },
        { role: "user", content: materialMessage("자료를 읽고 출력 모양대로 답한다.", material) },
      ],
    },
    { signal },
  );
  return completion.choices[0]?.message?.content ?? "";
}

/** vision: 기존 글자 읽기(OCR)와 같은 이미지 입력 모양. 출력은 설명 글이다. */
async function callVision(
  image: string,
  material: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const completion = await newClient(VISION_TIMEOUT_MS).chat.completions.create(
    {
      model: LLM_MODEL,
      max_completion_tokens: 600,
      reasoning_effort: "none",
      messages: [
        { role: "system", content: VISION_INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text", text: materialMessage("사진을 설명한다.", material) },
            { type: "image_url", image_url: { url: image, detail: "auto" } },
          ],
        },
      ],
    },
    { signal },
  );
  return (completion.choices[0]?.message?.content ?? "").trim();
}

// ---- 응답 만들기 ---------------------------------------------------------------------

/** 검사 전후 개수(로그에 숫자만 남긴다). */
interface Tally {
  kept: number;
  total: number;
}

const tallied = <T extends { length: number }>(tally: Tally, raw: unknown, kept: T): T => {
  tally.total = countObjects(raw);
  tally.kept = kept.length;
  return kept;
};

/** 모델 출력이 검사를 통과하지 못해 쓸 것이 없으면 null(호출한 쪽이 fallback으로 간다). */
async function liveResponse(
  request: ResearchRequestBody,
  context: ResearchContext,
  signal: AbortSignal | undefined,
  tally: Tally,
): Promise<ResearchResponse | null> {
  const subject = subjectOf(context);
  const base = { 요청: context.product, 브랜드: context.brand, 품목: context.item };
  // 이 글들에 있는 기종 이름만 AI 글에 나올 수 있다(없는 기종 이름이 든 문장은 버린다).
  const known = [context.product, context.brand ?? "", context.item ?? ""];

  switch (request.kind) {
    case "model": {
      const { text, urls } = await callSearch("model", base, signal);
      const raw = parseJsonObject(text)?.items;
      const items = tallied(tally, raw, cleanItems(raw, urls));
      return items.length ? { kind: "model", ai: "ok", items } : null;
    }
    case "alts": {
      const { text, urls } = await callSearch("alts", { ...base, 기종: request.model }, signal);
      const raw = parseJsonObject(text)?.items;
      const items = tallied(tally, raw, cleanItems(raw, urls, request.model));
      return items.length ? { kind: "alts", ai: "ok", items } : null;
    }
    case "benefits": {
      const { text, urls } = await callSearch("benefits", { ...base, 기종: request.model }, signal);
      const raw = parseJsonObject(text)?.links;
      const links = tallied(tally, raw, cleanLinks(raw, urls));
      return links.length
        ? { kind: "benefits", ai: "ok", links, shortcuts: benefitShortcuts(request.model) }
        : null;
    }
    case "refs": {
      const { text, urls } = await callSearch("refs", { ...base, 기종: request.model }, signal);
      const json = parseJsonObject(text);
      const links = tallied(tally, json?.links, cleanLinks(json?.links, urls));
      if (!links.length) return null;
      const digest = cleanLines(json?.digest, RESEARCH_LIMITS.maxDigest, RESEARCH_LIMITS.digestMax);
      return { kind: "refs", ai: "ok", digest, links, shortcuts: refShortcuts(request.model) };
    }
    case "pros": {
      const material = [...known, request.model];
      const json = parseJsonObject(await callAsk("pros", { 요청: context.product, 기종: request.model }, signal));
      const hints = tallied(
        tally,
        json?.hints,
        cleanLines(json?.hints, RESEARCH_LIMITS.maxHints, RESEARCH_LIMITS.hintMax, material),
      );
      if (!hints.length) return null;
      const fallback = defaultQuestion("pros", { subject, model: request.model, alts: [] });
      return {
        kind: "pros",
        ai: "ok",
        question: cleanQuestion(json?.question, fallback, [request.model], material),
        hints,
      };
    }
    case "altReason": {
      const material = [...known, request.model, ...request.alts];
      const json = parseJsonObject(
        await callAsk("altReason", { 요청: context.product, 기종: request.model, 대안: request.alts }, signal),
      );
      const hints = tallied(
        tally,
        json?.hints,
        cleanLines(json?.hints, RESEARCH_LIMITS.maxHints, RESEARCH_LIMITS.hintMax, material),
      );
      if (!hints.length) return null;
      const fallback = defaultQuestion("altReason", { subject, model: request.model, alts: request.alts });
      return {
        kind: "altReason",
        ai: "ok",
        question: cleanQuestion(json?.question, fallback, request.alts, material),
        hints,
      };
    }
    case "photo": {
      const kindText = request.photoKind === "proof" ? "봉사자가 직접 찍은 착샷·사용 인증샷" : "상품 상세페이지 캡처";
      const description = cleanText(
        await callVision(request.image, { 기종: request.model, 사진종류: kindText }, signal),
        RESEARCH_LIMITS.descriptionMax,
        [...known, request.model],
      );
      tally.total = 1;
      tally.kept = description ? 1 : 0;
      return description ? { kind: "photo", ai: "ok", description } : null;
    }
    case "summary": {
      const material = {
        기종: request.model,
        장점: request.pros,
        같이고민한제품: request.alts,
        고민한이유: request.altReason,
        혜택: request.benefits,
        참고: request.refs,
      };
      const json = parseJsonObject(await callAsk("summary", material, signal));
      const text = cleanText(json?.text, RESEARCH_LIMITS.summaryAiMax, [
        ...known,
        request.model,
        request.pros,
        ...request.alts,
        request.altReason,
        request.benefits,
        request.refs,
      ]);
      tally.total = 1;
      tally.kept = text ? 1 : 0;
      return text ? { kind: "summary", ai: "ok", text } : null;
    }
  }
}

/** 이름으로 같은 브랜드를 알아보는 작은 별칭표(시연 품목 고정 후보의 브랜드 거름용). */
const BRAND_ALIASES: Record<string, readonly string[]> = {
  sony: ["소니"],
  소니: ["sony"],
  logitech: ["로지텍"],
  로지텍: ["logitech"],
  tefal: ["테팔"],
  테팔: ["tefal"],
  persil: ["퍼실"],
  퍼실: ["persil"],
};

function sameBrand(name: string, brand: string): boolean {
  const key = brand.trim().toLowerCase();
  const lower = name.toLowerCase();
  return [key, ...(BRAND_ALIASES[key] ?? [])].some((word) => word !== "" && lower.includes(word));
}

/**
 * 요청 문장에서 브랜드를 알아보는 작은 목록. 요청의 brand 칸은 소니 아니면 비어 있어서(parseRequest의 BRANDS는 이용자 흐름과
 * 같이 쓰므로 건드리지 않는다) 'LG 헤드셋'은 brand=null로 저장된다. 고정 후보와 다른 브랜드가 문장에 있으면 후보를 보이지 않기 위한 것이다.
 */
const KNOWN_BRANDS: readonly (readonly string[])[] = [
  ["sony", "소니"],
  ["logitech", "로지텍"],
  ["tefal", "테팔"],
  ["persil", "퍼실"],
  ["lg", "엘지"],
  ["samsung", "삼성"],
  ["apple", "애플"],
  ["bose", "보스"],
  ["jbl"],
  ["sennheiser", "젠하이저"],
  ["philips", "필립스"],
  ["marshall", "마샬"],
  ["xiaomi", "샤오미"],
  ["anker", "앤커"],
  ["dyson", "다이슨"],
  ["cuckoo", "쿠쿠"],
  ["leopold", "레오폴드"],
  ["razer", "레이저"],
  ["panasonic", "파나소닉"],
  // 시연용 고정 후보 표(demoCandidates.ts)의 브랜드. 표에 브랜드를 더하면 여기도 더한다(시험이 빠진 것을 잡는다).
  ["보국", "보국전자"],
  ["일월"],
  ["한일", "한일의료기"],
  ["테크"],
  ["액츠"],
  ["키친아트"],
];

/** 일반 낱말과 겹치는 한글 별칭: 뒤에 이 말이 오면 브랜드가 아니다(레이저 각인 키보드, 레이저 포인터). */
const NOT_BRAND_AFTER: Readonly<Record<string, RegExp>> = {
  레이저: /^\s*(?:로|으로|를|을|의)?\s*(?:각인|포인터|프린터|센서|마우스|커팅|제모|레벨|거리)/,
};

/** 낱말 찾기. 영문은 앞뒤가 영문이 아닌 자리에서, 한글은 앞이 한글이 아닌 자리에서만 찾는다(하이테크 안의 테크, 한일월 안의 일월). */
export function hasBrandWord(text: string, word: string): boolean {
  const lower = text.normalize("NFKC").toLowerCase();
  if (/^[a-z]+$/.test(word)) return new RegExp(`(?<![a-z])${word}(?![a-z])`).test(lower);
  const at = (from: number): boolean => {
    const index = lower.indexOf(word, from);
    if (index < 0) return false;
    const notBrand = NOT_BRAND_AFTER[word]?.test(lower.slice(index + word.length)) ?? false;
    return (!notBrand && (index === 0 || !/[가-힣]/.test(lower[index - 1]!))) || at(index + 1);
  };
  return at(0);
}

/** 이 브랜드 묶음(별칭들)이 문장에 있나. 시험과 후보 걸러내기가 같이 쓴다. */
export function brandGroupIn(text: string, group: readonly string[]): boolean {
  return group.some((word) => hasBrandWord(text, word));
}

/** 알려 둔 브랜드 묶음 가운데 문장에 든 첫 번째. */
export function knownBrandIn(text: string): readonly string[] | null {
  return KNOWN_BRANDS.find((group) => brandGroupIn(text, group)) ?? null;
}

/**
 * 시연 품목이면 고정 후보 표(demoCandidates.ts)를 후보로 쓴다. 기종 후보와 달리 대안 후보는 이미 고른 기종을 뺀다.
 * 요청에 브랜드가 있으면(저장된 brand 또는 요청 문장에서 알아본 브랜드) 그 브랜드의 후보만 쓴다. 다른 브랜드 기종을 보이지 않는다. 없으면 품목의 후보 전부.
 */
function fixedItems(context: ResearchContext, exclude?: string): ResearchItem[] {
  const skip = exclude?.trim().toLowerCase();
  const brand = context.brand?.trim();
  const found = brand ? null : knownBrandIn(context.product);
  return demoCandidatesFor(context.item)
    .filter((candidate) => candidate.name.toLowerCase() !== skip)
    .filter((candidate) => {
      if (brand) return sameBrand(candidate.name, brand);
      if (found) return brandGroupIn(candidate.name, found);
      return true;
    })
    .slice(0, RESEARCH_LIMITS.maxItems)
    .map((candidate) => ({ name: candidate.name, note: RESEARCH_COPY.fixedNote, url: candidate.url, origin: "fixed" }));
}

/** AI가 없거나 실패했을 때의 응답: 기본 문구, 고정 후보, 바로가기. 카드는 이것만으로도 진행된다. */
export function fallbackResponse(request: ResearchRequestBody, context: ResearchContext): ResearchResponse {
  const subject = subjectOf(context);
  switch (request.kind) {
    case "model":
      return { kind: "model", ai: "fallback", items: fixedItems(context) };
    case "alts":
      return { kind: "alts", ai: "fallback", items: fixedItems(context, request.model) };
    case "pros":
      return {
        kind: "pros",
        ai: "fallback",
        question: defaultQuestion("pros", { subject, model: request.model, alts: [] }),
        hints: [],
      };
    case "altReason":
      return {
        kind: "altReason",
        ai: "fallback",
        question: defaultQuestion("altReason", { subject, model: request.model, alts: request.alts }),
        hints: [],
      };
    case "benefits":
      return { kind: "benefits", ai: "fallback", links: [], shortcuts: benefitShortcuts(request.model) };
    case "refs":
      return { kind: "refs", ai: "fallback", digest: [], links: [], shortcuts: refShortcuts(request.model) };
    case "photo":
      return { kind: "photo", ai: "fallback", description: "" };
    case "summary":
      return {
        kind: "summary",
        ai: "fallback",
        text: draftSummaryText(
          { ...emptyResearchState(), model: request.model, pros: request.pros, alts: request.alts, altReason: request.altReason, benefits: request.benefits, refs: request.refs },
          RESEARCH_LIMITS.summaryAiMax,
        ),
      };
  }
}

/**
 * 카드 하나의 AI 도움. 가짜 모드면 고정 응답, 키가 없거나 호출·검사가 실패하면 fallback이다.
 * 던지지 않는다(AI가 실패해도 카드는 진행된다). fallback이면 원인(upstream)을 같이 돌려준다.
 */
export async function answerResearch(
  request: ResearchRequestBody,
  context: ResearchContext,
  signal?: AbortSignal,
): Promise<ResearchOutcome> {
  if (getLlmMode() === "mock") return { body: mockResponse(request), upstream: null };
  if (!hasKey()) return { body: fallbackResponse(request, context), upstream: "nokey" };
  const tally: Tally = { kept: 0, total: 0 };
  try {
    const body = await liveResponse(request, context, signal, tally);
    if (body) return { body, upstream: null };
    return {
      body: fallbackResponse(request, context),
      upstream: "empty",
      detail: `kept=${tally.kept}/${tally.total}`,
    };
  } catch (error) {
    const status = statusOf(error);
    const upstream: Upstream = status ?? (isTimeout(error, signal) ? "timeout" : "none");
    return { body: fallbackResponse(request, context), upstream };
  }
}
