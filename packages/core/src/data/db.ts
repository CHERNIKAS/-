import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.js";

/**
 * Подключение к базе.
 *
 * Строка берётся из окружения прямо здесь: слой данных общий для бота и API,
 * и он не должен знать, как каждое из приложений устроило свой конфиг.
 *
 * `pglite://memory` — настоящий Postgres в памяти процесса для тестов: они
 * проверяют запросы на том же SQL, что и прод, без Docker и без чужих данных.
 */
const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  throw new Error("DATABASE_URL не задан");
}

type Client = { end: () => Promise<void> };

async function connect(): Promise<{ client: Client; db: PostgresJsDatabase<typeof schema>; memory: unknown }> {
  if (url === "pglite://memory") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzleMemory } = await import("drizzle-orm/pglite");
    const memory = new PGlite();
    const db = drizzleMemory(memory, { schema, casing: "snake_case" });
    // Запросы у обоих драйверов одинаковые; различается только тип обёртки.
    return { client: { end: () => memory.close() }, db: db as unknown as PostgresJsDatabase<typeof schema>, memory: db };
  }

  const sql = postgres(url as string, { max: 10 });
  return { client: sql, db: drizzle(sql, { schema, casing: "snake_case" }), memory: null };
}

const connection = await connect();

export const client = connection.client;
export const db = connection.db;
/** Драйвер PGlite в тестах — для миграций; в проде null. */
export const memoryDb = connection.memory;
export { schema };
