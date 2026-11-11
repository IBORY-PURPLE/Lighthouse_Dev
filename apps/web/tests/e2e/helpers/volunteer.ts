import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { MatchResponse } from "../../../src/lib/matchHandoff";

// 봉사자 화면을 이용자 화면을 거치지 않고 연다. 이용자 화면 흐름이 바뀌어도 ④ 시험이 깨지지 않게 한다.
// 접근 쿠키는 /enter로 받고, 시연 이어 보기(sessionStorage lh.match.v1)는 직접 심는다.

/** volunteers.ts 명단의 첫 번째 봉사자(헤드셋 담당). */
export const FIRST_VOLUNTEER = { id: "v-01", displayName: "가상 봉사자 A" };

export function fakeMatch(overrides: Partial<MatchResponse> = {}): MatchResponse {
  return {
    requestId: randomUUID(),
    volunteer: FIRST_VOLUNTEER,
    request: { brand: "Sony", item: "헤드셋", raw: "sony껄로 헤드셋 사고싶어" },
    ...overrides,
  };
}

export async function openVolunteer(
  page: Page,
  { code, match = fakeMatch() }: { code: string; match?: MatchResponse },
): Promise<MatchResponse> {
  const context = page.context();
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `test-${randomUUID()}` });
  await page.addInitScript(
    ([key, value]) => window.sessionStorage.setItem(key, value),
    ["lh.match.v1", JSON.stringify(match)] as const,
  );
  await page.goto(`/enter?code=${encodeURIComponent(code)}`);
  await expect(page).toHaveURL(/\/$/);

  // Windows WebKit은 Secure 쿠키를 http://localhost로 보내지 않는다(chat.spec.ts와 같은 처리).
  if (page.url().startsWith("http://")) {
    const access = (await context.cookies()).find(
      (cookie) => cookie.name === "lh_access",
    );
    expect(access).toBeDefined();
    if (access) await context.addCookies([{ ...access, secure: false }]);
  }

  await page.goto("/volunteer");
  await expect(
    page.getByRole("heading", { level: 1, name: "봉사자 화면(시연)" }),
  ).toBeFocused();
  return match;
}

/**
 * 긴 합성 상세 이미지(PNG)를 브라우저 canvas로 그려 돌려준다. Node에는 canvas가 없어서다.
 * 글자를 넣고 잡음으로 파일 크기를 키운다. 실제 쇼핑몰 이미지는 쓰지 않는다(TSD §10).
 */
export async function makeSyntheticDetailImage(
  page: Page,
  { width = 860, height = 4500, noise = true } = {},
): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, noise }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      if (noise) {
        const image = context.getImageData(0, 0, width, height);
        let seed = 12345;
        for (let i = 0; i < image.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const value = 200 + (seed % 56);
          image.data[i] = value;
          image.data[i + 1] = (value * 7) % 256 | 0x80;
          image.data[i + 2] = (value * 13) % 256 | 0x80;
          image.data[i + 3] = 255;
        }
        context.putImageData(image, 0, 0);
      }
      context.fillStyle = "#111111";
      context.font = "bold 40px sans-serif";
      const lines = [
        "합성 상세 이미지 (시험용)",
        "상품명: 가짜 헤드셋 LH-200",
        "색상 옵션: 블랙, 화이트",
        "블루투스 5.3, 최대 30시간 재생",
        "구성품: 본체, USB-C 케이블, 설명서",
        "주의: 물에 닿지 않게 하세요",
      ];
      for (let y = 120, i = 0; y < height; y += 300, i++) {
        context.fillText(lines[i % lines.length], 40, y);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, noise },
  );
  return Buffer.from(base64, "base64");
}
