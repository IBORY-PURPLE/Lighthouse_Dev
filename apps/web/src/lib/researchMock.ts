import "server-only";
import {
  benefitShortcuts,
  refShortcuts,
  withEulReul,
  type ResearchItem,
  type ResearchLink,
  type ResearchRequestBody,
  type ResearchResponse,
} from "./research";
import { SLOT_KEYS, type SlotKey } from "./researchSession";
import type { TurnMaterial } from "./researchTurnPrompt";

// 가짜 모드(LLM_MODE=mock, 운영에서는 무시)의 카드별 고정 응답. 화면 시험이 이 글자를 기대한다.
// 모든 주소는 example.com이고, 바로가기만 실제 검색 주소다.

const NOTE = "시험용 가짜 후보예요. 확인이 필요해요.";
const mockItem = (name: string, slug: string): ResearchItem => ({
  name,
  note: NOTE,
  url: `https://example.com/mock/${slug}`,
  origin: "web",
});
const mockLink = (title: string, slug: string): ResearchLink => ({
  title,
  url: `https://example.com/mock/${slug}`,
  origin: "web",
});

export const MOCK_MODEL_ITEMS: readonly ResearchItem[] = [
  mockItem("가짜 헤드셋 LH-200", "lh-200"),
  mockItem("가짜 헤드셋 LH-300", "lh-300"),
  mockItem("가짜 헤드셋 LH-400", "lh-400"),
];
export const MOCK_ALT_ITEMS: readonly ResearchItem[] = [
  mockItem("가짜 헤드셋 LH-500", "lh-500"),
  mockItem("가짜 헤드셋 LH-600", "lh-600"),
];
export const MOCK_PROS_HINTS = [
  "착용감은 어땠나요?",
  "소리나 배터리는 어땠나요?",
  "버튼이나 조작은 손으로 찾기 쉬웠나요?",
] as const;
export const MOCK_ALT_REASON_HINTS = ["어떤 점이 더 좋아 보였나요?", "어떤 점이 아쉬웠나요?"] as const;
export const MOCK_BENEFIT_LINKS: readonly ResearchLink[] = [
  mockLink("가짜 혜택 안내 페이지", "benefit-1"),
  mockLink("가짜 카드 혜택 페이지", "benefit-2"),
];
export const MOCK_REF_DIGEST = ["가짜 블로그 글에서 읽은 내용이에요.", "착용감이 편하다는 이야기가 많아요."] as const;
export const MOCK_REF_LINKS: readonly ResearchLink[] = [
  mockLink("가짜 후기 블로그", "review-1"),
  mockLink("가짜 후기 영상", "review-2"),
];
export const MOCK_PHOTO_DESCRIPTION = "제품이 책상 위에 놓여 있어요. 시험용 가짜 설명이에요.";
export const MOCK_SUMMARY_TEXT = "시험용 가짜 핵심 정리예요.\n장점과 고민한 이유를 확인해 주세요.";

export function mockResponse(request: ResearchRequestBody): ResearchResponse {
  switch (request.kind) {
    case "model":
      return { kind: "model", ai: "ok", items: MOCK_MODEL_ITEMS.map((item) => ({ ...item })) };
    case "alts":
      return { kind: "alts", ai: "ok", items: MOCK_ALT_ITEMS.map((item) => ({ ...item })) };
    case "pros":
      return {
        kind: "pros",
        ai: "ok",
        question: `${request.model}의 장점을 알려 주세요. 어떤 점이 좋았나요?`,
        hints: [...MOCK_PROS_HINTS],
      };
    case "altReason":
      return {
        kind: "altReason",
        ai: "ok",
        question: `${withEulReul(request.alts.join(", "))} 왜 같이 고민했는지 알려 주세요.`,
        hints: [...MOCK_ALT_REASON_HINTS],
      };
    case "benefits":
      return {
        kind: "benefits",
        ai: "ok",
        links: MOCK_BENEFIT_LINKS.map((link) => ({ ...link })),
        shortcuts: benefitShortcuts(request.model),
      };
    case "refs":
      return {
        kind: "refs",
        ai: "ok",
        digest: [...MOCK_REF_DIGEST],
        links: MOCK_REF_LINKS.map((link) => ({ ...link })),
        shortcuts: refShortcuts(request.model),
      };
    case "photo":
      return { kind: "photo", ai: "ok", description: MOCK_PHOTO_DESCRIPTION };
    case "summary":
      return { kind: "summary", ai: "ok", text: MOCK_SUMMARY_TEXT };
  }
}

// ---- 대화 턴(design.md 4.3) ---------------------------------------------------------

const MODEL_WORD = /[A-Za-z]{1,6}-?[A-Za-z]*\d{2,}[A-Za-z0-9-]*/;
const BOUGHT_WORD = /샀|샀어|구매했|구입했|쓰고 있|사용 중|써요|쓰는 중/;
const RESEARCH_WORD = /알아보|리서치|구매하지|안 샀|사지 않|아직 안/;
const BENEFIT_WORD = /할인|혜택|쿠폰|포인트|적립|사은품|카드|프로모션|이벤트/;
const ASKING = /[?？]|알려\s?줘|알려\s?주세요|어디서|어떻게/;
const clipText = (value: string, max: number) => [...value].slice(0, max).join("");

/**
 * 가짜 모드(LLM_MODE=mock)의 턴 응답 JSON 글. 봉사자 말을 그대로 옮겨 채우므로 evidence 검사를 통과한다.
 * - 구매가 unset이면 말에서 구매 여부(와 기종 번호)를 읽는다. 혜택 말이 같이 있으면 혜택 칸도 채운다(앞질러 답하는 경우).
 * - 직전 질문 칸이 있으면 그 칸에 말을 그대로 채운다. 묻는 말이면 찾는 방법만 준다.
 */
export function mockTurnJson(material: TurnMaterial): string {
  const text = material.봉사자말.trim();
  const evidence = clipText(text, 80);
  const fills: { slot: SlotKey; value: string; evidence: string }[] = [];
  let purchase: { value: "bought" | "research"; evidence: string } | undefined;

  if (material.구매 === "unset") {
    if (RESEARCH_WORD.test(text)) purchase = { value: "research", evidence };
    else if (BOUGHT_WORD.test(text)) purchase = { value: "bought", evidence };
    const model = MODEL_WORD.exec(text)?.[0];
    if (purchase && model) fills.push({ slot: "model", value: model, evidence });
    if (purchase && BENEFIT_WORD.test(text)) fills.push({ slot: "benefits", value: clipText(text, 120), evidence });
    return JSON.stringify({ intent: "reply", fills, ...(purchase ? { purchase } : {}), reason: "가짜 응답" });
  }

  if (ASKING.test(text)) {
    return JSON.stringify({
      intent: "ask_back",
      fills: [],
      guide: {
        queries: ["가짜 검색어"],
        checks: ["기종 이름이 같은지"],
        steps: ["공식 페이지를 연다"],
      },
      reason: "가짜 응답",
    });
  }

  const last = material.직전질문칸;
  const slot = SLOT_KEYS.find((key) => key === last && key !== "photo");
  if (slot && text.length > 0) fills.push({ slot, value: clipText(text, 120), evidence });
  return JSON.stringify({ intent: "reply", fills, reason: "가짜 응답" });
}
