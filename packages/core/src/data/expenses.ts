import type { Currency } from "../index.js";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db.js";

export type Expense = typeof schema.expenses.$inferSelect;
export type Category = typeof schema.categories.$inferSelect;

export async function listCategories(ledgerId: number): Promise<Category[]> {
  return db.query.categories.findMany({
    where: and(eq(schema.categories.ledgerId, ledgerId), isNull(schema.categories.archivedAt)),
    orderBy: schema.categories.sort,
  });
}

export async function categoryBySlug(ledgerId: number, slug: string): Promise<Category | undefined> {
  return db.query.categories.findFirst({
    where: and(eq(schema.categories.ledgerId, ledgerId), eq(schema.categories.slug, slug)),
  });
}

export async function createExpense(values: {
  ledgerId: number;
  userId: number;
  categoryId: number | null;
  amount: number;
  currency: Currency;
  rateToUsd: number;
  spentAt: string;
  merchant: string;
  confidence: number | null;
  needsReview: boolean;
}): Promise<Expense> {
  const [row] = await db
    .insert(schema.expenses)
    .values({
      ledgerId: values.ledgerId,
      userId: values.userId,
      categoryId: values.categoryId,
      amount: values.amount.toFixed(2),
      currency: values.currency,
      rateToUsd: values.rateToUsd.toFixed(8),
      spentAt: values.spentAt,
      merchant: values.merchant.slice(0, 128),
      source: "bot",
      confidence: values.confidence === null ? null : values.confidence.toFixed(2),
      needsReview: values.needsReview,
    })
    .returning();

  if (!row) throw new Error("не удалось сохранить трату");
  return row;
}

export async function setCategory(expenseId: number, categoryId: number): Promise<void> {
  await db
    .update(schema.expenses)
    .set({ categoryId, needsReview: false, updatedAt: new Date() })
    .where(eq(schema.expenses.id, expenseId));
}

/** Мягкое удаление: трата исчезает из отчётов, но остаётся в базе. */
export async function softDelete(expenseId: number): Promise<void> {
  await db
    .update(schema.expenses)
    .set({ deletedAt: new Date() })
    .where(eq(schema.expenses.id, expenseId));
}

export async function expenseById(expenseId: number): Promise<Expense | undefined> {
  return db.query.expenses.findFirst({ where: eq(schema.expenses.id, expenseId) });
}

/** Сумма трат в долларах за период, от даты включительно. */
export async function totalSince(ledgerId: number, fromDay: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.expenses.amount} * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        gte(schema.expenses.spentAt, fromDay),
        isNull(schema.expenses.deletedAt),
      ),
    );

  return Number(row?.total ?? 0);
}
