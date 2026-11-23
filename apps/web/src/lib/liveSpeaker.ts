// /live 기기 목소리(speechSynthesis) 래퍼. 읽기, 끊기, 빠르기, 끝남 감시. 설계서 6.1절.
// fallback 엔진은 결과만 넘기고 읽는 일은 여기서 한다(6절). 로그에 읽는 글을 남기지 않는다.
import type { LiveSpeaker } from "@/lib/liveEngine";

export const SPEAK_RATES = { slow: 0.8, normal: 0.95, fast: 1.15 } as const;

/** 끝남 신호가 오지 않을 때를 위한 감시 시간: 글자 수 × 250ms + 3000ms. */
const GUARD_PER_CHAR_MS = 250;
const GUARD_BASE_MS = 3_000;

type Rate = keyof typeof SPEAK_RATES;

interface UtteranceLike {
  lang: string;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type UtteranceCtor = new (text: string) => UtteranceLike;
interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
}
interface SpeechWindow {
  speechSynthesis?: SynthLike;
  SpeechSynthesisUtterance?: UtteranceCtor;
}

export function createLiveSpeaker(win: Window): LiveSpeaker {
  const { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance } = win as unknown as SpeechWindow;
  const available = Boolean(synth && Utterance);
  let rate: Rate = "normal";
  let token = 0;
  let guard: ReturnType<typeof setTimeout> | undefined;
  // 일부 브라우저는 참조가 없어지면 낭독 중에 onend를 잃는다. 읽는 동안 붙들어 둔다.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 읽지 않고 붙들어 두는 것이 목적이다.
  let current: UtteranceLike | null = null;

  const clearGuard = () => {
    clearTimeout(guard);
    guard = undefined;
  };

  return {
    available,
    speak(id, text, onEnd) {
      token += 1;
      const mine = token;
      clearGuard();
      // 읽을 수 없으면 끝난 것으로 알린다. 상태 기계가 읽기가 끝나기를 기다리며 멈추지 않게 한다.
      if (!synth || !Utterance || !text) {
        current = null;
        guard = setTimeout(() => {
          if (mine === token) onEnd(id);
        }, 0);
        return;
      }
      const done = () => {
        if (mine !== token) return; // 낡은 콜백은 버린다
        token += 1; // 같은 읽기의 끝은 한 번만 알린다
        clearGuard();
        current = null;
        onEnd(id);
      };
      try {
        synth.cancel();
        const utterance = new Utterance(text);
        utterance.lang = "ko-KR";
        utterance.rate = SPEAK_RATES[rate];
        utterance.onend = done;
        utterance.onerror = done;
        current = utterance;
        // 호출 스택 안에서 바로 읽는다. 시작 click 안의 첫 낭독이 잠금 해제이기 때문이다(5.4절).
        synth.speak(utterance);
      } catch {
        done();
        return;
      }
      guard = setTimeout(done, text.length * GUARD_PER_CHAR_MS + GUARD_BASE_MS);
    },
    stop() {
      token += 1; // onEnd를 부르지 않는다
      clearGuard();
      current = null;
      try {
        synth?.cancel();
      } catch {
        // 끊기 실패는 무시한다.
      }
    },
    setRate(next) {
      rate = next;
    },
  };
}
