import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createExpense,
  db,
  daySummaryText,
  ensureUser,
  refreshDaySummaries,
  rememberDaySummary,
  schema,
} from "./index.js";

const DAY = "2026-09-17";

describe("итог дня переписывается после правки", () => {
  it("исправленная трата меняет уже отправленный итог", async () => {
    const { user, ledgerId } = await ensureUser({ id: 8101 });
    const base = { ledgerId, userId: user.id, categoryId: null, currency: "USD" as const, rateToUsd: 1, spentAt: DAY, merchant: "проезд", confidence: null, needsReview: false };
    const wrong = await createExpense({ ...base, amount: 540 });
    await createExpense({ ...base, amount: 25, merchant: "Claude" });

    const first = await daySummaryText(user, DAY);
    expect(first.text).toContain("$565");
    await rememberDaySummary(user.id, String(user.tgId), 777, DAY);

    await db.update(schema.expenses).set({ amount: "11.10" }).where(eq(schema.expenses.id, wrong.id));

    const edits: { chat: string; message: number; text: string }[] = [];
    await refreshDaySummaries(user, [DAY, "2026-09-16"], async (chat, message, text) => {
      edits.push({ chat, message, text });
    });

    expect(edits).toHaveLength(1);
    expect(edits[0]?.message).toBe(777);
    expect(edits[0]?.text).toContain("$36");
  });

  it("день без отправленного итога не трогается", async () => {
    const { user } = await ensureUser({ id: 8102 });
    const edits: unknown[] = [];
    await refreshDaySummaries(user, [DAY], async (...args) => {
      edits.push(args);
    });
    expect(edits).toHaveLength(0);
  });
});
