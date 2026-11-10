import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 3100;
// 시험 전용 가짜 계정. 사람의 실제 값과 무관하다.
export const E2E_VOLUNTEER_PHONE = "01000000000";
export const E2E_VOLUNTEER_PASSWORD = "e2e-test-only-password";

const baseURL = process.env.BASE_URL ?? `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "off",
  },
  projects: [
    {
      name: "e2e",
      testIgnore: "public.spec.ts",
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "public",
      testMatch: "public.spec.ts",
      use: { ...devices["iPhone 15"] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- -p ${E2E_PORT}`,
        url: `${baseURL}/speech-probe/index.html`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          LLM_MODE: "mock",
          STORE_MODE: "memory",
          EXTRACT_MODE: "mock",
          VOLUNTEER_PHONE: E2E_VOLUNTEER_PHONE,
          VOLUNTEER_PASSWORD: E2E_VOLUNTEER_PASSWORD,
        },
      },
});
