import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureUser, expenseById, learnRule, listCategories, schema } from "@costnote/core/data";
import { handleEditedMessage, saveExpenses } from "../src/handlers/expense.js";

/**
 * Обработчики бота на настоящей базе в памяти и с заглушкой Telegram.
 *
 * Категории выдают правила, а не модель: сеть в тестах выключена.
 */

let fake = 1;
const quietApi = new Proxy({}, { get: () => async () => ({ message_id: ++fake }) }) as never;

function ctx(chatId: string, messageId: number, edited = false) {
  return {
    chat: { id: Number(chatId) },
    msg: { message_id: messageId },
    editedMessage: edited ? { message_id: messageId } : undefined,
    api: quietApi,
    reply: async () => ({ message_id: ++fake }),
    deleteMessage: async () => true,
  } as never;
}

let tg = 9000;

async function setup() {
  const { user, ledgerId } = await ensureUser({ id: ++tg });
  const [category] = await listCategories(ledgerId);
  for (const merchant of ["кофе", "айфон", "такси", "долг"]) await learnRule(user.id, merchant, category!.id);
  const chatId = String(user.tgId);

  async function say(messageId: number, text: string) {
    const [raw] = await db
      .insert(schema.rawInputs)
      .values({ userId: user.id, chatId, tgMessageId: messageId, text })
      .returning();
    await saveExpenses(ctx(chatId, messageId), user, ledgerId, chatId, text, raw!.id);
    return raw!.id;
  }

  const live = (rawId: number) =>
    db.query.expenses.findMany({
      where: and(eq(schema.expenses.rawInputId, rawId), isNull(schema.expenses.deletedAt)),
    });

  return { user, ledgerId, chatId, say, live };
}

describe("правка сообщения", () => {
  it("переписывает только траты этого сообщения", async () => {
    const { user, ledgerId, chatId, say, live } = await setup();

    const coffee = await say(1, "кофе 3$");
    const phone = await say(2, "айфон 15 1000$");
    expect(Number((await live(phone))[0]?.amount)).toBe(1000);

    await handleEditedMessage(ctx(chatId, 2, true), user, ledgerId, "айфон 15 1200$");

    expect(await live(coffee)).toHaveLength(1);
    const phones = await live(phone);
    expect(phones).toHaveLength(1);
    expect(Number(phones[0]?.amount)).toBe(1200);
  });

  it("доход из сообщения не задваивается при правке", async () => {
    const { user, ledgerId, chatId, say, live } = await setup();
    const salary = await say(3, "зп 500$");

    await handleEditedMessage(ctx(chatId, 3, true), user, ledgerId, "зп 600$");
    const incomes = await live(salary);

    expect(incomes).toHaveLength(1);
    expect(incomes[0]?.kind).toBe("income");
    expect(Number(incomes[0]?.amount)).toBe(600);
  });

  it("возврат из сообщения не применяется второй раз", async () => {
    const { user, ledgerId, chatId, say } = await setup();
    await say(4, "такси 30$");
    const [taxi] = await db.query.expenses.findMany({
      where: and(eq(schema.expenses.ledgerId, ledgerId), eq(schema.expenses.kind, "expense")),
    });

    await say(5, "возврат 30$");
    expect(Number((await expenseById(taxi!.id))?.refundedAmount)).toBe(30);

    await handleEditedMessage(ctx(chatId, 5, true), user, ledgerId, "возврат 28$");
    expect(Number((await expenseById(taxi!.id))?.refundedAmount)).toBe(28);
  });
});

describe("возвраты текстом", () => {
  it("«вернул долг 50» — доход, покупка на 50 не тронута", async () => {
    const { ledgerId, say, live } = await setup();
    await say(6, "айфон 50$");

    const debt = await say(7, "вернул долг 50$");
    const rows = await db.query.expenses.findMany({
      where: and(eq(schema.expenses.ledgerId, ledgerId), eq(schema.expenses.kind, "expense")),
    });

    expect(rows.every((r) => Number(r.refundedAmount) === 0)).toBe(true);
    expect((await live(debt))[0]?.kind).toBe("income");
  });
});

describe("даты", () => {
  it("«31/02 такси 10» сохраняется сегодняшним днём", async () => {
    const { say, live } = await setup();
    const id = await say(8, "31/02 такси 10$");
    const [row] = await live(id);
    expect(Number(row?.amount)).toBe(10);
  });
});
