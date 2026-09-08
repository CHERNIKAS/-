import { migrate } from "drizzle-orm/postgres-js/migrator";
import { client, db } from "./db.js";

await migrate(db, { migrationsFolder: "migrations" });
console.log("миграции применены");
await client.end();
