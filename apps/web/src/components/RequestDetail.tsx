"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSheet } from "@/components/AgentSheet";
import { CandidateList } from "@/components/CandidateList";
import { StatusRegion } from "@/components/StatusRegion";
import {
  addManualCandidate,
  candidateStatus,
  clearDraftStore,
  emptyDraftStore,
  moveCandidateDraft,
  readDraftStore,
  setCandidateDraft,
  writeDraftStore,
  type CandidateStatus,
  type DraftStore,
} from "@/lib/candidateDraft";
import type { SummaryDraft } from "@/lib/summaryDraft";
import { searchQueryOf, SHOPS, shopSearchUrl } from "@/lib/shopLinks";
import {
  fetchCandidates,
  fetchRequest,
  releaseRequest,
  saveFlash,
  type DetailResponse,
} from "@/lib/volunteerClient";
import {
  formatSentAt,
  quoteOf,
  structuredLine,
  VOLUNTEER_MESSAGES,
  type CandidateView,
} from "@/lib/volunteerView";

type Load =
  | { kind: "loading" }
  | { kind: "ok"; detail: DetailResponse }
  | { kind: "denied" }
  | { kind: "failed"; message: string };

type CandidateLoad =
  | { kind: "loading" }
  | { kind: "ok"; candidates: CandidateView[] }
  | { kind: "failed" };

/** 화면 3: 맡은 요청의 상세(요청 요약·후보·직접 찾기·내려놓기·쇼핑 에이전트), 또는 보낸 요청의 읽기 전용 보기. */
export function RequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [candidateLoad, setCandidateLoad] = useState<CandidateLoad>({ kind: "loading" });
  const [candidateAttempt, setCandidateAttempt] = useState(0);
  const [drafts, setDrafts] = useState<DraftStore>(emptyDraftStore);
  const [agentTarget, setAgentTarget] = useState<{ candidateId: string; nonce: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void fetchRequest(requestId).then((result) => {
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        router.replace("/volunteer");
        return;
      }
      if (result.kind === "ok") {
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

  // 맡은 요청이면 후보를 불러오고, 이 기기의 초안(직접 추가한 후보, 마지막으로 연 후보)을 읽는다.
  const inProgress = load.kind === "ok" && load.detail.request.status === "in_progress";
  useEffect(() => {
    if (!inProgress) return;
    let cancelled = false;
    void fetchCandidates(requestId).then((result) => {
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        router.replace("/volunteer");
      } else if (result.kind === "ok") {
        setDrafts(readDraftStore(requestId));
        setCandidateLoad({ kind: "ok", candidates: result.data.candidates });
      } else {
        setCandidateLoad({ kind: "failed" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inProgress, requestId, router, candidateAttempt]);

  // 초안 갱신은 늘 가장 최근 값에서 시작한다(글자 읽기가 끝나는 사이에 다른 후보 링크를 눌렀을 수 있다).
  // 같은 값을 다시 써도 같은 결과라서 갱신 함수 안에서 기기 저장소에 쓴다.
  const updateDrafts = useCallback(
    (change: (current: DraftStore) => DraftStore) => {
      setDrafts((current) => {
        const next = change(current);
        writeDraftStore(requestId, next);
        return next;
      });
    },
    [requestId],
  );
  const saveCapturedDraft = useCallback(
    (candidateId: string, draft: SummaryDraft, captureCount: number) =>
      updateDrafts((current) => setCandidateDraft(current, candidateId, draft, captureCount)),
    [updateDrafts],
  );
  const moveCapturedDraft = useCallback(
    (fromId: string, toId: string) => updateDrafts((current) => moveCandidateDraft(current, fromId, toId)),
    [updateDrafts],
  );

  const handleRelease = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const outcome = await releaseRequest(requestId);
    if (outcome.kind === "released") {
      clearDraftStore(requestId);
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

  if (load.kind === "ok") {
    const { request, result } = load.detail;
    const demoCandidates = candidateLoad.kind === "ok" ? candidateLoad.candidates : [];
    const agentCandidates = (demoCandidates.length > 0 ? demoCandidates : drafts.manual).map(
      (candidate) => ({ id: candidate.id, name: candidate.name }),
    );
    const query = searchQueryOf(request);
    const statuses: Record<string, CandidateStatus> = Object.fromEntries(
      agentCandidates.map((candidate) => [candidate.id, candidateStatus(drafts, candidate.id)]),
    );
    return (
      <div className="vol-root">
        <main className={`vol-page ${inProgress ? "vol-page--agent" : "vol-page--plain"}`}>
          <header className="vol-topbar">
            <span className="vol-topbar-title">
              <Link href="/volunteer?tab=mine" className="vol-back" aria-label="내 담당 목록으로">
                &lt;
              </Link>
              <h1 ref={headingRef} tabIndex={-1}>
                요청 상세
              </h1>
            </span>
            <span className="vol-state">{inProgress ? "진행 중" : "완료"}</span>
          </header>
          <StatusRegion message={message} />
          <section className="vol-summary" aria-label="요청 요약">
            <p className="vol-summary-label">이용자가 한 말</p>
            <p className="vol-quote">{quoteOf(request.product, request.budget)}</p>
            <p className="vol-sub">{structuredLine(request)}</p>
          </section>

          {inProgress ? (
            <>
              {candidateLoad.kind === "loading" && (
                <p className="vol-empty">후보를 불러오는 중입니다.</p>
              )}
              {candidateLoad.kind === "failed" && (
                <>
                  <p className="vol-notice">{VOLUNTEER_MESSAGES.candidatesFailed}</p>
                  <div className="vol-actions">
                    <button
                      type="button"
                      className="vol-btn"
                      onClick={() => {
                        setCandidateLoad({ kind: "loading" });
                        setCandidateAttempt((value) => value + 1);
                      }}
                    >
                      후보 다시 불러오기
                    </button>
                  </div>
                </>
              )}
              {candidateLoad.kind === "ok" && (
                <CandidateList
                  demo={candidateLoad.candidates}
                  manual={drafts.manual}
                  onOpenLink={(candidateId) =>
                    updateDrafts((current) => ({ ...current, lastOpened: candidateId }))
                  }
                  statuses={statuses}
                  onCapture={(candidateId) =>
                    setAgentTarget((current) => ({
                      candidateId,
                      nonce: (current?.nonce ?? 0) + 1,
                    }))
                  }
                  onAddManual={(name, url) => {
                    updateDrafts((current) => addManualCandidate(current, name, url));
                    return true;
                  }}
                />
              )}

              <section className="vol-shops" aria-labelledby="vol-shops-title">
                <h2 id="vol-shops-title">직접 찾기</h2>
                <div className="vol-shop-links">
                  {SHOPS.map((shop) => (
                    <a
                      key={shop.id}
                      className="vol-btn vol-btn--secondary"
                      href={shopSearchUrl(shop.id, query)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {shop.name}
                    </a>
                  ))}
                </div>
              </section>

              <div className="vol-actions">
                <button
                  type="button"
                  className="vol-btn vol-btn--secondary"
                  aria-disabled={busy ? true : undefined}
                  onClick={handleRelease}
                >
                  내려놓기
                </button>
              </div>
              <AgentSheet
                request={request}
                candidates={agentCandidates}
                target={agentTarget}
                drafts={drafts}
                onSaveDraft={saveCapturedDraft}
                onMoveDraft={moveCapturedDraft}
              />
            </>
          ) : (
            result && (
              <>
                <h2>보낸 내용 · {formatSentAt(result.sentAt)}</h2>
                <ul className="vol-result">
                  {result.candidates.map((candidate) => (
                    <li key={`${candidate.name}-${candidate.url}`} className="vol-result-item">
                      <p className="vol-result-name">{candidate.name}</p>
                      {candidate.summary.length > 0 && (
                        <p className="vol-result-line">
                          {candidate.summary.map((entry) => `${entry.label} ${entry.value}`).join(" · ")}
                        </p>
                      )}
                      {candidate.guide && <p className="vol-result-line">{candidate.guide}</p>}
                    </li>
                  ))}
                </ul>
                <div className="vol-actions">
                  <Link href="/volunteer?tab=mine" className="vol-btn vol-btn--secondary">
                    목록으로
                  </Link>
                </div>
              </>
            )
          )}
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
              요청 상세
            </h1>
          </span>
        </header>
        {load.kind === "loading" && <p className="vol-empty">불러오는 중입니다.</p>}
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
