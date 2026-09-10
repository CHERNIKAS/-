import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  BOT_TOKEN: z.string().min(20, "нужен токен бота"),
  BOT_USERNAME: z.string().default("costnote_bot"),
  DATABASE_URL: z.string().min(1),

  GEMINI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gemini-3.1-flash-lite"),

  DEFAULT_CURRENCY: z.enum(["USD", "EUR", "UAH", "TRY"]).default("USD"),
  DEFAULT_TIMEZONE: z.string().default("Europe/Istanbul"),
  DEFAULT_REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(21),

  WEBAPP_URL: z.string().default(""),

  /** Куда складывать присланные выписки. В контейнере это подключённый том. */
  STATEMENTS_DIR: z.string().default("/data/statements"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  console.error(`Не хватает настроек в .env:\n${lines.join("\n")}`);
  process.exit(1);
}

export const env = parsed.data;
