import type { ConditionKind } from "./requestStore";
import type { SentCandidate } from "./volunteerView";

// 시연용 요청 데이터(2026-11-12 와이어프레임 v1). 한 곳에만 적는다.
// 메모리 저장소의 resetDemo가 쓰고, Supabase는 같은 값을 reset_demo_requests SQL 함수에 갖고 있다.
// 단위 시험이 마이그레이션 파일에 각 product 글자가 있는지 확인한다.

export interface DemoRequest {
  product: string;
  budget: string;
  condition: string;
  brand: string | null;
  item: string;
  conditionKind: ConditionKind;
  /** 접수된 지 몇 분 됐는지(대기 시간으로 보인다). */
  minutesAgo: number;
}

export const DEMO_WAITING: readonly DemoRequest[] = [
  {
    product: "소니 무선 헤드셋 사고 싶어요",
    budget: "30만 원 안쪽",
    condition: "새 제품",
    brand: "소니",
    item: "헤드셋",
    conditionKind: "new",
    minutesAgo: 72,
  },
  {
    product: "세탁 세제 리필용 큰 것",
    budget: "2만 원 안쪽",
    condition: "새 제품",
    brand: null,
    item: "세탁세제",
    conditionKind: "new",
    minutesAgo: 47,
  },
  {
    product: "무선 키보드, 조용한 것",
    budget: "5만 원쯤",
    condition: "새 제품",
    brand: null,
    item: "키보드",
    conditionKind: "new",
    minutesAgo: 21,
  },
  {
    product: "전기포트 1.7리터",
    budget: "4만 원 안쪽",
    condition: "상관없어요",
    brand: null,
    item: "전기포트",
    conditionKind: "any",
    minutesAgo: 9,
  },
  {
    product: "엄마 쓰실 전기요, 싱글 사이즈",
    budget: "10만 원 안쪽",
    condition: "새 제품",
    brand: null,
    item: "전기요",
    conditionKind: "new",
    minutesAgo: 2,
  },
];

/** 이 기기에서 하루 전에 보낸 것으로 보이는 완료 요청 한 건. */
export const DEMO_DONE = {
  product: "아이 실내화 210 사이즈, 흰색",
  budget: "3만 원 안쪽",
  condition: "새 제품",
  brand: null,
  item: "실내화",
  conditionKind: "new" as const,
  /** 접수는 하루와 40분 전, 맡은 때는 하루와 30분 전, 보낸 때는 하루 전. */
  createdMinutesAgo: 24 * 60 + 40,
  claimedMinutesAgo: 24 * 60 + 30,
  sentMinutesAgo: 24 * 60,
} as const;

const SLIPPER_SEARCH =
  "https://search.11st.co.kr/pc/total-search?kwd=" +
  encodeURIComponent("아동 실내화 흰색 210");

export const DEMO_DONE_CANDIDATES: readonly SentCandidate[] = [
  {
    name: "아동 EVA 실내화 흰색 (시연용 예시 1)",
    url: SLIPPER_SEARCH,
    guide: "‘구매하기’를 누르고 사이즈 210을 고릅니다.",
    summary: [
      { label: "사이즈", value: "210" },
      { label: "색상", value: "흰색" },
      { label: "소재", value: "EVA" },
    ],
  },
  {
    name: "아동 실내화 흰색 (시연용 예시 2)",
    url: SLIPPER_SEARCH,
    guide: "옵션에서 흰색과 210을 고른 뒤 ‘구매하기’를 누릅니다.",
    summary: [
      { label: "사이즈", value: "210" },
      { label: "색상", value: "흰색" },
    ],
  },
];
