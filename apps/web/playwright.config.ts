import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

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
      testIgnore: ["public.spec.ts", "research-*.spec.ts", "volunteer-desktop.spec.ts"],
      use: { ...devices["iPhone 15"] },
    },
    {
      // 대화형 리서치 챗은 노트북 크롬 화면이다(design.md 6절).
      name: "e2e-desktop",
      testMatch: ["research-*.spec.ts", "volunteer-desktop.spec.ts"],
      // 실제 AI 한 사이클은 공개 주소에서 따로 돈다(아래 cycle).
      testIgnore: "research-cycle.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // 실제 AI로 대화형 리서치 챗을 한 바퀴 돈다. BASE_URL이 필요하고 유료 호출이 든다(npm run test:research-cycle).
      name: "cycle",
      testMatch: "research-cycle.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
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
          // 입장 코드가 아니라 봉사자 기기 쿠키(lh_vol) 서명 비밀이다.
          DEMO_ACCESS_CODE: "e2e-signing-secret",
        },
      },
});
