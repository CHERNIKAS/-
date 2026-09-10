import type { Currency } from "../index.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db.js";

/**
 * Баланс — сколько денег есть сейчас.
 *
 * Хранится не числом, которое переписывают, а движениями: остаток это их
 * сумма. Так видно, из чего он сложился, а ошибка правится встречным
 * движением, ничего не затирая.
 *
 * Слой отдельный от трат намеренно. Траты отвечают «куда ушло», баланс —
 * «сколько осталось», и второе не выводится из первого, пока учёт неполон:
 * наличные тратятся молча, и никакая выписка этого не покажет.
 */

export type BalanceEntry = typeof schema.balanceEntries.$inferSelect;

export type BalancePlace = {
  place: string;
  currency: Currency;
  /** Остаток: сумма всех движений по этому месту и валюте. */
  amount: number;
  /** Сколько раз его трогали — по этому видно, живое место или забытое. */
  moves: number;
  lastAt: string;
};

export async function addBalanceEntry(values: {
  ledgerId: number;
  userId: number;
  place: string;
  amount: number;
  currency: Currency;
  note?: string | null;
  happenedAt: string;
}): Promise<BalanceEntry> {
  const [row] = await db
    .insert(schema.balanceEntries)
    .values({
      ledgerId: values.ledgerId,
      userId: values.userId,
      place: values.place.slice(0, 64),
      amount: values.amount.toFixed(2),
      currency: values.currency,
      note: values.note ?? null,
      happenedAt: values.happenedAt,
    })
    .returning();

  if (!row) throw new Error("не удалось записать движение по балансу");
  return row;
}

/** Остатки по местам: карта, крипта, наличка — каждое в своей валюте. */
export async function balanceByPlace(ledgerId: number): Promise<BalancePlace[]> {
  const rows = await db
    .select({
      place: schema.balanceEntries.place,
      currency: schema.balanceEntries.currency,
      amount: sql<string>`coalesce(sum(${schema.balanceEntries.amount}), 0)`,
      moves: sql<string>`count(*)`,
      lastAt: sql<string>`max(${schema.balanceEntries.happenedAt})`,
    })
    .from(schema.balanceEntries)
    .where(eq(schema.balanceEntries.ledgerId, ledgerId))
    .groupBy(schema.balanceEntries.place, schema.balanceEntries.currency)
    .orderBy(desc(sql`sum(${schema.balanceEntries.amount})`));

  return rows.map((r) => ({
    place: r.place,
    currency: r.currency as Currency,
    amount: Number(r.amount),
    moves: Number(r.moves),
    lastAt: r.lastAt,
  }));
}

/** Последние движения: по ним видно, что и когда прибавилось или убавилось. */
export async function recentBalanceEntries(
  ledgerId: number,
  limit = 30,
): Promise<BalanceEntry[]> {
  return db.query.balanceEntries.findMany({
    where: eq(schema.balanceEntries.ledgerId, ledgerId),
    orderBy: [desc(schema.balanceEntries.happenedAt), desc(schema.balanceEntries.id)],
    limit,
  });
}

/** Ошибочное движение убирается целиком: встречное здесь было бы враньём. */
export async function removeBalanceEntry(ledgerId: number, id: number): Promise<void> {
  await db
    .delete(schema.balanceEntries)
    .where(and(eq(schema.balanceEntries.id, id), eq(schema.balanceEntries.ledgerId, ledgerId)));
}
