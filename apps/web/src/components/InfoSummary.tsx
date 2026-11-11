"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cutPieces, joinPieceTexts, MAX_PIECES } from "@/lib/imagePieces";
import {
  countNeedsCheck,
  isSummaryDraft,
  SUMMARY_TEXT_LIMIT,
  type SummaryDraft,
  type SummaryField,
} from "@/lib/summaryDraft";

// ④ 봉사자가 올린 상세 이미지를 조각으로 잘라 한 장씩 읽히고, 요약 초안을 항목별로 보여 준다.
// 이미지·읽은 글자·초안은 이 컴포넌트 상태에만 둔다(서버·브라우저 저장소에 저장하지 않는다).

export const SUMMARY_STATUS = {
  reading: (i: number, n: number) => `이미지 ${i}/${n}을 읽고 있습니다.`,
  arrived: (n: number, k: number) =>
    `요약 초안이 도착했습니다. 항목 ${n}개, 확인 필요 ${k}개.`,
  extractFailed: "이미지에서 글자를 읽지 못했습니다. 상세 내용을 직접 입력하세요.",
  tooLarge: "이미지 조각이 너무 큽니다. 상세 내용을 직접 입력하세요.",
  badFormat: "이미지 형식을 읽을 수 없습니다. 상세 내용을 직접 입력하세요.",
  notConfigured: "글자 읽기 설정이 끝나지 않았습니다. 상세 내용을 직접 입력하세요.",
  tooManyPieces: `조각이 ${MAX_PIECES}개를 넘습니다. 이미지 수를 줄여 다시 올리세요.`,
  noAccess: "접근 코드가 필요합니다. 시연 주소로 다시 열어 주세요.",
  unknownVolunteer: "봉사자 정보가 없습니다. 이용자 화면에서 다시 연결하세요.",
  summarizing: "요약을 만들고 있습니다.",
  summaryFailed: "요약을 만들지 못했습니다. 잠시 뒤 다시 시도하세요.",
  emptyText: "요약할 글을 입력하세요.",
} as const;

export const LONG_TEXT_NOTICE = `읽은 글이 길어 앞 ${SUMMARY_TEXT_LIMIT.toLocaleString("en-US")}자만 요약합니다.`;

const MAX_ATTEMPTS = 3;
/** 429를 기다리는 횟수 상한. 끝없이 기다리지 않게 한다. */
const MAX_RATE_LIMIT_WAITS = 5;
const MAX_RETRY_AFTER_SECONDS = 60;

interface InfoSummaryProps {
  requestId: string;
  volunteerId: string;
  product: string;
}

interface Timing {
  totalMs: number;
  engine: string | null;
  pieceMs: Array<{ engine: number | null; roundTrip: number }>;
  llmMs: number | null;
}

type Stop = { stop: string; manual: boolean };

function serverTiming(response: Response, name: string): number | null {
  const header = response.headers.get("server-timing") ?? "";
  const match = new RegExp(`${name};dur=(\\d+(?:\\.\\d+)?)`).exec(header);
  return match ? Math.round(Number(match[1])) : null;
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after") ?? 1);
  const bounded = Number.isFinite(seconds) ? seconds : 1;
  return Math.min(Math.max(bounded, 1), MAX_RETRY_AFTER_SECONDS) * 1000;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stopForStatus(status: number): Stop | null {
  switch (status) {
    case 401:
      return { stop: SUMMARY_STATUS.noAccess, manual: false };
    case 403:
      return { stop: SUMMARY_STATUS.unknownVolunteer, manual: false };
    case 413:
      return { stop: SUMMARY_STATUS.tooLarge, manual: true };
    case 415:
      return { stop: SUMMARY_STATUS.badFormat, manual: true };
    case 503:
      return { stop: SUMMARY_STATUS.notConfigured, manual: true };
    default:
      return null;
  }
}

function fieldValue(field: SummaryField): string {
  if (field.check === "unverified") return "확인 안 됨";
  if (field.check === "missing") return "이미지에서 못 찾음";
  return field.value ?? "";
}

export function InfoSummary({ requestId, volunteerId, product }: InfoSummaryProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<SummaryDraft | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [timing, setTiming] = useState<Timing | null>(null);
  const [focusTarget, setFocusTarget] = useState<"draft" | "manual" | null>(null);
  const draftHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusTarget === "draft") draftHeadingRef.current?.focus();
    if (focusTarget === "manual") manualRef.current?.focus();
  }, [focusTarget, draft, manualOpen]);

  const headers = {
    "Content-Type": "application/json",
    "X-Demo-Volunteer": volunteerId,
  };

  function openManual(message: string) {
    setStatus(message);
    setManualOpen(true);
    setFocusTarget("manual");
  }

  async function summarize(
    source: "ocr" | "manual",
    fullText: string,
    extra: { lowConfidence: string[]; unreadable: number[] },
    startedAt: number,
    pieceTiming: Pick<Timing, "engine" | "pieceMs">,
  ) {
    let text = fullText;
    if (text.length > SUMMARY_TEXT_LIMIT) {
      text = text.slice(0, SUMMARY_TEXT_LIMIT);
      setNotice(LONG_TEXT_NOTICE);
    }
    let response: Response | null = null;
    for (let waits = 0; ; waits++) {
      try {
        response = await fetch("/api/volunteer/summarize", {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId,
            context: { product },
            source,
            text,
            ...extra,
          }),
        });
      } catch {
        response = null;
      }
      if (response?.status !== 429 || waits >= MAX_RATE_LIMIT_WAITS) break;
      await wait(retryAfterMs(response));
    }
    const stop = response ? stopForStatus(response.status) : null;
    if (stop) {
      setStatus(stop.stop);
      return;
    }
    const body: unknown = response?.ok ? await response.json().catch(() => null) : null;
    if (!response || !isSummaryDraft(body)) {
      setStatus(SUMMARY_STATUS.summaryFailed);
      return;
    }
    setTiming({
      ...pieceTiming,
      llmMs: serverTiming(response, "llm"),
      totalMs: Math.round(performance.now() - startedAt),
    });
    setDraft(body);
    setStatus(SUMMARY_STATUS.arrived(body.fields.length, countNeedsCheck(body)));
    setFocusTarget("draft");
  }

  /** 조각 하나를 읽는다. 같은 조각 3회 실패면 멈추고 입력창으로. */
  async function readPiece(
    image: string,
    pieceIndex: number,
    pieceCount: number,
  ): Promise<
    | { kind: "text"; text: string; lowConfidence: string[]; engine: string; engineMs: number | null; roundTrip: number }
    | { kind: "unreadable" }
    | Stop
  > {
    let failures = 0;
    let waits = 0;
    while (failures < MAX_ATTEMPTS) {
      const sentAt = performance.now();
      let response: Response;
      try {
        response = await fetch("/api/volunteer/extract-text", {
          method: "POST",
          headers,
          body: JSON.stringify({ requestId, pieceIndex, pieceCount, image }),
        });
      } catch {
        failures += 1;
        continue;
      }
      if (response.status === 429 && waits < MAX_RATE_LIMIT_WAITS) {
        waits += 1;
        await wait(retryAfterMs(response));
        continue;
      }
      if (response.status === 422) return { kind: "unreadable" };
      const stop = stopForStatus(response.status);
      if (stop) return stop;
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as {
          text?: unknown;
          lowConfidence?: unknown;
          engine?: unknown;
        } | null;
        if (typeof body?.text === "string") {
          return {
            kind: "text",
            text: body.text,
            lowConfidence: Array.isArray(body.lowConfidence)
              ? body.lowConfidence.filter((word): word is string => typeof word === "string")
              : [],
            engine: typeof body.engine === "string" ? body.engine : "",
            engineMs: serverTiming(response, "engine"),
            roundTrip: Math.round(performance.now() - sentAt),
          };
        }
      }
      failures += 1;
    }
    return { stop: SUMMARY_STATUS.extractFailed, manual: true };
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    const startedAt = performance.now();
    setBusy(true);
    setDraft(null);
    setTiming(null);
    setNotice("");
    setFocusTarget(null);
    try {
      const pieces: string[] = [];
      let enlarged = false;
      try {
        for (const file of files) {
          const cut = await cutPieces(file);
          pieces.push(...cut.pieces);
          enlarged ||= cut.enlarged;
        }
      } catch {
        openManual(SUMMARY_STATUS.extractFailed);
        return;
      }
      if (pieces.length === 0) {
        openManual(SUMMARY_STATUS.extractFailed);
        return;
      }
      if (pieces.length > MAX_PIECES) {
        setStatus(SUMMARY_STATUS.tooManyPieces);
        return;
      }
      if (enlarged) setNotice("이미지가 길어 조각을 크게 잘랐습니다.");

      // 상태 안내는 시작과 끝만 한다. 조각마다 바꾸면 낭독이 끊긴다(TSD §7.1).
      setStatus(SUMMARY_STATUS.reading(1, pieces.length));
      const texts: string[] = [];
      const lowConfidence: string[] = [];
      const unreadable: number[] = [];
      const pieceMs: Timing["pieceMs"] = [];
      let engine: string | null = null;
      for (let index = 0; index < pieces.length; index++) {
        const result = await readPiece(pieces[index], index, pieces.length);
        if ("stop" in result) {
          if (result.manual) openManual(result.stop);
          else setStatus(result.stop);
          return;
        }
        if (result.kind === "unreadable") {
          unreadable.push(index);
          continue;
        }
        texts.push(result.text);
        lowConfidence.push(...result.lowConfidence);
        engine = result.engine;
        pieceMs.push({ engine: result.engineMs, roundTrip: result.roundTrip });
      }
      const joined = joinPieceTexts(texts);
      if (!joined) {
        openManual(SUMMARY_STATUS.extractFailed);
        return;
      }
      await summarize(
        "ocr",
        joined,
        { lowConfidence, unreadable },
        startedAt,
        { engine, pieceMs },
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = manualText.trim();
    if (!text) {
      setStatus(SUMMARY_STATUS.emptyText);
      return;
    }
    setBusy(true);
    setDraft(null);
    setNotice("");
    setFocusTarget(null);
    setStatus(SUMMARY_STATUS.summarizing);
    try {
      await summarize(
        "manual",
        text,
        { lowConfidence: [], unreadable: [] },
        performance.now(),
        { engine: null, pieceMs: [] },
      );
    } finally {
      setBusy(false);
    }
  }

  const medianEngineMs = (() => {
    const values = (timing?.pieceMs ?? [])
      .map((piece) => piece.engine)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : null;
  })();

  return (
    <div className="info-summary">
      <p className="status-region info-summary__status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
      <label className="info-summary__upload">
        상세 이미지 올리기
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void handleFiles(files);
          }}
        />
      </label>
      <button
        type="button"
        className="big-button big-button--secondary"
        aria-expanded={manualOpen}
        onClick={() => {
          setManualOpen(true);
          setFocusTarget("manual");
        }}
      >
        텍스트 직접 입력
      </button>
      {notice && <p className="info-summary__notice">{notice}</p>}
      {manualOpen && (
        <form className="info-summary__manual" onSubmit={handleManual}>
          <label htmlFor="info-summary-manual">상세 내용</label>
          <textarea
            id="info-summary-manual"
            ref={manualRef}
            rows={6}
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
          />
          <button type="submit" className="big-button" disabled={busy}>
            이 글로 요약
          </button>
        </form>
      )}
      {draft && (
        <section className="info-summary__draft" aria-labelledby="info-summary-draft-title">
          <h3 id="info-summary-draft-title" ref={draftHeadingRef} tabIndex={-1}>
            요약 초안
          </h3>
          <ul className="info-summary__fields">
            {draft.fields.map((field) => (
              <li key={field.key} data-check={field.check}>
                <span className="info-summary__label">{field.label}</span>
                <span className="info-summary__value">{fieldValue(field)}</span>
                <span className="info-summary__needs-check">
                  {field.needsCheck ? "확인 필요" : "확인 필요 없음"}
                </span>
                {field.evidence && (
                  <details>
                    <summary>근거 보기</summary>
                    <p>{field.evidence}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {draft.unreadable.length > 0 && (
            <p>
              글자를 못 읽은 조각: {draft.unreadable.map((index) => index + 1).join(", ")}번
            </p>
          )}
        </section>
      )}
      {timing && (
        <p className="info-summary__timing">
          올리기부터 초안까지 {(timing.totalMs / 1000).toFixed(1)}초
          {timing.engine && ` · 글자 읽기 ${timing.engine}`}
          {timing.pieceMs.length > 0 &&
            ` · 조각 ${timing.pieceMs.length}개, 엔진 ms 중앙값 ${medianEngineMs ?? "-"}, 왕복 ms ${timing.pieceMs
              .map((piece) => piece.roundTrip)
              .join("/")}`}
          {` · 요약 llm ${timing.llmMs ?? "-"}ms`}
        </p>
      )}
    </div>
  );
}
