import type { ChipView } from "@/lib/researchChatView";

/** 웹에서 찾은 기종 후보 칩("AI 제안" 점선)과 [직접 적을게요]. 이미 답한 칸이면 눌러도 바뀌지 않는다. */
export function ModelChips({
  caption,
  chips,
  ownLabel,
  disabled,
  onPick,
  onOwn,
}: {
  caption: string;
  chips: ChipView[];
  ownLabel: string;
  disabled: boolean;
  onPick: (chip: ChipView) => void;
  onOwn: () => void;
}) {
  return (
    <div className="vc-chips">
      <p className="vc-chips-caption">{caption}</p>
      <div className="vc-chips-row">
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className="vc-chip vc-chip--ai"
            aria-disabled={disabled ? true : undefined}
            onClick={() => {
              if (!disabled) onPick(chip);
            }}
          >
            {chip.label}
          </button>
        ))}
        <button
          type="button"
          className="vc-chip"
          aria-disabled={disabled ? true : undefined}
          onClick={() => {
            if (!disabled) onOwn();
          }}
        >
          {ownLabel}
        </button>
      </div>
    </div>
  );
}
