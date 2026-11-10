import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // server-only는 Next 번들러 밖에서 import하면 오류를 던진다.
      "server-only": path.resolve(import.meta.dirname, "tests/unit/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // 시험 전용 가짜 계정. 사람의 실제 값과 무관하다.
    env: {
      VOLUNTEER_PHONE: "010-0000-0000",
      VOLUNTEER_PASSWORD: "unit-test-only-password",
    },
  },
});
