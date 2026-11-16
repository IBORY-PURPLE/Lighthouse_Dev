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
