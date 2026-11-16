import type { SentCandidate } from "./volunteerView";

// 봉사자가 보내는 결과(후보 1~3개)의 한도와 후보 한 개의 검사. 대화형 보내기(`research/send`)와 결과 만들기(`researchResult.ts`)가 쓴다(서버 전용 import 없음).
// 결과에는 상품명, 링크, 구매 가이드, 요약 항목의 이름·값만 담는다. 이미지, 읽은 글자 원문, 근거 문장은 담지 않는다:
// 검사를 통과한 값만 새 객체로 옮기므로 그 밖의 속성은 버려진다.

export const RESULT_LIMITS = {
  maxCandidates: 3,
  nameMax: 100,
  urlMax: 2048,
  guideMax: 1000,
  summaryMax: 12,
  labelMax: 30,
  valueMax: 200,
  /** 요청 본문 전체의 글자 수 상한. 후보 3개를 한도까지 채워도 이보다 작다. 이미지 같은 큰 값을 일찍 막는다. */
  bodyMax: 40_000,
} as const;

export type ResultErrorCode = "invalid_request" | "too_long" | "invalid_url";

export type CandidateCheck =
  | { ok: true; candidate: SentCandidate }
  | { ok: false; error: ResultErrorCode };

const textLength = (value: string) => [...value].length;

/** https://로 시작하고 URL로 읽힌다(길이는 따로 본다). */
export function isHttpsLink(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** 후보 한 개를 검사해 새 객체로 옮긴다. 값은 앞뒤 공백을 자른다. */
export function checkCandidate(input: unknown): CandidateCheck {
  const entry = input as Record<string, unknown> | null;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: "invalid_request" };
  }
  const { name, url, guide, summary } = entry;
  if (
    typeof name !== "string" ||
    typeof url !== "string" ||
    typeof guide !== "string" ||
    !Array.isArray(summary)
  ) {
    return { ok: false, error: "invalid_request" };
  }

  const trimmedName = name.trim();
  if (trimmedName === "") return { ok: false, error: "invalid_request" };
  if (textLength(trimmedName) > RESULT_LIMITS.nameMax) return { ok: false, error: "too_long" };

  const trimmedUrl = url.trim();
  if (!isHttpsLink(trimmedUrl)) return { ok: false, error: "invalid_url" };
  if (textLength(trimmedUrl) > RESULT_LIMITS.urlMax) return { ok: false, error: "too_long" };

  const trimmedGuide = guide.trim();
  if (textLength(trimmedGuide) > RESULT_LIMITS.guideMax) return { ok: false, error: "too_long" };

  if (summary.length > RESULT_LIMITS.summaryMax) return { ok: false, error: "too_long" };
  const items: { label: string; value: string }[] = [];
  for (const raw of summary) {
    const pair = raw as Record<string, unknown> | null;
    if (!pair || typeof pair !== "object" || typeof pair.label !== "string" || typeof pair.value !== "string") {
      return { ok: false, error: "invalid_request" };
    }
    const label = pair.label.trim();
    const value = pair.value.trim();
    if (label === "" || value === "") return { ok: false, error: "invalid_request" };
    if (textLength(label) > RESULT_LIMITS.labelMax || textLength(value) > RESULT_LIMITS.valueMax) {
      return { ok: false, error: "too_long" };
    }
    items.push({ label, value });
  }

  return {
    ok: true,
    candidate: { name: trimmedName, url: trimmedUrl, guide: trimmedGuide, summary: items },
  };
}
