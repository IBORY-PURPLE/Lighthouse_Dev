"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { hostOf, isHttpsUrl, type BenefitItem } from "@/lib/researchChatView";

/** 혜택 카드 한 장. 출처·AI 제안(직접 확인 필요)·이름·조건·봉사자 경험과 비교, [열기] [확인했어요]. 금액은 없다. */
function BenefitCard({ item, done, onCheck, position }: { item: BenefitItem; done: boolean; onCheck: () => void; position: string }) {
  const manual = item.mode === "check";
  return (
    <div
      className={`vc-card vc-card--benefit${manual ? " is-manual" : ""}${done ? " is-done" : ""}`}
      role="group"
      aria-roledescription="혜택 카드"
      aria-label={`${position} ${item.title}`}
    >
      <div className="vc-card-top">
        <span className="vc-source">출처 · {item.kind || hostOf(item.url)}</span>
        {done ? (
          <span className="vc-tag vc-tag--ink">
            <Icon name="check" size={14} className="vc-tag-icon" />
            확인함
          </span>
        ) : manual ? (
          <span className="vc-tag vc-tag--check">직접 확인 필요</span>
        ) : (
          <span className="vc-tag">AI 제안</span>
        )}
      </div>
      <p className="vc-card-name">{item.title}</p>
      {item.condition && <p className="vc-card-feature">{item.condition}</p>}
      {item.compare && (
        <p className="vc-compare">
          <span className="vc-compare-label">봉사자 경험과 비교</span> {item.compare}
        </p>
      )}
      <p className="vc-card-note">
        {manual ? "AI가 열 수 없는 사이트라 직접 열어 확인해야 해요." : "할인 금액은 링크에서 확인해요."}
      </p>
      <div className="vc-card-actions vc-card-actions--row">
        {isHttpsUrl(item.url) && (
          <a className="vc-btn" href={item.url} target="_blank" rel="noopener noreferrer">
            열기<span className="vol-sr"> {item.title}, 새 탭</span>
          </a>
        )}
        <button
          type="button"
          className={`vc-btn${done ? " vc-btn--ink" : ""}`}
          aria-pressed={done}
          onClick={() => {
            if (!done) onCheck();
          }}
        >
          확인했어요<span className="vol-sr"> {item.title}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * 찾은 혜택(질문 6)을 카드 한 장씩 넘겨 본다. [‹] [›]로 앞뒤 카드가 옆에서 밀려 들어온다(움직임 줄이기면 흐려지며 바뀐다).
 * 아래 줄에 "2 / 3"과 확인한 개수를 보인다. [확인했어요]를 누른 카드만 리뷰와 결과에 들어간다.
 */
export function BenefitResults({
  items,
  checked,
  onCheck,
}: {
  items: BenefitItem[];
  checked: ReadonlySet<string>;
  onCheck: (item: BenefitItem) => void;
}) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const count = items.length;
  if (count === 0) return null;
  const at = Math.min(index, count - 1);
  const item = items[at];
  const doneCount = items.filter((entry) => checked.has(entry.url)).length;
  const go = (step: 1 | -1) => {
    const next = at + step;
    if (next < 0 || next >= count) return;
    setDir(step === 1 ? "next" : "prev");
    setIndex(next);
  };
  const position = `${at + 1} / ${count}`;

  return (
    <section className="vc-benefits" aria-roledescription="넘겨 보기" aria-label="찾은 혜택">
      <div className="vc-benefits-stage">
        <div key={`${item.id}-${at}`} className={`vc-benefits-slide vc-benefits-slide--${dir}`}>
          <BenefitCard item={item} done={checked.has(item.url)} onCheck={() => onCheck(item)} position={position} />
        </div>
      </div>
      <div className="vc-benefits-nav">
        <button
          type="button"
          className="vc-benefits-arrow"
          aria-label="이전 혜택"
          aria-disabled={at === 0 ? true : undefined}
          onClick={() => go(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <p className="vc-benefits-count" aria-live="polite">
          <strong>{position}</strong>
          <span className="vc-benefits-done"> · 확인 {doneCount}개</span>
        </p>
        <button
          type="button"
          className="vc-benefits-arrow vc-benefits-arrow--next"
          aria-label="다음 혜택"
          aria-disabled={at === count - 1 ? true : undefined}
          onClick={() => go(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </section>
  );
}
