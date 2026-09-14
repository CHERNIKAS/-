import { defineConfig } from "vitest/config";

// Обычные тесты без базы; тесты с базой — в vitest.db.config.ts.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["src/**/*.db.test.ts", "node_modules/**"] },
});
