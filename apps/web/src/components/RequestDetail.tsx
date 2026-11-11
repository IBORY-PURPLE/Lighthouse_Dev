"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusRegion } from "@/components/StatusRegion";
import {
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
} from "@/lib/volunteerView";

type Load =
  | { kind: "loading" }
  | { kind: "ok"; detail: DetailResponse }
  | { kind: "denied" }
  | { kind: "failed"; message: string };

/** 화면 3(이번 블록은 요청 요약과 내려놓기까지): 맡은 요청의 상세, 또는 보낸 요청의 읽기 전용 보기. */
export function RequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
  const loaded = load.kind !== "loading";
  useEffect(() => {
    if (loaded) headingRef.current?.focus();
  }, [loaded]);

  const handleRelease = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const outcome = await releaseRequest(requestId);
    if (outcome.kind === "released") {
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
    const inProgress = request.status === "in_progress";
    return (
      <div className="vol-root">
        <main className="vol-page vol-page--plain">
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
            <Link href="/volunteer" className="vol-back" aria-label="목록으로">
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
