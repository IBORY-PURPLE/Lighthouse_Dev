import "server-only";

// 사진 본문 검사 도우미(사진 올리기 라우트가 쓴다). 사진 원본은 저장하지 않고 크기·형식·바이트 서명만 본다.

const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,/;

export function decodedBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** 파일 앞 바이트 서명. JPEG는 FF D8 FF, PNG는 89 50 4E 47 0D 0A 1A 0A로 시작한다. */
const IMAGE_SIGNATURES: Readonly<Record<"jpeg" | "png", readonly number[]>> = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** 선언한 형식(data:image/jpeg|png)과 실제 바이트 서명이 맞는지 본다. 앞 12바이트(base64 16자)만 푼다. */
export function matchesImageSignature(dataUrl: string): boolean {
  const kind = IMAGE_DATA_URL.exec(dataUrl)?.[1] as "jpeg" | "png" | undefined;
  if (!kind) return false;
  const start = dataUrl.indexOf(",") + 1;
  const head = Buffer.from(dataUrl.slice(start, start + 16), "base64");
  const signature = IMAGE_SIGNATURES[kind];
  return head.length >= signature.length && signature.every((byte, index) => head[index] === byte);
}
