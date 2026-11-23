// /live 단추 이름 표, 말 명령 표, 동의 판정, 화면 낭독 메아리 판정. 설계서 8.3~8.4절.
// 순수 함수만 둔다. 대본(liveScripts.ts)은 이 표의 이름만 쓴다.
import type { LiveDraft } from "@/lib/liveEngine";

export const BUTTONS = {
  start: "대화 시작",
  talk: "말하기",              // 음성 모드의 큰 단추. guiding부터 confirming까지 이름이 바뀌지 않는다
  stopTalking: "말 멈추기",     // 글자 모드의 큰 단추
  sendText: "입력 보내기",      // 글자 모드: 입력 칸 바로 뒤의 단추
  sending: "보내는 중",
  resume: "계속하기",
  retry: "다시 시도",
  newRequest: "새 요청",
  continueTalk: "이어서 하기",
  consent: "이대로 보내기",
  edit: "고치기",
  repeat: "다시 듣기",
  pause: "멈춤",
  help: "도움말",
  rateNormal: "말 빠르기: 보통",
  rateSlow: "말 빠르기: 천천히",
  rateFast: "말 빠르기: 빠르게",
  exit: "끝내기",
  list: "요청 목록 보기",
  home: "처음 화면",
  textInput: "답 입력",         // 글자 입력 칸의 label
  waitSound: "기다리는 동안 소리 내기",  // 체크 상자
} as const;

export type LocalCommand = "help" | "repeat" | "slow" | "fast" | "normal" | "pause" | "end";
export const COMMANDS: { command: LocalCommand; words: string[]; meaning: string }[] = [
  { command: "help",   words: ["도움말", "도움"],            meaning: "사용법을 다시 듣는다" },
  { command: "repeat", words: ["다시", "뭐라고", "다시말해"],   meaning: "방금 말을 다시 듣는다" },
  { command: "slow",   words: ["천천히", "느리게"],           meaning: "말을 천천히 한다" },
  { command: "fast",   words: ["빠르게", "빨리"],             meaning: "말을 빠르게 한다" },
  { command: "normal", words: ["보통", "보통속도"],            meaning: "보통 빠르기로 돌아간다" },
  { command: "pause",  words: ["잠깐", "잠깐만", "잠시만"],     meaning: "잠시 멈춘다" },
  { command: "end",    words: ["그만", "끝", "끝내", "종료"],   meaning: "대화를 끝낼지 묻는다" },
];

/** NFKC, 소문자, 공백·문장부호 제거. */
export function normalizeSpeech(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

const COMMAND_SUFFIX =
  "(?:요|로|으로|해|해요|해줘|해줘요|해주세요|줘|줘요|주세요|말해|말해줘|말해주세요|들려줘|들려주세요|해봐)?";
const COMMAND_PATTERNS = COMMANDS.map((c) => ({
  command: c.command,
  re: new RegExp(`^(?:${c.words.map(normalizeSpeech).join("|")})${COMMAND_SUFFIX}$`),
}));

/** 글 전체가 명령일 때만 명령이다. 다른 말이 섞이면 null. */
export function matchLocalCommand(text: string): LocalCommand | null {
  const n = normalizeSpeech(text);
  if (!n) return null;
  for (const { command, re } of COMMAND_PATTERNS) if (re.test(n)) return command;
  return null;
}

/** "?"나 "？"가 있다. */
export function hasQuestion(text: string): boolean {
  return /[?？]/.test(text);
}

const YES = new Set(["네", "네네", "넵", "예", "예예", "응", "그래", "그래요", "좋아", "좋아요", "좋습니다", "맞아", "맞아요", "맞습니다", "오케이", "ok"]);
const SEND = /^(보내|등록|접수|전달)(해|해요|해줘|해줘요|해주세요|줘|줘요|주세요|요)?$/;
const FILLER = new Set(["이대로", "그대로", "그렇게", "그걸로", "다시", "해", "줘", "주세요", "해주세요", "해줘", "부탁해", "부탁해요", "부탁드려요"]);
const POLITE = new Set(["주시면", "주면", "돼요", "됩니다", "되겠어요", "해도", "좋겠어요", "감사합니다", "고마워요"]);
const NEGATIVE = /아니|아뇨|안\s?돼|지\s?마|말고|말아|잠깐|잠시|바꿔|바꿀|바꾸|고쳐|고칠|고치|수정|취소|틀렸|틀려|근데|그런데|하지만|대신|그리고|추가|또/;
const ECHO = /버튼|단추|링크|흐리게|선택됨|머리말|텍스트\s?필드/;   // 화면 낭독이 덧붙이는 말
export const CONSENT_PLAUSIBLE_MAX = 40;

/** 토큰: NFKC, 소문자로 바꾸고 공백과 문장부호(, . ! ? ~ …)로 나눈다. 이웃한 두 토큰을 붙이면 SEND인 것은 하나로 본다. */
function consentTokens(text: string): string[] {
  const raw = text.normalize("NFKC").toLowerCase().split(/[\s,.!?~…]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1];
    if (next !== undefined && SEND.test(raw[i] + next)) {
      out.push(raw[i] + next);
      i++;
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

/** 물음표, 부정·덧붙임 낱말, 화면 낭독 말이 있으면 두 동의 판정이 모두 거짓이다. */
function consentRejected(text: string): boolean {
  const t = text.normalize("NFKC").toLowerCase();
  return hasQuestion(text) || NEGATIVE.test(t) || ECHO.test(t);
}

const isAffirm = (t: string) => YES.has(t) || SEND.test(t);

/** AI를 거치지 않고 바로 접수할 때 쓴다. 토큰이 모두 YES, SEND, FILLER이고 YES나 SEND가 하나 이상 있다. */
export function isClearConsent(text: string): boolean {
  if (consentRejected(text)) return false;
  const tokens = consentTokens(text);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => isAffirm(t) || FILLER.has(t))) return false;
  return tokens.some(isAffirm);
}

/** AI가 동의라고 판단한 것을 한 번 더 거를 때만 쓴다. 허용 목록에 없는 낱말이 하나라도 있으면 거짓이다. */
export function isPlausibleConsent(text: string): boolean {
  if (text.length > CONSENT_PLAUSIBLE_MAX) return false;
  if (consentRejected(text)) return false;
  const tokens = consentTokens(text);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => isAffirm(t) || FILLER.has(t) || POLITE.has(t))) return false;
  return tokens.some(isAffirm);
}

const ROLE_WORDS = ["흐리게표시됨", "선택됨", "머리말", "버튼", "단추", "링크"];
const SCREEN_TEXTS = new Set([...Object.values(BUTTONS), "음성 도우미", "요청 요약"].map(normalizeSpeech));

/** 화면 낭독(VoiceOver)이 단추 이름을 읽는 소리가 이용자 말로 들어온 것을 거른다. */
export function isScreenReaderEcho(text: string): boolean {
  let n = normalizeSpeech(text);
  let stripped = 0;
  for (let found = true; found; ) {
    found = false;
    for (const role of ROLE_WORDS) {
      if (n.endsWith(role)) {
        n = n.slice(0, -role.length);
        stripped++;
        found = true;
        break;
      }
    }
  }
  if (stripped > 0) return n === "" || SCREEN_TEXTS.has(n);
  return SCREEN_TEXTS.has(n) && matchLocalCommand(text) === null;
}

export const CARD_ECHO_RATIO = 0.6;

function cardTokens(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
}

/** 확인 상태에서 카드 글을 쓸어 넘기며 읽는 낭독이 이용자 말로 들어온 것을 거른다. draft가 없으면 거짓. */
export function isCardEcho(text: string, draft: LiveDraft | null): boolean {
  if (!draft) return false;
  const tokens = cardTokens(text);
  if (tokens.length < 2) return false;
  const card = new Set(
    cardTokens(
      [draft.summary, draft.product, draft.info, draft.options, draft.budget, "제품", "알고 싶은 정보", "옵션", "예산"].join(" "),
    ),
  );
  const hit = tokens.filter((t) => card.has(t)).length;
  return hit / tokens.length >= CARD_ECHO_RATIO;
}
