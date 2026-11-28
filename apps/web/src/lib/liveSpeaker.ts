// /live 기기 목소리(speechSynthesis) 래퍼. 읽기, 끊기, 빠르기, 끝남 감시. 설계서 6.1절.
// fallback 엔진은 결과만 넘기고 읽는 일은 여기서 한다(6절). 로그에 읽는 글을 남기지 않는다.
import type { LiveSpeaker } from "@/lib/liveEngine";

export const SPEAK_RATES = { slow: 0.8, normal: 0.95, fast: 1.15 } as const;
/**
 * Windows의 Chrome 계열은 기기 목소리(SAPI)에 빠르기를 정수 단계 trunc(10 × log10(rate))로 넘긴다.
 * 그래서 0.8, 0.95, 1.15가 모두 0단계가 되어 '천천히'와 '빠르게'가 들리지 않았다(실측 2026-11-24: 세 값의 읽는 시간이 같았다).
 * 이 환경에서는 −2단계(약 0.8배)와 +1단계(약 1.12배)가 되는 값을 쓴다. Edge는 목소리가 달라 그대로 둔다.
 */
export const SPEAK_RATES_SAPI = { slow: 0.62, normal: 1, fast: 1.3 } as const;
// SpeechSynthesisUtterance가 받는 최대 요청값. 음성 엔진은 지원하는 범위로 제한할 수 있다.
export const FASTEST_CONFIRMATION_RATE = 10;

/** Windows의 Chrome 계열(Chrome, Whale, Brave…)인가. Edge는 뺀다. */
export function usesSapiRates(userAgent: string | undefined): boolean {
  const ua = userAgent ?? "";
  return /Windows NT/.test(ua) && /Chrome\//.test(ua) && !/Edg\//.test(ua);
}

/**
 * 끝남 신호가 오지 않을 때를 위한 감시 시간: 글자 수 × 250ms ÷ 빠르기(1보다 빠르면 1로 본다) + 3000ms.
 * 실제 Chrome(Windows, Microsoft Heami) 측정은 글자당 156~190ms였다(2026-11-24). 천천히 읽을 때 감시가 먼저 끝나지 않게 빠르기로 나눈다.
 */
const GUARD_PER_CHAR_MS = 250;
const GUARD_BASE_MS = 3_000;
export function speakGuardMs(length: number, rate: number): number {
  return Math.round((length * GUARD_PER_CHAR_MS) / Math.min(1, rate)) + GUARD_BASE_MS;
}

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
  const rates = usesSapiRates((win as unknown as { navigator?: { userAgent?: string } }).navigator?.userAgent)
    ? SPEAK_RATES_SAPI
    : SPEAK_RATES;
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
    speak(id, text, onEnd, fastest = false) {
      token += 1;
      const mine = token;
      clearGuard();
      // 읽을 글이 없으면 끝난 것이고, 읽을 수단이 없으면 읽지 못한 것이다. 어느 쪽이든 바로 알려 상태 기계가 멈추지 않게 한다.
      if (!synth || !Utterance || !text) {
        current = null;
        const failed = text !== "";
        guard = setTimeout(() => {
          if (mine === token) onEnd(id, failed);
        }, 0);
        return;
      }
      // failed: 읽지 못했거나 끝까지 읽었는지 알 수 없다. 끝까지 읽은 것과 구별해 알린다(요약을 듣지 못했는데 동의를 받으면 안 된다).
      const done = (failed: boolean) => {
        if (mine !== token) return; // 낡은 콜백은 버린다
        token += 1; // 같은 읽기의 끝은 한 번만 알린다
        clearGuard();
        current = null;
        onEnd(id, failed);
      };
      try {
        synth.cancel();
        const utterance = new Utterance(text);
        utterance.lang = "ko-KR";
        utterance.rate = fastest ? FASTEST_CONFIRMATION_RATE : rates[rate];
        utterance.onend = () => done(false);
        utterance.onerror = () => done(true);
        current = utterance;
        // 호출 스택 안에서 바로 읽는다. 시작 click 안의 첫 낭독이 잠금 해제이기 때문이다(5.4절).
        synth.speak(utterance);
      } catch {
        done(true);
        return;
      }
      // 끝남 신호가 끝내 오지 않으면 다 읽었는지 알 수 없다. 실패로 알린다.
      guard = setTimeout(() => done(true), speakGuardMs(text.length, SPEAK_RATES[rate]));
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
