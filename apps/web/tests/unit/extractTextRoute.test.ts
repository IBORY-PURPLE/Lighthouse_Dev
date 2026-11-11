import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST, runtime } from "@/app/api/volunteer/extract-text/route";
import { ACCESS_COOKIE, hashAccessCode } from "@/lib/access";
import { issueDeviceCookie, VOLUNTEER_COOKIE } from "@/lib/volunteerSession";

// 일반 시험은 실제 엔진을 부르지 않는다.
const { openaiCreate } = vi.hoisted(() => ({ openaiCreate: vi.fn() }));
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create: openaiCreate } };
  }
  return { default: FakeOpenAI };
});

const ORIGIN = "http://localhost:3000";
const IMAGE_BYTES = Buffer.from("이미지-원본-바이트-표시");
const IMAGE = `data:image/jpeg;base64,${IMAGE_BYTES.toString("base64")}`;
const VALID = {
  requestId: "6f1c2e4a-1111-4222-8333-444455556666",
  pieceIndex: 0,
  pieceCount: 3,
  image: IMAGE,
};

let nextClient = 1;

function pieceRequest(
  body: unknown,
  {
    cookie = true,
    client,
  }: { cookie?: boolean | string; client?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": client ?? `198.51.100.${(nextClient += 1)}`,
  };
  // true면 입장한 기기의 lh_vol, 문자열이면 그 쿠키 헤더 그대로.
  if (cookie === true) headers.cookie = `${VOLUNTEER_COOKIE}=${issueDeviceCookie()}`;
  else if (cookie) headers.cookie = cookie;
  return new NextRequest(`${ORIGIN}/api/volunteer/extract-text`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(response: Response) {
  return (await response.json()) as { ok: boolean; error: string };
}

describe("POST /api/volunteer/extract-text", () => {
  let logs: string[];

  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_CODE", "right-code");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("UPSTAGE_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("EXTRACT_MODE", "mock");
    openaiCreate.mockReset();
    logs = [];
    for (const method of ["info", "log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logs.push(args.map(String).join(" "));
      });
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("nodejs 런타임, 최대 60초다", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("가짜 엔진으로 조각 글자를 돌려주고 Server-Timing engine을 붙인다", async () => {
    const response = await POST(pieceRequest({ ...VALID, pieceIndex: 1 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/^engine;dur=\d+$/);
    const body = await response.json();
    expect(body).toMatchObject({ pieceIndex: 1, lowConfidence: [], engine: "mock" });
    expect(body.text).toContain("[조각 2/3]");
  });

  it("lh_vol이 없거나 틀리면 401이다(lh_access만으로는 안 된다)", async () => {
    const accessOnly = `${ACCESS_COOKIE}=${hashAccessCode("right-code")}`;
    const tampered = `${VOLUNTEER_COOKIE}=${issueDeviceCookie()}x`;
    for (const cookie of [false, accessOnly, tampered]) {
      const response = await POST(pieceRequest(VALID, { cookie }));
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toEqual({ ok: false, error: "unauthorized" });
    }
  });

  it("형식이 틀리거나 pieceCount가 30을 넘으면 400 invalid_request다", async () => {
    for (const body of [
      "not json",
      { ...VALID, requestId: "abc" },
      { ...VALID, pieceIndex: 3 },
      { ...VALID, pieceIndex: -1 },
      { ...VALID, pieceCount: 31, pieceIndex: 0 },
      { ...VALID, image: 3 },
    ]) {
      const response = await POST(pieceRequest(body));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).error).toBe("invalid_request");
    }
  });

  it("디코드 1.5MB를 넘는 조각은 413 image_too_large다", async () => {
    const big = Buffer.alloc(1.5 * 1024 * 1024 + 10, 1).toString("base64");
    const response = await POST(
      pieceRequest({ ...VALID, image: `data:image/jpeg;base64,${big}` }),
    );
    expect(response.status).toBe(413);
    expect((await errorOf(response)).error).toBe("image_too_large");
  });

  it("jpeg·png data URL이 아니면 415 bad_image_format이다", async () => {
    for (const image of ["data:image/gif;base64,AAAA", "https://example.com/a.jpg"]) {
      const response = await POST(pieceRequest({ ...VALID, image }));
      expect(response.status).toBe(415);
      expect((await errorOf(response)).error).toBe("bad_image_format");
    }
  });

  it("분당 60회를 넘으면 429와 Retry-After다", async () => {
    const client = "198.51.100.250";
    for (let i = 0; i < 60; i++) {
      expect((await POST(pieceRequest(VALID, { client }))).status).toBe(200);
    }
    const response = await POST(pieceRequest(VALID, { client }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await errorOf(response)).error).toBe("rate_limited");
  });

  it("엔진 키가 없으면 503 not_configured다", async () => {
    vi.stubEnv("EXTRACT_MODE", "");
    const response = await POST(pieceRequest(VALID));
    expect(response.status).toBe(503);
    expect((await errorOf(response)).error).toBe("not_configured");
  });

  it("엔진 실패는 502 extract_failed, 엔진 429는 429, 글자 없음은 422 no_text다", async () => {
    vi.stubEnv("EXTRACT_MODE", "");
    vi.stubEnv("OPENAI_API_KEY", "fake-openai-key-must-not-appear");
    openaiCreate.mockRejectedValueOnce(new Error("upstream boom"));
    let response = await POST(pieceRequest(VALID));
    expect(response.status).toBe(502);
    expect((await errorOf(response)).error).toBe("extract_failed");

    openaiCreate.mockRejectedValueOnce(Object.assign(new Error("slow down"), { status: 429 }));
    response = await POST(pieceRequest(VALID));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");

    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });
    response = await POST(pieceRequest(VALID));
    expect(response.status).toBe(422);
    expect((await errorOf(response)).error).toBe("no_text");
  });

  it("로그에는 상태·조각 번호·시간만 있고 이미지·글자·키는 없다", async () => {
    vi.stubEnv("EXTRACT_MODE", "");
    vi.stubEnv("OPENAI_API_KEY", "fake-openai-key-must-not-appear");
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "읽은-글자-비밀-표시" } }],
    });
    const response = await POST(pieceRequest({ ...VALID, pieceIndex: 2 }));
    expect(response.status).toBe(200);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^POST \/api\/volunteer\/extract-text 200 piece=2 \d+ms$/);
    const all = logs.join("\n");
    expect(all).not.toContain(IMAGE_BYTES.toString("base64"));
    expect(all).not.toContain("읽은-글자-비밀-표시");
    expect(all).not.toContain("fake-openai-key-must-not-appear");
  });
});
