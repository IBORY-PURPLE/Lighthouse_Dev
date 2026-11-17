"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type Ref } from "react";
import { Icon } from "./Icon";
import { MessageBubble } from "./MessageBubble";
import { BrandTitle } from "../BrandTitle";
import { readSentHistory } from "@/lib/sentHistory";
import {
  formatSentAt,
  sentModelOf,
  sentReviewOf,
  type SentResult,
  type VolunteerRequestView,
} from "@/lib/volunteerView";

/** 보낸 요청의 위 막대: 뒤로(첫 화면) · 서비스 이름 · 완료 표시 · 왼쪽 창 버튼. 모은 정보·내려놓기는 없다. */
export function SentTopBar({
  request,
  headingRef,
}: {
  request: VolunteerRequestView;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="vc-topbar">
      <Link href="/volunteer" className="vc-back" aria-label="첫 화면으로">
        <Icon name="back" />
      </Link>
      <BrandTitle ref={headingRef} context={`리서치 챗 · ${request.product}`} />
      <span className="vh-spacer" />
      <span className="vc-tag vc-tag--ink">완료</span>
    </header>
  );
}

/**
 * 보낸 요청의 본문(읽기 전용). "보냈어요" 말풍선, 보낸 리뷰 문단과 보낸 시각을 보인다. 입력창과 빠른 답은 없다.
 * 보낸 뒤 이 화면에 머물 때도, 왼쪽 창의 완료 항목이나 옛 주소로 다시 열 때도 같은 모양이다.
 * 대화 글은 보낼 때 서버가 지우므로 새로 저장하지도 읽어 오지도 않는다. 값은 요청 상세의 result 하나다.
 */
export function SentMain({ requestId, result }: { requestId: string; result: SentResult }) {
  // 이 기기에 남긴 대화 이력(보낸 그 기기에서만, 30일). 브라우저에서만 그려지는 화면이라 처음 값을 바로 읽는다.
  const [history] = useState(() => readSentHistory(requestId));
  const [historyOpen, setHistoryOpen] = useState(false);
  const regionRef = useRef<HTMLElement>(null);
  const review = sentReviewOf(result);
  const model = sentModelOf(result);
  const sentAt = formatSentAt(result.sentAt);

  // 열면 보낸 리뷰로 초점을 옮겨 낭독이 거기서 시작하게 한다(다른 곳에 초점이 있으면 건드리지 않는다).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) regionRef.current?.focus();
  }, []);

  return (
    <main className="vc-main">
      <div className="vc-scroll">
        <div className="vc-log" role="log" aria-label="대화" data-testid="sent-log">
          <MessageBubble role="ai" text="이용자에게 보냈어요. 이 요청은 끝났어요." />
          <section
            ref={regionRef}
            tabIndex={-1}
            className="vc-card vc-card--review vc-card--sent"
            aria-label="보낸 리뷰"
            data-testid="sent-review"
          >
            <div className="vc-review-tags">
              <span className="vc-tag vc-tag--ink">전달 완료</span>
              <span className="vc-tag" data-testid="sent-at">
                보낸 시각 {sentAt}
              </span>
            </div>
            {model && (
              <p className="vc-review-hint" data-testid="sent-model">
                기종 <strong>{model}</strong>
              </p>
            )}
            <p className="vc-review-body" data-testid="sent-body">
              {review ?? "보낸 리뷰 문단이 남아 있지 않아요."}
            </p>
            <p className="vc-review-hint">이용자에게 전해진 문단이에요. 읽기만 할 수 있어요.</p>
          </section>
          <div className="vc-history" data-testid="sent-history">
            {history ? (
              <button
                type="button"
                className="vc-btn vc-btn--small"
                aria-expanded={historyOpen}
                aria-controls="vc-history-list"
                onClick={() => setHistoryOpen((open) => !open)}
              >
                {historyOpen ? "대화 이력 접기" : `대화 이력 보기 (${history.length})`}
              </button>
            ) : (
              <p className="vc-review-hint">이 기기에는 대화 이력이 없어요. 보낸 기기에서 30일 동안 볼 수 있어요.</p>
            )}
          </div>
          {history && historyOpen && (
            <div id="vc-history-list" className="vc-history-list" role="group" aria-label="대화 이력">
              {history.map((line, index) => (
                <MessageBubble
                  key={index}
                  role={line.role}
                  tag={line.chip ? { chip: line.chip, note: line.note ?? "" } : null}
                  text={line.text}
                />
              ))}
              <p className="vc-review-hint">이 기기에만 남은 기록이에요. 보낸 날부터 30일 뒤 지워져요.</p>
            </div>
          )}
        </div>
      </div>
      <div className="vc-dock">
        <p className="vc-hero-note">새 요청은 왼쪽 창의 대기열에서 맡을 수 있어요.</p>
      </div>
    </main>
  );
}
