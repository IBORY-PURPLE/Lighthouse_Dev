// /live 진동 신호. 띵 소리가 안 들릴 때가 있어(2026-11-25 이용자 실기기 확인) 말할 차례와 말이 넘어간 때를 진동으로도 알린다.
// - 안드로이드 Chrome 등: navigator.vibrate.
// - 아이폰 Safari: 웹에서 진동을 낼 방법이 없다. 웹 진동 API가 없고, 스위치 입력을 코드로 눌러 햅틱을 내던 방법은
//   WebKit이 사용자 누름 밖에서는 막았으며 iOS 26.5부터는 아예 듣지 않는다(2026-11-25 검토에서 자료 확인). 그래서 아무 일도 하지 않는다.
// 실패는 모두 조용히 넘어간다(대화를 막지 않는다).

export type HapticName = "turn" | "sent";

/** 진동 길이(ms). turn: 한 번, sent: 짧게 두 번. */
const PATTERNS: Record<HapticName, number[]> = { turn: [150], sent: [60, 90, 60] };

export function createHaptic(win: Window): (name: HapticName) => void {
  return (name) => {
    try {
      const nav = win.navigator as Navigator & { vibrate?: (pattern: number[]) => boolean };
      if (typeof nav.vibrate === "function") nav.vibrate(PATTERNS[name]);
    } catch {
      /* 무시 */
    }
  };
}
