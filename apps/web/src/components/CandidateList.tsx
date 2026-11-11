"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  CANDIDATE_STATUS_LABELS,
  MANUAL_MESSAGES,
  MAX_MANUAL,
  MAX_NAME_LENGTH,
  validateManual,
  type CandidateStatus,
  type ManualCandidate,
} from "@/lib/candidateDraft";
import type { CandidateView } from "@/lib/volunteerView";

const PRICE_NOTE = "가격은 쇼핑몰에서 확인";

interface CandidateListProps {
  /** 서버가 준 시연용 예시 후보. 비어 있으면 직접 추가를 보인다. */
  demo: readonly CandidateView[];
  /** 이 기기에 저장한 직접 추가 후보(서버 후보가 없을 때만 쓴다). */
  manual: readonly ManualCandidate[];
  /** '쇼핑몰에서 보기'를 눌렀다(링크는 새 탭으로 열린다). */
  onOpenLink: (candidateId: string) => void;
  /** 후보별 상태(캡처 필요 / 캡처 읽음 · 확인 전 / 요약 확인함). 없으면 캡처 필요. */
  statuses: Readonly<Record<string, CandidateStatus>>;
  /** '캡처 필요' 칩을 눌렀다. 에이전트 창을 그 후보로 연다. */
  onCapture: (candidateId: string) => void;
  /** '캡처 읽음 · 확인 전'·'요약 확인함' 칩을 눌렀다. 요약 확인 화면의 그 후보로 간다. */
  onVerify: (candidateId: string) => void;
  /** 직접 추가. 저장했으면 true. */
  onAddManual: (name: string, url: string) => boolean;
}

/** 화면 3의 후보 카드들. 후보 출처 표시, 쇼핑몰 링크, 상태 칩, 후보가 없을 때의 직접 추가. */
export function CandidateList({
  demo,
  manual,
  onOpenLink,
  statuses,
  onCapture,
  onVerify,
  onAddManual,
}: CandidateListProps) {
  const fromDemo = demo.length > 0;
  const rows = fromDemo
    ? demo.map((candidate) => ({ ...candidate }))
    : manual.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        seller: "직접 추가",
        url: candidate.url,
      }));

  return (
    <section className="vol-cands" aria-labelledby="vol-cands-title">
      <div className="vol-cands-head">
        <h2 id="vol-cands-title">{fromDemo || rows.length > 0 ? `후보 ${rows.length}개` : "후보 직접 추가"}</h2>
        {fromDemo && <span className="vol-chip vol-chip--outline">시연용 예시 후보</span>}
      </div>
      {fromDemo && <p className="vol-foot vol-foot--tight">실제 상품과 가격은 쇼핑몰에서 확인하세요.</p>}
      {!fromDemo && rows.length === 0 && (
        <p className="vol-foot vol-foot--tight">
          이 품목은 준비된 후보가 없어요. 찾은 상품의 이름과 링크를 직접 추가해 주세요.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="vol-list vol-cand-list">
          {rows.map((row, index) => {
            const nameId = `vol-cand-name-${row.id}`;
            const status = statuses[row.id] ?? "needs_capture";
            return (
              <li key={row.id} className="vol-cand">
                <span className="vol-cand-photo" aria-hidden="true" />
                <div className="vol-cand-body">
                  <p id={nameId} className="vol-cand-name">
                    <span className="vol-sr">후보 {index + 1} </span>
                    {row.name}
                  </p>
                  <p className="vol-sub">
                    {row.seller} · {PRICE_NOTE}
                  </p>
                  <div className="vol-cand-actions">
                    <a
                      className="vol-btn vol-btn--secondary vol-btn--compact"
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-describedby={nameId}
                      onClick={() => onOpenLink(row.id)}
                    >
                      쇼핑몰에서 보기
                    </a>
                    <button
                      type="button"
                      className={`vol-chip-btn vol-chip-btn--${status}`}
                      aria-describedby={nameId}
                      onClick={() => (status === "needs_capture" ? onCapture(row.id) : onVerify(row.id))}
                    >
                      {CANDIDATE_STATUS_LABELS[status]}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!fromDemo && manual.length < MAX_MANUAL && <ManualForm onAdd={onAddManual} />}
      {!fromDemo && manual.length >= MAX_MANUAL && (
        <p className="vol-foot">{MANUAL_MESSAGES.full}</p>
      )}
    </section>
  );
}

function ManualForm({ onAdd }: { onAdd: (name: string, url: string) => boolean }) {
  const nameId = useId();
  const urlId = useId();
  const errorId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<{ field: "name" | "url"; message: string } | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const checked = validateManual(name, url);
    if (!checked.ok) {
      setError({ field: checked.field, message: checked.message });
      (checked.field === "name" ? nameRef : urlRef).current?.focus();
      return;
    }
    if (onAdd(checked.name, checked.url)) {
      setName("");
      setUrl("");
      setError(null);
    }
  };

  return (
    <form className="vol-manual" onSubmit={handleSubmit} noValidate>
      <label className="vol-label" htmlFor={nameId}>
        상품명
      </label>
      <input
        ref={nameRef}
        id={nameId}
        className="vol-input"
        value={name}
        maxLength={MAX_NAME_LENGTH * 2}
        autoComplete="off"
        aria-invalid={error?.field === "name" ? true : undefined}
        aria-describedby={error?.field === "name" ? errorId : undefined}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="vol-label" htmlFor={urlId}>
        구매 링크
      </label>
      <input
        ref={urlRef}
        id={urlId}
        className="vol-input"
        type="url"
        inputMode="url"
        placeholder="https://…"
        value={url}
        autoComplete="off"
        autoCapitalize="none"
        aria-invalid={error?.field === "url" ? true : undefined}
        aria-describedby={error?.field === "url" ? errorId : undefined}
        onChange={(event) => setUrl(event.target.value)}
      />
      {error && (
        <p id={errorId} className="vol-field-error">
          {error.message}
        </p>
      )}
      <button type="submit" className="vol-btn vol-btn--block">
        후보 추가
      </button>
    </form>
  );
}
