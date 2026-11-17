import { useCallback, useEffect, useState } from "react";
import { fitToWidth, readPanels, writePanels, type PanelState, type WidthClass } from "./panelPrefs";

const WIDE_QUERY = "(min-width: 1180px)";

/** 1180px 이상이면 창이 대화 옆에 붙고, 그 아래면 대화 위에 겹친다. */
export function isWideScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches;
}

interface Stored extends PanelState {
  cls: WidthClass;
}

function initial(forceMine: boolean): Stored {
  const cls: WidthClass = isWideScreen() ? "wide" : "narrow";
  const stored = fitToWidth(cls, readPanels(cls));
  return { cls, mine: forceMine || stored.mine, slots: forceMine && cls === "narrow" ? false : stored.slots };
}

/**
 * 왼쪽 창(대기열·내 담당)과 오른쪽 창(모은 정보)의 열림.
 * - 폭 구분(wide ≥1180, narrow ≤1179)마다 기기에 기억한다(`lh.vol.panels.v1`). 기본값은 wide 둘 다 열림, narrow 둘 다 닫힘.
 * - narrow에서는 한쪽을 열면 다른 쪽이 닫힌다(겹치는 창이라 하나만).
 * - 히어로(맡은 직후)의 오른쪽 창은 닫힌 채 시작하고 저장값을 쓰지도 바꾸지도 않는다.
 * - setMine·setSlots의 remember가 false면(명령·안내 때문에 저절로 열 때) 저장하지 않는다.
 * 이 훅은 브라우저에서만 그려지는 화면(입장 확인과 요청 읽기가 끝난 뒤)이 쓴다.
 */
export function usePanels({ hero, forceMine = false }: { hero: boolean; forceMine?: boolean }) {
  const [state, setState] = useState<Stored>(() => initial(forceMine));
  const [heroSlots, setHeroSlots] = useState(false);

  // 폭 구분이 바뀌면(창 크기·기기 회전) 그 구분의 기억을 읽는다.
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      const cls: WidthClass = query.matches ? "wide" : "narrow";
      setState((prev) => (prev.cls === cls ? prev : { cls, ...fitToWidth(cls, readPanels(cls)) }));
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setMine = useCallback(
    (open: boolean, remember = true) => {
      const narrow = state.cls === "narrow";
      const next: Stored = { ...state, mine: open, slots: open && narrow ? false : state.slots };
      setState(next);
      if (open && narrow) setHeroSlots(false);
      // 히어로에서는 오른쪽 창의 기억값을 바꾸지 않는다(그리는 값이 아니라 저장된 값을 그대로 다시 쓴다).
      if (remember) writePanels(state.cls, { mine: next.mine, slots: hero ? readPanels(state.cls).slots : next.slots });
    },
    [state, hero],
  );

  const setSlots = useCallback(
    (open: boolean, remember = true) => {
      const narrow = state.cls === "narrow";
      if (hero) {
        setHeroSlots(open);
        // 겹치는 창이라 왼쪽 창을 닫는다. 히어로는 저장값을 바꾸지 않는다.
        if (open && narrow) setState({ ...state, mine: false });
        return;
      }
      const next: Stored = { ...state, slots: open, mine: open && narrow ? false : state.mine };
      setState(next);
      if (remember) writePanels(state.cls, { mine: next.mine, slots: next.slots });
    },
    [state, hero],
  );

  const slotsOpen = hero ? heroSlots : state.slots;
  return {
    wide: state.cls === "wide",
    mineOpen: state.mine,
    slotsOpen,
    setMine,
    setSlots,
    toggleMine: () => setMine(!state.mine),
    toggleSlots: () => setSlots(!slotsOpen),
  };
}

export type Panels = ReturnType<typeof usePanels>;
