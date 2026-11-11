"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  arrivedStatus,
  CAPTURE_STATUS,
  readCapture,
  summarizeText,
  type CaptureOutcome,
} from "@/lib/captureRead";
import { CAPTURE_MESSAGES, type CaptureTargetReason } from "@/lib/candidateDraft";
import type { SummaryDraft } from "@/lib/summaryDraft";

// 캡처 올리기. 파일 여러 장 → 조각 → 글자 읽기 → 요약 초안(lib/captureRead.ts).
// 읽기에 실패하면 "상세 내용을 직접 입력" 칸을 연다. 이미지와 글자는 어디에도 저장하지 않는다.
// 흐름은 에이전트 창을 닫아도 이어지도록 창 밖(AgentSheet)에서 hook으로 돌리고,
// 여기서는 버튼(CaptureUpload)과 직접 입력 칸(CaptureManualForm)을 그린다.

export interface CaptureSaved {
  candidateId: string;
  /** 올리기 시작할 때 이 후보로 정한 까닭. 읽는 동안 화면에서 다른 후보를 눌러도 바뀌지 않는다. */
  reason: CaptureTargetReason;
  draft: SummaryDraft;
  captureCount: number;
  notice: string;
}

interface CaptureOptions {
  requestId: string;
  /** 이용자가 한 말(요약 지시문의 맥락). */
  product: string;
  /** 초안이 생겼다. 어느 후보에 저장할지는 올릴 때 정한 후보다. */
  onSaved: (saved: CaptureSaved) => void;
  /** 안내를 남긴다(상태 영역). */
  onStatus: (message: string) => void;
  /** 입장 정보가 사라졌다. */
  onUnauthorized: () => void;
}

interface Pending {
  candidateId: string;
  reason: CaptureTargetReason;
  captureCount: number;
}

export interface CaptureController {
  busy: boolean;
  manualOpen: boolean;
  manualText: string;
  setManualText: (text: string) => void;
  /** 직접 입력 칸에 초점을 줄 때마다 올라간다. */
  focusManual: number;
  start: (files: File[], candidateId: string, reason: CaptureTargetReason) => void;
  submitManual: () => void;
}

export function useCaptureUpload(options: CaptureOptions): CaptureController {
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [focusManual, setFocusManual] = useState(0);
  const pending = useRef<Pending | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => () => abortRef.current?.abort(), []);

  const finish = useCallback((outcome: CaptureOutcome, target: Pending) => {
    const { onSaved, onStatus, onUnauthorized } = latest.current;
    if (outcome.kind === "draft") {
      pending.current = null;
      setManualOpen(false);
      setManualText("");
      onSaved({
        candidateId: target.candidateId,
        reason: target.reason,
        draft: outcome.draft,
        captureCount: outcome.captureCount,
        notice: outcome.notice,
      });
      return;
    }
    if (outcome.kind === "manual") {
      pending.current = target;
      setManualOpen(true);
      setFocusManual((value) => value + 1);
      onStatus(outcome.status);
      return;
    }
    if (outcome.unauthorized) onUnauthorized();
    onStatus(outcome.status);
  }, []);

  const start = useCallback(
    (files: File[], candidateId: string, reason: CaptureTargetReason) => {
      if (files.length === 0 || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const abort = new AbortController();
      abortRef.current = abort;
      const { requestId, product, onStatus } = latest.current;
      void readCapture({ requestId, product }, files, { onStatus, signal: abort.signal })
        .then((outcome) => finish(outcome, { candidateId, reason, captureCount: files.length }))
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [finish],
  );

  const submitManual = useCallback(() => {
    if (busyRef.current) return;
    const target = pending.current;
    const { requestId, product, onStatus } = latest.current;
    const text = manualText.trim();
    if (!target) return;
    if (!text) {
      onStatus(CAPTURE_STATUS.emptyText);
      setFocusManual((value) => value + 1);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    onStatus(CAPTURE_STATUS.summarizing);
    const abort = new AbortController();
    abortRef.current = abort;
    void summarizeText(
      { requestId, product },
      "manual",
      text,
      { lowConfidence: [], unreadable: [] },
      target.captureCount,
      { signal: abort.signal },
    )
      .then((outcome) => finish(outcome, target))
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [finish, manualText]);

  return { busy, manualOpen, manualText, setManualText, focusManual, start, submitManual };
}

/** 저장 직후의 안내 글자(초안 도착 + 상품명 경고는 호출하는 쪽이 붙인다). */
export const savedStatus = (saved: CaptureSaved, candidateNumber: number) =>
  `${CAPTURE_MESSAGES.saved(saved.captureCount, candidateNumber)}. ${arrivedStatus(saved.draft)}`;

interface CaptureUploadProps {
  controller: CaptureController;
  /** 저장할 후보 번호(1부터). 후보가 없으면 null이고 버튼이 잠긴다. */
  candidateNumber: number | null;
  /** 저장할 후보 id. */
  candidateId: string | null;
  /** 그 후보로 정한 까닭(직접 고름 / 마지막으로 연 후보 / 첫 캡처 필요). 올리기 시작할 때 고정된다. */
  reason: CaptureTargetReason | null;
}

/** "캡처 올리기 · 후보 N에 저장" 버튼과 숨은 파일 입력. 후보가 없으면 잠겨 있다. */
export function CaptureUpload({
  controller,
  candidateNumber,
  candidateId,
  reason,
}: CaptureUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const locked = candidateId === null || controller.busy;
  const label =
    candidateNumber === null ? "캡처 올리기" : `캡처 올리기 · 후보 ${candidateNumber}에 저장`;
  return (
    <div className="vol-capture">
      <button
        type="button"
        className="vol-btn vol-btn--secondary vol-btn--block"
        aria-disabled={locked ? true : undefined}
        aria-describedby={candidateId === null ? hintId : undefined}
        onClick={() => {
          if (!locked) inputRef.current?.click();
        }}
      >
        {label}
      </button>
      {candidateId === null && (
        <p id={hintId} className="vol-foot vol-foot--tight">
          {CAPTURE_MESSAGES.noCandidates}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="vol-sr"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="capture-input"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (candidateId !== null) controller.start(files, candidateId, reason ?? "chosen");
        }}
      />
    </div>
  );
}

/** 글자 읽기에 실패했을 때 여는 "상세 내용" 직접 입력 칸. */
export function CaptureManualForm({ controller }: { controller: CaptureController }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const { focusManual, manualOpen } = controller;
  useEffect(() => {
    if (manualOpen && focusManual > 0) textareaRef.current?.focus();
  }, [focusManual, manualOpen]);
  if (!manualOpen) return null;
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    controller.submitManual();
  };
  return (
    <form className="vol-capture-manual" onSubmit={handleSubmit}>
      <label className="vol-label" htmlFor={id}>
        상세 내용을 직접 입력
      </label>
      <textarea
        ref={textareaRef}
        id={id}
        className="vol-input vol-textarea"
        rows={5}
        value={controller.manualText}
        onChange={(event) => controller.setManualText(event.target.value)}
      />
      <button
        type="submit"
        className="vol-btn vol-btn--block"
        aria-disabled={controller.busy ? true : undefined}
      >
        이 글로 요약
      </button>
    </form>
  );
}
