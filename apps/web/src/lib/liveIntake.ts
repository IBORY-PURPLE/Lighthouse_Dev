import { ANSWER_CUE, normalizeSpeech, splitNext } from "@/lib/liveCommands";
import type { LiveChatStatus, LiveSlots, LiveTurn } from "@/lib/liveEngine";
import { cleanSlot, decodeAiTurn, EMPTY_SLOTS, groundSlots, isIntakeSkip, PRODUCT_CONDITION_ANSWER_MAX, PRODUCT_CONDITIONS_MAX, PURCHASE_TIMING_MAX, readSlots, SLOT_MAX } from "@/lib/liveText";

const ASK_PRODUCT = "어떤 제품을 찾으세요?";
const ASK_BUDGET = "예산은 어느 정도로 생각하세요?";
const ASK_TIMING = "이 제품이 언제까지 필요하세요?";

const GENERAL = [
  ["용도", "어떤 용도로 쓰실 제품이에요?"],
  ["중요한 특징", "이 제품에서 어떤 특징이 가장 중요하세요?"],
  ["피하고 싶은 조건", "제품을 고를 때 피하고 싶은 조건이 있으세요?"],
] as const;

const PROFILES = [
  { matches: /헤드셋|헤드폰|이어폰|에어팟|버즈/i, questions: [
    ["노이즈 캔슬링", "노이즈 캔슬링이 필요하세요?"],
    ["착용 방식", "귀를 덮는 방식과 귀에 꽂는 방식 중 어떤 게 편하세요?"],
    ["연결 방식", "무선과 유선 중 어느 쪽을 원하세요?"],
    ["주 용도", "게임, 통화, 음악 중 어디에 주로 쓰실 거예요?"],
  ] },
  { matches: /노트북|맥북|랩톱|laptop|갤럭시북|그램/i, questions: [
    ["브랜드", "애플이나 삼성처럼 선호하는 브랜드가 있으세요?"],
    ["주 용도", "업무, 공부, 영상 편집처럼 주로 어떤 일을 하실 거예요?"],
    ["화면 크기", "원하는 화면 크기가 있으세요?"],
    ["휴대성", "자주 들고 다닐 제품이라 무게도 중요하세요?"],
  ] },
  { matches: /의류|옷|상의|하의|코트|재킷|셔츠|바지|원피스|티셔츠|니트|청바지|후드/i, questions: [
    ["옷 종류", "상의와 하의 중 어떤 옷을 찾으세요?"],
    ["브랜드", "선호하는 브랜드가 있으세요?"],
    ["사이즈", "찾으시는 사이즈가 어떻게 되세요?"],
    ["색상", "원하는 색이 있으세요?"],
  ] },
] as const;

function questionsFor(product: string) {
  return PROFILES.find(({ matches }) => matches.test(product))?.questions ?? GENERAL;
}

const ANSWER_FIELDS = [
  ["브랜드", /브랜드|제조사|애플|삼성|레노버|아수스|엘지|ASUS|LG/i],
  ["주 용도", /용도|주로\s*(?:어디|뭘|어떤\s*일)|공부|학습|사무|문서\s*작업|게임용|업무용|작업용|편집용/],
  ["화면 크기", /화면\s*(?:크기|이|은|사이즈|인치)|디스플레이\s*크기|\d\s*인치/],
  ["휴대성", /휴대|무게|가벼|가볍|무겁|\d\s*(?:kg|킬로그램)/i],
  ["저장공간", /저장\s*(?:공간|용량)|SSD|하드\s*디스크/i],
  ["운영체제", /운영\s*체제|윈도우|맥\s*(?:OS|오에스)|macOS/i],
  ["노이즈 캔슬링", /노이즈\s*캔슬링|소음\s*차단/],
  ["착용 방식", /착용|귀를\s*덮|귀에\s*(?:꽂|끼)/],
  ["연결 방식", /연결\s*방식|무선|유선|블루투스/],
  ["옷 종류", /옷\s*종류|상의|하의/],
  ["사이즈", /사이즈|치수|사이즈\s*M/i],
  ["색상", /색상|색깔|무슨\s*색|어떤\s*색/],
  ["예산", /예산|얼마까지|어느\s*정도(?:의)?\s*가격|가격대/],
  ["필요한 시기", /시기|언제|며칠\s*안|구매\s*일정/],
] as const;

function answerFields(text: string): string[] {
  const labels = ANSWER_FIELDS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  return labels.filter((label) => label !== "사이즈" || !labels.includes("화면 크기"));
}

function fieldKey(label: string): string {
  return normalizeSpeech(answerFields(label)[0] ?? label);
}

const USER_QUESTION = /(?:어떤|무슨|뭐(?:야|예요|에요|가|를)|어째|어떻게|얼마|몇\s*인치|무엇|왜|차이|추천)(?:[^.!?]*[?？]|[^.!?]*(?:알려|설명|추천|인가요|있나요|좋을까요|돼요))|(?:인지\s*알려|설명해\s*줘|말해\s*줘)/;

/** 앞 질문과 직접 답한 말을 연결해 모델 요약에서 생략된 조건을 복구한다. */
function directIntakeAnswers(history: LiveTurn[]) {
  const answers = new Map<string, string>();
  let asked: string[] = [];
  for (const turn of history) {
    if (turn.role === "assistant") {
      const reply = decodeAiTurn(turn.content)?.reply ?? "";
      const questions = reply.match(/[^.!?？]+[?？]/g)
        ?? reply.split(/[.!]/).filter((part) => /알려|말씀|생각하시/.test(part));
      asked = [...new Set(questions.flatMap(answerFields))];
      continue;
    }
    const user = splitNext(turn.content).content || turn.content;
    if (!isIntakeSkip(user) && /^(?:음|어|아|네|예|응|그러니까)[\s.!?]*$/.test(user)) continue;
    const clauses = (user.match(/[^,.;!?？]+[?？]?/g) ?? [])
      .flatMap((part) => part.split(/\s+(?:그다음에|그리고)\s+/))
      .map((part) => part.trim())
      .filter((part) => part && !USER_QUESTION.test(part));
    if (clauses.length === 0) continue;
    const direct = new Map<string, string>();
    for (const clause of clauses) {
      const spoken = clause.replace(/가벼운\s*(사무|작업|업무)/g, "$1");
      for (const label of answerFields(spoken)) direct.set(label, clause);
    }
    const answered = clauses.join(" ");
    const budget = BUDGET.exec(answered)?.[0];
    const timing = TIMING.exec(answered)?.[0] ?? PURCHASE_DELAY.exec(answered)?.[0];
    if (budget) direct.set("예산", budget);
    if (timing) direct.set("필요한 시기", timing);
    if (asked.length === 1 && direct.size === 0) direct.set(asked[0], answered);
    for (const [label, answer] of direct) {
      if (answer && !USER_QUESTION.test(answer)) answers.set(label, answer);
    }
    asked = [];
  }
  return answers;
}

export function answeredIntakeFields(history: LiveTurn[]): string {
  return Array.from(directIntakeAnswers(history))
    .slice(0, PRODUCT_CONDITIONS_MAX + 2)
    .map(([label, answer]) => `${label}: ${cleanSlot(answer, PRODUCT_CONDITION_ANSWER_MAX)}`)
    .join("\n");
}

/** 건너뛴 항목도 그때 이용자가 한 말이 있어야 통과한다. */
export function checkIntake(slots: LiveSlots, userTexts: string[], history?: LiveTurn[]) {
  const messages = userTexts.map(normalizeSpeech);
  const used = new Map<string, number>();
  const hasEvidence = (text: string, consume = false) => {
    const normalized = normalizeSpeech(text);
    if (!normalized) return false;
    const standalone = consume && (isIntakeSkip(text) || /^(?:네|예|응|아니|아니요|아뇨)$/.test(normalized));
    const matches = messages.filter((message) => standalone
      ? message === normalized
      : message.includes(normalized)).length;
    const prior = used.get(normalized) ?? 0;
    if (matches <= prior) return false;
    if (consume) used.set(normalized, prior + 1);
    return true;
  };
  const known = new Set<string>();
  const conditions = (slots.conditions ?? []).filter(({ label, answer }) => {
    const key = fieldKey(label);
    if (!key || known.has(key) || !hasEvidence(answer, true)) return false;
    known.add(key);
    return true;
  });
  const direct = history ? directIntakeAnswers(history) : new Map<string, string>();
  for (const [label, raw] of direct) {
    if (label === "예산" || label === "필요한 시기") continue;
    const key = fieldKey(label);
    if (known.has(key)) continue;
    known.add(key);
    conditions.push({ label, answer: cleanSlot(raw, PRODUCT_CONDITION_ANSWER_MAX) });
  }
  const grounded = groundSlots({ ...slots, options: "" }, userTexts);
  const clean = {
    ...grounded,
    product: hasEvidence(slots.product) ? slots.product : "",
    budget: hasEvidence(slots.budget, true) ? slots.budget : cleanSlot(direct.get("예산"), SLOT_MAX.budget),
    purchaseTiming: hasEvidence(slots.purchaseTiming ?? "", true) ? slots.purchaseTiming : cleanSlot(direct.get("필요한 시기"), PURCHASE_TIMING_MAX),
    conditions: conditions.slice(0, PRODUCT_CONDITIONS_MAX),
  };
  if (!clean.product) return { slots: clean, question: ASK_PRODUCT };
  if (conditions.length < 3) {
    if (/맥북|맥\s*(?:OS|오에스)/i.test(clean.product + " " + (direct.get("운영체제") ?? ""))) known.add("브랜드");
    const question = questionsFor(clean.product).find(([label]) => !known.has(fieldKey(label)));
    return { slots: clean, question: question?.[1] ?? GENERAL[0][1] };
  }
  if (!clean.budget) return { slots: clean, question: ASK_BUDGET };
  if (!clean.purchaseTiming) return { slots: clean, question: ASK_TIMING };
  return { slots: clean, question: null };
}

const BUDGET = /(?:최대\s*)?[\d,]+(?:\.\d+)?\s*(?:천\s*만|백\s*만|십\s*만|만|천)?\s*원(?:\s*(?:이하|이내|미만|정도))?/;
const TIMING = /(?:오늘(?:까지)?|내일(?:까지)?|이번\s*주(?:말)?(?:까지)?|다음\s*주(?:말)?(?:까지)?|[\d한두세네일이삼사오육칠팔구십]+\s*(?:일|주일|주|개월|달)\s*(?:안에|이내(?:에)?|뒤|후|까지)|급해요|급하다|급합니다|최대한\s*빨리|가능한\s*빨리|빠를수록\s*좋아요)/;
const PURCHASE_DELAY = /[\d한두세네일이삼사오육칠팔구십]+\s*(?:일|주일|주|개월|달)\s*동안[^.!?]{0,16}(?:구매|사고|살)/;
const PRODUCT_WORDS = [
  ["옷 종류", /상의|하의|코트|재킷|셔츠|바지|원피스|티셔츠|니트|청바지|후드/],
  ["브랜드", /애플|삼성|(?:LG|엘지)|레노버|델|아수스|ASUS/i],
  ["연결 방식", /(?:무선|유선)(?!과|이나|이든)/],
] as const;

function mockReply(slots: LiveSlots, status: LiveChatStatus, question = ""): string {
  return JSON.stringify({ ...slots, status, reply: question ? `${question} ${ANSWER_CUE}` : "" });
}

/** 로컬에서는 상품군별 질문을 실제로 진행해 보되 유료 모델을 부르지 않는다. */
export function mockProductIntake(history: LiveTurn[]): string {
  const text = history.at(-1)?.content ?? "";
  const previous = [...history].slice(0, -1).reverse().find((turn) => turn.role === "assistant");
  const last = previous ? decodeAiTurn(previous.content) : null;
  const previousSlots = last?.slots ?? EMPTY_SLOTS;
  const slots = { ...previousSlots, conditions: [...(previousSlots.conditions ?? [])] };
  const budget = BUDGET.exec(text)?.[0];
  const timing = TIMING.exec(text)?.[0];
  const budgetOnly = budget && normalizeSpeech(budget) === normalizeSpeech(text);
  const timingOnly = timing && normalizeSpeech(timing) === normalizeSpeech(text);

  if (!slots.product) {
    if (isIntakeSkip(text) || budgetOnly || timingOnly) return mockReply(slots, "asking", ASK_PRODUCT);
    slots.product = text.split(/[,，.?!]/, 1)[0].trim();
    if (!slots.product) return mockReply(slots, "asking", ASK_PRODUCT);
    const labels = new Set(questionsFor(slots.product).map(([label]) => label));
    for (const [label, pattern] of PRODUCT_WORDS) {
      const answer = labels.has(label) ? pattern.exec(slots.product)?.[0] : undefined;
      if (answer) slots.conditions.push({ label, answer });
    }
  } else if (last?.status === "confirming") {
    const condition = slots.conditions.find(({ label }) => text.includes(label));
    if (condition) condition.answer = text;
    else if (!budget && !timing) slots.info = text;
  } else {
    const covered = new Set(slots.conditions.map(({ label }) => label));
    const next = questionsFor(slots.product).find(([label]) => !covered.has(label));
    if (next) {
      if (!budgetOnly && !timingOnly) slots.conditions.push({ label: next[0], answer: text });
    } else if (!slots.budget && !timingOnly) slots.budget = text;
    else if (!slots.purchaseTiming && !budgetOnly) slots.purchaseTiming = text;
  }

  if (budget) slots.budget = budget;
  if (timing) slots.purchaseTiming = timing;
  const clean = readSlots(slots);
  const covered = new Set(clean.conditions?.map(({ label }) => label));
  const next = questionsFor(clean.product).find(([label]) => !covered.has(label));
  if (next) return mockReply(clean, "asking", next[1]);
  if (!clean.budget) return mockReply(clean, "asking", ASK_BUDGET);
  if (!clean.purchaseTiming) return mockReply(clean, "asking", ASK_TIMING);
  return mockReply(clean, "confirming");
}
