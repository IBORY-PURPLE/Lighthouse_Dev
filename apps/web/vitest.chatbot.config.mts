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
    include: ["tests/chatbot/**/*.test.ts"],
    // 7초 간격 대기와 재시도 1회 포함 시간 초과(20초 × 2)를 합친 값.
    testTimeout: 60_000,
  },
});
