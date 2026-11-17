import { afterEach, describe, expect, it, vi } from "vitest";
import { PANELS_KEY, defaultPanels, fitToWidth, readPanels, writePanels } from "@/lib/panelPrefs";

/** 메모리 저장소. fail이 켜지면 읽기·쓰기가 던진다. */
function stubStorage(initial: Record<string, string> = {}, fail: "get" | "set" | null = null) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => {
      if (fail === "get") throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (fail === "set") throw new Error("quota");
      data.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("panelPrefs", () => {
  it("기본값: wide는 둘 다 열림, narrow는 둘 다 닫힘", () => {
    stubStorage();
    expect(defaultPanels("wide")).toEqual({ mine: true, slots: true });
    expect(defaultPanels("narrow")).toEqual({ mine: false, slots: false });
    expect(readPanels("wide")).toEqual({ mine: true, slots: true });
    expect(readPanels("narrow")).toEqual({ mine: false, slots: false });
  });

  it("저장한 뒤 읽으면 그대로, 폭 구분마다 따로", () => {
    stubStorage();
    writePanels("wide", { mine: false, slots: true });
    writePanels("narrow", { mine: true, slots: false });
    expect(readPanels("wide")).toEqual({ mine: false, slots: true });
    expect(readPanels("narrow")).toEqual({ mine: true, slots: false });
    writePanels("wide", { mine: false, slots: false });
    expect(readPanels("narrow")).toEqual({ mine: true, slots: false });
  });

  it("저장소 읽기 오류에도 기본값", () => {
    stubStorage({}, "get");
    expect(readPanels("wide")).toEqual({ mine: true, slots: true });
    expect(readPanels("narrow")).toEqual({ mine: false, slots: false });
  });

  it("저장소 쓰기 오류는 조용히 넘어간다", () => {
    stubStorage({}, "set");
    expect(() => writePanels("wide", { mine: false, slots: false })).not.toThrow();
  });

  it("window.localStorage 접근 자체가 던져도 기본값", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("denied");
      },
    });
    expect(readPanels("wide")).toEqual({ mine: true, slots: true });
    expect(() => writePanels("narrow", { mine: true, slots: true })).not.toThrow();
  });

  it("망가진 JSON·모양이 다른 값은 기본값", () => {
    stubStorage({ [PANELS_KEY]: "{not json" });
    expect(readPanels("wide")).toEqual({ mine: true, slots: true });
    stubStorage({ [PANELS_KEY]: JSON.stringify([1, 2]) });
    expect(readPanels("narrow")).toEqual({ mine: false, slots: false });
    stubStorage({ [PANELS_KEY]: JSON.stringify({ wide: { mine: "yes", slots: false }, narrow: 3 }) });
    expect(readPanels("wide")).toEqual({ mine: true, slots: false });
    expect(readPanels("narrow")).toEqual({ mine: false, slots: false });
  });
});

describe("fitToWidth", () => {
  it("narrow에서 둘 다 열림이면 왼쪽 창만 남긴다", () => {
    expect(fitToWidth("narrow", { mine: true, slots: true })).toEqual({ mine: true, slots: false });
  });

  it("그 밖의 값은 그대로", () => {
    expect(fitToWidth("narrow", { mine: false, slots: true })).toEqual({ mine: false, slots: true });
    expect(fitToWidth("narrow", { mine: true, slots: false })).toEqual({ mine: true, slots: false });
    expect(fitToWidth("wide", { mine: true, slots: true })).toEqual({ mine: true, slots: true });
  });
});
