// 길게 누르기 판정기 시험. 설계서 8.1절, 16.1절.
import { describe, expect, it } from "vitest";
import {
  GESTURE_IDLE,
  HOLD_CLICK_SUPPRESS_MS,
  HOLD_LATCH_MS,
  HOLD_MOVE_PX,
  HOLD_MS,
  gestureStep,
  type GestureInput,
  type GestureOutput,
  type GestureState,
} from "@/lib/liveGesture";

const down = (over: Partial<Extract<GestureInput, { type: "down" }>> = {}): GestureInput => ({
  type: "down", id: 1, x: 100, y: 100, t: 0, primary: true, onControl: false, ...over,
});

/** 입력을 차례로 넣고 마지막 상태와 모든 결과를 돌려준다. */
function run(inputs: GestureInput[], from: GestureState = GESTURE_IDLE) {
  let state = from;
  const outs: GestureOutput[] = [];
  for (const i of inputs) {
    const r = gestureStep(state, i);
    state = r.state;
    outs.push(r.out);
  }
  return { state, outs };
}

/** 600ms에 발동한 상태. */
const ACTIVE = run([down(), { type: "tick", t: HOLD_MS }]).state;

describe("liveGesture 상수", () => {
  it("설계서 값과 같다", () => {
    expect(HOLD_MS).toBe(600);
    expect(HOLD_MOVE_PX).toBe(24);
    expect(HOLD_LATCH_MS).toBe(800);
    expect(HOLD_CLICK_SUPPRESS_MS).toBe(700);
  });
});

describe("gestureStep 발동 전", () => {
  it("down은 pressing으로 가고 아무 결과가 없다", () => {
    const r = gestureStep(GESTURE_IDLE, down({ t: 10 }));
    expect(r.out).toBe("none");
    expect(r.state).toMatchObject({ phase: "pressing", id: 1, x0: 100, y0: 100, downAt: 10 });
  });

  it("599ms에 떼면 none이고 idle로 돌아온다", () => {
    const { state, outs } = run([down(), { type: "up", id: 1, t: 599 }]);
    expect(outs).toEqual(["none", "none"]);
    expect(state.phase).toBe("idle");
  });

  it("599ms tick은 발동하지 않는다", () => {
    const { state, outs } = run([down(), { type: "tick", t: 599 }]);
    expect(outs).toEqual(["none", "none"]);
    expect(state.phase).toBe("pressing");
  });

  it("600ms tick은 activate", () => {
    const { state, outs } = run([down(), { type: "tick", t: 600 }]);
    expect(outs).toEqual(["none", "activate"]);
    expect(state).toMatchObject({ phase: "active", activeAt: 600 });
  });

  it("down 시각이 0이 아니어도 down 기준 600ms다", () => {
    const { outs } = run([down({ t: 1000 }), { type: "tick", t: 1599 }, { type: "tick", t: 1600 }]);
    expect(outs).toEqual(["none", "none", "activate"]);
  });

  it("idle이나 active에서 tick은 아무 일도 없다", () => {
    expect(gestureStep(GESTURE_IDLE, { type: "tick", t: 5000 }).out).toBe("none");
    const r = gestureStep(ACTIVE, { type: "tick", t: 5000 });
    expect(r.out).toBe("none");
    expect(r.state).toBe(ACTIVE);
  });

  it("25px 움직이면 조용히 idle(none)", () => {
    const { state, outs } = run([down(), { type: "move", id: 1, x: 125, y: 100, t: 100 }]);
    expect(outs).toEqual(["none", "none"]);
    expect(state.phase).toBe("idle");
  });

  it("24px까지는 유지한다", () => {
    const { state, outs } = run([
      down(),
      { type: "move", id: 1, x: 124, y: 100, t: 100 },
      { type: "tick", t: 600 },
    ]);
    expect(outs).toEqual(["none", "none", "activate"]);
    expect(state.phase).toBe("active");
  });

  it("대각선도 거리로 잰다(18,18은 약 25.5px)", () => {
    const { state } = run([down(), { type: "move", id: 1, x: 118, y: 118, t: 100 }]);
    expect(state.phase).toBe("idle");
  });

  it("움직여서 idle이 된 뒤 tick은 발동하지 않는다", () => {
    const { outs } = run([down(), { type: "move", id: 1, x: 200, y: 100, t: 100 }, { type: "tick", t: 600 }]);
    expect(outs).toEqual(["none", "none", "none"]);
  });

  it("발동 전 pointercancel은 none", () => {
    const { state, outs } = run([down(), { type: "cancel", id: 1, t: 100 }]);
    expect(outs).toEqual(["none", "none"]);
    expect(state.phase).toBe("idle");
  });

  it("발동 전 두 번째 포인터는 조용히 취소", () => {
    const { state, outs } = run([down(), down({ id: 2, primary: false, t: 50 })]);
    expect(outs).toEqual(["none", "none"]);
    expect(state.phase).toBe("idle");
  });
});

describe("gestureStep 발동 뒤", () => {
  it("발동 순간 suppressClickUntil은 t + 700", () => {
    expect(ACTIVE.suppressClickUntil).toBe(600 + HOLD_CLICK_SUPPRESS_MS);
  });

  it("발동 뒤 800ms에 떼면 latch", () => {
    const r = gestureStep(ACTIVE, { type: "up", id: 1, t: 600 + 800 });
    expect(r.out).toBe("latch");
    expect(r.state.phase).toBe("idle");
  });

  it("발동 뒤 801ms에 떼면 submit", () => {
    const r = gestureStep(ACTIVE, { type: "up", id: 1, t: 600 + 801 });
    expect(r.out).toBe("submit");
    expect(r.state.phase).toBe("idle");
  });

  it("발동 직후(0ms) 떼면 latch", () => {
    expect(gestureStep(ACTIVE, { type: "up", id: 1, t: 600 }).out).toBe("latch");
  });

  it("떼도 click을 버리는 시각은 남고, 오래 눌렀다 떼면 뗀 시각부터 다시 700ms다", () => {
    const quick = gestureStep(ACTIVE, { type: "up", id: 1, t: 700 }).state;
    expect(quick.suppressClickUntil).toBe(1400);
    const long = gestureStep(ACTIVE, { type: "up", id: 1, t: 3000 }).state;
    expect(long.suppressClickUntil).toBe(3700);
  });

  it("발동 뒤 24px는 유지, 25px는 cancel", () => {
    expect(gestureStep(ACTIVE, { type: "move", id: 1, x: 124, y: 100, t: 700 }).out).toBe("none");
    const r = gestureStep(ACTIVE, { type: "move", id: 1, x: 100, y: 125, t: 700 });
    expect(r.out).toBe("cancel");
    expect(r.state.phase).toBe("idle");
    expect(r.state.suppressClickUntil).toBe(1300);   // 취소해도 발동 때의 값은 이어 간다
  });

  it("발동 뒤 pointercancel은 cancel", () => {
    const r = gestureStep(ACTIVE, { type: "cancel", id: 1, t: 700 });
    expect(r.out).toBe("cancel");
    expect(r.state.phase).toBe("idle");
  });

  it("발동 뒤 두 번째 포인터는 cancel", () => {
    const r = gestureStep(ACTIVE, down({ id: 2, primary: false, t: 700 }));
    expect(r.out).toBe("cancel");
    expect(r.state.phase).toBe("idle");
  });

  it("발동 뒤 두 번째 포인터가 단추 위에 닿아도 cancel", () => {
    expect(gestureStep(ACTIVE, down({ id: 2, onControl: true, t: 700 })).out).toBe("cancel");
  });

  it("취소 뒤에 같은 포인터의 up은 아무 일도 없다", () => {
    const { outs } = run([down(), { type: "tick", t: 600 }, { type: "cancel", id: 1, t: 700 }, { type: "up", id: 1, t: 900 }]);
    expect(outs).toEqual(["none", "activate", "cancel", "none"]);
  });

  it("다른 id의 move·up·cancel은 무시한다", () => {
    for (const i of [
      { type: "move", id: 2, x: 500, y: 500, t: 700 },
      { type: "up", id: 2, t: 700 },
      { type: "cancel", id: 2, t: 700 },
    ] as GestureInput[]) {
      const r = gestureStep(ACTIVE, i);
      expect(r.out).toBe("none");
      expect(r.state).toBe(ACTIVE);
    }
  });

  it("같은 id의 down이 되풀이돼도 무시한다", () => {
    const r = gestureStep(ACTIVE, down({ t: 700 }));
    expect(r.out).toBe("none");
    expect(r.state).toBe(ACTIVE);
  });
});

describe("gestureStep 무시하는 down", () => {
  it("primary가 아니면 pressing으로 가지 않는다", () => {
    const r = gestureStep(GESTURE_IDLE, down({ primary: false }));
    expect(r.out).toBe("none");
    expect(r.state).toBe(GESTURE_IDLE);
  });

  it("onControl이면 pressing으로 가지 않는다", () => {
    const r = gestureStep(GESTURE_IDLE, down({ onControl: true }));
    expect(r.out).toBe("none");
    expect(r.state).toBe(GESTURE_IDLE);
  });

  it("무시한 down 뒤의 tick은 발동하지 않는다", () => {
    const { outs } = run([down({ onControl: true }), { type: "tick", t: 600 }]);
    expect(outs).toEqual(["none", "none"]);
  });

  it("idle에서 move·up·cancel은 아무 일도 없다", () => {
    for (const i of [
      { type: "move", id: 1, x: 999, y: 999, t: 1 },
      { type: "up", id: 1, t: 1 },
      { type: "cancel", id: 1, t: 1 },
    ] as GestureInput[]) {
      const r = gestureStep(GESTURE_IDLE, i);
      expect(r.out).toBe("none");
      expect(r.state).toBe(GESTURE_IDLE);
    }
  });
});

describe("gestureStep 이어 누르기", () => {
  it("한 번 발동한 뒤 다시 눌러 발동할 수 있고 click 무시 시각이 새로 정해진다", () => {
    const first = run([down(), { type: "tick", t: 600 }, { type: "up", id: 1, t: 700 }]);
    expect(first.outs).toEqual(["none", "activate", "latch"]);
    const second = run([down({ t: 2000 }), { type: "tick", t: 2600 }], first.state);
    expect(second.outs).toEqual(["none", "activate"]);
    expect(second.state.suppressClickUntil).toBe(2600 + HOLD_CLICK_SUPPRESS_MS);
  });

  it("발동 전에 떼면 이전 click 무시 시각을 지우지 않는다", () => {
    const first = run([down(), { type: "tick", t: 600 }, { type: "up", id: 1, t: 700 }]);
    const r = run([down({ t: 1500 }), { type: "up", id: 1, t: 1600 }], first.state);
    expect(r.state.suppressClickUntil).toBe(first.state.suppressClickUntil);
  });

  it("입력 상태를 바꾸지 않는다(순수 함수)", () => {
    const before = JSON.stringify(ACTIVE);
    gestureStep(ACTIVE, { type: "up", id: 1, t: 5000 });
    expect(JSON.stringify(ACTIVE)).toBe(before);
  });
});
