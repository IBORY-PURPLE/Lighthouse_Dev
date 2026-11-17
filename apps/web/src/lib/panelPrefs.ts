// 봉사자 화면 두 창(왼쪽 "대기열·내 담당", 오른쪽 "모은 정보")의 열림을 기기에 기억한다. 읽기·쓰기가 막혀도 기본값으로 그린다.

export const PANELS_KEY = "lh.vol.panels.v1";

/** wide = 1180px 이상, narrow = 1179px 이하. 폭 구분마다 따로 기억한다. */
export type WidthClass = "wide" | "narrow";

export interface PanelState {
  /** 왼쪽 창(대기열·내 담당). */
  mine: boolean;
  /** 오른쪽 창(모은 정보). */
  slots: boolean;
}

/** wide는 둘 다 열림, narrow는 둘 다 닫힘. */
export function defaultPanels(widthClass: WidthClass): PanelState {
  return widthClass === "wide" ? { mine: true, slots: true } : { mine: false, slots: false };
}

function readAll(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(PANELS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 저장된 값. 없거나 망가졌거나 저장소를 못 읽으면 칸마다 기본값. */
export function readPanels(widthClass: WidthClass): PanelState {
  const fallback = defaultPanels(widthClass);
  const entry = readAll()[widthClass];
  if (!entry || typeof entry !== "object") return fallback;
  const { mine, slots } = entry as Record<string, unknown>;
  return {
    mine: typeof mine === "boolean" ? mine : fallback.mine,
    slots: typeof slots === "boolean" ? slots : fallback.slots,
  };
}

/** 이 폭 구분의 값만 바꾸고 다른 폭 구분의 값은 그대로 둔다. 쓰지 못해도 조용히 넘어간다. */
export function writePanels(widthClass: WidthClass, state: PanelState): void {
  try {
    const all = readAll();
    all[widthClass] = { mine: state.mine, slots: state.slots };
    window.localStorage.setItem(PANELS_KEY, JSON.stringify(all));
  } catch {
    // 기억하지 못할 뿐 화면은 돌아간다.
  }
}

/**
 * 화면에 그릴 값. narrow(겹치는 창)에서는 두 창이 함께 열릴 수 없으므로, 기억된 값이 둘 다 열림이면 왼쪽 창만 남긴다.
 * (히어로에서 왼쪽 창을 열면 오른쪽 창의 기억값은 건드리지 않아 둘 다 true인 값이 저장될 수 있다.)
 */
export function fitToWidth(widthClass: WidthClass, state: PanelState): PanelState {
  return widthClass === "narrow" && state.mine && state.slots ? { mine: true, slots: false } : state;
}
