import { afterEach, describe, expect, it, vi } from "vitest";
import { isChatRequest, requestAnswer } from "@/lib/chat";
import { STATUS } from "@/lib/speech";

const REQUEST = {
  requestId: "6f1c2e4a-1111-4222-8333-444455556666",
  question: "sony 헤드셋 찾는 가이드 알려줘",
  context: { brand: "Sony", item: "헤드셋" },
};

function streamOf(pieces: Uint8Array[], failAtEnd = false) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      if (failAtEnd) controller.error(new Error("끊김"));
      else controller.close();
    },
  });
}

const encoder = new TextEncoder();

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requestAnswer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("받는 대로 넘기고, 나뉜 한글 바이트도 깨지지 않는다", async () => {
    const bytes = encoder.encode("검색어:");
    const fetchMock = stubFetch(
      new Response(streamOf([bytes.slice(0, 1), bytes.slice(1)])),
    );
    const received: string[] = [];

    const outcome = await requestAnswer(REQUEST, (text) => received.push(text));

    expect(outcome).toEqual({ kind: "answered" });
    expect(received.join("")).toBe("검색어:");
    expect(received.join("")).not.toContain("�");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  for (const [code, kind, status] of [
    [400, "rejected", STATUS.questionTooLong],
    [401, "failed", STATUS.noAccess],
    [429, "failed", STATUS.tooMany],
    [502, "failed", STATUS.chatFailed],
    [503, "failed", STATUS.chatNotConfigured],
    [500, "failed", STATUS.chatFailed],
  ] as const) {
    it(`${code}는 TSD 표의 문구를 돌려준다`, async () => {
      stubFetch(new Response("{}", { status: code }));
      expect(await requestAnswer(REQUEST, () => {})).toEqual({ kind, status });
    });
  }

  it("연결 실패, 빈 답변, 도중 끊김은 다시 시도할 수 있는 실패다", async () => {
    const failed = { kind: "failed", status: STATUS.chatFailed };

    stubFetch(new TypeError("연결 실패"));
    expect(await requestAnswer(REQUEST, () => {})).toEqual(failed);

    stubFetch(new Response(streamOf([])));
    expect(await requestAnswer(REQUEST, () => {})).toEqual(failed);

    stubFetch(new Response(streamOf([encoder.encode("검색어:")], true)));
    expect(await requestAnswer(REQUEST, () => {})).toEqual(failed);
  });
});

describe("isChatRequest", () => {
  it("형식이 맞을 때만 참이다", () => {
    expect(isChatRequest(REQUEST)).toBe(true);
    expect(
      isChatRequest({ ...REQUEST, context: { brand: null, item: "헤드셋" } }),
    ).toBe(true);
    expect(isChatRequest(null)).toBe(false);
    expect(isChatRequest({ ...REQUEST, requestId: 1 })).toBe(false);
    expect(isChatRequest({ ...REQUEST, context: { item: "헤드셋" } })).toBe(
      false,
    );
  });
});
