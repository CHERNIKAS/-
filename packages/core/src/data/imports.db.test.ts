import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  addBalanceEntry,
  claimImport,
  createExpense,
  createImportPreview,
  createLedger,
  db,
  ensureUser,
  expenseById,
  linkTransferPair,
  schema,
  suggestionKey,
  undoImport,
} from "./index.js";
import type { Mapping } from "../import/detect.js";

const DAY = "2026-09-14";
let tg = 6000;

const mapping = {
  skipRows: 0,
  dateColumn: 0,
  amountColumn: 1,
  descriptionColumn: 2,
  creditColumn: null,
  currencyColumn: null,
  statusColumn: null,
  typeColumn: null,
  counterpartyColumn: null,
  okStatuses: [],
  dateOrder: "dmy",
  decimalSeparator: ".",
  expenseIsNegative: true,
  currency: "USD",
  confidence: 1,
} satisfies Mapping;

async function preview() {
  const { user, ledgerId } = await ensureUser({ id: ++tg });
  const record = await createImportPreview({ userId: user.id, ledgerId, filename: "a.csv", rows: [], credits: [], mapping });
  return { user, ledgerId, record };
}

describe("применение импорта", () => {
  it("двойное нажатие применяет импорт один раз", async () => {
    const { user, record } = await preview();

    const [first, second] = await Promise.all([claimImport(record.id, user.id), claimImport(record.id, user.id)]);
    expect([first, second].filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("чужой импорт не захватить", async () => {
    const { record } = await preview();
    const stranger = await ensureUser({ id: ++tg });
    expect(await claimImport(record.id, stranger.user.id)).toBeUndefined();
  });
});

describe("откат импорта", () => {
  it("убирает встречную строку переноса и движение баланса", async () => {
    const { user, ledgerId, record } = await preview();
    await claimImport(record.id, user.id);
    const business = await createLedger(user, "Дело", "business");

    const entry = await addBalanceEntry({ ledgerId, userId: user.id, place: "нал", amount: 20, currency: "USD", happenedAt: DAY });
    const base = { userId: user.id, categoryId: null, amount: 20, currency: "USD" as const, rateToUsd: 1, spentAt: DAY, merchant: "Перевод", confidence: null, needsReview: false };

    const imported = await createExpense({ ...base, ledgerId, kind: "transfer", counterparty: `book:${business.id}` });
    const mirror = await createExpense({ ...base, ledgerId: business.id, kind: "transfer", counterparty: `book:${ledgerId}` });
    await linkTransferPair(imported.id, mirror.id);
    await db
      .update(schema.expenses)
      .set({ importId: record.id, balanceEntryId: entry.id })
      .where(eq(schema.expenses.id, imported.id));

    expect(await undoImport(record.id)).toBe(1);
    expect((await expenseById(mirror.id))?.deletedAt).not.toBeNull();
    expect(await db.query.balanceEntries.findFirst({ where: eq(schema.balanceEntries.id, entry.id) })).toBeUndefined();
  });
});

describe("ключ предложения категории", () => {
  it("короткий, стабильный и не зависит от регистра", () => {
    const long = "Супермаркет у дома на углу возле остановки";
    expect(suggestionKey(long)).toHaveLength(16);
    expect(suggestionKey(long)).toBe(suggestionKey(long.toUpperCase()));
    expect(`g:add:${suggestionKey(long)}`.length).toBeLessThanOrEqual(64);
  });
});
