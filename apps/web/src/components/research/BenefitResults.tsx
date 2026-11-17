import { Icon } from "./Icon";
import { hostOf, isHttpsUrl, type BenefitItem } from "@/lib/researchChatView";

/**
 * 혜택 묶음(질문 6). 종류별 카드에 [열기] [확인했어요]와 "봉사자 경험과 비교" 한 줄을 둔다.
 * 금액은 카드에 없다("할인 금액은 링크에서 확인해요"). AI가 열 수 없는 사이트는 "직접 확인 필요"로 따로 표시한다.
 * [확인했어요]를 누른 카드만 리뷰와 결과에 들어간다.
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
  return (
    <ul className="vc-cards vc-cards--benefits" aria-label="찾은 혜택">
      {items.map((item) => {
        const done = checked.has(item.url);
        const manual = item.mode === "check";
        return (
          <li key={item.id} className={`vc-card vc-card--benefit${manual ? " is-manual" : ""}${done ? " is-done" : ""}`}>
            <div className="vc-card-top">
              <span className="vc-source">
                출처 · {item.kind || hostOf(item.url)}
              </span>
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
                  if (!done) onCheck(item);
                }}
              >
                확인했어요<span className="vol-sr"> {item.title}</span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
