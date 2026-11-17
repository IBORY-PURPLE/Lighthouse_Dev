import "server-only";
import OpenAI from "openai";
import { openAiLog } from "./openaiLog";
import { getLlmMode, LLM_MODEL } from "./llm";
import { parseJsonObject, type Upstream } from "./researchAi";
import { cleanText, clip, hasForbidden, unknownModelTokens, urlKey } from "./researchCheck";
import { COMMON, materialMessage } from "./researchPrompt";
import { purchaseBadge, type ResearchView, type SlotKey } from "./researchSession";

// 검증 리뷰(design.md 4.11): 봉사자가 모은 칸으로 이용자가 VoiceOver로 듣는 한 문단을 만든다.
// AI 한 번(요청당 3번 상한, 호출 전 begin이 센다) → 검사 → 실패하면 서버 틀 문단. 봉사자가 고친 문단도 같은 검사로 거른다(길이만 다르다).
// 글·사진·ID·주소는 로그에 남기지 않는다.

/** 봉사자가 고칠 때의 글자 수 범위(design.md 3.2). AI 문단은 아래 AI_* 범위를 따른다. */
export const REVIEW_EDIT_MIN = 50;
export const REVIEW_EDIT_MAX = 1000;
const AI_MIN = 150;
const AI_MAX = 700;
const SENTENCES_MIN = 3;
const SENTENCES_MAX = 7;
const FACT_MAX = 120;
// design.md 4.11은 15초·1,200토큰이지만, 한국어 문단 한 번이 느릴 때가 있어 25초·1,500토큰으로 둔다(요청 전체는 라우트의 50초 안).
const REVIEW_TIMEOUT_MS = 25_000;

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const charCount = (value: string) => [...value].length;

// ---------- 자료 ----------

export interface ConfirmedBenefit {
  kind: string;
  condition: string;
}

/** 모델에 주는 자료(키는 한글이라 모델이 읽기 쉽다). 값은 모두 서버가 거른 글이다. */
export interface ReviewMaterial {
  요청: { 문장: string; 브랜드: string | null; 품목: string | null };
  구매: "구매 인증됨" | "구매했지만 사진 없음" | "리서치만";
  기종: string;
  장점: string;
  같이고민한제품: string[];
  고른이유: string;
  혜택경험: string;
  확인한혜택: ConfirmedBenefit[];
  사진장수: number;
}

export interface ReviewSource {
  view: Pick<ResearchView, "purchase" | "slots" | "pending" | "photos" | "messages" | "extras">;
  context: { product: string; brand: string | null; item: string | null };
}

const URL_TOKEN = /https?:\/\/\S+|www\.\S+/gi;
// 문단에 넣지 않는 것: 주소 모양(도메인 이름 포함)과 마크다운·목록 기호. 칸 값을 쓰기 전에 이것도 뺀다(틀 문단이 검사에 걸리지 않게).
const BARE_DOMAIN = /[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
const SYMBOLS = /[*#`_>|]/g;
// 전화번호 모양: 휴대폰·지역번호(010-1234-5678, 02 123 4567, +82 10…), 대표번호(1588-1234).
const PHONE = /(?<!\d)0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)|\+82[-\s.]?\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)|(?<!\d)1[5-9]\d{2}[-\s.]\d{4}(?!\d)/;

/** 봉사자가 쓴 칸 값을 자료로 쓰기 전에 거른다: 한 줄로, 금지 표현이 든 문장·주소·전화번호를 뺀다. */
function safeFact(value: string | undefined | null, max = FACT_MAX): string {
  if (!value) return "";
  const stripped = oneLine(value.normalize("NFKC").replace(URL_TOKEN, " ").replace(BARE_DOMAIN, " ").replace(SYMBOLS, " "));
  return oneLine(cleanText(stripped, max)).replace(new RegExp(PHONE.source, "g"), "").trim();
}

function slotText(view: ReviewSource["view"], key: SlotKey): string {
  const slot = view.slots[key];
  return slot && slot.status !== "skipped" ? slot.value : "";
}

function altNames(view: ReviewSource["view"]): string[] {
  return slotText(view, "alts")
    .split(/[,，]/)
    .map((name) => safeFact(name, 100))
    .filter(Boolean)
    .slice(0, 2);
}

/** [확인했어요]한 혜택(종류·조건). 혜택 묶음 메시지(contract-ui.md) 중 확인한 주소와 같은 항목만. 금액 없이 글만 쓴다. */
export function confirmedBenefits(view: ReviewSource["view"]): ConfirmedBenefit[] {
  const checked = new Set((view.slots.benefits?.links ?? []).map((url) => urlKey(url)).filter((key): key is string => key !== null));
  if (checked.size === 0) return [];
  const out: ConfirmedBenefit[] = [];
  for (const message of view.messages) {
    if (message.role !== "ai" || message.body.kind !== "benefits" || !Array.isArray(message.body.items)) continue;
    for (const raw of message.body.items) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as Record<string, unknown>;
      const key = typeof item.url === "string" ? urlKey(item.url) : null;
      if (key === null || !checked.has(key)) continue;
      const kind = safeFact(typeof item.kind === "string" ? item.kind : typeof item.title === "string" ? item.title : "", 40);
      const condition = safeFact(typeof item.condition === "string" ? item.condition : "", 60);
      if (kind === "" || out.some((entry) => entry.kind === kind && entry.condition === condition)) continue;
      out.push({ kind, condition });
      if (out.length >= 3) return out;
    }
  }
  return out;
}

export function buildReviewMaterial({ view, context }: ReviewSource): ReviewMaterial {
  const badge = purchaseBadge(view);
  const benefitsSlot = view.slots.benefits;
  return {
    요청: { 문장: safeFact(context.product, 80), 브랜드: context.brand, 품목: context.item },
    구매: badge === "verified" ? "구매 인증됨" : view.purchase === "bought" ? "구매했지만 사진 없음" : "리서치만",
    기종: safeFact(slotText(view, "model"), 100),
    장점: safeFact(slotText(view, "pros")),
    같이고민한제품: altNames(view),
    고른이유: safeFact(slotText(view, "altReason")),
    혜택경험: benefitsSlot?.status === "skipped" ? "없었어요" : safeFact(slotText(view, "benefits")),
    확인한혜택: confirmedBenefits(view),
    사진장수: view.photos.length,
  };
}

/** 문단에 나와도 되는 기종 이름의 근거 글: 요청, 칸 값, 보인 후보, 확인한 혜택. */
export function reviewKnownMaterial({ view, context }: ReviewSource): string[] {
  const shown: string[] = [];
  for (const key of ["shownModels", "shownAlts"]) {
    const value = view.pending[key];
    if (Array.isArray(value)) shown.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  const slotValues = Object.values(view.slots).map((slot) => slot?.value ?? "");
  const benefits = confirmedBenefits(view).flatMap((entry) => [entry.kind, entry.condition]);
  return [context.product, context.brand ?? "", context.item ?? "", ...slotValues, ...view.extras, ...shown, ...benefits];
}

// ---------- 검사 ----------

const sentencesOf = (text: string) => text.split(/(?<=[.!?。])\s+|\n+/).map((part) => part.trim()).filter(Boolean);

function firstOffender(text: string): string {
  const hit = sentencesOf(text).find((sentence) => hasForbidden(sentence));
  return clip(oneLine(hit ?? text), 30);
}

/**
 * 문단 검사. 걸린 이유를 봉사자가 읽을 문장으로 돌려준다(통과하면 빈 목록).
 * ai: AI 문단(150~700자), edit: 봉사자가 고친 문단(50~1,000자). 둘 다 3~7문장, 목록·기호 없음,
 * 가격·재고·할인 표현, 자료에 없는 기종 이름, 주소, 전화번호 모양을 거른다.
 */
export function checkReviewText(text: string, material: readonly string[], mode: "ai" | "edit"): string[] {
  const reasons: string[] = [];
  const normalized = text.normalize("NFKC");
  const length = charCount(text.trim());
  if (mode === "edit") {
    if (length < REVIEW_EDIT_MIN || length > REVIEW_EDIT_MAX) {
      reasons.push(`문단은 ${REVIEW_EDIT_MIN}자 이상 ${REVIEW_EDIT_MAX.toLocaleString("ko-KR")}자 이하로 써 주세요. 지금은 ${length}자예요.`);
    }
  } else if (length < AI_MIN || length > AI_MAX) {
    reasons.push(`길이가 ${AI_MIN}~${AI_MAX}자를 벗어났어요.`);
  }
  // 문장 수와 목록·기호는 AI 문단과 봉사자가 고친 문단에 같이 건다(design.md 4.11 "같은 검사"). 길이만 모드별로 다르다.
  const count = sentencesOf(text).length;
  if (count < SENTENCES_MIN || count > SENTENCES_MAX) {
    reasons.push(`문장이 지금 ${count}개예요. ${SENTENCES_MIN}~${SENTENCES_MAX}개로 써 주세요.`);
  }
  if (new RegExp(SYMBOLS.source).test(text) || /^\s*(?:[-•]|\d+[.)])\s/m.test(text)) reasons.push("목록이나 기호가 들어 있어요.");
  if (hasForbidden(text)) reasons.push(`가격·재고·할인으로 보이는 표현이 있어요: “${firstOffender(text)}”`);
  const unknown = unknownModelTokens(text, material);
  if (unknown.length > 0) reasons.push(`자료에 없는 기종 이름이 있어요: ${[...new Set(unknown)].slice(0, 3).join(", ")}`);
  if (/https?:\/\/|www\./i.test(normalized) || new RegExp(BARE_DOMAIN.source, "i").test(normalized)) {
    reasons.push("주소(링크)는 문단에 넣지 않아요.");
  }
  if (PHONE.test(normalized)) reasons.push("전화번호처럼 보이는 숫자는 넣지 않아요.");
  return reasons;
}

// ---------- 서버 틀 문단 ----------

/** 칸 값의 첫 문장(끝 문장부호 뺀 것). 틀 문단이 칸 값을 따옴표로 인용해도 문장 수가 불어나지 않게 한다. */
function firstSentence(value: string): string {
  return (sentencesOf(value)[0] ?? "").replace(/[.!?。]+$/, "").trim();
}

/**
 * AI 없이 서버가 칸 값만 이어 만드는 문단(AI 실패·상한·검사 실패 때). 새 정보를 더하지 않는다.
 * 조사를 붙이지 않는 문형이라 기종 이름이 영문이어도 어색하지 않다.
 * 봉사자가 [검수 마치기]만 눌러도 PUT 검사(edit)를 통과해야 하므로, 칸 값은 첫 문장만 인용하고
 * 3~7문장·1,000자를 넘으면 선택 문장(확인한 혜택, 혜택 경험, 사진, 같이 고민한 제품)을 뒤에서부터 뺀다.
 */
export function buildTemplateReview(material: ReviewMaterial): string {
  const verified = material.구매 === "구매 인증됨";
  const model = firstSentence(material.기종) || "이 제품";
  const pros = firstSentence(material.장점);
  const reason = firstSentence(material.고른이유);
  const experience = firstSentence(material.혜택경험);
  const alts = material.같이고민한제품.map(firstSentence).filter(Boolean);
  const parts: { text: string; optional: boolean }[] = [];
  const add = (text: string, optional = true) => parts.push({ text, optional });
  if (verified) add(`리뷰 대상 기종은 ${model}, 봉사자가 직접 구매한 것을 사진으로 인증한 제품이에요.`, false);
  else if (material.구매 === "구매했지만 사진 없음") add(`리뷰 대상 기종은 ${model}, 봉사자가 구매했다고 말한 제품이에요.`, false);
  else add(`리뷰 대상 기종은 ${model}, 봉사자가 사지 않고 알아본 제품이에요.`, false);
  if (pros) add(`봉사자가 말한 장점은 “${pros}”라고 해요.`, false);
  if (alts.length > 0) {
    const list = alts.join(", ");
    add(reason ? `같이 고민한 제품은 ${list}, 고른 이유는 “${reason}”라고 말했어요.` : `같이 고민한 제품은 ${list} 등이에요.`);
  } else if (reason) {
    add(`이 기종을 고른 이유는 “${reason}”라고 말했어요.`);
  }
  if (verified && material.사진장수 > 0) add(`구매 인증 사진은 ${material.사진장수}장 올라와 있어요.`);
  if (experience) add(`받은 혜택에 대해서는 “${experience}”라고 말했어요.`);
  const benefits = material.확인한혜택
    .map((entry) => {
      const kind = firstSentence(entry.kind);
      const condition = firstSentence(entry.condition);
      return condition ? `${kind}, 조건은 ${condition}` : kind;
    })
    .filter(Boolean);
  if (benefits.length > 0) add(`봉사자가 직접 확인한 혜택 안내로는 ${benefits.join("; ")} 등이 있어요.`);
  // 칸 값이 주소뿐이라 비면 문장이 3개보다 적을 수 있다. 새 정보 없이 3문장을 채운다.
  if (parts.length < SENTENCES_MIN - 1) add("봉사자가 더 자세히 말한 내용은 아직 없어요.", false);
  add("이 글은 봉사자가 모은 내용을 정리한 것이라서, 최신 판매 정보는 쇼핑몰에서 직접 확인해 주세요.", false);

  const join = () => parts.map((part) => part.text).join(" ");
  const fits = () => {
    const text = join();
    return sentencesOf(text).length <= SENTENCES_MAX && charCount(text) <= REVIEW_EDIT_MAX;
  };
  while (!fits()) {
    const index = parts.map((part) => part.optional).lastIndexOf(true);
    if (index < 0) break;
    parts.splice(index, 1);
  }
  return join();
}

// ---------- AI ----------

const REVIEW = [
  "이 단계에서 할 일: 봉사자가 모은 자료만 이어서, 시각장애인 이용자가 VoiceOver(화면 낭독기)로 듣는 리뷰 한 문단을 만든다.",
  '출력 모양: {"text":"리뷰 한 문단"}',
  "- 5~6문장, 한 문단, 줄바꿈 없음, 200~500자(너무 짧으면 안 된다). 첫 문장은 결론이다(어떤 기종을 어떤 경험으로 정리한 리뷰인지).",
  "- 목록, 번호, 기호, 괄호, 마크다운, 주소(링크), 전화번호를 쓰지 않는다.",
  "- 자료에 있는 내용만 쓴다. 새 사양, 평가, 추천 이유를 지어내지 않는다. 자료에 없는 기종 이름이나 모델 번호를 쓰지 않는다.",
  "- 가격, 재고, 할인 금액·퍼센트를 쓰지 않는다. 혜택은 종류와 조건만 말하고 금액은 말하지 않는다.",
  "- 구매가 '구매 인증됨'이면 직접 구매해 쓴 봉사자의 경험이고 사진으로 인증했다고 밝힌다. '리서치만'이면 직접 써 보지 않고 알아본 내용이라고 밝힌다.",
  "- 같이 고민한 제품과 고른 이유가 있으면 한 문장으로 말한다. 혜택 경험이 있으면 말한다.",
  '- 마지막 문장은 "최신 판매 정보는 쇼핑몰에서 직접 확인해 주세요"처럼 쓰고, 가격·재고라는 낱말은 쓰지 않는다.',
].join("\n");

export const reviewInstructions = (): string => `${COMMON}\n\n${REVIEW}`;

export interface ReviewWritten {
  /** 검사를 통과한 AI 문단. 없으면 null(서버 틀 문단을 쓴다). */
  text: string | null;
  upstream: Upstream | null;
  usage: { in: number; out: number };
}

const hasKey = () => Boolean(process.env.OPENAI_API_KEY?.trim());

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** 가짜 모드(LLM_MODE=mock)의 AI 문단: 틀 문단에 시험 표시 한 문장을 더한다(150자 이상이 되게). */
export function mockReviewText(material: ReviewMaterial): string {
  return `${buildTemplateReview(material)} 시험용 가짜 AI가 정리한 문단이라서 실제 평가와 다를 수 있어요.`;
}

/**
 * AI 한 번: Chat Completions JSON, 추론 끔, temperature 0. 던지지 않는다.
 * 검사(checkReviewText ai)를 통과한 문단만 text로 돌려주고, 아니면 null이라 서버가 틀 문단을 쓴다.
 */
export async function writeReview(
  material: ReviewMaterial,
  known: readonly string[],
  signal?: AbortSignal,
): Promise<ReviewWritten> {
  const none = { in: 0, out: 0 };
  const accept = (raw: unknown): string | null => {
    const text = typeof raw === "string" ? oneLine(raw) : "";
    return text !== "" && checkReviewText(text, known, "ai").length === 0 ? text : null;
  };
  if (getLlmMode() === "mock") {
    const text = accept(mockReviewText(material));
    return { text, upstream: text ? null : "empty", usage: none };
  }
  if (!hasKey()) return { text: null, upstream: "nokey", usage: none };
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: REVIEW_TIMEOUT_MS });
    const completion = await client.chat.completions.create(
      {
        model: LLM_MODEL,
        max_completion_tokens: 1500,
        reasoning_effort: "none",
        temperature: 0,
        response_format: { type: "json_object" },
        ...openAiLog("research_review"),
        messages: [
          { role: "system", content: reviewInstructions() },
          {
            role: "user",
            content: materialMessage("봉사자가 모은 자료로 리뷰 한 문단을 출력 모양대로 만든다.", material as unknown as Record<string, unknown>),
          },
        ],
      },
      { signal },
    );
    const choice = completion.choices[0];
    const usage = { in: completion.usage?.prompt_tokens ?? 0, out: completion.usage?.completion_tokens ?? 0 };
    if (choice?.finish_reason === "length") return { text: null, upstream: "empty", usage };
    const text = accept(parseJsonObject(choice?.message?.content ?? "")?.text);
    return { text, upstream: text ? null : "empty", usage };
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    const timeout = signal?.aborted || (typeof name === "string" && /Timeout|Abort/i.test(name));
    return { text: null, upstream: statusOf(error) ?? (timeout ? "timeout" : "none"), usage: none };
  }
}
