import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  E2E_VOLUNTEER_PASSWORD,
  E2E_VOLUNTEER_PHONE,
} from "../../../playwright.config";

// 시험 전용 가짜 계정(playwright.config.ts)으로 봉사자 로그인을 한다.
// 로그인은 주소마다 10분에 5번까지라 시험마다 다른 주소 값을 쓴다.

export const VOLUNTEER_LOGIN_HEADING = "봉사자 로그인";

const loginHeaders = () => ({ "x-forwarded-for": `login-${randomUUID()}` });
const credentials = {
  phone: E2E_VOLUNTEER_PHONE,
  password: E2E_VOLUNTEER_PASSWORD,
};

/** 브라우저 컨텍스트에 로그인 쿠키를 넣는다(page.request는 쿠키를 탭과 나눈다). */
export async function loginVolunteer(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: credentials,
    headers: loginHeaders(),
  });
  expect(response.status()).toBe(200);
}

/** API 시험용: 로그인하고 `lh_volunteer=...` 쿠키 헤더 값을 돌려준다. */
export async function loginCookie(
  request: APIRequestContext,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: credentials,
    headers: loginHeaders(),
  });
  expect(response.status()).toBe(200);
  return (response.headers()["set-cookie"] ?? "").split(";")[0];
}

/** 로그인 칸에 번호와 비밀번호를 넣고 로그인 버튼을 누른다. */
export async function fillLogin(
  page: Page,
  phone: string,
  password: string,
): Promise<void> {
  await page.getByRole("textbox", { name: "전화번호" }).fill(phone);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

export { E2E_VOLUNTEER_PASSWORD, E2E_VOLUNTEER_PHONE };
