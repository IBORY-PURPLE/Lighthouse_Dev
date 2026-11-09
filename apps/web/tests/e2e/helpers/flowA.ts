import { expect, type Page } from "@playwright/test";
import { say } from "./fakeSpeech";

// 이용자 화면 플로우 A(질문 3개 → 요약)를 가짜 음성 입력으로 끝까지 답한다.
// installFakeSpeech 뒤, 이용자 화면(/)이 열린 상태에서 부른다.

export interface FlowAAnswers {
  product: string;
  budget: string;
  condition: string;
}

export const DEFAULT_ANSWERS: FlowAAnswers = {
  product: "sony껄로 헤드셋 사고싶어",
  budget: "10만 원 이하",
  condition: "새 제품",
};

export const MATCH_REQUEST_NAME = "봉사자 매칭 요청";

/** 시작하기부터 세 질문에 음성으로 답하고 요약 화면에서 멈춘다. */
export async function answerFlowA(
  page: Page,
  answers: FlowAAnswers = DEFAULT_ANSWERS,
): Promise<void> {
  await page.getByRole("button", { name: "시작하기" }).click();
  const steps: [string, string, string][] = [
    ["질문 1/3", answers.product, "다음 질문"],
    ["질문 2/3", answers.budget, "다음 질문"],
    ["질문 3/3", answers.condition, "완료"],
  ];
  for (const [title, text, confirm] of steps) {
    await expect(
      page.getByRole("heading", { level: 2, name: new RegExp(`^${title}`) }),
    ).toBeFocused();
    await page.getByRole("button", { name: "눌러서 말하기" }).click();
    await say(page, text);
    const confirmButton = page.getByRole("button", { name: confirm });
    await expect(confirmButton).toBeFocused();
    await confirmButton.click();
  }
  await expect(
    page.getByRole("heading", { level: 2, name: "요청 내용" }),
  ).toBeFocused();
}

/** 세 질문에 답하고 매칭을 요청해 "봉사자 화면으로(시연)"까지 간다. */
export async function completeFlowA(
  page: Page,
  answers: FlowAAnswers = DEFAULT_ANSWERS,
  options: { timeout?: number } = {},
): Promise<void> {
  await answerFlowA(page, answers);
  await page.getByRole("button", { name: MATCH_REQUEST_NAME }).click();
  await expect(
    page.getByRole("button", { name: "봉사자 화면으로(시연)" }),
  ).toBeFocused({ timeout: options.timeout });
}
