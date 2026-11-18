import { defaultQuestion, withEulReul } from "./research";
import type { Purchase, SlotKey } from "./researchSession";

// 대화형 리서치 챗의 서버 문장(design.md 4.6). AI가 아니라 서버가 만드는 글이다.
// 모든 상수는 hasForbidden 0건이어야 한다(tests/unit/researchTurn.test.ts가 확인한다).

export const PURCHASE_QUESTION = "이 제품을 직접 구매하셨나요, 알아보기만 하셨나요?";
export const MODEL_QUESTION_BOUGHT =
  "좋아요. 어떤 기종을 쓰고 계세요? 웹에서 찾은 후보를 골라도 되고, 직접 적어도 돼요.";
export const MODEL_QUESTION_RESEARCH =
  "좋아요. 어떤 기종을 알아보셨어요? 웹에서 찾은 후보를 골라도 되고, 직접 적어도 돼요.";
export const PHOTO_QUESTION = "구매 인증에 쓸 사진을 올려 주세요. 착용한 사진이나 실제 가지고 있는 모습이면 돼요.";
export const BENEFITS_QUESTION =
  "살 때 받은 혜택이 있었어요? 카드 할인, 무료 배송, 쿠폰처럼 말해 주세요. 그걸 바탕으로 지금 받을 수 있는 혜택을 찾아볼게요.";
export const REFS_QUESTION =
  "참고한 블로그 글이나 영상이 있으면 링크나 한 줄로 알려 주세요. 없으면 건너뛰어도 돼요.";
export const REVIEW_PROPOSAL = "모은 정보로 이용자에게 보낼 리뷰를 만들어 볼까요?";
export const CAP_REQUEST = "이 요청의 AI 도움 횟수를 다 써서 기본 질문으로 이어 갈게요.";
export const CAP_DAILY = "오늘 AI 사용 한도에 닿아 기본 질문으로 이어 갈게요.";
export const FALLBACK_NOTICE = "AI 도움을 받지 못해 기본 질문으로 이어 갈게요. 답을 적으면 넣을지 먼저 물어볼게요.";
export const REQUIRED_SKIP = "이 칸은 꼭 필요해서 건너뛸 수 없어요. 한 줄만 적어 주세요.";
export const CONFIRM_FILL = "이렇게 적어도 될까요?";
export const PENDING_NOTICE = "먼저 위에서 물어본 내용을 확인해 주세요.";
export const REASK_PREFIX = "한 번만 더 알려 주세요. ";
export const REVIEW_MORE = "좋아요. 더 알려 주실 내용을 적어 주세요. 칸은 오른쪽 패널에서 고칠 수도 있어요.";
export const PURCHASE_FIXED = "구매 여부는 이미 정해졌어요.";
/** 구매 여부를 정한 직후, 기종 질문 앞에 놓는 표시 메시지 글. 이용자가 말한 내용은 넣지 않는다(보낸 대화 기록이 봉사자 기기에 글로 남는다). */
export const BRIEF_NOTE = "기종을 묻기 전에 이용자가 말한 요청을 하나씩 확인해요.";
export const NO_CONFIRM = "확인할 내용이 없어요.";
export const LINK_NOTE = "AI가 열 수 없는 주소라 직접 확인이 필요해요. 확인했으면 눌러 주세요.";
export const LINK_FULL = "확인을 기다리는 링크가 5개예요. 앞의 링크 카드에서 [확인했어요]를 눌러 주세요.";
export const LINK_CHECKED = "참고 글 링크를 확인한 것으로 적었어요.";
export const MODEL_CHIPS_CAPTION = (count: number) => `AI 제안 · 웹에서 찾은 후보 ${count}개. 확인이 필요해요.`;
export const MODEL_CHIPS_FALLBACK = (count: number) =>
  `AI가 아닌 고정 후보 ${count}개예요. 쇼핑몰에서 직접 확인해 주세요.`;
export const MODEL_CHIPS_EMPTY = "후보를 찾지 못했어요. 아래 쇼핑몰에서 직접 찾거나 기종을 적어 주세요.";
export const MODEL_CHIPS_INTRO = "찾은 기종 후보예요. 하나를 고르거나 직접 적어 주세요.";
export const OWN_LABEL = "직접 적을게요";

/** 칸 이름(말풍선 문장용). */
export const SLOT_NAME: Record<SlotKey, string> = {
  model: "기종",
  pros: "장점",
  photo: "사진",
  alts: "같이 고민한 제품",
  altReason: "고른 이유",
  benefits: "혜택",
  refs: "참고 글",
};

export interface QuickButton {
  id: string;
  label: string;
  tone?: "primary" | "normal";
  action?: "turn" | "review_make";
}

export const PURCHASE_QUICK: QuickButton[] = [
  { id: "purchase.bought", label: "구매했어요", tone: "primary" },
  { id: "purchase.research", label: "구매하지 않았어요 · 리서치만" },
];
/** 사진 확인 필요(shotCheck·mismatch) 때의 빠른 답. */
export const PHOTO_CHECK_QUICK: QuickButton[] = [
  { id: "photo.yes", label: "직접 찍은 사진이 맞아요", tone: "primary" },
  { id: "photo.retake", label: "다른 사진 올릴게요" },
];
export const PHOTO_CONFIRMED = "확인했어요. 직접 찍은 사진으로 구매 인증에 넣을게요.";
export const PHOTO_RETAKE = "사진 아래 [사진 지우기]를 누른 뒤 새 사진을 올려 주세요. 휴대폰으로 바로 찍어 올려도 돼요.";
export const CONFIRM_QUICK: QuickButton[] = [
  { id: "confirm.yes", label: "넣기", tone: "primary" },
  { id: "confirm.no", label: "아니요" },
];
export const REVIEW_QUICK: QuickButton[] = [
  { id: "review.make", label: "리뷰 만들기", tone: "primary", action: "review_make" },
  { id: "review.more", label: "더 답할게요" },
];

/** 선택 칸의 건너뛰기 버튼(quick 응답 skip.<칸>은 skip 입력과 같다). */
export const SKIP_LABEL: Partial<Record<SlotKey, string>> = {
  alts: "같이 고민한 제품 없어요",
  benefits: "혜택은 없었어요",
  refs: "건너뛰기",
};

export const SKIPPABLE: readonly SlotKey[] = ["alts", "benefits", "refs"];

export interface QuestionContext {
  purchase: Purchase;
  /** 요청의 브랜드+품목(searchQueryOf). */
  subject: string;
  model: string;
  alts: readonly string[];
}

/** 칸 질문. defaultQuestion을 감싸고, 대화에 맞게 바꾼 질문만 따로 둔다. 모두 120자 이하다. */
export function turnQuestion(slot: SlotKey, context: QuestionContext): string {
  const model = context.model.trim();
  switch (slot) {
    case "model":
      return context.purchase === "research" ? MODEL_QUESTION_RESEARCH : MODEL_QUESTION_BOUGHT;
    case "photo":
      return PHOTO_QUESTION;
    case "benefits":
      return BENEFITS_QUESTION;
    case "refs":
      return REFS_QUESTION;
    case "altReason":
      // 대안이 없으면 이 기종을 고른 이유를 묻는다.
      if (context.alts.length === 0) return `${withEulReul(model || "이 제품")} 고른 이유가 뭐예요?`;
      return defaultQuestion("altReason", { subject: context.subject, model, alts: context.alts });
    default:
      return defaultQuestion(slot, { subject: context.subject, model, alts: context.alts });
  }
}

/** 질문 말풍선의 빠른 답 버튼. 선택 칸에만 건너뛰기가 있다. */
export function questionQuick(slot: SlotKey): QuickButton[] | undefined {
  const label = SKIP_LABEL[slot];
  return label ? [{ id: `skip.${slot}`, label }] : undefined;
}
