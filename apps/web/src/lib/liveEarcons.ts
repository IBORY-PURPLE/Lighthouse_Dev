// /live 신호음. 사인파를 만들어 WAV data URI로 두고 `<audio>` 요소 하나로 재생한다. 설계서 9절, 5.4절(unlock).
// 모든 수치는 [제안값]이다. 로그에는 신호음 이름만 남기고 다른 것은 남기지 않는다.
import type { EarconName, EarconPlayer } from "@/lib/liveEngine";

export interface Tone { hz: number; ms: number; gapMs?: number }   // gapMs는 이 음 뒤의 쉼

export const EARCON_SAMPLE_RATE = 22_050;
export const WAIT_PULSE_MS = 1_500;      // 기다리는 중 신호음을 되풀이하는 간격
const ATTACK_MS = 5;                     // 음 시작을 다듬는 시간
const RELEASE_MS = 20;                   // 음 끝을 다듬는 시간

export const EARCONS: Record<EarconName, { tones: Tone[]; gain: number }> = {
  start: { tones: [{ hz: 440, ms: 80, gapMs: 20 }, { hz: 660, ms: 80 }], gain: 0.5 },
  turn: { tones: [{ hz: 880, ms: 120 }], gain: 0.5 },
  sent: { tones: [{ hz: 660, ms: 60 }, { hz: 440, ms: 60 }], gain: 0.4 },
  wait: { tones: [{ hz: 330, ms: 40 }], gain: 0.25 },
  confirm: { tones: [{ hz: 660, ms: 70, gapMs: 60 }, { hz: 660, ms: 70 }], gain: 0.5 },
  done: { tones: [{ hz: 523, ms: 90 }, { hz: 659, ms: 90 }, { hz: 784, ms: 90 }], gain: 0.5 },
  error: { tones: [{ hz: 220, ms: 120, gapMs: 80 }, { hz: 220, ms: 120 }], gain: 0.5 },
  pause: { tones: [{ hz: 330, ms: 150 }], gain: 0.4 },
  end: { tones: [{ hz: 784, ms: 90 }, { hz: 659, ms: 90 }, { hz: 523, ms: 90 }], gain: 0.5 },
  cancel: { tones: [{ hz: 440, ms: 50 }, { hz: 330, ms: 50 }], gain: 0.4 },
};

const NAMES = Object.keys(EARCONS) as EarconName[];

/** 신호음 하나의 길이(밀리초). 마지막 음 뒤의 쉼은 세지 않는다. */
export function earconDurationMs(name: EarconName): number {
  const { tones } = EARCONS[name];
  return tones.reduce((sum, t, idx) => sum + t.ms + (idx < tones.length - 1 ? (t.gapMs ?? 0) : 0), 0);
}

function samplesOf(ms: number): number {
  return Math.round((ms * EARCON_SAMPLE_RATE) / 1000);
}

/** 사인파 PCM(16비트, 모노). 음마다 시작 5ms, 끝 20ms를 직선으로 다듬는다. */
export function synthEarcon(name: EarconName): Int16Array {
  const { tones, gain } = EARCONS[name];
  const parts: Int16Array[] = [];
  tones.forEach((tone, idx) => {
    const n = samplesOf(tone.ms);
    const attack = samplesOf(ATTACK_MS);
    const release = samplesOf(RELEASE_MS);
    const pcm = new Int16Array(n);
    for (let k = 0; k < n; k++) {
      const fadeIn = Math.min(1, k / attack);
      const fadeOut = Math.min(1, (n - 1 - k) / release);
      const amp = gain * Math.min(fadeIn, fadeOut) * 32767;
      pcm[k] = Math.round(amp * Math.sin((2 * Math.PI * tone.hz * k) / EARCON_SAMPLE_RATE));
    }
    parts.push(pcm);
    if (idx < tones.length - 1 && tone.gapMs) parts.push(new Int16Array(samplesOf(tone.gapMs)));
  });
  const out = new Int16Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** 16비트 모노 PCM을 RIFF WAV로 감싼다(머리 44바이트, 리틀 엔디언). */
export function toWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const tag = (at: number, s: string) => { for (let k = 0; k < s.length; k++) v.setUint8(at + k, s.charCodeAt(k)); };
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);              // fmt 덩어리 크기
  v.setUint16(20, 1, true);               // PCM
  v.setUint16(22, 1, true);               // 모노
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);  // 초당 바이트
  v.setUint16(32, 2, true);               // 표본 하나의 바이트
  v.setUint16(34, 16, true);              // 16비트
  tag(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let k = 0; k < pcm.length; k++) v.setInt16(44 + k * 2, pcm[k], true);
  return new Uint8Array(buf);
}

export function toDataUri(wav: Uint8Array): string {
  let bin = "";
  for (let k = 0; k < wav.length; k += 0x8000) {
    bin += String.fromCharCode(...wav.subarray(k, k + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** 가장 짧은 신호음. unlock이 소리 없이 한 번 재생하는 데 쓴다. */
function shortestName(): EarconName {
  return NAMES.reduce((a, b) => (earconDurationMs(b) < earconDurationMs(a) ? b : a));
}

/**
 * `<audio>` 요소 하나를 다시 써서 재생한다. iOS는 요소마다 사용자 동작 안에서 한 번 재생해야 잠금이 풀린다고 해서
 * 요소를 늘리지 않는다. 재생이 거절되면 조용히 넘어가고, 다른 재생 경로(Web Audio)로 다시 내지 않는다.
 */
export function createEarconPlayer(doc: Document, win: Window): EarconPlayer {
  const el = doc.createElement("audio");
  el.preload = "auto";
  const uris = new Map<EarconName, string>();
  let timer: number | null = null;

  const uriOf = (name: EarconName): string => {
    let uri = uris.get(name);
    if (!uri) {
      uri = toDataUri(toWav(synthEarcon(name), EARCON_SAMPLE_RATE));
      uris.set(name, uri);
    }
    return uri;
  };

  const record = (name: EarconName) => {
    const w = win as unknown as { __lhEarconLog?: string[] };
    if (!Array.isArray(w.__lhEarconLog)) w.__lhEarconLog = [];
    w.__lhEarconLog.push(name);
  };

  const play = async (name: EarconName): Promise<void> => {
    record(name);
    try {
      el.src = uriOf(name);
      el.muted = false;
      try { el.currentTime = 0; } catch { /* 아직 읽기 전이면 던질 수 있다 */ }
      await el.play();
    } catch {
      /* 거절되면 조용히 넘어간다 */
    }
  };

  return {
    unlock() {
      try {
        el.src = uriOf(shortestName());
        el.muted = true;
        const p = el.play() as Promise<void> | undefined;
        p?.catch?.(() => { /* pause로 끊기는 거절은 무시 */ });
        el.pause();
      } catch {
        /* 실패는 무시한다 */
      } finally {
        try { el.muted = false; } catch { /* 무시 */ }
      }
    },
    play,
    startWait() {
      if (timer !== null) return;
      timer = win.setInterval(() => { void play("wait"); }, WAIT_PULSE_MS);
    },
    stopWait() {
      if (timer === null) return;
      win.clearInterval(timer);
      timer = null;
    },
  };
}
