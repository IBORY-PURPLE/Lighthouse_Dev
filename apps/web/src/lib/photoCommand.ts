// 입력창에 "QR", "휴대폰으로 찍을게요" 같은 말을 쓰면 턴을 보내지 않고 휴대폰 사진 대화상자를 연다(낱말 대조, AI 호출 없음).
// 모델명 답에 "아이폰으로 샀어요"처럼 폰이 들어가도 열리지 않게, 폰 낱말은 앞에 한글·영문이 붙지 않을 때만 센다.

const MAX_LENGTH = 40;
const QR_WORD = /(?<![a-z0-9가-힣])(qr|큐\s?알)(?![a-z0-9])/;
const PHONE_WORD = /(?<![가-힣a-z0-9])(휴대폰|핸드폰|스마트폰|폰)(으로|로|에서)/;
/** 폰 낱말 뒤에 사진을 찍거나 올리겠다는 뜻이 있어야 한다. */
const PHOTO_ACT = /찍|촬영|사진|올리|올릴|올려|업로드|보내|보낼/;
const PHONE_ONLY = /^(휴대폰|핸드폰|스마트폰|폰)(으로|로)$/;

export function isPhonePhotoCommand(text: string): boolean {
  const value = text.trim().toLowerCase();
  if (value === "" || value.length > MAX_LENGTH) return false;
  if (QR_WORD.test(value)) return true;
  if (PHONE_ONLY.test(value.replace(/[\s.!?~]+/g, ""))) return true;
  return PHONE_WORD.test(value) && PHOTO_ACT.test(value);
}
