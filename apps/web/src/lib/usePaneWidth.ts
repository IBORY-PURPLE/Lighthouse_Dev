import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** 왼쪽 창(대기열·내 담당) 폭. 오른쪽 가장자리를 끌어 바꾸고, 브라우저마다 기억한다. */
export const PANE_WIDTH = { min: 240, max: 520, initial: 300, step: 16 } as const;
const KEY = "lh.vol.paneWidth.v1";

function clampWidth(value: number): number {
  const viewportMax = typeof window === "undefined" ? PANE_WIDTH.max : Math.max(PANE_WIDTH.min, window.innerWidth - 120);
  return Math.round(Math.min(Math.max(value, PANE_WIDTH.min), PANE_WIDTH.max, viewportMax));
}

function readWidth(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? clampWidth(value) : PANE_WIDTH.initial;
  } catch {
    return PANE_WIDTH.initial;
  }
}

function writeWidth(value: number): void {
  try {
    window.localStorage.setItem(KEY, String(value));
  } catch {
    // 저장소가 막혀도 이번 화면에서는 그대로 쓴다.
  }
}

/** 폭을 CSS 변수 --mine-w로 문서 전체에 건다. 창과 대화 칸 왼쪽 여백이 같이 따라간다. */
function apply(value: number): void {
  document.documentElement.style.setProperty("--mine-w", `${value}px`);
}

/**
 * 왼쪽 창 폭 조절 손잡이(role="separator")에 붙일 처리기. 끄는 동안에는 문서에 data-pane-resizing을 달아
 * 미끄러짐 전환을 끈다(손가락을 바로 따라가게). 키보드는 ←/→로 16px, Home/End로 최소·최대, 두 번 누르면 처음 폭.
 */
export function usePaneWidth() {
  // 이 창은 입장 확인 뒤 브라우저에서만 그려지므로 처음 값을 바로 저장소에서 읽는다(서버에서는 처음 폭).
  const [width, setWidth] = useState<number>(() => (typeof window === "undefined" ? PANE_WIDTH.initial : readWidth()));
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    apply(width);
  }, [width]);

  const set = useCallback((value: number, remember = true) => {
    const next = clampWidth(value);
    setWidth(next);
    if (remember) writeWidth(next);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startWidth: width };
      document.documentElement.dataset.paneResizing = "true";
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (!start) return;
      set(start.startWidth + (event.clientX - start.startX), false);
    },
    [set],
  );

  const end = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      delete document.documentElement.dataset.paneResizing;
      writeWidth(clampWidth(width));
    },
    [width],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const moves: Record<string, number> = {
        ArrowLeft: width - PANE_WIDTH.step,
        ArrowRight: width + PANE_WIDTH.step,
        Home: PANE_WIDTH.min,
        End: PANE_WIDTH.max,
      };
      if (!(event.key in moves)) return;
      event.preventDefault();
      set(moves[event.key]);
    },
    [width, set],
  );

  const reset = useCallback(() => set(PANE_WIDTH.initial), [set]);

  return {
    width,
    handleProps: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-orientation": "vertical" as const,
      "aria-label": "왼쪽 창 폭",
      "aria-valuemin": PANE_WIDTH.min,
      "aria-valuemax": PANE_WIDTH.max,
      "aria-valuenow": width,
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown,
      onDoubleClick: reset,
    },
  };
}
