import { forwardRef } from "react";

/**
 * 왼쪽 창(대기열·내 담당)을 여닫는 위 막대 맨 왼쪽 아이콘 버튼. 첫 화면·리서치·보낸 요청 화면이 같이 쓴다.
 * 이름은 "대기열·내 담당"으로 고정하고 열림은 aria-expanded로 알린다(Figma 컴포넌트 "Side toggle").
 */
export const SideToggleButton = forwardRef<
  HTMLButtonElement,
  { open: boolean; controls: string; onToggle: () => void; label?: string }
>(function SideToggleButton({ open, controls, onToggle, label = "대기열·내 담당" }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`vc-side-toggle${open ? " is-open" : ""}`}
      aria-label={label}
      aria-expanded={open}
      aria-controls={controls}
      title={open ? "왼쪽 창 닫기" : "왼쪽 창 열기"}
      onClick={onToggle}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9.5 4v16" stroke="currentColor" strokeWidth="1.8" />
        <path className="vc-side-toggle-fill" d="M4.5 6.5a1 1 0 0 1 1-1H8v13H5.5a1 1 0 0 1-1-1z" fill="currentColor" />
      </svg>
    </button>
  );
});
