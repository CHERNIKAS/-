import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { FALLBACK_CATEGORY_SLUG } from "../index.js";

/**
 * Предложения завести категорию.
 *
 * Категория рождается не от новой траты, а от накопленного паттерна: одна
 * покупка штатива не повод заводить «Фототехнику» с единственной записью
 * внутри, а семь покупок сигарет за месяц — уже повод. Так список категорий
 * растёт по делу и не превращается в свалку из мёртвых строк.
 */

export type Suggestion = {
  merchant: string;
  count: number;
  totalUsd: number;
};

const MIN_COUNT = 4;

export async function pendingSuggestions(
  ledgerId: number,
  since: string,
  limit = 3,
): Promise<Suggestion[]> {
  const other = await db.query.categories.findFirst({
    where: and(
      eq(schema.categories.ledgerId, ledgerId),
      eq(schema.categories.slug, FALLBACK_CATEGORY_SLUG),
    ),
  });
  if (!other) return [];

  const countExpr = sql<string>`count(*)`;

  const rows = await db
    .select({
      merchant: sql<string>`lower(${schema.expenses.merchant})`,
      count: countExpr,
      total: sql<string>`coalesce(sum(${schema.expenses.amount} * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        eq(schema.expenses.categoryId, other.id),
        gte(schema.expenses.spentAt, since),
        isNull(schema.expenses.deletedAt),
      ),
    )
    .groupBy(sql`lower(${schema.expenses.merchant})`)
    .having(sql`count(*) >= ${MIN_COUNT}`)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  return rows
    .filter((r) => r.merchant !== null && r.merchant.trim() !== "")
    .map((r) => ({
      merchant: r.merchant.trim(),
      count: Number(r.count),
      totalUsd: Number(r.total),
    }));
}

/** Заводит категорию и переносит в неё накопившиеся траты этого места. */
export async function createCategoryFromSuggestion(
  ledgerId: number,
  userId: number,
  merchant: string,
): Promise<{ id: number; title: string } | null> {
  const title = merchant.charAt(0).toUpperCase() + merchant.slice(1);
  const slug = `c${Date.now().toString(36)}`;

  const [created] = await db
    .insert(schema.categories)
    .values({ ledgerId, slug, title: title.slice(0, 64), emoji: "🏷", sort: 100 })
    .returning();

  if (!created) return null;

  await db
    .update(schema.expenses)
    .set({ categoryId: created.id })
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        sql`lower(${schema.expenses.merchant}) = ${merchant.toLowerCase()}`,
        isNull(schema.expenses.deletedAt),
      ),
    );

  await db
    .insert(schema.rules)
    .values({ userId, pattern: merchant.toLowerCase(), categoryId: created.id, hits: 1 })
    .onConflictDoUpdate({
      target: [schema.rules.userId, schema.rules.pattern],
      set: { categoryId: created.id },
    });

  return { id: created.id, title: created.title };
}
