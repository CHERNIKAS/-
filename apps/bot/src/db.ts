import * as schema from "@costnote/core/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env.js";

const client = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema, client };
