import { describe, expect, it, vi } from "vitest";
import {
  arrivedStatus,
  CAPTURE_STATUS,
  readCapture,
  summarizeText,
  type CaptureOutcome,
} from "@/lib/captureRead";
import { MAX_PIECES } from "@/lib/imagePieces";
import { SUMMARY_TEXT_LIMIT, type SummaryDraft } from "@/lib/summaryDraft";

const CONTEXT = { requestId: "6f1c2e4a-1111-4222-8333-444455556666", product: "소니 무선 헤드셋" };

const DRAFT: SummaryDraft = {
  draftVersion: 1,
  source: "ocr",
  fields: [
    { key: "productName", label: "상품명", value: "소니 WH-CH520", evidence: "소니 WH-CH520", check: "matched", needsCheck: false, reason: null },
    { key: "option", label: "옵션", value: null, evidence: null, check: "missing", needsCheck: false, reason: null },
    { key: "spec", label: "핵심 사양", value: null, evidence: null, check: "unverified", needsCheck: true, reason: null },
    { key: "components", label: "구성품", value: null, evidence: null, check: "missing", needsCheck: false, reason: null },
    { key: "caution", label: "주의사항", value: null, evidence: null, check: "missing", needsCheck: false, reason: null },
  ],
  missing: ["option", "components"],
  unreadable: [],
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

type Handler = (url: string, body: Record<string, unknown>) => Response | Promise<Response>;

/** 호출을 기록하는 가짜 fetch. */
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(url, body);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const pieces = (count: number) => Array.from({ length: count }, (_, index) => `data:image/jpeg;base64,AAA${index}`);
const cutInto = (counts: number[]) => {
  let file = 0;
  return vi.fn(async () => ({ pieces: pieces(counts[file++] ?? 1), enlarged: false }));
};
const files = (count: number) => Array.from({ length: count }, () => new Blob(["x"]));
const noWait = async () => {};

const extractOk = (body: Record<string, unknown>) =>
  json({ pieceIndex: body.pieceIndex, text: `조각 ${Number(body.pieceIndex) + 1} 글자`, lowConfidence: ["흐림"], engine: "mock" });

function kind(outcome: CaptureOutcome) {
  return outcome.kind;
}

describe("readCapture: 캡처 여러 장 → 조각 → 글자 읽기 → 요약", () => {
  it("파일마다 자른 조각을 순서대로 읽고, 다 읽은 뒤 요약을 한 번만 부른다", async () => {
    const { impl, calls } = fakeFetch((url, body) =>
      url.endsWith("/extract-text") ? extractOk(body) : json(DRAFT),
    );
    const statuses: string[] = [];
    const outcome = await readCapture(CONTEXT, files(2), {
      fetch: impl,
      cut: cutInto([2, 1]),
      wait: noWait,
      onStatus: (message) => statuses.push(message),
    });

    expect(outcome).toMatchObject({ kind: "draft", captureCount: 2, notice: "" });
    const extracts = calls.filter((call) => call.url === "/api/volunteer/extract-text");
    expect(extracts.map((call) => [call.body.pieceIndex, call.body.pieceCount])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(extracts.every((call) => call.body.requestId === CONTEXT.requestId)).toBe(true);
    const summaries = calls.filter((call) => call.url === "/api/volunteer/summarize");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].body).toMatchObject({
      requestId: CONTEXT.requestId,
      context: { product: CONTEXT.product },
      source: "ocr",
      lowConfidence: ["흐림", "흐림", "흐림"],
      unreadable: [],
    });
    expect(String(summaries[0].body.text)).toContain("조각 1 글자");
    expect(String(summaries[0].body.text)).toContain("조각 3 글자");
    // 안내는 시작에 한 번만(조각마다 바꾸지 않는다).
    expect(statuses).toEqual([CAPTURE_STATUS.reading(1, 3)]);
  });

  it("봉사자 헤더를 보내지 않는다(입장 쿠키가 신분이다)", async () => {
    const { impl, calls } = fakeFetch((url, body) =>
      url.endsWith("/extract-text") ? extractOk(body) : json(DRAFT),
    );
    await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([1]), wait: noWait });
    for (const call of calls) {
      expect(Object.keys(call.headers).map((name) => name.toLowerCase())).toEqual(["content-type"]);
    }
  });

  it("같은 조각이 3회 실패하면 직접 입력으로 보내고 요약은 부르지 않는다", async () => {
    const { impl, calls } = fakeFetch((url, body) =>
      url.endsWith("/extract-text") && body.pieceIndex === 1
        ? json({ ok: false, error: "extract_failed" }, 502)
        : url.endsWith("/extract-text")
          ? extractOk(body)
          : json(DRAFT),
    );
    const outcome = await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([3]), wait: noWait });
    expect(outcome).toEqual({ kind: "manual", status: CAPTURE_STATUS.extractFailed });
    expect(calls.filter((call) => call.body.pieceIndex === 1)).toHaveLength(3);
    expect(calls.some((call) => call.url.endsWith("/summarize"))).toBe(false);
  });

  it("네트워크 오류도 같은 조각 3회까지 다시 시도한다", async () => {
    let attempts = 0;
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/extract-text")) {
        attempts += 1;
        if (attempts < 3) throw new TypeError("network");
        return extractOk({ pieceIndex: 0 });
      }
      return json(DRAFT);
    }) as unknown as typeof fetch;
    const outcome = await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([1]), wait: noWait });
    expect(kind(outcome)).toBe("draft");
    expect(attempts).toBe(3);
  });

  it("상태별 안내: 413·415·503은 직접 입력, 401은 입장 화면으로", async () => {
    const expected: Array<[number, CaptureOutcome]> = [
      [413, { kind: "manual", status: CAPTURE_STATUS.tooLarge }],
      [415, { kind: "manual", status: CAPTURE_STATUS.badFormat }],
      [503, { kind: "manual", status: CAPTURE_STATUS.notConfigured }],
      [401, { kind: "stopped", status: CAPTURE_STATUS.unauthorized, unauthorized: true }],
    ];
    for (const [status, outcome] of expected) {
      const { impl, calls } = fakeFetch(() => json({ ok: false, error: "x" }, status));
      expect(await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([1]), wait: noWait })).toEqual(outcome);
      // 다시 시도해도 소용없는 상태는 한 번만 부른다.
      expect(calls).toHaveLength(1);
    }
  });

  it("글자가 없는 조각(422)은 건너뛰고 번호를 요약에 알린다. 모두 없으면 직접 입력이다", async () => {
    const { impl, calls } = fakeFetch((url, body) =>
      url.endsWith("/extract-text")
        ? body.pieceIndex === 1
          ? json({ ok: false, error: "no_text" }, 422)
          : extractOk(body)
        : json(DRAFT),
    );
    const outcome = await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([3]), wait: noWait });
    expect(kind(outcome)).toBe("draft");
    expect(calls.find((call) => call.url.endsWith("/summarize"))?.body.unreadable).toEqual([1]);

    const none = fakeFetch(() => json({ ok: false, error: "no_text" }, 422));
    expect(await readCapture(CONTEXT, files(1), { fetch: none.impl, cut: cutInto([2]), wait: noWait })).toEqual({
      kind: "manual",
      status: CAPTURE_STATUS.extractFailed,
    });
  });

  it("429는 Retry-After만큼 기다렸다가 다시 보낸다(실패로 세지 않는다)", async () => {
    let first = true;
    const { impl, calls } = fakeFetch((url, body) => {
      if (!url.endsWith("/extract-text")) return json(DRAFT);
      if (first) {
        first = false;
        return json({ ok: false, error: "rate_limited" }, 429, { "retry-after": "7" });
      }
      return extractOk(body);
    });
    const wait = vi.fn(async () => {});
    const outcome = await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([1]), wait });
    expect(kind(outcome)).toBe("draft");
    expect(wait).toHaveBeenCalledWith(7000);
    expect(calls.filter((call) => call.url.endsWith("/extract-text"))).toHaveLength(2);
  });

  it("조각 수가 상한을 넘으면 읽지 않고 멈춘다", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    const outcome = await readCapture(CONTEXT, files(1), {
      fetch: impl,
      cut: vi.fn(async () => ({ pieces: pieces(MAX_PIECES + 1), enlarged: false })),
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: "stopped", status: CAPTURE_STATUS.tooManyPieces });
    expect(calls).toHaveLength(0);
  });

  it("이미지를 자르지 못하면 직접 입력으로 보낸다", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    const cut = vi.fn(async () => {
      throw new Error("bitmap");
    });
    expect(await readCapture(CONTEXT, files(1), { fetch: impl, cut, wait: noWait })).toEqual({
      kind: "manual",
      status: CAPTURE_STATUS.extractFailed,
    });
    expect(calls).toHaveLength(0);
  });

  it("조각을 크게 잘랐으면 안내를 덧붙인다", async () => {
    const { impl } = fakeFetch((url, body) => (url.endsWith("/extract-text") ? extractOk(body) : json(DRAFT)));
    const outcome = await readCapture(CONTEXT, files(1), {
      fetch: impl,
      cut: vi.fn(async () => ({ pieces: pieces(1), enlarged: true })),
      wait: noWait,
    });
    expect(outcome).toMatchObject({ kind: "draft", notice: CAPTURE_STATUS.enlarged });
  });

  it("요약이 실패하면 멈춘다: 502는 요약 실패, 401은 입장 화면, 모양이 틀린 본문도 요약 실패", async () => {
    const cases: Array<[Response, CaptureOutcome]> = [
      [json({ ok: false }, 502), { kind: "stopped", status: CAPTURE_STATUS.summaryFailed }],
      [json({ ok: false }, 503), { kind: "stopped", status: CAPTURE_STATUS.summaryFailed }],
      [json({ ok: false }, 401), { kind: "stopped", status: CAPTURE_STATUS.unauthorized, unauthorized: true }],
      [json({ fields: "x" }), { kind: "stopped", status: CAPTURE_STATUS.summaryFailed }],
    ];
    for (const [summary, expected] of cases) {
      const { impl } = fakeFetch((url, body) => (url.endsWith("/extract-text") ? extractOk(body) : summary.clone()));
      expect(await readCapture(CONTEXT, files(1), { fetch: impl, cut: cutInto([1]), wait: noWait })).toEqual(expected);
    }
  });
});

describe("summarizeText: 글로 요약", () => {
  it("직접 입력한 글은 source manual로 보내고 같은 모양의 초안을 돌려준다", async () => {
    const { impl, calls } = fakeFetch(() => json({ ...DRAFT, source: "manual" }));
    const outcome = await summarizeText(
      CONTEXT,
      "manual",
      "상품명: 소니 WH-CH520",
      { lowConfidence: [], unreadable: [] },
      3,
      { fetch: impl, wait: noWait },
    );
    expect(outcome).toMatchObject({ kind: "draft", captureCount: 3 });
    expect(calls[0].body).toMatchObject({ source: "manual", text: "상품명: 소니 WH-CH520" });
  });

  it("글이 상한보다 길면 앞부분만 보내고 안내한다", async () => {
    const { impl, calls } = fakeFetch(() => json(DRAFT));
    const outcome = await summarizeText(
      CONTEXT,
      "manual",
      "가".repeat(SUMMARY_TEXT_LIMIT + 50),
      { lowConfidence: [], unreadable: [] },
      1,
      { fetch: impl, wait: noWait },
    );
    expect(String(calls[0].body.text)).toHaveLength(SUMMARY_TEXT_LIMIT);
    expect(outcome).toMatchObject({ kind: "draft", notice: CAPTURE_STATUS.longText });
  });

  it("도착 안내는 항목 수와 확인 필요 수를 말한다", () => {
    expect(arrivedStatus(DRAFT)).toBe("요약 초안이 도착했습니다. 항목 5개, 확인 필요 1개.");
  });
});
