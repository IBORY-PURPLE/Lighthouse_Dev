// 리서치 챗 사진 카드의 브라우저 쪽 사진 축소. 서버로 보내는 JPEG(1.5MB 이하)와 기기에 남길 작은 썸네일을 만든다.
// 원본 사진은 어디에도 저장하지 않는다. 크기 계산은 순수 함수라 단위 시험이 된다.

import { RESEARCH_LIMITS } from "./research";

/** 서버가 받는 사진 한 장의 상한(디코드 후 바이트). 서버 검사와 같은 값(RESEARCH_LIMITS.imageMaxBytes)이다. */
const MAX_IMAGE_BYTES = RESEARCH_LIMITS.imageMaxBytes;
/** AI에게 보내는 사진의 긴 변 상한(px). */
const IMAGE_LONG_EDGE = 1600;
/** 썸네일의 긴 변 시작값(px). 데이터 주소가 한도를 넘으면 줄인다. */
const THUMB_LONG_EDGE = 200;

/** 긴 변이 limit을 넘지 않게 비율을 지켜 줄인 크기(키우지 않는다). */
export function fitWithin(width: number, height: number, limit: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= limit || longEdge <= 0) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = limit / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** data URL 본문(base64)이 디코드되면 몇 바이트인가. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma === -1 ? "" : dataUrl.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
}

interface ShrunkPhoto {
  /** 서버로 보낼 JPEG data URL(1.5MB 이하). */
  image: string;
  /** 기기에 남길 작은 미리보기(RESEARCH_LIMITS.thumbMax 글자 이하). */
  thumb: string;
}

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // 일부 브라우저는 형식을 못 읽는다. 아래 Image로 한 번 더 시도한다.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function jpegAt(drawable: Drawable, longEdge: number, quality: number): string {
  const size = fitWithin(drawable.width, drawable.height, longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no_canvas");
  // 투명한 PNG가 검게 나오지 않게 흰 바탕을 깐다.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(drawable.source, 0, 0, size.width, size.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 사진을 읽어 서버용 JPEG와 썸네일로 줄인다. 읽을 수 없는 파일이면 던진다. */
export async function shrinkPhoto(file: Blob): Promise<ShrunkPhoto> {
  const drawable = await decode(file);
  try {
    let edge = IMAGE_LONG_EDGE;
    let quality = 0.85;
    let image = jpegAt(drawable, edge, quality);
    while (dataUrlBytes(image) > MAX_IMAGE_BYTES && edge > 400) {
      edge = Math.round(edge * 0.8);
      quality = Math.max(0.5, quality - 0.1);
      image = jpegAt(drawable, edge, quality);
    }
    if (dataUrlBytes(image) > MAX_IMAGE_BYTES) throw new Error("too_large");

    let thumbEdge = THUMB_LONG_EDGE;
    let thumb = jpegAt(drawable, thumbEdge, 0.6);
    while (thumb.length > RESEARCH_LIMITS.thumbMax && thumbEdge > 40) {
      thumbEdge = Math.round(thumbEdge * 0.8);
      thumb = jpegAt(drawable, thumbEdge, 0.5);
    }
    if (thumb.length > RESEARCH_LIMITS.thumbMax) throw new Error("thumb_too_large");
    return { image, thumb };
  } finally {
    drawable.close();
  }
}
