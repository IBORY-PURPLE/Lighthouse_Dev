import { Icon } from "./Icon";
import { imageSearchUrl, isHttpsUrl, type ProductView } from "@/lib/researchChatView";

/**
 * 같이 고민한 제품 카드(질문 4). 이름·특징·"AI 제안"(점선), [같이 고민했어요](최대 2),
 * [공식 페이지](검색 인용 주소), [사진 보기](새 탭 이미지 검색). 제품 사진은 서버가 가져오지 않는다.
 */
export function ProductCards({
  items,
  picked,
  maxPicks,
  locked,
  noneLabel,
  ownLabel,
  onPick,
  onNone,
  onOwn,
}: {
  items: ProductView[];
  picked: string[];
  maxPicks: number;
  /** 같이 고민한 제품 칸을 건너뛰었다. */
  locked: boolean;
  noneLabel: string;
  ownLabel: string;
  onPick: (name: string) => void;
  onNone: () => void;
  onOwn: () => void;
}) {
  const full = picked.length >= maxPicks;
  return (
    <div className="vc-products">
      <ul className="vc-cards" aria-label="웹에서 찾은 관련 제품">
        {items.map((item) => {
          const chosen = picked.includes(item.name);
          const blocked = locked || (full && !chosen);
          return (
            <li key={item.name} className={`vc-card vc-card--product${chosen ? " is-picked" : ""}`}>
              <div className="vc-card-photo">
                <Icon name="headset" />
                <span className="vc-card-photo-note">제품 사진은 링크로 봐요</span>
                <span className={`vc-tag${chosen ? " vc-tag--ink" : ""}`}>{chosen ? "봉사자가 고름" : "AI 제안"}</span>
              </div>
              <p className="vc-card-name">{item.name}</p>
              {item.feature && <p className="vc-card-feature">{item.feature}</p>}
              <div className="vc-card-actions">
                <button
                  type="button"
                  className={`vc-btn vc-btn--small${chosen ? " vc-btn--ink" : ""}`}
                  aria-disabled={blocked || chosen ? true : undefined}
                  onClick={() => {
                    if (!blocked && !chosen) onPick(item.name);
                  }}
                >
                  {chosen ? "같이 고민함" : "같이 고민했어요"}
                  <span className="vol-sr"> {item.name}</span>
                </button>
                {isHttpsUrl(item.pageUrl) && (
                  <a className="vc-btn vc-btn--small" href={item.pageUrl} target="_blank" rel="noopener noreferrer">
                    공식 페이지<span className="vol-sr"> {item.name}, 새 탭</span>
                  </a>
                )}
                <a className="vc-btn vc-btn--small" href={imageSearchUrl(item.name)} target="_blank" rel="noopener noreferrer">
                  사진 보기<span className="vol-sr"> {item.name}, 새 탭</span>
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="vc-chips-row">
        <button
          type="button"
          className="vc-chip"
          aria-disabled={locked ? true : undefined}
          onClick={() => {
            if (!locked) onNone();
          }}
        >
          {noneLabel}
        </button>
        <button
          type="button"
          className="vc-chip"
          onClick={onOwn}
        >
          {ownLabel}
        </button>
      </div>
    </div>
  );
}
