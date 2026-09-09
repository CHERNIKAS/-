import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.js";

/**
 * Подключение к базе.
 *
 * Строка берётся из окружения прямо здесь: слой данных общий для бота и API,
 * и он не должен знать, как каждое из приложений устроило свой конфиг.
 */
const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  throw new Error("DATABASE_URL не задан");
}

export const client = postgres(url, { max: 10 });
export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
