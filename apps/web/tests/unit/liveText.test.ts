import { describe, expect, it } from "vitest";
import { PHONE } from "@/lib/researchCheck";
import { MAX_HISTORY_CONTENT } from "@/lib/voiceChat";
import {
  cleanSlot,
  cutText,
  decodeAiTurn,
  EMPTY_SLOTS,
  encodeAiTurn,
  groundSlots,
  maskPhone,
  PHONE as LIVE_PHONE,
  readSlots,
  REPLY_MAX,
  SLOT_MAX,
  SUMMARY_MAX,
  summaryOf,
  tidySlots,
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

describe("groundSlots: 지시문이 샌 문장과 모델의 질문만 뺀다", () => {
  const slots = (o: Partial<Record<"product" | "info" | "options" | "budget", string>>) => ({
    product: "", info: "", options: "", budget: "", ...o,
  });

  it("실호출 사례 1: 알고 싶은 정보에 섞인 지시문 문장을 뺀다", () => {
    const user = ["무선 이어폰을 찾고 있어요.", "노이즈 캔슬링이 잘 되는지, 그리고 배터리가 얼마나 가는지 알고 싶어요."];
    const out = groundSlots(
      slots({
        product: "무선 이어폰",
        info: "노이즈 캔슬링 성능과 배터리 사용 시간을 알고 싶어요. 할인, 사용 후기, 비교 정보도 함께 확인 가능하면 좋습니다. 가격, 재고, 할인율, 모델명, 출시 여부는 봉사자가 찾아서 알려 주세요.",
      }),
      user,
    );
    expect(out.product).toBe("무선 이어폰");
    expect(out.info).toBe("노이즈 캔슬링 성능과 배터리 사용 시간을 알고 싶어요.");
  });

  it("실호출 사례 2: 칸 전체가 지시문에서 왔으면 비우고, 표지가 없는 문장은 남긴다", () => {
    const user = ["전화를 찾고 있어요.", "검은색이면 좋겠고 예산은 10만 원 이하예요."];
    const out = groundSlots(
      slots({
        product: "보드게임",
        info: "혜택, 할인, 사용 후기, 비교, 구성, 크기와 무게 같은 정보. 가격, 재고, 할인율, 모델명, 출시 여부는 봉사자가 찾아서 알려 주세요.",
        options: "색상 블랙 또는 검은색. 새 제품. 조건은 없다면 비워두기.",
        budget: "10만 원 이내",
      }),
      user,
    );
    expect(out.info).toBe("");
    // "새 제품."은 근거가 없지만 표지도 없어 남긴다. 이용자가 요약을 듣고 고친다.
    expect(out.options).toBe("색상 블랙 또는 검은색. 새 제품.");
    expect(out.budget).toBe("10만 원 이내");
    expect(out.product).toBe("보드게임");
  });

  it("바꿔 말한 문장은 지우지 않는다. 다른 문장에 근거가 있어도 마찬가지다(Codex 2차 지적 2)", () => {
    expect(groundSlots(slots({ product: "이어폰", info: "차음 성능" }), ["이어폰이요. 소리가 밖으로 안 새는지 알려 주면 좋겠어요."]).info).toBe("차음 성능");
    const out = groundSlots(slots({ product: "이어폰", info: "차음 성능. 배터리 수명." }), ["소리가 밖으로 안 새는지와 배터리가 오래 가는지 궁금해요"]);
    expect(out.info).toBe("차음 성능. 배터리 수명.");
  });

  it("근거가 불확실하지만 표지가 없는 문장은 남긴다. 확인 요약에서 이용자가 듣고 고친다", () => {
    const out = groundSlots(slots({ product: "소니 헤드폰", info: "배송지는 서울입니다." }), ["소니 헤드폰"]);
    expect(out.info).toBe("배송지는 서울입니다.");
  });

  it("이용자가 물은 질문은 남기고, 모델이 적은 자기 질문은 뺀다", () => {
    const asked = "지금 가격이 얼마예요? 재고는 있나요?";
    expect(groundSlots(slots({ product: "이어폰", info: asked }), ["이어폰이요.", asked]).info).toBe(asked);
    expect(groundSlots(slots({ product: "전기밥솥", info: "어떤 점이 궁금하세요?" }), ["전기밥솥을 찾아요"]).info).toBe("");
    expect(
      groundSlots(slots({ product: "전기밥솥", info: "어떤 색을 원하세요? 내솥이 스테인리스인지" }), ["전기밥솥이요. 내솥이 스테인리스인지 알고 싶어요"]).info,
    ).toBe("내솥이 스테인리스인지");
  });

  it("물음표 뒤에 공백이 없어도 문장을 나누고, 소수점은 나누지 않는다(Codex 2차 지적 3)", () => {
    expect(groundSlots(slots({ product: "전기밥솥", info: "무게는?할인은" }), ["전기밥솥을 찾아요"]).info).toBe("할인은");
    const out = groundSlots(slots({ product: "전기밥솥", options: "1.5리터 용량. 어떤 색을 원하세요?" }), ["1.5리터 전기밥솥이요"]);
    expect(out.options).toBe("1.5리터 용량.");
  });

  it("숫자를 한글로 받아 적어도 예산 칸이 남는다", () => {
    const out = groundSlots(slots({ product: "헤드폰", budget: "30만 원 이하" }), ["헤드폰이요. 예산은 삼십만 원 이하예요."]);
    expect(out.budget).toBe("30만 원 이하");
  });

  it("받아 적은 글이 거의 없으면(전사를 못 받음) 판단하지 않고 그대로 돌려준다", () => {
    const given = slots({ product: "이어폰", info: "가격은 봉사자가 찾아서 알려 주세요." });
    expect(groundSlots(given, [])).toEqual(given);
    expect(groundSlots(given, ["네"])).toEqual(given);
  });

  it("근거 있는 칸은 바뀌지 않는다", () => {
    const user = ["소니 무선 헤드폰을 찾고 있어요. 노이즈 캔슬링 성능이 궁금하고, 검은색에 예산은 30만 원 이하예요."];
    const given = slots({ product: "소니 무선 헤드폰", info: "노이즈 캔슬링 성능", options: "검은색", budget: "30만 원 이하" });
    expect(groundSlots(given, user)).toEqual(given);
  });
});

describe("tidySlots: 읽어 주기 좋게 칸을 정리한다(내용은 잃지 않는다)", () => {
  const slots = (o: Partial<Record<"product" | "info" | "options" | "budget", string>>) => ({
    product: "무선 이어폰", info: "", options: "", budget: "", ...o,
  });

  it("실호출 사례: 예산만 말하는 마디를 다른 칸에서 빼고, 끝말을 뗀다", () => {
    const out = tidySlots(
      slots({
        info: "노이즈 캔슬링 성능과 배터리 사용 시간을 알고 싶음. 예산은 10만 원 이내",
        options: "검은색, 예산 10만 원 이내",
        budget: "10만 원 이하",
      }),
    );
    expect(out.info).toBe("노이즈 캔슬링 성능과 배터리 사용 시간");
    expect(out.options).toBe("검은색");
    expect(out.budget).toBe("10만 원 이하");
  });

  it("예산과 다른 내용이 한 마디에 섞여 있으면 지우지 않는다(Codex 2차 지적 3)", () => {
    const given = slots({ options: "검은색이고 예산 10만 원", budget: "10만 원" });
    expect(tidySlots(given).options).toBe("검은색이고 예산 10만 원");
    // 요약은 예산을 두 번 말하지 않는다.
    expect(toDraft(given)?.summary).toBe("제품은 무선 이어폰. 옵션은 검은색이고 예산 10만 원.");
    expect(tidySlots(slots({ options: "예산 10만 원에 맞는 검은색", budget: "10만 원" })).options).toBe("예산 10만 원에 맞는 검은색");
  });

  it("끝말 떼기: 궁금, 궁금함, 궁금합니다, 알고 싶어요", () => {
    expect(tidySlots(slots({ info: "노이즈 캔슬링 성능이 궁금" })).info).toBe("노이즈 캔슬링 성능");
    expect(tidySlots(slots({ info: "가격과 재고가 궁금함" })).info).toBe("가격과 재고");
    expect(tidySlots(slots({ info: "노이즈 캔슬링 성능이 궁금합니다." })).info).toBe("노이즈 캔슬링 성능");
    expect(tidySlots(slots({ info: "배터리가 얼마나 가는지 알고 싶어요" })).info).toBe("배터리가 얼마나 가는지");
  });

  it("끝말만 있는 칸은 비우지 않고, 예산 칸이 없으면 예산 마디를 그대로 둔다. 질문은 건드리지 않는다", () => {
    expect(tidySlots(slots({ info: "궁금합니다" })).info).toBe("궁금합니다");
    expect(tidySlots(slots({ options: "검은색, 예산 10만 원 이내" })).options).toBe("검은색, 예산 10만 원 이내");
    expect(tidySlots(slots({ info: "지금 가격이 얼마예요? 재고는 있나요?" })).info).toBe("지금 가격이 얼마예요? 재고는 있나요?");
  });

  it("toDraft는 정리한 칸으로 요약을 만든다", () => {
    const draft = toDraft(slots({ info: "노이즈 캔슬링 성능이 궁금", options: "검은색, 예산 10만 원 이내", budget: "10만 원 이하" }));
    expect(draft?.summary).toBe("제품은 무선 이어폰. 알고 싶은 정보는 노이즈 캔슬링 성능. 옵션은 검은색. 예산은 10만 원 이하.");
  });
});

// Codex 3차 지적 2: 읽어 준 예산과 접수되는 예산이 달라지면 안 된다.
describe("summaryOf: 예산 칸은 값이 그대로 읽힐 때만 생략한다", () => {
  it("같은 값이 옵션에 그대로 있으면 한 번만 읽는다", () => {
    expect(summaryOf(slots({ product: "TV", options: "예산 10만 원 이하 무선", budget: "10만 원 이하" }))).toBe(
      "제품은 TV. 옵션은 예산 10만 원 이하 무선.",
    );
    expect(summaryOf(slots({ product: "TV", info: "예산 10만원으로 살 수 있는지", budget: "10만 원" }))).toBe(
      "제품은 TV. 알고 싶은 정보는 예산 10만원으로 살 수 있는지.",
    );
  });
  it("옵션의 예산과 예산 칸이 다르면 접수에 쓰는 예산 칸을 반드시 읽는다", () => {
    expect(summaryOf(slots({ product: "TV", options: "예산 10만 원 이하 무선", budget: "20만 원" }))).toBe(
      "제품은 TV. 옵션은 예산 10만 원 이하 무선. 예산은 20만 원.",
    );
  });
  it("'예산'이라는 말만 있고 값이 없으면 예산 칸을 읽는다", () => {
    expect(summaryOf(slots({ product: "TV", info: "예산 안에서 가장 큰 화면", budget: "50만 원" }))).toBe(
      "제품은 TV. 알고 싶은 정보는 예산 안에서 가장 큰 화면. 예산은 50만 원.",
    );
  });
  it("숫자가 이어 붙은 자리는 같은 값으로 보지 않는다", () => {
    expect(summaryOf(slots({ product: "TV", options: "120만 원대 모델", budget: "20만 원" }))).toBe(
      "제품은 TV. 옵션은 120만 원대 모델. 예산은 20만 원.",
    );
    expect(summaryOf(slots({ product: "TV", options: "백이십만 원대 모델", budget: "이십만 원" }))).toBe(
      "제품은 TV. 옵션은 백이십만 원대 모델. 예산은 이십만 원.",
    );
  });
  it("toDraft를 거쳐도 요약에 예산 칸의 값이 들어 있다", () => {
    const draft = toDraft(slots({ product: "TV", options: "예산 10만 원 이하 무선, 벽걸이", budget: "20만 원" }));
    expect(draft?.budget).toBe("20만 원");
    expect(draft?.summary).toContain("예산은 20만 원.");
  });
});

// Codex 3차 지적 3: 모델이 이용자에게 되묻는 물음이 칸에 남으면 안 된다.
describe("groundSlots: 되묻는 말투의 물음", () => {
  it("제품 이름이 겹쳐도 되묻는 물음은 뺀다", () => {
    const out = groundSlots(slots({ product: "소니 헤드폰", info: "소니 헤드폰은 어떤 색을 원하세요?" }), ["소니 헤드폰"]);
    expect(out.info).toBe("");
    expect(out.product).toBe("소니 헤드폰");
  });
  it("되묻는 물음만 빼고 앞의 이용자 내용은 남긴다", () => {
    const user = ["헤드폰 노이즈 캔슬링 성능이 궁금해요. 예산은 10만 원"];
    const out = groundSlots(
      slots({ product: "헤드폰", info: "노이즈 캔슬링 성능. 예산은 얼마 정도 생각하세요?", options: "더 필요한 조건이 있나요?" }),
      user,
    );
    expect(out.info).toBe("노이즈 캔슬링 성능.");
    expect(out.options).toBe("");
  });
  it("이용자가 알고 싶은 것을 적은 물음은 남긴다", () => {
    const user = ["소니 헤드폰 방수 되는지 궁금해요", "가격도요. 다른 색도 있는지도요"];
    const out = groundSlots(slots({ product: "소니 헤드폰", info: "방수가 되나요? 가격은 얼마인가요? 다른 색도 있나요?" }), user);
    expect(out.info).toBe("방수가 되나요? 가격은 얼마인가요? 다른 색도 있나요?");
  });
  it("이용자가 거의 그대로 말한 높임 물음은 남긴다", () => {
    const out = groundSlots(slots({ product: "이어폰", info: "배터리 시간 알려 주세요?" }), ["이어폰이요. 배터리 시간 알려 주세요"]);
    expect(out.info).toBe("배터리 시간 알려 주세요?");
  });
});
