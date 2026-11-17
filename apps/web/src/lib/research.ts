import { searchQueryOf, shopSearchUrl } from "./shopLinks";

// 봉사자 리서치 챗의 AI 도움이 쓰는 공용 코드(서버와 시험이 함께 쓴다. server-only가 아니다).
// 대화 상태·질문 순서는 researchSession.ts, 화면 규칙은 researchChatView.ts다. 카드형 화면의 상태·저장 코드는 지웠다.

// ---- 질문 문구 ---------------------------------------------------------------------

/** 질문 칸 이름(기본 질문을 고를 때 쓴다). */
export type CardId = "model" | "pros" | "photo" | "alts" | "altReason" | "benefits" | "refs";

export const RESEARCH_LIMITS = {
  /** 후보·제품 이름(결과 name 한도와 같다). */
  nameMax: 100,
  /** 화면 글 칸 한도. 결과 요약 값 한도(200)와 같아 보낼 때 잘리지 않는다. */
  answerMax: 200,
  /** 서버가 받아 주는 글 한 칸의 상한(자료로만 쓴다). */
  answerInputMax: 1000,
  maxAlts: 2,
  maxPhotos: 3,
  descriptionMax: 200,
  /** AI가 만드는 핵심 정리의 상한. 봉사자가 고친 글은 결과 가이드 한도(1000)까지. */
  summaryAiMax: 600,
  summaryEditMax: 1000,
  maxItems: 5,
  maxLinks: 4,
  maxHints: 3,
  maxDigest: 4,
  questionMax: 120,
  hintMax: 80,
  noteMax: 80,
  digestMax: 120,
  /** 썸네일 데이터 주소의 길이 상한(localStorage 보호). */
  thumbMax: 60_000,
  /** 서버가 받는 사진 한 장의 상한(디코드 후 바이트). 화면 축소와 서버 검사가 이 값 하나를 쓴다. */
  imageMaxBytes: 1.5 * 1024 * 1024,
} as const;

/** 시연용 고정 후보에 붙는 꼬리표. */
export const RESEARCH_COPY = { fixedNote: "시연용 고정 후보" } as const;

// ---- 한국어 조사·질문 문구 -----------------------------------------------------

/** 마지막 글자가 한글이면 받침으로 을/를을 고르고, 아니면(영문·숫자) "을(를)"로 쓴다. */
export function withEulReul(word: string): string {
  const text = word.trim();
  const code = [...text].pop()?.charCodeAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return `${text}${(code - 0xac00) % 28 === 0 ? "를" : "을"}`;
  return `${text}을(를)`;
}

export interface QuestionContext {
  /** 요청의 "브랜드+품목"(searchQueryOf). */
  subject: string;
  model: string;
  alts: readonly string[];
}

/** 카드의 기본 질문(AI 질문이 없거나 실패했을 때, 그리고 AI 질문의 바탕). */
export function defaultQuestion(id: CardId, context: QuestionContext): string {
  const model = context.model.trim() || "이 제품";
  switch (id) {
    case "model":
      return `${context.subject.trim() || "제품"} 기종을 찾아 주세요.`;
    case "pros":
      return `${model}의 장점이 뭐예요?`;
    case "photo":
      return "제품 사진을 올려 주세요.";
    case "alts":
      return `${withEulReul(model)} 살 때 같이 고민한 다른 제품이 있나요?`;
    case "altReason": {
      const names = context.alts.join(", ") || "다른 제품";
      return `${withEulReul(names)} 왜 같이 고민했나요?`;
    }
    case "benefits":
      return "살 때 받은 혜택이 있나요?";
    case "refs":
      return "참고한 유튜브나 블로그 글이 있나요?";
  }
}

// ---- 서버 요청·응답 타입 ----------------------------------------------------------

export type ResearchKind = "model" | "pros" | "alts" | "altReason" | "benefits" | "refs" | "photo" | "summary";

export type ResearchRequestBody =
  | { requestId: string; kind: "model" }
  | { requestId: string; kind: "pros" | "alts" | "benefits" | "refs"; model: string }
  | { requestId: string; kind: "altReason"; model: string; alts: string[] }
  | { requestId: string; kind: "photo"; model: string; photoKind: "proof" | "detail"; image: string }
  | {
      requestId: string;
      kind: "summary";
      model: string;
      pros: string;
      alts: string[];
      altReason: string;
      benefits: string;
      refs: string;
    };

export type ResearchAi = "ok" | "fallback";

export interface ResearchItem {
  name: string;
  note: string;
  url: string | null;
  /** web: 웹 검색 결과(출처 주소 있음) / fixed: 시연용 고정 후보. */
  origin: "web" | "fixed";
}

export interface ResearchLink {
  title: string;
  url: string;
  origin: "web";
}

export interface ResearchShortcut {
  label: string;
  url: string;
}

export type ResearchResponse =
  | { kind: "model" | "alts"; ai: ResearchAi; items: ResearchItem[] }
  | { kind: "pros" | "altReason"; ai: ResearchAi; question: string; hints: string[] }
  | { kind: "benefits"; ai: ResearchAi; links: ResearchLink[]; shortcuts: ResearchShortcut[] }
  | { kind: "refs"; ai: ResearchAi; digest: string[]; links: ResearchLink[]; shortcuts: ResearchShortcut[] }
  | { kind: "photo"; ai: ResearchAi; description: string }
  | { kind: "summary"; ai: ResearchAi; text: string };

// ---- 바로가기·링크 ---------------------------------------------------------------

const shopShortcut = (shop: "coupang" | "11st" | "gmarket", label: string, query: string): ResearchShortcut => ({
  label,
  url: shopSearchUrl(shop, query),
});

/** 혜택 카드의 쇼핑몰 검색 바로가기(항상 보인다). */
export function benefitShortcuts(query: string): ResearchShortcut[] {
  return [
    shopShortcut("coupang", "쿠팡에서 찾기", query),
    shopShortcut("11st", "11번가에서 찾기", query),
    shopShortcut("gmarket", "G마켓에서 찾기", query),
  ];
}

/** 참고 글 카드의 블로그·유튜브 검색 바로가기(항상 보인다). */
export function refShortcuts(query: string): ResearchShortcut[] {
  const text = `${query} 후기`.trim();
  return [
    {
      label: "네이버 블로그에서 찾기",
      url: `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(text)}`,
    },
    {
      label: "유튜브에서 찾기",
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(text)}`,
    },
  ];
}

/** 요청의 브랜드·품목(없으면 요청 문장)을 잇는다. 기종이 정해지기 전의 검색어. */
export const subjectOf = searchQueryOf;

/** 링크 줄에 보일 사이트 이름(주소의 도메인, www. 제외). 주소가 아니면 빈 글자. */
export function siteNameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

// ---- 핵심 정리 기본 글 -----------------------------------------------------------

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const lineOf = (label: string, value: string) => {
  const text = oneLine(value);
  return text === "" ? null : `${label}: ${text}`;
};

/**
 * 답을 그대로 이은 핵심 정리 기본 글. AI 정리가 없거나 실패했을 때, 그리고 봉사자가 비워 둔 채 보낼 때 쓴다.
 * 봉사자가 쓴 말만 담고 새 정보를 더하지 않는다.
 */
export interface SummaryInput {
  model: string;
  pros: string;
  alts: readonly string[];
  altReason: string;
  benefits: string;
  refs: string;
}

export function draftSummaryText(state: SummaryInput, max: number = RESEARCH_LIMITS.summaryEditMax): string {
  const lines = [
    lineOf("추천 기종", state.model),
    lineOf("장점", state.pros),
    lineOf("같이 고민한 제품", state.alts.join(", ")),
    lineOf("고민한 이유", state.altReason),
    lineOf("혜택", state.benefits),
    lineOf("참고", state.refs),
  ].filter((line): line is string => line !== null);
  const text = lines.join("\n");
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** href에 넣어도 되는 주소: https로 시작하고 주소로 읽힌다. http, javascript:, data: 는 받지 않는다. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^https:\/\//i.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}