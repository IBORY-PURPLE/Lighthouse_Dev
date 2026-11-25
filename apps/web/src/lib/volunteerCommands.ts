// 봉사자 첫 화면 입력 해석. 순수 함수만 둔다(서버·AI를 부르지 않는다).

export type HomeCommand = "queue" | "mine" | "reset";

export interface SlashCommand {
  /** 입력창에 치는 명령. */
  command: string;
  /** "/" 메뉴에 보이는 설명. */
  label: string;
  action: HomeCommand;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { command: "/대기열", label: "대기열 보기", action: "queue" },
  { command: "/내담당", label: "내 담당 보기", action: "mine" },
  { command: "/시연초기화", label: "시연용 요청 다시 채우기", action: "reset" },
];

const QUEUE_WORDS = ["대기열", "대기중", "기다리는요청", "새요청", "요청목록", "요청보여"];
const MINE_WORDS = ["내담당", "맡은요청", "내요청", "이어서"];

/** NFKC로 통일하고 소문자로 바꾼다. */
function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** 공백(과 줄바꿈)을 모두 뺀다. */
function squash(text: string): string {
  return text.replace(/\s+/gu, "");
}

/** 공백·문장부호·기호를 모두 뺀다. */
function plain(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** "/"로 시작하는 입력에서 앞부분이 맞는 명령(공백은 무시). "/"만 치면 모두. */
export function filterSlash(text: string): SlashCommand[] {
  const typed = squash(fold(text));
  if (!typed.startsWith("/")) return [];
  return SLASH_COMMANDS.filter((item) => item.command.startsWith(typed));
}

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function without(text: string, words: readonly string[]): string {
  return words.reduce((rest, word) => rest.split(word).join(""), text);
}

/**
 * 입력을 첫 화면 동작으로 바꾼다.
 * "/"로 시작하면 명령과 정확히 같을 때만 받는다. 평소 말은 낱말로 찾고, 대기열과 내 담당이 섞이면 unknown이다.
 * 평소 말로는 시연 초기화를 하지 않는다.
 */
export function parseHomeInput(text: string): HomeCommand | "unknown" {
  const folded = fold(text.trim());
  if (folded.startsWith("/")) {
    const typed = squash(folded);
    return SLASH_COMMANDS.find((item) => item.command === typed)?.action ?? "unknown";
  }
  const body = plain(folded);
  if (body === "") return "unknown";
  // "맡은 요청 보여줘"는 내 담당이다. 내 담당 낱말을 먼저 걷어 낸 나머지로 대기열을 본다.
  const mine = hasAny(body, MINE_WORDS);
  const queue = hasAny(without(body, MINE_WORDS), QUEUE_WORDS);
  if (mine && queue) return "unknown";
  if (mine) return "mine";
  if (queue) return "queue";
  return "unknown";
}

/** 첫 화면 상태 줄·입력창 글자. */
export const HOME_COPY = {
  queueOpened: "대기열을 열었어요",
  mineOpened: "내 담당 목록을 열었어요",
  pick: "왼쪽 대기열에서 요청을 골라 주세요.",
  resetAsk: "시연 요청을 지우고 새로 채울까요?",
  resetDone: "시연용 요청을 새로 채웠어요",
  resetCancelled: "초기화하지 않았어요",
  placeholder: "왼쪽 대기열에서 요청을 고르거나 /를 눌러 명령을 써 보세요.",
} as const;
