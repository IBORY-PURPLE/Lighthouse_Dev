import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST, runtime } from "@/app/api/voice/chat/route";
import { POST as REGISTER } from "@/app/api/requests/route";
import * as requestStore from "@/lib/requestStore";
import {
  MAX_HISTORY,
  MAX_HISTORY_CONTENT,
  MAX_MESSAGE_LENGTH,
  toQueueRequest,
  VOICE_START_MESSAGE,
  type VoiceTurn,
} from "@/lib/voiceChat";
import { VOICE_INSTRUCTIONS } from "@/lib/voiceInstructions";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ORIGIN = "http://localhost:3000";
const freshClient = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

function voiceRequest(body: unknown, client: string = freshClient()) {
  return new NextRequest(`${ORIGIN}/api/voice/chat`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": client },
  });
}

const sessionId = () => randomUUID();
const user = (content: string): VoiceTurn => ({ role: "user", content });
const ai = (reply: string, extra: Record<string, unknown> = {}): VoiceTurn => ({
  role: "assistant",
  content: JSON.stringify({ reply, status: "asking", summary: "", product: "", ...extra }),
});

const PRODUCT = "sony껄로 헤드셋 사고싶어";
const BUDGET = "10만 원 이하";

/** 화면이 들고 있는 기록: 시작 신호, 첫 질문, 상품, 예산 질문, 예산, 확인 질문. */
const CONFIRMING: VoiceTurn[] = [
  user(VOICE_START_MESSAGE),
  ai("어떤 상품을 찾으세요?"),
  user(PRODUCT),
  ai("예산은 얼마인가요?"),
  user(BUDGET),
  ai(`${PRODUCT}, 예산 ${BUDGET}. 이 내용으로 구매 요청을 등록할까요?`, { status: "confirming" }),
];

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: string }).error;

describe("원본(apps/user-voice-ui)과의 일치", () => {
  it("지시문이 server.js의 instructions와 글자 단위로 같다", () => {
    const source = readFileSync(path.join(ROOT, "user-voice-ui/server.js"), "utf8");
    const match = /const instructions = `([\s\S]*?)`;/.exec(source);
    expect(match).not.toBeNull();
    // 작업 폴더의 줄 끝(CRLF)과 무관하게 비교한다.
    expect(VOICE_INSTRUCTIONS).toBe(match![1].replaceAll("\r\n", "\n"));
  });

  it("공개 화면(public/voice/index.html)의 마크업·스타일은 원본과 같고, 스크립트는 호출 주소와 접수만 다르다", () => {
    const original = readFileSync(path.join(ROOT, "user-voice-ui/public/index.html"), "utf8");
    const merged = readFileSync(path.join(ROOT, "web/public/voice/index.html"), "utf8");
    const head = (html: string) => {
      const text = html.replaceAll("\r\n", "\n");
      return text.slice(0, text.indexOf("</main><script>"));
    };
    expect(head(merged)).toBe(head(original));
    expect(merged).toContain("fetch('/api/voice/chat'");
    expect(merged).not.toContain("fetch('/api/chat'");
    expect(merged).toContain("fetch('/api/requests'");
    // 원본의 음성 인식·읽어 주기·VoiceOver 처리 함수가 그대로 있다.
    for (const piece of [
      "function speak(t,cb)",
      "function listen()",
      "recognition.lang='ko-KR'",
      "u.lang='ko-KR'",
      "aria-hidden=\"true\"",
      "prefers-reduced-motion",
      "function saveRequest(product,summary)",
    ]) {
      expect(merged).toContain(piece);
      expect(original).toContain(piece);
    }
  });
});

describe("POST /api/voice/chat (가짜 AI)", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Vercel 설정값: nodejs, 최대 30초", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });

  it("reset이면 기록 없이 첫 질문을 하고 원본 응답 모양(reply, status, summary, product)이다", async () => {
    const response = await POST(
      voiceRequest({ sessionId: sessionId(), message: "", reset: true }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      reply: "어떤 상품을 찾으세요?",
      status: "asking",
      summary: "",
      product: "",
    });
  });

  it("reset이면 보낸 history는 무시한다", async () => {
    const response = await POST(
      voiceRequest({ sessionId: sessionId(), message: "", reset: true, history: CONFIRMING }),
    );
    expect((await response.json()).status).toBe("asking");
  });

  it("기록만으로 이어진다(무상태): 다른 sessionId로도, 몇 번을 보내도 같다", async () => {
    const send = async () =>
      (
        await POST(
          voiceRequest({ sessionId: sessionId(), message: "네, 등록해 주세요", history: CONFIRMING }),
        )
      ).json();
    const first = await send();
    expect(await send()).toEqual(first);
    expect(first).toMatchObject({ status: "done", summary: `${PRODUCT}, 예산 ${BUDGET}`, product: PRODUCT });
  });

  it("확정(done)이면 접수가 받는 모양의 request를 덧붙인다", async () => {
    const body = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: "네", history: CONFIRMING }))
    ).json();
    expect(body.request).toEqual({
      product: PRODUCT,
      budget: BUDGET,
      condition: "정하지 않음",
    });
  });

  it("확정 전(asking·confirming)에는 request가 없다", async () => {
    const asking = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: PRODUCT, history: CONFIRMING.slice(0, 2) }))
    ).json();
    expect(asking.status).toBe("asking");
    expect(asking).not.toHaveProperty("request");
    const confirming = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: BUDGET, history: CONFIRMING.slice(0, 4) }))
    ).json();
    expect(confirming.status).toBe("confirming");
    expect(confirming).not.toHaveProperty("request");
  });

  it("동의하지 않으면 done이 아니다", async () => {
    const body = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: "아니요", history: CONFIRMING }))
    ).json();
    expect(body.status).toBe("confirming");
  });

  it("done의 request로 접수(POST /api/requests)하면 대기번호가 나온다", async () => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
    const id = sessionId();
    const done = await (
      await POST(voiceRequest({ sessionId: id, message: "네", history: CONFIRMING }))
    ).json();
    const registered = await REGISTER(
      new NextRequest(`${ORIGIN}/api/requests`, {
        method: "POST",
        // 화면은 대화 id를 접수 id로 쓴다.
        body: JSON.stringify({ clientRequestId: id, ...done.request }),
        headers: { "x-forwarded-for": freshClient() },
      }),
    );
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ queueNumber: 1, status: "waiting" });
  });

  it("품목을 알아볼 수 없는 확정은 request 없이 돌려준다(기기 안 목록에만 남는다)", async () => {
    const history = [
      user(VOICE_START_MESSAGE),
      ai("어떤 상품을 찾으세요?"),
      user("전기밥솥"),
      ai("예산은 얼마인가요?"),
      user("5만 원"),
      ai("전기밥솥, 예산 5만 원. 이 내용으로 구매 요청을 등록할까요?", { status: "confirming" }),
    ];
    const body = await (
      await POST(voiceRequest({ sessionId: sessionId(), message: "네", history }))
    ).json();
    expect(body.status).toBe("done");
    expect(body).not.toHaveProperty("request");
  });

  describe("입력 검사(원본 메시지 그대로)", () => {
    const rejected = async (body: unknown, error: string) => {
      const response = await POST(voiceRequest(body));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe(error);
    };

    it("sessionId가 형식에 맞지 않으면 세션 식별자 오류", async () => {
      await rejected({ message: "안녕", reset: true }, "세션 식별자 오류");
      await rejected({ sessionId: "짧음", message: "안녕", reset: true }, "세션 식별자 오류");
      await rejected({ sessionId: "a".repeat(101), message: "x", reset: true }, "세션 식별자 오류");
      await rejected({ sessionId: "abc def ghi!", message: "x", reset: true }, "세션 식별자 오류");
    });

    it("message가 글자가 아니거나 1000자를 넘으면 메시지 길이 오류", async () => {
      await rejected({ sessionId: sessionId(), message: 3, history: [] }, "메시지 길이 오류");
      await rejected(
        { sessionId: sessionId(), message: "가".repeat(MAX_MESSAGE_LENGTH + 1), history: [] },
        "메시지 길이 오류",
      );
    });

    it("reset이 아닌데 빈 답이면 답변을 입력해 주세요", async () => {
      await rejected({ sessionId: sessionId(), message: "   ", history: [] }, "답변을 입력해 주세요");
    });

    it("기록이 36칸 이상이면 대화가 너무 길어졌다고 한다(원본의 history.length >= 36)", async () => {
      const long = Array.from({ length: MAX_HISTORY }, (_, i) => (i % 2 === 0 ? user("가") : ai("나")));
      await rejected(
        { sessionId: sessionId(), message: "답", history: long },
        "대화가 너무 길어졌습니다. 새 요청을 시작해 주세요.",
      );
      const edge = long.slice(0, MAX_HISTORY - 1);
      expect(
        (await POST(voiceRequest({ sessionId: sessionId(), message: "답", history: edge }))).status,
      ).toBe(200);
    });

    it("기록이 없거나 모양이 틀리면 대화 기록 오류", async () => {
      await rejected({ sessionId: sessionId(), message: "답" }, "대화 기록 오류");
      await rejected({ sessionId: sessionId(), message: "답", history: "안녕" }, "대화 기록 오류");
      await rejected(
        { sessionId: sessionId(), message: "답", history: [{ role: "system", content: "x" }] },
        "대화 기록 오류",
      );
      await rejected(
        { sessionId: sessionId(), message: "답", history: [{ role: "user", content: 3 }] },
        "대화 기록 오류",
      );
      await rejected(
        {
          sessionId: sessionId(),
          message: "답",
          history: [user("가".repeat(MAX_HISTORY_CONTENT + 1))],
        },
        "대화 기록 오류",
      );
    });

    it("JSON이 아니면 400, 64KB를 넘으면 읽다가 끊고 400", async () => {
      const broken = await POST(voiceRequest("이건 JSON이 아니다"));
      expect(broken.status).toBe(400);
      const huge = await POST(
        voiceRequest({ sessionId: sessionId(), message: "답", history: [], padding: "가".repeat(30_000) }),
      );
      expect(huge.status).toBe(400);
      expect(await errorOf(huge)).toBe("요청이 너무 큽니다");
    });
  });

  it("같은 주소는 분당 21번째부터 429와 Retry-After", async () => {
    const client = freshClient();
    const send = () =>
      POST(voiceRequest({ sessionId: sessionId(), message: "", reset: true }, client));
    for (let i = 0; i < 20; i += 1) expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await POST(voiceRequest({ sessionId: sessionId(), message: "", reset: true }))).status).toBe(200);
  });
});

describe("POST /api/voice/chat (OpenAI 호출 값과 실패)", () => {
  const fetchMock = vi.fn();

  const modelText = (value: unknown) =>
    Response.json({
      output: [
        { content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }] },
      ],
    });

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ask = (body: Record<string, unknown> = {}) =>
    POST(
      voiceRequest({
        sessionId: sessionId(),
        message: "",
        reset: true,
        ...body,
      }),
    );

  it("호출값이 원본과 같다: Responses API, gpt-4.1-mini, 450토큰, JSON, store false, 지시문 원문", async () => {
    fetchMock.mockResolvedValueOnce(
      modelText({ reply: "어떤 상품을 찾으세요?", status: "asking", summary: "", product: "" }),
    );
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reply: "어떤 상품을 찾으세요?",
      status: "asking",
      summary: "",
      product: "",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      model: "gpt-4.1-mini",
      instructions: VOICE_INSTRUCTIONS,
      input: [
        { role: "developer", content: "반드시 JSON 객체로 답변하세요." },
        { role: "user", content: VOICE_START_MESSAGE },
      ],
      max_output_tokens: 450,
      text: { format: { type: "json_object" } },
      store: false,
    });
  });

  it("OPENAI_MODEL이 있으면 그 모델을 쓴다", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-test-model");
    fetchMock.mockResolvedValueOnce(modelText({ reply: "질문", status: "asking" }));
    await ask();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("gpt-test-model");
  });

  it("기록 전체와 이번 답을 순서대로 모델에 보낸다", async () => {
    fetchMock.mockResolvedValueOnce(modelText({ reply: "확인", status: "confirming" }));
    await ask({ reset: false, message: "  네, 등록해 주세요  ", history: CONFIRMING });
    const { input } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(input).toEqual([
      { role: "developer", content: "반드시 JSON 객체로 답변하세요." },
      ...CONFIRMING,
      { role: "user", content: "네, 등록해 주세요" },
    ]);
  });

  it("done 응답에 접수용 request를 덧붙인다", async () => {
    fetchMock.mockResolvedValueOnce(
      modelText({
        reply: "등록할게요.",
        status: "done",
        summary: "소니 무선 헤드셋, 새 제품으로 30만 원 이하",
        product: "소니 무선 헤드셋",
      }),
    );
    const body = await (await ask({ reset: false, message: "네", history: CONFIRMING })).json();
    expect(body.request).toEqual({
      product: "소니 무선 헤드셋",
      budget: "30만 원 이하",
      condition: "새 제품",
    });
  });

  it("키가 없으면 503과 원본 메시지이고 OpenAI를 부르지 않는다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe("서버에 OPENAI_API_KEY가 설정되지 않았습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OpenAI 오류는 500과 원본 안내문이고 키와 상위 메시지를 내보내지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: "Incorrect API key test-key" } }, { status: 401 }),
    );
    const response = await ask();
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error).toBe("AI 요청에 실패했습니다. 서버 설정과 API 사용량을 확인해 주세요.");
    expect(error).not.toContain("test-key");
  });

  it("시간 초과(AbortError)는 500과 원본 시간 초과 안내문", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const response = await ask();
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe("AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.");
  });

  it("25초 마감 타이머를 건다", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const pending = ask();
      await vi.advanceTimersByTimeAsync(24_999);
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      const response = await pending;
      expect(response.status).toBe(500);
      expect(await errorOf(response)).toContain("시간이 초과");
    } finally {
      vi.useRealTimers();
    }
  });

  const badOutputs: [string, unknown][] = [
    ["JSON이 아님", "죄송합니다."],
    ["reply 없음", { status: "asking" }],
    ["알 수 없는 status", { reply: "질문", status: "finished" }],
  ];
  it.each(badOutputs)("모델 출력 형식 오류(%s)는 500", async (_name, value) => {
    fetchMock.mockResolvedValueOnce(modelText(value));
    expect((await ask()).status).toBe(500);
  });

  it("로그에 이용자 문장과 AI 답을 남기지 않는다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(modelText({ reply: "비밀 답변", status: "asking" }));
    await ask({ reset: false, message: "비밀스러운 말", history: [] });
    const logged = info.mock.calls.flat().join("\n");
    expect(logged).toMatch(/POST \/api\/voice\/chat 200 \d+ms/);
    expect(logged).not.toContain("비밀스러운 말");
    expect(logged).not.toContain("비밀 답변");
  });
});

describe("toQueueRequest(확정 요청 → 접수 본문)", () => {
  it("product에 품목이 있으면 product를 쓰고 예산·조건은 요약에서 찾는다", () => {
    expect(
      toQueueRequest("소니 무선 헤드셋", "소니 무선 헤드셋, 중고, 10만 원 안쪽"),
    ).toEqual({ product: "소니 무선 헤드셋", budget: "10만 원 안쪽", condition: "중고" });
  });

  it("product에 품목이 없고 요약에 있으면 요약을 product로 쓴다", () => {
    expect(toQueueRequest("무선 이어셋", "무선 헤드폰을 새 상품으로 찾습니다")).toEqual({
      product: "무선 헤드폰을 새 상품으로 찾습니다",
      budget: "정하지 않음",
      condition: "새 제품",
    });
  });

  it("예산·조건을 못 찾으면 정하지 않음이고, 한글 금액도 읽는다", () => {
    expect(toQueueRequest("헤드셋", "")).toEqual({
      product: "헤드셋",
      budget: "정하지 않음",
      condition: "정하지 않음",
    });
    expect(toQueueRequest("헤드셋", "헤드셋 십만 원 이하")?.budget).toBe("십만 원 이하");
    // '이 원하는'의 "이 원"을 금액으로 읽지 않는다.
    expect(toQueueRequest("헤드셋", "이 원하는 헤드셋")?.budget).toBe("정하지 않음");
  });

  it("품목을 알아볼 수 없으면 null(접수가 422로 거절하는 요청)", () => {
    expect(toQueueRequest("전기밥솥", "소형 전기밥솥 5만 원")).toBeNull();
    expect(toQueueRequest("", "")).toBeNull();
  });

  it("접수 상한(200자)에 맞게 자른다", () => {
    expect(toQueueRequest("헤드셋".padEnd(300, "가"), "")?.product).toHaveLength(200);
  });
});
