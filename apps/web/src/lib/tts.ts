// 브라우저 음성 출력(읽어 주기). apps/user-voice-ui의 speak()를 옮겼다. 화면 낭독기와 겹치지 않게 끌 수 있다.

export const TTS_STORAGE_KEY = "lh.tts.v1";

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 읽는 동안 true, 끝나거나 실패하면 false로 알린다. 못 읽는 브라우저면 아무것도 하지 않는다. */
export function speakText(text: string, onActive: (active: boolean) => void): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 0.95;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(guard);
      onActive(false);
    };
    // 끝 이벤트가 오지 않는 브라우저에서도 애니메이션이 멈춘다.
    const guard = setTimeout(end, 2_000 + text.length * 300);
    utterance.onstart = () => onActive(true);
    utterance.onend = end;
    utterance.onerror = end;
    window.speechSynthesis.speak(utterance);
  } catch {
    onActive(false);
  }
}

export function cancelSpeech(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // 읽기를 멈추지 못해도 화면은 계속 쓸 수 있다.
  }
}

/** 읽어 주기를 켜 두었는지. 저장이 막히면 켜 둔 것으로 본다. */
export function readTtsPreference(): boolean {
  try {
    return localStorage.getItem(TTS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveTtsPreference(on: boolean): void {
  try {
    localStorage.setItem(TTS_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // 저장이 막히면 다음에 열 때 켜진 상태로 시작한다.
  }
}
