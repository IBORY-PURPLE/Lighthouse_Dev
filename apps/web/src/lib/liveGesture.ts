// /live 길게 누르기 판정기. 포인터 사건을 받아 다음 상태와 결과(activate·latch·submit·cancel)를 낸다. 순수 함수. 설계서 8.1절.
// 시간은 모두 입력의 t(밀리초)로만 잰다. 타이머는 화면이 down 뒤 HOLD_MS에 tick 하나를 넣어 준다.

export const HOLD_MS = 600;                 // 이만큼 누르고 있으면 발동
export const HOLD_MOVE_PX = 24;             // 이보다 많이 움직이면 무효·취소
export const HOLD_LATCH_MS = 800;           // 발동 뒤 이 안에 떼면 "계속 듣기", 넘겨 떼면 "보내기"
export const HOLD_CLICK_SUPPRESS_MS = 700;  // 발동한 누름에서 이어 오는 click을 무시하는 시간

export type GestureInput =
  | { type: "down"; id: number; x: number; y: number; t: number; primary: boolean; onControl: boolean }
  | { type: "move"; id: number; x: number; y: number; t: number }
  | { type: "up"; id: number; t: number }
  | { type: "cancel"; id: number; t: number }
  | { type: "tick"; t: number };            // 화면이 down 뒤 HOLD_MS에 한 번 넣는다
export type GestureOutput = "none" | "activate" | "latch" | "submit" | "cancel";
export interface GestureState {
  phase: "idle" | "pressing" | "active";
  id: number | null; x0: number; y0: number; downAt: number; activeAt: number; suppressClickUntil: number;
}

export const GESTURE_IDLE: GestureState = {
  phase: "idle", id: null, x0: 0, y0: 0, downAt: 0, activeAt: 0, suppressClickUntil: 0,
};

/** 누름을 끝낸 상태. click을 버리는 시각(suppressClickUntil)은 이어 간다. */
function toIdle(s: GestureState, suppressClickUntil = s.suppressClickUntil): GestureState {
  return { ...GESTURE_IDLE, suppressClickUntil };
}

/** 누르던 중에 끊긴 경우의 결과. 발동 전이면 조용히, 발동 뒤면 cancel. */
function abort(s: GestureState): { state: GestureState; out: GestureOutput } {
  return { state: toIdle(s), out: s.phase === "active" ? "cancel" : "none" };
}

export function gestureStep(s: GestureState, i: GestureInput): { state: GestureState; out: GestureOutput } {
  const keep = { state: s, out: "none" as GestureOutput };
  switch (i.type) {
    case "down": {
      if (s.phase !== "idle") {
        // 누르는 중에 다른 포인터가 닿았다(두 번째 손가락). 발동 전이면 조용히, 발동 뒤면 취소.
        return i.id !== s.id ? abort(s) : keep;
      }
      if (!i.primary || i.onControl) return keep;
      return {
        state: { phase: "pressing", id: i.id, x0: i.x, y0: i.y, downAt: i.t, activeAt: 0, suppressClickUntil: s.suppressClickUntil },
        out: "none",
      };
    }
    case "tick": {
      if (s.phase !== "pressing" || i.t - s.downAt < HOLD_MS) return keep;
      return {
        state: { ...s, phase: "active", activeAt: i.t, suppressClickUntil: i.t + HOLD_CLICK_SUPPRESS_MS },
        out: "activate",
      };
    }
    case "move": {
      if (s.phase === "idle" || i.id !== s.id) return keep;
      if (Math.hypot(i.x - s.x0, i.y - s.y0) <= HOLD_MOVE_PX) return keep;
      return abort(s);
    }
    case "up": {
      if (s.phase === "idle" || i.id !== s.id) return keep;
      if (s.phase === "pressing") return { state: toIdle(s), out: "none" };
      // 오래 눌렀다 떼면 click이 발동 700ms 뒤에 올 수 있어, 뗀 시각부터 다시 버린다.
      const suppress = Math.max(s.suppressClickUntil, i.t + HOLD_CLICK_SUPPRESS_MS);
      return { state: toIdle(s, suppress), out: i.t - s.activeAt <= HOLD_LATCH_MS ? "latch" : "submit" };
    }
    case "cancel": {
      if (s.phase === "idle" || i.id !== s.id) return keep;
      return abort(s);
    }
  }
}
