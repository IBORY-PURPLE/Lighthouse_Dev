"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { ResearchCardBody, SEARCH_COPY, type HelpStatus } from "@/components/ResearchCards";
import { ResearchSummary } from "@/components/ResearchSummary";
import { SentView } from "@/components/SentView";
import { StatusRegion } from "@/components/StatusRegion";
import {
  addPhoto,
  buildPhotoRequest,
  buildResearchRequest,
  cachedHelp,
  canGoNext,
  canGoPrev,
  canSend,
  canSkip,
  cardHelper,
  defaultQuestion,
  draftSummaryText,
  dropStaleSummary,
  effectivePhotoKind,
  fillSummary,
  goNext,
  goPrev,
  goTo,
  goToCard,
  helpKey,
  isVerified,
  missingRequiredCards,
  nextLabel,
  purchaseBadge,
  removePhoto,
  RESEARCH_CARDS,
  RESEARCH_COPY,
  RESEARCH_LIMITS,
  setPhotoDescription,
  setSummaryText,
  subjectOf,
  SUMMARY_STEP,
  withHelp,
  type CardId,
  type HelpKind,
  type PhotoKind,
  type ResearchState,
} from "@/lib/research";
import { buildResultBody } from "@/lib/researchResult";
import { shrinkPhoto } from "@/lib/researchPhoto";
import {
  clearLegacyDrafts,
  clearResearchState,
  fetchRequest,
  readResearchState,
  releaseRequest,
  requestResearch,
  saveFlash,
  sendResult,
  writeResearchState,
  type DetailResponse,
} from "@/lib/volunteerClient";
import { quoteOf, structuredLine, VOLUNTEER_MESSAGES } from "@/lib/volunteerView";

type Load =
  | { kind: "loading" }
  | { kind: "ok"; detail: DetailResponse }
  | { kind: "denied" }
  | { kind: "failed"; message: string };

/** 상태 알림 한 줄. loud이면 화면에도 보이고, 아니면 낭독기에만 읽힌다(화면에 이미 같은 정보가 있다). */
interface Notice {
  text: string;
  loud: boolean;
}

const HELP_KIND_OF: Record<CardId, HelpKind | null> = {
  model: "model",
  pros: "pros",
  photo: null,
  alts: "alts",
  altReason: "altReason",
  benefits: "benefits",
  refs: "refs",
};

const SUMMARY_STEP_KINDS = new Set<HelpKind>(["pros", "altReason"]);

/** 위·아래 띠를 뺀 남은 높이가 이보다 작으면 위 띠의 고정을 푼다(px). */
const MIN_FREE_HEIGHT = 220;

/**
 * 글 입력 칸이 초점을 받으면 칸 전체를 띠 사이에 보이게 한다. 브라우저는 초점 때 커서 자리만 보이게 해서
 * 칸의 위나 아래 절반이 고정 띠 밑에 남을 수 있다. 띠 높이는 html의 scroll-padding이 반영한다.
 */
function revealFocusedField(event: FocusEvent<HTMLElement>) {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    target.scrollIntoView({ block: "nearest" });
  }
}

/** 한 요청의 리서치 챗. 맡은 진행 중 요청이면 질문 카드 7장과 보내기 전 확인, 완료된 요청이면 SentView. */
export function ResearchChat({ requestId }: { requestId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLElement>(null);
  const releaseButtonRef = useRef<HTMLButtonElement>(null);
  const releasePromptRef = useRef<HTMLParagraphElement>(null);
  const restoreReleaseFocus = useRef(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResearchState | null>(null);
  const [notice, setNotice] = useState<Notice>({ text: "", loud: false });
  const [busy, setBusy] = useState(false);
  // 보내다가 내 담당이 아니게 된 것을 알았다. 입력은 남기고 목록 링크를 준다.
  const [lost, setLost] = useState(false);
  // 내려놓기를 한 번 눌러 확인 단계를 보이는 중이다.
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [helpStatus, setHelpStatus] = useState<Partial<Record<HelpKind, HelpStatus>>>({});
  const [uploading, setUploading] = useState(false);
  const [describingIndex, setDescribingIndex] = useState<number | null>(null);

  const stateRef = useRef<ResearchState | null>(null);
  const alive = useRef(true);
  const finished = useRef(false);
  const saveWarned = useRef(false);
  const conflictReloaded = useRef(false);
  const inflight = useRef(new Set<string>());
  // 이번에 연 화면에서 올린 사진의 서버용 JPEG(썸네일 주소 → JPEG). 기기에는 남기지 않는다.
  const images = useRef(new Map<string, string>());
  const previousStep = useRef<number | null>(null);

  const say = useCallback((text: string) => setNotice({ text, loud: false }), []);
  const warn = useCallback((text: string) => setNotice({ text, loud: true }), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 진행 상태는 바뀔 때마다 이 기기에 저장한다(쇼핑 앱에 다녀오거나 새로 고쳐도 이어지게).
  // 저장 공간이 가득 차 저장하지 못하면 한 번만 알린다.
  useEffect(() => {
    if (!state || finished.current) return;
    if (!writeResearchState(requestId, state) && !saveWarned.current) {
      saveWarned.current = true;
      // 같은 렌더에서 AI 도움을 부르며 쓰는 "찾는 중" 안내보다 뒤에 오도록 한 박자 늦춘다.
      setTimeout(() => {
        if (alive.current) warn(RESEARCH_COPY.notice.saveFailed);
      }, 0);
    }
  }, [requestId, state, warn]);

  useEffect(() => {
    clearLegacyDrafts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchRequest(requestId).then((result) => {
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        router.replace("/volunteer");
        return;
      }
      if (result.kind === "ok") {
        if (result.data.request.status === "in_progress") {
          setState((current) => current ?? readResearchState(requestId));
        } else {
          // 다른 탭이나 기기에서 이미 보낸 요청이다. 이 기기에 남은 진행 상태는 쓸모없다.
          finished.current = true;
          clearResearchState(requestId);
        }
        setLoad({ kind: "ok", detail: result.data });
      } else if (result.status === 403 || result.status === 404) {
        finished.current = true;
        clearResearchState(requestId);
        setLoad({ kind: "denied" });
      } else {
        setLoad({ kind: "failed", message: result.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requestId, router, attempt]);

  // 불러온 뒤 제목에 초점을 둬서 낭독이 화면 이름부터 시작하게 한다.
  // 그 사이 이용자가 이미 다른 곳을 눌렀으면 초점을 빼앗지 않는다.
  const loaded = load.kind !== "loading";
  useEffect(() => {
    if (!loaded) return;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [loaded]);

  const update = useCallback((change: (current: ResearchState) => ResearchState) => {
    setState((current) => (current ? change(current) : current));
  }, []);

  /**
   * 리서치 API가 내 요청이 아니거나(403) 없거나(404) 이미 보냈다고(409) 하면 카드를 더 진행할 이유가 없다.
   * 처리했으면 true. 403·404는 거부 화면, 409는 서버 값으로 완료 화면을 다시 불러온다.
   */
  const handleLost = useCallback(
    (status: number): boolean => {
      if (status === 403 || status === 404) {
        // 다시 못 쓸 진행 상태다. 지우고 더 저장하지 않는다.
        finished.current = true;
        clearResearchState(requestId);
        setLoad({ kind: "denied" });
        return true;
      }
      // 서버는 이미 보냈다는데 다시 불러온 상세는 진행 중이면(어긋남) 한 번만 다시 불러오고, 더는 되풀이하지 않는다.
      if (status === 409 && !conflictReloaded.current) {
        conflictReloaded.current = true;
        setLoad({ kind: "loading" });
        setAttempt((value) => value + 1);
        return true;
      }
      return false;
    },
    [requestId],
  );

  /** AI 도움을 부른다. force가 아니면 입력이 그대로인 캐시가 있을 때 부르지 않는다. */
  const loadHelp = useCallback(
    async (kind: HelpKind, force: boolean) => {
      if (!alive.current) return;
      const current = stateRef.current;
      if (!current) return;
      if (kind === "summary") {
        // 답이 바뀌어 낡은 초안은 비우고, 캐시된 AI 초안이 있으면 빈 칸을 채운다(봉사자가 쓴 글은 그대로).
        update((latest) => {
          const cleaned = dropStaleSummary(latest);
          const hit = cachedHelp(cleaned, "summary");
          return hit?.kind === "summary" ? fillSummary(cleaned, hit.text, "ai") : cleaned;
        });
      }
      const key = helpKey(current, kind);
      if (!force && cachedHelp(current, kind)) {
        setHelpStatus((previous) => (previous[kind] ? { ...previous, [kind]: undefined } : previous));
        return;
      }
      const flight = `${kind}|${key}`;
      if (inflight.current.has(flight)) return;
      inflight.current.add(flight);
      const cardStep = kind === "summary" ? SUMMARY_STEP : RESEARCH_CARDS.findIndex((card) => card.id === kind);
      // 응답이 왔을 때 아직 그 요청의 입력이 화면에 있나(그 사이 기종 등을 고쳤으면 아니다).
      const isCurrent = () =>
        alive.current && stateRef.current !== null && helpKey(stateRef.current, kind) === key;
      const stillHere = () => isCurrent() && stateRef.current?.step === cardStep;
      const searchCopy = kind in SEARCH_COPY ? SEARCH_COPY[kind as keyof typeof SEARCH_COPY] : null;
      setHelpStatus((previous) => ({ ...previous, [kind]: "loading" }));
      if (searchCopy) say(searchCopy.searching);

      const outcome = await requestResearch(buildResearchRequest(requestId, kind, current));
      inflight.current.delete(flight);
      if (!alive.current) return;
      if (outcome.kind === "unauthorized") {
        router.replace("/volunteer");
        return;
      }
      if (outcome.kind === "failed" && handleLost(outcome.status)) return;

      if (outcome.kind === "ok" && outcome.response.kind === kind) {
        const response = outcome.response;
        // 캐시에는 요청 때의 키로 넣는다. 입력이 바뀌었다면 지금 키와 달라 쓰이지 않는다.
        update((latest) => {
          const next = withHelp(latest, kind, response, key);
          return response.kind === "summary" ? fillSummary(next, response.text, "ai", key) : next;
        });
        if (!isCurrent()) return;
        setHelpStatus((previous) => ({ ...previous, [kind]: undefined }));
        if (!stillHere()) return;
        if (searchCopy) {
          const found =
            response.kind === "model" || response.kind === "alts"
              ? response.items.length
              : response.kind === "benefits" || response.kind === "refs"
                ? response.links.length
                : 0;
          if (found > 0) say(RESEARCH_COPY.notice.found(found));
          else warn(searchCopy.failed);
        } else if (SUMMARY_STEP_KINDS.has(kind) && (response.kind === "pros" || response.kind === "altReason")) {
          if (response.hints.length > 0) say(RESEARCH_COPY.notice.aiArrived(response.hints.length));
        }
        return;
      }

      if (!isCurrent()) return;
      setHelpStatus((previous) => ({ ...previous, [kind]: "failed" }));
      if (outcome.kind === "failed" && outcome.status === 429 && searchCopy && stillHere()) {
        warn(RESEARCH_COPY.notice.rateLimited);
      } else if (searchCopy && stillHere()) {
        warn(searchCopy.failed);
      }
      if (kind === "summary") {
        update((latest) => fillSummary(latest, draftSummaryText(latest), "draft", key));
      }
    },
    [requestId, router, update, say, warn, handleLost],
  );

  // 카드(또는 요약)에 들어오면 그 카드의 AI 도움을 가져온다. 캐시가 있으면 부르지 않는다.
  const inProgress = load.kind === "ok" && load.detail.request.status === "in_progress";
  const step = state?.step ?? null;
  useEffect(() => {
    if (!inProgress || step === null) return;
    const kind = step === SUMMARY_STEP ? "summary" : HELP_KIND_OF[RESEARCH_CARDS[step].id];
    if (kind) queueMicrotask(() => void loadHelp(kind, false));
  }, [inProgress, step, loadHelp]);

  // 카드가 바뀌면 새 질문(요약이면 요약 제목)으로 초점을 옮기고 맨 위로 올린다.
  useEffect(() => {
    if (step === null) return;
    const previous = previousStep.current;
    previousStep.current = step;
    if (previous === null || previous === step) return;
    window.scrollTo({ top: 0 });
    (step === SUMMARY_STEP ? summaryHeadingRef : questionRef).current?.focus();
  }, [step]);

  // 내려놓기 확인 단계: 열리면 안내로, 취소하면 원래 버튼으로 초점을 옮긴다.
  useEffect(() => {
    if (confirmingRelease) {
      releasePromptRef.current?.focus();
    } else if (restoreReleaseFocus.current) {
      restoreReleaseFocus.current = false;
      releaseButtonRef.current?.focus();
    }
  }, [confirmingRelease]);

  // 위 띠(제목·배지·진행·현재 질문)와 아래 띠(버튼)의 높이를 css 변수로 알려 초점 칸이 띠 밖으로 스크롤되게 한다(scroll-padding).
  // 두 띠 합이 화면 높이의 절반을 넘거나 둘을 뺀 남은 높이가 220px 미만이면(작은 화면, 글자 확대) 위 띠의 고정을 푼다. 고정 여부는 이 판정 하나로 정한다.
  // 아래 띠 하나만으로 화면의 절반을 넘으면 아래 띠도 푼다.
  const pinned = load.kind === "ok" && load.detail.request.status === "in_progress" && state !== null;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!pinned || !root || !top || !bottom) return;
    const measure = () => {
      // 아래 띠의 상태 안내 칸(눈에 보이는 안내 포함)은 판정에서 뺀다. 안내가 떴다 사라질 때마다 고정이 켜졌다 꺼지지 않게 하려는 것이다.
      const notice = bottom.querySelector<HTMLElement>(".status-region")?.offsetHeight ?? 0;
      const strips = top.offsetHeight + bottom.offsetHeight - notice;
      const crowded = strips > window.innerHeight * 0.5 || window.innerHeight - strips < MIN_FREE_HEIGHT;
      root.classList.toggle("rc-root--free", crowded);
      root.classList.toggle("rc-root--free-bottom", bottom.offsetHeight - notice > window.innerHeight * 0.5);
      const topPinned = getComputedStyle(top).position === "sticky";
      const bottomPinned = getComputedStyle(bottom).position === "sticky";
      // 초점 이동 스크롤은 문서(html)를 스크롤하므로 scroll-padding이 쓰는 값은 html에 건다.
      const page = document.documentElement;
      page.style.setProperty("--rc-top-h", `${topPinned ? top.offsetHeight : 0}px`);
      page.style.setProperty("--rc-bottom-h", `${bottomPinned ? bottom.offsetHeight : 0}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(top);
    observer?.observe(bottom);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      document.documentElement.style.removeProperty("--rc-top-h");
      document.documentElement.style.removeProperty("--rc-bottom-h");
    };
  }, [pinned]);

  const goStep = (change: (current: ResearchState) => ResearchState) => {
    say("");
    // 내려놓기 확인 단계를 연 채 카드를 옮기면 새 카드에 안내가 남지 않게 닫는다(초점은 카드 이동 effect가 질문으로 옮긴다).
    setConfirmingRelease(false);
    update(change);
  };

  const handleNext = () => {
    if (!state) return;
    if (!canGoNext(state)) {
      const id = RESEARCH_CARDS[state.step]?.id;
      const text = id && id in RESEARCH_COPY.blocked ? RESEARCH_COPY.blocked[id as keyof typeof RESEARCH_COPY.blocked] : "";
      warn(text);
      return;
    }
    goStep(goNext);
  };

  const handleFiles = async (files: File[], kind: PhotoKind) => {
    if (uploading) return;
    const start = stateRef.current;
    if (!start) return;
    const room = RESEARCH_LIMITS.maxPhotos - start.photos.length;
    if (room <= 0) {
      warn(RESEARCH_COPY.photo.limit(RESEARCH_LIMITS.maxPhotos));
      return;
    }
    const picked = files.slice(0, room);
    setUploading(true);
    say("");
    // update가 렌더 없이 이어서 불리므로, 장수와 인증 판단은 직접 이어 계산한다.
    let working = start;
    let failed = false;
    for (const file of picked) {
      try {
        const shrunk = await shrinkPhoto(file);
        if (!alive.current) return;
        images.current.set(shrunk.thumb, shrunk.image);
        const photo = { kind, thumb: shrunk.thumb, description: "" };
        const next = addPhoto(working, photo);
        if (next === working) {
          failed = true;
          continue;
        }
        working = next;
        update((latest) => addPhoto(latest, photo));
      } catch {
        failed = true;
      }
    }
    if (!alive.current) return;
    setUploading(false);
    const added = working.photos.length - start.photos.length;
    if (failed) warn(RESEARCH_COPY.photo.readFailed);
    else if (files.length > picked.length) {
      warn(RESEARCH_COPY.photo.cutExtra(RESEARCH_LIMITS.maxPhotos, files.length - picked.length));
    } else if (added > 0) {
      const badge = purchaseBadge(working).label;
      if (!isVerified(start) && isVerified(working)) {
        say(added === 1 ? badge : `${badge}. ${RESEARCH_COPY.photo.uploaded(working.photos.length)}`);
      } else {
        say(RESEARCH_COPY.photo.uploaded(working.photos.length));
      }
    }
  };

  const handleRemovePhoto = (index: number) => {
    const current = stateRef.current;
    const thumb = current?.photos[index]?.thumb;
    if (thumb) images.current.delete(thumb);
    update((latest) => removePhoto(latest, index));
    say(RESEARCH_COPY.photo.removed(index + 1));
  };

  const handleDescribe = async (index: number) => {
    const current = stateRef.current;
    const target = current?.photos[index];
    if (!current || !target || describingIndex !== null) return;
    setDescribingIndex(index);
    say(RESEARCH_COPY.photo.describing);
    // 새로 고친 뒤에는 원본 JPEG가 없어 작은 미리보기로 설명을 만든다.
    const original = images.current.get(target.thumb);
    const image = original ?? target.thumb;
    const outcome = await requestResearch(
      buildPhotoRequest(requestId, current, image, effectivePhotoKind(current, target)),
    );
    if (!alive.current) return;
    setDescribingIndex(null);
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    if (outcome.kind === "failed" && handleLost(outcome.status)) return;
    if (outcome.kind === "ok" && outcome.response.kind === "photo" && outcome.response.description.trim() !== "") {
      const description = outcome.response.description;
      update((latest) => {
        const at = latest.photos.findIndex((photo) => photo.thumb === target.thumb);
        return at === -1 ? latest : setPhotoDescription(latest, at, description);
      });
      const base = `${RESEARCH_COPY.photo.describeDone} ${RESEARCH_COPY.aiBoxMark}.`;
      if (original) say(base);
      else warn(`${base} ${RESEARCH_COPY.photo.describeSmall}`);
    } else if (outcome.kind === "failed" && outcome.status === 413) {
      warn(RESEARCH_COPY.photo.tooBig);
    } else if (outcome.kind === "failed" && outcome.status === 415) {
      warn(RESEARCH_COPY.photo.badFormat);
    } else if (outcome.kind === "failed" && outcome.status === 429) {
      warn(RESEARCH_COPY.notice.rateLimited);
    } else {
      warn(RESEARCH_COPY.photo.describeFailed);
    }
  };

  const handleSend = async () => {
    if (!state) return;
    if (busy) {
      say(RESEARCH_COPY.notice.sending);
      return;
    }
    const body = canSend(state) ? buildResultBody(state) : null;
    if (!body) {
      const names = missingRequiredCards(state).map((card) => card.name);
      warn(`${RESEARCH_COPY.summary.missingTitle}: ${names.join(", ")}`);
      return;
    }
    setBusy(true);
    say(RESEARCH_COPY.notice.sending);
    const outcome = await sendResult(requestId, body.candidates);
    if (outcome.kind === "sent") {
      // 응답을 기다리다 화면을 떠났어도 서버에서는 완료된 요청이다. 기기에 남은 진행 상태를 지운다.
      finished.current = true;
      clearResearchState(requestId);
      if (!alive.current) return;
      setBusy(false);
      // 서버 값으로 완료 화면(SentView)을 다시 불러온다.
      setLoad({ kind: "loading" });
      setAttempt((value) => value + 1);
      return;
    }
    if (!alive.current) return;
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    setBusy(false);
    if (outcome.kind === "not_yours") {
      setLost(true);
      warn(VOLUNTEER_MESSAGES.notYoursAnymore);
    } else if (outcome.kind === "invalid") {
      warn(RESEARCH_COPY.notice.sendInvalid);
    } else {
      warn(RESEARCH_COPY.notice.sendFailed);
    }
  };

  const cancelRelease = () => {
    restoreReleaseFocus.current = true;
    setConfirmingRelease(false);
  };

  const handleRelease = async () => {
    if (busy) return;
    setBusy(true);
    say("");
    const outcome = await releaseRequest(requestId);
    if (outcome.kind === "released") {
      finished.current = true;
      clearResearchState(requestId);
      if (!alive.current) return;
      saveFlash(VOLUNTEER_MESSAGES.releasedToQueue);
      router.push("/volunteer");
      return;
    }
    if (!alive.current) return;
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    if (outcome.kind === "not_yours") {
      setLoad({ kind: "denied" });
      return;
    }
    setBusy(false);
    warn(outcome.message);
  };

  if (load.kind === "ok" && load.detail.request.status === "done" && load.detail.result) {
    return <SentView request={load.detail.request} result={load.detail.result} />;
  }

  if (load.kind === "ok" && inProgress && state) {
    const { request } = load.detail;
    const card = RESEARCH_CARDS[state.step];
    const onSummary = state.step === SUMMARY_STEP;
    const badge = purchaseBadge(state);
    const subject = subjectOf(request);
    const kind = card ? HELP_KIND_OF[card.id] : null;
    const help = kind ? cachedHelp(state, kind) : null;
    const aiQuestion = help && (help.kind === "pros" || help.kind === "altReason") ? help.question.trim() : "";
    const question = card
      ? aiQuestion || defaultQuestion(card.id, { subject, model: state.model.trim(), alts: state.alts })
      : "";
    const helper = card ? cardHelper(card.id) : null;
    const dots = Array.from({ length: SUMMARY_STEP }, (_, index) => index <= state.step);
    const sendLocked = !canSend(state) || busy;
    const nextLocked = !canGoNext(state);

    const prevButton = (
      <button
        type="button"
        className="vol-btn vol-btn--secondary"
        aria-disabled={canGoPrev(state) ? undefined : true}
        onClick={() => {
          if (canGoPrev(state)) goStep(goPrev);
        }}
      >
        {RESEARCH_COPY.buttons.prev}
      </button>
    );

    return (
      <div ref={rootRef} className="vol-root rc-root">
        <main className="vol-page rc-page">
          <header ref={topRef} className="rc-top">
            <div className="vol-topbar">
              <span className="vol-topbar-title">
                <Link href="/volunteer?tab=mine" className="vol-back" aria-label={RESEARCH_COPY.back}>
                  &lt;
                </Link>
                <h1 ref={headingRef} tabIndex={-1}>
                  {RESEARCH_COPY.title}
                </h1>
              </span>
              <span className="rc-badge-box">
                <span className={`vol-chip rc-badge rc-badge--${badge.kind}`} data-testid="purchase-badge">
                  {badge.label}
                </span>
              </span>
            </div>

            <div className="rc-progress">
              <span
                className="rc-dots"
                role="img"
                aria-label={onSummary ? RESEARCH_COPY.summary.stepAlt : RESEARCH_COPY.progressAlt(card.number)}
              >
                {dots.map((on, index) => (
                  <span key={index} className={`rc-dot${on ? " rc-dot--on" : ""}`} />
                ))}
              </span>
              <span className="rc-progress-text" aria-hidden="true" data-testid="progress-label">
                {onSummary ? RESEARCH_COPY.summary.stepLabel : RESEARCH_COPY.progressLabel(card.number)}
              </span>
            </div>

            {card && (
              <section className="rc-question" data-testid="question-card">
                <span className="rc-question-kicker">{RESEARCH_COPY.questionKicker}</span>
                <h2 ref={questionRef} tabIndex={-1} className="rc-question-text" data-testid="question">
                  {question}
                </h2>
              </section>
            )}
          </header>

          <div className="rc-body" onFocus={revealFocusedField}>
            <section className="rc-request" aria-label={RESEARCH_COPY.requestLabel}>
              <p className="vol-summary-label">{RESEARCH_COPY.requestLabel}</p>
              <p className="vol-quote">{quoteOf(request.product, request.budget)}</p>
              <p className="vol-sub">{structuredLine(request)}</p>
            </section>

            {badge.note && <p className="rc-badge-note">{badge.note}</p>}
            {helper && <p className="rc-question-helper">{helper}</p>}

            {onSummary ? (
              <ResearchSummary
                ref={summaryHeadingRef}
                state={state}
                summaryBusy={helpStatus.summary === "loading"}
                onChangeText={(value) => update((current) => setSummaryText(current, value))}
                onGoToCard={(id) => goStep((current) => goToCard(current, id))}
              />
            ) : (
              <>
                <ResearchCardBody
                  key={card.id}
                  id={card.id}
                  state={state}
                  update={update}
                  help={help}
                  helpStatus={kind ? helpStatus[kind] : undefined}
                  subject={subject}
                  retry={() => {
                    if (kind) void loadHelp(kind, true);
                  }}
                  onStatus={warn}
                  photo={{
                    uploading,
                    describingIndex,
                    onFiles: (files, photoKind) => void handleFiles(files, photoKind),
                    onRemove: handleRemovePhoto,
                    onDescribe: (index) => void handleDescribe(index),
                  }}
                />
                <History state={state} subject={subject} />
              </>
            )}

            <div className="rc-release">
              {lost && (
                <Link href="/volunteer?tab=mine" className="vol-btn vol-btn--block">
                  {RESEARCH_COPY.toList}
                </Link>
              )}
              {confirmingRelease ? (
                <div
                  className="rc-release-confirm"
                  role="group"
                  aria-labelledby="rc-release-prompt"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelRelease();
                  }}
                >
                  <p id="rc-release-prompt" ref={releasePromptRef} tabIndex={-1} className="rc-release-prompt">
                    {RESEARCH_COPY.releasePrompt}
                  </p>
                  <div className="rc-buttons">
                    <button type="button" className="vol-btn vol-btn--secondary" onClick={cancelRelease}>
                      {RESEARCH_COPY.buttons.releaseCancel}
                    </button>
                    <button
                      type="button"
                      className="vol-btn rc-release-confirm-btn"
                      aria-disabled={busy ? true : undefined}
                      onClick={handleRelease}
                    >
                      {RESEARCH_COPY.buttons.releaseConfirm}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  ref={releaseButtonRef}
                  type="button"
                  className="rc-release-btn"
                  aria-disabled={busy ? true : undefined}
                  onClick={() => {
                    if (!busy) setConfirmingRelease(true);
                  }}
                >
                  {RESEARCH_COPY.buttons.release}
                </button>
              )}
            </div>
          </div>

          <footer ref={bottomRef} className="rc-bottom">
            <StatusRegion message={notice.text} quiet={!notice.loud} />
            {onSummary ? (
              <div className="rc-buttons rc-buttons--stack">
                <button
                  type="button"
                  className="vol-btn rc-primary"
                  aria-disabled={sendLocked ? true : undefined}
                  onClick={handleSend}
                >
                  {RESEARCH_COPY.buttons.send}
                </button>
                {prevButton}
              </div>
            ) : (
              <div className="rc-buttons">
                {prevButton}
                {canSkip(state) && (
                  <button
                    type="button"
                    className="vol-btn vol-btn--secondary"
                    onClick={() => goStep((current) => goTo(current, current.step + 1))}
                  >
                    {RESEARCH_COPY.buttons.skip}
                  </button>
                )}
                <button
                  type="button"
                  className="vol-btn rc-primary"
                  aria-disabled={nextLocked ? true : undefined}
                  onClick={handleNext}
                >
                  {nextLabel(state)}
                </button>
              </div>
            )}
          </footer>
        </main>
      </div>
    );
  }

  return (
    <div className="vol-root">
      <main className="vol-page vol-page--plain">
        <header className="vol-topbar">
          <span className="vol-topbar-title">
            <Link href="/volunteer" className="vol-back" aria-label={RESEARCH_COPY.backToQueue}>
              &lt;
            </Link>
            <h1 ref={headingRef} tabIndex={-1}>
              {RESEARCH_COPY.title}
            </h1>
          </span>
        </header>
        {(load.kind === "loading" || (load.kind === "ok" && inProgress)) && (
          <p className="vol-empty">{RESEARCH_COPY.loading}</p>
        )}
        {load.kind === "ok" && !inProgress && !load.detail.result && (
          <>
            <StatusRegion message={VOLUNTEER_MESSAGES.notYours} />
            <div className="vol-actions">
              <Link href="/volunteer" className="vol-btn vol-btn--secondary">
                {RESEARCH_COPY.toList}
              </Link>
            </div>
          </>
        )}
        {load.kind === "denied" && (
          <>
            <StatusRegion message={VOLUNTEER_MESSAGES.notYours} />
            <div className="vol-actions">
              <Link href="/volunteer" className="vol-btn vol-btn--secondary">
                {RESEARCH_COPY.toList}
              </Link>
            </div>
          </>
        )}
        {load.kind === "failed" && (
          <>
            <StatusRegion message={load.message} />
            <div className="vol-actions">
              <button
                type="button"
                className="vol-btn"
                onClick={() => {
                  setLoad({ kind: "loading" });
                  setAttempt((value) => value + 1);
                }}
              >
                {RESEARCH_COPY.reload}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** 지난 문답(바로 앞 카드의 질문과 내 답)을 접어 둔다. 화면에서 실제로 본 질문(AI 질문이 왔다면 그것)을 보인다. 답이 없으면 그리지 않는다. */
function History({ state, subject }: { state: ResearchState; subject: string }) {
  const previous = RESEARCH_CARDS[state.step - 1];
  if (!previous) return null;
  const answer = (() => {
    switch (previous.id) {
      case "model":
        return `${state.model.trim()}${state.purchase === "bought" ? RESEARCH_COPY.purchaseSuffix.bought : state.purchase === "research" ? RESEARCH_COPY.purchaseSuffix.research : ""}`;
      case "pros":
        return state.pros;
      case "photo":
        return state.photos.length > 0 ? RESEARCH_COPY.summary.photoCount(state.photos.length) : "";
      case "alts":
        return state.alts.join(", ");
      case "altReason":
        return state.altReason;
      case "benefits":
        return state.benefits;
      case "refs":
        return state.refs;
    }
  })().trim();
  if (answer === "") return null;
  const previousKind = HELP_KIND_OF[previous.id];
  const help = previousKind ? cachedHelp(state, previousKind) : null;
  const aiQuestion = help && (help.kind === "pros" || help.kind === "altReason") ? help.question.trim() : "";
  const question =
    aiQuestion || defaultQuestion(previous.id, { subject, model: state.model.trim(), alts: state.alts });
  return (
    <details className="rc-history" data-testid="history">
      <summary className="rc-history-title">{RESEARCH_COPY.historyTitle}</summary>
      <p className="rc-bubble rc-bubble--ai">{question}</p>
      <p className="rc-bubble rc-bubble--me">{answer}</p>
    </details>
  );
}
