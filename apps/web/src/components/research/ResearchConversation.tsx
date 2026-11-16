"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AttachSheet } from "./AttachSheet";
import { ChatLog, type ChatActions, type OptimisticMessage } from "./ChatLog";
import { Composer, type ComposerHandle } from "./Composer";
import { CurrentQuestionLine } from "./CurrentQuestionLine";
import { HeroBackdrop } from "./HeroBackdrop";
import { StatusPill } from "./PurchaseBadge";
import { QuickReplies } from "./QuickReplies";
import { ResearchTopBar } from "./ResearchTopBar";
import { ReviewCard } from "./ReviewCard";
import { ReviewEditor } from "./ReviewEditor";
import { SlotPanel } from "./SlotPanel";
import { SentView } from "@/components/SentView";
import { shrinkPhoto } from "@/lib/researchPhoto";
import {
  badgeOf,
  currentSlot,
  planFold,
  quickOf,
  requiredProgress,
  requiredSlots,
  type QuickReply,
  type ThinkingKind,
} from "@/lib/researchChatView";
import {
  applySnapshot,
  deletePhoto,
  fetchResearch,
  isStaleFailure,
  maxSeq,
  mergeMessages,
  newTurnId,
  postPhoto,
  postReview,
  postSearch,
  postSend,
  postTurn,
  putReview,
  type ChatMessage,
  type Outcome,
  type PhotoView,
  type ResearchView,
  type SearchKind,
  type TurnInput,
  type TurnResponse,
} from "@/lib/researchClient";
import { searchQueryOf } from "@/lib/shopLinks";
import {
  fetchRequest,
  releaseRequest,
  saveFlash,
  type DetailResponse,
} from "@/lib/volunteerClient";
import { VOLUNTEER_MESSAGES } from "@/lib/volunteerView";

const PURCHASE_QUICK: QuickReply[] = [
  { id: "purchase.bought", label: "구매했어요", tone: "normal", action: "turn" },
  { id: "purchase.research", label: "구매하지 않았어요 · 리서치만", tone: "normal", action: "turn" },
];

const POLL_MS = 2000;
const POLL_MAX = 45;

const COPY = {
  turnFailed: "보내지 못했어요. 쓴 글은 그대로 두었어요. 다시 보내 주세요.",
  stale: "다른 곳에서 내용이 바뀌어 다시 불러왔어요. 쓴 글은 그대로 두었어요.",
  tooMany: "요청이 많아요. 잠시 뒤에 다시 해 주세요.",
  searchFailed: "찾지 못했어요. 쇼핑몰에서 직접 찾아도 돼요.",
  photoBig: "사진이 너무 커요. 다른 사진을 골라 주세요.",
  photoFormat: "이 사진 형식은 받을 수 없어요. JPEG나 PNG 사진을 골라 주세요.",
  photoFull: "사진은 3장까지 올릴 수 있어요.",
  photoNotNeeded: "리서치만 고르셨어요. 사진은 필요 없어요.",
  photoRead: "사진을 읽지 못했어요. 다른 사진을 골라 주세요.",
  photoFailed: "사진을 올리지 못했어요. 다시 해 주세요.",
  photoDone: "사진을 올렸어요.",
  photoRemoved: "사진을 지웠어요.",
  reviewNotReady: "아직 리뷰를 만들 수 없어요. 빠진 칸을 먼저 채워 주세요.",
  reviewFailed: "리뷰를 만들지 못했어요. 다시 눌러 주세요.",
  confirmed: "검수를 마쳤어요. 보내기를 눌러 이용자에게 보내세요.",
  sendFailed: "보내지 못했어요. 다시 눌러 주세요.",
  sendBlocked: "아직 보낼 수 없어요. 검수를 마쳤는지 확인해 주세요.",
} as const;

function eulReul(word: string): string {
  const code = word.trim().slice(-1).charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? "를" : "을";
  return "을(를)";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "denied" }
  | { kind: "failed"; message: string }
  | { kind: "done"; detail: DetailResponse };

interface Notice {
  text: string;
  loud: boolean;
}

/** 합칠 때 새 응답의 칸·구매 상태는 덮어쓰고 메시지는 seq로 합친다. */
function mergeView(prev: ResearchView, incoming: ResearchView): ResearchView {
  const messages = mergeMessages(prev.messages, incoming.messages);
  return { ...incoming, messages, lastSeq: maxSeq(messages, incoming.lastSeq) };
}

/**
 * 봉사자 리서치 챗(대화형, D안). 히어로(E1)에서 시작해 질문·검색·사진·리뷰 검수·보내기까지 한 화면에서 이어 간다.
 * 서버 상태는 GET research가 기준이고(새로 고쳐도 이어진다), 턴·검색은 응답 메시지를 seq로 합친다.
 */
export function ResearchConversation({ requestId }: { requestId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState<DetailResponse["request"] | null>(null);
  const [view, setView] = useState<ResearchView | null>(null);
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [thinking, setThinking] = useState<{ kind: ThinkingKind; startedAt: number } | null>(null);
  const [uploadingThumb, setUploadingThumb] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>({ text: "", loud: false });
  const [attachOpen, setAttachOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReasons, setReviewReasons] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [localChecked, setLocalChecked] = useState<string[]>([]);

  const alive = useRef(true);
  const viewRef = useRef<ResearchView | null>(null);
  const turnBusy = useRef(false);
  const searching = useRef(false);
  const focusSend = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const say = useCallback((text: string) => setNotice({ text, loud: false }), []);
  const warn = useCallback((text: string) => setNotice({ text, loud: true }), []);

  const toList = useCallback(() => router.replace("/volunteer"), [router]);

  // ----- 불러오기 -----

  const reload = useCallback(async (): Promise<ResearchView | null> => {
    const result = await fetchResearch(requestId);
    if (!alive.current) return null;
    if (result.kind === "unauthorized") {
      toList();
      return null;
    }
    if (result.kind !== "ok") return null;
    setView(result.data);
    viewRef.current = result.data;
    return result.data;
  }, [requestId, toList]);

  const pollSearch = useCallback(async () => {
    for (let index = 0; index < POLL_MAX && alive.current; index += 1) {
      await sleep(POLL_MS);
      const current = viewRef.current;
      const result = await fetchResearch(requestId, current?.lastSeq);
      if (!alive.current) return false;
      if (result.kind === "unauthorized") {
        toList();
        return false;
      }
      if (result.kind !== "ok") continue;
      const incoming = result.data;
      setView((prev) => (prev ? mergeView(prev, incoming) : incoming));
      if (!incoming.pending.search) return true;
    }
    return false;
  }, [requestId, toList]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const detail = await fetchRequest(requestId);
      if (cancelled) return;
      if (detail.kind === "unauthorized") {
        toList();
        return;
      }
      if (detail.kind === "failed") {
        setLoad(
          detail.status === 403 || detail.status === 404
            ? { kind: "denied" }
            : { kind: "failed", message: detail.message },
        );
        return;
      }
      if (detail.data.request.status === "done" && detail.data.result) {
        setLoad({ kind: "done", detail: detail.data });
        return;
      }
      if (detail.data.request.status !== "in_progress") {
        setLoad({ kind: "denied" });
        return;
      }
      setRequest(detail.data.request);
      const result = await fetchResearch(requestId);
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        toList();
        return;
      }
      if (result.kind === "failed") {
        setLoad(
          [403, 404, 409].includes(result.status)
            ? { kind: "denied" }
            : { kind: "failed", message: VOLUNTEER_MESSAGES.connectFailed },
        );
        return;
      }
      if (result.kind !== "ok") {
        setLoad({ kind: "failed", message: VOLUNTEER_MESSAGES.connectFailed });
        return;
      }
      setView(result.data);
      viewRef.current = result.data;
      setLoad({ kind: "ready" });
      // 검색 중에 새로 고친 화면이면 끝날 때까지 이어서 기다린다.
      const pending = result.data.pending.search;
      if (pending) {
        searching.current = true;
        setThinking({ kind: pending.kind, startedAt: Date.now() });
        await pollSearch();
        searching.current = false;
        if (!cancelled) setThinking(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, toList, attempt, pollSearch]);

  const finishSent = useCallback(async () => {
    const detail = await fetchRequest(requestId);
    if (!alive.current) return;
    if (detail.kind === "ok" && detail.data.result) setLoad({ kind: "done", detail: detail.data });
    else setAttempt((value) => value + 1);
  }, [requestId]);

  // stage가 sent(다른 탭에서 보냄 포함)면 완료 화면으로.
  useEffect(() => {
    if (view?.stage !== "sent" || load.kind !== "ready") return;
    const timer = window.setTimeout(() => void finishSent(), 0);
    return () => window.clearTimeout(timer);
  }, [view?.stage, load.kind, finishSent]);

  // ----- 화면 보조: 제목 초점, 스크롤, 입력창 초점 -----

  useEffect(() => {
    if (load.kind === "loading") return;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [load.kind]);

  const restoreFocus = useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !document.body.contains(active)) composerRef.current?.focus();
    }, 0);
  }, []);

  const messageCount = view?.messages.length ?? 0;
  const reviewStatus = view?.review.status;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 먼 거리는 바로 이동한다(긴 부드러운 스크롤은 읽는 흐름을 끊는다). 움직임 줄이기에서는 항상 바로 이동한다.
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() || distance > 600 ? "auto" : "smooth" });
  }, [messageCount, optimistic.length, thinking, reviewStatus, editing, uploadingThumb, reviewReasons.length]);

  // 입력창 묶음 높이를 알려 대화가 그 뒤로 가려지지 않게 한다.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const stage = stageRef.current;
    if (!dock || !stage) return;
    const measure = () => stage.style.setProperty("--vc-dock-h", `${dock.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    return () => observer?.disconnect();
  }, [load.kind]);

  const hero =
    !!view && view.stage === "hero" && view.messages.length === 0 && optimistic.length === 0 && !uploadingThumb && !thinking;

  // 히어로 → 대화: 입력창이 가운데에서 아래로 내려앉는다(같은 DOM, 위치만 움직임).
  const wasHero = useRef<boolean | null>(null);
  const heroTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock || load.kind !== "ready") return;
    const top = dock.getBoundingClientRect().top;
    if (wasHero.current === true && !hero && heroTop.current !== null && !reducedMotion()) {
      const delta = heroTop.current - top;
      dock.style.transition = "none";
      dock.style.transform = `translateY(${delta}px)`;
      void dock.getBoundingClientRect();
      dock.style.transition = "transform var(--lh-motion-slow) var(--lh-ease-standard)";
      dock.style.transform = "";
    }
    wasHero.current = hero;
    heroTop.current = top;
  }, [hero, load.kind]);

  // 검수를 마친 뒤 [보내기]로 초점을 옮긴다.
  useEffect(() => {
    if (!focusSend.current || editing || view?.review.status !== "confirmed") return;
    focusSend.current = false;
    sendRef.current?.focus();
  }, [editing, view?.review.status]);

  // 패널이 열린 채 Esc를 누르면 닫고 버튼으로 돌아간다.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  // ----- 서버 호출 -----

  const applyTurn = useCallback((response: TurnResponse, shownText: string | null, turnId: string) => {
    setView((prev) => {
      if (!prev) return prev;
      let incoming: ChatMessage[] = response.messages;
      // 서버 응답에 내 말이 없으면 보낸 글을 내 말풍선으로 앞에 붙인다(다시 불러오면 서버 값으로 바뀐다).
      if (shownText && !incoming.some((message) => message.role === "volunteer")) {
        const first = incoming.length > 0 ? Math.min(...incoming.map((message) => message.seq)) : prev.lastSeq + 1;
        incoming = [
          { seq: first - 0.5, role: "volunteer", body: { text: shownText }, turnId },
          ...incoming,
        ];
      }
      const messages = mergeMessages(prev.messages, incoming);
      return applySnapshot(
        { ...prev, messages, lastSeq: maxSeq(messages, prev.lastSeq) },
        response.session,
        response.version,
      );
    });
  }, []);

  const runSearch = useCallback(
    async (kind: SearchKind) => {
      const current = viewRef.current;
      if (!current || searching.current) return;
      searching.current = true;
      setThinking({ kind, startedAt: Date.now() });
      let outcome = await postSearch(requestId, { sessionId: current.sessionId, kind });
      if (outcome.kind === "accepted") {
        await pollSearch();
        outcome = { kind: "accepted" };
      }
      searching.current = false;
      if (!alive.current) return;
      setThinking(null);
      if (outcome.kind === "unauthorized") {
        toList();
        return;
      }
      if (outcome.kind === "ok") {
        const done = outcome.data;
        setView((prev) => {
          if (!prev) return prev;
          const messages = mergeMessages(prev.messages, done.messages);
          return { ...prev, messages, lastSeq: maxSeq(messages, done.lastSeq) };
        });
      } else if (outcome.kind === "failed") {
        warn(outcome.status === 429 ? COPY.tooMany : COPY.searchFailed);
      }
      restoreFocus();
    },
    [requestId, pollSearch, toList, warn, restoreFocus],
  );

  /** 턴 한 번. 보낸 글은 먼저 보여 주고, 실패하면 입력 글을 되돌려 놓는다. 성공했으면 true. */
  const sendInput = useCallback(
    async (input: TurnInput, shownText: string | null, restoreDraft = ""): Promise<boolean> => {
      const current = viewRef.current;
      if (!current || turnBusy.current) return false;
      turnBusy.current = true;
      const turnId = newTurnId();
      const key = `o-${turnId}`;
      if (shownText) setOptimistic((list) => [...list, { key, text: shownText }]);
      setThinking({ kind: "turn", startedAt: Date.now() });
      say("");

      let outcome: Outcome<TurnResponse> = await postTurn(requestId, {
        clientTurnId: turnId,
        sessionId: current.sessionId,
        baseVersion: current.version,
        input,
      });
      if (outcome.kind === "accepted") {
        // 같은 턴이 아직 처리 중이다. 처리된 메시지가 보일 때까지 기다린다.
        outcome = { kind: "failed", status: 202, error: "pending", body: {} };
        for (let index = 0; index < 20 && alive.current; index += 1) {
          await sleep(1500);
          const polled = await fetchResearch(requestId);
          if (polled.kind === "ok" && polled.data.messages.some((message) => message.turnId === turnId)) {
            const mine = polled.data.messages.filter((message) => message.turnId === turnId);
            outcome = {
              kind: "ok",
              status: 200,
              data: { version: polled.data.version, messages: mine, session: polled.data, ai: "ok" },
            };
            break;
          }
        }
      }
      turnBusy.current = false;
      if (!alive.current) return false;
      setOptimistic((list) => list.filter((item) => item.key !== key));
      setThinking(null);

      if (outcome.kind === "ok") {
        applyTurn(outcome.data, shownText, turnId);
        const search = outcome.data.followUp?.search;
        if (search) void runSearch(search);
        else restoreFocus();
        return true;
      }
      if (outcome.kind === "unauthorized") {
        toList();
        return false;
      }
      if (restoreDraft) setDraft((value) => (value === "" ? restoreDraft : value));
      if (isStaleFailure(outcome)) {
        await reload();
        warn(COPY.stale);
      } else if (outcome.kind === "failed" && (outcome.status === 403 || outcome.status === 404)) {
        setLoad({ kind: "denied" });
      } else if (outcome.kind === "failed" && outcome.status === 429) {
        warn(COPY.tooMany);
      } else {
        warn(COPY.turnFailed);
      }
      restoreFocus();
      return false;
    },
    [requestId, say, warn, applyTurn, runSearch, reload, restoreFocus, toList],
  );

  const submitDraft = useCallback(() => {
    const text = draft.trim();
    if (!text || editing) return;
    if (turnBusy.current) {
      say("이전 답을 처리하는 중이에요. 잠시 뒤에 보내 주세요.");
      return;
    }
    setDraft("");
    void sendInput({ type: "text", text }, text, text);
  }, [draft, editing, say, sendInput]);

  // ----- 사진 -----

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const current = viewRef.current;
      if (!current || uploadingThumb) return;
      setAttachOpen(false);
      for (const file of files) {
        let shrunk: Awaited<ReturnType<typeof shrinkPhoto>>;
        try {
          shrunk = await shrinkPhoto(file);
        } catch {
          warn(COPY.photoRead);
          continue;
        }
        if (!alive.current) return;
        setUploadingThumb(shrunk.thumb);
        say("사진을 올리는 중이에요.");
        const outcome = await postPhoto(requestId, {
          sessionId: viewRef.current?.sessionId ?? current.sessionId,
          image: shrunk.image,
          thumb: shrunk.thumb,
        });
        if (!alive.current) return;
        if (outcome.kind === "unauthorized") {
          toList();
          return;
        }
        if (outcome.kind === "ok") {
          const result = outcome.data;
          setView((prev) => {
            if (!prev) return prev;
            const messages = mergeMessages(prev.messages, result.messages ?? []);
            const photo: PhotoView = { ...result.photo, thumb: result.photo.thumb ?? shrunk.thumb };
            return { ...prev, messages, lastSeq: maxSeq(messages, prev.lastSeq), photos: [...prev.photos.filter((item) => item.id !== photo.id), photo] };
          });
          // 구매 인증·칸·다음 질문은 서버 상태가 기준이라 한 번 다시 읽는다.
          const fresh = await reload();
          setUploadingThumb(null);
          say(COPY.photoDone);
          // 사진 뒤 다음 질문이 같이 고민한 제품이면 웹에서 후보를 찾는다(사진 응답에는 followUp이 없다).
          const tail = fresh?.messages[fresh.messages.length - 1];
          if (tail?.role === "ai" && tail.tag === "question" && tail.slot === "alts") void runSearch("alts");
        } else {
          setUploadingThumb(null);
          if (outcome.kind === "failed") {
            if (outcome.status === 413) warn(COPY.photoBig);
            else if (outcome.status === 415) warn(COPY.photoFormat);
            else if (outcome.error === "photos_full") warn(COPY.photoFull);
            else if (outcome.error === "photo_not_needed") warn(COPY.photoNotNeeded);
            else if (outcome.status === 429) warn(COPY.tooMany);
            else warn(COPY.photoFailed);
          } else warn(COPY.photoFailed);
        }
      }
      restoreFocus();
    },
    [requestId, uploadingThumb, say, warn, reload, restoreFocus, toList, runSearch],
  );

  const removePhoto = useCallback(
    async (photo: PhotoView) => {
      const outcome = await deletePhoto(requestId, photo.id);
      if (!alive.current) return;
      if (outcome.kind === "unauthorized") {
        toList();
        return;
      }
      if (outcome.kind === "ok") {
        await reload();
        say(COPY.photoRemoved);
      } else warn(COPY.photoFailed);
    },
    [requestId, reload, say, warn, toList],
  );

  // ----- 리뷰 -----

  const makeReview = useCallback(async () => {
    const current = viewRef.current;
    if (!current || reviewBusy) return;
    setReviewBusy(true);
    setThinking({ kind: "review", startedAt: Date.now() });
    const outcome = await postReview(requestId, { sessionId: current.sessionId });
    if (!alive.current) return;
    setThinking(null);
    setReviewBusy(false);
    if (outcome.kind === "unauthorized") {
      toList();
      return;
    }
    if (outcome.kind === "ok") {
      setView((prev) => (prev ? { ...prev, stage: "review", review: outcome.data.review } : prev));
    } else if (outcome.kind === "failed" && outcome.status === 409) {
      warn(COPY.reviewNotReady);
      await reload();
    } else {
      warn(COPY.reviewFailed);
    }
  }, [requestId, reviewBusy, toList, warn, reload]);

  const pickQuick = useCallback(
    (reply: QuickReply) => {
      if (reply.action === "review_make") void makeReview();
      else void sendInput({ type: "quick", replyId: reply.id }, reply.label);
    },
    [sendInput, makeReview],
  );

  const finishReview = useCallback(
    async (text: string) => {
      const current = viewRef.current;
      if (!current || reviewBusy) return;
      setReviewBusy(true);
      setReviewReasons([]);
      const outcome = await putReview(requestId, { sessionId: current.sessionId, baseVersion: current.version, text });
      if (!alive.current) return;
      setReviewBusy(false);
      if (outcome.kind === "unauthorized") {
        toList();
        return;
      }
      if (outcome.kind === "ok") {
        setView((prev) =>
          prev ? { ...prev, review: { ...prev.review, ...outcome.data.review, text: outcome.data.review.text ?? text } } : prev,
        );
        setEditing(false);
        say(COPY.confirmed);
        // 편집 칸이 사라지고 [보내기]가 그려진 뒤 그리로 초점이 간다(아래 effect).
        focusSend.current = true;
        return;
      }
      if (outcome.kind === "failed" && outcome.status === 422) {
        const reasons = Array.isArray(outcome.body.reasons)
          ? (outcome.body.reasons as unknown[]).filter((reason): reason is string => typeof reason === "string")
          : [];
        setReviewReasons(reasons.length > 0 ? reasons : ["문단을 다시 확인해 주세요."]);
      } else if (isStaleFailure(outcome)) {
        await reload();
        setEditing(false);
        warn(COPY.stale);
      } else {
        warn(COPY.reviewFailed);
      }
    },
    [requestId, reviewBusy, toList, say, warn, reload],
  );

  const sendFinal = useCallback(async () => {
    const current = viewRef.current;
    if (!current || sending || current.review.status !== "confirmed") return;
    setSending(true);
    const outcome = await postSend(requestId, {
      sessionId: current.sessionId,
      baseVersion: current.version,
      reviewRev: current.review.rev ?? 0,
    });
    if (!alive.current) return;
    setSending(false);
    if (outcome.kind === "unauthorized") {
      toList();
      return;
    }
    if (outcome.kind === "ok") {
      await finishSent();
      return;
    }
    if (outcome.kind === "failed" && outcome.status === 409) {
      warn(COPY.sendBlocked);
      await reload();
    } else if (outcome.kind === "failed" && (outcome.status === 403 || outcome.status === 404)) {
      setLoad({ kind: "denied" });
    } else warn(COPY.sendFailed);
  }, [requestId, sending, toList, warn, reload, finishSent]);

  const release = useCallback(async () => {
    if (releasing) return;
    setReleasing(true);
    const outcome = await releaseRequest(requestId);
    if (!alive.current) return;
    if (outcome.kind === "released") {
      saveFlash(VOLUNTEER_MESSAGES.releasedToQueue);
      router.push("/volunteer");
      return;
    }
    setReleasing(false);
    if (outcome.kind === "unauthorized") toList();
    else if (outcome.kind === "not_yours") setLoad({ kind: "denied" });
    else warn(outcome.message);
  }, [requestId, releasing, router, toList, warn]);

  // ----- 파생 값 -----

  const actions: ChatActions = useMemo(
    () => ({
      pickChip: (chip) => void sendInput({ type: "chip", slot: chip.slot, value: chip.value }, chip.label),
      own: () => composerRef.current?.focus(),
      pickProduct: (name) => void sendInput({ type: "chip", slot: "alts", value: name }, `${name}이랑 고민했어요`),
      noAlts: () => void sendInput({ type: "skip", slot: "alts" }, "같이 고민한 제품 없어요"),
      checkLink: (url) => {
        setLocalChecked((list) => (list.includes(url) ? list : [...list, url]));
        void sendInput({ type: "link_check", url }, null);
      },
      removePhoto: (photo) => void removePhoto(photo),
    }),
    [sendInput, removePhoto],
  );

  const slotsForLog = useMemo(() => {
    if (!view) return {};
    if (localChecked.length === 0) return view.slots;
    const benefits = view.slots.benefits;
    return {
      ...view.slots,
      benefits: {
        value: benefits?.value ?? "",
        status: benefits?.status ?? "filled",
        by: benefits?.by ?? "volunteer",
        ...benefits,
        links: [...(benefits?.links ?? []), ...localChecked],
      },
    };
  }, [view, localChecked]);

  const fold = useMemo(
    () => (view ? planFold(view.messages, view.verified) : { foldedUpTo: 0, foldedCount: 0, summary: "" }),
    [view],
  );

  // ----- 그리기 -----

  if (load.kind === "done") {
    return <SentView request={load.detail.request} result={load.detail.result!} />;
  }

  if (load.kind !== "ready" || !view || !request) {
    return (
      <div className="vol-chat vc-plain">
        <main className="vc-plain-main">
          <h1 ref={headingRef} tabIndex={-1} className="vc-plain-title">
            리서치 챗
          </h1>
          {load.kind === "loading" && <p className="vc-plain-note">불러오는 중이에요.</p>}
          {load.kind === "denied" && (
            <>
              <p role="status" className="vc-plain-note">
                {VOLUNTEER_MESSAGES.notYours}
              </p>
              <Link href="/volunteer" className="vc-btn">
                목록으로
              </Link>
            </>
          )}
          {load.kind === "failed" && (
            <>
              <p role="status" className="vc-plain-note">
                {load.message}
              </p>
              <button
                type="button"
                className="vc-btn vc-btn--ink"
                onClick={() => {
                  setLoad({ kind: "loading" });
                  setAttempt((value) => value + 1);
                }}
              >
                다시 불러오기
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  const subject = searchQueryOf(request);
  const badge = badgeOf(view);
  const progress = requiredProgress(view);
  const slot = currentSlot(view.messages);
  const last = view.messages[view.messages.length - 1];
  const lastQuick = last && last.role === "ai" ? quickOf(last.body) : [];
  const reviewShown = Boolean(view.review.text) && (view.review.status === "draft" || view.review.status === "confirmed");
  // 리뷰 카드가 나오면 리뷰 제안의 빠른 답은 끝난 것이다.
  const idle = !thinking && optimistic.length === 0 && !editing && !reviewShown;
  let quick: QuickReply[] = idle ? lastQuick : [];
  if (idle && view.purchase === "unset" && quick.length === 0) quick = PURCHASE_QUICK;
  const detailLine = [
    request.item ? `품목 ${request.item}` : null,
    request.brand ? `브랜드 ${request.brand}` : null,
    `예산 ${request.budget}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const reviewReady = reviewShown && view.review.status === "confirmed";
  const photoCount = view.photos.length;
  const placeholder = hero
    ? `${subject}${eulReul(subject)} 써 본 경험을 편하게 적어 주세요.${view.purchase === "research" ? "" : " 사진도 올릴 수 있어요."}`
    : editing
      ? "문단을 고치는 중이에요"
      : reviewReady
        ? "보내기 전에 한 번 더 읽어 보세요"
        : view.purchase === "research"
          ? "답을 적어 주세요"
          : "답을 적거나 사진을 올려 주세요";

  return (
    <div ref={stageRef} className={`vol-chat vc-stage ${hero ? "is-hero" : "is-chat"}`} data-testid="research-stage" data-mode={hero ? "hero" : "chat"}>
      <ResearchTopBar
        ref={headingRef}
        title={request.product}
        detail={detailLine}
        badge={badge}
        panelOpen={panelOpen}
        panelSummary={`필수 ${progress.filled}/${progress.total}`}
        onTogglePanel={() => setPanelOpen((value) => !value)}
        panelId="vc-panel"
      />
      <div className="vc-body">
        <HeroBackdrop variant={hero ? "hero" : "chat"} />
        <main className="vc-main">
          {hero && (
            <div className="vc-hero-copy">
              <StatusPill text={`요청을 맡았어요 · 이용자: “${request.product}”`} />
              <h2 className="vc-hero-title">
                {subject} 구매경험
                <br />
                리서치 어시스턴트
              </h2>
              <p className="vc-hero-sub">구매했던 경험을 시각장애인 유저에게 공유해 봐요.</p>
            </div>
          )}
          {!hero && <CurrentQuestionLine slot={slot} required={slot ? requiredSlots(view.purchase).includes(slot) : false} />}
          <div ref={scrollRef} className="vc-scroll">
            {!hero && (
              <ChatLog
                messages={view.messages}
                photos={view.photos}
                slots={slotsForLog}
                fold={fold}
                foldOpen={foldOpen}
                onToggleFold={() => setFoldOpen((value) => !value)}
                optimistic={optimistic}
                thinking={thinking}
                uploadingThumb={uploadingThumb}
                actions={actions}
              >
                {editing ? (
                  <ReviewEditor
                    initial={view.review.text ?? ""}
                    busy={reviewBusy}
                    reasons={reviewReasons}
                    onCancel={() => {
                      setEditing(false);
                      setReviewReasons([]);
                    }}
                    onFinish={(text) => void finishReview(text)}
                  />
                ) : (
                  reviewShown && (
                    <ReviewCard
                      ref={sendRef}
                      review={view.review}
                      sending={sending}
                      onEdit={() => {
                        setReviewReasons([]);
                        setEditing(true);
                      }}
                      onSend={() => void sendFinal()}
                    />
                  )
                )}
              </ChatLog>
            )}
          </div>
          <div ref={dockRef} className="vc-dock">
            <p role="status" className={`vc-notice${notice.text && notice.loud ? " is-loud" : ""}`}>
              {notice.text}
            </p>
            {attachOpen && (
              <AttachSheet
                uploading={Boolean(uploadingThumb)}
                full={photoCount >= 3}
                onFiles={(files) => void uploadFiles(files)}
                onClose={() => {
                  setAttachOpen(false);
                  attachButtonRef.current?.focus();
                }}
              />
            )}
            <QuickReplies
              replies={quick}
              disabled={reviewBusy}
              onPick={pickQuick}
              label="빠른 답"
            />
            <Composer
              ref={composerRef}
              variant={hero ? "hero" : "docked"}
              value={draft}
              placeholder={placeholder}
              attachVisible={view.purchase !== "research"}
              attachOpen={attachOpen}
              readOnly={editing}
              onChange={setDraft}
              onSubmit={submitDraft}
              onToggleAttach={() => setAttachOpen((value) => !value)}
              attachButtonRef={attachButtonRef}
            />
            {hero && <p className="vc-hero-note">AI는 찾고 정리하는 일만 도와요. 최종 판단은 봉사자님이 해요.</p>}
          </div>
        </main>
        <SlotPanel
          id="vc-panel"
          purchase={view.purchase}
          slots={view.slots}
          photoCount={photoCount}
          currentSlot={slot}
          open={panelOpen}
          reviewReady={reviewReady}
          onRelease={() => void release()}
          releasing={releasing}
        />
      </div>
    </div>
  );
}
