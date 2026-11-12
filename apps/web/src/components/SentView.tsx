"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  formatSentAt,
  quoteOf,
  type SentResult,
  type VolunteerRequestView,
} from "@/lib/volunteerView";

/** 링크를 사람이 읽기 좋게 보인다(%EC… 대신 한글). 주소 자체(href)는 바꾸지 않는다. */
function readableUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** 화면 6: 보낸 요청의 사후 보기(읽기 전용). 이용자가 들음·구매 링크 열음은 서버 값이 없으면 "아직"이다. */
export function SentView({
  request,
  result,
}: {
  request: VolunteerRequestView;
  result: SentResult;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 열면 제목에 초점을 둬서 낭독이 화면 이름부터 시작하게 한다.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, []);

  return (
    <div className="vol-root">
      <main className="vol-page vol-page--plain">
        <header className="vol-topbar">
          <span className="vol-topbar-title">
            <Link href="/volunteer?tab=mine" className="vol-back" aria-label="내 담당 목록으로">
              &lt;
            </Link>
            <h1 ref={headingRef} tabIndex={-1}>
              완료된 요청
            </h1>
          </span>
        </header>

        <section className="vol-summary" aria-label="전달 상태">
          <p className="vol-status-title">전달 완료</p>
          <p className="vol-status-line">보낸 시각 {formatSentAt(result.sentAt)}</p>
          <p className="vol-status-line vol-status-line--strong">
            이용자가 들음 {result.heardAt ? "확인됨" : "아직"}
          </p>
          <p className="vol-status-line vol-status-line--strong">
            구매 링크 열음 {result.linkOpenedAt ? "확인됨" : "아직"}
          </p>
        </section>

        <h2>보낸 내용 (읽기 전용)</h2>
        <section className="vol-sent" aria-label="보낸 내용">
          <p className="vol-summary-label">이용자가 한 말</p>
          <p className="vol-quote">{quoteOf(request.product, request.budget)}</p>
          <p className="vol-summary-label">보낸 후보 {result.candidates.length}개</p>
          <ol className="vol-sent-list">
            {result.candidates.map((candidate, index) => (
              <li key={`${candidate.name}-${candidate.url}`} className="vol-sent-item">
                <p className="vol-sent-name">
                  <span className="vol-sr">후보 {index + 1} </span>
                  {candidate.name}
                </p>
                <p className="vol-summary-label">구매 링크</p>
                <p className="vol-sent-url">
                  <a href={candidate.url} target="_blank" rel="noopener noreferrer">
                    {readableUrl(candidate.url)}
                  </a>
                </p>
                {candidate.guide && (
                  <>
                    <p className="vol-summary-label">핵심 정리</p>
                    <p className="vol-sent-text vol-sent-text--lines">{candidate.guide}</p>
                  </>
                )}
                {candidate.summary.length > 0 && (
                  <>
                    <p className="vol-summary-label">상세 요약</p>
                    <ul className="vol-sent-summary">
                      {candidate.summary.map((entry) => (
                        <li key={`${entry.label}-${entry.value}`}>
                          <span className="vol-sent-key">{entry.label}</span> <span>{entry.value}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="vol-actions">
          <Link href="/volunteer?tab=mine" className="vol-btn vol-btn--secondary vol-btn--block">
            목록으로
          </Link>
        </div>
        <p className="vol-foot">이 기기에서 보낸 요청만 보입니다. 기기를 바꾸면 보이지 않습니다.</p>
      </main>
    </div>
  );
}
