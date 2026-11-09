// ③④⑤⑥ 봉사자 화면이 함께 쓰는 요청 모양. TSD §8.2.
// 11/9 밤에는 화면에 아직 붙이지 않는다(블록 5, TSD:455). 시연 이어 보기(lh.match.v1)만 바꿀 수 있다.

import type { MatchResponse } from "@/lib/matchHandoff";
import type { ChatContext, ConditionKind } from "@/lib/prompt";

export type VolunteerRequestView = {
  requestId: string;
  /** 시연 어댑터면 null. */
  queueNumber: number | null;
  /** 이용자 답 원문(≤200자). 화면에만 표시. */
  product: string;
  /** parseRequest 결과. */
  brand: string | null;
  /** parseRequest 결과(필수). */
  item: string;
  /** 이용자 답 원문. 화면에만 표시, LLM에 넘기지 않음. */
  budget: string | null;
  /** 이용자 답 원문. */
  condition: string | null;
  /** 서버가 정규화. */
  conditionKind: ConditionKind | null;
  /** 10분 지표 시작. */
  claimedAt: string | null;
};

/** `lh.match.v1`의 `{brand, item, raw}`를 공용 모양으로 바꾼다(TSD:254). */
export function fromMatchV1(match: MatchResponse): VolunteerRequestView {
  return {
    requestId: match.requestId,
    queueNumber: null,
    product: match.request.raw,
    brand: match.request.brand,
    item: match.request.item,
    budget: null,
    condition: null,
    conditionKind: null,
    claimedAt: null,
  };
}

/**
 * 챗봇 맥락. 예산은 있는지만 넘기고 원문은 넘기지 않는다(TSD §8.6).
 * 값이 없으면 키를 만들지 않아 v1 요청과 같은 모양이 된다.
 */
export function chatContextFor(view: VolunteerRequestView): ChatContext {
  const context: ChatContext = { brand: view.brand, item: view.item };
  if (view.budget !== null && view.budget.trim().length > 0) {
    context.hasBudget = true;
  }
  if (view.conditionKind !== null) context.condition = view.conditionKind;
  return context;
}
