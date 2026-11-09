// ④ 브라우저에서 긴 상세 이미지를 조각으로 자른다. TSD "④ 자르기와 보내기".
// 원본 크기 canvas를 만들지 않고, 조각 크기 canvas에 원본 좌표로 그린다(아이폰 canvas 면적 한도).

export const MAX_PIECE_WIDTH = 1000;
/** 블록 1 실험 결론: 1,200과 800 모두 정답이라 1,200을 유지한다. */
export const PIECE_HEIGHT = 1200;
export const PIECE_OVERLAP = 100;
export const MAX_PIECES = 30;
/** 서버 extract-text의 조각 상한(디코드 후)과 같다. */
export const MAX_PIECE_BYTES = 1.5 * 1024 * 1024;
/** 마지막 조각이 조각 높이의 이 비율보다 낮으면 앞 조각에 붙인다(실험 index.html 규칙). */
const SHORT_LAST_RATIO = 0.4;
const JPEG_QUALITIES = [0.85, 0.7, 0.55, 0.4];

export interface PieceRect {
  /** 원본 좌표 */
  sy: number;
  sh: number;
  /** 조각 canvas 크기 */
  width: number;
  height: number;
}

export interface PiecePlan {
  pieces: PieceRect[];
  /** 축소 비율(1 이하) */
  scale: number;
  /** 조각이 30개를 넘어 조각 높이를 늘렸으면 true */
  enlarged: boolean;
}

export interface PlanOptions {
  maxWidth?: number;
  pieceHeight?: number;
  overlap?: number;
  maxPieces?: number;
}

function slice(height: number, pieceHeight: number, overlap: number) {
  const ranges: Array<{ top: number; bottom: number }> = [];
  let top = 0;
  for (;;) {
    const bottom = Math.min(top + pieceHeight, height);
    ranges.push({ top, bottom });
    if (bottom >= height) break;
    top = bottom - overlap;
  }
  const last = ranges[ranges.length - 1];
  if (
    ranges.length > 1 &&
    last.bottom - last.top < pieceHeight * SHORT_LAST_RATIO
  ) {
    ranges.pop();
    ranges[ranges.length - 1].bottom = height;
  }
  return ranges;
}

/** 원본 크기에서 조각 사각형을 정한다(순수 함수). */
export function planPieces(
  width: number,
  height: number,
  {
    maxWidth = MAX_PIECE_WIDTH,
    pieceHeight = PIECE_HEIGHT,
    overlap = PIECE_OVERLAP,
    maxPieces = MAX_PIECES,
  }: PlanOptions = {},
): PiecePlan {
  if (!(width > 0) || !(height > 0) || !(pieceHeight > 0) || !(maxPieces >= 1)) {
    return { pieces: [], scale: 1, enlarged: false };
  }
  const scale = Math.min(1, maxWidth / width);
  // 조각 높이·겹침은 축소 뒤 크기 기준이므로 원본 좌표로 바꾼다.
  // 겹침이 조각 높이 이상이면 자르기가 앞으로 나가지 않으므로 조각 높이의 절반 아래로 묶는다.
  const sourceOverlap = Math.min(overlap, pieceHeight / 2) / scale;
  let sourcePieceHeight = pieceHeight / scale;
  let ranges = slice(height, sourcePieceHeight, sourceOverlap);
  const enlarged = ranges.length > maxPieces;
  if (enlarged) {
    sourcePieceHeight =
      Math.ceil((height - sourceOverlap) / maxPieces + sourceOverlap) + 1;
    ranges = slice(height, sourcePieceHeight, sourceOverlap);
    // 반올림 때문에 한 개 넘칠 수 있다. 높이를 늘리면 조각 수는 줄기만 하므로 끝난다.
    while (ranges.length > maxPieces) {
      sourcePieceHeight *= 1.05;
      ranges = slice(height, sourcePieceHeight, sourceOverlap);
    }
  }

  return {
    scale,
    enlarged,
    pieces: ranges.map(({ top, bottom }) => ({
      sy: Math.round(top),
      sh: Math.round(bottom) - Math.round(top),
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round((Math.round(bottom) - Math.round(top)) * scale)),
    })),
  };
}

/**
 * 조각 글을 순서대로 잇고, 겹친 부분 때문에 앞 조각 끝과 다음 조각 처음에 똑같이 나온 줄을 지운다.
 */
export function joinPieceTexts(texts: readonly string[], maxOverlapLines = 8): string {
  const lines: string[] = [];
  for (const text of texts) {
    const next = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    let drop = 0;
    for (let k = Math.min(maxOverlapLines, lines.length, next.length); k > 0; k--) {
      const tail = lines.slice(lines.length - k);
      if (tail.every((line, i) => line === next[i])) {
        drop = k;
        break;
      }
    }
    lines.push(...next.slice(drop));
  }
  return lines.join("\n");
}

/** data URL의 base64를 디코드했을 때 크기. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface CutResult {
  pieces: string[];
  enlarged: boolean;
}

/** 파일 하나를 JPEG 조각 data URL로 자른다(브라우저 전용). 1.5MB를 넘으면 품질을 낮춰 다시 만든다. */
export async function cutPieces(file: Blob): Promise<CutResult> {
  const bitmap = await createImageBitmap(file);
  try {
    const plan = planPieces(bitmap.width, bitmap.height);
    const pieces: string[] = [];
    for (const piece of plan.pieces) {
      const canvas = document.createElement("canvas");
      canvas.width = piece.width;
      canvas.height = piece.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, piece.width, piece.height);
      context.drawImage(
        bitmap,
        0,
        piece.sy,
        bitmap.width,
        piece.sh,
        0,
        0,
        piece.width,
        piece.height,
      );
      let dataUrl = "";
      for (const quality of JPEG_QUALITIES) {
        dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrlBytes(dataUrl) <= MAX_PIECE_BYTES) break;
      }
      pieces.push(dataUrl);
      // 조각 canvas는 바로 비워 메모리를 돌려준다.
      canvas.width = 0;
      canvas.height = 0;
    }
    return { pieces, enlarged: plan.enlarged };
  } finally {
    bitmap.close();
  }
}
