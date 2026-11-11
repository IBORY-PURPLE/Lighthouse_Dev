import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST, runtime } from "@/app/api/volunteer/summarize/route";
import { ACCESS_COOKIE, hashAccessCode } from "@/lib/access";
import { mockPieceText } from "@/lib/extract";
import { LLM_MODEL } from "@/lib/llm";
import { isSummaryDraft, SUMMARY_TEXT_LIMIT } from "@/lib/summaryDraft";

// 일반 시험은 실제 Groq를 부르지 않는다(.claude/rules/chatbot-quality.md).
const { groqCreate } = vi.hoisted(() => ({ groqCreate: vi.fn() }));
vi.mock("groq-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("groq-sdk")>();
  class FakeGroq {
    chat = { completions: { create: groqCreate } };
  }
  return { ...actual, default: FakeGroq };
});

const ORIGIN = "http://localhost:3000";
const SOURCE = mockPieceText(0, 1);
const VALID = {
  requestId: "6f1c2e4a-1111-4222-8333-444455556666",
  context: { product: "sony 헤드셋" },
  source: "ocr",
  text: SOURCE,
};

let nextClient = 1;

function summarizeRequest(
  body: unknown,
  {
    cookie = true,
    volunteer = "v-01",
    client,
  }: { cookie?: boolean; volunteer?: string | null; client?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": client ?? `192.0.2.${(nextClient += 1)}`,
  };
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${hashAccessCode("right-code")}`;
  if (volunteer) headers["x-demo-volunteer"] = volunteer;
  return new NextRequest(`${ORIGIN}/api/volunteer/summarize`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const errorOf = async (response: Response) => (await response.json()).error;

describe("POST /api/volunteer/summarize", () => {
  let logs: string[];

  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_CODE", "right-code");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("EXTRACT_MODE", "mock");
    groqCreate.mockReset();
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

  it("nodejs 런타임이다", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });

  it("가짜 LLM의 틀린 근거는 unverified, 가격 항목은 빠진 초안을 돌려준다", async () => {
    const response = await POST(
      summarizeRequest({ ...VALID, unreadable: [2], lowConfidence: [] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/^llm;dur=\d+$/);
    const draft = await response.json();
    expect(isSummaryDraft(draft)).toBe(true);
    expect(draft.source).toBe("ocr");
    expect(draft.unreadable).toEqual([2]);
    const byKey = Object.fromEntries(
      draft.fields.map((field: { key: string }) => [field.key, field]),
    );
    expect(byKey.productName).toMatchObject({ check: "matched", value: "가짜 헤드셋 LH-200" });
    expect(byKey.spec).toMatchObject({ check: "unverified", value: null, needsCheck: true });
    expect(byKey.components).toMatchObject({ check: "missing" });
    const text = JSON.stringify(draft.fields.map((f: { key: string; label: string }) => [f.key, f.label]));
    expect(text).not.toMatch(/price|가격|재고|할인|stock|discount/i);
  });

  it("source manual도 같은 모양의 초안이다", async () => {
    const response = await POST(summarizeRequest({ ...VALID, source: "manual" }));
    expect(response.status).toBe(200);
    const draft = await response.json();
    expect(isSummaryDraft(draft)).toBe(true);
    expect(draft.source).toBe("manual");
  });

  it("쿠키 없음 401, 봉사자 헤더 없음 403이다", async () => {
    expect((await POST(summarizeRequest(VALID, { cookie: false }))).status).toBe(401);
    const response = await POST(summarizeRequest(VALID, { volunteer: null }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("unknown_volunteer");
  });

  it("빈 글은 400 empty_text, 상한을 넘으면 400 too_long, 형식이 틀리면 400 invalid_request다", async () => {
    let response = await POST(summarizeRequest({ ...VALID, text: "   " }));
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("empty_text");

    response = await POST(
      summarizeRequest({ ...VALID, text: "가".repeat(SUMMARY_TEXT_LIMIT + 1) }),
    );
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("too_long");

    for (const body of [
      "nope",
      { ...VALID, source: "web" },
      { ...VALID, requestId: "x" },
      { ...VALID, unreadable: [-1] },
    ]) {
      response = await POST(summarizeRequest(body));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("분당 20회를 넘으면 429와 Retry-After다", async () => {
    const client = "192.0.2.250";
    for (let i = 0; i < 20; i++) {
      expect((await POST(summarizeRequest(VALID, { client }))).status).toBe(200);
    }
    const response = await POST(summarizeRequest(VALID, { client }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("Groq 키가 없으면 503 not_configured다", async () => {
    vi.stubEnv("EXTRACT_MODE", "");
    const response = await POST(summarizeRequest(VALID));
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe("not_configured");
  });

  it("실제 모드는 Groq gpt-oss JSON 모드로 부르고, 틀린 JSON·오류는 502, 429는 429다", async () => {
    vi.stubEnv("EXTRACT_MODE", "");
    vi.stubEnv("GROQ_API_KEY", "fake-groq-key-must-not-appear");
    groqCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              fields: [
                { key: "productName", value: "가짜 헤드셋 LH-200", evidence: "가짜 헤드셋 LH-200" },
              ],
            }),
          },
        },
      ],
    });
    let response = await POST(summarizeRequest(VALID));
    expect(response.status).toBe(200);
    expect((await response.json()).fields[0].check).toBe("matched");
    const [request] = groqCreate.mock.calls[0];
    expect(request.model).toBe(LLM_MODEL);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.stream).toBeUndefined();

    groqCreate.mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }] });
    response = await POST(summarizeRequest(VALID));
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe("llm_failed");

    groqCreate.mockRejectedValueOnce(new Error("boom"));
    response = await POST(summarizeRequest(VALID));
    expect(response.status).toBe(502);

    const { RateLimitError } = await import("groq-sdk");
    groqCreate.mockRejectedValueOnce(
      new RateLimitError(429, {}, "limit", new Headers()),
    );
    response = await POST(summarizeRequest(VALID));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");

    const all = logs.join("\n");
    expect(all).not.toContain("가짜 헤드셋");
    expect(all).not.toContain("fake-groq-key-must-not-appear");
    expect(logs.every((line) => /^POST \/api\/volunteer\/summarize \d{3} \d+ms$/.test(line))).toBe(true);
  });
});
