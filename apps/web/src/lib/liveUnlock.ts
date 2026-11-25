// /live 시작 click 안에서 하는 일, audioSession 다루기, 화면 켜 두기, 대화 id 만들기. 설계서 5.4절, 9절.
// iOS는 사용자 동작 밖의 소리 재생과 pushState를 막으므로 순서를 지켜 한 호출 스택에서 한다.
import type { EarconPlayer } from "@/lib/liveEngine";

/** 듣기와 충돌하면 끈다(H9 3번). */
export const USE_AUDIO_SESSION = true;

interface AudioSessionLike { type: string }
interface WakeLockSentinelLike { release(): Promise<void> }
interface NavigatorLike {
  audioSession?: AudioSessionLike;
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
}

/** 무음 스위치에서도 신호음이 나게 하려는 시도다. 없거나 던지면 무시한다. */
export function setAudioSession(
  type: "playback" | "auto",
  nav: unknown = typeof navigator === "undefined" ? undefined : navigator,
): void {
  if (!USE_AUDIO_SESSION) return;
  try {
    const session = (nav as NavigatorLike | undefined)?.audioSession;
    if (session) session.type = type;
  } catch {
    // 지원하지 않는 값이면 무시한다.
  }
}

/**
 * 화면 켜 두기 스위치를 만든다. 쓸 수 없거나 실패하면 아무 일도 하지 않는다.
 * 켜는 중에 꺼 달라는 요청이 오면 받자마자 놓는다.
 */
export function createWakeLock(
  nav: unknown = typeof navigator === "undefined" ? undefined : navigator,
): (on: boolean) => void {
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  let requesting = false;

  const release = () => {
    const held = sentinel;
    sentinel = null;
    if (held) held.release().catch(() => {});
  };

  return (on) => {
    wanted = on;
    if (!on) {
      release();
      return;
    }
    if (sentinel || requesting) return;
    try {
      const lock = (nav as NavigatorLike | undefined)?.wakeLock;
      if (!lock) return;
      requesting = true;
      lock
        .request("screen")
        .then((got) => {
          requesting = false;
          sentinel = got;
          if (!wanted) release();
        })
        .catch(() => {
          requesting = false;
        });
    } catch {
      requesting = false;
    }
  };
}

/** 대화 id. 보안 컨텍스트가 아니면 randomUUID가 없으므로 getRandomValues로 UUID v4를 만든다. */
export function newConversationId(
  c: unknown = typeof crypto === "undefined" ? undefined : crypto,
): string {
  const source = c as Partial<Pick<Crypto, "randomUUID" | "getRandomValues">> | undefined;
  try {
    const id = source?.randomUUID?.();
    if (id) return id;
  } catch {
    // 아래 방법으로 만든다.
  }
  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface StartClickDeps {
  /** 화면이 이미 history.pushState({ live: true }, "")를 했는가. */
  pushed: boolean;
  pushState(): void;
  earcons: Pick<EarconPlayer, "unlock">;
  setAudioSession(type: "playback" | "auto"): void;
  /** START 사건을 보낸다. 실행기가 같은 호출 스택에서 안내 낭독을 시작한다. */
  dispatchStart(): void;
}

/**
 * [대화 시작] click 핸들러 안에서, 첫 await 전에 부른다(5.4절). 순서: pushState → 신호음 잠금 해제
 * → audioSession → START. 앞 단계가 던져도 START는 반드시 보낸다. 돌려주는 값은 pushState를 했는가.
 * 화면 켜 두기(5번)는 START가 내는 WAKE_LOCK 효과가 한다.
 */
export function runStartClick(deps: StartClickDeps): boolean {
  let pushed = deps.pushed;
  if (!pushed) {
    try {
      deps.pushState();
      pushed = true;
    } catch {
      // pushState가 막혀도 대화는 시작한다.
    }
  }
  try {
    deps.earcons.unlock();
  } catch {
    // 신호음이 막혀도 계속한다.
  }
  try {
    deps.setAudioSession("playback");
  } catch {
    // 무시한다.
  }
  deps.dispatchStart();
  return pushed;
}
