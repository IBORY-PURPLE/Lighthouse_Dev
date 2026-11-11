import type { ConditionKind, RequestStatus } from "./requestStore";

// 봉사자 화면과 서버가 함께 쓰는 타입과 순수 함수. server-only가 아니다.
// requestStore는 타입만 가져온다(import type은 번들에 들어가지 않는다).

/** 봉사자가 보는 요청 한 건. 시각은 ISO 문자열. */
export interface VolunteerRequestView {
  requestId: string;
  status: RequestStatus;
  product: string;
  budget: string;
  condition: string;
  brand: string | null;
  item: string | null;
  conditionKind: ConditionKind | null;
  createdAt: string;
  claimedAt: string | null;
  doneAt: string | null;
  isDemo: boolean;
}

/** 대기열 카드 한 장. */
export interface QueueItem {
  requestId: string;
  product: string;
  budget: string;
  condition: string;
  item: string | null;
  createdAt: string;
  isDemo: boolean;
}

/** 이 기기에서 보낸 요청 카드 한 장. */
export interface SentItem {
  requestId: string;
  product: string;
  budget: string;
  sentAt: string;
  candidateCount: number;
}

export interface SentCandidate {
  name: string;
  url: string;
  guide: string;
  summary: { label: string; value: string }[];
}

export interface SentResult {
  sentAt: string;
  heardAt: string | null;
  linkOpenedAt: string | null;
  candidates: SentCandidate[];
}

export interface QueueData {
  waiting: QueueItem[];
  mine: VolunteerRequestView | null;
  sent: SentItem[];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

/** 대기 시간 글자. 1분 미만은 1분으로 보고, 60분부터 시간으로 센다. */
export function waitLabel(createdAt: string | number, now: number): string {
  const created = typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  const minutes = Math.max(1, Math.floor((now - created) / MINUTE_MS));
  if (minutes < 60) return `대기 ${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `대기 ${hours}시간째` : `대기 ${hours}시간 ${rest}분째`;
}

export function quoteOf(product: string, budget: string): string {
  return `“${product} · ${budget}”`;
}

const CONDITION_LABEL: Record<ConditionKind, string> = {
  new: "새 제품",
  used: "중고",
  any: "새 제품·중고 상관없음",
};

/** 요청 상세의 구조화 줄. 품목을 모르면 "품목" 부분을 뺀다. */
export function structuredLine(request: {
  item: string | null;
  budget: string;
  conditionKind: ConditionKind | null;
  condition: string;
}): string {
  const condition = request.conditionKind
    ? CONDITION_LABEL[request.conditionKind]
    : request.condition;
  const parts = [
    ...(request.item ? [`품목 ${request.item}`] : []),
    `예산 ${request.budget}`,
    condition,
  ];
  return parts.join(" · ");
}

/** 서울 날짜를 "일 수"로. 날짜끼리 빼서 오늘·어제를 가른다. */
function kstDay(time: number): number {
  return Math.floor((time + KST_OFFSET_MS) / DAY_MS);
}

/** 내 담당 탭의 보낸 요청 날짜 글자(서울 날짜 기준). */
export function sentDayLabel(sentAt: string, now: number): string {
  const sent = Date.parse(sentAt);
  const diff = kstDay(now) - kstDay(sent);
  if (diff <= 0) return "오늘 보냄";
  if (diff === 1) return "어제 보냄";
  const date = new Date(sent + KST_OFFSET_MS);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 보냄`;
}

/** 예: "11월 12일 오전 3:42". */
export function formatSentAt(sentAt: string): string {
  return new Date(sentAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });
}

/** 직전 목록에 없던 요청 id. 직전 목록이 없으면(첫 불러오기) 빈 집합. */
export function newRequestIds(
  previous: readonly string[] | null,
  current: readonly string[],
): Set<string> {
  if (!previous) return new Set();
  const seen = new Set(previous);
  return new Set(current.filter((id) => !seen.has(id)));
}

/** 화면 곳곳의 안내 글자. 429는 STATUS.tooMany(speech.ts)를 쓴다. */
export const VOLUNTEER_MESSAGES = {
  connectFailed: "서버에 연결하지 못했습니다. 다시 시도해 주세요.",
  takenByOther: "방금 다른 봉사자가 맡았어요",
  lockedByMine: "맡은 요청을 끝내면 맡을 수 있어요",
  releasedToQueue: "요청을 대기열로 돌려놓았어요",
  notYours: "이 요청은 내 담당이 아니에요",
  notFound: "요청을 찾지 못했어요",
  invalidCode: "입장 코드가 올바르지 않습니다",
  invalidNickname: "별명은 1~12자로 넣어 주세요",
  enterTooMany: "시도가 너무 많습니다. 10분 뒤 다시 해 주세요.",
  tempStore:
    "임시 저장소를 쓰고 있습니다. 서버가 다시 뜨면 시연 요청과 맡은 상태가 사라질 수 있습니다.",
} as const;
