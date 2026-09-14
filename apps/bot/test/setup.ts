import { fileURLToPath } from "node:url";
import { memoryDb } from "@costnote/core/data";
import { migrate } from "drizzle-orm/pglite/migrator";

await migrate(memoryDb as never, {
  migrationsFolder: fileURLToPath(new URL("../../../migrations", import.meta.url)),
});

globalThis.fetch = (async (input: unknown) => {
  throw new Error(`сеть в тестах выключена: ${String(input)}`);
}) as typeof fetch;
