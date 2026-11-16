import { describe, expect, it } from "vitest";
import { dataUrlBytes, fitWithin } from "@/lib/researchPhoto";

describe("fitWithin", () => {
  it("긴 변이 한도 안이면 그대로 둔다(키우지 않는다)", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("긴 변을 한도에 맞추고 비율을 지킨다", () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });

  it("아주 가는 사진도 0이 되지 않는다", () => {
    expect(fitWithin(10, 40_000, 1600)).toEqual({ width: 1, height: 1600 });
  });
});

describe("dataUrlBytes", () => {
  it("base64 본문을 디코드한 바이트 수를 센다", () => {
    const body = Buffer.from("abcde").toString("base64");
    expect(dataUrlBytes(`data:image/jpeg;base64,${body}`)).toBe(5);
    expect(dataUrlBytes(`data:image/jpeg;base64,${Buffer.from("abcd").toString("base64")}`)).toBe(4);
    expect(dataUrlBytes(`data:image/jpeg;base64,${Buffer.from("abcdef").toString("base64")}`)).toBe(6);
  });

  it("쉼표가 없으면 0이다", () => {
    expect(dataUrlBytes("nothing")).toBe(0);
  });
});
