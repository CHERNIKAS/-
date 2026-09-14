import { totalSince } from "./expenses.js";
import { ledgersOf } from "./ledgers.js";

/**
 * Итоги для закреплённой панели — по каждой книге человека.
 *
 * Закреп — это взгляд на все деньги сразу, а не на открытую книгу: трата в
 * «чайной» не должна исчезать с глаз, пока открыт общий бюджет. Книги без трат
 * отдаются тоже, отсеивает их тот, кто рисует: так решение, что показывать,
 * живёт в одном месте.
 */
export type PanelBook = {
  id: number;
  title: string;
  kind: string;
  dayUsd: number;
  monthUsd: number;
};

export async function panelTotals(userId: number, today: string): Promise<PanelBook[]> {
  const books = await ledgersOf(userId);
  const monthStart = `${today.slice(0, 7)}-01`;

  const result: PanelBook[] = [];
  for (const book of books) {
    result.push({
      id: book.id,
      title: book.kind === "personal" ? "Личное" : book.title,
      kind: book.kind,
      dayUsd: await totalSince(book.id, today),
      monthUsd: await totalSince(book.id, monthStart),
    });
  }

  return result;
}
