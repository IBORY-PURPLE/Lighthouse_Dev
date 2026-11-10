import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/match/route";

const ORIGIN = "http://localhost:3000";
const PASS_SENTENCE = "sony껄로 헤드셋 사고싶어";

let nextClient = 1;

function matchRequest(body: string, { client }: { client?: string } = {}) {
  return new NextRequest(`${ORIGIN}/api/match`, {
    method: "POST",
    body,
    headers: {
      "x-forwarded-for": client ?? `203.0.113.${(nextClient += 1)}`,
    },
  });
}

const textBody = (text: string) => JSON.stringify({ text });

describe("POST /api/match", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("합격 문장에 봉사자와 요청 번호를 돌려준다", async () => {
    const response = await POST(matchRequest(textBody(PASS_SENTENCE)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.volunteer).toEqual({
      id: "vol-01",
      displayName: "등록 봉사자",
    });
    expect(body.request).toEqual({
      brand: "Sony",
      item: "헤드셋",
      raw: PASS_SENTENCE,
    });
  });

  it("요청마다 번호가 다르다", async () => {
    const first = await (await POST(matchRequest(textBody("소니 헤드셋")))).json();
    const second = await (await POST(matchRequest(textBody("소니 헤드셋")))).json();
    expect(first.requestId).not.toBe(second.requestId);
  });

  it("로그인 쿠키 없이 200이고 등록 봉사자로 연결한다", async () => {
    const response = await POST(matchRequest(textBody(PASS_SENTENCE)));
    expect(response.status).toBe(200);
    expect((await response.json()).volunteer).toEqual({
      id: "vol-01",
      displayName: "등록 봉사자",
    });
  });

  it("브랜드가 없는 요청도 같은 등록 봉사자로 연결한다", async () => {
    const response = await POST(matchRequest(textBody("헤드폰 사고싶어")));
    expect(response.status).toBe(200);
    expect((await response.json()).volunteer).toEqual({
      id: "vol-01",
      displayName: "등록 봉사자",
    });
  });

  it("200자는 통과하고 201자는 400이다", async () => {
    const pad = (length: number) => "헤드셋".padEnd(length, "가");
    expect((await POST(matchRequest(textBody(pad(200))))).status).toBe(200);
    const tooLong = await POST(matchRequest(textBody(pad(201))));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toBe("too_long");
  });

  for (const [name, body] of [
    ["JSON이 아님", "not json"],
    ["null", "null"],
    ["text 없음", "{}"],
    ["text가 숫자", '{"text":1}'],
    ["빈 문장", '{"text":"   "}'],
  ]) {
    it(`형식 오류는 400이다: ${name}`, async () => {
      const response = await POST(matchRequest(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_request");
    });
  }

  it("품목이 없으면 422 need_item이다", async () => {
    const response = await POST(matchRequest(textBody("sony껄로 사고싶어")));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "need_item" });
  });

  it("같은 주소에서 분당 31번째는 429이고 다른 주소는 영향이 없다", async () => {
    const client = "198.51.100.77";
    for (let i = 0; i < 30; i += 1) {
      const response = await POST(
        matchRequest(textBody("소니 헤드셋"), { client }),
      );
      expect(response.status).toBe(200);
    }
    const limited = await POST(
      matchRequest(textBody("소니 헤드셋"), { client }),
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const other = await POST(
      matchRequest(textBody("소니 헤드셋"), { client: "198.51.100.78" }),
    );
    expect(other.status).toBe(200);
  });

  it("로그에 사용자 문장을 남기지 않고 상태 코드와 소요 시간만 남긴다", async () => {
    const logged: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args);
      });
    }

    await POST(matchRequest(textBody(PASS_SENTENCE)));
    await POST(matchRequest(textBody("비밀 문장 사고싶어")));

    expect(logged.map((args) => args.join(" "))).toEqual([
      expect.stringMatching(/^POST \/api\/match 200 \d+ms$/),
      expect.stringMatching(/^POST \/api\/match 422 \d+ms$/),
    ]);
  });
});
