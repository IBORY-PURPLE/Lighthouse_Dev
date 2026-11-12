import { searchQueryOf, shopSearchUrl } from "./shopLinks";

// 봉사자 리서치 챗의 공용 코드(화면과 서버가 함께 쓴다. server-only가 아니다).
// 카드 순서·필수 여부는 여기 상수다. AI는 다음 카드를 정하지 못한다(설계 지침 3절).
// 상태는 기기 localStorage(lh.vol.research.v1.<requestId>)에만 남고 서버에는 올라가지 않는다.

// ---- 카드 -------------------------------------------------------------------

export const CARD_IDS = ["model", "pros", "photo", "alts", "altReason", "benefits", "refs"] as const;
export type CardId = (typeof CARD_IDS)[number];

export interface CardSpec {
  id: CardId;
  /** 1부터. 화면의 "질문 n / 7". */
  number: number;
  /** 빠진 필수 질문을 가리킬 때 쓰는 이름. */
  name: string;
  required: boolean;
}

export const RESEARCH_CARDS: readonly CardSpec[] = [
  { id: "model", number: 1, name: "기종", required: true },
  { id: "pros", number: 2, name: "장점", required: true },
  { id: "photo", number: 3, name: "제품 사진", required: true },
  { id: "alts", number: 4, name: "같이 고민한 제품", required: true },
  { id: "altReason", number: 5, name: "고민한 이유", required: true },
  { id: "benefits", number: 6, name: "혜택", required: false },
  { id: "refs", number: 7, name: "참고 글", required: false },
];

export const CARD_COUNT = RESEARCH_CARDS.length;
/** 카드 7장 다음, 보내기 전 확인 단계의 step 값. */
export const SUMMARY_STEP = CARD_COUNT;

export const RESEARCH_LIMITS = {
  /** 후보·제품 이름(결과 name 한도와 같다). */
  nameMax: 100,
  /** 화면 글 칸 한도. 결과 요약 값 한도(200)와 같아 보낼 때 잘리지 않는다. */
  answerMax: 200,
  /** 서버가 받아 주는 글 한 칸의 상한(자료로만 쓴다). */
  answerInputMax: 1000,
  maxAlts: 2,
  maxPhotos: 3,
  descriptionMax: 200,
  /** AI가 만드는 핵심 정리의 상한. 봉사자가 고친 글은 결과 가이드 한도(1000)까지. */
  summaryAiMax: 600,
  summaryEditMax: 1000,
  maxItems: 5,
  maxLinks: 4,
  maxHints: 3,
  maxDigest: 4,
  questionMax: 120,
  hintMax: 80,
  noteMax: 80,
  digestMax: 120,
  /** 썸네일 데이터 주소의 길이 상한(localStorage 보호). */
  thumbMax: 60_000,
  /** 서버가 받는 사진 한 장의 상한(디코드 후 바이트). 화면 축소와 서버 검사가 이 값 하나를 쓴다. */
  imageMaxBytes: 1.5 * 1024 * 1024,
} as const;

/** 6절 화면 문구. 코드와 Figma가 같이 쓴다. 화면 파일에는 글자를 직접 적지 않는다. */
export const RESEARCH_COPY = {
  title: "리서치 챗",
  backToQueue: "대기열로",
  loading: "불러오는 중입니다.",
  purchaseSuffix: { bought: " · 구매했어요", research: " · 리서치만" },
  back: "내 담당 목록으로",
  requestLabel: "이용자가 한 말",
  questionKicker: "AI 질문",
  aiBoxTitle: "AI 제안",
  aiBoxMark: "확인 필요",
  sourceLabel: "출처 보기",
  fixedNote: "시연용 고정 후보",
  retry: "다시 찾기",
  historyTitle: "앞에서 답한 것",
  buttons: {
    prev: "이전",
    next: "다음",
    skip: "건너뛰기",
    toSummary: "요약 보기",
    send: "완료하고 보내기",
    release: "내려놓기",
    releaseConfirm: "내려놓기 확인",
    releaseCancel: "취소",
  },
  releasePrompt: "내려놓으면 이 기기에 적은 답과 사진이 지워지고, 요청은 대기열로 돌아가요.",
  toList: "목록으로",
  reload: "다시 시도",
  model: {
    inputLabel: "기종 이름",
    inputExample: "예: WH-CH720N",
    purchaseQuestion: "이 제품을 직접 샀나요?",
    bought: "구매했어요",
    research: "구매하지 않았어요 (리서치만)",
    purchaseNote: "착샷이나 사용 인증샷을 올리면 구매 인증되고 봉사시간이 가산돼요.",
    candidatesTitle: "AI가 찾은 기종 후보",
    searching: "기종 후보를 찾는 중이에요.",
    failed: "AI가 기종 후보를 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.",
    shortcutsTitle: "쇼핑몰에서 직접 찾기",
  },
  pros: {
    hintsTitle: "이런 점을 적어 주면 좋아요",
    inputExample: "예: 오래 써도 귀가 덜 아파요. 버튼이 커서 손으로 찾기 쉬워요.",
  },
  photo: {
    proof: "착샷·사용 인증샷",
    detail: "상세페이지 캡처",
    proofTag: "착샷",
    detailTag: "상세 캡처",
    kindsTitle: "올릴 사진 종류",
    upload: "사진 올리기",
    privacy:
      "얼굴이나 주문번호가 보이지 않게 올려 주세요. 사진은 이 기기에만 남고, 이용자에게는 설명 글만 전달돼요.",
    descriptionTitle: "사진 설명 초안",
    describe: "AI로 사진 설명 만들기",
    describing: "사진 설명을 만드는 중이에요.",
    describeFailed: "사진 설명을 만들지 못했어요. 직접 적어 주세요.",
    describeBusy: "다른 사진의 설명을 만드는 중이에요. 끝나면 다시 눌러 주세요.",
    describeNote: "AI가 만든 글은 위 설명 칸에 들어가요. 꼭 읽고 고쳐 주세요.",
    describeSmall: "작은 미리보기로 만들었어요. 정확한지 확인해 주세요.",
    describeDone: "사진 설명 초안을 만들었어요.",
    readFailed: "사진을 읽지 못했어요. 다른 사진으로 다시 올려 주세요.",
    uploading: "사진을 올리는 중이에요. 끝나면 다시 눌러 주세요.",
    detailOnly: "리서치만 하면 상세페이지 캡처만 올릴 수 있어요.",
    tooBig: "사진이 너무 커서 설명을 만들지 못했어요. 직접 적어 주세요.",
    badFormat: "이 사진 형식으로는 설명을 만들지 못했어요. 직접 적어 주세요.",
    limit: (max: number) => `사진은 ${max}장까지 올릴 수 있어요.`,
    uploaded: (count: number) => `사진 ${count}장을 올렸어요.`,
    removed: (number: number) => `사진 ${number}을 지웠어요.`,
    cutExtra: (max: number, dropped: number) => `사진은 ${max}장까지라 ${dropped}장은 올리지 않았어요.`,
    // 사진 목록·설명 칸의 이름표(화면 파일에 글자를 직접 적지 않는다)
    thumbAlt: (number: number) => `올린 사진 ${number}`,
    removeLabel: (number: number) => `사진 ${number} 지우기`,
    removeButton: "지우기",
    descLabel: (number: number) => `사진 ${number} 설명`,
    describeButton: (label: string, number: number) => `${label} (사진 ${number})`,
  },
  alts: {
    candidatesTitle: "AI가 찾은 비슷한 기종",
    searching: "비슷한 기종을 찾는 중이에요.",
    failed: "AI가 비슷한 기종을 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.",
    inputLabel: "제품 이름",
    add: "추가",
    limitNote: "최대 2개까지 넣을 수 있어요.",
    duplicate: "이미 넣었거나 기종과 같은 이름이에요.",
    empty: "제품 이름을 먼저 적어 주세요.",
    remove: "빼기",
    removeLabel: (name: string) => `${name} 빼기`,
  },
  altReason: {
    inputExample: "예: 노이즈 캔슬링은 더 좋았지만 무거워서 가벼운 쪽을 골랐어요.",
  },
  benefits: {
    inputExample: "예: 카드 할인과 무료 배송을 받았어요.",
    linksTitle: "AI가 찾은 혜택 관련 페이지",
    searching: "혜택 관련 페이지를 찾는 중이에요.",
    open: "열기",
    check: "확인했어요",
    notFound: "직접 확인 필요",
    shortcutsTitle: "쇼핑몰에서 직접 찾기",
  },
  refs: {
    digestTitle: "제가 읽은 내용은 여기까지예요",
    linksTitle: "AI가 찾은 참고 글",
    searching: "참고 글을 찾는 중이에요.",
    inputHint: "새로 아는 내용이 있으면 적어 주세요.",
    notFound: "직접 확인 필요",
    shortcutsTitle: "직접 찾아보기",
  },
  summary: {
    title: "보내기 전 확인",
    candidates: "후보 목록",
    recommended: "추천 기종",
    altsLabel: "같이 고민한 제품",
    verifiedChip: "구매 인증됨 · 봉사시간 가산",
    guide: "핵심 정리",
    guideNote: "이용자는 이 글을 화면 낭독기로 듣습니다.",
    stepLabel: "요약",
    stepAlt: `질문 ${CARD_COUNT}개를 모두 지나 요약 단계예요.`,
    photoCount: (count: number) => `사진 ${count}장`,
    photoDescriptionsTitle: "사진 설명",
    photoDescription: (number: number, text: string) => `사진 ${number}: ${text}`,
    purchase: (verifiedNow: boolean) =>
      verifiedNow ? "구매 인증: 구매 인증됨 · 봉사시간 가산" : "구매 인증: 리서치만",
    missingTitle: "아직 답하지 않은 필수 질문",
    proofMissing: "착샷·사용 인증샷이 없어서 '리서치만'으로 보내요.",
  },
  /** 카드마다 다음으로 갈 수 없을 때 상태 알림으로 읽어 줄 안내(필수 카드). */
  blocked: {
    model: "기종 이름을 쓰고 구매 여부를 골라 주세요.",
    pros: "장점을 적어 주세요.",
    photo: "사진을 1장 이상 올려 주세요.",
    alts: "같이 고민한 제품을 1개 이상 넣어 주세요.",
    altReason: "고민한 이유를 적어 주세요.",
  },
  notice: {
    sending: "보내는 중이에요.",
    found: (count: number) => `${count}개를 찾았어요. 확인 필요.`,
    aiArrived: (hints: number) => `AI 질문과 힌트 ${hints}개가 왔어요. 확인 필요.`,
    rateLimited: "AI 요청이 너무 많아요. 잠시 뒤에 다시 찾기를 눌러 주세요.",
    saveFailed: "이 기기에 진행 내용을 저장하지 못했어요. 새로 고치면 사라질 수 있어요.",
    sendFailed: "보내지 못했어요. 완료하고 보내기를 다시 눌러 주세요.",
    sendInvalid: "보낼 내용에 문제가 있어요. 핵심 정리를 줄이거나 체크한 링크를 빼 주세요.",
  },
  progressLabel: (number: number) => `질문 ${number} / ${CARD_COUNT}`,
  progressAlt: (number: number) => `질문 ${CARD_COUNT}개 중 ${number}번째`,
} as const;

// ---- 한국어 조사·질문 문구 -----------------------------------------------------

/** 마지막 글자가 한글이면 받침으로 을/를을 고르고, 아니면(영문·숫자) "을(를)"로 쓴다. */
export function withEulReul(word: string): string {
  const text = word.trim();
  const code = [...text].pop()?.charCodeAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return `${text}${(code - 0xac00) % 28 === 0 ? "를" : "을"}`;
  return `${text}을(를)`;
}

export interface QuestionContext {
  /** 요청의 "브랜드+품목"(searchQueryOf). */
  subject: string;
  model: string;
  alts: readonly string[];
}

/** 카드의 기본 질문(AI 질문이 없거나 실패했을 때, 그리고 AI 질문의 바탕). */
export function defaultQuestion(id: CardId, context: QuestionContext): string {
  const model = context.model.trim() || "이 제품";
  switch (id) {
    case "model":
      return `${context.subject.trim() || "제품"} 기종을 찾아 주세요.`;
    case "pros":
      return `${model}의 장점이 뭐예요?`;
    case "photo":
      return "제품 사진을 올려 주세요.";
    case "alts":
      return `${withEulReul(model)} 살 때 같이 고민한 다른 제품이 있나요?`;
    case "altReason": {
      const names = context.alts.join(", ") || "다른 제품";
      return `${withEulReul(names)} 왜 같이 고민했나요?`;
    }
    case "benefits":
      return "살 때 받은 혜택이 있나요?";
    case "refs":
      return "참고한 유튜브나 블로그 글이 있나요?";
  }
}

/** 카드의 보조 문구. 없으면 null. */
export function cardHelper(id: CardId): string | null {
  switch (id) {
    case "model":
      return "직접 사 본 기종이 있으면 그 기종을 알려 주세요.";
    case "photo":
      return "상품 상세페이지 이미지나 직접 찍은 착샷이면 됩니다. 1~3장.";
    case "benefits":
      return "지금 살 때 받을 수 있는 혜택도 같이 확인해요.";
    default:
      return null;
  }
}

// ---- 상태 --------------------------------------------------------------------

export type Purchase = "unset" | "bought" | "research";
export type PhotoKind = "proof" | "detail";

export interface ResearchPhoto {
  kind: PhotoKind;
  /** 작은 미리보기(data:image/…). 원본 사진은 기기에도 남기지 않는다. */
  thumb: string;
  /** 사진을 말로 풀어 쓴 설명. 봉사자가 확인·수정한 글. */
  description: string;
}

export interface LinkRef {
  title: string;
  url: string;
}

export type SummarySource = "none" | "ai" | "draft" | "volunteer";

export type HelpKind = "model" | "pros" | "alts" | "altReason" | "benefits" | "refs" | "summary";

export interface HelpEntry {
  /** 이 도움을 받을 때의 입력(helpKey). 입력이 바뀌면 캐시로 쓰지 않는다. */
  key: string;
  response: ResearchResponse;
}

export interface ResearchState {
  v: 1;
  /** 0~6은 카드, 7은 보내기 전 확인. */
  step: number;
  purchase: Purchase;
  model: string;
  pros: string;
  alts: string[];
  altReason: string;
  benefits: string;
  refs: string;
  photos: ResearchPhoto[];
  /** "확인했어요"를 체크한 링크만 결과에 들어간다. */
  checked: { benefits: LinkRef[]; refs: LinkRef[] };
  /** 요약 단계의 핵심 정리 글. 비어 있으면 보낼 때 draftSummaryText로 채운다. */
  summaryText: string;
  /** 핵심 정리 글이 어디서 왔나. 봉사자가 직접 고친 글(volunteer)은 AI 초안으로 덮어쓰지 않는다. */
  summarySource: SummarySource;
  /** ai·draft 글을 채울 때의 입력(helpKey "summary"). 입력이 바뀌면 그 글은 낡은 것이다. */
  summaryKey: string;
  help: Partial<Record<HelpKind, HelpEntry>>;
}

export const RESEARCH_STORAGE_PREFIX = "lh.vol.research.v1.";

export function researchStorageKey(requestId: string): string {
  return `${RESEARCH_STORAGE_PREFIX}${requestId}`;
}

export function emptyResearchState(): ResearchState {
  return {
    v: 1,
    step: 0,
    purchase: "unset",
    model: "",
    pros: "",
    alts: [],
    altReason: "",
    benefits: "",
    refs: "",
    photos: [],
    checked: { benefits: [], refs: [] },
    summaryText: "",
    summarySource: "none",
    summaryKey: "",
    help: {},
  };
}

// ---- 카드 판단(순수) ---------------------------------------------------------

export function isCardAnswered(state: ResearchState, id: CardId): boolean {
  switch (id) {
    case "model":
      return state.model.trim() !== "" && state.purchase !== "unset";
    case "pros":
      return state.pros.trim() !== "";
    case "photo":
      return state.photos.length >= 1;
    case "alts":
      return state.alts.length >= 1;
    case "altReason":
      return state.altReason.trim() !== "";
    case "benefits":
      return state.benefits.trim() !== "" || state.checked.benefits.length > 0;
    case "refs":
      return state.refs.trim() !== "" || state.checked.refs.length > 0;
  }
}

/** 답이 없는 필수 카드(순서대로). */
export function missingRequiredCards(state: ResearchState): CardSpec[] {
  return RESEARCH_CARDS.filter((card) => card.required && !isCardAnswered(state, card.id));
}

export function canSend(state: ResearchState): boolean {
  return missingRequiredCards(state).length === 0;
}

export function isVerified(state: ResearchState): boolean {
  return state.purchase === "bought" && state.photos.some((photo) => photo.kind === "proof");
}

export interface PurchaseBadge {
  kind: "before" | "verified" | "research";
  label: string;
  /** 배지 아래 보조 문구. 없으면 null. */
  note: string | null;
}

export function purchaseBadge(state: ResearchState): PurchaseBadge {
  if (isVerified(state)) return { kind: "verified", label: "구매 인증됨 · 봉사시간 가산", note: null };
  if (state.purchase === "research") return { kind: "research", label: "리서치만", note: null };
  return {
    kind: "before",
    label: "구매 인증 전",
    note: state.purchase === "bought" ? "착샷을 올리면 인증돼요" : null,
  };
}

/** 요약 화면에서 알릴 일: 구매했다고 했지만 착샷이 없어 "리서치만"으로 보내진다. */
export function proofMissingNotice(state: ResearchState): string | null {
  return state.purchase === "bought" && !isVerified(state) ? RESEARCH_COPY.summary.proofMissing : null;
}

/** 지금 구매 상태에서 고를 수 있는 사진 종류. 구매하지 않았으면 상세페이지 캡처만. */
export function allowedPhotoKinds(purchase: Purchase): PhotoKind[] {
  return purchase === "bought" ? ["proof", "detail"] : ["detail"];
}

export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(SUMMARY_STEP, Math.max(0, Math.trunc(step)));
}

export function canGoPrev(state: ResearchState): boolean {
  return state.step > 0;
}

/** "다음"(카드 7은 "요약 보기")을 누를 수 있나. 선택 카드는 늘 가능하고 필수 카드는 답이 있어야 한다. */
export function canGoNext(state: ResearchState): boolean {
  const card = RESEARCH_CARDS[state.step];
  if (!card) return false;
  return !card.required || isCardAnswered(state, card.id);
}

export function nextLabel(state: ResearchState): string {
  return state.step === CARD_COUNT - 1 ? RESEARCH_COPY.buttons.toSummary : RESEARCH_COPY.buttons.next;
}

/** "건너뛰기"를 보일 카드: 선택 카드이고 아직 답이 없을 때(답이 있으면 건너뛴다는 말이 사실이 아니다). */
export function canSkip(state: ResearchState): boolean {
  const card = RESEARCH_CARDS[state.step];
  return card !== undefined && !card.required && !isCardAnswered(state, card.id);
}

export function goTo(state: ResearchState, step: number): ResearchState {
  return { ...state, step: clampStep(step) };
}

export function goToCard(state: ResearchState, id: CardId): ResearchState {
  return goTo(state, RESEARCH_CARDS.findIndex((card) => card.id === id));
}

/** 다음으로. 갈 수 없으면 그대로. */
export function goNext(state: ResearchState): ResearchState {
  return canGoNext(state) ? goTo(state, state.step + 1) : state;
}

export function goPrev(state: ResearchState): ResearchState {
  return canGoPrev(state) ? goTo(state, state.step - 1) : state;
}

// ---- 상태 바꾸기(순수, 새 객체를 돌려준다) -----------------------------------

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

function clipCodePoints(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

/**
 * 구매 여부를 바꾼다. 저장된 사진 종류는 건드리지 않는다(되돌리면 착샷이 살아난다).
 * 구매하지 않았다면 화면 표시와 결과에서만 상세페이지 캡처로 다룬다(effectivePhotoKind).
 */
export function withPurchase(state: ResearchState, purchase: Purchase): ResearchState {
  return { ...state, purchase };
}

/** 지금 구매 상태에서 이 사진을 어떤 종류로 다루나. 구매하지 않았다면 늘 상세페이지 캡처다. */
export function effectivePhotoKind(state: ResearchState, photo: ResearchPhoto): PhotoKind {
  return state.purchase === "bought" ? photo.kind : "detail";
}

/** 대안 제품을 더한다. 빈 값·중복·기종과 같은 이름은 무시하고 최대 2개. */
export function addAlt(state: ResearchState, name: string): ResearchState {
  const value = clipCodePoints(oneLine(name), RESEARCH_LIMITS.nameMax);
  const lower = value.toLowerCase();
  if (
    value === "" ||
    state.alts.length >= RESEARCH_LIMITS.maxAlts ||
    state.alts.some((alt) => alt.toLowerCase() === lower) ||
    state.model.trim().toLowerCase() === lower
  ) {
    return state;
  }
  return { ...state, alts: [...state.alts, value] };
}

export function removeAlt(state: ResearchState, name: string): ResearchState {
  return { ...state, alts: state.alts.filter((alt) => alt !== name) };
}

/** 사진을 더한다(최대 3장, 썸네일 6만 글자 이하). 구매하지 않았다면 새 사진의 종류는 상세페이지 캡처로 맞춘다. */
export function addPhoto(state: ResearchState, photo: ResearchPhoto): ResearchState {
  if (state.photos.length >= RESEARCH_LIMITS.maxPhotos) return state;
  // 기기에 저장하지 못할 썸네일은 받지 않는다(새로 고치면 조용히 사라지기 때문이다).
  if (!photo.thumb.startsWith("data:image/") || photo.thumb.length > RESEARCH_LIMITS.thumbMax) return state;
  const kind = allowedPhotoKinds(state.purchase).includes(photo.kind) ? photo.kind : "detail";
  const description = clipCodePoints(photo.description, RESEARCH_LIMITS.descriptionMax);
  return { ...state, photos: [...state.photos, { ...photo, kind, description }] };
}

export function removePhoto(state: ResearchState, index: number): ResearchState {
  return { ...state, photos: state.photos.filter((_, position) => position !== index) };
}

export function setPhotoDescription(state: ResearchState, index: number, description: string): ResearchState {
  const text = clipCodePoints(description, RESEARCH_LIMITS.descriptionMax);
  return {
    ...state,
    photos: state.photos.map((photo, position) => (position === index ? { ...photo, description: text } : photo)),
  };
}

/** 링크의 "확인했어요" 체크를 켜고 끈다. 같은 주소는 한 번만. */
export function toggleChecked(state: ResearchState, section: "benefits" | "refs", link: LinkRef): ResearchState {
  const list = state.checked[section];
  const next = list.some((entry) => entry.url === link.url)
    ? list.filter((entry) => entry.url !== link.url)
    : [...list, link];
  return { ...state, checked: { ...state.checked, [section]: next } };
}

// ---- AI 도움 캐시 ---------------------------------------------------------------

/** 그 도움을 받을 때 쓴 입력. 같으면 다시 부르지 않고 캐시를 쓴다. */
export function helpKey(state: ResearchState, kind: HelpKind): string {
  const model = state.model.trim();
  switch (kind) {
    case "model":
      return "";
    case "pros":
    case "alts":
    case "benefits":
    case "refs":
      return model;
    case "altReason":
      return JSON.stringify([model, state.alts]);
    case "summary":
      return JSON.stringify([model, state.pros, state.alts, state.altReason, state.benefits, state.refs]);
  }
}

/** 입력이 그대로인 캐시 응답. 없거나 입력이 바뀌었으면 null("다시 찾기"가 아니면 이때만 서버를 부른다). */
export function cachedHelp(state: ResearchState, kind: HelpKind): ResearchResponse | null {
  const entry = state.help[kind];
  return entry && entry.key === helpKey(state, kind) ? entry.response : null;
}

/**
 * 응답을 캐시에 넣는다. key는 요청을 보낼 때의 helpKey다. 응답이 늦게 와서 그 사이 입력이 바뀌었다면
 * 지금 입력의 키와 달라 cachedHelp가 쓰지 않는다(옛 기종의 후보가 새 기종의 캐시가 되지 않는다).
 */
export function withHelp(
  state: ResearchState,
  kind: HelpKind,
  response: ResearchResponse,
  key: string = helpKey(state, kind),
): ResearchState {
  return { ...state, help: { ...state.help, [kind]: { key, response } } };
}

// ---- 핵심 정리 글의 출처 ------------------------------------------------------------

/** 봉사자가 직접 쓴(고친) 글인가. 저장 모양에 출처가 없던 때의 글은 봉사자 글로 본다. */
function isVolunteerSummary(state: ResearchState): boolean {
  return state.summaryText.trim() !== "" && (state.summarySource === "volunteer" || state.summarySource === "none");
}

/** AI·기본 초안이 지금 답과 어긋났나(초안을 채운 뒤 기종이나 답이 바뀌었다). */
export function isSummaryStale(state: ResearchState): boolean {
  return (
    state.summaryText.trim() !== "" &&
    (state.summarySource === "ai" || state.summarySource === "draft") &&
    state.summaryKey !== helpKey(state, "summary")
  );
}

/** 요약 단계에 들어올 때: 낡은 초안은 비운다(봉사자가 쓴 글은 그대로). */
export function dropStaleSummary(state: ResearchState): ResearchState {
  return isSummaryStale(state) ? { ...state, summaryText: "", summarySource: "none", summaryKey: "" } : state;
}

/**
 * 초안을 채운다. 봉사자가 쓴 글이 있으면 그대로 두고, 낡은 초안이거나 비었거나 기본 초안이면 바꾼다.
 * key는 요청 때의 helpKey("summary")이고, 지금 입력과 다르면(응답이 늦게 왔다) 채우지 않는다.
 */
export function fillSummary(
  state: ResearchState,
  text: string,
  source: "ai" | "draft",
  key: string = helpKey(state, "summary"),
): ResearchState {
  if (key !== helpKey(state, "summary")) return state;
  if (isVolunteerSummary(state)) return state;
  if (source === "draft" && state.summarySource === "ai" && state.summaryText.trim() !== "" && !isSummaryStale(state)) {
    return state;
  }
  return { ...state, summaryText: text, summarySource: source, summaryKey: key };
}

/** 봉사자가 글 칸을 고쳤다. 비우면 다시 초안을 받을 수 있다. */
export function setSummaryText(state: ResearchState, text: string): ResearchState {
  const value = clipCodePoints(text, RESEARCH_LIMITS.summaryEditMax);
  return value.trim() === ""
    ? { ...state, summaryText: value, summarySource: "none", summaryKey: "" }
    : { ...state, summaryText: value, summarySource: "volunteer", summaryKey: "" };
}

/** 보낼 핵심 정리 글: 봉사자 글이나 지금 답에 맞는 초안, 아니면 지금 답으로 새로 만든 기본 글. */
export function guideSource(state: ResearchState): string {
  const usable = state.summaryText.trim() !== "" && !isSummaryStale(state);
  return usable ? state.summaryText.trim() : draftSummaryText(state);
}

// ---- 서버 요청·응답 타입 ----------------------------------------------------------

export type ResearchKind = "model" | "pros" | "alts" | "altReason" | "benefits" | "refs" | "photo" | "summary";

/** 웹 검색을 쓰는 종류. 서버가 따로 분당 8회로 센다. */
export const SEARCH_KINDS: readonly ResearchKind[] = ["model", "alts", "benefits", "refs"];

export type ResearchRequestBody =
  | { requestId: string; kind: "model" }
  | { requestId: string; kind: "pros" | "alts" | "benefits" | "refs"; model: string }
  | { requestId: string; kind: "altReason"; model: string; alts: string[] }
  | { requestId: string; kind: "photo"; model: string; photoKind: PhotoKind; image: string }
  | {
      requestId: string;
      kind: "summary";
      model: string;
      pros: string;
      alts: string[];
      altReason: string;
      benefits: string;
      refs: string;
    };

export type ResearchAi = "ok" | "fallback";

export interface ResearchItem {
  name: string;
  note: string;
  url: string | null;
  /** web: 웹 검색 결과(출처 주소 있음) / fixed: 시연용 고정 후보. */
  origin: "web" | "fixed";
}

export interface ResearchLink {
  title: string;
  url: string;
  origin: "web";
}

export interface ResearchShortcut {
  label: string;
  url: string;
}

export type ResearchResponse =
  | { kind: "model" | "alts"; ai: ResearchAi; items: ResearchItem[] }
  | { kind: "pros" | "altReason"; ai: ResearchAi; question: string; hints: string[] }
  | { kind: "benefits"; ai: ResearchAi; links: ResearchLink[]; shortcuts: ResearchShortcut[] }
  | { kind: "refs"; ai: ResearchAi; digest: string[]; links: ResearchLink[]; shortcuts: ResearchShortcut[] }
  | { kind: "photo"; ai: ResearchAi; description: string }
  | { kind: "summary"; ai: ResearchAi; text: string };

/** 상태에서 서버 요청 본문을 만든다(사진 제외). 입력이 부족해도 만들어 주고, 서버가 검사한다. */
export function buildResearchRequest(
  requestId: string,
  kind: HelpKind,
  state: ResearchState,
): ResearchRequestBody {
  const model = state.model.trim();
  switch (kind) {
    case "model":
      return { requestId, kind };
    case "pros":
    case "alts":
    case "benefits":
    case "refs":
      return { requestId, kind, model };
    case "altReason":
      return { requestId, kind, model, alts: [...state.alts] };
    case "summary":
      return {
        requestId,
        kind,
        model,
        pros: state.pros,
        alts: [...state.alts],
        altReason: state.altReason,
        benefits: state.benefits,
        refs: state.refs,
      };
  }
}

export function buildPhotoRequest(
  requestId: string,
  state: ResearchState,
  image: string,
  photoKind: PhotoKind,
): ResearchRequestBody {
  return { requestId, kind: "photo", model: state.model.trim(), photoKind, image };
}

// ---- 바로가기·링크 ---------------------------------------------------------------

const shopShortcut = (shop: "coupang" | "11st" | "gmarket", label: string, query: string): ResearchShortcut => ({
  label,
  url: shopSearchUrl(shop, query),
});

/** 혜택 카드의 쇼핑몰 검색 바로가기(항상 보인다). */
export function benefitShortcuts(query: string): ResearchShortcut[] {
  return [
    shopShortcut("coupang", "쿠팡에서 찾기", query),
    shopShortcut("11st", "11번가에서 찾기", query),
    shopShortcut("gmarket", "G마켓에서 찾기", query),
  ];
}

/** 참고 글 카드의 블로그·유튜브 검색 바로가기(항상 보인다). */
export function refShortcuts(query: string): ResearchShortcut[] {
  const text = `${query} 후기`.trim();
  return [
    {
      label: "네이버 블로그에서 찾기",
      url: `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(text)}`,
    },
    {
      label: "유튜브에서 찾기",
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(text)}`,
    },
  ];
}

/** 요청의 브랜드·품목(없으면 요청 문장)을 잇는다. 기종이 정해지기 전의 검색어. */
export const subjectOf = searchQueryOf;

/** 링크 줄에 보일 사이트 이름(주소의 도메인, www. 제외). 주소가 아니면 빈 글자. */
export function siteNameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

// ---- 핵심 정리 기본 글 -----------------------------------------------------------

const lineOf = (label: string, value: string) => {
  const text = oneLine(value);
  return text === "" ? null : `${label}: ${text}`;
};

/**
 * 답을 그대로 이은 핵심 정리 기본 글. AI 정리가 없거나 실패했을 때, 그리고 봉사자가 비워 둔 채 보낼 때 쓴다.
 * 봉사자가 쓴 말만 담고 새 정보를 더하지 않는다.
 */
export function draftSummaryText(state: ResearchState, max: number = RESEARCH_LIMITS.summaryEditMax): string {
  const lines = [
    lineOf("추천 기종", state.model),
    lineOf("장점", state.pros),
    lineOf("같이 고민한 제품", state.alts.join(", ")),
    lineOf("고민한 이유", state.altReason),
    lineOf("혜택", state.benefits),
    lineOf("참고", state.refs),
  ].filter((line): line is string => line !== null);
  const text = lines.join("\n");
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

// ---- 기기 저장 상태 읽기 --------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

/** href에 넣어도 되는 주소: https로 시작하고 주소로 읽힌다. http, javascript:, data: 는 받지 않는다. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^https:\/\//i.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isLinkRef(value: unknown): value is LinkRef {
  return isObject(value) && isString(value.title) && isHttpsUrl(value.url);
}

function isItem(value: unknown): value is ResearchItem {
  return (
    isObject(value) &&
    isString(value.name) &&
    isString(value.note) &&
    (value.url === null || isHttpsUrl(value.url)) &&
    (value.origin === "web" || value.origin === "fixed")
  );
}

function isLink(value: unknown): value is ResearchLink {
  return isObject(value) && isString(value.title) && isHttpsUrl(value.url) && value.origin === "web";
}

function isShortcut(value: unknown): value is ResearchShortcut {
  return isObject(value) && isString(value.label) && isHttpsUrl(value.url);
}

const everyOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

/** 서버 응답의 모양을 다시 확인한다(화면이 받은 JSON을 믿기 전에). */
export function isResearchResponse(value: unknown): value is ResearchResponse {
  if (!isObject(value) || (value.ai !== "ok" && value.ai !== "fallback")) return false;
  switch (value.kind) {
    case "model":
    case "alts":
      return everyOf(value.items, isItem);
    case "pros":
    case "altReason":
      return isString(value.question) && isStringArray(value.hints);
    case "benefits":
      return everyOf(value.links, isLink) && everyOf(value.shortcuts, isShortcut);
    case "refs":
      return isStringArray(value.digest) && everyOf(value.links, isLink) && everyOf(value.shortcuts, isShortcut);
    case "photo":
      return isString(value.description);
    case "summary":
      return isString(value.text);
    default:
      return false;
  }
}

const HELP_KINDS: readonly HelpKind[] = ["model", "pros", "alts", "altReason", "benefits", "refs", "summary"];

/**
 * localStorage에서 읽은 글자를 상태로 되살린다. 모양이 틀리거나 깨졌으면 null(처음부터 시작).
 * 값은 허용 범위로 맞춰 다시 만든다(손상된 저장값이 화면을 깨지 않게).
 */
export function parseStoredState(raw: string | null): ResearchState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || data.v !== 1) return null;
  const purchase: Purchase =
    data.purchase === "bought" || data.purchase === "research" ? data.purchase : "unset";
  const text = (value: unknown, max: number) => (isString(value) ? clipCodePoints(value, max) : "");
  const photos = Array.isArray(data.photos)
    ? data.photos
        .filter(
          (photo): photo is ResearchPhoto =>
            isObject(photo) &&
            (photo.kind === "proof" || photo.kind === "detail") &&
            isString(photo.thumb) &&
            photo.thumb.startsWith("data:image/") &&
            photo.thumb.length <= RESEARCH_LIMITS.thumbMax &&
            isString(photo.description),
        )
        .slice(0, RESEARCH_LIMITS.maxPhotos)
        .map((photo) => ({
          kind: photo.kind,
          thumb: photo.thumb,
          description: clipCodePoints(photo.description, RESEARCH_LIMITS.descriptionMax),
        }))
    : [];
  const checked = isObject(data.checked) ? data.checked : {};
  const help: ResearchState["help"] = {};
  if (isObject(data.help)) {
    for (const kind of HELP_KINDS) {
      const entry = data.help[kind];
      if (isObject(entry) && isString(entry.key) && isResearchResponse(entry.response) && entry.response.kind === kind) {
        help[kind] = { key: entry.key, response: entry.response };
      }
    }
  }
  const summaryText = text(data.summaryText, RESEARCH_LIMITS.summaryEditMax);
  // 출처가 없는 저장값(옛 모양)이면 글이 있을 때 봉사자 글로 본다.
  const summarySource: SummarySource =
    summaryText.trim() === ""
      ? "none"
      : data.summarySource === "ai" || data.summarySource === "draft" || data.summarySource === "volunteer"
        ? data.summarySource
        : "volunteer";
  return {
    v: 1,
    step: clampStep(typeof data.step === "number" ? data.step : 0),
    purchase,
    model: text(data.model, RESEARCH_LIMITS.nameMax),
    pros: text(data.pros, RESEARCH_LIMITS.answerMax),
    alts: isStringArray(data.alts)
      ? data.alts
          .map((alt) => clipCodePoints(oneLine(alt), RESEARCH_LIMITS.nameMax))
          .filter((alt) => alt !== "")
          .slice(0, RESEARCH_LIMITS.maxAlts)
      : [],
    altReason: text(data.altReason, RESEARCH_LIMITS.answerMax),
    benefits: text(data.benefits, RESEARCH_LIMITS.answerMax),
    refs: text(data.refs, RESEARCH_LIMITS.answerMax),
    photos,
    checked: {
      benefits: everyOf(checked.benefits, isLinkRef) ? checked.benefits.slice(0, RESEARCH_LIMITS.maxLinks) : [],
      refs: everyOf(checked.refs, isLinkRef) ? checked.refs.slice(0, RESEARCH_LIMITS.maxLinks) : [],
    },
    summaryText,
    summarySource,
    summaryKey: summarySource === "ai" || summarySource === "draft" ? text(data.summaryKey, 4000) : "",
    help,
  };
}
