import { defineConfig } from "vitest/config";

// Настоящий Postgres в памяти: каждый файл тестов получает свою чистую базу.
export default defineConfig({
  test: {
    include: ["src/**/*.db.test.ts"],
    setupFiles: ["src/test/db-setup.ts"],
    env: { DATABASE_URL: "pglite://memory", NODE_ENV: "test" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
