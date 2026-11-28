import { describe, expect, it } from "vitest";
import { checkIntake, mockProductIntake } from "@/lib/liveIntake";
import { toLiveRequest } from "@/lib/liveRequest";
import { EMPTY_SLOTS, encodeAiTurn, toDraft } from "@/lib/liveText";
import type { LiveTurn } from "@/lib/liveEngine";

const slots = {
  product: "헤드셋",
  info: "",
  options: "",
  budget: "10만 원",
  purchaseTiming: "일주일 안에",
  conditions: [
    { label: "노이즈 캔슬링", answer: "꼭 필요해요" },
    { label: "연결 방식", answer: "무선이 좋아요" },
    { label: "착용 방식", answer: "다음" },
  ],
};

const answers = ["헤드셋 찾고 있어요", "꼭 필요해요", "무선이 좋아요", "다음", "10만 원이고 일주일 안에 필요해요"];

describe("제품 조건 확인", () => {
  const asked = (reply: string): LiveTurn => ({ role: "assistant", content: encodeAiTurn({ status: "asking", reply, slots: EMPTY_SLOTS }) });
  const said = (content: string): LiveTurn => ({ role: "user", content });
  it("노트북 크기·무게·용도에 직접 답하면 누락된 도구 인자를 복구해 접수한다", () => {
    const history = [
      said("맥 OS 노트북을 사고 싶어"),
      asked("주 용도는 무엇인가요?"),
      said("공부용으로 쓸 거야"),
      asked("어떤 화면 크기가 좋아요?"),
      said("화면은 크면 클수록 좋아"),
      asked("무게는 어떻게 할까요?"),
      said("가벼웠으면 좋겠어"),
      asked("예산은 어느 정도예요?"),
      said("150만 원 정도는 생각해"),
      asked("언제 구매하고 싶으세요?"),
      said("한 달 동안 고민하고 구매하고 싶어"),
    ];
    const checked = checkIntake({ ...EMPTY_SLOTS, product: "노트북", purchaseTiming: "정확히 한 달 이내" }, history.filter((x) => x.role === "user").map((x) => x.content), history);
    expect(checked.question).toBeNull();
    const qa = toLiveRequest(toDraft(checked.slots)!, "test-call")?.details.qa;
    expect(qa).toEqual(expect.arrayContaining([
      { q: "주 용도", a: "공부용으로 쓸 거야" },
      { q: "화면 크기", a: "화면은 크면 클수록 좋아" },
      { q: "휴대성", a: "가벼웠으면 좋겠어" },
      { q: "필요한 시기", a: "한 달 동안 고민하고 구매" },
    ]));
  });

  it("화면 크기에 관한 이용자 질문 자체는 크기 선호로 저장하지 않는다", () => {
    const history = [
      said("애플 노트북을 공부용으로 쓰고 싶어"),
      asked("원하는 화면 크기가 있어요?"),
      said("공부에는 몇 인치가 좋아요?"),
    ];
    const checked = checkIntake({ ...EMPTY_SLOTS, product: "노트북" }, history.filter((x) => x.role === "user").map((x) => x.content), history);
    expect(checked.question).toContain("화면 크기");
    expect(checked.slots.conditions.some((c) => c.label === "화면 크기")).toBe(false);
  });
  it("이용자가 확인한 조건과 필요한 시기를 확인 요약과 접수에 넣는다", () => {
    const checked = checkIntake(slots, answers);
    expect(checked.question).toBeNull();
    const draft = toDraft(checked.slots);
    expect(draft?.summary).toContain("필요한 시기는 일주일 안에");
    expect(draft?.summary).not.toContain("다음");
    expect(toLiveRequest(draft!, "test-session")?.details.qa).toEqual(expect.arrayContaining([
      { q: "노이즈 캔슬링", a: "꼭 필요해요" },
      { q: "필요한 시기", a: "일주일 안에" },
    ]));
  });

  it("한 번 나온 건너뛰기 답으로 여러 조건을 채울 수 없다", () => {
    const repeated = {
      ...slots,
      conditions: slots.conditions.map(({ label }) => ({ label, answer: "다음" })),
    };
    const checked = checkIntake(repeated, answers);
    expect(checked.question).toBe("귀를 덮는 방식과 귀에 꽂는 방식 중 어떤 게 편하세요?");
    expect(checked.slots.conditions).toHaveLength(1);
  });

  it("근거가 없는 구매 시기가 오면 필요한 시기를 다시 묻는다", () => {
    const checked = checkIntake({ ...slots, purchaseTiming: "오늘까지" }, answers);
    expect(checked.question).toBe("이 제품이 언제까지 필요하세요?");
    expect(checked.slots.purchaseTiming).toBe("");
  });

  it.each([
    ["노트북", "선호하는 브랜드"],
    ["애플 노트북", "주로 어떤 일"],
    ["옷", "상의와 하의"],
    ["청바지", "선호하는 브랜드"],
  ])("%s에서 아직 확인하지 않은 조건을 먼저 묻는다", (product, question) => {
    const result = JSON.parse(mockProductIntake([{ role: "user", content: product }]));
    expect(result.reply).toContain(question);
  });
});
