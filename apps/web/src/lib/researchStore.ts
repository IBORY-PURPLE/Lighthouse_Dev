import "server-only";
import { randomUUID } from "node:crypto";
import { PHOTO_GRANT_TTL_MS, PHOTO_LINK_TTL_MS } from "./photoLink";
import {
  getRequestStore,
  getSupabaseRpcClient,
  kstDate,
  onRequestLeave,
  StoreUnavailableError,
  type DbResult,
  type RequestStore,
  type RpcClient,
} from "./requestStore";
import {
  afterAsk,
  applyPatch,
  DEFAULT_CAPS,
  emptySessionState,
  firstValidNext,
  IDLE_RETURN_MS,
  MAX_PHOTOS,
  mergePending,
  requiredMissing,
  SEARCH_PENDING_MS,
  type NextCandidate,
  type NextMessage,
  type ResearchCaps,
  type ResearchMessage,
  type ResearchPatch,
  type ResearchPhoto,
  type ResearchReview,
  type ResearchSessionData,
  type ResearchView,
} from "./researchSession";

// 리서치 챗 대화 저장소. 인터페이스 하나에 메모리판과 Supabase판(RPC). design.md 5.1, 5.5.
// 저장소 종류는 requestStore가 고른 것을 그대로 따른다. Supabase가 설정됐는데 research 표·함수가 없으면
// 메모리로 떨어지지 않고 StoreUnavailableError(라우트는 503 store_unavailable)를 던진다.
// 글·사진·ID는 로그에 남기지 않는다.

export type GuardFail = "not_found" | "not_in_progress" | "not_yours" | "session_changed";

/**
 * 요청과 봉사자와 세션. 쓰기 호출은 모두 sessionId를 넘긴다(DB 함수는 null이면 세션 대조를 건너뛰므로
 * 타입에서 막는다). 세션 없이 읽는 열기·폴링은 open(requestId, volunteerId, after)를 따로 쓴다.
 */
export interface ResearchActor {
  requestId: string;
  volunteerId: string;
  sessionId: string;
}

export type OpenOutcome = { outcome: "ok"; view: ResearchView } | { outcome: GuardFail };

export type BeginKind = "turn" | "search" | "photo" | "review";
export interface BeginInput extends ResearchActor {
  kind: BeginKind;
  /** 이 값이 세션 version과 다르면 세지 않고 stale. */
  baseVersion?: number | null;
  clientTurnId?: string | null;
  cacheKey?: string | null;
  /** 검색 호출 수(혜택 1회차는 3). */
  units?: number;
  caps?: ResearchCaps;
}

/** 턴 한 번의 저장된 응답. 같은 clientTurnId가 다시 오면 이 값을 그대로 돌려준다. */
export interface TurnResponse {
  version: number;
  lastSeq: number;
  messages: ResearchMessage[];
  /** 고른 다음 질문의 action. 없으면 null. */
  chosen: string | null;
  session: ResearchSessionData & { photos: ResearchPhoto[]; messages: ResearchMessage[] };
}

export type BeginOutcome =
  | {
      outcome: "ok";
      ai: "ok" | "capped";
      cap?: "request" | "daily";
      version: number;
      session: ResearchView;
    }
  | { outcome: "duplicate"; response: TurnResponse }
  | { outcome: "pending" | "cached" | "photos_full" | "photo_not_needed" | "bad_request" }
  | { outcome: "stale"; version: number }
  | { outcome: "capped"; cap: "request" | "daily" }
  | { outcome: GuardFail };

export interface ApplyInput extends ResearchActor {
  clientTurnId: string;
  baseVersion: number | null;
  patch?: ResearchPatch | null;
  messages: NextMessage[];
  next: NextCandidate[];
}
export type ApplyOutcome =
  | { outcome: "ok" | "duplicate"; response: TurnResponse }
  | { outcome: "stale"; version: number }
  | { outcome: "bad_patch" }
  | { outcome: GuardFail };

export interface AddMessageInput extends ResearchActor {
  cacheKey: string | null;
  messages: NextMessage[];
  pending?: Record<string, unknown> | null;
  /** done: 끝남 표시. clear: 표시를 지워 다시 시도할 수 있게 한다. */
  cacheState?: "done" | "clear";
}
export type AddMessageOutcome =
  | { outcome: "ok"; messages: ResearchMessage[]; lastSeq: number }
  | { outcome: GuardFail };

export interface AddPhotoInput extends ResearchActor {
  /** data:image/jpeg;base64,... 60,000자 이하. */
  thumb: string;
  description?: string | null;
  seenModel?: string | null;
  shot?: "photo" | "screenshot" | "unclear" | null;
  pending?: Record<string, unknown> | null;
  messages: NextMessage[];
  next: NextCandidate[];
  /** 휴대폰 올리기면 grant의 sha256. 저장소가 잠근 안에서 이 요청·세션·봉사자의 살아 있는 grant인지 다시 확인한다. 노트북 올리기는 null. */
  grantHash?: string | null;
}
export type AddPhotoOutcome =
  | {
      outcome: "ok";
      photoId: string;
      chosen: string | null;
      messages: ResearchMessage[];
      session: ResearchView;
    }
  | { outcome: "photos_full" | "photo_not_needed" | "bad_request" | "grant_gone" }
  | { outcome: GuardFail };

export type RemovePhotoOutcome =
  | { outcome: "ok"; session: ResearchView }
  | { outcome: "photo_not_found" }
  | { outcome: GuardFail };

export interface SetReviewInput extends ResearchActor {
  baseVersion: number | null;
  text: string;
  status: "draft" | "confirmed";
}
export type SetReviewOutcome =
  | { outcome: "ok"; review: ResearchReview }
  | { outcome: "stale"; version: number }
  | { outcome: "bad_request" }
  | { outcome: GuardFail };

export interface SendInput extends ResearchActor {
  baseVersion: number;
  reviewRev: number;
  /** results.candidates에 들어갈 후보 1~3개(resultInput 형식). */
  candidates: unknown[];
}
export type SendOutcome =
  | { outcome: "sent" | "existing"; sentAt: string }
  | { outcome: "stale"; version: number }
  | { outcome: "missing_required"; missing: string[] }
  | { outcome: "review_not_confirmed" | "bad_request" }
  | { outcome: GuardFail };

/** 휴대폰 사진 링크 상태(design.md 3.3). waiting = 링크를 만들고 아직 안 씀, connected = 휴대폰이 연결돼 grant가 살아 있음. */
export interface PhotoLinkState {
  state: "none" | "waiting" | "connected" | "expired";
  expiresAt: string | null;
}
export type IssueLinkOutcome =
  | { outcome: "ok"; expiresAt: string }
  | { outcome: "photo_not_needed" | "photos_full" | "bad_request" }
  | { outcome: GuardFail };
export type RedeemLinkOutcome = { outcome: "ok"; grantExpiresAt: string } | { outcome: "gone" | "bad_request" };
export type GrantCheckOutcome =
  | { outcome: "ok"; requestId: string; volunteerId: string; sessionId: string; expiresAt: string }
  | { outcome: "gone" };
export type RevokeLinksOutcome = { outcome: "ok"; revoked: number } | { outcome: "bad_request" } | { outcome: GuardFail };

export interface ResearchStore {
  storeKind(): "supabase" | "memory";
  /** 세션 만들기(afterSeq가 null) 또는 읽기만(afterSeq가 있음, 폴링). 열 때 6시간 정리도 한다. */
  open(
    requestId: string,
    volunteerId: string,
    afterSeq?: number | null,
  ): Promise<OpenOutcome>;
  begin(input: BeginInput): Promise<BeginOutcome>;
  apply(input: ApplyInput): Promise<ApplyOutcome>;
  addMessage(input: AddMessageInput): Promise<AddMessageOutcome>;
  addPhoto(input: AddPhotoInput): Promise<AddPhotoOutcome>;
  removePhoto(actor: ResearchActor, photoId: string): Promise<RemovePhotoOutcome>;
  setReview(input: SetReviewInput): Promise<SetReviewOutcome>;
  send(input: SendInput): Promise<SendOutcome>;
  /** 6시간 넘게 활동이 없는 요청을 대기열로 돌린다. 돌린 수. */
  sweep(): Promise<number>;
  /** 휴대폰 사진 링크(토큰 sha256만 받는다). 새 링크를 만들면 이 세션의 앞 링크는 끊긴다. */
  issuePhotoLink(actor: ResearchActor, tokenHash: string): Promise<IssueLinkOutcome>;
  /** 링크를 쓴다(한 번만). 같은 세션의 다른 grant는 끊긴다. */
  redeemPhotoLink(tokenHash: string, grantHash: string): Promise<RedeemLinkOutcome>;
  /** grant가 살아 있는지 본다. 진짜 확인은 addPhoto가 한다. */
  checkPhotoGrant(grantHash: string): Promise<GrantCheckOutcome>;
  revokePhotoLinks(actor: ResearchActor): Promise<RevokeLinksOutcome>;
  /** 노트북 화면이 읽는 링크 상태. 읽기만 한다. */
  photoLinkState(actor: ResearchActor): Promise<PhotoLinkState>;
}

// ---------- 메모리 ----------

const THUMB_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const THUMB_MAX = 60_000;
const OPEN_MESSAGE_LIMIT = 500;
const POLL_MESSAGE_LIMIT = 50;

interface MemoryPhoto extends ResearchPhoto {
  requestId: string;
}

interface MemoryTurn {
  clientTurnId: string;
  response: TurnResponse | null;
  /** begin이 사용량을 올린 자리인가(그날 날짜 포함). apply가 stale이면 되돌린다. */
  countedDay: string | null;
}

interface MemorySession {
  requestId: string;
  sessionId: string;
  volunteerId: string;
  purchase: ResearchSessionData["purchase"];
  slots: ResearchSessionData["slots"];
  extras: string[];
  counters: ResearchSessionData["counters"];
  pending: ResearchSessionData["pending"];
  review: ResearchReview;
  searchCache: Record<string, { state: "pending" | "done"; at: number }>;
  version: number;
  nextSeq: number;
  createdAt: number;
  updatedAt: number;
  messages: ResearchMessage[];
  turns: Map<string, MemoryTurn>;
  photos: MemoryPhoto[];
}

/** 휴대폰 사진 링크 한 줄(DB photo_links와 같은 열). 시각은 밀리초. 세션이 지워지면 같이 지워진다. */
interface MemoryLink {
  id: string;
  requestId: string;
  sessionId: string;
  volunteerId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  grantHash: string | null;
  grantExpiresAt: number | null;
  revokedAt: number | null;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

interface MemoryUsage {
  turns: number;
  searches: number;
  photoUploads: number;
  reviews: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isoOf(time: number): string {
  return new Date(time).toISOString();
}

export function createMemoryResearchStore(
  requests: RequestStore,
  options: { now?: () => number; listenLeave?: boolean } = {},
): ResearchStore & { drop(requestId: string): void; close(): void } {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, MemorySession>();
  // 휴대폰 사진 링크는 세션과 같이 산다(requestId별).
  const links = new Map<string, MemoryLink[]>();
  // 요청당 사용량은 세션이 지워져도 남는다(요청이 지워질 때만 같이 지운다).
  const usage = new Map<string, MemoryUsage>();
  const daily = new Map<string, { searches: number; aiCalls: number }>();

  function drop(requestId: string) {
    sessions.delete(requestId);
    links.delete(requestId);
  }
  // 내려놓기·보내기·6시간 반환·요청 삭제 때 requestStore 메모리판이 알려 준다(DB 트리거와 같다).
  // usage는 내려놓기·보내기로는 남고 요청이 지워질 때만 지워진다. 메모리판은 알림 종류를 나누지 않아
  // 요청이 사라졌는지는 아래 pruneUsage가 열기 때 확인한다.
  const unsubscribe = options.listenLeave === false ? () => {} : onRequestLeave(drop);

  async function pruneUsage() {
    for (const requestId of [...usage.keys()]) {
      if (!(await requests.get(requestId))) usage.delete(requestId);
    }
  }

  async function guard(actor: ResearchActor): Promise<GuardFail | MemorySession> {
    const stored = await requests.get(actor.requestId);
    if (!stored) return "not_found";
    if (stored.status !== "in_progress") return "not_in_progress";
    const mine = await requests.getForVolunteer(actor.requestId, actor.volunteerId);
    if (mine.kind !== "ok") return "not_yours";
    // await 사이에 내려놓기가 끝났을 수 있어, 세션은 여기서 동기로 다시 찾는다.
    const session = sessions.get(actor.requestId);
    if (!session || session.volunteerId !== actor.volunteerId) return "session_changed";
    if (session.sessionId !== actor.sessionId) return "session_changed";
    return session;
  }

  function dataOf(session: MemorySession): ResearchSessionData {
    return {
      sessionId: session.sessionId,
      volunteerId: session.volunteerId,
      purchase: session.purchase,
      slots: clone(session.slots),
      extras: [...session.extras],
      counters: clone(session.counters),
      pending: clone(session.pending),
      review: clone(session.review),
      version: session.version,
      lastSeq: session.nextSeq - 1,
      createdAt: isoOf(session.createdAt),
      updatedAt: isoOf(session.updatedAt),
    };
  }

  function view(session: MemorySession, after: number | null, withThumbs: boolean): ResearchView {
    const limit = after === null ? OPEN_MESSAGE_LIMIT : POLL_MESSAGE_LIMIT;
    const messages = session.messages
      .filter((message) => after === null || message.seq > after)
      .slice(0, limit)
      .map((message) => clone(message));
    const photos = session.photos.map((photo) => {
      const { requestId: _requestId, thumb, ...rest } = photo;
      void _requestId;
      return withThumbs ? { ...rest, thumb } : rest;
    });
    return { ...dataOf(session), photos, messages };
  }

  /** 세션 잠금을 쥔 것처럼 메시지를 넣는다(JS는 한 번에 하나라 동기 함수면 같다). */
  function push(session: MemorySession, items: NextMessage[], turnId: string | null): ResearchMessage[] {
    const created = isoOf(now());
    const inserted: ResearchMessage[] = [];
    for (const item of items) {
      const message: ResearchMessage = {
        seq: session.nextSeq,
        role: item.role,
        tag: item.tag ?? null,
        slot: item.slot ?? null,
        body: clone(item.body ?? {}),
        turnId,
        ai: item.ai ?? null,
        createdAt: created,
      };
      session.messages.push(message);
      inserted.push(clone(message));
      session.nextSeq += 1;
    }
    return inserted;
  }

  function touch(session: MemorySession) {
    session.updatedAt = now();
  }

  function demoteReview(session: MemorySession) {
    if (session.review.status === "confirmed") {
      session.review = { ...session.review, status: "draft", rev: (session.review.rev ?? 0) + 1 };
    }
  }

  function usageOf(requestId: string): MemoryUsage {
    let row = usage.get(requestId);
    if (!row) {
      row = { turns: 0, searches: 0, photoUploads: 0, reviews: 0 };
      usage.set(requestId, row);
    }
    return row;
  }

  function takeDaily(searches: number, aiCalls: number, caps: ResearchCaps): boolean {
    const day = kstDate(now());
    const row = daily.get(day);
    if (!row) {
      // 그날 첫 사용이어도 상한을 넘으면 막는다.
      if (searches > caps.dailySearches || aiCalls > caps.dailyAi) return false;
      daily.set(day, { searches, aiCalls });
      return true;
    }
    if (row.searches + searches > caps.dailySearches || row.aiCalls + aiCalls > caps.dailyAi) {
      return false;
    }
    row.searches += searches;
    row.aiCalls += aiCalls;
    return true;
  }

  function turnResponse(
    session: MemorySession,
    inserted: ResearchMessage[],
    chosen: string | null,
  ): TurnResponse {
    return {
      version: session.version,
      lastSeq: session.nextSeq - 1,
      messages: inserted,
      chosen,
      session: view(session, Number.MAX_SAFE_INTEGER, false),
    };
  }

  const store: ResearchStore & { drop(requestId: string): void; close(): void } = {
    drop,
    close: unsubscribe,
    storeKind: () => "memory",
    async sweep() {
      if (!requests.returnIdle) return 0;
      return requests.returnIdle(IDLE_RETURN_MS, (requestId) => sessions.get(requestId)?.updatedAt ?? null);
    },
    async open(requestId, volunteerId, afterSeq = null) {
      if (afterSeq === null) {
        await store.sweep();
        await pruneUsage();
      }
      const stored = await requests.get(requestId);
      if (!stored) return { outcome: "not_found" };
      if (stored.status !== "in_progress") return { outcome: "not_in_progress" };
      const mine = await requests.getForVolunteer(requestId, volunteerId);
      if (mine.kind !== "ok") return { outcome: "not_yours" };
      let session = sessions.get(requestId);
      if (afterSeq !== null) {
        if (!session || session.volunteerId !== volunteerId) return { outcome: "session_changed" };
        return { outcome: "ok", view: view(session, afterSeq, false) };
      }
      if (!session) {
        const created = now();
        // 소유 확인을 기다리는 사이 내려놓기가 끝났을 수 있어, 만든 뒤 한 번 더 확인한다(아래).
        session = {
          requestId,
          sessionId: randomUUID(),
          volunteerId,
          ...emptySessionState(),
          searchCache: {},
          nextSeq: 1,
          createdAt: created,
          updatedAt: created,
          messages: [],
          turns: new Map(),
          photos: [],
        };
        sessions.set(requestId, session);
      } else if (session.volunteerId !== volunteerId) {
        return { outcome: "session_changed" };
      }
      // 세션을 만든 뒤에도 여전히 내 in_progress 요청인지 다시 본다. 그 사이 내려놓았으면 세션을 지운다.
      const recheck = await requests.getForVolunteer(requestId, volunteerId);
      if (recheck.kind !== "ok" || recheck.request.status !== "in_progress") {
        sessions.delete(requestId);
        return { outcome: "not_in_progress" };
      }
      const current = sessions.get(requestId);
      if (!current || current.volunteerId !== volunteerId) return { outcome: "session_changed" };
      return { outcome: "ok", view: view(current, null, true) };
    },
    async begin(input) {
      const guarded = await guard(input);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      const caps = input.caps ?? DEFAULT_CAPS;
      const snapshot = () => view(session, Number.MAX_SAFE_INTEGER, false);
      if (input.kind === "turn") {
        if (!input.clientTurnId) return { outcome: "bad_request" };
        const existing = session.turns.get(input.clientTurnId);
        if (existing) {
          return existing.response
            ? { outcome: "duplicate", response: clone(existing.response) }
            : { outcome: "pending" };
        }
      }
      if (input.baseVersion != null && input.baseVersion !== session.version) {
        return { outcome: "stale", version: session.version };
      }
      const units = Math.max(input.units ?? 1, 1);
      if (input.kind === "search" && input.cacheKey) {
        const cached = session.searchCache[input.cacheKey];
        if (cached?.state === "done") return { outcome: "cached" };
        if (cached?.state === "pending" && cached.at > now() - SEARCH_PENDING_MS) {
          return { outcome: "pending" };
        }
      }
      if (input.kind === "photo") {
        if (session.purchase === "research") return { outcome: "photo_not_needed" };
        if (session.photos.length >= MAX_PHOTOS) return { outcome: "photos_full" };
      }
      const used = usageOf(input.requestId);
      const overRequest =
        (input.kind === "turn" && used.turns >= caps.turns) ||
        (input.kind === "search" && used.searches + units > caps.searches) ||
        (input.kind === "photo" && used.photoUploads >= caps.photoUploads) ||
        (input.kind === "review" && used.reviews >= caps.reviews);
      const capped = (cap: "request" | "daily"): BeginOutcome => {
        if (input.kind === "turn" && input.clientTurnId) {
          session.turns.set(input.clientTurnId, {
            clientTurnId: input.clientTurnId,
            response: null,
            countedDay: null,
          });
          return { outcome: "ok", ai: "capped", cap, version: session.version, session: snapshot() };
        }
        return { outcome: "capped", cap };
      };
      if (overRequest) return capped("request");
      const taken =
        input.kind === "search" ? takeDaily(units, 0, caps) : takeDaily(0, 1, caps);
      if (!taken) return capped("daily");
      if (input.kind === "turn") used.turns += 1;
      if (input.kind === "search") used.searches += units;
      if (input.kind === "photo") used.photoUploads += 1;
      if (input.kind === "review") used.reviews += 1;
      if (input.kind === "turn" && input.clientTurnId) {
        session.turns.set(input.clientTurnId, {
          clientTurnId: input.clientTurnId,
          response: null,
          countedDay: kstDate(now()),
        });
      } else if (input.kind === "search" && input.cacheKey) {
        session.searchCache[input.cacheKey] = { state: "pending", at: now() };
      }
      return { outcome: "ok", ai: "ok", version: session.version, session: snapshot() };
    },
    async apply(input) {
      const guarded = await guard(input);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      const turn = session.turns.get(input.clientTurnId);
      if (turn?.response) return { outcome: "duplicate", response: clone(turn.response) };
      if (input.baseVersion !== null && input.baseVersion !== session.version) {
        if (turn) {
          // stale은 세지 않는다: begin이 올린 사용량을 되돌리고 처리 중 자리를 지운다.
          if (turn.countedDay) {
            const used = usageOf(input.requestId);
            used.turns = Math.max(used.turns - 1, 0);
            const row = daily.get(turn.countedDay);
            if (row) row.aiCalls = Math.max(row.aiCalls - 1, 0);
          }
          session.turns.delete(input.clientTurnId);
        }
        return { outcome: "stale", version: session.version };
      }
      const patched = applyPatch(session, input.patch);
      if (!patched.ok) return { outcome: "bad_patch" };
      session.purchase = patched.purchase;
      session.slots = patched.slots;
      session.extras = patched.extras;
      session.counters = patched.counters;
      session.pending = patched.pending;
      if (patched.changed) {
        session.version += 1;
        demoteReview(session);
      }
      touch(session);
      const chosen = firstValidNext(session, input.next);
      const items = [...input.messages];
      if (chosen) items.push(chosen.message);
      const inserted = push(session, items, input.clientTurnId);
      if (chosen && inserted.length > 0) {
        const lastSeq = inserted[inserted.length - 1].seq;
        const after = afterAsk(session.counters, session.pending, chosen, lastSeq);
        session.counters = after.counters;
        session.pending = after.pending;
      }
      const response = turnResponse(session, inserted, chosen?.action ?? null);
      session.turns.set(input.clientTurnId, {
        clientTurnId: input.clientTurnId,
        response: clone(response),
        countedDay: turn?.countedDay ?? null,
      });
      return { outcome: "ok", response };
    },
    async addMessage(input) {
      const guarded = await guard(input);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      const inserted = push(session, input.messages, null);
      session.pending = mergePending(session.pending, input.pending);
      if (input.cacheKey) {
        if (input.cacheState === "clear") delete session.searchCache[input.cacheKey];
        else session.searchCache[input.cacheKey] = { state: "done", at: now() };
      }
      touch(session);
      return { outcome: "ok", messages: inserted, lastSeq: session.nextSeq - 1 };
    },
    async addPhoto(input) {
      const guarded = await guard(input);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      if (input.thumb.length > THUMB_MAX || !THUMB_PATTERN.test(input.thumb)) {
        return { outcome: "bad_request" };
      }
      if (input.grantHash != null) {
        const at = now();
        const alive = (links.get(input.requestId) ?? []).some(
          (link) =>
            link.grantHash === input.grantHash &&
            link.sessionId === input.sessionId &&
            link.volunteerId === input.volunteerId &&
            link.usedAt !== null &&
            link.revokedAt === null &&
            (link.grantExpiresAt ?? 0) > at,
        );
        if (!alive) return { outcome: "grant_gone" };
      }
      if (session.purchase === "research") return { outcome: "photo_not_needed" };
      if (session.photos.length >= MAX_PHOTOS) return { outcome: "photos_full" };
      const photo: MemoryPhoto = {
        requestId: input.requestId,
        id: randomUUID(),
        thumb: input.thumb,
        description: input.description ?? null,
        seenModel: input.seenModel ?? null,
        shot: input.shot ?? null,
        createdAt: isoOf(now()),
      };
      session.photos.push(photo);
      session.slots = {
        ...session.slots,
        photo: {
          value: `${session.photos.length}장`,
          status: "filled",
          by: "volunteer",
          at: isoOf(now()),
        },
      };
      session.pending = mergePending(session.pending, input.pending);
      demoteReview(session);
      session.version += 1;
      touch(session);
      const lastQuestion = session.pending.lastQuestion?.slot;
      let chosen: NextCandidate | null = null;
      if (
        !session.pending.mismatch &&
        !session.pending.shotCheck &&
        !session.pending.confirmFill &&
        (lastQuestion === undefined || lastQuestion === "photo")
      ) {
        chosen = firstValidNext(session, input.next);
      }
      const items = [...input.messages];
      if (chosen) items.push(chosen.message);
      const inserted = push(session, items, null);
      if (chosen && inserted.length > 0) {
        const after = afterAsk(session.counters, session.pending, chosen, inserted[inserted.length - 1].seq);
        session.counters = after.counters;
        session.pending = after.pending;
      }
      return {
        outcome: "ok",
        photoId: photo.id,
        chosen: chosen?.action ?? null,
        messages: inserted,
        session: view(session, Number.MAX_SAFE_INTEGER, false),
      };
    },
    async removePhoto(actor, photoId) {
      const guarded = await guard(actor);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      const index = session.photos.findIndex(
        (photo) => photo.id === photoId && photo.requestId === actor.requestId,
      );
      if (index < 0) return { outcome: "photo_not_found" };
      session.photos.splice(index, 1);
      demoteReview(session);
      if (session.photos.length === 0) {
        const { photo: _photo, ...rest } = session.slots;
        void _photo;
        session.slots = rest;
        const { mismatch: _m, shotCheck: _s, ...pending } = session.pending;
        void _m;
        void _s;
        session.pending = pending;
      } else {
        session.slots = {
          ...session.slots,
          photo: {
            value: `${session.photos.length}장`,
            status: "filled",
            by: "volunteer",
            at: isoOf(now()),
          },
        };
      }
      session.version += 1;
      touch(session);
      return { outcome: "ok", session: view(session, Number.MAX_SAFE_INTEGER, false) };
    },
    async setReview(input) {
      if (!input.text || (input.status !== "draft" && input.status !== "confirmed")) {
        return { outcome: "bad_request" };
      }
      const guarded = await guard(input);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      // confirmed는 version을 꼭 대조하고, draft는 version을 주면 대조한다(AI 응답 사이 칸이 바뀐 초안을 막는다).
      if (
        (input.status === "confirmed" && input.baseVersion === null) ||
        (input.baseVersion !== null && input.baseVersion !== session.version)
      ) {
        return { outcome: "stale", version: session.version };
      }
      const review: ResearchReview = {
        text: input.text,
        status: input.status,
        rev: (session.review.rev ?? 0) + 1,
        at: isoOf(now()),
      };
      if (input.status === "confirmed") review.confirmedVersion = session.version;
      session.review = review;
      touch(session);
      return { outcome: "ok", review: clone(review) };
    },
    async send(input) {
      // 이미 보냈으면 existing(소유 확인보다 먼저).
      const sent = await requests.getForVolunteer(input.requestId, input.volunteerId);
      if (sent.kind === "ok" && sent.result) return { outcome: "existing", sentAt: sent.result.sentAt };
      const guarded = await guard(input);
      if (typeof guarded === "string") {
        const again = await requests.getForVolunteer(input.requestId, input.volunteerId);
        if (again.kind === "ok" && again.result) return { outcome: "existing", sentAt: again.result.sentAt };
        return { outcome: guarded };
      }
      const session = guarded;
      if (input.baseVersion !== session.version) return { outcome: "stale", version: session.version };
      const missing = requiredMissing(session);
      // 구매함이면 칸 표시만이 아니라 실제 사진이 1장 이상 있어야 한다.
      if (session.purchase === "bought" && session.photos.length === 0 && !missing.includes("photo")) {
        missing.push("photo");
      }
      if (missing.length > 0) return { outcome: "missing_required", missing };
      if (
        session.review.status !== "confirmed" ||
        session.review.confirmedVersion !== session.version ||
        session.review.rev !== input.reviewRev
      ) {
        return { outcome: "review_not_confirmed" };
      }
      if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 3) {
        return { outcome: "bad_request" };
      }
      // complete가 요청을 done으로 바꾸면 알림으로 세션이 지워진다.
      const done = await requests.complete(
        input.requestId,
        input.volunteerId,
        input.candidates as Parameters<RequestStore["complete"]>[2],
      );
      if (done.outcome === "completed" || done.outcome === "existing") {
        return { outcome: done.outcome === "completed" ? "sent" : "existing", sentAt: done.sentAt };
      }
      return { outcome: done.outcome === "not_found" ? "not_found" : "not_in_progress" };
    },
    async issuePhotoLink(actor, tokenHash) {
      if (!HASH_PATTERN.test(tokenHash)) return { outcome: "bad_request" };
      const guarded = await guard(actor);
      if (typeof guarded === "string") return { outcome: guarded };
      const session = guarded;
      if (session.purchase === "research") return { outcome: "photo_not_needed" };
      if (session.photos.length >= MAX_PHOTOS) return { outcome: "photos_full" };
      const at = now();
      const rows = links.get(actor.requestId) ?? [];
      for (const row of rows) if (row.revokedAt === null) row.revokedAt = at;
      rows.push({
        id: randomUUID(),
        requestId: actor.requestId,
        sessionId: actor.sessionId,
        volunteerId: actor.volunteerId,
        tokenHash,
        createdAt: at,
        expiresAt: at + PHOTO_LINK_TTL_MS,
        usedAt: null,
        grantHash: null,
        grantExpiresAt: null,
        revokedAt: null,
      });
      links.set(actor.requestId, rows);
      return { outcome: "ok", expiresAt: isoOf(at + PHOTO_LINK_TTL_MS) };
    },
    async redeemPhotoLink(tokenHash, grantHash) {
      if (!HASH_PATTERN.test(tokenHash) || !HASH_PATTERN.test(grantHash)) return { outcome: "bad_request" };
      let found: MemoryLink | undefined;
      for (const rows of links.values()) {
        found = rows.find((row) => row.tokenHash === tokenHash);
        if (found) break;
      }
      if (!found) return { outcome: "gone" };
      const target = found;
      const guarded = await guard({ requestId: target.requestId, volunteerId: target.volunteerId, sessionId: target.sessionId });
      if (typeof guarded === "string") return { outcome: "gone" };
      // 기다리는 사이 내려놓았으면 링크가 이미 지워졌다. 이 줄은 동기로 다시 확인한다.
      const rows = links.get(target.requestId) ?? [];
      const link = rows.find((row) => row.id === target.id);
      const at = now();
      if (!link || link.revokedAt !== null || link.usedAt !== null || link.expiresAt <= at) return { outcome: "gone" };
      link.usedAt = at;
      link.grantHash = grantHash;
      link.grantExpiresAt = at + PHOTO_GRANT_TTL_MS;
      for (const row of rows) if (row.id !== link.id && row.revokedAt === null) row.revokedAt = at;
      return { outcome: "ok", grantExpiresAt: isoOf(link.grantExpiresAt) };
    },
    async checkPhotoGrant(grantHash) {
      if (!HASH_PATTERN.test(grantHash)) return { outcome: "gone" };
      let found: MemoryLink | undefined;
      for (const rows of links.values()) {
        found = rows.find((row) => row.grantHash === grantHash);
        if (found) break;
      }
      const at = now();
      if (!found || found.usedAt === null || found.revokedAt !== null || (found.grantExpiresAt ?? 0) <= at) {
        return { outcome: "gone" };
      }
      const guarded = await guard({ requestId: found.requestId, volunteerId: found.volunteerId, sessionId: found.sessionId });
      if (typeof guarded === "string") return { outcome: "gone" };
      return {
        outcome: "ok",
        requestId: found.requestId,
        volunteerId: found.volunteerId,
        sessionId: found.sessionId,
        expiresAt: isoOf(found.grantExpiresAt as number),
      };
    },
    async revokePhotoLinks(actor) {
      const guarded = await guard(actor);
      if (typeof guarded === "string") return { outcome: guarded };
      const at = now();
      let revoked = 0;
      for (const row of links.get(actor.requestId) ?? []) {
        if (row.revokedAt === null) {
          row.revokedAt = at;
          revoked += 1;
        }
      }
      return { outcome: "ok", revoked };
    },
    async photoLinkState(actor) {
      const rows = (links.get(actor.requestId) ?? []).filter(
        (row) => row.volunteerId === actor.volunteerId && row.sessionId === actor.sessionId && row.revokedAt === null,
      );
      const latest = rows[rows.length - 1];
      if (!latest) return { state: "none", expiresAt: null };
      const at = now();
      if (latest.usedAt === null) {
        return { state: latest.expiresAt > at ? "waiting" : "expired", expiresAt: isoOf(latest.expiresAt) };
      }
      const grantEnds = latest.grantExpiresAt ?? 0;
      return { state: grantEnds > at ? "connected" : "expired", expiresAt: isoOf(grantEnds) };
    },
  };
  return store;
}

// ---------- Supabase ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 교착(40P01)은 DB가 한쪽을 되돌린 것이라 한 번 다시 시도한다. */
const DEADLOCK = "40P01";

export function createSupabaseResearchStore(client: RpcClient): ResearchStore {
  async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let result: DbResult;
      try {
        result = await client.rpc(fn, args);
      } catch {
        throw new StoreUnavailableError(`${fn} failed`);
      }
      if (result.error) {
        if (result.error.code === DEADLOCK && attempt === 0) continue;
        // 표·함수가 없는 경우(마이그레이션 전)도 메모리로 떨어지지 않고 503이다.
        throw new StoreUnavailableError(`${fn} failed`);
      }
      if (!isRecord(result.data) || typeof result.data.outcome !== "string") {
        throw new StoreUnavailableError(`${fn} returned an unexpected shape`);
      }
      return result.data;
    }
    throw new StoreUnavailableError(`${fn} failed`);
  }

  const actorArgs = (actor: ResearchActor) => ({
    p_request_id: actor.requestId,
    p_volunteer_id: actor.volunteerId,
    p_session_id: actor.sessionId,
  });

  return {
    storeKind: () => "supabase",
    async open(requestId, volunteerId, afterSeq = null) {
      return (await call("research_open", {
        p_request_id: requestId,
        p_volunteer_id: volunteerId,
        p_after: afterSeq,
      })) as unknown as OpenOutcome;
    },
    async begin(input) {
      const caps = input.caps ?? DEFAULT_CAPS;
      return (await call("research_begin", {
        ...actorArgs(input),
        p_kind: input.kind,
        p_base_version: input.baseVersion ?? null,
        p_client_turn_id: input.clientTurnId ?? null,
        p_cache_key: input.cacheKey ?? null,
        p_units: input.units ?? 1,
        p_caps: caps,
      })) as unknown as BeginOutcome;
    },
    async apply(input) {
      return (await call("research_apply", {
        ...actorArgs(input),
        p_client_turn_id: input.clientTurnId,
        p_base_version: input.baseVersion,
        p_patch: input.patch ?? null,
        p_messages: input.messages,
        p_next: input.next,
      })) as unknown as ApplyOutcome;
    },
    async addMessage(input) {
      return (await call("research_add_message", {
        ...actorArgs(input),
        p_cache_key: input.cacheKey,
        p_messages: input.messages,
        p_pending: input.pending ?? null,
        p_cache_state: input.cacheState ?? "done",
      })) as unknown as AddMessageOutcome;
    },
    async addPhoto(input) {
      return (await call("research_add_photo", {
        ...actorArgs(input),
        p_thumb: input.thumb,
        p_description: input.description ?? null,
        p_seen_model: input.seenModel ?? null,
        p_shot: input.shot ?? null,
        p_pending: input.pending ?? null,
        p_messages: input.messages,
        p_next: input.next,
        // 마이그레이션 2 전의 옛 함수(인자 10개)에도 노트북 올리기가 되도록, grant가 있을 때만 보낸다.
        ...(input.grantHash ? { p_grant_hash: input.grantHash } : {}),
      })) as unknown as AddPhotoOutcome;
    },
    async removePhoto(actor, photoId) {
      return (await call("research_remove_photo", {
        ...actorArgs(actor),
        p_photo_id: photoId,
      })) as unknown as RemovePhotoOutcome;
    },
    async setReview(input) {
      return (await call("research_set_review", {
        ...actorArgs(input),
        p_base_version: input.baseVersion,
        p_review: { text: input.text, status: input.status },
      })) as unknown as SetReviewOutcome;
    },
    async send(input) {
      return (await call("research_send", {
        ...actorArgs(input),
        p_base_version: input.baseVersion,
        p_review_rev: input.reviewRev,
        p_candidates: input.candidates,
      })) as unknown as SendOutcome;
    },
    async sweep() {
      let result: DbResult;
      try {
        result = await client.rpc("research_sweep", {});
      } catch {
        throw new StoreUnavailableError("research_sweep failed");
      }
      if (result.error) throw new StoreUnavailableError("research_sweep failed");
      return typeof result.data === "number" ? result.data : 0;
    },
    async issuePhotoLink(actor, tokenHash) {
      return (await call("photo_link_issue", { ...actorArgs(actor), p_token_hash: tokenHash })) as unknown as IssueLinkOutcome;
    },
    async redeemPhotoLink(tokenHash, grantHash) {
      return (await call("photo_link_redeem", {
        p_token_hash: tokenHash,
        p_grant_hash: grantHash,
      })) as unknown as RedeemLinkOutcome;
    },
    async checkPhotoGrant(grantHash) {
      return (await call("photo_link_check", { p_grant_hash: grantHash })) as unknown as GrantCheckOutcome;
    },
    async revokePhotoLinks(actor) {
      return (await call("photo_link_revoke", actorArgs(actor))) as unknown as RevokeLinksOutcome;
    },
    async photoLinkState(actor) {
      const out = await call("photo_link_state", actorArgs(actor));
      const state = out.state;
      if (state !== "none" && state !== "waiting" && state !== "connected" && state !== "expired") {
        throw new StoreUnavailableError("photo_link_state returned an unexpected shape");
      }
      return { state, expiresAt: typeof out.expiresAt === "string" ? out.expiresAt : null };
    },
  };
}

// ---------- 선택 ----------

interface ResearchCache {
  memory?: ReturnType<typeof createMemoryResearchStore>;
  memoryFor?: RequestStore;
  supabase?: ResearchStore;
  client?: RpcClient;
}

const globalCache = globalThis as typeof globalThis & { __lhResearchStores?: ResearchCache };

function cache(): ResearchCache {
  globalCache.__lhResearchStores ??= {};
  return globalCache.__lhResearchStores;
}

/** requestStore가 고른 저장소를 따른다. Supabase인데 research 표가 없으면 호출 때 StoreUnavailableError. */
export function getResearchStore(): ResearchStore {
  const requests = getRequestStore();
  const stores = cache();
  if (requests.storeKind() === "supabase") {
    const client = getSupabaseRpcClient();
    if (client) {
      if (stores.client !== client) {
        stores.client = client;
        stores.supabase = createSupabaseResearchStore(client);
      }
      return stores.supabase as ResearchStore;
    }
  }
  if (!stores.memory || stores.memoryFor !== requests) {
    stores.memory?.close();
    stores.memory = createMemoryResearchStore(requests);
    stores.memoryFor = requests;
  }
  return stores.memory;
}

/** 시험 전용: 저장소 캐시를 비운다. */
export function resetResearchStoresForTest(): void {
  globalCache.__lhResearchStores?.memory?.close();
  globalCache.__lhResearchStores = {};
}
