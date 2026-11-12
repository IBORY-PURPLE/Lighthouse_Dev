"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_QUESTION_TITLE,
  PHOTO_DESCRIBING,
  ResearchCardBody,
  SEARCH_COPY,
  type HelpStatus,
} from "@/components/ResearchCards";
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

const HELP_KIND_OF: Record<CardId, HelpKind | null> = {
  model: "model",
  pros: "pros",
  photo: null,
  alts: "alts",
  altReason: "altReason",
  benefits: "benefits",
  refs: "refs",
};

/** 다음으로 갈 수 없을 때 상태 알림으로 읽어 줄 안내(필수 카드). */
const BLOCKED: Partial<Record<CardId, string>> = {
  model: "기종 이름을 쓰고 구매 여부를 골라 주세요.",
  pros: "장점을 적어 주세요.",
  photo: "사진을 1장 이상 올려 주세요.",
  alts: "같이 고민한 제품을 1개 이상 넣어 주세요.",
  altReason: "고민한 이유를 적어 주세요.",
};

const PHOTO_READ_FAILED = "사진을 읽지 못했어요. 다른 사진으로 다시 올려 주세요.";
const PHOTO_DESCRIBE_FAILED = "사진 설명을 만들지 못했어요. 직접 적어 주세요.";
const SUMMARY_LABEL = "요약";
const SUMMARY_ALT = "질문 7개를 모두 지나 요약 단계예요.";

/** 한 요청의 리서치 챗. 맡은 진행 중 요청이면 질문 카드 7장과 보내기 전 확인, 완료된 요청이면 SentView. */
export function ResearchChat({ requestId }: { requestId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResearchState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // 보내다가 내 담당이 아니게 된 것을 알았다. 입력은 남기고 목록 링크를 준다.
  const [lost, setLost] = useState(false);
  const [helpStatus, setHelpStatus] = useState<Partial<Record<HelpKind, HelpStatus>>>({});
  const [uploading, setUploading] = useState(false);
  const [describingIndex, setDescribingIndex] = useState<number | null>(null);

  const stateRef = useRef<ResearchState | null>(null);
  const alive = useRef(true);
  const finished = useRef(false);
  const inflight = useRef(new Set<string>());
  // 이번에 연 화면에서 올린 사진의 서버용 JPEG(썸네일 주소 → JPEG). 기기에는 남기지 않는다.
  const images = useRef(new Map<string, string>());
  // 핵심 정리 글을 봉사자가 손댔나(손댔다면 AI 초안으로 덮어쓰지 않는다).
  const summaryEdited = useRef(false);
  const previousStep = useRef<number | null>(null);

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
  useEffect(() => {
    if (state && !finished.current) writeResearchState(requestId, state);
  }, [requestId, state]);

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
        }
        setLoad({ kind: "ok", detail: result.data });
      } else if (result.status === 403 || result.status === 404) {
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

  /** AI 도움을 부른다. force가 아니면 입력이 그대로인 캐시가 있을 때 부르지 않는다. */
  const loadHelp = useCallback(
    async (kind: HelpKind, force: boolean) => {
      const current = stateRef.current;
      if (!current) return;
      const cached = cachedHelp(current, kind);
      if (kind === "summary") {
        // 핵심 정리 칸이 비어 있으면(손대지 않았다면) AI 초안으로 채운다.
        // 칸의 글이 지난번 AI 초안 그대로인데 답이 바뀌었다면 비워서 새 초안으로 바꾼다.
        const previous = current.help.summary?.response;
        const staleDraft = previous?.kind === "summary" && current.summaryText === previous.text && !cached;
        if (cached?.kind === "summary" && current.summaryText === "" && !summaryEdited.current) {
          const text = cached.text;
          update((latest) => (latest.summaryText === "" ? { ...latest, summaryText: text } : latest));
        }
        if (staleDraft) update((latest) => (latest.summaryText === previous.text ? { ...latest, summaryText: "" } : latest));
      }
      if (!force && cached) return;
      const key = helpKey(current, kind);
      const flight = `${kind}|${key}`;
      if (inflight.current.has(flight)) return;
      inflight.current.add(flight);
      const cardStep = kind === "summary" ? SUMMARY_STEP : RESEARCH_CARDS.findIndex((card) => card.id === kind);
      const stillHere = () => alive.current && stateRef.current?.step === cardStep;
      const searchCopy = kind in SEARCH_COPY ? SEARCH_COPY[kind as keyof typeof SEARCH_COPY] : null;
      setHelpStatus((previous) => ({ ...previous, [kind]: "loading" }));
      if (searchCopy) setMessage(searchCopy.searching);

      const outcome = await requestResearch(buildResearchRequest(requestId, kind, current));
      inflight.current.delete(flight);
      if (!alive.current) return;
      if (outcome.kind === "unauthorized") {
        router.replace("/volunteer");
        return;
      }
      if (outcome.kind === "ok" && outcome.response.kind === kind) {
        const response = outcome.response;
        update((latest) => {
          if (helpKey(latest, kind) !== key) return latest;
          const next = withHelp(latest, kind, response);
          return response.kind === "summary" && latest.summaryText === "" && !summaryEdited.current
            ? { ...next, summaryText: response.text }
            : next;
        });
        setHelpStatus((previous) => ({ ...previous, [kind]: undefined }));
        if (searchCopy && stillHere()) {
          const found =
            response.kind === "model" || response.kind === "alts"
              ? response.items.length
              : response.kind === "benefits" || response.kind === "refs"
                ? response.links.length + (response.kind === "refs" ? response.digest.length : 0)
                : 0;
          setMessage(found > 0 ? `${found}개를 찾았어요. ${RESEARCH_COPY.aiBoxMark}.` : searchCopy.failed);
        }
        return;
      }
      setHelpStatus((previous) => ({ ...previous, [kind]: "failed" }));
      if (searchCopy && stillHere()) setMessage(searchCopy.failed);
      if (kind === "summary" && !summaryEdited.current) {
        update((latest) => (latest.summaryText === "" ? { ...latest, summaryText: draftSummaryText(latest) } : latest));
      }
    },
    [requestId, router, update],
  );

  // 카드(또는 요약)에 들어오면 그 카드의 AI 도움을 가져온다. 캐시가 있으면 부르지 않는다.
  const inProgress = load.kind === "ok" && load.detail.request.status === "in_progress";
  const step = state?.step ?? null;
  useEffect(() => {
    if (!inProgress || step === null) return;
    if (step === SUMMARY_STEP) {
      void loadHelp("summary", false);
      return;
    }
    const kind = HELP_KIND_OF[RESEARCH_CARDS[step].id];
    if (kind) void loadHelp(kind, false);
  }, [inProgress, step, loadHelp, update]);

  useEffect(() => {
    if (step !== SUMMARY_STEP) summaryEdited.current = false;
  }, [step]);

  // 카드가 바뀌면 새 질문(요약이면 요약 제목)으로 초점을 옮기고 맨 위로 올린다.
  useEffect(() => {
    if (step === null) return;
    const previous = previousStep.current;
    previousStep.current = step;
    if (previous === null || previous === step) return;
    window.scrollTo({ top: 0 });
    (step === SUMMARY_STEP ? summaryHeadingRef : questionRef).current?.focus();
  }, [step]);

  const goStep = (change: (current: ResearchState) => ResearchState) => {
    setMessage("");
    update(change);
  };

  const handleNext = () => {
    if (!state) return;
    if (!canGoNext(state)) {
      setMessage(BLOCKED[RESEARCH_CARDS[state.step]?.id] ?? "");
      return;
    }
    goStep(goNext);
  };

  const handleFiles = async (files: File[], kind: PhotoKind) => {
    if (uploading) return;
    setUploading(true);
    setMessage("");
    let failed = false;
    for (const file of files) {
      const current = stateRef.current;
      if (!current || current.photos.length >= RESEARCH_LIMITS.maxPhotos) {
        setMessage(`사진은 ${RESEARCH_LIMITS.maxPhotos}장까지 올릴 수 있어요.`);
        break;
      }
      try {
        const shrunk = await shrinkPhoto(file);
        if (!alive.current) return;
        images.current.set(shrunk.thumb, shrunk.image);
        const photo = { kind, thumb: shrunk.thumb, description: "" };
        const before = isVerified(current);
        const after = addPhoto(current, photo);
        update((latest) => addPhoto(latest, photo));
        if (!before && isVerified(after)) setMessage(purchaseBadge(after).label);
        else setMessage(`사진 ${after.photos.length}장을 올렸어요.`);
      } catch {
        failed = true;
      }
    }
    if (!alive.current) return;
    if (failed) setMessage(PHOTO_READ_FAILED);
    setUploading(false);
  };

  const handleRemovePhoto = (index: number) => {
    const current = stateRef.current;
    const thumb = current?.photos[index]?.thumb;
    if (thumb) images.current.delete(thumb);
    update((latest) => removePhoto(latest, index));
    setMessage(`사진 ${index + 1}을 지웠어요.`);
  };

  const handleDescribe = async (index: number) => {
    const current = stateRef.current;
    const target = current?.photos[index];
    if (!current || !target || describingIndex !== null) return;
    setDescribingIndex(index);
    setMessage(PHOTO_DESCRIBING);
    const image = images.current.get(target.thumb) ?? target.thumb;
    const outcome = await requestResearch(buildPhotoRequest(requestId, current, image, target.kind));
    if (!alive.current) return;
    setDescribingIndex(null);
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    if (outcome.kind === "ok" && outcome.response.kind === "photo" && outcome.response.description.trim() !== "") {
      const description = outcome.response.description;
      update((latest) => {
        const at = latest.photos.findIndex((photo) => photo.thumb === target.thumb);
        return at === -1 ? latest : setPhotoDescription(latest, at, description);
      });
      setMessage(`사진 설명 초안을 만들었어요. ${RESEARCH_COPY.aiBoxMark}.`);
    } else {
      setMessage(PHOTO_DESCRIBE_FAILED);
    }
  };

  const handleSend = async () => {
    if (busy || !state) return;
    const body = canSend(state) ? buildResultBody(state) : null;
    if (!body) {
      const names = missingRequiredCards(state).map((card) => card.name);
      setMessage(`${RESEARCH_COPY.summary.missingTitle}: ${names.join(", ")}`);
      return;
    }
    setBusy(true);
    setMessage("");
    const outcome = await sendResult(requestId, body.candidates);
    if (!alive.current) return;
    if (outcome.kind === "sent") {
      finished.current = true;
      clearResearchState(requestId);
      setBusy(false);
      // 서버 값으로 완료 화면(SentView)을 다시 불러온다.
      setLoad({ kind: "loading" });
      setAttempt((value) => value + 1);
      return;
    }
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    setBusy(false);
    if (outcome.kind === "not_yours") {
      setLost(true);
      setMessage(VOLUNTEER_MESSAGES.notYoursAnymore);
    } else if (outcome.kind === "invalid_url") {
      setMessage(VOLUNTEER_MESSAGES.invalidUrl);
    } else {
      setMessage(VOLUNTEER_MESSAGES.sendFailed);
    }
  };

  const handleRelease = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const outcome = await releaseRequest(requestId);
    if (!alive.current) return;
    if (outcome.kind === "released") {
      finished.current = true;
      clearResearchState(requestId);
      saveFlash(VOLUNTEER_MESSAGES.releasedToQueue);
      router.push("/volunteer");
      return;
    }
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    if (outcome.kind === "not_yours") {
      setLoad({ kind: "denied" });
      return;
    }
    setBusy(false);
    setMessage(outcome.message);
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

    return (
      <div className="vol-root rc-root">
        <main className="vol-page rc-page">
          <header className="rc-top">
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
                {badge.note && <span className="rc-badge-note">{badge.note}</span>}
              </span>
            </div>

            <section className="rc-request" aria-label={RESEARCH_COPY.requestLabel}>
              <p className="vol-summary-label">{RESEARCH_COPY.requestLabel}</p>
              <p className="vol-quote">{quoteOf(request.product, request.budget)}</p>
              <p className="vol-sub">{structuredLine(request)}</p>
            </section>

            <div className="rc-progress">
              <span
                className="rc-dots"
                role="img"
                aria-label={onSummary ? SUMMARY_ALT : RESEARCH_COPY.progressAlt(card.number)}
              >
                {dots.map((on, index) => (
                  <span key={index} className={`rc-dot${on ? " rc-dot--on" : ""}`} />
                ))}
              </span>
              <span className="rc-progress-text" aria-hidden="true" data-testid="progress-label">
                {onSummary ? SUMMARY_LABEL : RESEARCH_COPY.progressLabel(card.number)}
              </span>
            </div>

            {card && (
              <section className="rc-question" data-testid="question-card">
                <span className="vol-chip rc-question-chip">{AI_QUESTION_TITLE}</span>
                <h2 ref={questionRef} tabIndex={-1} className="rc-question-text" data-testid="question">
                  {question}
                </h2>
                {helper && <p className="rc-question-helper">{helper}</p>}
              </section>
            )}
          </header>

          <div className="rc-body">
            {onSummary ? (
              <ResearchSummary
                ref={summaryHeadingRef}
                state={state}
                summaryBusy={helpStatus.summary === "loading"}
                onChangeText={(value) => {
                  summaryEdited.current = true;
                  update((current) => ({ ...current, summaryText: value }));
                }}
                onGoToCard={(id) => goStep((current) => goToCard(current, id))}
              />
            ) : (
              <>
                <History state={state} subject={subject} />
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
                  onStatus={setMessage}
                  photo={{
                    uploading,
                    describingIndex,
                    onFiles: (files, photoKind) => void handleFiles(files, photoKind),
                    onRemove: handleRemovePhoto,
                    onDescribe: (index) => void handleDescribe(index),
                  }}
                />
              </>
            )}

            <div className="rc-release">
              {lost && (
                <Link href="/volunteer?tab=mine" className="vol-btn vol-btn--block">
                  목록으로
                </Link>
              )}
              <button
                type="button"
                className="vol-btn vol-btn--secondary"
                aria-disabled={busy ? true : undefined}
                onClick={handleRelease}
              >
                {RESEARCH_COPY.buttons.release}
              </button>
            </div>
          </div>

          <footer className="rc-bottom">
            <StatusRegion message={message} />
            <div className="rc-buttons">
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
              {onSummary ? (
                <button
                  type="button"
                  className="vol-btn rc-primary"
                  aria-disabled={sendLocked ? true : undefined}
                  onClick={handleSend}
                >
                  {RESEARCH_COPY.buttons.send}
                </button>
              ) : (
                <>
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
                </>
              )}
            </div>
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
            <Link href="/volunteer" className="vol-back" aria-label="대기열로">
              &lt;
            </Link>
            <h1 ref={headingRef} tabIndex={-1}>
              {RESEARCH_COPY.title}
            </h1>
          </span>
        </header>
        {(load.kind === "loading" || (load.kind === "ok" && inProgress)) && (
          <p className="vol-empty">불러오는 중입니다.</p>
        )}
        {load.kind === "ok" && !inProgress && !load.detail.result && (
          <>
            <StatusRegion message={VOLUNTEER_MESSAGES.notYours} />
            <div className="vol-actions">
              <Link href="/volunteer" className="vol-btn vol-btn--secondary">
                목록으로
              </Link>
            </div>
          </>
        )}
        {load.kind === "denied" && (
          <>
            <StatusRegion message={VOLUNTEER_MESSAGES.notYours} />
            <div className="vol-actions">
              <Link href="/volunteer" className="vol-btn vol-btn--secondary">
                목록으로
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
                다시 시도
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** 지난 문답(바로 앞 카드의 질문과 내 답)을 말풍선으로 짧게. 답이 없으면 그리지 않는다. */
function History({ state, subject }: { state: ResearchState; subject: string }) {
  const previous = RESEARCH_CARDS[state.step - 1];
  if (!previous) return null;
  const answer = (() => {
    switch (previous.id) {
      case "model":
        return `${state.model.trim()}${state.purchase === "bought" ? " · 구매했어요" : state.purchase === "research" ? " · 리서치만" : ""}`;
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
  const question = defaultQuestion(previous.id, { subject, model: state.model.trim(), alts: state.alts });
  return (
    <div className="rc-history" data-testid="history">
      <p className="rc-bubble rc-bubble--ai">{question}</p>
      <p className="rc-bubble rc-bubble--me">{answer}</p>
    </div>
  );
}
