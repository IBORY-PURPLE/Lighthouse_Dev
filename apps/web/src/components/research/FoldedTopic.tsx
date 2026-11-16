import { Icon } from "./Icon";

/** 끝난 질문을 한 줄로 접은 표시. [펼치기]로 지난 대화를 다시 본다. */
export function FoldedTopic({
  summary,
  open,
  controls,
  onToggle,
}: {
  summary: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <div className="vc-folded">
      <Icon name="check" />
      <p className="vc-folded-text">{summary}</p>
      <button type="button" className="vc-folded-btn" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
        {open ? "접기" : "펼치기"}
      </button>
    </div>
  );
}
