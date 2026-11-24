import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/lib/liveCommands";
import {
  LIVE_CHAT_INSTRUCTIONS,
  LIVE_NAME_BLOCK,
  liveChatInstructions,
  liveRealtimeInstructions,
  LIVE_COMMON_INSTRUCTIONS,
  LIVE_REALTIME_INSTRUCTIONS,
  LIVE_TOOLS,
} from "@/lib/liveInstructions";

// /live 지시문과 Realtime 도구 정의. 설계서 11절, 7.5절, 16.1절.

type Tool = {
  type: string;
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
};
const tools = LIVE_TOOLS as Tool[];
const tool = (name: string) => tools.find((t) => t.name === name)!;

describe("공통 지시문", () => {
  it("모을 항목과 금지 낱말 규칙이 들어 있다", () => {
    for (const word of ["원하는 제품", "알고 싶은 정보", "원하는 옵션", "전화번호", "봉사자가 찾아서"]) {
      expect(LIVE_COMMON_INSTRUCTIONS).toContain(word);
    }
  });

  it("'헤드셋'이라는 낱말이 어느 지시문에도 없다", () => {
    for (const text of [LIVE_COMMON_INSTRUCTIONS, LIVE_CHAT_INSTRUCTIONS, LIVE_REALTIME_INSTRUCTIONS]) {
      expect(text).not.toContain("헤드셋");
    }
  });

  it("'반드시', '절대'를 쓰지 않는다(Realtime 프롬프트 가이드)", () => {
    for (const text of [LIVE_COMMON_INSTRUCTIONS, LIVE_CHAT_INSTRUCTIONS, LIVE_REALTIME_INSTRUCTIONS]) {
      expect(text).not.toContain("반드시");
      expect(text).not.toContain("절대");
    }
  });

  it("COMMANDS의 대표 낱말이 모두 들어 있다", () => {
    const representative = ["다시", "천천히", "빠르게", "도움말", "잠깐", "그만"];
    const all = COMMANDS.flatMap((c) => c.words);
    for (const word of representative) {
      expect(all).toContain(word);
      expect(LIVE_COMMON_INSTRUCTIONS).toContain(`"${word}"`);
    }
  });

  it("요약은 AI가 말하지 않고 앱이 읽는다", () => {
    expect(LIVE_COMMON_INSTRUCTIONS).toContain("당신은 요약을 직접 말하지 않습니다");
    expect(LIVE_COMMON_INSTRUCTIONS).toContain("등록됐다는 말은 하지 않습니다");
  });
});

describe("글자판 꼬리", () => {
  it("공통 + 빈 줄 + 꼬리이고 상태 4개가 있다", () => {
    expect(LIVE_CHAT_INSTRUCTIONS.startsWith(`${LIVE_COMMON_INSTRUCTIONS}\n\n`)).toBe(true);
    const tail = LIVE_CHAT_INSTRUCTIONS.slice(LIVE_COMMON_INSTRUCTIONS.length + 2);
    for (const status of ["asking", "confirming", "done", "ended"]) expect(tail).toContain(status);
    expect(tail).toContain("[출력 형식]");
  });

  it("summary 칸이 없다", () => {
    expect(LIVE_CHAT_INSTRUCTIONS).not.toContain("summary");
  });

  it("실시간판 꼬리의 도구 이름은 들어 있지 않다", () => {
    for (const name of ["confirm_request", "register_request", "end_conversation"]) {
      expect(LIVE_CHAT_INSTRUCTIONS).not.toContain(name);
    }
  });
});

describe("실시간판 꼬리", () => {
  it("공통 + 빈 줄 + 꼬리이고 도구 이름 3개가 있다", () => {
    expect(LIVE_REALTIME_INSTRUCTIONS.startsWith(`${LIVE_COMMON_INSTRUCTIONS}\n\n`)).toBe(true);
    const tail = LIVE_REALTIME_INSTRUCTIONS.slice(LIVE_COMMON_INSTRUCTIONS.length + 2);
    for (const name of ["confirm_request", "register_request", "end_conversation"]) {
      expect(tail).toContain(name);
    }
    expect(tail).toContain("[도구]");
  });

  it("글자판 출력 형식은 들어 있지 않다", () => {
    expect(LIVE_REALTIME_INSTRUCTIONS).not.toContain("[출력 형식]");
    expect(LIVE_REALTIME_INSTRUCTIONS).not.toContain("summary");
  });
});

describe("LIVE_TOOLS(7.5절)", () => {
  it("도구 이름이 순서대로 세 개다", () => {
    expect(tools.map((t) => t.name)).toEqual(["confirm_request", "register_request", "end_conversation"]);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.parameters.type).toBe("object");
      expect(t.parameters.additionalProperties).toBe(false);
    }
  });

  it("confirm_request의 required가 네 칸이고 summary가 없다", () => {
    const t = tool("confirm_request");
    expect(t.parameters.required).toEqual(["product", "info", "options", "budget"]);
    expect(Object.keys(t.parameters.properties)).toEqual(["product", "info", "options", "budget"]);
    expect(Object.keys(t.parameters.properties)).not.toContain("summary");
    for (const prop of Object.values(t.parameters.properties) as { type: string }[]) {
      expect(prop.type).toBe("string");
    }
  });

  it("register_request와 end_conversation의 properties는 빈 객체다", () => {
    expect(tool("register_request").parameters.properties).toEqual({});
    expect(tool("end_conversation").parameters.properties).toEqual({});
  });
});

describe("성함 여쭙기(LIVE_ASK_NAME)", () => {
  it("꺼져 있으면 지시문이 그대로다", () => {
    expect(liveChatInstructions(false)).toBe(LIVE_CHAT_INSTRUCTIONS);
    expect(liveRealtimeInstructions(false)).toBe(LIVE_REALTIME_INSTRUCTIONS);
  });

  it("켜면 원래 지시문 뒤에 성함 여쭙기만 붙는다", () => {
    expect(liveChatInstructions(true)).toBe(`${LIVE_CHAT_INSTRUCTIONS}

${LIVE_NAME_BLOCK}`);
    expect(liveRealtimeInstructions(true)).toBe(`${LIVE_REALTIME_INSTRUCTIONS}

${LIVE_NAME_BLOCK}`);
  });

  it("저장 사실을 알리고, 한 번만 묻고, 항목에 넣지 않고, 연락처는 계속 묻지 않는다", () => {
    for (const piece of [
      "이 대화는 서비스 개선을 위해 글자로 저장돼요. 성함을 말씀해 주시겠어요?",
      "한 번만 여쭙니다",
      "어느 항목에도 넣지 않습니다",
      "전화번호, 주소, 결제 정보는 지금처럼 묻지 않습니다",
      "[하지 않는 것]",
    ]) {
      expect(LIVE_NAME_BLOCK).toContain(piece);
    }
  });

  it("다른 지시문과 같은 낱말 규칙을 지킨다('반드시', '절대', '헤드셋' 없음)", () => {
    for (const word of ["반드시", "절대", "헤드셋"]) expect(LIVE_NAME_BLOCK).not.toContain(word);
  });
});
