"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AgentSheet } from "@/components/AgentSheet";
import { StatusRegion } from "@/components/StatusRegion";
import {
  candidateStatus,
  clearDraftStore,
  emptyDraftStore,
  moveCandidateDraft,
  readCandidateRecord,
  readDraftStore,
  setCandidateDraft,
  setCandidateEdits,
  writeDraftStore,
  type DraftStore,
} from "@/lib/candidateDraft";
import { RESULT_LIMITS } from "@/lib/resultInput";
import {
  buildForm,
  checkForm,
  formEdits,
  SUMMARY_MESSAGES,
  TAB_STATUS_LABELS,
  type EditorForm,
} from "@/lib/summaryEdit";
import type { SummaryDraft, SummaryFieldKey } from "@/lib/summaryDraft";
import { fetchCandidates, fetchRequest, sendResult } from "@/lib/volunteerClient";
import {
  VOLUNTEER_MESSAGES,
  type CandidateView,
  type SentCandidate,
  type VolunteerRequestView,
} from "@/lib/volunteerView";

type Load =
  | { kind: "loading" }
  | { kind: "ok"; request: VolunteerRequestView; demo: CandidateView[]; candidatesFailed: boolean }
  | { kind: "denied" }
  | { kind: "failed"; message: string };

interface Row {
  id: string;
  name: string;
  url: string;
}

interface FieldError {
  candidateId: string;
  field: "name" | "url" | "guide" | SummaryFieldKey;
  message: string;
}

/** 화면 5: 후보마다 AI 초안을 확인하고 고친 뒤, 확인한 후보(1~3개)를 보낸다. 입력은 이 기기에만 남는다. */
export function SummaryEditor({ requestId }: { requestId: string }) {
  const router = useRouter();
  const wanted = useSearchParams().get("c");
  const uid = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<DraftStore>(emptyDraftStore);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);
  const [lostRequest, setLostRequest] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await fetchRequest(requestId);
      if (cancelled) return;
      if (found.kind === "unauthorized") {
        router.replace("/volunteer");
        return;
      }
      if (found.kind === "failed") {
        setLoad(
          found.status === 403 || found.status === 404
            ? { kind: "denied" }
            : { kind: "failed", message: found.message },
        );
        return;
      }
      const request = found.data.request;
      if (request.status !== "in_progress") {
        // 이미 보낸 요청이면 보낸 내용(화면 6)으로 간다.
        router.replace(`/volunteer/requests/${requestId}`);
        return;
      }
      const candidates = await fetchCandidates(requestId);
      if (cancelled) return;
      if (candidates.kind === "unauthorized") {
        router.replace("/volunteer");
        return;
      }
      setDrafts(readDraftStore(requestId));
      setLoad({
        kind: "ok",
        request,
        demo: candidates.kind === "ok" ? candidates.data.candidates : [],
        candidatesFailed: candidates.kind !== "ok",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, router, attempt]);

  // 불러온 뒤 제목에 초점을 둬서 낭독이 화면 이름부터 시작하게 한다. 이미 다른 곳을 눌렀으면 빼앗지 않는다.
  const loaded = load.kind !== "loading";
  useEffect(() => {
    if (!loaded) return;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [loaded]);

  // 초안 갱신은 늘 가장 최근 값에서 시작하고, 같은 갱신 함수 안에서 기기 저장소에 쓴다(RequestDetail과 같다).
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

  if (load.kind !== "ok") {
    return (
      <div className="vol-root">
        <main className="vol-page vol-page--plain">
          <header className="vol-topbar">
            <span className="vol-topbar-title">
              <Link href="/volunteer?tab=mine" className="vol-back" aria-label="내 담당 목록으로">
                &lt;
              </Link>
              <h1 ref={headingRef} tabIndex={-1}>
                요약 확인
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

  const { request, demo } = load;
  const rows: Row[] = (demo.length > 0 ? demo : drafts.manual).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    url: candidate.url,
  }));
  const statusOf = (id: string) => candidateStatus(drafts, id);
  const selected =
    rows.find((row) => row.id === selectedId) ??
    rows.find((row) => row.id === wanted) ??
    rows.find((row) => statusOf(row.id) === "read") ??
    rows[0] ??
    null;
  const selectedNumber = selected ? rows.indexOf(selected) + 1 : 0;
  const record = selected ? readCandidateRecord(drafts, selected.id) : null;
  const form = selected ? buildForm(selected, record) : null;
  const confirmedRows = rows.filter((row) => statusOf(row.id) === "confirmed");
  const selectedConfirmed = selected ? statusOf(selected.id) === "confirmed" : false;
  const fieldId = (name: string) => `${uid}-${name}`;
  const errorId = `${uid}-error`;
  const errorOn = (field: FieldError["field"]) =>
    selected && error?.candidateId === selected.id && error.field === field ? error : null;

  const edit = (change: (current: EditorForm) => EditorForm) => {
    if (!selected) return;
    setError(null);
    setMessage("");
    updateDrafts((current) =>
      setCandidateEdits(
        current,
        selected.id,
        formEdits(change(buildForm(selected, readCandidateRecord(current, selected.id)))),
        false,
      ),
    );
  };

  const focusField = (field: FieldError["field"]) => {
    window.setTimeout(() => document.getElementById(fieldId(field))?.focus(), 0);
  };

  const handleConfirm = () => {
    if (!selected || !form || selectedConfirmed) return;
    const checked = checkForm(form);
    if (!checked.ok) {
      setError({ candidateId: selected.id, field: checked.field, message: checked.message });
      focusField(checked.field);
      return;
    }
    setError(null);
    updateDrafts((current) => setCandidateEdits(current, selected.id, formEdits(form), true));
    setMessage(`후보 ${selectedNumber} 요약을 확인했습니다`);
  };

  const handleSend = async () => {
    if (busy) return;
    if (confirmedRows.length === 0) {
      setMessage(SUMMARY_MESSAGES.confirmFirst);
      return;
    }
    const candidates: SentCandidate[] = [];
    for (const row of confirmedRows) {
      const checked = checkForm(buildForm(row, readCandidateRecord(drafts, row.id)));
      if (!checked.ok) {
        setSelectedId(row.id);
        setError({ candidateId: row.id, field: checked.field, message: checked.message });
        setMessage(SUMMARY_MESSAGES.sendFailed);
        return;
      }
      candidates.push(checked.candidate);
    }
    setBusy(true);
    setMessage("");
    const outcome = await sendResult(requestId, candidates);
    if (outcome.kind === "sent") {
      clearDraftStore(requestId);
      router.replace(`/volunteer/requests/${requestId}`);
      return;
    }
    if (outcome.kind === "unauthorized") {
      router.replace("/volunteer");
      return;
    }
    setBusy(false);
    if (outcome.kind === "not_yours") {
      setLostRequest(true);
      setMessage(SUMMARY_MESSAGES.notYoursAnymore);
    } else if (outcome.kind === "invalid_url") {
      setMessage(SUMMARY_MESSAGES.invalidUrl);
    } else {
      setMessage(SUMMARY_MESSAGES.sendFailed);
    }
  };

  const nameError = errorOn("name");
  const urlError = errorOn("url");
  const guideError = errorOn("guide");
  const sendLocked = confirmedRows.length === 0;

  return (
    <div className="vol-root">
      <main className="vol-page vol-page--agent">
        <header className="vol-topbar">
          <span className="vol-topbar-title">
            <Link
              href={`/volunteer/requests/${requestId}`}
              className="vol-back"
              aria-label="요청 상세로"
            >
              &lt;
            </Link>
            <h1 ref={headingRef} tabIndex={-1}>
              요약 확인
            </h1>
          </span>
        </header>
        <StatusRegion message={message} />
        <p className="vol-notice">{SUMMARY_MESSAGES.intro}</p>

        {load.candidatesFailed && (
          <>
            <p className="vol-notice">{VOLUNTEER_MESSAGES.candidatesFailed}</p>
            <div className="vol-actions">
              <button
                type="button"
                className="vol-btn"
                onClick={() => {
                  setLoad({ kind: "loading" });
                  setAttempt((value) => value + 1);
                }}
              >
                후보 다시 불러오기
              </button>
            </div>
          </>
        )}

        {!load.candidatesFailed && rows.length === 0 && (
          <>
            <p className="vol-empty">확인할 후보가 없어요. 요청 상세에서 후보를 추가해 주세요.</p>
            <div className="vol-actions">
              <Link href={`/volunteer/requests/${requestId}`} className="vol-btn vol-btn--secondary">
                요청 상세로
              </Link>
            </div>
          </>
        )}

        {selected && form && (
          <>
            <nav className="vol-vtabs" aria-label="후보 선택">
              {rows.map((row, index) => (
                <button
                  key={row.id}
                  type="button"
                  className="vol-vtab"
                  aria-pressed={row.id === selected.id}
                  onClick={() => {
                    setSelectedId(row.id);
                    setError(null);
                    setMessage("");
                  }}
                >
                  {`후보 ${index + 1} ${TAB_STATUS_LABELS[statusOf(row.id)]}`}
                </button>
              ))}
            </nav>

            <section className="vol-vform" aria-label={`후보 ${selectedNumber} 요약`}>
              {!form.hasDraft && <p className="vol-foot vol-foot--tight">{SUMMARY_MESSAGES.noCapture}</p>}

              <label className="vol-label" htmlFor={fieldId("name")}>
                상품명
              </label>
              <input
                id={fieldId("name")}
                className="vol-input"
                value={form.name}
                autoComplete="off"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? errorId : undefined}
                onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))}
              />
              {nameError && (
                <p id={errorId} className="vol-field-error">
                  {nameError.message}
                </p>
              )}

              <label className="vol-label" htmlFor={fieldId("url")}>
                구매 링크
              </label>
              <input
                id={fieldId("url")}
                className="vol-input"
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={form.url}
                autoComplete="off"
                autoCapitalize="none"
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? errorId : undefined}
                onChange={(event) => edit((current) => ({ ...current, url: event.target.value }))}
              />
              {urlError && (
                <p id={errorId} className="vol-field-error">
                  {urlError.message}
                </p>
              )}

              <h2>상세 요약</h2>
              <ul className="vol-items">
                {form.items.map((item) => {
                  const itemError = errorOn(item.key);
                  return (
                    <li key={item.key} className="vol-item">
                      <div className="vol-item-head">
                        <label className="vol-item-label" htmlFor={fieldId(item.key)}>
                          {item.label}
                        </label>
                        {item.needsCheck && (
                          <span className="vol-chip">{SUMMARY_MESSAGES.needsCheck}</span>
                        )}
                      </div>
                      <input
                        id={fieldId(item.key)}
                        className="vol-input"
                        value={item.value}
                        placeholder={SUMMARY_MESSAGES.emptyValue}
                        autoComplete="off"
                        aria-invalid={itemError ? true : undefined}
                        aria-describedby={itemError ? errorId : undefined}
                        onChange={(event) =>
                          edit((current) => ({
                            ...current,
                            items: current.items.map((entry) =>
                              entry.key === item.key ? { ...entry, value: event.target.value } : entry,
                            ),
                          }))
                        }
                      />
                      {itemError && (
                        <p id={errorId} className="vol-field-error">
                          {itemError.message}
                        </p>
                      )}
                      {item.evidence && (
                        <details className="vol-evidence">
                          <summary>근거 보기</summary>
                          <p>{item.evidence}</p>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>

              <label className="vol-label" htmlFor={fieldId("guide")}>
                구매 가이드
              </label>
              <textarea
                id={fieldId("guide")}
                className="vol-input vol-textarea"
                value={form.guide}
                maxLength={RESULT_LIMITS.guideMax}
                aria-invalid={guideError ? true : undefined}
                aria-describedby={guideError ? errorId : undefined}
                onChange={(event) => edit((current) => ({ ...current, guide: event.target.value }))}
              />
              {guideError && (
                <p id={errorId} className="vol-field-error">
                  {guideError.message}
                </p>
              )}
            </section>

            <div className="vol-actions vol-actions--wrap">
              <button
                type="button"
                className="vol-btn vol-btn--secondary"
                aria-disabled={selectedConfirmed ? true : undefined}
                onClick={handleConfirm}
              >
                {selectedConfirmed ? `후보 ${selectedNumber} 확인함` : `후보 ${selectedNumber} 확인`}
              </button>
              <button
                type="button"
                className="vol-btn"
                aria-disabled={sendLocked || busy ? true : undefined}
                aria-describedby={sendLocked ? `${uid}-lock` : undefined}
                onClick={() => void handleSend()}
              >
                {`확인한 ${confirmedRows.length}개 보내기`}
              </button>
            </div>
            {sendLocked && (
              <p id={`${uid}-lock`} className="vol-foot">
                {SUMMARY_MESSAGES.confirmFirst}
              </p>
            )}
            {lostRequest && (
              <div className="vol-actions">
                <Link href="/volunteer" className="vol-btn vol-btn--secondary">
                  목록으로
                </Link>
              </div>
            )}
          </>
        )}

        <AgentSheet
          request={request}
          candidates={rows.map((row) => ({ id: row.id, name: row.name }))}
          drafts={selected ? { ...drafts, lastOpened: selected.id } : drafts}
          onSaveDraft={saveCapturedDraft}
          onMoveDraft={moveCapturedDraft}
        />
      </main>
    </div>
  );
}
