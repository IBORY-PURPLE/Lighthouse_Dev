import { expect, type Page } from "@playwright/test";

/**
 * /live 화면 시험용 가짜 장치 모음(설계서 16.2절). 이 도우미로 통과한 시험은 보고에 "가짜 음성 입력 기준"이라고 적는다.
 * 이 PC의 Playwright WebKit은 about:blank에서 RTCPeerConnection, speechSynthesis, navigator.mediaDevices가 없었다(심사 확인).
 * 그래서 진짜에 기대지 않고 언제나 가짜를 넣는다. 모두 page.addInitScript로 넣으므로 페이지를 열기 전에 부른다.
 * 실제 음성 인식, 기기 목소리, VoiceOver 낭독, 실제 Realtime 연결은 사람이 판정한다.
 */

export interface FakeLiveOptions {
  /** false면 음성 인식 API가 없는 브라우저로 만든다(글자 모드 시험). 기본 true */
  speech?: boolean;
  /** true면 가짜 RTCPeerConnection을 넣는다(Realtime 시험). 기본 false */
  realtime?: boolean;
  /** false면 speechSynthesis가 없는 브라우저로 만든다. 기본 true */
  tts?: boolean;
}

export interface FakeLive {
  tts: {
    /** 참이면 finish()를 부를 때까지 읽기가 끝나지 않는다(끼어들기 시험용) */
    hold: boolean;
    /** 읽는 중인 글이 있을 때 cancel()이 불린 횟수 */
    cancels: number;
    /** 읽기 요청마다 받은 빠르기(rate) */
    rates: number[];
    /** 0보다 크면 다음 읽기들이 끝남이 아니라 오류(onerror)로 끝난다. 한 번마다 1씩 준다 */
    failNext: number;
    finish(): void;
  };
  rec: {
    /** start()가 불린 횟수 */
    starts: number;
    /** 지금 듣고 있는지(start 이벤트를 낸 뒤부터 끝날 때까지) */
    listening: boolean;
    /** 참이면 듣기가 시작되자마자 결과 없이 끝난다(말이 없는 인식기). 거짓이면 stop·abort·say로 끝날 때까지 조용히 듣는다 */
    silent: boolean;
    /** start 이벤트를 이 시간(ms) 늦춘다(마이크 허용 창이 떠 있는 상황). start()가 불리는 때 읽는다 */
    startDelayMs: number;
    say(text: string): void;
    interim(text: string): void;
    fail(code: string): void;
  };
  media: {
    calls: number;
    /** 약속이 풀려 앱에 스트림이 건네진 횟수 */
    delivered: number;
    /** getUserMedia 약속을 이 시간(ms) 늦게 푼다(허용 창 흉내) */
    delayMs: number;
    /** 트랙의 enabled를 바꾼 기록 */
    enabledLog: boolean[];
    tracks: { enabled: boolean; stopped: boolean }[];
    /** 받은 모든 스트림의 모든 트랙이 멈췄는가(받은 스트림이 없으면 거짓) */
    readonly stopped: boolean;
  };
  rtc: {
    /** 데이터 채널로 보낸 이벤트(JSON을 푼 것) */
    sent: Record<string, unknown>[];
    /** 만들어진 데이터 채널 수 */
    channels: number;
    open(): void;
    emit(event: object): void;
    fail(): void;
  };
  /** role=status, role=alert 요소에 들어온 글을 시간 순서로 모은다 */
  announced: string[];
}

declare global {
  interface Window {
    __spoken: string[];
    __fakeLive: FakeLive;
    __lhEarconLog?: string[];
  }
}

/** 페이지를 열기 전에 부른다. */
export async function installFakeLive(page: Page, options: FakeLiveOptions = {}): Promise<void> {
  await page.addInitScript((opts) => {
    type Handler = ((event?: unknown) => void) | null;
    const w = window as unknown as Record<string, unknown>;

    // ---------- 알림 기록 ----------
    const announced: string[] = [];
    const seen = new WeakMap<Element, string>();
    const scan = () => {
      for (const el of Array.from(document.querySelectorAll('[role="status"],[role="alert"]'))) {
        const text = (el.textContent ?? "").trim();
        if (seen.get(el) === text) continue;
        seen.set(el, text);
        if (text) announced.push(text);
      }
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });

    // ---------- 가짜 읽어 주기 ----------
    const spoken: string[] = [];
    window.__spoken = spoken;
    const tts = {
      hold: false,
      cancels: 0,
      rates: [] as number[],
      failNext: 0,
      finish() {
        const u = current;
        if (!u) return;
        current = null;
        u.onend?.();
      },
    };
    class FakeUtterance {
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    let current: FakeUtterance | null = null;
    if (opts.tts !== false) {
      w.SpeechSynthesisUtterance = FakeUtterance;
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          speak(u: FakeUtterance) {
            spoken.push(u.text);
            tts.rates.push(u.rate);
            current = u;
            if (tts.failNext > 0) {
              tts.failNext -= 1;
              setTimeout(() => {
                if (current !== u) return;
                current = null;
                u.onerror?.();
              }, 0);
              return;
            }
            if (!tts.hold) {
              setTimeout(() => {
                if (current !== u) return;
                current = null;
                u.onend?.();
              }, 0);
            }
          },
          cancel() {
            if (current) tts.cancels += 1;
            current = null;
          },
        },
      });
    } else {
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      w.SpeechSynthesisUtterance = undefined;
    }

    // ---------- 가짜 음성 인식 ----------
    const rec = {
      starts: 0,
      listening: false,
      silent: false,
      startDelayMs: 0,
      say(text: string) {
        cur?.finishWith(text);
      },
      interim(text: string) {
        cur?.interimWith(text);
      },
      fail(code: string) {
        cur?.failWith(code);
      },
    };
    let cur: FakeRecognition | null = null;
    const setCur = (r: FakeRecognition) => {
      cur = r;
    };
    const result = (text: string, isFinal: boolean) => Object.assign([{ transcript: text, confidence: 1 }], { isFinal });

    class FakeRecognition {
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 0;
      onstart: Handler = null;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: Handler = null;
      active = false;
      interimText = "";

      start() {
        rec.starts += 1;
        setCur(this);
        this.active = true;
        setTimeout(() => {
          if (!this.active) return;
          rec.listening = true;
          this.onstart?.();
          if (rec.silent) setTimeout(() => this.end(), 0);
        }, rec.startDelayMs);
      }

      end() {
        if (!this.active) return;
        this.active = false;
        if (cur === this) rec.listening = false;
        this.onend?.();
      }

      abort() {
        this.end();
      }

      stop() {
        if (!this.active) return;
        if (this.interimText) {
          const text = this.interimText;
          this.interimText = "";
          this.onresult?.({ results: [result(text, true)] });
        }
        this.end();
      }

      finishWith(text: string) {
        if (!this.active) return;
        this.interimText = "";
        this.onresult?.({ results: [result(text, true)] });
        this.end();
      }

      interimWith(text: string) {
        if (!this.active) return;
        this.interimText = text;
        this.onresult?.({ results: [result(text, false)] });
      }

      failWith(code: string) {
        if (!this.active) return;
        this.onerror?.({ error: code });
        this.end();
      }
    }
    if (opts.speech !== false) {
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    } else {
      for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(window, name, { value: undefined, configurable: true });
      }
    }

    // ---------- 가짜 마이크 ----------
    const tracks: { enabled: boolean; stopped: boolean }[] = [];
    const streams: { enabled: boolean; stopped: boolean }[][] = [];
    const media = {
      calls: 0,
      delivered: 0,
      delayMs: 0,
      enabledLog: [] as boolean[],
      tracks,
      get stopped() {
        return streams.length > 0 && streams.every((s) => s.every((t) => t.stopped));
      },
    };
    const makeTrack = () => {
      let enabled = true;
      const track = {
        kind: "audio",
        get enabled() {
          return enabled;
        },
        set enabled(value: boolean) {
          enabled = value;
          media.enabledLog.push(value);
        },
        stopped: false,
        stop() {
          track.stopped = true;
        },
      };
      return track;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia() {
          media.calls += 1;
          const track = makeTrack();
          tracks.push(track);
          streams.push([track]);
          const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
          return new Promise((resolve) =>
            setTimeout(() => {
              media.delivered += 1;
              resolve(stream);
            }, media.delayMs),
          );
        },
      },
    });

    // ---------- 가짜 RTCPeerConnection ----------
    const rtc = {
      sent: [] as Record<string, unknown>[],
      channels: 0,
      open() {
        channel?.open();
      },
      emit(event: object) {
        channel?.onmessage?.({ data: JSON.stringify(event) });
      },
      fail() {
        if (!pc) return;
        pc.connectionState = "failed";
        pc.onconnectionstatechange?.();
      },
    };
    class FakeChannel {
      readyState = "connecting";
      onopen: Handler = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: Handler = null;
      open() {
        this.readyState = "open";
        this.onopen?.();
      }
      send(data: string) {
        rtc.sent.push(JSON.parse(data) as Record<string, unknown>);
      }
      close() {
        this.readyState = "closed";
      }
    }
    let channel: FakeChannel | null = null;
    let pc: FakePeer | null = null;
    const setPc = (p: FakePeer) => {
      pc = p;
    };
    class FakePeer {
      connectionState = "new";
      ontrack: Handler = null;
      onconnectionstatechange: Handler = null;
      constructor() {
        setPc(this);
      }
      addTrack() {}
      createDataChannel() {
        channel = new FakeChannel();
        rtc.channels += 1;
        return channel;
      }
      async createOffer() {
        return { type: "offer", sdp: "v=0\r\n" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    }
    if (opts.realtime === true) w.RTCPeerConnection = FakePeer;

    window.__fakeLive = { tts, rec, media, rtc, announced } as FakeLive;
  }, options);
}

// ---------------------------------------------------------------- 시험 쪽 도우미

export const POLL = { timeout: 15_000 };

export const spokenOf = (page: Page): Promise<string[]> => page.evaluate(() => [...window.__spoken]);
export const announcedOf = (page: Page): Promise<string[]> => page.evaluate(() => [...window.__fakeLive.announced]);
export const earconsOf = (page: Page): Promise<string[]> => page.evaluate(() => [...(window.__lhEarconLog ?? [])]);

/** 이 글을 기기 목소리로 읽을 때까지 기다린다(글이 같거나, 정규식에 맞는 글이 있으면 된다). */
export async function heard(page: Page, what: string | RegExp): Promise<void> {
  await expect
    .poll(async () => (await spokenOf(page)).some((t) => (typeof what === "string" ? t === what : what.test(t))), POLL)
    .toBe(true);
}

/** 이 글을 읽은 횟수. */
export async function heardCount(page: Page, what: string | RegExp): Promise<number> {
  return (await spokenOf(page)).filter((t) => (typeof what === "string" ? t === what : what.test(t))).length;
}

/** 화면 루트(상태 고리를 가진 요소). */
export const surface = (page: Page) => page.locator("[data-live-surface]");

export async function expectState(page: Page, state: string): Promise<void> {
  await expect(surface(page)).toHaveAttribute("data-live-state", state, POLL);
}

/** 인식기가 듣기 시작할 때까지 기다린다. */
export async function whenListening(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fakeLive.rec.listening, undefined, POLL);
}

/** 듣기를 기다렸다가 문장을 인식시킨다. */
export async function sayLive(page: Page, text: string): Promise<void> {
  await whenListening(page);
  await page.evaluate((value) => window.__fakeLive.rec.say(value), text);
}

/**
 * 가짜 시계를 stepMs씩 당기며 조건이 맞을 때까지 기다린다(page.clock.install 뒤에 쓴다).
 * 앱의 약속(신호음 재생 등)은 실제 시간으로 풀리므로 단계마다 잠깐 실제로도 쉰다.
 */
export async function advanceUntil(
  page: Page,
  done: () => Promise<boolean>,
  o: { stepMs?: number; maxMs?: number } = {},
): Promise<void> {
  const stepMs = o.stepMs ?? 250;
  const maxMs = o.maxMs ?? 200_000;
  for (let t = 0; t <= maxMs; t += stepMs) {
    if (await done()) return;
    await page.clock.runFor(stepMs);
    await page.waitForTimeout(25);
  }
  throw new Error(`advanceUntil: 가짜 시계 ${maxMs}ms 안에 조건이 맞지 않았다`);
}
