"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AttachSheet } from "./AttachSheet";
import { ChatLog, type ChatActions, type OptimisticMessage } from "./ChatLog";
import { Composer, type ComposerHandle } from "./Composer";
import { CurrentQuestionLine } from "./CurrentQuestionLine";
import { HeroBackdrop } from "./HeroBackdrop";
import { HeroCopy } from "./HeroCopy";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { PhotoQrDialog } from "./PhotoQrDialog";
import { QuickReplies } from "./QuickReplies";
import { ResearchTopBar } from "./ResearchTopBar";
import { SentMain, SentTopBar } from "./SentChat";
import { saveSentHistory } from "@/lib/sentHistory";
import { ReviewCard } from "./ReviewCard";
import { ReviewEditor } from "./ReviewEditor";
import { SlotPanel } from "./SlotPanel";
import { SidePane } from "@/components/SidePane";
import { BrandTitle } from "@/components/BrandTitle";
import { isPhonePhotoCommand } from "@/lib/photoCommand";
import { shrinkPhoto } from "@/lib/researchPhoto";
import { lastQuestionSeq, newlyFilled } from "@/lib/chatPanelView";
import { usePanels } from "@/lib/usePanels";
import { SIDE_PANE_ID, useSidePane } from "@/lib/useSidePane";
import {
  activeQuick,
  arrangeMessages,
  badgeOf,
  currentSlot,
  failureText,
  holdsRefsQuestion,
  needsBenefitsSearch,
  planFold,
  reasonsOf,
  requiredProgress,
  requiredSlots,
  type QuickReply,
  type ThinkingKind,
} from "@/lib/researchChatView";
import {
  applySnapshot,
  deletePhoto,
  deletePhotoLink,
  fetchResearch,
  isStaleFailure,
  maxSeq,
  mergeMessages,
  mergeView,
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
  type SlotKey,
  type TurnInput,
  type TurnResponse,
} from "@/lib/researchClient";
import { searchQueryOf } from "@/lib/shopLinks";
import {
  clearLegacyDrafts,
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

const PANEL_ID = "vc-panel";
const POLL_MS = 2000;
/** 휴대폰 사진 링크가 열려 있는 동안 새 사진을 읽어 오는 간격. */
const PHONE_POLL_MS = 2500;
const POLL_MAX = 45;

const COPY = {
  turnFailed: "보내지 못했어요. 쓴 글은 그대로 두었어요. 다시 보내 주세요.",
  stale: "다른 곳에서 내용이 바뀌어 다시 불러왔어요. 쓴 글은 그대로 두었어요.",
  searchFailed: "찾지 못했어요. 쇼핑몰에서 직접 찾아도 돼요.",
  photoRead: "사진을 읽지 못했어요. 다른 사진을 골라 주세요.",
  photoFailed: "사진을 올리지 못했어요. 다시 해 주세요.",
  phonePhoto: "휴대폰에서 사진을 받았어요.",
  photosFull: "사진은 3장까지 올릴 수 있어요.",
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
  const [qrOpen, setQrOpen] = useState(false);
  /** 새로 채워진 칸이 있는데 오른쪽 창이 닫혀 있다(버튼에 점). 창을 열면 지운다. */
  const [unseen, setUnseen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReasons, setReviewReasons] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [releasing, setReleasing] = useState(false);
  /** 혜택 검색이 한 번 끝났다(성공·실패 모두). 카드가 안 와도 질문 7을 계속 보류하지 않으려는 표시. 새 혜택 검색이 시작되면 false. */
  const [benefitsEnded, setBenefitsEnded] = useState(false);

  const alive = useRef(true);
  const viewRef = useRef<ResearchView | null>(null);
  const turnBusy = useRef(false);
  const searching = useRef(false);
  /** 부르기로 한 검색. 한 번에 하나씩 차례로 부른다(이미 돌고 있는 종류는 다시 넣지 않는다). */
  const searchQueue = useRef<SearchKind[]>([]);
  const runningSearch = useRef<SearchKind | null>(null);
  /** 혜택 검색을 한 번 마쳤다(실패하면 false). 턴마다 같은 검색을 되풀이해 부르지 않으려는 표시. */
  const benefitsAsked = useRef(false);
  /** [확인했어요]가 눌렸고 서버가 아직 답하지 않은 주소(같은 카드를 두 번 보내지 않는다)와 턴이 끝나길 기다리는 주소. */
  const pendingLinks = useRef<Set<string>>(new Set());
  const linkQueue = useRef<string[]>([]);
  const afterTurn = useRef<() => void>(() => undefined);
  const drainRef = useRef<() => Promise<void>>(async () => undefined);
  /** 혜택 칸은 찼는데 혜택 카드가 없으면 혜택 검색을 대기열에 넣는다(처음 읽기·각 검색이 끝날 때·턴 뒤). */
  const ensureBenefitsRef = useRef<() => void>(() => undefined);
  /** 폴링처럼 leftProgress보다 먼저 정의되는 곳이 쓴다(409 not_in_progress면 요청 상세를 다시 읽는다). */
  const leftProgressRef = useRef<(outcome: Outcome<unknown>) => boolean>(() => false);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const moreToggleRef = useRef<HTMLButtonElement>(null);
  /** putView가 오른쪽 창이 닫혀 있는지 알려고 읽는다. */
  const slotsOpenRef = useRef(false);
  /** 접힌 앞부분의 질문으로 가려고 접힌 목록을 연 뒤, 그려진 다음 옮길 질문 seq. */
  const pendingJump = useRef<number | null>(null);
  const focusSend = useRef(false);
  /** QR 창을 닫을 때 초점을 돌려줄 곳(첨부 버튼에서 열었으면 그 버튼, 입력창의 말로 열었으면 입력창). */
  const qrReturn = useRef<"attach" | "composer">("attach");
  /** 창을 닫을 때 보낸 링크 끊기(DELETE). 바로 다시 열어도 이것이 끝난 뒤에 새 링크를 만든다(늦게 닿은 끊기가 새 링크를 끊지 않게). */
  const qrRevoke = useRef<Promise<unknown>>(Promise.resolve());
  /** 맨 아래를 보던 중인가. 스크롤을 직접 올리면 false가 되고, 새 말풍선이 붙어 맨 아래로 가면 true가 된다. */
  const stick = useRef(true);
  const ignoreScrollUntil = useRef(0);

  useEffect(() => {
    alive.current = true;
    // 옛 카드형 화면이 이 기기에 남긴 진행 상태(사진 썸네일 포함)는 더 읽지 않는다. 저장 공간을 비운다.
    clearLegacyDrafts();
    return () => {
      alive.current = false;
    };
  }, []);

  /** 화면 상태의 기준은 viewRef다. 바꾸면 곧바로 ref에 반영해(렌더를 기다리지 않아) 이어지는 호출이 최신 version을 쓴다. */
  const putView = useCallback((next: ResearchView) => {
    // 오른쪽 창이 닫힌 동안 칸이 새로 채워지면 버튼에 점을 단다(처음 읽을 때는 이전 값이 없어 달지 않는다).
    const prev = viewRef.current;
    if (prev && !slotsOpenRef.current && newlyFilled(prev.slots, next.slots).length > 0) setUnseen(true);
    viewRef.current = next;
    setView(next);
  }, []);

  const updateView = useCallback(
    (change: (prev: ResearchView) => ResearchView) => {
      const prev = viewRef.current;
      if (prev) putView(change(prev));
    },
    [putView],
  );

  const say = useCallback((text: string) => setNotice({ text, loud: false }), []);
  const warn = useCallback((text: string) => setNotice({ text, loud: true }), []);

  const toList = useCallback(() => router.replace("/volunteer"), [router]);
  // 히어로(맡은 직후)는 대화가 비어 있는 동안이다. 두 창의 열림이 이 값을 쓴다.
  const hero =
    !!view && view.stage === "hero" && view.messages.length === 0 && optimistic.length === 0 && !uploadingThumb && !thinking;
  // 두 창(왼쪽 대기열·내 담당, 오른쪽 모은 정보)의 열림과 기억.
  const panels = usePanels({ hero });
  useEffect(() => {
    slotsOpenRef.current = panels.slotsOpen;
  }, [panels.slotsOpen]);
  // 왼쪽 창 데이터. 열 때 목록을 한 번 읽는다(401이면 첫 화면으로).
  const sideToggleRef = useRef<HTMLButtonElement>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const mineHeadingRef = useRef<HTMLHeadingElement>(null);
  const pane = useSidePane({
    toggleRef: sideToggleRef,
    queueHeadingRef,
    mineHeadingRef,
    open: panels.mineOpen,
    setOpen: panels.setMine,
    onUnauthorized: toList,
    say,
    initialSection: "mine",
  });
  const refreshPane = pane.refresh;

  // ----- 불러오기 -----

  const reload = useCallback(async (): Promise<ResearchView | null> => {
    const result = await fetchResearch(requestId);
    if (!alive.current) return null;
    if (result.kind === "unauthorized") {
      toList();
      return null;
    }
    if (result.kind === "failed") leftProgressRef.current(result);
    if (result.kind !== "ok") return null;
    putView(result.data);
    return result.data;
  }, [requestId, toList, putView]);

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
      if (result.kind === "failed" && leftProgressRef.current(result)) return false;
      if (result.kind !== "ok") continue;
      const incoming = result.data;
      if (viewRef.current) updateView((prev) => mergeView(prev, incoming));
      else putView(incoming);
      if (!incoming.pending.search) return true;
    }
    return false;
  }, [requestId, toList, updateView, putView]);

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
      if (result.kind === "failed" && result.error === "not_in_progress") {
        // 읽는 사이 다른 곳에서 보냈거나 내려놓았다. 요청 상세로 보냈으면 완료 화면, 아니면 접근 불가.
        const again = await fetchRequest(requestId);
        if (cancelled) return;
        if (again.kind === "ok" && again.data.result) setLoad({ kind: "done", detail: again.data });
        else setLoad({ kind: "denied" });
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
      putView(result.data);
      setLoad({ kind: "ready" });
      // 검색 중에 새로 고친 화면이면 끝날 때까지 이어서 기다린다.
      const pending = result.data.pending.search;
      if (pending) {
        searching.current = true;
        runningSearch.current = pending.kind;
        setThinking({ kind: pending.kind, startedAt: Date.now() });
        await pollSearch();
        searching.current = false;
        runningSearch.current = null;
        if (!cancelled) {
          setThinking(null);
          if (pending.kind === "benefits") {
            benefitsAsked.current = true;
            setBenefitsEnded(true);
          }
        }
      }
      if (!cancelled) {
        // 새로 고치기 전에 끝나지 않은 일: 혜택 칸은 찼는데 카드가 없으면 혜택 검색을 부른다.
        ensureBenefitsRef.current();
        // 기다리는 동안 부르기로 한 검색이 있으면 이어서 부른다.
        if (searchQueue.current.length > 0) void drainRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, toList, attempt, pollSearch, putView]);

  const finishSent = useCallback(async () => {
    const detail = await fetchRequest(requestId);
    if (!alive.current) return;
    if (detail.kind === "ok" && detail.data.result) {
      setLoad({ kind: "done", detail: detail.data });
      // 왼쪽 창 "내 담당"에서 이 요청이 진행 중에서 완료로 옮겨 가게 목록을 다시 읽고, 창 안에서 그 구역이 보이게 스크롤한다(초점은 옮기지 않는다).
      void refreshPane(false).then((ok) => {
        const heading = mineHeadingRef.current;
        const aside = heading?.closest("aside");
        if (!ok || !heading || !aside || !alive.current) return;
        window.setTimeout(() => {
          aside.scrollTop += heading.getBoundingClientRect().top - aside.getBoundingClientRect().top - 12;
        }, 0);
      });
    } else setAttempt((value) => value + 1);
  }, [requestId, refreshPane]);

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
    stick.current = true;
    ignoreScrollUntil.current = Date.now() + 900;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() || distance > 600 ? "auto" : "smooth" });
  }, [messageCount, optimistic.length, thinking, reviewStatus, editing, uploadingThumb, reviewReasons.length]);

  // 입력창 묶음 높이를 알려 대화가 그 뒤로 가려지지 않게 한다.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const stage = stageRef.current;
    if (!dock || !stage) return;
    const measure = () => {
      stage.style.setProperty("--vc-dock-h", `${dock.offsetHeight}px`);
      // 빠른 답 줄이 생기거나 사라져 입력 묶음 높이가 바뀌면, 맨 아래를 보던 중이었을 때 다시 맨 아래로 맞춘다(마지막 말풍선이 가려지지 않게).
      const el = scrollRef.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    return () => observer?.disconnect();
  }, [load.kind]);

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

  // 겹쳐 열린 오른쪽 창(1179px 이하, 히어로)은 Esc로 닫고 초점을 버튼으로 돌려준다. 붙어 있는 창(1180px 이상 대화)은 그대로 둔다.
  const slotsOverlay = !panels.wide || hero;
  useEffect(() => {
    if (!panels.slotsOpen || !slotsOverlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      panels.setSlots(false);
      panelToggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panels, slotsOverlay]);

  // "더 보기" 메뉴: Esc나 바깥을 누르면 닫고 초점을 "더 보기"로 돌려준다.
  useEffect(() => {
    if (!moreOpen) return;
    const close = () => {
      setMoreOpen(false);
      moreToggleRef.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (document.getElementById("vc-more")?.contains(target) || moreToggleRef.current?.contains(target))) return;
      setMoreOpen(false);
      // 초점은 항상 "더 보기"로 돌아온다(누른 곳이 받은 초점은 이 한 번 덮는다).
      window.setTimeout(() => moreToggleRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [moreOpen]);

  // ----- 서버 호출 -----

  const applyTurn = useCallback((response: TurnResponse, shownText: string | null, turnId: string) => {
    updateView((prev) => {
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
  }, [updateView]);

  /** 6시간 활동이 없어 대기열로 돌아갔거나 다른 곳에서 보냈다. 어느 호출에서나 요청 상태를 다시 읽어 화면을 바꾼다(contract-ui.md). */
  const leftProgress = useCallback(
    (outcome: Outcome<unknown>): boolean => {
      if (outcome.kind !== "failed" || outcome.error !== "not_in_progress") return false;
      void finishSent();
      return true;
    },
    [finishSent],
  );

  useEffect(() => {
    leftProgressRef.current = leftProgress;
  }, [leftProgress]);

  /** 검색 한 번. 같은 검색이 이미 처리 중이면(202) 서버 상태를 기다린다. */
  const searchOnce = useCallback(
    async (kind: SearchKind) => {
      const current = viewRef.current;
      if (!current) return;
      runningSearch.current = kind;
      if (kind === "benefits") {
        benefitsAsked.current = true;
        setBenefitsEnded(false);
      }
      setThinking({ kind, startedAt: Date.now() });
      let outcome = await postSearch(requestId, { sessionId: current.sessionId, kind });
      if (outcome.kind === "accepted") {
        await pollSearch();
        outcome = { kind: "accepted" };
      }
      runningSearch.current = null;
      if (!alive.current) return;
      setThinking(null);
      if (kind === "benefits") setBenefitsEnded(true);
      if (outcome.kind === "unauthorized") {
        toList();
        return;
      }
      if (outcome.kind === "ok") {
        const done = outcome.data;
        let missed = false;
        updateView((prev) => {
          const messages = mergeMessages(prev.messages, done.messages);
          // 서버가 캐시로 답하면 messages가 비고 lastSeq만 온다(다른 탭이 이미 검색을 끝냄). 이 화면에 없는 번호가 있으면 lastSeq를 올리지 않고 아래에서 읽어 온다.
          missed = done.lastSeq > maxSeq(messages, prev.lastSeq);
          return { ...prev, messages, lastSeq: missed ? maxSeq(messages, prev.lastSeq) : maxSeq(messages, done.lastSeq) };
        });
        if (missed) {
          const got = await fetchResearch(requestId, viewRef.current?.lastSeq);
          if (!alive.current) return;
          if (got.kind === "failed" && leftProgress(got)) return;
          if (got.kind === "ok") {
            const incoming = got.data;
            updateView((prev) => mergeView(prev, incoming));
          }
        }
      } else if (outcome.kind === "failed") {
        if (kind === "benefits") benefitsAsked.current = false;
        if (!leftProgress(outcome)) warn(failureText("search", outcome.status, outcome.error, outcome.body, COPY.searchFailed));
      }
      // 이 검색이 끝난 뒤 혜택 칸은 찼는데 혜택 카드가 없으면(기종 검색 중 새로 고친 경우 등) 혜택 검색을 이어서 부른다.
      if (kind !== "benefits") ensureBenefitsRef.current();
    },
    [requestId, pollSearch, toList, warn, updateView, leftProgress],
  );

  /** 모인 검색을 차례로 부른다. 한 검색이 도는 동안 온 다음 검색은 기다렸다가 이어서 부른다. */
  const drainSearches = useCallback(async () => {
    if (searching.current) return;
    searching.current = true;
    while (alive.current) {
      const kind = searchQueue.current.shift();
      if (!kind) break;
      await searchOnce(kind);
    }
    searching.current = false;
    if (alive.current) restoreFocus();
  }, [searchOnce, restoreFocus]);

  useEffect(() => {
    drainRef.current = drainSearches;
  }, [drainSearches]);

  const runSearch = useCallback(
    (kind: SearchKind) => {
      if (!viewRef.current) return;
      if (runningSearch.current === kind || searchQueue.current.includes(kind)) return;
      searchQueue.current.push(kind);
      void drainSearches();
    },
    [drainSearches],
  );

  const ensureBenefits = useCallback(() => {
    const now = viewRef.current;
    if (now && !benefitsAsked.current && needsBenefitsSearch(now)) runSearch("benefits");
  }, [runSearch]);

  useEffect(() => {
    ensureBenefitsRef.current = ensureBenefits;
  }, [ensureBenefits]);

  /** 턴 한 번(turnBusy를 비운 쪽이 부른다). 보낸 글은 먼저 보여 주고, 실패하면 입력 글을 되돌려 놓는다. 성공했으면 true. */
  const runTurn = useCallback(
    async (input: TurnInput, shownText: string | null, restoreDraft: string): Promise<boolean> => {
      const current = viewRef.current;
      if (!current) return false;
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
        if (search) runSearch(search);
        // followUp은 하나만 온다. 같은 턴에 혜택 칸도 정해졌다면(기종·대안 질문과 함께 앞질러 답함) 그 검색도 이어서 부른다.
        ensureBenefits();
        if (!search) restoreFocus();
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
      } else if (leftProgress(outcome)) {
        // 요청 상태를 다시 읽어 화면을 바꾼다.
      } else {
        warn(
          outcome.kind === "failed"
            ? failureText("turn", outcome.status, outcome.error, outcome.body, COPY.turnFailed)
            : COPY.turnFailed,
        );
      }
      restoreFocus();
      return false;
    },
    [requestId, say, warn, applyTurn, runSearch, ensureBenefits, reload, restoreFocus, toList, leftProgress],
  );

  /** 턴을 보낸다. 다른 턴이 처리 중이면 보내지 않고 false를 돌려준다. 끝나면 기다리던 [확인했어요]를 이어서 보낸다. */
  const sendInput = useCallback(
    async (input: TurnInput, shownText: string | null, restoreDraft = ""): Promise<boolean> => {
      if (turnBusy.current) return false;
      const ok = await runTurn(input, shownText, restoreDraft);
      if (alive.current) afterTurn.current();
      return ok;
    },
    [runTurn],
  );

  const submitDraft = useCallback(() => {
    const text = draft.trim();
    if (!text || editing) return;
    // "QR", "휴대폰으로 찍을게요" 같은 말은 턴을 보내지 않고 사진 QR 창을 연다(낱말 대조, AI 호출 없음).
    const now = viewRef.current;
    if (now && now.purchase !== "research" && isPhonePhotoCommand(text)) {
      setDraft("");
      if (now.photos.length >= 3) say(COPY.photosFull);
      else {
        qrReturn.current = "composer";
        setAttachOpen(false);
        setQrOpen(true);
      }
      return;
    }
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
          updateView((prev) => {
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
          if (tail?.role === "ai" && tail.tag === "question" && tail.slot === "alts") runSearch("alts");
        } else {
          setUploadingThumb(null);
          if (outcome.kind === "failed") {
            if (leftProgress(outcome)) return;
            warn(failureText("photo", outcome.status, outcome.error, outcome.body, COPY.photoFailed));
          } else warn(COPY.photoFailed);
        }
      }
      restoreFocus();
    },
    [requestId, uploadingThumb, say, warn, reload, restoreFocus, toList, runSearch, updateView, leftProgress],
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
      } else if (!leftProgress(outcome)) warn(COPY.photoFailed);
    },
    [requestId, reload, say, warn, toList, leftProgress],
  );

  // ----- 휴대폰 사진(QR) -----

  // 사진 질문 때 저절로 띄운 QR인지. 저절로 띄운 창은 질문이 넘어가면 저절로 닫는다(손으로 연 창은 그대로 둔다).
  const autoQrSeq = useRef(0);
  const autoQrOpen = useRef(false);

  const openQr = useCallback(() => {
    qrReturn.current = "attach";
    setAttachOpen(false);
    setQrOpen(true);
  }, []);

  /** 창을 닫는다. 휴대폰이 아직 안 쓴 링크(waiting)는 더 보이지 않으니 끊는다. 연결된 뒤에는 사진을 계속 받는다. */
  const closeQr = useCallback((options?: { focus?: boolean }) => {
    const current = viewRef.current;
    autoQrOpen.current = false;
    setQrOpen(false);
    if (current?.photoLink?.state === "waiting") {
      updateView((prev) => ({ ...prev, photoLink: { state: "none", expiresAt: null } }));
      qrRevoke.current = deletePhotoLink(requestId, current.sessionId);
    }
    if (options?.focus === false) return;
    if (qrReturn.current === "attach") attachButtonRef.current?.focus();
    else composerRef.current?.focus();
  }, [requestId, updateView]);

  const qrSettled = useCallback(() => qrRevoke.current, []);

  const onQrIssued = useCallback(
    (expiresAt: string) => updateView((prev) => ({ ...prev, photoLink: { state: "waiting", expiresAt } })),
    [updateView],
  );

  // 사진 칸 질문이 지금 질문이 되면 [+]를 누르지 않아도 QR을 바로 띄운다. 한 질문에 한 번만 띄우고, 닫으면 다시 띄우지 않는다.
  const photoAskSeq = (() => {
    const messages = view?.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "ai" && message.tag === "question" && message.slot) return message.slot === "photo" ? message.seq : 0;
    }
    return 0;
  })();
  const photoCountNow = view?.photos.length ?? 0;
  const photoNeeded = view ? view.purchase !== "research" && view.stage !== "sent" : false;
  useEffect(() => {
    if (!photoNeeded || photoAskSeq === 0 || photoAskSeq <= autoQrSeq.current || photoCountNow >= 3) return;
    autoQrSeq.current = photoAskSeq;
    const timer = window.setTimeout(() => {
      qrReturn.current = "composer";
      autoQrOpen.current = true;
      setAttachOpen(false);
      setQrOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [photoNeeded, photoAskSeq, photoCountNow]);

  // 저절로 띄운 QR은 사진 질문이 끝나면(다음 질문으로 넘어가거나 사진을 컴퓨터에서 올려 칸이 찼을 때) 닫는다. 초점은 옮기지 않는다.
  useEffect(() => {
    if (!qrOpen || !autoQrOpen.current || photoAskSeq !== 0) return;
    const timer = window.setTimeout(() => closeQr({ focus: false }), 0);
    return () => window.clearTimeout(timer);
  }, [qrOpen, photoAskSeq, closeQr]);

  const qrOpenRef = useRef(false);
  useEffect(() => {
    qrOpenRef.current = qrOpen;
  }, [qrOpen]);

  const photoLinkState = view?.photoLink?.state;
  const watchingPhone = qrOpen || photoLinkState === "waiting" || photoLinkState === "connected";

  // QR 창이 열려 있거나 휴대폰이 연결돼 있는 동안 새 사진·말풍선을 읽어 온다(GET ?after, 사진 썸네일은 따로 한 번).
  // 검색을 기다리는 동안은 그 폴링이 같은 응답을 읽으니 건너뛴다.
  useEffect(() => {
    if (!watchingPhone) return;
    let stopped = false;
    let busy = false;
    const lastAltsAsked = (messages: readonly ChatMessage[]) =>
      messages.reduce((top, m) => (m.role === "ai" && m.tag === "question" && m.slot === "alts" ? Math.max(top, m.seq) : top), 0);
    let altsSeen = viewRef.current ? lastAltsAsked(viewRef.current.messages) : 0;
    const tick = async () => {
      const current = viewRef.current;
      if (stopped || busy || !current || turnBusy.current || searching.current) return;
      busy = true;
      try {
        const result = await fetchResearch(requestId, current.lastSeq);
        if (stopped || !alive.current) return;
        if (result.kind === "unauthorized") {
          toList();
          return;
        }
        if (result.kind === "failed") {
          leftProgressRef.current(result);
          return;
        }
        if (result.kind !== "ok") return;
        let incoming = result.data;
        const before = viewRef.current;
        if (!before || incoming.version < before.version) return;
        // 썸네일은 처음 읽을 때만 오므로, 새 사진이 보이면 한 번 전체를 읽어 채운다.
        const known = new Set(before.photos.filter((photo) => photo.thumb).map((photo) => photo.id));
        if (incoming.photos.some((photo) => !known.has(photo.id))) {
          const full = await fetchResearch(requestId);
          if (stopped || !alive.current) return;
          if (full.kind === "ok" && full.data.version >= incoming.version) incoming = full.data;
        }
        const gained = incoming.photos.length - before.photos.length;
        updateView((prev) => (incoming.version < prev.version ? prev : mergeView(prev, incoming)));
        if (gained > 0) {
          say(COPY.phonePhoto);
          // 사진을 받았으면 창을 닫고 입력창으로 돌아간다. 연결은 그대로라 같은 휴대폰에서 더 올릴 수 있다.
          if (qrOpenRef.current) {
            setQrOpen(false);
            composerRef.current?.focus();
          }
        }
        const merged = viewRef.current;
        if (merged) {
          const asked = lastAltsAsked(merged.messages);
          // 사진 뒤 다음 질문이 같이 고민한 제품이면 웹에서 후보를 찾는다(노트북 올리기와 같다).
          if (asked > altsSeen) {
            altsSeen = asked;
            runSearch("alts");
          }
        }
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void tick(), PHONE_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [watchingPhone, requestId, toList, say, updateView, runSearch]);

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
      updateView((prev) => ({ ...prev, stage: "review", review: outcome.data.review }));
    } else if (leftProgress(outcome)) {
      // 요청 상태를 다시 읽어 화면을 바꾼다.
    } else if (outcome.kind === "failed" && outcome.status === 409) {
      warn(failureText("review", outcome.status, outcome.error, outcome.body, COPY.reviewNotReady));
      await reload();
    } else {
      warn(COPY.reviewFailed);
    }
  }, [requestId, reviewBusy, toList, warn, reload, updateView, leftProgress]);

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
        updateView((prev) => ({ ...prev, review: { ...prev.review, ...outcome.data.review, text: outcome.data.review.text ?? text } }));
        setEditing(false);
        say(COPY.confirmed);
        // 편집 칸이 사라지고 [보내기]가 그려진 뒤 그리로 초점이 간다(아래 effect).
        focusSend.current = true;
        return;
      }
      if (outcome.kind === "failed" && outcome.status === 422) {
        const reasons = reasonsOf(outcome.body);
        setReviewReasons(reasons.length > 0 ? reasons : ["문단을 다시 확인해 주세요."]);
      } else if (isStaleFailure(outcome)) {
        await reload();
        setEditing(false);
        warn(COPY.stale);
      } else if (leftProgress(outcome)) {
        // 요청 상태를 다시 읽어 화면을 바꾼다.
      } else if (outcome.kind === "failed" && outcome.status === 409) {
        warn(failureText("review", outcome.status, outcome.error, outcome.body, COPY.reviewNotReady));
      } else {
        warn(COPY.reviewFailed);
      }
    },
    [requestId, reviewBusy, toList, say, warn, reload, updateView, leftProgress],
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
      // 서버는 보내는 순간 대화를 지운다. 완료 화면에서 다시 볼 수 있게 이 기기에만 글로 남긴다(30일, A8).
      saveSentHistory(requestId, current.messages);
      await finishSent();
      return;
    }
    if (outcome.kind === "failed" && isStaleFailure(outcome)) {
      await reload();
      warn(COPY.stale);
    } else if (leftProgress(outcome)) {
      // 요청 상태를 다시 읽어 화면을 바꾼다.
    } else if (outcome.kind === "failed" && outcome.status === 409) {
      warn(failureText("send", outcome.status, outcome.error, outcome.body, COPY.sendBlocked));
      await reload();
    } else if (outcome.kind === "failed" && (outcome.status === 403 || outcome.status === 404)) {
      setLoad({ kind: "denied" });
    } else warn(COPY.sendFailed);
  }, [requestId, sending, toList, warn, reload, finishSent, leftProgress]);

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

  /**
   * [확인했어요]. 서버가 받은 뒤에야(`slots.*.links`에 들어간 뒤에야) "확인함"으로 그린다. 실패하면 그대로 두고 안내한다.
   * 다른 턴이 처리 중이면 그 턴이 끝난 뒤에 보낸다(버리지 않는다).
   */
  const checkLink = useCallback(
    (url: string) => {
      if (pendingLinks.current.has(url)) return;
      pendingLinks.current.add(url);
      if (turnBusy.current) {
        linkQueue.current.push(url);
        say("확인한 내용을 저장하는 중이에요. 잠시만 기다려 주세요.");
        return;
      }
      void sendInput({ type: "link_check", url }, null).finally(() => pendingLinks.current.delete(url));
    },
    [sendInput, say],
  );

  useEffect(() => {
    afterTurn.current = () => {
      const url = linkQueue.current.shift();
      if (url === undefined) return;
      void sendInput({ type: "link_check", url }, null).finally(() => pendingLinks.current.delete(url));
    };
  }, [sendInput]);

  const actions: ChatActions = useMemo(
    () => ({
      pickChip: (chip) => void sendInput({ type: "chip", slot: chip.slot, value: chip.value }, chip.label),
      own: () => composerRef.current?.focus(),
      pickProduct: (name) => void sendInput({ type: "chip", slot: "alts", value: name }, `${name}이랑 고민했어요`),
      noAlts: () => void sendInput({ type: "skip", slot: "alts" }, "같이 고민한 제품 없어요"),
      checkLink,
      removePhoto: (photo) => void removePhoto(photo),
    }),
    [sendInput, removePhoto, checkLink],
  );

  // 질문 7은 혜택 카드 뒤에 그린다(검색 중에는 보류). 화면이 보이는 순서가 이 목록이다.
  const searchingBenefits = holdsRefsQuestion(view, thinking?.kind ?? null, benefitsEnded);
  const shown = useMemo(() => (view ? arrangeMessages(view.messages, searchingBenefits) : []), [view, searchingBenefits]);

  const fold = useMemo(
    () => (view ? planFold(shown, view.verified) : { foldedUpTo: 0, foldedCount: 0, summary: "" }),
    [view, shown],
  );

  // ----- "모은 정보" 칸 누르기: 그 칸의 마지막 질문 말풍선으로 스크롤하고 초점을 옮긴다(서버 호출 없음) -----

  const performJump = useCallback((seq: number) => {
    const el = document.getElementById(`vc-q-${seq}`);
    if (!el) return;
    // 직접 올려 본 것처럼 취급해 새 말풍선이 와도 끌려 내려가지 않고, 이 스크롤이 맨 아래 고정을 풀지 않는다.
    stick.current = false;
    ignoreScrollUntil.current = Date.now() + 900;
    el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, []);

  // 접힌 목록을 연 다음 그려지면 옮긴다.
  useEffect(() => {
    if (pendingJump.current === null || !foldOpen) return;
    const seq = pendingJump.current;
    pendingJump.current = null;
    performJump(seq);
  }, [foldOpen, performJump]);

  const jumpTo = (slotKey: SlotKey) => {
    const seq = hero ? null : lastQuestionSeq(shown, slotKey);
    if (seq === null) {
      say("아직 묻지 않았어요");
      return;
    }
    // 좁은 화면에서는 오른쪽 창이 대화를 덮으므로 닫은 뒤 옮긴다.
    if (!panels.wide) panels.setSlots(false);
    if (seq <= fold.foldedUpTo && !foldOpen) {
      pendingJump.current = seq;
      setFoldOpen(true);
      return;
    }
    performJump(seq);
  };

  // ----- 그리기 -----

  // 보낸 요청: 같은 챗봇 화면(위 막대·왼쪽 창·본문 틀)에서 보낸 리뷰를 읽기 전용으로 보인다.
  if (load.kind === "done") {
    return (
      <div className={`vol-chat vc-stage is-chat${panels.mineOpen ? " has-mine" : ""}`} data-testid="sent-stage" data-mode="sent">
        <SentTopBar
          request={load.detail.request}
          headingRef={headingRef}
        />
        <div className="vc-body">
          <HeroBackdrop variant="chat" />
          <SidePane id={SIDE_PANE_ID} open={panels.mineOpen} pane={pane} onClose={pane.close} onOpen={panels.toggleMine} toggleRef={sideToggleRef} currentId={requestId} queueHeadingRef={queueHeadingRef} mineHeadingRef={mineHeadingRef} />
          <SentMain requestId={requestId} result={load.detail.result!} />
        </div>
      </div>
    );
  }

  // 읽는 동안: 단색 페이지로 바꾸지 않고 히어로 화면(위 막대·배경·왼쪽 창)을 그대로 그린 채 도는 아이콘만 얹는다.
  // 맡기 직후 첫 화면에서 이어지는 덮개라 새로 떠오르지 않게(instant) 한다.
  if (load.kind === "loading") {
    return (
      <div className={`vol-chat vc-stage is-hero${panels.mineOpen ? " has-mine" : ""}`} data-testid="research-loading" data-mode="loading">
        <header className="vc-topbar vh-topbar">
          <BrandTitle ref={headingRef} context="리서치 챗" />
          <span className="vh-spacer" />
        </header>
        <div className="vc-body">
          <HeroBackdrop variant="hero" />
          <SidePane id={SIDE_PANE_ID} open={panels.mineOpen} pane={pane} onClose={pane.close} onOpen={panels.toggleMine} toggleRef={sideToggleRef} currentId={requestId} queueHeadingRef={queueHeadingRef} mineHeadingRef={mineHeadingRef} />
          <main className="vc-main">
            <LoadingOverlay instant />
          </main>
        </div>
      </div>
    );
  }

  if (load.kind !== "ready" || !view || !request) {
    return (
      <div className="vol-chat vc-plain">
        <main className="vc-plain-main">
          <h1 ref={headingRef} tabIndex={-1} className="vc-plain-title">
            리서치 챗
          </h1>
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
  const slot = currentSlot(shown);
  const last = shown[shown.length - 1];
  const lastQuick = last ? activeQuick(shown) : [];
  const reviewShown = Boolean(view.review.text) && (view.review.status === "draft" || view.review.status === "confirmed");
  // 리뷰 카드가 나오면 리뷰 제안의 빠른 답은 끝난 것이다.
  const idle = !thinking && optimistic.length === 0 && !editing && !reviewShown;
  let quick: QuickReply[] = idle ? lastQuick : [];
  if (idle && view.purchase === "unset" && quick.length === 0) quick = PURCHASE_QUICK;
  // 이용자가 말한 조건(새 제품·중고 또는 자유 문장)과 브랜드를 빠뜨리지 않는다.
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
    <div ref={stageRef} className={`vol-chat vc-stage ${hero ? "is-hero" : "is-chat"}${panels.mineOpen ? " has-mine" : ""}${panels.slotsOpen && !hero ? " has-slots" : ""}`} data-testid="research-stage" data-mode={hero ? "hero" : "chat"}>
      <ResearchTopBar
        ref={headingRef}
        title={request.product}
        badge={badge}
        panelOpen={panels.slotsOpen}
        panelSummary={`필수 ${progress.filled}/${progress.total}`}
        onTogglePanel={() => {
          if (!panels.slotsOpen) {
            setUnseen(false);
            // 좁은 화면에서는 한 번에 한 창만 보이므로 "더 보기" 메뉴도 접는다.
            if (!panels.wide) setMoreOpen(false);
          }
          panels.toggleSlots();
        }}
        panelId={PANEL_ID}
        toggleRef={panelToggleRef}
        unseen={unseen && !panels.slotsOpen}
        moreOpen={moreOpen}
        onToggleMore={() => {
          // 좁은 화면에서는 메뉴를 열면 오른쪽 창을 닫는다(같은 이름의 [요청 내려놓기]가 동시에 보이지 않게).
          if (!moreOpen && !panels.wide) panels.setSlots(false);
          setMoreOpen((value) => !value);
        }}
        moreId="vc-more"
        moreToggleRef={moreToggleRef}
        onRelease={() => void release()}
        releasing={releasing}
      />
      <div className="vc-body">
        <HeroBackdrop variant={hero ? "hero" : "chat"} />
        <SidePane id={SIDE_PANE_ID} open={panels.mineOpen} pane={pane} onClose={pane.close} onOpen={panels.toggleMine} toggleRef={sideToggleRef} currentId={requestId} queueHeadingRef={queueHeadingRef} mineHeadingRef={mineHeadingRef} />
        <main className="vc-main">
          {hero && <HeroCopy subject={subject} pill={`요청을 맡았어요 · 이용자: “${request.product}”`} />}
          {!hero && <CurrentQuestionLine slot={slot} required={slot ? requiredSlots(view.purchase).includes(slot) : false} />}
          <div
            ref={scrollRef}
            className="vc-scroll"
            onScroll={(event) => {
              if (Date.now() < ignoreScrollUntil.current) return;
              const el = event.currentTarget;
              stick.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48;
            }}
          >
            {!hero && (
              <ChatLog
                messages={shown}
                photos={view.photos}
                slots={view.slots}
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
            {qrOpen && (
              <PhotoQrDialog
                requestId={requestId}
                sessionId={view.sessionId}
                link={view.photoLink}
                onIssued={onQrIssued}
                onClose={closeQr}
                onUnauthorized={toList}
                settled={qrSettled}
              />
            )}
            {attachOpen && (
              <AttachSheet
                uploading={Boolean(uploadingThumb)}
                full={photoCount >= 3}
                phoneVisible={slot === "photo"}
                onPhone={openQr}
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
          id={PANEL_ID}
          purchase={view.purchase}
          slots={view.slots}
          photoCount={photoCount}
          currentSlot={slot}
          open={panels.slotsOpen}
          reviewReady={reviewReady}
          onRelease={() => void release()}
          releasing={releasing}
          onJump={jumpTo}
        />
      </div>
    </div>
  );
}
