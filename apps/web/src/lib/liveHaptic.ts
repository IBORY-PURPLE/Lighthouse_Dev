// /live 진동 신호. 띵 소리가 안 들릴 때가 있어(2026-11-25 이용자 실기기 확인) 말할 차례와 말이 넘어간 때를 진동으로도 알린다.
// - 안드로이드 Chrome 등: navigator.vibrate.
// - 아이폰 Safari: 웹 진동 API가 없다. iOS 17.4부터 있는 스위치 입력(<input type="checkbox" switch>)은 켜고 끌 때 가볍게 톡 친다.
//   그 이름표를 코드로 누르는 방법을 쓴다. 사람이 누르지 않은 때에도 되는지는 실기기에서 확인하지 못했다. 안 되면 아무 일도 없다.
// 실패는 모두 조용히 넘어간다(대화를 막지 않는다).

export type HapticName = "turn" | "sent";

/** 진동 길이(ms). turn: 한 번, sent: 짧게 두 번. */
const PATTERNS: Record<HapticName, number[]> = { turn: [150], sent: [60, 90, 60] };
const IOS_SECOND_TICK_MS = 150;

export function createHaptic(doc: Document, win: Window): (name: HapticName) => void {
  const record = (name: HapticName) => {
    const w = win as unknown as { __lhHapticLog?: string[] };
    if (!Array.isArray(w.__lhHapticLog)) w.__lhHapticLog = [];
    w.__lhHapticLog.push(name);
  };

  const iosTick = () => {
    try {
      const label = doc.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.display = "none";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      label.appendChild(input);
      doc.head.appendChild(label);
      label.click();
      doc.head.removeChild(label);
    } catch {
      /* 무시 */
    }
  };

  return (name) => {
    record(name);
    try {
      const nav = win.navigator as Navigator & { vibrate?: (pattern: number[]) => boolean };
      if (typeof nav.vibrate === "function") {
        nav.vibrate(PATTERNS[name]);
        return;
      }
    } catch {
      /* 아래 방법으로 넘어간다 */
    }
    iosTick();
    if (name === "sent") win.setTimeout(iosTick, IOS_SECOND_TICK_MS);
  };
}
