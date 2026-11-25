// 신호음 시험: 사양 표, WAV 머리, 재생기(가짜 document). 설계서 9절, 16.1절.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EARCONS,
  EARCON_SAMPLE_RATE,
  WAIT_PULSE_MS,
  createEarconPlayer,
  earconDurationMs,
  synthEarcon,
  toDataUri,
  toWav,
} from "@/lib/liveEarcons";
import type { EarconName } from "@/lib/liveEngine";

const NAMES: EarconName[] = ["start", "turn", "sent", "wait", "confirm", "done", "error", "pause", "end", "cancel"];
const DURATIONS: Record<EarconName, number> = {
  start: 180, turn: 120, sent: 120, wait: 40, confirm: 200, done: 270, error: 320, pause: 150, end: 270, cancel: 100,
};

describe("EARCONS 사양", () => {
  it("이름 10개가 모두 있다", () => {
    expect(Object.keys(EARCONS).sort()).toEqual([...NAMES].sort());
    for (const n of NAMES) expect(EARCONS[n].tones.length).toBeGreaterThan(0);
  });

  it("음량은 표와 같다", () => {
    expect(NAMES.map((n) => EARCONS[n].gain)).toEqual([0.5, 0.5, 0.4, 0.25, 0.5, 0.5, 0.5, 0.4, 0.5, 0.4]);
  });

  it("음 높이는 표와 같다", () => {
    const hz = (n: EarconName) => EARCONS[n].tones.map((t) => t.hz);
    expect(hz("start")).toEqual([440, 660]);
    expect(hz("turn")).toEqual([880]);
    expect(hz("sent")).toEqual([660, 440]);
    expect(hz("wait")).toEqual([330]);
    expect(hz("confirm")).toEqual([660, 660]);
    expect(hz("done")).toEqual([523, 659, 784]);
    expect(hz("error")).toEqual([220, 220]);
    expect(hz("pause")).toEqual([330]);
    expect(hz("end")).toEqual([784, 659, 523]);
    expect(hz("cancel")).toEqual([440, 330]);
  });

  it("earconDurationMs가 표와 같다", () => {
    for (const n of NAMES) expect(earconDurationMs(n)).toBe(DURATIONS[n]);
  });

  it("wait가 가장 짧다", () => {
    expect(Math.min(...NAMES.map(earconDurationMs))).toBe(earconDurationMs("wait"));
  });
});

describe("synthEarcon", () => {
  it("길이가 earconDurationMs에 맞는다(표본 1개 오차)", () => {
    for (const n of NAMES) {
      const want = (earconDurationMs(n) * EARCON_SAMPLE_RATE) / 1000;
      expect(Math.abs(synthEarcon(n).length - want)).toBeLessThanOrEqual(EARCONS[n].tones.length + 1);
    }
  });

  it("표본이 음량(gain) 범위 안이고 소리가 난다", () => {
    for (const n of NAMES) {
      const pcm = synthEarcon(n);
      const limit = Math.ceil(EARCONS[n].gain * 32767);
      let peak = 0;
      for (const s of pcm) peak = Math.max(peak, Math.abs(s));
      expect(peak).toBeLessThanOrEqual(limit);
      expect(peak).toBeGreaterThan(limit * 0.5);
    }
  });

  it("시작과 끝은 다듬어져 0에 가깝다", () => {
    for (const n of NAMES) {
      const pcm = synthEarcon(n);
      expect(Math.abs(pcm[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(EARCONS[n].gain * 32767 * 0.1);
    }
  });

  it("쉼 구간(start의 20ms)은 0이다", () => {
    const pcm = synthEarcon("start");
    const from = Math.round((80 * EARCON_SAMPLE_RATE) / 1000);
    const len = Math.round((20 * EARCON_SAMPLE_RATE) / 1000);
    expect(Array.from(pcm.subarray(from, from + len)).every((s) => s === 0)).toBe(true);
  });

  it("같은 이름은 같은 결과다", () => {
    expect(Array.from(synthEarcon("done"))).toEqual(Array.from(synthEarcon("done")));
  });
});

describe("toWav", () => {
  const pcm = synthEarcon("turn");
  const wav = toWav(pcm, EARCON_SAMPLE_RATE);
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));

  it("머리가 RIFF, WAVE, fmt, data 순서다", () => {
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(tag(36)).toBe("data");
  });

  it("22050Hz, 16비트, 모노, PCM", () => {
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(22_050);
    expect(v.getUint32(28, true)).toBe(44_100);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
  });

  it("길이 칸이 실제 크기와 맞는다", () => {
    expect(wav.length).toBe(44 + pcm.length * 2);
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(v.getUint32(40, true)).toBe(pcm.length * 2);
  });

  it("표본이 그대로 들어간다(음수 포함)", () => {
    const small = toWav(new Int16Array([0, 1, -1, 32767, -32768]), 8000);
    const sv = new DataView(small.buffer);
    expect([0, 1, 2, 3, 4].map((k) => sv.getInt16(44 + k * 2, true))).toEqual([0, 1, -1, 32767, -32768]);
    expect(sv.getUint32(24, true)).toBe(8000);
  });
});

describe("toDataUri", () => {
  it("data:audio/wav;base64로 시작하고 되돌리면 같은 바이트다", () => {
    const wav = toWav(synthEarcon("cancel"), EARCON_SAMPLE_RATE);
    const uri = toDataUri(wav);
    expect(uri.startsWith("data:audio/wav;base64,")).toBe(true);
    const back = Uint8Array.from(atob(uri.slice("data:audio/wav;base64,".length)), (c) => c.charCodeAt(0));
    expect(Array.from(back)).toEqual(Array.from(wav));
  });
});

/** 가짜 `<audio>` 요소. 호출 순서와 그때의 muted 값을 기록한다. */
function fakeAudio(opts: { rejectPlay?: boolean; throwPlay?: boolean } = {}) {
  const calls: string[] = [];
  const el = {
    src: "",
    muted: false,
    preload: "",
    currentTime: 0,
    play: vi.fn(() => {
      calls.push(`play(muted=${el.muted},src=${el.src.slice(0, 15)})`);
      if (opts.throwPlay) throw new Error("play 동기 오류");
      return opts.rejectPlay ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
    }),
    pause: vi.fn(() => { calls.push("pause"); }),
  };
  return { el, calls };
}

function fakeEnv(audioOpts: Parameters<typeof fakeAudio>[0] = {}) {
  const audio = fakeAudio(audioOpts);
  const createElement = vi.fn((tag: string) => {
    if (tag !== "audio") throw new Error(`audio 말고 ${tag}을 만들었다`);
    return audio.el;
  });
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  const win = {
    setInterval: vi.fn((fn: () => void, ms: number) => { intervals.set(nextId, { fn, ms }); return nextId++; }),
    clearInterval: vi.fn((id: number) => { intervals.delete(id); }),
  };
  const doc = { createElement } as unknown as Document;
  return { audio, createElement, intervals, win, winAs: win as unknown as Window, doc };
}

describe("createEarconPlayer", () => {
  it("<audio> 요소를 하나만 만들고 신호음마다 다시 쓴다", async () => {
    const env = fakeEnv();
    const player = createEarconPlayer(env.doc, env.winAs);
    player.unlock();
    for (const n of NAMES) await player.play(n);
    expect(env.createElement).toHaveBeenCalledTimes(1);
    expect(env.createElement).toHaveBeenCalledWith("audio");
  });

  it("play는 src를 data URI로 바꾼 뒤 재생하고, 신호음마다 src가 다르다", async () => {
    const env = fakeEnv();
    const player = createEarconPlayer(env.doc, env.winAs);
    const seen = new Set<string>();
    for (const n of NAMES) {
      await player.play(n);
      expect(env.audio.el.src.startsWith("data:audio/wav;base64,")).toBe(true);
      expect(env.audio.el.muted).toBe(false);
      seen.add(env.audio.el.src);
    }
    expect(seen.size).toBe(NAMES.length);
    expect(env.audio.el.play).toHaveBeenCalledTimes(NAMES.length);
  });

  it("unlock은 muted로 play한 뒤 pause하고 muted를 되돌린다", () => {
    const env = fakeEnv();
    createEarconPlayer(env.doc, env.winAs).unlock();
    expect(env.audio.calls).toEqual(["play(muted=true,src=data:audio/wav;)", "pause"]);
    expect(env.audio.el.muted).toBe(false);
  });

  it("unlock은 가장 짧은 신호음(wait)을 쓴다", async () => {
    const a = fakeEnv();
    createEarconPlayer(a.doc, a.winAs).unlock();
    const b = fakeEnv();
    await createEarconPlayer(b.doc, b.winAs).play("wait");
    expect(a.audio.el.src).toBe(b.audio.el.src);
  });

  it("play가 거절돼도 던지지 않고 기록은 남는다", async () => {
    const env = fakeEnv({ rejectPlay: true });
    const player = createEarconPlayer(env.doc, env.winAs);
    await expect(player.play("turn")).resolves.toBeUndefined();
    expect((env.win as unknown as { __lhEarconLog: string[] }).__lhEarconLog).toEqual(["turn"]);
  });

  it("play가 동기로 던져도 던지지 않는다", async () => {
    const env = fakeEnv({ throwPlay: true });
    const player = createEarconPlayer(env.doc, env.winAs);
    await expect(player.play("error")).resolves.toBeUndefined();
  });

  it("unlock은 play가 거절되거나 던져도 던지지 않고 muted를 되돌린다", async () => {
    for (const opts of [{ rejectPlay: true }, { throwPlay: true }]) {
      const env = fakeEnv(opts);
      expect(() => createEarconPlayer(env.doc, env.winAs).unlock()).not.toThrow();
      await Promise.resolve();   // 거절된 약속이 처리되지 않은 채 남지 않는지 한 틱 기다린다
      expect(env.audio.el.muted).toBe(false);
    }
  });

  it("play마다 먼저 window.__lhEarconLog에 이름을 넣는다(없으면 만든다)", async () => {
    const env = fakeEnv();
    const player = createEarconPlayer(env.doc, env.winAs);
    const log = () => (env.win as unknown as { __lhEarconLog?: string[] }).__lhEarconLog;
    expect(log()).toBeUndefined();
    await player.play("start");
    await player.play("sent");
    expect(log()).toEqual(["start", "sent"]);
  });

  it("이미 있는 __lhEarconLog에 이어 붙인다", async () => {
    const env = fakeEnv();
    (env.win as unknown as { __lhEarconLog: string[] }).__lhEarconLog = ["prev"];
    await createEarconPlayer(env.doc, env.winAs).play("done");
    expect((env.win as unknown as { __lhEarconLog: string[] }).__lhEarconLog).toEqual(["prev", "done"]);
  });

  it("기록은 재생 시도보다 먼저 남는다", () => {
    const env = fakeEnv();
    const log = () => (env.win as unknown as { __lhEarconLog?: string[] }).__lhEarconLog;
    let atPlay: string[] | undefined;
    env.audio.el.play.mockImplementationOnce(() => { atPlay = [...(log() ?? [])]; return Promise.resolve(); });
    void createEarconPlayer(env.doc, env.winAs).play("pause");
    expect(atPlay).toEqual(["pause"]);
  });

  it("startWait는 1.5초마다 wait를 내고 stopWait가 멈춘다", () => {
    const env = fakeEnv();
    const player = createEarconPlayer(env.doc, env.winAs);
    player.startWait();
    expect(env.win.setInterval).toHaveBeenCalledTimes(1);
    expect([...env.intervals.values()][0].ms).toBe(WAIT_PULSE_MS);
    expect(WAIT_PULSE_MS).toBe(1500);
    [...env.intervals.values()][0].fn();
    [...env.intervals.values()][0].fn();
    expect((env.win as unknown as { __lhEarconLog: string[] }).__lhEarconLog).toEqual(["wait", "wait"]);
    player.stopWait();
    expect(env.intervals.size).toBe(0);
  });

  it("startWait를 두 번 불러도 타이머는 하나이고, stopWait를 먼저 불러도 던지지 않는다", () => {
    const env = fakeEnv();
    const player = createEarconPlayer(env.doc, env.winAs);
    expect(() => player.stopWait()).not.toThrow();
    player.startWait();
    player.startWait();
    expect(env.intervals.size).toBe(1);
    player.stopWait();
    player.stopWait();
    expect(env.win.clearInterval).toHaveBeenCalledTimes(1);
    player.startWait();
    expect(env.intervals.size).toBe(1);
  });

  it("AudioContext를 쓰지 않는다(가짜 window에 없어도 되고 소스에도 없다)", async () => {
    const env = fakeEnv();
    const player = createEarconPlayer(env.doc, env.winAs);
    player.unlock();
    await player.play("turn");
    expect(Object.keys(env.win).some((k) => /AudioContext/i.test(k))).toBe(false);
    const src = readFileSync(path.resolve(import.meta.dirname, "../../src/lib/liveEarcons.ts"), "utf8");
    expect(src).not.toMatch(/new\s+(webkit)?AudioContext/i);
    expect(src).not.toMatch(/\b(webkit)?AudioContext\s*\(/i);
  });
});
