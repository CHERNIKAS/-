import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { client, db } from "./db.js";

// Путь считается от самого файла, а не от рабочего каталога: pnpm --filter
// запускает скрипт из папки пакета, а миграции лежат в корне репозитория.
const folder = fileURLToPath(new URL("../../../migrations", import.meta.url));

await migrate(db, { migrationsFolder: folder });
console.log("миграции применены");
await client.end();
