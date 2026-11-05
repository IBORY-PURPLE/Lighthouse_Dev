// /api/match 호출과 시연 이어 보기(lh.match.v1). TSD §2 시연 예외, §8.
// 저장은 이용자 화면만 한다. 봉사자 화면은 읽기만 한다.

import { STATUS } from "@/lib/speech";

export const MATCH_STORAGE_KEY = "lh.match.v1";
/** 서버가 답하지 않아도 "찾고 있습니다"에 멈춰 있지 않게 끊는 시간. */
export const MATCH_TIMEOUT_MS = 10_000;

export interface MatchResponse {
  requestId: string;
  volunteer: { id: string; displayName: string };
  request: { brand: string | null; item: string; raw: string };
}

export type MatchOutcome =
  | { kind: "matched"; match: MatchResponse }
  /** 문장을 바꿔 다시 내야 한다. */
  | { kind: "rejected"; status: string }
  /** 같은 문장을 다시 보낼 수 있다. */
  | { kind: "failed"; status: string };

function isMatchResponse(value: unknown): value is MatchResponse {
  const match = value as Partial<MatchResponse> | null;
  return (
    typeof match?.requestId === "string" &&
    typeof match.volunteer?.id === "string" &&
    typeof match.volunteer.displayName === "string" &&
    (match.request?.brand === null ||
      typeof match.request?.brand === "string") &&
    typeof match.request?.item === "string" &&
    typeof match.request.raw === "string"
  );
}

function outcomeForStatus(status: number): MatchOutcome {
  switch (status) {
    case 400:
      return { kind: "rejected", status: STATUS.tooLong };
    case 422:
      return { kind: "rejected", status: STATUS.needItem };
    case 401:
      return { kind: "failed", status: STATUS.noAccess };
    case 429:
      return { kind: "failed", status: STATUS.tooMany };
    default:
      return { kind: "failed", status: STATUS.matchFailed };
  }
}

export async function requestMatch(text: string): Promise<MatchOutcome> {
  try {
    const response = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
    });
    if (!response.ok) return outcomeForStatus(response.status);
    const match: unknown = await response.json();
    return isMatchResponse(match)
      ? { kind: "matched", match }
      : { kind: "failed", status: STATUS.matchFailed };
  } catch {
    return { kind: "failed", status: STATUS.matchFailed };
  }
}

/** 저장에 실패해도 매칭은 끝난 것이다. 봉사자 화면이 "매칭 정보가 없습니다"를 보여 준다. */
export function saveMatch(match: MatchResponse): void {
  try {
    sessionStorage.setItem(MATCH_STORAGE_KEY, JSON.stringify(match));
  } catch {
    // 저장 공간을 못 쓰는 브라우저에서도 이용자 화면은 멈추지 않는다.
  }
}

export function readStoredMatch(): string | null {
  try {
    return sessionStorage.getItem(MATCH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function parseStoredMatch(
  stored: string | null | undefined,
): MatchResponse | null {
  if (!stored) return null;
  try {
    const match: unknown = JSON.parse(stored);
    return isMatchResponse(match) ? match : null;
  } catch {
    return null;
  }
}

/** "Sony 헤드셋", 브랜드가 없으면 "헤드셋". */
export function requestLabel({ brand, item }: MatchResponse["request"]): string {
  return brand ? `${brand} ${item}` : item;
}
