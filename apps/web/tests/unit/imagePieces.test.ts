import { describe, expect, it } from "vitest";
import {
  dataUrlBytes,
  joinPieceTexts,
  MAX_PIECES,
  PIECE_HEIGHT,
  PIECE_OVERLAP,
  planPieces,
} from "@/lib/imagePieces";

describe("planPieces", () => {
  it("폭 860, 높이 4200이면 1,200px 조각 4개, 겹침 100px, 마지막 짧은 조각은 앞에 붙인다", () => {
    const plan = planPieces(860, 4200);
    expect(plan.scale).toBe(1);
    expect(plan.enlarged).toBe(false);
    // 0-1200, 1100-2300, 2200-3400, 3300-4200(900 ≥ 480이라 따로 남음)
    expect(plan.pieces.map(({ sy, sh }) => [sy, sy + sh])).toEqual([
      [0, 1200],
      [1100, 2300],
      [2200, 3400],
      [3300, 4200],
    ]);
    for (let i = 1; i < plan.pieces.length; i++) {
      const previous = plan.pieces[i - 1];
      expect(previous.sy + previous.sh - plan.pieces[i].sy).toBe(PIECE_OVERLAP);
    }
    expect(plan.pieces.every((piece) => piece.width === 860)).toBe(true);
  });

  it("마지막 조각이 조각 높이의 40% 미만이면 앞 조각에 붙인다", () => {
    // 0-1200, 1100-2300, 2200-2500(300 < 480) → 1100-2500으로 합친다.
    const plan = planPieces(800, 2500);
    expect(plan.pieces.map(({ sy, sh }) => [sy, sy + sh])).toEqual([
      [0, 1200],
      [1100, 2500],
    ]);
  });

  it("폭이 1,000px을 넘으면 축소 비율을 쓰고 조각 높이는 축소 뒤 1,200px이다", () => {
    const plan = planPieces(2000, 4800);
    expect(plan.scale).toBe(0.5);
    expect(plan.pieces[0]).toEqual({ sy: 0, sh: 2400, width: 1000, height: 1200 });
    expect(plan.pieces[1].sy).toBe(2400 - PIECE_OVERLAP * 2);
  });

  it("짧은 이미지는 조각 1개다", () => {
    expect(planPieces(500, 300).pieces).toEqual([
      { sy: 0, sh: 300, width: 500, height: 300 },
    ]);
  });

  it(`조각이 ${MAX_PIECES}개를 넘으면 조각 높이를 늘려 ${MAX_PIECES}개 이하로 맞추고 알린다`, () => {
    const plan = planPieces(800, 60_000);
    expect(plan.enlarged).toBe(true);
    expect(plan.pieces.length).toBeLessThanOrEqual(MAX_PIECES);
    expect(plan.pieces[0].sh).toBeGreaterThan(PIECE_HEIGHT);
    const last = plan.pieces[plan.pieces.length - 1];
    expect(last.sy + last.sh).toBe(60_000);
  });

  it("겹침이 조각 높이 이상이어도 끝난다", () => {
    const plan = planPieces(800, 5000, { pieceHeight: 100, overlap: 500 });
    expect(plan.pieces.length).toBeLessThanOrEqual(MAX_PIECES);
    const last = plan.pieces[plan.pieces.length - 1];
    expect(last.sy + last.sh).toBe(5000);
  });

  it("크기가 0이면 조각이 없다", () => {
    expect(planPieces(0, 100).pieces).toEqual([]);
  });
});

describe("joinPieceTexts", () => {
  it("앞 조각 끝과 다음 조각 처음에 겹친 줄을 지운다", () => {
    expect(
      joinPieceTexts(["가\n나\n다", "나\n다\n라", "라\n마"]),
    ).toBe("가\n나\n다\n라\n마");
  });

  it("겹치지 않으면 그대로 잇고 빈 줄은 뺀다", () => {
    expect(joinPieceTexts(["가\n\n나", "다"])).toBe("가\n나\n다");
  });
});

describe("dataUrlBytes", () => {
  it("base64 디코드 크기를 센다", () => {
    const data = Buffer.from("hello world!").toString("base64");
    expect(dataUrlBytes(`data:image/jpeg;base64,${data}`)).toBe(12);
    expect(dataUrlBytes(`data:image/jpeg;base64,${Buffer.from("ab").toString("base64")}`)).toBe(2);
  });
});
