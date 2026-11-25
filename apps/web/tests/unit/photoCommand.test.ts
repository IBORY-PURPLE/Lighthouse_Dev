import { describe, expect, it } from "vitest";
import { isPhonePhotoCommand } from "@/lib/photoCommand";

// 입력창의 낱말로 휴대폰 사진(QR) 창을 여는 규칙. 모델명·경험 답이 잘못 열지 않아야 한다.
describe("isPhonePhotoCommand", () => {
  it.each([
    "QR",
    "qr",
    "QR코드 띄워줘",
    "큐알",
    "큐알 코드",
    "큐 알",
    "휴대폰으로 찍을게요",
    "핸드폰으로 찍을게",
    "폰으로 찍을게요",
    "폰으로 올릴게요",
    "폰으로",
    "휴대폰으로",
    "핸드폰으로.",
    "스마트폰으로 사진 올릴래요",
    "휴대폰으로 사진 보낼게요",
  ])("%s는 연다", (text) => {
    expect(isPhonePhotoCommand(text)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "아이폰으로 샀어요",
    "아이폰으로 사서 써요",
    "갤럭시 폰으로 샀어요",
    "소니 WH-1000XM5 샀어요",
    "qrs 모델",
    "큐브 모양 헤드셋",
    "사진은 나중에 올릴게요",
    "휴대폰 케이스를 샀어요",
    "가벼워서 오래 써도 편해요. 휴대폰으로 음악 들을 때도 좋고 폰으로 통화할 때도 마이크가 잘 잡혀요 그리고 찍",
  ])("%s는 열지 않는다", (text) => {
    expect(isPhonePhotoCommand(text)).toBe(false);
  });
});
