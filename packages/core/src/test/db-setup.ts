import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/pglite/migrator";
import { memoryDb } from "../data/db.js";

// Те же миграции, что на проде: тесты видят ровно ту схему, что и живая база.
await migrate(memoryDb as never, {
  migrationsFolder: fileURLToPath(new URL("../../../../migrations", import.meta.url)),
});

// Сеть в тестах выключена: случайный запрос наружу должен падать, а не ходить в интернет.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`сеть в тестах выключена: ${String(input)}`);
}) as typeof fetch;
