import { describe, expect, it } from "vitest";
import { filterSlash, parseHomeInput, SLASH_COMMANDS } from "@/lib/volunteerCommands";

describe("parseHomeInput", () => {
  it("명령 3개", () => {
    expect(parseHomeInput("/대기열")).toBe("queue");
    expect(parseHomeInput("/내담당")).toBe("mine");
    expect(parseHomeInput("/시연초기화")).toBe("reset");
  });

  it("평소 말: 대기열", () => {
    expect(parseHomeInput("대기열 보여줘")).toBe("queue");
    expect(parseHomeInput("새 요청 있어?")).toBe("queue");
    expect(parseHomeInput("지금 대기 중인 요청 보여줘")).toBe("queue");
    expect(parseHomeInput("기다리는 요청")).toBe("queue");
    expect(parseHomeInput("요청 목록")).toBe("queue");
  });

  it("평소 말: 내 담당", () => {
    expect(parseHomeInput("내 담당")).toBe("mine");
    expect(parseHomeInput("맡은 요청 보여줘")).toBe("mine");
    expect(parseHomeInput("내 요청 목록 보여줘")).toBe("mine");
    expect(parseHomeInput("이어서 할래")).toBe("mine");
  });

  it("글자 모양을 통일한다(전각·대문자·문장부호)", () => {
    expect(parseHomeInput("　대기열！！")).toBe("queue");
    expect(parseHomeInput("내, 담당.")).toBe("mine");
  });

  it("두 가지가 섞이면 unknown", () => {
    expect(parseHomeInput("대기열이랑 내 담당 둘 다")).toBe("unknown");
  });

  it("평소 말로는 시연 초기화를 하지 않는다", () => {
    expect(parseHomeInput("시연 초기화")).toBe("unknown");
    expect(parseHomeInput("시연초기화")).toBe("unknown");
    expect(parseHomeInput("시연용 요청 다시 채워줘")).toBe("unknown");
  });

  it("'/'로 시작하면 명령과 정확히 같을 때만(공백은 무시)", () => {
    expect(parseHomeInput("/대 기 열")).toBe("queue");
    expect(parseHomeInput("  /내담당  ")).toBe("mine");
    expect(parseHomeInput("/대기열 보여줘")).toBe("unknown");
    expect(parseHomeInput("/대기")).toBe("unknown");
    expect(parseHomeInput("/모르는명령")).toBe("unknown");
  });

  it("빈 입력과 모르는 말은 unknown", () => {
    expect(parseHomeInput("")).toBe("unknown");
    expect(parseHomeInput("   ")).toBe("unknown");
    expect(parseHomeInput("???")).toBe("unknown");
    expect(parseHomeInput("안녕하세요")).toBe("unknown");
  });
});

describe("filterSlash", () => {
  it("'/'만 치면 명령 3개", () => {
    expect(filterSlash("/").map((item) => item.command)).toEqual(["/대기열", "/내담당", "/시연초기화"]);
    expect(filterSlash("/")).toEqual([...SLASH_COMMANDS]);
  });

  it("앞부분이 맞는 것만", () => {
    expect(filterSlash("/대").map((item) => item.command)).toEqual(["/대기열"]);
    expect(filterSlash("/시연").map((item) => item.command)).toEqual(["/시연초기화"]);
    expect(filterSlash("/ 내").map((item) => item.command)).toEqual(["/내담당"]);
    expect(filterSlash("/없음")).toEqual([]);
  });

  it("'/'로 시작하지 않으면 빈 목록", () => {
    expect(filterSlash("대기열")).toEqual([]);
    expect(filterSlash("")).toEqual([]);
  });
});
