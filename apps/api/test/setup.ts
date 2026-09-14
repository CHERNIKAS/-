import { fileURLToPath } from "node:url";
import { memoryDb } from "@costnote/core/data";
import { migrate } from "drizzle-orm/pglite/migrator";

await migrate(memoryDb as never, {
  migrationsFolder: fileURLToPath(new URL("../../../migrations", import.meta.url)),
});

/** Отправленное в Telegram: тесты смотрят сюда, а не в настоящий чат. */
export const telegram: { method: string; body: unknown }[] = [];
let messageId = 1000;

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = String(input);
  if (url.startsWith("https://api.telegram.org/")) {
    telegram.push({ method: url.split("/").pop() ?? "", body: init?.body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: ++messageId } }), {
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`сеть в тестах выключена: ${url}`);
}) as typeof fetch;
