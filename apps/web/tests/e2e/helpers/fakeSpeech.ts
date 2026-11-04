import type { Page } from "@playwright/test";

/**
 * 가짜 음성 입력(TSD §10). 이 도우미로 통과한 시험은 보고에 "가짜 음성 입력 기준"이라고 적는다.
 * 실제 음성 인식은 사람이 판정한다. 3~5블록도 이 도우미를 쓴다.
 */

interface FakeSpeechControl {
  /** start()가 불린 횟수 */
  starts: number;
  /** 마지막 인스턴스의 설정 */
  config: Record<string, unknown> | null;
  /** 지금 듣고 있는지 */
  listening: boolean;
  /** 다음 start()부터 start 이벤트를 내지 않는다 */
  silent: boolean;
  say(text: string): void;
  fail(code: string): void;
}

declare global {
  interface Window {
    __fakeSpeech: FakeSpeechControl;
  }
}

/** 페이지를 열기 전에 부른다. */
export async function installFakeSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Handler = ((event?: unknown) => void) | null;

    const control: FakeSpeechControl = {
      starts: 0,
      config: null,
      listening: false,
      silent: false,
      say() {},
      fail() {},
    };

    class FakeRecognition {
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 0;
      onstart: Handler = null;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: Handler = null;

      start() {
        control.say = (text) => this.finishWith(text);
        control.fail = (code) => this.failWith(code);
        control.starts += 1;
        control.config = {
          lang: this.lang,
          continuous: this.continuous,
          interimResults: this.interimResults,
          maxAlternatives: this.maxAlternatives,
        };
        if (control.silent) return;
        setTimeout(() => {
          control.listening = true;
          this.onstart?.();
        }, 0);
      }

      abort() {
        control.listening = false;
        this.onend?.();
      }

      finishWith(text: string) {
        control.listening = false;
        const result = Object.assign([{ transcript: text, confidence: 1 }], {
          isFinal: true,
        });
        this.onresult?.({ results: [result] });
        this.onend?.();
      }

      failWith(code: string) {
        control.listening = false;
        this.onerror?.({ error: code });
        this.onend?.();
      }
    }

    const target = window as unknown as Record<string, unknown>;
    target.SpeechRecognition = FakeRecognition;
    target.webkitSpeechRecognition = FakeRecognition;
    window.__fakeSpeech = control;
  });
}

/** 음성 인식 API가 없는 브라우저로 만든다. 페이지를 열기 전에 부른다. */
export async function removeSpeechApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, {
        value: undefined,
        configurable: true,
      });
    }
  });
}

async function whenListening(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fakeSpeech.listening);
}

/** 듣기 시작을 기다렸다가 문장을 인식시킨다. */
export async function say(page: Page, text: string): Promise<void> {
  await whenListening(page);
  await page.evaluate((value) => window.__fakeSpeech.say(value), text);
}

/** 듣기 시작을 기다렸다가 오류를 낸다. */
export async function fail(page: Page, code: string): Promise<void> {
  await whenListening(page);
  await page.evaluate((value) => window.__fakeSpeech.fail(value), code);
}

/** 앞으로 start()에 응답하지 않게 한다(3초 무응답 사례). */
export async function never(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__fakeSpeech.silent = true;
  });
}

export async function startCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__fakeSpeech.starts);
}

export async function recognitionConfig(page: Page) {
  return page.evaluate(() => window.__fakeSpeech.config);
}
