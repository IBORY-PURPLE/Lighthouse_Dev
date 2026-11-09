import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtractError,
  extractText,
  getExtractEngine,
  isSummaryConfigured,
  MOCK_SUMMARY_JSON,
  mockPieceText,
  OPENAI_EXTRACT_MODEL,
  requestSummaryJson,
} from "@/lib/extract";

// 일반 시험은 실제 OpenAI·Groq·Upstage를 부르지 않는다.
const { openaiCreate } = vi.hoisted(() => ({ openaiCreate: vi.fn() }));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create: openaiCreate } };
  }
  return { default: FakeOpenAI };
});

const IMAGE = `data:image/jpeg;base64,${Buffer.from("fake-jpeg").toString("base64")}`;

function clearKeys() {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("UPSTAGE_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("EXTRACT_MODE", "");
  vi.stubEnv("VERCEL_ENV", "");
}

describe("getExtractEngine", () => {
  beforeEach(clearKeys);
  afterEach(() => vi.unstubAllEnvs());

  it("EXTRACT_MODE=mock이면 mock이다", () => {
    vi.stubEnv("EXTRACT_MODE", "mock");
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    expect(getExtractEngine()).toBe("mock");
  });

  it("운영 환경에서는 EXTRACT_MODE=mock을 무시한다", () => {
    vi.stubEnv("EXTRACT_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getExtractEngine()).toBeNull();
  });

  it("키가 둘 다 있으면 OpenAI, Upstage만 있으면 Upstage, 없으면 null이다", () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    vi.stubEnv("UPSTAGE_API_KEY", "fake-upstage");
    expect(getExtractEngine()).toBe("openai");
    vi.stubEnv("OPENAI_API_KEY", "  ");
    expect(getExtractEngine()).toBe("upstage");
    vi.stubEnv("UPSTAGE_API_KEY", "");
    expect(getExtractEngine()).toBeNull();
  });
});

describe("extractText", () => {
  beforeEach(() => {
    clearKeys();
    openaiCreate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("mock은 조각 번호가 들어간 고정 글자를 돌려준다", async () => {
    vi.stubEnv("EXTRACT_MODE", "mock");
    const result = await extractText({ image: IMAGE, pieceIndex: 2, pieceCount: 4 });
    expect(result).toEqual({
      text: mockPieceText(2, 4),
      lowConfidence: [],
      engine: "mock",
    });
    expect(result.text).toContain("[조각 3/4]");
  });

  it("엔진이 없으면 not_configured다", async () => {
    await expect(
      extractText({ image: IMAGE, pieceIndex: 0, pieceCount: 1 }),
    ).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("OpenAI는 luna 모델, detail original, 추론 끔으로 부르고 lowConfidence는 빈 배열이다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: " 상품명: LH-200 " } }],
    });
    const result = await extractText({ image: IMAGE, pieceIndex: 0, pieceCount: 1 });
    expect(result).toEqual({ text: "상품명: LH-200", lowConfidence: [], engine: "openai" });
    const [request] = openaiCreate.mock.calls[0];
    expect(request.model).toBe(OPENAI_EXTRACT_MODEL);
    expect(OPENAI_EXTRACT_MODEL).toMatch(/luna/);
    expect(request.reasoning_effort).toBe("none");
    expect(request.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: IMAGE, detail: "original" },
    });
  });

  it("OpenAI 429는 rate_limited, 그 밖의 오류는 failed, 빈 글자는 no_text다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-openai");
    openaiCreate.mockRejectedValueOnce(Object.assign(new Error("rate"), { status: 429 }));
    await expect(
      extractText({ image: IMAGE, pieceIndex: 0, pieceCount: 1 }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    openaiCreate.mockRejectedValueOnce(new Error("boom"));
    await expect(
      extractText({ image: IMAGE, pieceIndex: 0, pieceCount: 1 }),
    ).rejects.toMatchObject({ kind: "failed" });
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: "  " } }] });
    await expect(
      extractText({ image: IMAGE, pieceIndex: 0, pieceCount: 1 }),
    ).rejects.toBeInstanceOf(ExtractError);
  });

  it("Upstage는 신뢰도 낮은 단어를 돌려준다", async () => {
    vi.stubEnv("UPSTAGE_API_KEY", "fake-upstage");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "LH-200 블랙",
          pages: [
            { words: [{ text: "LH-200", confidence: 0.99 }, { text: "블랙", confidence: 0.4 }] },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractText({ image: IMAGE, pieceIndex: 0, pieceCount: 1 });
    expect(result).toEqual({ text: "LH-200 블랙", lowConfidence: ["블랙"], engine: "upstage" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer fake-upstage");
  });
});

describe("requestSummaryJson", () => {
  beforeEach(clearKeys);
  afterEach(() => vi.unstubAllEnvs());

  it("mock이면 고정 JSON이고, Groq 키가 없으면 설정 안 됨이다", async () => {
    expect(isSummaryConfigured()).toBe(false);
    await expect(requestSummaryJson({ product: "", text: "가" })).rejects.toMatchObject({
      kind: "not_configured",
    });
    vi.stubEnv("EXTRACT_MODE", "mock");
    expect(isSummaryConfigured()).toBe(true);
    expect(await requestSummaryJson({ product: "", text: "가" })).toBe(MOCK_SUMMARY_JSON);
  });
});
