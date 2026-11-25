// /live 안내 문구 대본, 음절 세기, 방문 횟수 읽기·쓰기. 설계서 10절.
// 단추 이름과 말 명령은 BUTTONS, COMMANDS에서 끼워 넣는다. 모든 대본은 100음절 이하다.
import { ANSWER_CUE, BUTTONS, COMMANDS, NEXT_WORD, SPEAK_CUE, type LocalCommand } from "@/lib/liveCommands";
import type { InputMode, LiveErrorKind } from "@/lib/liveEngine";

export const LIVE_VISITS_KEY = "lh.live.visits.v1";

/** 저장된 방문 횟수. 못 읽거나 망가졌으면 0. */
export function readVisits(storage: Pick<Storage, "getItem">): number {
  try {
    const n = Number.parseInt(storage.getItem(LIVE_VISITS_KEY) ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 방문 횟수를 1 올린다. 저장 실패는 무시한다. */
export function markVisit(storage: Pick<Storage, "getItem" | "setItem">): void {
  try {
    storage.setItem(LIVE_VISITS_KEY, String(readVisits(storage) + 1));
  } catch {
    // 저장이 막혀도 대화는 계속된다.
  }
}

// 작은따옴표로 적는 단추 이름과 말 명령. 예시 문장에는 따옴표를 쓰지 않는다.
const q = (name: string) => `'${name}'`;
const B = {
  talk: q(BUTTONS.talk),
  stopTalking: q(BUTTONS.stopTalking),
  sendText: q(BUTTONS.sendText),
  resume: q(BUTTONS.resume),
  retry: q(BUTTONS.retry),
  newRequest: q(BUTTONS.newRequest),
  continueTalk: q(BUTTONS.continueTalk),
  consent: q(BUTTONS.consent),
  repeat: q(BUTTONS.repeat),
  pause: q(BUTTONS.pause),
  exit: q(BUTTONS.exit),
  list: q(BUTTONS.list),
  home: q(BUTTONS.home),
  textInput: q(BUTTONS.textInput),
};
const word = (command: LocalCommand) => q(COMMANDS.find((c) => c.command === command)!.words[0]);
const W = {
  help: word("help"),
  repeat: word("repeat"),
  slow: word("slow"),
  fast: word("fast"),
  pause: word("pause"),
  end: word("end"),
};

const SCRIPTS = {
  guideFirstVoice: `저는 사고 싶은 제품의 혜택과 정보를 대신 찾아 드리는 도우미예요. 원하는 제품과 알고 싶은 정보, 원하는 옵션을 말씀해 주시면 리서치 봉사자에게 전달해 답을 받아 드릴게요. 띵 소리가 나면 말씀하세요. 제 말을 끊으려면 ${B.talk} 단추를 누르세요.`,
  micHint: `마이크 허용 창이 뜨면 ${q("허용")}을 눌러 주세요.`,
  guideFirstText: `저는 사고 싶은 제품의 혜택과 정보를 대신 찾아 드리는 도우미예요. 원하는 제품과 알고 싶은 정보, 원하는 옵션을 알려 주시면 리서치 봉사자에게 전달해 답을 받아 드릴게요. ${B.textInput} 칸에 쓰거나 받아쓰기로 말하고 ${B.sendText} 단추를 누르세요.`,
  guideReturnVoice: "다시 오셨네요. 원하는 제품과 알고 싶은 정보, 원하는 옵션을 말씀해 주세요. 띵 소리가 나면 말씀하세요.",
  guideReturnText: `다시 오셨네요. ${B.textInput} 칸에 원하는 제품과 알고 싶은 정보, 원하는 옵션을 쓰고 ${B.sendText} 단추를 눌러 주세요.`,
  guideNewVoice: "새 요청을 시작할게요. 원하는 제품과 알고 싶은 정보, 원하는 옵션을 말씀해 주세요. 띵 소리가 나면 말씀하세요.",
  guideNewText: `새 요청을 시작할게요. ${B.textInput} 칸에 쓰고 ${B.sendText} 단추를 눌러 주세요.`,
  resumed: "이어서 할게요.",
  helpVoice: `원하는 제품, 알고 싶은 정보, 원하는 옵션을 말씀해 주시면 봉사자에게 전달해 드려요. 띵 소리가 난 뒤에 말씀하세요. 제 말을 끊으려면 ${B.talk} 단추를 누르세요. 더 들으려면 ${W.help}이라고 한 번 더 말씀하세요.`,
  helpMoreVoice: `VoiceOver를 쓰시면 ${B.talk} 단추를 찾아 두 번 탭해서 제 말을 멈출 수 있어요. VoiceOver를 쓰지 않으면 화면을 길게 눌러도 돼요. ${W.repeat}는 다시 듣기, ${W.slow}와 ${W.fast}는 말 빠르기, ${W.pause}은 멈춤, ${B.exit}는 대화 끝내기예요.`,
  helpText: `원하는 제품, 알고 싶은 정보, 원하는 옵션을 알려 주시면 봉사자에게 전달해 드려요. ${B.textInput} 칸에 쓰고 ${B.sendText} 단추를 누르세요. 제 말을 멈추려면 ${B.stopTalking} 단추를 누르세요. ${B.repeat}, ${B.pause}, ${B.exit} 단추와 말 빠르기 단추도 있어요.`,
  silence1: "천천히 말씀하셔도 돼요. 띵 소리가 나면 말씀하세요.",
  manualGuide: `말씀하시다 쉬어도 계속 듣고 있어요. 다 말씀하신 뒤 ${q(NEXT_WORD)}이라고 하시면 넘어갈게요. ${SPEAK_CUE}`,
  manualMore: `더 말씀하셔도 돼요. 다 말씀하셨으면 ${q(NEXT_WORD)}이라고 해 주세요.`,
  silence2: `무엇을 말할지 모르겠으면 ${W.help}이라고 해 보세요. 예를 들면 전기밥솥, 할인 혜택이 궁금해요, 이렇게 말씀하시면 돼요.`,
  extendAsk: "계속 들을까요? 아무 말씀이나 해 주세요. 20초 동안 조용하면 잠시 멈출게요.",
  pausedBySilence: `잠시 멈췄어요. 이어서 하려면 ${B.resume} 단추를 누르세요.`,
  pausedByUser: `멈췄어요. 이어서 하려면 ${B.resume} 단추를 누르세요.`,
  pausedWarn: `20초 뒤에 대화를 끝낼게요. 이어서 하려면 ${B.resume} 단추를 누르세요.`,
  pausedReturn: `멈춰 있어요. 이어서 하려면 ${B.resume} 단추를 누르세요.`,
  turnCancelled: "방금 말씀은 보내지 않았어요. 띵 소리가 나면 다시 말씀해 주세요.",
  waiting1: "알아보고 있어요. 잠시만요.",
  waiting2: "조금 더 걸리고 있어요.",
  editPrompt: "고칠 내용을 말씀해 주세요.",
  editPromptText: `고칠 내용을 ${B.textInput} 칸에 써 주세요.`,
  confirmAgain: `{summary} 이 내용으로 봉사자에게 보낼까요? ${ANSWER_CUE}`,
  // 단추를 가리키지 않는다. 메인 단추만 남긴 화면에는 [이대로 보내기]가 없다.
  confirmHint: `보내려면 ${q("네")}라고 말씀해 주세요. 요약을 다시 들으려면 ${W.repeat}라고 하세요. 고칠 내용이 있으면 말씀해 주세요.`,
  confirmRetell: `요약을 다시 들려 드릴게요. {summary} 이 내용으로 봉사자에게 보낼까요? ${ANSWER_CUE}`,
  registering: "요청을 봉사자에게 보내고 있어요.",
  registered: `등록됐어요. 접수 번호는 {n}번이에요. 봉사자가 찾아보고 답을 보내면 요청 목록에서 들을 수 있어요. 목록은 ${B.list}, 다른 요청은 ${B.newRequest} 단추를 누르세요.`,
  registeredEnded: `등록됐어요. 접수 번호는 {n}번이에요. 봉사자가 찾아보고 답을 보내면 처음 화면의 요청 목록에서 들을 수 있어요. 다른 요청은 ${B.newRequest} 단추를 누르세요.`,
  registerRetry: `접수가 아직 안 됐어요. 요청 내용은 그대로 있어요. 다시 보내려면 띵 소리가 난 뒤 ${q("다시 보내")}라고 말씀해 주세요.`,
  registerRetryText: `접수가 아직 안 됐어요. 요청 내용은 그대로 있어요. 다시 보내려면 ${B.textInput} 칸에 ${q("네")}라고 쓰고 ${B.sendText} 단추를 누르세요.`,
  registerUnknown: `접수됐는지 확인하지 못했어요. 다시 보내도 같은 요청으로 처리돼요. 다시 보내려면 띵 소리가 난 뒤 ${q("다시 보내")}라고 말씀해 주세요.`,
  registerUnknownText: `접수됐는지 확인하지 못했어요. 다시 보내도 같은 요청으로 처리돼요. 다시 보내려면 ${B.textInput} 칸에 ${q("네")}라고 쓰고 ${B.sendText} 단추를 누르세요.`,
  registerBusy: "지금 요청이 많아요. 잠시 뒤에 다시 보낼게요.",
  registerRejected: `이 요청은 접수하지 못했어요. ${B.newRequest} 단추를 눌러 처음부터 다시 해 주세요.`,
  registerConflict: "요청은 이미 접수된 것으로 보여요. 다만 이 기기에서는 접수 번호를 확인하지 못했어요. 같은 요청을 다시 보내지 않으셔도 돼요.",
  endAsk: "대화를 끝낼까요? 끝내려면 네, 계속하려면 아니요라고 말씀해 주세요.",
  endCancelled: "계속할게요.",
  endedRegistered: "대화를 마쳤어요. 요청은 등록돼 있어요.",
  endedUnregistered: `대화를 마쳤어요. 요청은 아직 보내지 않았어요. 이어서 하려면 ${B.continueTalk} 단추를 누르세요.`,
  endedSending: "대화를 마쳤어요. 요청을 보내고 있어요. 결과가 오면 바로 알려 드릴게요.",
  endedSendFailed: `요청이 접수됐는지 확인하지 못했어요. ${B.continueTalk} 단추를 누르면 다시 보낼 수 있어요.`,
  endedEmpty: "대화를 마쳤어요.",
  // 말로 끝냈을 때("끝내 줘" → "네"). 읽고 나면 화면이 /live 처음 상태로 돌아간다.
  endedHome: "대화를 마쳤어요. 메인 화면으로 돌아갈게요.",
  endedHomeRegistered: "대화를 마쳤어요. 요청은 등록돼 있어요. 메인 화면으로 돌아갈게요.",
  endedHomeUnsent: "대화를 마쳤어요. 요청은 보내지 않았어요. 메인 화면으로 돌아갈게요.",
  // 끝내고 싶다는 말을 들었을 때: 바로 끝내지 않고 끝내는 말을 알려 준다.
  endGuide: `대화를 끝내고 메인 화면으로 가시려면 ${B.exit}라고 말씀해 주세요.`,
  rateSlow: "천천히 말할게요.",
  rateFast: "빠르게 말할게요.",
  rateNormal: "보통 빠르기로 말할게요.",
  sessionWarn: "연결 시간이 1분쯤 남았어요. 시간이 되면 연결을 새로 하고 이어 갈게요.",
  sessionWarnLast: `1분 뒤 대화가 잠시 멈춰요. 내용은 남아 있고 ${B.continueTalk} 단추로 계속할 수 있어요.`,
  sessionRenewed: "연결을 새로 하고 있어요. 띵 소리가 나면 이어서 말씀해 주세요.",
  sessionOver: `대화 시간이 다 됐어요. 지금까지 내용은 남아 있어요. 이어서 하려면 ${B.continueTalk} 단추를 누르세요.`,
  engineSwitchedVoice: "연결 방식을 바꾸고 있어요. 띵 소리가 나면 이어서 말씀해 주세요.",
  engineSwitchedText: `연결 방식을 바꿨어요. 이제 ${B.textInput} 칸에 쓰고 ${B.sendText} 단추를 눌러 주세요.`,
  micRetry: `마이크를 켜지 못했어요. ${B.talk} 단추를 눌러 다시 해 보세요.`,
  micWaiting: `마이크 허용을 기다리고 있어요. 브라우저의 허용 창에서 ${q("허용")}을 눌러 주세요.`,
  micGiveUp: `마이크가 아직 켜지지 않았어요. 허용한 뒤 ${B.talk} 단추를 눌러 다시 해 보세요.`,
  micDenied: `마이크를 쓸 수 없어요. 아이폰은 설정 앱의 Safari, 컴퓨터는 브라우저의 사이트 설정에서 마이크를 허용하면 말로 할 수 있어요. 지금은 ${B.textInput} 칸에 쓰고 ${B.sendText} 단추를 눌러 주세요.`,
  speechUnavailable: `이 화면에서는 음성 인식을 쓸 수 없어요. ${B.textInput} 칸에 쓰거나 받아쓰기로 말하고 ${B.sendText} 단추를 눌러 주세요.`,
  rateLimited: "지금 요청이 많아요. {s}초 뒤에 이어갈게요.",
  timeout: "답이 늦어지고 있어요. 방금 말씀을 한 번 더 해 주시겠어요?",
  failed: "답을 받지 못했어요. 방금 말씀을 한 번 더 해 주시겠어요?",
  tooLong: "말씀이 너무 길어요. 짧게 나눠서 다시 말씀해 주세요.",
  tooLongText: "글이 너무 길어요. 짧게 나눠서 다시 보내 주세요.",
  failedRepeated: `도우미 연결에 문제가 계속 생기고 있어요. 잠시 뒤 ${B.retry} 단추를 눌러 주세요.`,
  conversationBroken: `대화를 이어 가지 못했어요. ${B.newRequest} 단추를 눌러 처음부터 다시 해 주세요.`,
  dailyCap: `오늘은 도우미 이용량이 다 찼어요. 나중에 다시 이용해 주세요. 처음 화면으로 가려면 ${B.home} 단추를 누르세요.`,
  offline: `인터넷 연결이 끊겼어요. 연결된 뒤 ${B.retry} 단추를 눌러 주세요.`,
  notConfigured: `지금은 음성 도우미를 쓸 수 없어요. 잠시 뒤 다시 와 주세요. 처음 화면으로 가려면 ${B.home} 단추를 누르세요.`,
  connectFailed: `연결하지 못했어요. ${B.retry} 단추를 눌러 주세요.`,
} as const;

export type ScriptId = keyof typeof SCRIPTS;
/** 모든 대본 id. 시험이 표 전체를 훑을 때 쓴다. */
export const SCRIPT_IDS = Object.keys(SCRIPTS) as ScriptId[];

/** 대본 글. {n}, {s}, {summary}를 값으로 바꾼다. 값이 없으면 빈 글이다. */
export function script(id: ScriptId, vars?: { n?: number; s?: number; summary?: string }): string {
  return (SCRIPTS[id] as string)
    .replace("{n}", vars?.n === undefined ? "" : String(vars.n))
    .replace("{s}", vars?.s === undefined ? "" : String(vars.s))
    .replace("{summary}", vars?.summary ?? "");
}

/** 처음 안내 대본. "new"는 [새 요청] 뒤다. */
export function guideFor(visit: "first" | "returning" | "new", inputMode: InputMode): ScriptId {
  const text = inputMode === "text";
  if (visit === "first") return text ? "guideFirstText" : "guideFirstVoice";
  if (visit === "returning") return text ? "guideReturnText" : "guideReturnVoice";
  return text ? "guideNewText" : "guideNewVoice";
}

/** 오류 종류에 맞는 대본. repeated: 같은 실패가 연달아 나서 더 강하게 알린다(AI 실패 3회, 400·413 3회). */
export function errorScriptFor(kind: LiveErrorKind, repeated: boolean): ScriptId {
  switch (kind) {
    case "mic_blocked": return "micRetry";
    case "mic_denied": return "micDenied";
    case "speech_unavailable": return "speechUnavailable";
    case "offline": return "offline";
    case "rate_limited": return "rateLimited";
    case "timeout": return repeated ? "failedRepeated" : "timeout";
    case "failed": return repeated ? "failedRepeated" : "failed";
    case "bad_request": return repeated ? "conversationBroken" : "tooLong";
    case "unavailable_today": return "dailyCap";
    case "not_configured": return "notConfigured";
    case "connect_failed": return "connectFailed";
    case "register_rejected": return "registerRejected";
    case "register_conflict": return "registerConflict";
  }
}

export const SCRIPT_MAX_SYLLABLES = 100;

/** 한글 음절 글자 1, 숫자 1, 라틴 글자는 낱말마다 2자당 1(올림). 그 밖의 글자는 세지 않는다. */
export function countSyllables(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/[가-힣]|\d|[A-Za-z]+/g)) {
    const t = m[0];
    n += /^[A-Za-z]/.test(t) ? Math.ceil(t.length / 2) : 1;
  }
  return n;
}
