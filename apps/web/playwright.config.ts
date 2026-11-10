import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 3100;
export const E2E_ACCESS_CODE = "e2e-test-code";

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
          DEMO_ACCESS_CODE: E2E_ACCESS_CODE,
        },
      },
});
