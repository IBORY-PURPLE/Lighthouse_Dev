"use client";

import { useEffect, useRef, useState } from "react";
import type { BriefStep } from "@/lib/volunteerView";

/**
 * 이용자 요청 브리핑: 봉사자가 구매 여부를 고른 뒤 기종 질문 전에 이용자가 말한 요청을 한 장씩 확인한다.
 * 연 장은 쌓아 보이고(앞 장을 다시 읽을 수 있다), [다음]으로 한 장씩 열거나 [한 번에 모두 보기]로 다 연다.
 * 마지막 장에서 [다 봤어요 · 질문 이어 가기]를 누르면 onDone을 부르고, 그 뒤에는 버튼 없이 전부 펼쳐 대화 기록에 남는다.
 * 장마다 제목이 초점을 받고(tabIndex -1), 진행은 "이용자 요청 k/n"으로 읽어 준다(role=status 대신 aria-live).
 */
export function RequestBrief({
  steps,
  done,
  onDone,
}: {
  steps: BriefStep[];
  done: boolean;
  onDone: () => void;
}) {
  const [opened, setOpened] = useState(1);
  const titles = useRef<(HTMLHeadingElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);
  const count = steps.length;
  const shown = done ? count : Math.min(opened, count);

  // 사용자가 [다음]·[한 번에 모두 보기]를 눌러 새로 열린 장의 제목으로 초점을 옮긴다(처음 그릴 때는 옮기지 않는다).
  useEffect(() => {
    const index = focusIndex.current;
    if (index === null) return;
    focusIndex.current = null;
    const title = titles.current[index];
    if (!title) return;
    // 새 장이 입력창 묶음에 가려지지 않고 그 아래 [다음] 버튼까지 보이게 장을 위쪽에 맞춘다.
    title.focus({ preventScroll: true });
    title.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [opened]);

  if (count === 0) return null;

  const next = () => {
    if (shown >= count) return;
    focusIndex.current = shown;
    setOpened(shown + 1);
  };
  const openAll = () => {
    if (shown >= count) return;
    focusIndex.current = shown;
    setOpened(count);
  };

  return (
    <section className="vc-brief" aria-label="이용자 요청 확인" data-testid="request-brief" data-done={done ? "true" : "false"}>
      <ol className="vc-brief-list">
        {steps.slice(0, shown).map((step, index) => (
          <li key={step.key} className="vc-card vc-brief-card vc-enter" data-testid="brief-card">
            <h3
              ref={(element) => {
                titles.current[index] = element;
              }}
              tabIndex={-1}
              className="vc-brief-title"
            >
              {step.title}
            </h3>
            <dl className="vc-brief-lines">
              {step.lines.map((line) => (
                <div key={line.label} className="vc-brief-line">
                  <dt>{line.label}</dt>
                  <dd>{line.text}</dd>
                </div>
              ))}
            </dl>
            {step.note && <p className="vc-brief-note">{step.note}</p>}
          </li>
        ))}
      </ol>
      {!done && (
        <>
          <p className="vc-brief-count" aria-live="polite">
            이용자 요청 {shown}/{count}
          </p>
          <div className="vc-brief-actions">
            {shown < count ? (
              <>
                <button type="button" className="vc-btn vc-btn--ink" onClick={next}>
                  다음
                </button>
                <button type="button" className="vc-btn" onClick={openAll}>
                  한 번에 모두 보기
                </button>
              </>
            ) : (
              <button type="button" className="vc-btn vc-btn--ink" onClick={onDone}>
                다 봤어요 · 질문 이어 가기
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
