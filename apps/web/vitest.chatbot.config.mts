import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// 실제 OpenAI 시험만 키가 필요하다. Vite 표준 키 파일 읽기로 OPENAI_ 접두 변수만 넣고, 값은 출력하지 않는다.
// 이미 셸에 있는 값이 우선하고, 다음은 apps/web, 그다음 저장소 루트 순이다. 키 파일은 열지 않는다.
const openaiEnv = {
  ...loadEnv("", path.resolve(import.meta.dirname, "../.."), "OPENAI_"),
  ...loadEnv("", import.meta.dirname, "OPENAI_"),
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith("OPENAI_") && Boolean(entry[1]),
    ),
  ),
};

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
    env: openaiEnv,
    include: ["tests/chatbot/**/*.test.ts"],
    // 7초 간격 대기와 재시도 1회 포함 시간 초과(20초 × 2)를 합친 값.
    testTimeout: 60_000,
  },
});
