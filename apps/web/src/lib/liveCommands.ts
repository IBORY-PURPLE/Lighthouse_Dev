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
  commands: "명령어 안내",       // 오른쪽 위 ? 단추의 이름
  closeCommands: "안내 닫기",
} as const;

/**
 * 이용자가 말할 차례를 알리는 끝말. 띵 소리가 안 들릴 때가 있어(2026-11-25 이용자 실기기 확인) AI와 앱이 질문 끝에 이 말을 한다.
 * 이용자는 이 말이 끝난 것을 듣고 답을 시작한다.
 */
export const ANSWER_CUE = "이제 천천히 답변해 주세요.";
export const SPEAK_CUE = "이제 천천히 말씀해 주세요.";

/** 말로 끝냈을 때의 마침 대본 id. 화면은 이 대본을 다 읽으면 /request로 이동한다. */
export const ENDED_REQUEST_SPEAKING: ReadonlySet<string> = new Set(["endedHome", "endedHomeRegistered", "endedHomeUnsent"]);

/** ? 단추가 보여 주는 말 명령 목록. 화면 글이다(대본이 아니다). */
export const COMMAND_GUIDE: { say: string; does: string }[] = [
  { say: "다음", does: "다 말한 뒤 다음 질문으로 넘어가요" },
  { say: "다시", does: "방금 들은 말을 다시 들어요" },
  { say: "천천히, 빠르게, 보통", does: "말 빠르기를 바꿔요" },
  { say: "도움말", does: "사용법을 들어요" },
  { say: "멈춰 줘, 잠깐", does: "대화를 잠시 멈춰요. 이어서 하려면 계속하기 단추를 눌러요" },
  { say: "끝내기", does: "대화를 끝내고 상품 요청 화면으로 돌아가요" },
  { say: "네, 보내 줘", does: "요약을 들은 뒤 봉사자에게 보내요" },
];

export type LocalCommand = "help" | "repeat" | "slow" | "fast" | "normal" | "pause" | "end" | "exit";
export const COMMANDS: { command: LocalCommand; words: string[]; meaning: string }[] = [
  { command: "help",   words: ["도움말", "도움"],            meaning: "사용법을 다시 듣는다" },
  { command: "repeat", words: ["다시", "뭐라고", "다시말해"],   meaning: "방금 말을 다시 듣는다" },
  { command: "slow",   words: ["천천히", "느리게"],           meaning: "말을 천천히 한다" },
  { command: "fast",   words: ["빠르게", "빨리"],             meaning: "말을 빠르게 한다" },
  { command: "normal", words: ["보통", "보통속도"],            meaning: "보통 빠르기로 돌아간다" },
  { command: "pause",  words: ["잠깐", "잠깐만", "잠시만", "멈춰", "정지"],     meaning: "잠시 멈춘다" },
  // 끝내고 싶다는 말: 바로 끝내지 않고 '끝내기'라고 말하라고 알려 준다(잘못 알아들어 대화를 잃지 않게).
  { command: "end",    words: ["그만", "끝", "끝내", "종료", "끝내고싶어", "끝내고싶어요", "그만하고싶어", "그만하고싶어요", "끝낼래", "그만할래", "나가고싶어", "나갈래"],   meaning: "끝내는 방법을 알려 준다" },
  // 이 말을 하면 바로 끝내고 상품 요청 화면(/request)으로 돌아간다.
  // '네 끝내기', '끝내기 다음'처럼 대답 말이나 넘기는 말이 붙어도 받는다(붙으면 명령으로 안 잡혀 같은 안내가 되풀이된다).
  { command: "exit",   words: ["끝내기", "네끝내기", "끝내기다음", "네끝내기다음", "끝내기할게"], meaning: "대화를 끝내고 상품 요청 화면으로 돌아간다" },
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

// '다음' 방식(LIVE_ADVANCE=manual): 이용자가 이 말을 해야 모은 말을 AI에게 넘긴다. 말 명령(COMMANDS)과 달리 다른 말 끝에 붙어도 듣는다.
const NEXT_RE = /^(?:다음(?:단계|질문|으로|거)?(?:넘어가|넘어갈게|갈게|가)?|넘어가|넘어갈게|다했어|다말했어|이상이에요|이상입니다)(?:요|줘|줘요|주세요|자|죠)?$/;
const NEXT_TAIL_MAX = 3;
/** 안내 문구에 적는 대표 낱말. */
export const NEXT_WORD = "다음";

/** 글 전체가 '다음으로 넘어가자'는 말인가. */
export function isNextCommand(text: string): boolean {
  const n = normalizeSpeech(text);
  return n !== "" && NEXT_RE.test(n);
}

/** 글 끝의 '다음' 말을 떼어 낸다. next: 넘어가자는 말이 있었다. content: 그 말을 뺀 나머지(없으면 ""). */
export function splitNext(text: string): { content: string; next: boolean } {
  const trimmed = text.trim();
  if (isNextCommand(trimmed)) return { content: "", next: true };
  const tokens = trimmed.split(/\s+/);
  for (let k = Math.min(NEXT_TAIL_MAX, tokens.length - 1); k >= 1; k--) {
    if (isNextCommand(tokens.slice(-k).join(" "))) return { content: tokens.slice(0, -k).join(" "), next: true };
  }
  return { content: trimmed, next: false };
}

/** "?"나 "？"가 있다. */
export function hasQuestion(text: string): boolean {
  return /[?？]/.test(text);
}

const YES = new Set(["네", "네네", "넵", "예", "예예", "응", "그래", "그래요", "좋아", "좋아요", "좋습니다", "맞아", "맞아요", "맞습니다", "오케이", "ok"]);
const SEND = /^(보내|등록|접수|전달)(해|해요|해줘|해줘요|해주세요|줘|줘요|주세요|주십시오|세요|요)?$/;
const FILLER = new Set(["이대로", "그대로", "그렇게", "그걸로", "다시", "해", "줘", "주세요", "해주세요", "해줘", "부탁해", "부탁해요", "부탁드려요", "부탁드립니다", "부탁합니다", "주십시오", "해주십시오", "음", "어", "아", "그럼", "그러면", "해요", "하세요", "해줘요"]);
// "그렇게 해 주세요", "이대로 부탁해요"처럼 가리키는 말 + 해 달라는 말이 함께 있으면 동의다(실호출 2026-11-24: 이 말이 동의로 잡히지 않아 대화가 헛돌았다).
const DEICTIC = new Set(["이대로", "그대로", "그렇게", "그걸로"]);
const DO_IT = new Set(["해", "해요", "해줘", "해줘요", "해주세요", "하세요", "주세요", "줘", "부탁해", "부탁해요", "부탁드려요", "부탁드립니다", "부탁합니다", "주십시오", "해주십시오"]);
// '괜찮아요'·'됐어요'는 혼자 쓰면 거절일 수 있다. FILLER가 아니라 POLITE에만 두어, 앞에 YES·SEND가 있고 AI도 동의로 본 경우에만 통과시킨다.
const POLITE = new Set(["주시면", "주면", "돼요", "됩니다", "되겠어요", "해도", "좋겠어요", "감사합니다", "고마워요", "괜찮아요", "괜찮습니다", "됐어요", "됐습니다", "할게요"]);
const NEGATIVE = /아니|아뇨|안\s?돼|지\s?마|말고|말아|잠깐|잠시|바꿔|바꿀|바꾸|고쳐|고칠|고치|수정|취소|틀렸|틀려|근데|그런데|하지만|대신|그리고|추가|또/;
const ECHO = /버튼|단추|링크|흐리게|선택됨|머리말|텍스트\s?필드/;   // 화면 낭독이 덧붙이는 말
export const CONSENT_PLAUSIBLE_MAX = 40;

/** 토큰: NFKC, 소문자로 바꾸고 공백과 문장부호(, . ! ? ~ …)로 나눈다. 이웃한 두 토큰을 붙이면 SEND이거나 동의 낱말 표(FILLER, DO_IT, POLITE)에 있는 것은 하나로 본다("부탁 드립니다"). */
function consentTokens(text: string): string[] {
  const raw = text.normalize("NFKC").toLowerCase().split(/[\s,.!?~…]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1];
    const joined = next === undefined ? "" : raw[i] + next;
    if (next !== undefined && (SEND.test(joined) || FILLER.has(joined) || DO_IT.has(joined) || POLITE.has(joined))) {
      out.push(joined);
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
/** 동의 낱말(YES, SEND)이 있거나, 가리키는 말과 해 달라는 말이 함께 있다. */
const hasAffirm = (tokens: string[]) =>
  tokens.some(isAffirm) || (tokens.some((t) => DEICTIC.has(t)) && tokens.some((t) => DO_IT.has(t)));

/** AI를 거치지 않고 바로 접수할 때 쓴다. 토큰이 모두 YES, SEND, FILLER이고 YES나 SEND가 하나 이상 있다. */
export function isClearConsent(text: string): boolean {
  if (consentRejected(text)) return false;
  if (normalizeSpeech(text) === "요청보내기") return true;
  const tokens = consentTokens(text);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => isAffirm(t) || FILLER.has(t))) return false;
  return hasAffirm(tokens);
}

/** AI가 동의라고 판단한 것을 한 번 더 거를 때만 쓴다. 허용 목록에 없는 낱말이 하나라도 있으면 거짓이다. */
export function isPlausibleConsent(text: string): boolean {
  if (text.length > CONSENT_PLAUSIBLE_MAX) return false;
  if (consentRejected(text)) return false;
  const tokens = consentTokens(text);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => isAffirm(t) || FILLER.has(t) || POLITE.has(t))) return false;
  return hasAffirm(tokens);
}

const DECLINE = /^(?:아니요?|아뇨|아니오|아냐|아니에요|아니야)?(?:계속(?:할게요?|해요?|하겠습니다|할래요?|해줘요?)?|안끝낼래요?|끝내지마(?:세요)?)?$/;

/** "끝낼까요?"에 대한 "아니요"·"계속할게요". 글 전체가 거절이나 계속하겠다는 말일 때만 참이다. 다른 말이 섞이면 거짓. */
export function isDecline(text: string): boolean {
  if (hasQuestion(text)) return false;
  const n = normalizeSpeech(text);
  return n !== "" && DECLINE.test(n);
}

const ROLE_WORDS = ["흐리게표시됨", "선택됨", "머리말", "버튼", "단추", "링크"];
const SCREEN_TEXTS = new Set([...Object.values(BUTTONS), "음성 도우미", "요청 요약", "대화 중", "생각 중", "말 명령어"].map(normalizeSpeech));

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

/** 첫 안내가 마이크에 되들어왔을 때, 긴 구간의 작은 받아쓰기 오차를 허용한다. */
export function isIntroEcho(heard: string, intro: string): boolean {
  if (heard.length < 16 || !intro) return false;
  const tolerance = Math.min(4, Math.ceil(heard.length * 0.12));
  if (heard.length > intro.length + tolerance) return false;

  // 시작 칸을 0으로 두어 안내 전체의 어느 연속 구간과도 비교할 수 있게 한다.
  let previous = new Uint16Array(intro.length + 1);
  let current = new Uint16Array(intro.length + 1);
  for (let i = 1; i <= heard.length; i++) {
    current[0] = i;
    for (let j = 1; j <= intro.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (heard[i - 1] === intro[j - 1] ? 0 : 1),
      );
    }
    [previous, current] = [current, previous];
  }
  return previous.some((distance) => distance <= tolerance);
}

function cardTokens(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
}

/** 요약 문장의 줄 머리("제품은")는 카드 화면의 이름표("제품")로 읽혀도 같은 낱말로 본다. */
const CARD_LABELS = new Set(["제품은", "정보는", "옵션은", "예산은"]);
const sameCardToken = (said: string, card: string) => said === card || (CARD_LABELS.has(card) && said === card.slice(0, -1));

/**
 * 확인 상태에서 카드 글을 쓸어 넘기며 읽는 낭독이 이용자 말로 들어온 것을 거른다. draft가 없으면 거짓.
 * 이용자 말을 버리는 판정이라, 말한 낱말이 모두 요약 글의 이어진 한 구간과 차례대로 같을 때만 메아리로 본다.
 * - 낱말이 하나라도 다르면 이용자가 한 말이다. 다른 제품·다른 금액·고치는 말이 그렇다
 *   (Codex 3차 지적 1 "소니 헤드폰 말고 보스 헤드폰", 4차 지적 1: 요약을 되풀이하며 "20만 원"만 "30만 원"으로 바꾼 말).
 * - 중간을 건너뛰거나 순서를 바꾼 말("무선 말고 유선")도 이용자가 한 말이다.
 * - 물음, 동의로 읽히는 말은 메아리가 아니다.
 * 잘못 받아 적힌 낭독은 거르지 못하고 AI로 간다. 이용자 말을 버리는 것보다 낫다.
 */
export function isCardEcho(text: string, draft: LiveDraft | null): boolean {
  if (!draft) return false;
  const tokens = cardTokens(text);
  if (tokens.length < 2) return false;
  if (hasQuestion(text) || isClearConsent(text) || isPlausibleConsent(text)) return false;
  const card = cardTokens(draft.summary);
  for (let start = 0; start + tokens.length <= card.length; start++) {
    if (tokens.every((token, at) => sameCardToken(token, card[start + at]))) return true;
  }
  return false;
}
