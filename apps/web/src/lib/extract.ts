import "server-only";
import OpenAI from "openai";
import { LLM_MODEL } from "@/lib/llm";
import { buildSummaryUserMessage, SUMMARY_INSTRUCTIONS } from "@/lib/summaryPrompt";

// ④ 글자 읽기(조각 하나)와 요약 엔진 호출. TSD §8.7, §8.8.
// 이미지·읽은 글자·초안은 저장하지 않는다. 호출이 끝나면 참조를 버린다.

export type ExtractEngine = "openai" | "upstage" | "mock";

/**
 * 키가 둘 다 있을 때의 순서(TSD §8.7에 없는 규칙, 11/9 ai.md 블록 2 "엔진 고르기").
 * 블록 1 실험 1위가 OpenAI라 OpenAI가 먼저다.
 */
export const EXTRACT_ENGINE_ORDER = ["openai", "upstage"] as const;

/** luna 계열 중 가장 싼 모델(블록 1 확정, 2026-11-10 OpenAI 가격표). */
export const OPENAI_EXTRACT_MODEL = "gpt-6-luna";
const UPSTAGE_URL = "https://api.upstage.ai/v1/document-digitization";
/** Upstage 단어 신뢰도가 이보다 낮으면 "확인 필요" 대조에 쓴다. */
const LOW_CONFIDENCE = 0.7;
/** 라우트 maxDuration(60초) 안에 끝나도록 엔진 호출을 끊는다. */
const EXTRACT_TIMEOUT_MS = 50_000;
const SUMMARY_TIMEOUT_MS = 25_000;

const OCR_PROMPT =
  "첨부된 이미지에 보이는 글자를 위에서 아래 순서대로 빠짐없이 그대로 받아써라. 요약하거나 고치거나 설명을 덧붙이지 말고, 읽을 수 없는 부분은 [못 읽음]으로 표시하라. 글자가 하나도 없으면 아무것도 쓰지 마라.";

const hasKey = (name: string) => Boolean(process.env[name]?.trim());

function isMockMode(): boolean {
  // 세 *_MODE는 운영 환경에서 무시한다(TSD §5).
  return (
    process.env.VERCEL_ENV !== "production" && process.env.EXTRACT_MODE === "mock"
  );
}

/** 지금 쓸 글자 읽기 엔진. 없으면 null(라우트는 503 not_configured). */
export function getExtractEngine(): ExtractEngine | null {
  if (isMockMode()) return "mock";
  if (hasKey("OPENAI_API_KEY")) return "openai";
  if (hasKey("UPSTAGE_API_KEY")) return "upstage";
  return null;
}

export class ExtractError extends Error {
  constructor(
    readonly kind: "rate_limited" | "failed" | "not_configured" | "no_text",
    /** 상위 서버(OpenAI·Upstage)가 돌려준 HTTP 상태 코드. 원인 확인용 로그에만 쓴다. */
    readonly upstreamStatus?: number,
  ) {
    super(`extract_${kind}`);
  }
}

export interface ExtractResult {
  text: string;
  lowConfidence: string[];
  engine: ExtractEngine;
}

/** 가짜 엔진의 글자. 조각 번호가 들어간 고정 문장(가짜 헤드셋 LH-200). */
export function mockPieceText(pieceIndex: number, pieceCount: number): string {
  return [
    `[조각 ${pieceIndex + 1}/${pieceCount}]`,
    "상품명: 가짜 헤드셋 LH-200",
    "색상 옵션: 블랙, 화이트",
    "블루투스 5.3, 최대 30시간 재생",
    "판매가 39,000원",
    "주의: 물에 닿지 않게 하세요",
  ].join("\n");
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function toExtractError(error: unknown): ExtractError {
  if (error instanceof ExtractError) return error;
  const status = statusOf(error);
  return new ExtractError(status === 429 ? "rate_limited" : "failed", status);
}

async function extractWithOpenAI(image: string, signal?: AbortSignal): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
    timeout: EXTRACT_TIMEOUT_MS,
  });
  // detail original, 추론 끔(11/9 결정 9). 블록 1에서 gpt-6-luna가 두 매개변수를 거부 없이 받았다.
  const completion = await client.chat.completions.create(
    {
      model: OPENAI_EXTRACT_MODEL,
      max_completion_tokens: 4096,
      reasoning_effort: "none",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "image_url", image_url: { url: image, detail: "original" } },
          ],
        },
      ],
    },
    { signal },
  );
  return (completion.choices[0]?.message?.content ?? "").trim();
}

async function extractWithUpstage(
  image: string,
  signal?: AbortSignal,
): Promise<{ text: string; lowConfidence: string[] }> {
  const match = /^data:(image\/(?:jpeg|png));base64,(.*)$/s.exec(image);
  if (!match) throw new ExtractError("failed");
  const [, mime, base64] = match;
  const form = new FormData();
  form.append(
    "document",
    new Blob([Buffer.from(base64, "base64")], { type: mime }),
    `piece.${mime === "image/png" ? "png" : "jpg"}`,
  );
  form.append("model", "ocr");
  const response = await fetch(UPSTAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTAGE_API_KEY}` },
    body: form,
    signal: AbortSignal.any([
      AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    throw new ExtractError(
      response.status === 429 ? "rate_limited" : "failed",
      response.status,
    );
  }
  const data = (await response.json()) as {
    text?: string;
    pages?: Array<{ words?: Array<{ text?: string; confidence?: number }> }>;
  };
  const lowConfidence = (data.pages ?? [])
    .flatMap((page) => page.words ?? [])
    .filter(
      (word) =>
        typeof word.text === "string" &&
        typeof word.confidence === "number" &&
        word.confidence < LOW_CONFIDENCE,
    )
    .map((word) => word.text as string);
  return { text: (data.text ?? "").trim(), lowConfidence };
}

/** 조각 하나의 글자를 읽는다. 실패는 ExtractError로 던진다. */
export async function extractText({
  image,
  pieceIndex,
  pieceCount,
  signal,
}: {
  image: string;
  pieceIndex: number;
  pieceCount: number;
  signal?: AbortSignal;
}): Promise<ExtractResult> {
  const engine = getExtractEngine();
  if (!engine) throw new ExtractError("not_configured");
  if (engine === "mock") {
    return { text: mockPieceText(pieceIndex, pieceCount), lowConfidence: [], engine };
  }

  let result: { text: string; lowConfidence: string[] };
  try {
    result =
      engine === "openai"
        ? // OpenAI는 단어 신뢰도가 없어 빈 배열이다(TSD §8.7).
          { text: await extractWithOpenAI(image, signal), lowConfidence: [] }
        : await extractWithUpstage(image, signal);
  } catch (error) {
    throw toExtractError(error);
  }
  if (!result.text) throw new ExtractError("no_text");
  return { ...result, engine };
}

/**
 * 가짜 요약 출력. 일부러 spec의 근거를 원문에 없는 문장으로 두고(→ unverified),
 * components는 비워 두고(→ missing), 가격 항목을 넣는다(→ 초안에서 빠져야 한다).
 */
export const MOCK_SUMMARY_JSON = JSON.stringify({
  fields: [
    {
      key: "productName",
      label: "상품명",
      value: "가짜 헤드셋 LH-200",
      evidence: "상품명: 가짜 헤드셋 LH-200",
    },
    {
      key: "option",
      label: "옵션",
      value: "블랙, 화이트",
      evidence: "색상 옵션: 블랙, 화이트",
    },
    {
      key: "spec",
      label: "핵심 사양",
      value: "블루투스 5.3, 최대 40시간 재생",
      evidence: "최대 40시간 재생, 노이즈 캔슬링",
    },
    { key: "components", label: "구성품", value: null, evidence: null },
    {
      key: "caution",
      label: "주의사항",
      value: "물에 닿지 않게 하세요",
      evidence: "주의: 물에 닿지 않게 하세요",
    },
    { key: "price", label: "가격", value: "39,000원", evidence: "판매가 39,000원" },
  ],
});

/** 요약을 실제로 부를 수 있는지. 가짜 모드거나 OpenAI 키가 있으면 true. */
export function isSummaryConfigured(): boolean {
  return isMockMode() || hasKey("OPENAI_API_KEY");
}

/** 요약 LLM의 JSON 문자열을 돌려준다. 검사는 라우트가 parseSummaryJson·checkEvidence로 한다. */
export async function requestSummaryJson({
  product,
  text,
  signal,
}: {
  product: string;
  text: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (isMockMode()) return MOCK_SUMMARY_JSON;
  if (!hasKey("OPENAI_API_KEY")) throw new ExtractError("not_configured");
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: SUMMARY_TIMEOUT_MS,
    });
    // 추론을 끈다. temperature는 추론이 none일 때만 둘 수 있다.
    const completion = await client.chat.completions.create(
      {
        model: LLM_MODEL,
        max_completion_tokens: 1500,
        reasoning_effort: "none",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SUMMARY_INSTRUCTIONS },
          { role: "user", content: buildSummaryUserMessage(product, text) },
        ],
      },
      { signal },
    );
    return completion.choices[0]?.message?.content ?? "";
  } catch (error) {
    throw toExtractError(error);
  }
}
