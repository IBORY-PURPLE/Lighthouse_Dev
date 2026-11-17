import { Icon } from "./Icon";
import { hostOf, isHttpsUrl } from "@/lib/researchChatView";

/** 봉사자가 붙인 링크(질문 7)나 AI가 열 수 없는 주소. 항상 "직접 확인 필요"이고 [확인했어요]를 눌러야 결과에 들어간다. */
export function LinkCard({
  url,
  note,
  checked,
  onCheck,
}: {
  url: string;
  note: string;
  checked: boolean;
  onCheck: () => void;
}) {
  return (
    <div className={`vc-card vc-card--link is-manual${checked ? " is-done" : ""}`}>
      <div className="vc-card-top">
        <span className="vc-source">출처 · {hostOf(url) || "붙여 넣은 주소"}</span>
        {checked ? (
          <span className="vc-tag vc-tag--ink">
            <Icon name="check" size={14} className="vc-tag-icon" />
            확인함
          </span>
        ) : (
          <span className="vc-tag vc-tag--check">직접 확인 필요</span>
        )}
      </div>
      <p className="vc-card-feature">{note}</p>
      <div className="vc-card-actions vc-card-actions--row">
        {isHttpsUrl(url) && (
          <a className="vc-btn" href={url} target="_blank" rel="noopener noreferrer">
            열기<span className="vol-sr"> {hostOf(url)}, 새 탭</span>
          </a>
        )}
        <button
          type="button"
          className={`vc-btn${checked ? " vc-btn--ink" : ""}`}
          aria-pressed={checked}
          onClick={() => {
            if (!checked) onCheck();
          }}
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}
