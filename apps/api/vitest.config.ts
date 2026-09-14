import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "pglite://memory",
      BOT_TOKEN: "123456:test-token-for-signatures",
      LOG_LEVEL: "silent",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
