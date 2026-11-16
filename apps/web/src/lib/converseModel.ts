import "server-only";
import { forbiddenClaims } from "@/lib/answerRules";
import {
  CONVERSE_STATUSES,
  MAX_REPLY_LENGTH,
  type ChatTurn,
  type ConverseResult,
  type ConverseStatus,
} from "@/lib/converse";
import { parseRequest } from "@/lib/parseRequest";
import { parseJsonObject } from "@/lib/researchAi";

// 모델이 낸 한 턴을 믿을 수 있는 응답으로 바꾼다. 못 믿겠으면 실패로 돌려보내 기본 질문으로 가게 한다.

/** 접수(/api/requests)의 답 상한과 같다. */
const MAX_FIELD_LENGTH = 200;
const DEFAULT_BUDGET = "정하지 않음";
const DEFAULT_CONDITION = "상관없음";
/** 접수가 받는 품목이 헤드셋뿐이라(parseRequest), 다른 상품이면 접수 전에 되묻는다. */
export const NEED_HEADSET_REPLY =
  "지금은 헤드셋 요청만 받을 수 있습니다. 헤드셋을 찾으시나요?";

export type TurnVerdict =
  | { ok: true; result: ConverseResult }
  /** format: 모양이 틀림, guard: 금지 표현, premature: 확인 질문 없이 done. */
  | { ok: false; reason: "format" | "guard" | "premature" };

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

const squash = (value: string) => value.replace(/\s+/g, "");

/** 이용자가 한 말에 없는 금액·재고 단정·모델명이 있으면 true. 이용자가 말한 예산은 되풀이해도 된다. */
function inventsClaim(candidates: string[], turns: ChatTurn[]): boolean {
  const said = squash(
    turns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content)
      .join("\n"),
  );
  return candidates
    .flatMap((candidate) => forbiddenClaims(candidate))
    .some((violation) => !said.includes(squash(violation.detail)));
}

export function interpretTurn(raw: string, turns: ChatTurn[]): TurnVerdict {
  const body = parseJsonObject(raw);
  const reply = text(body?.reply);
  const status = body?.status;
  if (
    !body ||
    !reply ||
    reply.length > MAX_REPLY_LENGTH ||
    !CONVERSE_STATUSES.includes(status as ConverseStatus)
  ) {
    return { ok: false, reason: "format" };
  }

  const product = text(body.product) ?? "";
  const budget = text(body.budget) ?? "";
  const condition = text(body.condition) ?? "";
  if ([product, budget, condition].some((field) => field.length > MAX_FIELD_LENGTH)) {
    return { ok: false, reason: "format" };
  }
  if (inventsClaim([reply, product, budget, condition], turns)) {
    return { ok: false, reason: "guard" };
  }

  if (status !== "done") return { ok: true, result: { reply, status: status as ConverseStatus } };

  // 동의 전에는 등록하지 않는다: 바로 앞 AI 문장이 등록 확인 질문이어야 한다.
  const lastAi = turns.filter((turn) => turn.role === "assistant").at(-1);
  if (!lastAi || !lastAi.content.includes("등록")) {
    return { ok: false, reason: "premature" };
  }
  if (!product) return { ok: false, reason: "format" };
  if (!parseRequest(product).item) {
    return { ok: true, result: { reply: NEED_HEADSET_REPLY, status: "asking" } };
  }
  return {
    ok: true,
    result: {
      reply,
      status: "done",
      request: {
        product,
        budget: budget || DEFAULT_BUDGET,
        condition: condition || DEFAULT_CONDITION,
      },
    },
  };
}
