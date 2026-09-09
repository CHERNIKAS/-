import { normalizePattern } from "../index.js";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db.js";

export type StoredRule = { pattern: string; categoryId: number; slug: string };

/** Правила пользователя вместе со slug категории — в таком виде их ждёт categorize. */
export async function userRules(userId: number): Promise<StoredRule[]> {
  const rows = await db
    .select({
      pattern: schema.rules.pattern,
      categoryId: schema.rules.categoryId,
      slug: schema.categories.slug,
    })
    .from(schema.rules)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.rules.categoryId))
    .where(eq(schema.rules.userId, userId));

  return rows;
}

/**
 * Правка категории — это и есть обучение.
 *
 * Одно исправление превращается в правило, и со следующего раза строка
 * разбирается мгновенно, без обращения к модели.
 */
export async function learnRule(
  userId: number,
  merchant: string,
  categoryId: number,
): Promise<void> {
  const pattern = normalizePattern(merchant);
  if (pattern === "") return;

  await db
    .insert(schema.rules)
    .values({ userId, pattern, categoryId, hits: 1 })
    .onConflictDoUpdate({
      target: [schema.rules.userId, schema.rules.pattern],
      set: { categoryId, hits: sql`${schema.rules.hits} + 1` },
    });
}

/** Последние правки — подкладываются в запрос к модели, чтобы она не повторяла ошибки. */
export async function recentCorrections(
  userId: number,
  limit = 20,
): Promise<{ merchant: string; slug: string }[]> {
  const rows = await db
    .select({ merchant: schema.rules.pattern, slug: schema.categories.slug })
    .from(schema.rules)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.rules.categoryId))
    .where(eq(schema.rules.userId, userId))
    .orderBy(desc(schema.rules.createdAt))
    .limit(limit);

  return rows;
}
