import "server-only";
import { COMMON, materialMessage } from "./researchPrompt";
import {
  isAskable,
  isFilled,
  questionOrder,
  SLOT_KEYS,
  type Purchase,
  type ResearchView,
  type SlotKey,
} from "./researchSession";

// 대화형 리서치 챗의 턴 지시문(design.md 4.2~4.3). 서버 전용이라 화면은 이 글을 보지도 바꾸지도 못한다.
// AI는 봉사자 말에서 칸을 채우고 다음에 물을 칸을 고른다. 최종 판단과 질문 순서는 서버가 다시 정한다.

const TURN = [
  "이 단계에서 할 일: 봉사자와 대화하며 구매경험 리서치 칸을 채운다. 자료의 '봉사자말'을 읽고, 칸 채우기와 다음 행동을 JSON으로 정한다.",
  "",
  "칸(slot) 정의",
  "- model: 기종 이름 하나(예: WH-CH720N). 봉사자가 말한 이름 그대로 쓴다.",
  "- pros: 써 본 느낌이나 장점 한 가지 이상.",
  "- alts: 같이 고민한 다른 제품 이름. 한 번에 이름 하나씩, 최대 2개.",
  "- altReason: 그 제품(대안이 없으면 이 기종)을 고른 근거 한 가지.",
  "- benefits: 살 때 받은 혜택 경험 한 줄. '없었어요'도 답이다.",
  "- refs: 참고한 링크나 글 한 줄.",
  "- photo 칸은 서버가 사진으로만 채운다. fills에 쓰지 않는다.",
  "",
  "규칙",
  "- fills: 봉사자가 말한 것만 칸에 옮긴다. value는 봉사자 말에서 가져온 120자 이내 구절이다. evidence는 value의 근거가 되는 봉사자 말의 한 구절(80자 이내)이고, 봉사자 말에 있는 글자를 그대로 옮긴다. 한 번에 4칸까지.",
  "- 봉사자가 말하지 않은 칸은 채우지 않는다. 짐작하거나 지어내지 않는다.",
  "- 봉사자가 AI에게 묻는 말(예: '어디서 찾아요?', '가격 알려줘', '재고 있어?')이면 칸을 채우지 말고 intent를 ask_back으로 한다. 이때 guide로 '찾는 방법'만 준다. 가격과 재고에는 답하지 않는다(쇼핑몰에 접속하지 않으므로 모른다).",
  "- purchase: 봉사자가 직접 샀다·갖고 있다·쓰고 있다고 말하면 bought, 알아보기만 했다·사지 않았다고 말하면 research다. 어느 쪽인지 말에서 알 수 없으면 쓰지 않는다. 자료의 구매가 unset일 때만 의미가 있다. evidence는 fills와 같다(예: '쓰고 있어요'도 구매한 것으로 본다).",
  "- intent: reply(칸에 답함), ask_back(AI에게 물음), show_review(리뷰를 만들자고 함), skip(건너뛰자고 함), other(그 밖).",
  "- next: 다음에 물을 칸. action은 ask_slot(slot에 자료 '빈칸' 중 하나, text에 질문 한두 문장 120자 이내), reask(직전 질문 칸을 한 번 더), propose_review(빈칸이 없을 때). 이미 찬 칸과 건너뛴 칸은 묻지 않는다. 질문은 해요체로 쓰고 가격과 재고를 묻지 않는다.",
  "- guide는 ask_back일 때만 쓴다: queries(검색어 1~3개, 40자 이내), checks(확인할 조건 1~3개, 60자 이내), steps(찾는 순서 1~3개, 60자 이내). 가격·재고·할인·순위는 쓰지 않는다.",
  "- 기종 이름과 모델 번호는 자료(요청, 봉사자말, 보인후보, 채운칸)에 있는 것만 쓴다. 자료에 없는 기종을 지어내거나 추천하지 않는다.",
  "- reason은 판단 이유 한 줄(80자 이내)이다.",
  "",
  '출력 모양: {"intent":"reply|ask_back|show_review|skip|other","fills":[{"slot":"model|pros|alts|altReason|benefits|refs","value":"...","evidence":"..."}],"purchase":{"value":"bought|research","evidence":"..."},"guide":{"queries":["..."],"checks":["..."],"steps":["..."]},"next":{"action":"ask_slot|reask|propose_review","slot":"칸 이름 또는 null","text":"..."},"reason":"..."}',
  "- purchase, guide, next는 해당 없으면 생략한다. fills는 없으면 빈 배열이다.",
  "",
  "예시 1) 자료: 구매 unset, 봉사자말 \"WH-CH720N 샀어요. 가벼워서 좋아요\"",
  '{"intent":"reply","fills":[{"slot":"model","value":"WH-CH720N","evidence":"WH-CH720N 샀어요"},{"slot":"pros","value":"가벼워서 좋아요","evidence":"가벼워서 좋아요"}],"purchase":{"value":"bought","evidence":"WH-CH720N 샀어요"},"next":{"action":"ask_slot","slot":"altReason","text":"WH-CH720N을 고른 이유가 뭐예요?"},"reason":"기종과 장점을 말함"}',
  "예시 2) 자료: 직전질문칸 model, 봉사자말 \"소니 헤드셋은 어디서 찾아요? 가격도 알려줘\"",
  '{"intent":"ask_back","fills":[],"guide":{"queries":["소니 헤드셋","소니 헤드셋 후기"],"checks":["기종 이름이 같은지","구성품과 사용 방법"],"steps":["공식 페이지를 연다","상세 페이지를 읽는다","후기를 2~3개 비교한다"]},"reason":"찾는 방법을 물음"}',
].join("\n");

export const turnInstructions = (): string => `${COMMON}\n\n${TURN}`;

/** 모델에 주는 자료(키는 한글이라 모델이 읽기 쉽다). */
export interface TurnMaterial {
  요청: { 문장: string; 브랜드: string | null; 품목: string | null };
  구매: Purchase;
  채운칸: Partial<Record<SlotKey, string>>;
  /** 아직 비어 있고 물을 수 있는 칸(질문 순서). */
  빈칸: SlotKey[];
  /** 서버가 직전에 물은 칸. 구매 질문이나 리뷰 제안이면 그 이름. */
  직전질문칸: string | null;
  보인후보: string[];
  봉사자말: string;
}

export interface TurnMaterialInput {
  session: Pick<ResearchView, "purchase" | "slots" | "extras" | "counters" | "pending">;
  context: { product: string; brand: string | null; item: string | null };
  text: string;
}

export function shownNames(pending: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["shownModels", "shownAlts"]) {
    const value = pending[key];
    if (Array.isArray(value)) out.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  return out;
}

export function buildTurnMaterial({ session, context, text }: TurnMaterialInput): TurnMaterial {
  const filled: Partial<Record<SlotKey, string>> = {};
  for (const key of SLOT_KEYS) {
    if (isFilled(session.slots, key)) filled[key] = session.slots[key]?.value ?? "";
  }
  const last = session.pending.lastQuestion?.slot ?? null;
  return {
    요청: { 문장: context.product, 브랜드: context.brand, 품목: context.item },
    구매: session.purchase,
    채운칸: filled,
    빈칸: questionOrder(session.purchase).filter((key) => key !== "photo" && isAskable(session, key)),
    직전질문칸: typeof last === "string" ? last : null,
    보인후보: shownNames(session.pending),
    봉사자말: text,
  };
}

export const turnMessage = (material: TurnMaterial): string =>
  materialMessage("봉사자의 말을 읽고 출력 모양대로 답한다.", material as unknown as Record<string, unknown>);
