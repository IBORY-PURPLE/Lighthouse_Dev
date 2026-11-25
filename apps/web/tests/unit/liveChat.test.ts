import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveChatStatus, LiveSlots, LiveTurn } from "@/lib/liveEngine";
import { gateLiveResult, mockLiveText, parseLiveText, type LiveChatResult } from "@/lib/liveChat";
import { encodeAiTurn, REPLY_MAX, SLOT_MAX } from "@/lib/liveText";

// 글자 대화 한 턴의 순수 부분: 모델 글 읽기, 서버 관문, mock. 설계서 7.3절, 16.1절.

const user = (content: string): LiveTurn => ({ role: "user", content });
const ai = (status: LiveChatStatus, slots: Partial<LiveSlots> = {}, reply = ""): LiveTurn => ({
  role: "assistant",
  content: encodeAiTurn({
    reply,
    status,
    slots: { product: "", info: "", options: "", budget: "", ...slots },
  }),
});
const slots = (s: Partial<LiveSlots>): LiveSlots => ({ product: "", info: "", options: "", budget: "", ...s });
const model = (o: Record<string, unknown>) => JSON.stringify(o);

describe("parseLiveText", () => {
  it("정상 응답을 읽는다", () => {
    const r = parseLiveText(
      model({ reply: "어떤 점이 궁금하세요?", status: "asking", product: "무선 이어폰", info: "", options: "", budget: "" }),
    );
    expect(r).toEqual({
      reply: "어떤 점이 궁금하세요?",
      status: "asking",
      slots: slots({ product: "무선 이어폰" }),
    });
  });

  it("JSON이 아니거나 객체가 아니면 던진다", () => {
    expect(() => parseLiveText("이건 JSON이 아니다")).toThrow();
    expect(() => parseLiveText("[1,2]")).toThrow();
    expect(() => parseLiveText("null")).toThrow();
  });

  it("status가 틀리면 던진다", () => {
    expect(() => parseLiveText(model({ reply: "네", status: "registered" }))).toThrow();
    expect(() => parseLiveText(model({ reply: "네" }))).toThrow();
  });

  it("reply가 문자열이 아니면 던진다", () => {
    expect(() => parseLiveText(model({ reply: 3, status: "asking" }))).toThrow();
    expect(() => parseLiveText(model({ status: "done" }))).toThrow();
  });

  it("asking인데 reply가 비면 던진다", () => {
    expect(() => parseLiveText(model({ reply: "", status: "asking", product: "청소기" }))).toThrow();
    expect(() => parseLiveText(model({ reply: "   ", status: "asking" }))).toThrow();
  });

  it("confirming은 reply가 비어도 통과한다", () => {
    const r = parseLiveText(model({ reply: "", status: "confirming", product: "청소기", info: "후기" }));
    expect(r.status).toBe("confirming");
    expect(r.reply).toBe("");
    expect(r.slots.product).toBe("청소기");
  });

  it("제품이 없는 confirming은 asking으로 낮추고 빈 reply를 채운다", () => {
    const r = parseLiveText(model({ reply: "", status: "confirming", product: "", info: "후기" }));
    expect(r.status).toBe("asking");
    expect(r.reply).toBe("어떤 제품을 찾으시는지 말씀해 주시겠어요?");
  });

  it("제품이 없는 confirming에 reply가 있으면 그 reply를 쓴다", () => {
    const r = parseLiveText(model({ reply: "무엇을 찾으세요?", status: "confirming" }));
    expect(r.status).toBe("asking");
    expect(r.reply).toBe("무엇을 찾으세요?");
  });

  it("done과 ended는 reply가 비어도 던지지 않는다", () => {
    expect(parseLiveText(model({ reply: "", status: "done", product: "청소기" })).status).toBe("done");
    expect(parseLiveText(model({ reply: "", status: "ended" })).status).toBe("ended");
  });

  it("전화번호를 가린다(reply와 칸 모두)", () => {
    const r = parseLiveText(
      model({
        reply: "연락처는 010-1234-5678 인가요?",
        status: "asking",
        product: "청소기 010-1234-5678",
      }),
    );
    expect(r.reply).not.toContain("010-1234-5678");
    expect(r.reply).toContain("(전화번호 가림)");
    expect(r.slots.product).toContain("(전화번호 가림)");
  });

  it("reply를 400자로 자르고 칸은 SLOT_MAX로 자른다", () => {
    const r = parseLiveText(
      model({ reply: "가".repeat(900), status: "asking", product: "나".repeat(500), budget: "다".repeat(500) }),
    );
    expect(r.reply.length).toBeLessThanOrEqual(REPLY_MAX);
    expect(r.reply.endsWith("…")).toBe(true);
    expect(r.slots.product.length).toBeLessThanOrEqual(SLOT_MAX.product);
    expect(r.slots.budget.length).toBeLessThanOrEqual(SLOT_MAX.budget);
  });

  it("칸이 문자열이 아니면 빈 칸이다", () => {
    const r = parseLiveText(model({ reply: "네", status: "ended", product: 3, info: null, options: [], budget: {} }));
    expect(r.slots).toEqual(slots({}));
  });
});

describe("gateLiveResult", () => {
  const confirmingHistory = [
    user("무선 이어폰"),
    ai("confirming", { product: "무선 이어폰", info: "후기", options: "흰색" }),
  ];
  const done = (s: Partial<LiveSlots> = { product: "무선 이어폰", info: "후기", options: "흰색" }): LiveChatResult => ({
    reply: "보내 드릴게요.",
    status: "done",
    slots: slots(s),
  });

  it("done이 아니면 그대로 둔다", () => {
    const asking: LiveChatResult = { reply: "무엇을요?", status: "asking", slots: slots({}) };
    expect(gateLiveResult(asking, "아무 말", [])).toEqual({ result: asking, downgraded: false });
    const confirming: LiveChatResult = { reply: "", status: "confirming", slots: slots({ product: "a" }) };
    expect(gateLiveResult(confirming, "네", [])).toEqual({ result: confirming, downgraded: false });
  });

  it("앞 칸이 confirming이고 '네 그렇게 보내 주시면 돼요'면 done을 유지한다", () => {
    const r = done();
    expect(gateLiveResult(r, "네 그렇게 보내 주시면 돼요", confirmingHistory)).toEqual({ result: r, downgraded: false });
  });

  it("'네'처럼 분명한 동의도 유지한다", () => {
    expect(gateLiveResult(done(), "네", confirmingHistory).downgraded).toBe(false);
  });

  it("'예산은 5만 원'은 confirming으로 낮춘다", () => {
    const { result, downgraded } = gateLiveResult(done(), "예산은 5만 원", confirmingHistory);
    expect(downgraded).toBe(true);
    expect(result.status).toBe("confirming");
    expect(result.slots.product).toBe("무선 이어폰");
  });

  it("'이대로 보내기 버튼'(화면 낭독)과 '네?'는 낮춘다", () => {
    expect(gateLiveResult(done(), "이대로 보내기 버튼", confirmingHistory).downgraded).toBe(true);
    expect(gateLiveResult(done(), "네?", confirmingHistory).downgraded).toBe(true);
    expect(gateLiveResult(done(), "네?", confirmingHistory).result.status).toBe("confirming");
  });

  it("앞 칸이 asking이면 동의처럼 들려도 낮춘다", () => {
    const history = [user("무선 이어폰"), ai("asking", { product: "무선 이어폰" }, "어떤 점이 궁금하세요?")];
    const { result, downgraded } = gateLiveResult(done(), "네", history);
    expect(downgraded).toBe(true);
    expect(result.status).toBe("confirming");
  });

  it("이번 응답에 제품이 없으면 마지막 확인 칸의 칸으로 낮춘다", () => {
    const { result } = gateLiveResult(done({}), "예산은 5만 원", confirmingHistory);
    expect(result.status).toBe("confirming");
    expect(result.slots).toEqual(slots({ product: "무선 이어폰", info: "후기", options: "흰색" }));
  });

  it("제품이 전혀 없으면 asking과 다시 묻는 말로 낮춘다", () => {
    const { result, downgraded } = gateLiveResult(done({}), "네", [user("안녕"), ai("asking", {}, "무엇을요?")]);
    expect(downgraded).toBe(true);
    expect(result.status).toBe("asking");
    expect(result.reply).toBe("어떤 제품을 찾으시는지 한 번만 더 말씀해 주시겠어요?");
  });

  it("기록 끝에 이번 이용자 말이 붙어 있어도 앞 AI 칸을 읽는다", () => {
    const history = [...confirmingHistory, user("네 그렇게 보내 주시면 돼요")];
    expect(gateLiveResult(done(), "네 그렇게 보내 주시면 돼요", history).downgraded).toBe(false);
  });

  it("깨진 AI 칸은 확인 칸으로 보지 않는다", () => {
    const history: LiveTurn[] = [user("a"), { role: "assistant", content: "JSON 아님" }];
    expect(gateLiveResult(done(), "네", history).downgraded).toBe(true);
  });
});

describe("mockLiveText(설계서 7.3절 표)", () => {
  const parse = (history: LiveTurn[]) => JSON.parse(mockLiveText(history)) as Record<string, string>;
  // 화면이 처음 안내를 직접 읽으므로 기록은 안내 칸으로 시작한다.
  const intro = ai("asking", {}, "안내");

  it("이용자 말 1개: 알고 싶은 정보를 묻는다", () => {
    const r = parse([intro, user("무선 이어폰")]);
    expect(r).toMatchObject({
      status: "asking",
      reply: "어떤 점이 궁금하세요? 혜택이나 후기처럼 알고 싶은 정보를 말씀해 주세요.",
      product: "무선 이어폰",
    });
  });

  it("이용자 말 2개: 옵션이나 예산을 묻는다", () => {
    const r = parse([intro, user("무선 이어폰"), ai("asking"), user("후기")]);
    expect(r).toMatchObject({
      status: "asking",
      reply: "원하는 옵션이나 예산이 있으세요?",
      product: "무선 이어폰",
      info: "후기",
    });
  });

  it("이용자 말 3개: confirming이고 reply가 비며 예산을 옵션에서 뽑는다", () => {
    const r = parse([intro, user("무선 이어폰"), ai("asking"), user("후기"), ai("asking"), user("흰색 5만 원 이하")]);
    expect(r).toMatchObject({
      status: "confirming",
      reply: "",
      product: "무선 이어폰",
      info: "후기",
      options: "흰색 5만 원 이하",
      budget: "5만 원 이하",
    });
  });

  it("예산이 없으면 budget이 빈 글이다", () => {
    const r = parse([intro, user("a"), ai("asking"), user("b"), ai("asking"), user("흰색")]);
    expect(r.budget).toBe("");
  });

  const three = [intro, user("무선 이어폰"), ai("asking"), user("후기"), ai("asking"), user("흰색"), ai("confirming")];

  it("4번째가 동의면 done이고 앞의 세 칸을 그대로 쓴다", () => {
    const r = parse([...three, user("네 그렇게 보내 주시면 돼요")]);
    expect(r).toMatchObject({
      status: "done",
      reply: "보내 드릴게요.",
      product: "무선 이어폰",
      info: "후기",
      options: "흰색",
    });
  });

  it("4번째가 동의가 아니면 마지막 말을 옵션으로 하는 confirming이다", () => {
    const r = parse([...three, user("검정색으로 바꿔 주세요")]);
    expect(r).toMatchObject({ status: "confirming", reply: "", product: "무선 이어폰", info: "후기", options: "검정색으로 바꿔 주세요" });
  });

  it("4번째가 물음표 있는 동의('네?')면 동의가 아니다", () => {
    expect(parse([...three, user("네?")]).status).toBe("confirming");
  });

  it("이용자 말이 없으면 제품을 묻는다", () => {
    const r = parse([intro]);
    expect(r.status).toBe("asking");
    expect(r.reply).not.toBe("");
  });

  it("parseLiveText가 mock 글을 그대로 읽는다", () => {
    const r = parseLiveText(mockLiveText([intro, user("무선 이어폰")]));
    expect(r.status).toBe("asking");
    expect(r.slots.product).toBe("무선 이어폰");
  });
});

describe("callLiveAI", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("mock이면 fetch를 부르지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callLiveAI } = await import("@/lib/liveChat");
    const r = await callLiveAI([ai("asking", {}, "안내"), user("무선 이어폰")]);
    expect(r.status).toBe("asking");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
