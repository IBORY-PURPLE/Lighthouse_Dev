// /live 접수 흐름: 확인한 draft를 봉사자 대기열(POST /api/requests) 본문으로 바꾸고, 재시도하고, 기기 기록과 푸시를 잇는다. 설계서 12절.
// 화면(브라우저)에서 쓰는 모듈이다. 접수 결과 분류와 재시도 순서는 12.1·12.3절 표 그대로이고, 말과 상태 전이는 liveMachine이 맡는다.
import type { LiveDraft } from "@/lib/liveEngine";
import { cutText } from "@/lib/liveText";

export const LIVE_RECORDS_KEY = "lh-requests";
export const LIVE_RECORDS_MAX = 20;
export const LIVE_PUSH_KEY = "lh-push";
export const LIVE_REGISTER_TIMEOUT_MS = 10_000; // requestRecord.ts의 REQUEST_TIMEOUT_MS와 같은 값
export const LIVE_REGISTER_DELAYS_MS = [0, 1_000, 3_000]; // 세 번까지 보낸다
export const LIVE_DEVICE_READY_MS = 4_000;
export const UNDECIDED = "정하지 않음";

// /api/requests의 product·budget·condition 상한(route.ts:98-100)과 요약 상한(cleanRequestDetails)
const ANSWER_MAX = 200;
const SUMMARY_MAX = 300;
const RETRY_AFTER_DEFAULT_S = 5;
const RETRY_AFTER_MAX_S = 30;

export type LiveCondition = "새 제품" | "중고" | "상관없음" | "정하지 않음";

const ANY = /상관\s?없|아무거나|둘\s?다/;
const USED = /중고/g;
const NEW = /새\s?(?:제품|상품|것|거)|신품|미개봉/g;
// 낱말 바로 뒤(조사 한 개까지 허용)에 부정어가 붙는지 본다. "안전", "안쪽" 같은 낱말은 부정이 아니다.
const NEGATION = /^\s?(?:은|는|이|가|도|을|를)?\s?(?:말고|아니|빼고|싫|안(?!전|쪽|내|에|경))/;

/** 낱말이 나오는지, 그중 하나라도 바로 뒤에 부정어가 붙는지. */
function scan(text: string, word: RegExp): { found: boolean; negated: boolean } {
  let found = false;
  let negated = false;
  for (const m of text.matchAll(word)) {
    found = true;
    if (NEGATION.test(text.slice((m.index ?? 0) + m[0].length))) negated = true;
  }
  return { found, negated };
}

/** text는 `options + " " + budget`이다. 서버는 "상관없음"을 any, "중고"를 used, "새"를 new로 읽는다(requestStore.ts:161-166). */
export function conditionOf(text: string): LiveCondition {
  if (ANY.test(text)) return "상관없음";
  const used = scan(text, USED);
  const fresh = scan(text, NEW);
  if (used.found && fresh.found) {
    if (used.negated && !fresh.negated) return "새 제품";
    if (fresh.negated && !used.negated) return "중고";
    return UNDECIDED;
  }
  if (used.found) return used.negated ? "새 제품" : "중고";
  if (fresh.found) return fresh.negated ? "중고" : "새 제품";
  return UNDECIDED;
}

export interface LiveRequestBody {
  clientRequestId: string;
  product: string;
  budget: string;
  condition: string;
  details: { summary: string; qa: { q: string; a: string }[] };
}

/** 확인한 draft를 접수 본문으로 바꾼다. product가 비면 null. 모든 글의 length(UTF-16)가 서버 상한 이하다. */
export function toLiveRequest(draft: LiveDraft, cid: string): LiveRequestBody | null {
  const product = cutText(draft.product.trim(), ANSWER_MAX);
  if (!product) return null;
  const budgetText = draft.budget.trim();
  const qa = [
    { q: "원하는 제품", a: draft.product },
    { q: "알고 싶은 정보", a: draft.info },
    { q: "원하는 옵션", a: draft.options },
    { q: "예산", a: draft.budget },
  ]
    .map(({ q, a }) => ({ q, a: cutText(a.trim(), ANSWER_MAX) }))
    .filter(({ a }) => a !== "");
  return {
    clientRequestId: cid,
    product,
    budget: cutText(budgetText, ANSWER_MAX) || UNDECIDED,
    condition: conditionOf(`${draft.options} ${draft.budget}`),
    details: { summary: cutText(draft.summary, SUMMARY_MAX), qa },
  };
}

export type RegisterClass = "ok" | "retryable" | "unknown" | "rate_limited" | "rejected" | "conflict";

/**
 * 접수 응답 분류(12.1절 표).
 * 409는 같은 접수 id의 요청이 이미 있는데 이 기기의 것으로 확인되지 않는다는 뜻이다(서버는 번호와 상태를 알려 주지 않는다).
 * 우리 흐름에서는 기기 쿠키가 바뀌기 전에 나간 앞 시도가 등록된 경우에 생긴다. 그래서 접수는 된 것으로 보고 다시 보내지 않게 안내하되,
 * 접수 번호는 말하지 않는다(registerConflict).
 */
export function classifyRegister(status: number | "network" | "timeout"): RegisterClass {
  if (status === "network" || status === "timeout") return "unknown";
  if (status === 200 || status === 201) return "ok";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 413) return "rejected";
  if (status === 409) return "conflict";
  return "retryable";
}

export type RegisterResult =
  | { ok: true; requestId: string; queueNumber: number; status: string }
  | { ok: false; kind: "retryable" | "unknown" | "rejected" | "conflict" };

/** 화면을 열 때 부른다. 기기 쿠키(lh_device)를 먼저 받아 두면 접수가 서로 다른 쿠키를 받지 않는다(4초 상한, 실패는 무시). */
export function startDeviceReady(fetchImpl: typeof fetch = fetch): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LIVE_DEVICE_READY_MS);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      fetchImpl("/api/requests", { cache: "no-store" }).then(finish, finish);
    } catch {
      finish();
    }
  });
}

interface Deps {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  deviceReady: Promise<void>;
  onBusy?(): void; // 429를 받았을 때 한 번 부른다(REGISTER_BUSY)
}

interface Attempt {
  cls: RegisterClass;
  res?: Response;
}

/** 한 번 보낸다. 10초 안에 응답이 없으면 중단하고 "timeout"으로 센다. */
async function sendOnce(body: LiveRequestBody, f: typeof fetch): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_REGISTER_TIMEOUT_MS);
  try {
    const res = await f("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      signal: controller.signal,
    });
    return { cls: classifyRegister(res.status), res };
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string } | null)?.name === "AbortError";
    return { cls: classifyRegister(aborted ? "timeout" : "network") };
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(res: Response | undefined): number {
  const raw = Number(res?.headers.get("Retry-After"));
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : RETRY_AFTER_DEFAULT_S;
  return Math.min(seconds, RETRY_AFTER_MAX_S) * 1000;
}

async function readOk(res: Response | undefined): Promise<RegisterResult | null> {
  try {
    const data = (await res?.json()) as { requestId?: unknown; queueNumber?: unknown; status?: unknown } | null;
    if (!data || typeof data.requestId !== "string" || !data.requestId) return null;
    return {
      ok: true,
      requestId: data.requestId,
      queueNumber: typeof data.queueNumber === "number" ? data.queueNumber : 0,
      status: typeof data.status === "string" && data.status ? data.status : "waiting",
    };
  } catch {
    return null;
  }
}

/**
 * 접수를 보낸다(12.3절 3). 같은 clientRequestId는 서버가 멱등으로 받으므로,
 * 접수됐는지 모를 때(unknown)의 올바른 행동은 같은 본문을 다시 보내는 것이다.
 */
export async function registerLive(body: LiveRequestBody, deps: Deps): Promise<RegisterResult> {
  await deps.deviceReady.catch(() => {});
  let sawUnknown = false;
  let busyTold = false;
  for (const delay of LIVE_REGISTER_DELAYS_MS) {
    if (delay > 0) await deps.sleep(delay);
    let attempt = await sendOnce(body, deps.fetch);
    if (attempt.cls === "rate_limited") {
      // 429는 한 번만 알리고 기다린 뒤 한 번 더 보낸다. 또 429면 여기서 끝낸다.
      if (busyTold) return { ok: false, kind: sawUnknown ? "unknown" : "retryable" };
      busyTold = true;
      deps.onBusy?.();
      await deps.sleep(retryAfterMs(attempt.res));
      attempt = await sendOnce(body, deps.fetch);
      if (attempt.cls === "rate_limited") return { ok: false, kind: sawUnknown ? "unknown" : "retryable" };
    }
    if (attempt.cls === "ok") {
      const done = await readOk(attempt.res);
      if (done) return done;
      // 접수는 됐을 수 있으나 번호를 읽지 못했다. 같은 id로 다시 보내면 번호를 받는다.
      sawUnknown = true;
      continue;
    }
    if (attempt.cls === "rejected" || attempt.cls === "conflict") return { ok: false, kind: attempt.cls };
    if (attempt.cls === "unknown") sawUnknown = true;
  }
  return { ok: false, kind: sawUnknown ? "unknown" : "retryable" };
}

/** 기기 기록(lh-requests)에 접수를 남긴다. `/`의 목록과 같은 모양이다. 같은 cid가 있으면 바꾸고 없으면 맨 앞에 넣는다. 저장 실패는 무시한다. */
export function saveLiveRecord(
  storage: Pick<Storage, "getItem" | "setItem">,
  record: { cid: string; product: string; summary: string; requestId: string; status: string },
  now: Date = new Date(),
): void {
  try {
    let items: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(storage.getItem(LIVE_RECORDS_KEY) || "[]");
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
    const entry = {
      cid: record.cid,
      product: record.product,
      summary: record.summary,
      date: now.toLocaleDateString("ko-KR"),
      status: record.status || "waiting",
      requestId: record.requestId,
    };
    const at = items.findIndex((x) => (x as { cid?: unknown } | null)?.cid === record.cid);
    if (at >= 0) items[at] = entry;
    else items.unshift(entry);
    storage.setItem(LIVE_RECORDS_KEY, JSON.stringify(items.slice(0, LIVE_RECORDS_MAX)));
  } catch {
    // 저장 실패는 무시한다(접수는 이미 됐다).
  }
}

/** `/`의 pushOn()과 같은 조건. */
function pushOn(win: Window): boolean {
  try {
    return (
      "serviceWorker" in win.navigator &&
      "PushManager" in win &&
      "Notification" in win &&
      (win as Window & typeof globalThis).Notification.permission === "granted" &&
      win.localStorage.getItem(LIVE_PUSH_KEY) === "on"
    );
  } catch {
    return false;
  }
}

/**
 * 이미 있는 푸시 구독을 이 접수에 붙인다(12.3절 4). 새로 구독하거나 권한을 묻지 않는다. 실패는 무시한다.
 * 구독이 있을 때만 POST /api/requests/<requestId>/push에 subscription.toJSON()을 보낸다.
 */
export async function attachPushIfOn(requestId: string, win: Window): Promise<void> {
  try {
    if (!pushOn(win)) return;
    const key = await win
      .fetch("/api/push/key", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ publicKey?: unknown } | null>) : null))
      .catch(() => null);
    if (!key || !key.publicKey) return;
    const reg = await win.navigator.serviceWorker.register("/sw.js");
    await win.navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await win.fetch(`/api/requests/${encodeURIComponent(requestId)}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch {
    // 푸시 연결 실패는 접수에 영향을 주지 않는다.
  }
}
