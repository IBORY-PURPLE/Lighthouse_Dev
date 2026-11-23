import { describe, expect, it } from "vitest";
import { PHONE } from "@/lib/researchCheck";
import { MAX_HISTORY_CONTENT } from "@/lib/voiceChat";
import {
  EMPTY_SLOTS,
  PHONE as LIVE_PHONE,
  REPLY_MAX,
  SLOT_MAX,
  SUMMARY_MAX,
  cleanSlot,
  cutText,
  decodeAiTurn,
  encodeAiTurn,
  maskPhone,
  readSlots,
  summaryOf,
  toDraft,
} from "@/lib/liveText";

// 글 다듬기와 기록 칸(설계서 6.4절). 서버와 화면이 같은 함수를 쓰므로 길이 상한을 여기서 고정한다.
const slots = (o: Partial<Record<keyof typeof SLOT_MAX, string>> = {}) => ({ ...EMPTY_SLOTS, ...o });

describe("cutText", () => {
  it("200자는 그대로 둔다", () => {
    const t = "가".repeat(200);
    expect(cutText(t, 200)).toBe(t);
  });
  it("201자는 length가 200 이하이고 …로 끝난다", () => {
    const r = cutText("가".repeat(201), 200);
    expect(r.length).toBeLessThanOrEqual(200);
    expect(r.endsWith("…")).toBe(true);
  });
  it("이모지(UTF-16 두 칸)가 섞여도 length가 max 이하다", () => {
    expect(cutText("😀".repeat(150), 200).length).toBeLessThanOrEqual(200);
    const edge = cutText("a".repeat(198) + "😀😀😀", 200);
    expect(edge.length).toBeLessThanOrEqual(200);
    expect(edge.endsWith("…")).toBe(true);
    // 반쪽 서로게이트가 남지 않는다
    expect(edge).toBe(Array.from(edge).join(""));
  });
  it("max가 아주 작아도 넘지 않는다", () => {
    expect(cutText("가나다", 1).length).toBeLessThanOrEqual(1);
    expect(cutText("가나다", 0)).toBe("");
  });
});

describe("maskPhone", () => {
  it("researchCheck.ts의 PHONE과 정규식 source가 같다", () => {
    expect(LIVE_PHONE.source).toBe(PHONE.source);
  });
  it("전화번호를 모두 가린다", () => {
    expect(maskPhone("010-1234-5678")).toBe("(전화번호 가림)");
    expect(maskPhone("연락처 010 1234 5678 또는 02-123-4567")).toBe("연락처 (전화번호 가림) 또는 (전화번호 가림)");
    expect(maskPhone("전기밥솥 6인용")).toBe("전기밥솥 6인용");
  });
  it("같은 글을 두 번 불러도 결과가 같다(g 플래그 상태가 남지 않는다)", () => {
    expect(maskPhone("010-1234-5678")).toBe(maskPhone("010-1234-5678"));
  });
});

describe("cleanSlot", () => {
  it("문자열이 아니면 빈 글이다", () => {
    expect(cleanSlot(5, 10)).toBe("");
    expect(cleanSlot(null, 10)).toBe("");
    expect(cleanSlot({}, 10)).toBe("");
  });
  it("제어 문자는 공백으로, 앞뒤 공백은 뗀다", () => {
    expect(cleanSlot("  가\n나\t다\u0000라 ", 50)).toBe("가 나 다 라");
  });
});

describe("readSlots", () => {
  it("문자열이 아닌 칸은 빈 글이다", () => {
    expect(readSlots({ product: 3, info: null, options: ["a"], budget: undefined })).toEqual(EMPTY_SLOTS);
  });
  it("객체가 아니어도 던지지 않는다", () => {
    expect(readSlots(null)).toEqual(EMPTY_SLOTS);
    expect(readSlots("글")).toEqual(EMPTY_SLOTS);
    expect(readSlots(undefined)).toEqual(EMPTY_SLOTS);
  });
  it("전화번호를 가린다", () => {
    expect(readSlots({ info: "010-1234-5678로 연락" }).info).toBe("(전화번호 가림)로 연락");
  });
  it("SLOT_MAX로 자른다", () => {
    const r = readSlots({
      product: "가".repeat(500),
      info: "나".repeat(500),
      options: "다".repeat(500),
      budget: "라".repeat(500),
    });
    expect(r.product.length).toBeLessThanOrEqual(SLOT_MAX.product);
    expect(r.info.length).toBeLessThanOrEqual(SLOT_MAX.info);
    expect(r.options.length).toBeLessThanOrEqual(SLOT_MAX.options);
    expect(r.budget.length).toBeLessThanOrEqual(SLOT_MAX.budget);
  });
  it("제어 문자를 공백으로 바꾼다", () => {
    expect(readSlots({ product: "무선\n이어폰" }).product).toBe("무선 이어폰");
  });
});

describe("summaryOf", () => {
  it("네 칸을 문장으로 잇는다", () => {
    expect(summaryOf(slots({ product: "전기밥솥", info: "할인 혜택", options: "6인용", budget: "10만 원" }))).toBe(
      "제품은 전기밥솥. 알고 싶은 정보는 할인 혜택. 옵션은 6인용. 예산은 10만 원.",
    );
  });
  it("빈 칸의 문장은 뺀다", () => {
    expect(summaryOf(slots({ product: "전기밥솥" }))).toBe("제품은 전기밥솥.");
    expect(summaryOf(slots({ product: "전기밥솥", options: "6인용" }))).toBe("제품은 전기밥솥. 옵션은 6인용.");
  });
  it("예산이 옵션 안에 그대로 들어 있으면 예산 문장을 뺀다", () => {
    expect(summaryOf(slots({ product: "TV", options: "55인치, 20만 원 이하", budget: "20만 원 이하" }))).toBe(
      "제품은 TV. 옵션은 55인치, 20만 원 이하.",
    );
  });
  it("칸 끝의 문장부호는 떼고 붙인다", () => {
    expect(summaryOf(slots({ product: "TV.", info: "가격?", options: "흰색,", budget: "5만 원!" }))).toBe(
      "제품은 TV. 알고 싶은 정보는 가격. 옵션은 흰색. 예산은 5만 원.",
    );
  });
  it("가장 긴 칸으로도 SUMMARY_MAX 이하(299자)다", () => {
    const r = summaryOf(
      slots({
        product: "가".repeat(SLOT_MAX.product),
        info: "나".repeat(SLOT_MAX.info),
        options: "다".repeat(SLOT_MAX.options),
        budget: "라".repeat(SLOT_MAX.budget),
      }),
    );
    expect(r.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(r.length).toBe(299);
  });
});

describe("toDraft", () => {
  it("제품이 비면 null이다", () => {
    expect(toDraft(slots({ info: "가격" }))).toBeNull();
  });
  it("칸과 요약을 함께 준다", () => {
    const d = toDraft(slots({ product: "전기밥솥", info: "혜택" }));
    expect(d).toEqual({
      product: "전기밥솥",
      info: "혜택",
      options: "",
      budget: "",
      summary: "제품은 전기밥솥. 알고 싶은 정보는 혜택.",
    });
  });
});

describe("encodeAiTurn / decodeAiTurn", () => {
  it("왕복한다", () => {
    const s = slots({ product: "전기밥솥", info: "혜택", options: "6인용", budget: "10만 원" });
    const turn = { reply: "어떤 옵션이 필요하세요?", status: "asking" as const, slots: s };
    expect(decodeAiTurn(encodeAiTurn(turn))).toEqual(turn);
  });
  it("가장 긴 칸과 따옴표만 있는 글로도 MAX_HISTORY_CONTENT 이하다", () => {
    const q = (n: number) => '"'.repeat(n);
    const out = encodeAiTurn({
      reply: q(1000),
      status: "confirming",
      slots: { product: q(SLOT_MAX.product), info: q(SLOT_MAX.info), options: q(SLOT_MAX.options), budget: q(SLOT_MAX.budget) },
    });
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_CONTENT);
    expect(decodeAiTurn(out)?.status).toBe("confirming");
  });
  it("reply는 REPLY_MAX로 자른다", () => {
    const out = decodeAiTurn(encodeAiTurn({ reply: "가".repeat(900), status: "asking", slots: EMPTY_SLOTS }));
    expect(out).not.toBeNull();
    expect(out!.reply.length).toBeLessThanOrEqual(REPLY_MAX);
  });
  it("깨진 글은 null이다", () => {
    expect(decodeAiTurn("그냥 글")).toBeNull();
    expect(decodeAiTurn("[]")).toBeNull();
    expect(decodeAiTurn("null")).toBeNull();
    expect(decodeAiTurn('{"reply":1,"status":"asking"}')).toBeNull();
    expect(decodeAiTurn('{"reply":"가","status":"nope"}')).toBeNull();
  });
  it("칸이 빠진 JSON은 빈 칸으로 읽는다", () => {
    expect(decodeAiTurn('{"reply":"가","status":"done"}')).toEqual({ reply: "가", status: "done", slots: EMPTY_SLOTS });
  });
});
