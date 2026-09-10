import { and, eq, lte } from "drizzle-orm";
import type { Currency } from "../currencies.js";
import { db, schema } from "./db.js";

/**
 * Регулярные платежи.
 *
 * Заводятся один раз и начисляются сами. Такие траты человек помнит хуже
 * всего: за ними нет похода в магазин, и именно они тихо съедают бюджет.
 */

export type Recurring = typeof schema.recurring.$inferSelect;

export async function listRecurring(ledgerId: number): Promise<Recurring[]> {
  return db.query.recurring.findMany({
    where: eq(schema.recurring.ledgerId, ledgerId),
    orderBy: schema.recurring.dayOfMonth,
  });
}

export async function createRecurring(values: {
  ledgerId: number;
  userId: number;
  categoryId: number | null;
  title: string;
  amount: number;
  currency: Currency;
  dayOfMonth: number;
}): Promise<Recurring> {
  const [row] = await db
    .insert(schema.recurring)
    .values({
      ledgerId: values.ledgerId,
      userId: values.userId,
      categoryId: values.categoryId,
      title: values.title.slice(0, 128),
      amount: values.amount.toFixed(2),
      currency: values.currency,
      // 29–31 есть не в каждом месяце, поэтому день ограничен 28-м.
      dayOfMonth: Math.min(28, Math.max(1, Math.round(values.dayOfMonth))),
    })
    .returning();

  if (!row) throw new Error("не удалось создать регулярный платёж");
  return row;
}

/**
 * Книга в условии не для красоты: номер платежа приходит из запроса, и без
 * этой проверки чужой регулярный платёж выключался бы подбором номера.
 */
export async function setRecurringActive(
  ledgerId: number,
  id: number,
  active: boolean,
): Promise<void> {
  await db
    .update(schema.recurring)
    .set({ active })
    .where(and(eq(schema.recurring.id, id), eq(schema.recurring.ledgerId, ledgerId)));
}

export async function deleteRecurring(ledgerId: number, id: number): Promise<void> {
  await db
    .delete(schema.recurring)
    .where(and(eq(schema.recurring.id, id), eq(schema.recurring.ledgerId, ledgerId)));
}

/**
 * Платежи, которым пора начислиться: активные, чей день уже наступил, и за
 * этот месяц ещё не начисленные.
 */
export async function dueRecurring(ledgerId: number, day: string): Promise<Recurring[]> {
  const monthStart = `${day.slice(0, 7)}-01`;
  const dayOfMonth = Number(day.slice(8, 10));

  const rows = await db.query.recurring.findMany({
    where: and(
      eq(schema.recurring.ledgerId, ledgerId),
      eq(schema.recurring.active, true),
      lte(schema.recurring.dayOfMonth, dayOfMonth),
    ),
  });

  return rows.filter((r) => r.chargedMonth === null || r.chargedMonth < monthStart);
}

export async function markCharged(id: number, day: string): Promise<void> {
  await db
    .update(schema.recurring)
    .set({ chargedMonth: `${day.slice(0, 7)}-01` })
    .where(eq(schema.recurring.id, id));
}
