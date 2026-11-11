import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addManualCandidate,
  clearDraftStore,
  draftKey,
  emptyDraftStore,
  isHttpsUrl,
  MANUAL_MESSAGES,
  MAX_MANUAL,
  parseDraftStore,
  readDraftStore,
  serializeDraftStore,
  validateManual,
  writeDraftStore,
} from "@/lib/candidateDraft";

const ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  return data;
}

describe("isHttpsUrl", () => {
  it("https로 시작하고 URL로 읽히며 2048자 이하일 때만 참", () => {
    expect(isHttpsUrl("https://shop.example/p/1")).toBe(true);
    expect(isHttpsUrl("http://shop.example")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://")).toBe(false);
    expect(isHttpsUrl("shop.example")).toBe(false);
    expect(isHttpsUrl(`https://a.example/${"x".repeat(2040)}`)).toBe(false);
    expect(isHttpsUrl(`https://a.example/${"x".repeat(2000)}`)).toBe(true);
  });
});

describe("validateManual", () => {
  it("이름과 https 링크를 다듬어 돌려준다", () => {
    expect(validateManual("  로지텍 K380 ", " https://a.example/x ")).toEqual({
      ok: true,
      name: "로지텍 K380",
      url: "https://a.example/x",
    });
  });

  it("이름이 없거나 100자를 넘으면 name 오류, http 링크는 정해진 문구의 url 오류", () => {
    expect(validateManual("  ", "https://a.example")).toEqual({
      ok: false,
      field: "name",
      message: MANUAL_MESSAGES.nameRequired,
    });
    expect(validateManual("가".repeat(101), "https://a.example")).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(validateManual("가".repeat(100), "https://a.example")).toMatchObject({ ok: true });
    expect(validateManual("이름", "http://a.example")).toEqual({
      ok: false,
      field: "url",
      message: "링크는 https://로 시작해야 합니다",
    });
  });
});

describe("기기 초안 읽기·쓰기", () => {
  it("저장한 모양을 그대로 읽는다", () => {
    const store = addManualCandidate(emptyDraftStore(), "후보 A", "https://a.example");
    store.lastOpened = "m1";
    const back = parseDraftStore(serializeDraftStore(store));
    expect(back).toEqual({
      v: 1,
      manual: [{ id: "m1", name: "후보 A", url: "https://a.example" }],
      lastOpened: "m1",
      drafts: {},
    });
  });

  it("값이 없거나 깨졌으면 빈 값이다", () => {
    for (const raw of [null, "", "{", "[]", "null", '{"v":2}', '{"v":1,"manual":"x"}']) {
      expect(parseDraftStore(raw)).toEqual(emptyDraftStore());
    }
  });

  it("후보마다 모양을 검사해서 깨진 후보만 버린다(http 링크, 이름 없음, 4번째 이후)", () => {
    const raw = JSON.stringify({
      v: 1,
      manual: [
        { id: "m1", name: "좋은 것", url: "https://a.example" },
        { id: "m2", name: "", url: "https://a.example" },
        { id: "m3", name: "나쁜 링크", url: "http://a.example" },
        { id: 4, name: "id가 숫자", url: "https://a.example" },
        { id: "m2", name: "둘째", url: "https://b.example" },
        { id: "m3", name: "셋째", url: "https://c.example" },
        { id: "m4", name: "넷째", url: "https://d.example" },
      ],
      lastOpened: 7,
      drafts: [],
    });
    const store = parseDraftStore(raw);
    expect(store.manual.map((entry) => entry.name)).toEqual(["좋은 것", "둘째", "셋째"]);
    expect(store.lastOpened).toBeNull();
    expect(store.drafts).toEqual({});
  });

  it("블록 3이 쓸 drafts는 객체면 그대로 둔다", () => {
    const store = parseDraftStore(
      JSON.stringify({ v: 1, manual: [], lastOpened: null, drafts: { c1: { draft: {}, captureCount: 2 } } }),
    );
    expect(store.drafts).toEqual({ c1: { draft: {}, captureCount: 2 } });
  });

  it("직접 추가는 비어 있는 첫 id를 쓰고 최대 3개다", () => {
    let store = emptyDraftStore();
    for (const name of ["A", "B", "C", "D"]) {
      store = addManualCandidate(store, name, "https://a.example");
    }
    expect(store.manual.map((entry) => entry.id)).toEqual(["m1", "m2", "m3"]);
    expect(store.manual).toHaveLength(MAX_MANUAL);
  });

  it("localStorage에 요청별 키로 쓰고, 읽고, 지운다", () => {
    const data = stubStorage();
    expect(draftKey(ID)).toBe(`lh.vol.draft.v1.${ID}`);
    expect(readDraftStore(ID)).toEqual(emptyDraftStore());
    writeDraftStore(ID, addManualCandidate(emptyDraftStore(), "A", "https://a.example"));
    expect(data.has(draftKey(ID))).toBe(true);
    expect(readDraftStore(ID).manual).toHaveLength(1);
    clearDraftStore(ID);
    expect(data.size).toBe(0);
  });

  it("저장소 접근이 막혀도 던지지 않는다", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(readDraftStore(ID)).toEqual(emptyDraftStore());
    expect(() => writeDraftStore(ID, emptyDraftStore())).not.toThrow();
    expect(() => clearDraftStore(ID)).not.toThrow();
  });
});
