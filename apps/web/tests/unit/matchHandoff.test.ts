import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MATCH_STORAGE_KEY,
  parseStoredMatch,
  readStoredMatch,
  requestLabel,
  requestMatch,
  saveMatch,
  type MatchResponse,
} from "@/lib/matchHandoff";
import { STATUS } from "@/lib/speech";

const MATCH: MatchResponse = {
  requestId: "id-1",
  volunteer: { id: "v-01", displayName: "가상 봉사자 A" },
  request: { brand: "Sony", item: "헤드셋", raw: "소니 헤드셋" },
};

function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("requestMatch", () => {
  it("문장을 POST로 보내고 응답을 돌려준다", async () => {
    const fetchMock = stubFetch(200, MATCH);
    expect(await requestMatch("소니 헤드셋")).toEqual({
      kind: "matched",
      match: MATCH,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/match");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ text: "소니 헤드셋" }));
  });

  it("브랜드가 null인 응답도 받는다", async () => {
    const match = { ...MATCH, request: { ...MATCH.request, brand: null } };
    stubFetch(200, match);
    expect(await requestMatch("헤드셋")).toEqual({ kind: "matched", match });
  });

  for (const [code, status] of [
    [422, STATUS.needItem],
    [400, STATUS.tooLong],
  ] as const) {
    it(`${code}는 문장을 바꿔 다시 내게 한다`, async () => {
      stubFetch(code);
      expect(await requestMatch("문장")).toEqual({ kind: "rejected", status });
    });
  }

  for (const [code, status] of [
    [401, STATUS.noAccess],
    [429, STATUS.tooMany],
    [500, STATUS.matchFailed],
  ] as const) {
    it(`${code}는 같은 문장을 다시 보낼 수 있게 한다`, async () => {
      stubFetch(code);
      expect(await requestMatch("문장")).toEqual({ kind: "failed", status });
    });
  }

  it("응답 모양이 다르면 실패다", async () => {
    stubFetch(200, { requestId: "id-1" });
    expect(await requestMatch("문장")).toEqual({
      kind: "failed",
      status: STATUS.matchFailed,
    });
  });

  it("네트워크 오류는 실패다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect(await requestMatch("문장")).toEqual({
      kind: "failed",
      status: STATUS.matchFailed,
    });
  });
});

describe("저장과 읽기", () => {
  function stubStorage() {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    return values;
  }

  it("lh.match.v1에 넣고 그대로 읽는다", () => {
    const values = stubStorage();
    saveMatch(MATCH);
    expect([...values.keys()]).toEqual([MATCH_STORAGE_KEY]);
    expect(MATCH_STORAGE_KEY).toBe("lh.match.v1");
    expect(parseStoredMatch(readStoredMatch())).toEqual(MATCH);
  });

  it("저장소를 못 써도 예외를 던지지 않는다", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    });
    expect(() => saveMatch(MATCH)).not.toThrow();
    expect(readStoredMatch()).toBeNull();
  });

  for (const [name, stored] of [
    ["없음", null],
    ["서버", undefined],
    ["빈 값", ""],
    ["깨진 JSON", "{"],
    ["모양이 다름", '{"requestId":"id-1"}'],
    ["null", "null"],
  ] as const) {
    it(`읽을 수 없는 값은 null이다: ${name}`, () => {
      expect(parseStoredMatch(stored)).toBeNull();
    });
  }
});

describe("requestLabel", () => {
  it("브랜드가 있으면 붙이고 없으면 품목만 쓴다", () => {
    expect(requestLabel(MATCH.request)).toBe("Sony 헤드셋");
    expect(requestLabel({ ...MATCH.request, brand: null })).toBe("헤드셋");
  });
});
