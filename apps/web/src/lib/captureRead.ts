import { cutPieces, joinPieceTexts, MAX_PIECES, type CutResult } from "./imagePieces";
import {
  countNeedsCheck,
  isSummaryDraft,
  SUMMARY_TEXT_LIMIT,
  type SummaryDraft,
} from "./summaryDraft";

// 캡처 → 조각 → 글자 읽기 → 요약 초안의 흐름(화면 없음). 브라우저에서 돌고 서버 코드를 가져오지 않는다.
// 이미지·읽은 글자는 이 함수 안의 변수에만 있고 어디에도 저장하지 않는다. 초안만 돌려준다.
// 입장한 기기(lh_vol 쿠키)로 부르며, 쿠키가 없거나 틀리면 서버가 401을 준다.

export const CAPTURE_STATUS = {
  reading: (index: number, count: number) => `이미지 ${index}/${count}을 읽고 있습니다.`,
  arrived: (fields: number, needsCheck: number) =>
    `요약 초안이 도착했습니다. 항목 ${fields}개, 확인 필요 ${needsCheck}개.`,
  extractFailed: "이미지에서 글자를 읽지 못했습니다. 상세 내용을 직접 입력하세요.",
  tooLarge: "이미지 조각이 너무 큽니다. 상세 내용을 직접 입력하세요.",
  badFormat: "이미지 형식을 읽을 수 없습니다. 상세 내용을 직접 입력하세요.",
  notConfigured: "글자 읽기 설정이 끝나지 않았습니다. 상세 내용을 직접 입력하세요.",
  tooManyPieces: `조각이 ${MAX_PIECES}개를 넘습니다. 이미지 수를 줄여 다시 올리세요.`,
  unauthorized: "입장 정보가 없습니다. 다시 입장해 주세요.",
  summarizing: "요약을 만들고 있습니다.",
  summaryFailed: "요약을 만들지 못했습니다. 잠시 뒤 다시 시도하세요.",
  emptyText: "요약할 글을 입력하세요.",
  enlarged: "이미지가 길어 조각을 크게 잘랐습니다.",
  longText: `읽은 글이 길어 앞 ${SUMMARY_TEXT_LIMIT.toLocaleString("en-US")}자만 요약합니다.`,
} as const;

export type CaptureOutcome =
  /** 초안이 생겼다. notice는 덧붙일 안내(없으면 빈 글자). */
  | { kind: "draft"; draft: SummaryDraft; captureCount: number; notice: string }
  /** 글자 읽기에 실패했다. 직접 입력 칸을 연다. */
  | { kind: "manual"; status: string }
  /** 멈췄다. 직접 입력으로 이어 갈 수 없다. unauthorized면 입장 화면으로 보낸다. */
  | { kind: "stopped"; status: string; unauthorized?: boolean };

export interface CaptureDeps {
  fetch?: typeof fetch;
  cut?: (file: Blob) => Promise<CutResult>;
  wait?: (ms: number) => Promise<void>;
  /** 안내를 남긴다(시작과 끝만. 조각마다 바꾸면 낭독이 끊긴다). */
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}

export interface CaptureContext {
  requestId: string;
  /** 이용자가 한 말(요약 지시문의 맥락). */
  product: string;
}

const MAX_ATTEMPTS = 3;
/** 429를 기다리는 횟수 상한. 끝없이 기다리지 않게 한다. */
const MAX_RATE_LIMIT_WAITS = 5;
const MAX_RETRY_AFTER_SECONDS = 60;

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 브라우저 fetch는 다른 객체의 메서드로 부르면 던지므로(Illegal invocation) 한 번 감싼다. */
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after") ?? 1);
  const bounded = Number.isFinite(seconds) ? seconds : 1;
  return Math.min(Math.max(bounded, 1), MAX_RETRY_AFTER_SECONDS) * 1000;
}

type Stop = { kind: "manual"; status: string } | { kind: "stopped"; status: string; unauthorized?: boolean };

/** 다시 시도해도 소용없는 응답 상태. 401은 입장 화면, 그 밖은 직접 입력으로 이어 간다. */
function stopForStatus(status: number): Stop | null {
  switch (status) {
    case 401:
      return { kind: "stopped", status: CAPTURE_STATUS.unauthorized, unauthorized: true };
    case 413:
      return { kind: "manual", status: CAPTURE_STATUS.tooLarge };
    case 415:
      return { kind: "manual", status: CAPTURE_STATUS.badFormat };
    case 503:
      return { kind: "manual", status: CAPTURE_STATUS.notConfigured };
    default:
      return null;
  }
}

type PieceResult =
  | { kind: "text"; text: string; lowConfidence: string[] }
  | { kind: "unreadable" }
  | Stop;

/** 조각 하나를 읽는다. 같은 조각 3회 실패면 멈추고 직접 입력으로 보낸다. */
async function readPiece(
  context: CaptureContext,
  image: string,
  pieceIndex: number,
  pieceCount: number,
  deps: Required<Pick<CaptureDeps, "fetch" | "wait">> & Pick<CaptureDeps, "signal">,
): Promise<PieceResult> {
  let failures = 0;
  let waits = 0;
  while (failures < MAX_ATTEMPTS) {
    let response: Response;
    try {
      response = await deps.fetch("/api/volunteer/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: context.requestId, pieceIndex, pieceCount, image }),
        signal: deps.signal,
      });
    } catch {
      if (deps.signal?.aborted) return { kind: "stopped", status: "" };
      failures += 1;
      continue;
    }
    if (response.status === 429 && waits < MAX_RATE_LIMIT_WAITS) {
      waits += 1;
      await deps.wait(retryAfterMs(response));
      continue;
    }
    if (response.status === 422) return { kind: "unreadable" };
    const stop = stopForStatus(response.status);
    if (stop) return stop;
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        text?: unknown;
        lowConfidence?: unknown;
      } | null;
      if (typeof body?.text === "string") {
        return {
          kind: "text",
          text: body.text,
          lowConfidence: Array.isArray(body.lowConfidence)
            ? body.lowConfidence.filter((word): word is string => typeof word === "string")
            : [],
        };
      }
    }
    failures += 1;
  }
  return { kind: "manual", status: CAPTURE_STATUS.extractFailed };
}

/** 글(읽은 글자 또는 봉사자가 입력한 글)로 요약 초안을 만든다. */
export async function summarizeText(
  context: CaptureContext,
  source: "ocr" | "manual",
  fullText: string,
  extra: { lowConfidence: string[]; unreadable: number[] },
  captureCount: number,
  deps: CaptureDeps = {},
): Promise<CaptureOutcome> {
  const doFetch = deps.fetch ?? defaultFetch;
  const wait = deps.wait ?? defaultWait;
  let text = fullText;
  let notice = "";
  if (text.length > SUMMARY_TEXT_LIMIT) {
    text = text.slice(0, SUMMARY_TEXT_LIMIT);
    notice = CAPTURE_STATUS.longText;
  }
  let response: Response | null = null;
  for (let waits = 0; ; waits++) {
    try {
      response = await doFetch("/api/volunteer/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: context.requestId,
          context: { product: context.product },
          source,
          text,
          ...extra,
        }),
        signal: deps.signal,
      });
    } catch {
      response = null;
    }
    if (response?.status !== 429 || waits >= MAX_RATE_LIMIT_WAITS) break;
    await wait(retryAfterMs(response));
  }
  const stop = response ? stopForStatus(response.status) : null;
  if (stop) {
    // 요약 단계에서는 직접 입력으로 이어 갈 곳이 없다(이미 글이 있다). 안내만 한다.
    return stop.kind === "manual"
      ? { kind: "stopped", status: CAPTURE_STATUS.summaryFailed }
      : stop;
  }
  const body: unknown = response?.ok ? await response.json().catch(() => null) : null;
  if (!response || !isSummaryDraft(body)) {
    return { kind: "stopped", status: CAPTURE_STATUS.summaryFailed };
  }
  return { kind: "draft", draft: body, captureCount, notice };
}

/**
 * 캡처(이미지 파일 여러 장)를 읽어 요약 초안을 만든다.
 * 조각 내기 → 조각별 읽기(재시도) → 잇기 → 요약 1회. 같은 조각이 3회 실패하면 직접 입력으로 보낸다.
 */
export async function readCapture(
  context: CaptureContext,
  files: readonly Blob[],
  deps: CaptureDeps = {},
): Promise<CaptureOutcome> {
  const resolved = {
    fetch: deps.fetch ?? defaultFetch,
    wait: deps.wait ?? defaultWait,
    signal: deps.signal,
  };
  const cut = deps.cut ?? cutPieces;
  const manual = (status: string): CaptureOutcome => ({ kind: "manual", status });

  const pieces: string[] = [];
  let enlarged = false;
  try {
    for (const file of files) {
      const result = await cut(file);
      pieces.push(...result.pieces);
      enlarged ||= result.enlarged;
    }
  } catch {
    return manual(CAPTURE_STATUS.extractFailed);
  }
  if (pieces.length === 0) return manual(CAPTURE_STATUS.extractFailed);
  if (pieces.length > MAX_PIECES) {
    return { kind: "stopped", status: CAPTURE_STATUS.tooManyPieces };
  }

  deps.onStatus?.(CAPTURE_STATUS.reading(1, pieces.length));
  const texts: string[] = [];
  const lowConfidence: string[] = [];
  const unreadable: number[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const result = await readPiece(context, pieces[index], index, pieces.length, resolved);
    if (result.kind === "manual" || result.kind === "stopped") return result;
    if (result.kind === "unreadable") {
      unreadable.push(index);
      continue;
    }
    texts.push(result.text);
    lowConfidence.push(...result.lowConfidence);
  }
  const joined = joinPieceTexts(texts);
  if (!joined) return manual(CAPTURE_STATUS.extractFailed);

  const outcome = await summarizeText(
    context,
    "ocr",
    joined,
    { lowConfidence, unreadable },
    files.length,
    deps,
  );
  if (outcome.kind === "draft" && enlarged) {
    return { ...outcome, notice: [CAPTURE_STATUS.enlarged, outcome.notice].filter(Boolean).join(" ") };
  }
  return outcome;
}

/** 초안이 도착했다는 안내 글자. */
export function arrivedStatus(draft: SummaryDraft): string {
  return CAPTURE_STATUS.arrived(draft.fields.length, countNeedsCheck(draft));
}
