import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  addBalanceEntry,
  applyRefund,
  byCategory,
  claimRecurring,
  confirmAuthRequest,
  consumeCode,
  createAuthRequest,
  createExpense,
  createLedger,
  createRecurring,
  db,
  dueRecurring,
  ensureUser,
  expenseById,
  findRefundTarget,
  issueCode,
  issueTokens,
  linkTransferPair,
  listCategories,
  liveAuthRequest,
  messageRefundFingerprint,
  removeExpense,
  revertMessageRefunds,
  rotateTokens,
  schema,
  tokenOwner,
  totalUsd,
  UNCATEGORIZED,
} from "./index.js";

const DAY = "2026-09-14";
let tg = 5000;

async function person() {
  const { user, ledgerId } = await ensureUser({ id: ++tg, username: `u${tg}` });
  return { user, ledgerId };
}

function spend(ledgerId: number, userId: number, extra: Partial<Parameters<typeof createExpense>[0]> = {}) {
  return createExpense({
    ledgerId,
    userId,
    categoryId: null,
    amount: 10,
    currency: "USD",
    rateToUsd: 1,
    spentAt: DAY,
    merchant: "Кофе",
    confidence: null,
    needsReview: false,
    ...extra,
  });
}

describe("удаление операции", () => {
  it("перенос в свою книгу уходит целиком, вместе с балансом", async () => {
    const { user, ledgerId } = await person();
    const business = await createLedger(user, "Дело", "business");

    const entry = await addBalanceEntry({ ledgerId, userId: user.id, place: "нал", amount: 40, currency: "USD", happenedAt: DAY });
    const out = await spend(ledgerId, user.id, { kind: "transfer", counterparty: `book:${business.id}` });
    const back = await spend(business.id, user.id, { kind: "transfer", counterparty: `book:${ledgerId}` });
    await linkTransferPair(out.id, back.id);
    await db.update(schema.expenses).set({ balanceEntryId: entry.id }).where(eq(schema.expenses.id, out.id));

    const removed = await removeExpense((await expenseById(out.id))!);

    expect(removed.sort()).toEqual([out.id, back.id].sort());
    expect((await expenseById(back.id))?.deletedAt).not.toBeNull();
    expect(await db.query.balanceEntries.findFirst({ where: eq(schema.balanceEntries.id, entry.id) })).toBeUndefined();
  });

  it("пара из двух выписок: вторая половина остаётся и уходит в разбор", async () => {
    const { user, ledgerId } = await person();
    const out = await spend(ledgerId, user.id, { kind: "transfer", counterparty: "0xabc" });
    const inc = await spend(ledgerId, user.id, { kind: "transfer", counterparty: "0xdef" });
    await linkTransferPair(out.id, inc.id);

    const removed = await removeExpense((await expenseById(out.id))!);
    const partner = await expenseById(inc.id);

    expect(removed).toEqual([out.id]);
    expect(partner?.deletedAt).toBeNull();
    expect(partner?.pairedWithId).toBeNull();
    expect(partner?.needsKindReview).toBe(true);
  });
});

describe("возвраты", () => {
  it("названная покупка обязана совпасть, без названия — по сумме", async () => {
    const { user, ledgerId } = await person();
    const taxi = await spend(ledgerId, user.id, { amount: 100, merchant: "Такси" });

    expect(await findRefundTarget(ledgerId, 100, "USD", DAY, "долг")).toBeUndefined();
    expect((await findRefundTarget(ledgerId, 100, "USD", DAY, "такси"))?.id).toBe(taxi.id);
    expect((await findRefundTarget(ledgerId, 100, "USD", DAY, ""))?.id).toBe(taxi.id);
  });

  it("возврат из сообщения откатывается правкой", async () => {
    const { user, ledgerId } = await person();
    const bought = await spend(ledgerId, user.id, { amount: 30 });

    await applyRefund(bought.id, 15, { fingerprint: messageRefundFingerprint(77, 15) });
    expect(Number((await expenseById(bought.id))?.refundedAmount)).toBe(15);

    await revertMessageRefunds(77);
    const after = await expenseById(bought.id);
    expect(Number(after?.refundedAmount)).toBe(0);
    expect(after?.refundedAt).toBeNull();
  });
});

describe("аналитика", () => {
  it("траты без категории входят в разбивку и сходятся с итогом", async () => {
    const { user, ledgerId } = await person();
    const [category] = await listCategories(ledgerId);
    await spend(ledgerId, user.id, { amount: 25, categoryId: category!.id });
    await spend(ledgerId, user.id, { amount: 7, categoryId: null });

    const period = { from: DAY, to: DAY, label: "" };
    const rows = await byCategory(ledgerId, period);
    const sum = rows.reduce((s, r) => s + r.totalUsd, 0);

    expect(sum).toBeCloseTo(await totalUsd(ledgerId, period));
    expect(rows.find((r) => r.slug === UNCATEGORIZED)?.totalUsd).toBe(7);
  });
});

describe("регулярные платежи", () => {
  it("начисляются один раз в месяц, даже если проходов два", async () => {
    const { user, ledgerId } = await person();
    const item = await createRecurring({ ledgerId, userId: user.id, categoryId: null, title: "Netflix", amount: 10, currency: "USD", dayOfMonth: 1 });

    expect(await claimRecurring(item.id, DAY)).toBe(true);
    expect(await claimRecurring(item.id, DAY)).toBe(false);
    expect(await dueRecurring(ledgerId, DAY)).toHaveLength(0);
    expect(await claimRecurring(item.id, "2026-10-01")).toBe(true);
  });
});

describe("подключение Claude", () => {
  const request = () =>
    createAuthRequest({ clientId: "c1", redirectUri: "https://claude.ai/api/mcp/auth_callback", state: "s", codeChallenge: "x", scope: "read" });

  it("три неверных кода гасят запрос", async () => {
    const { user } = await person();
    const { id, confirmCode } = await request();
    const wrong = confirmCode === "0000" ? "1111" : "0000";

    expect(await confirmAuthRequest(id, user.id, wrong)).toBe("wrong");
    expect(await confirmAuthRequest(id, user.id, wrong)).toBe("wrong");
    expect(await confirmAuthRequest(id, user.id, wrong)).toBe("locked");
    expect(await confirmAuthRequest(id, user.id, confirmCode)).toBe("gone");
  });

  it("верный код, повторная выдача кода, одноразовый обмен", async () => {
    const { user } = await person();
    const { id, confirmCode } = await request();

    expect(await confirmAuthRequest(id, user.id, confirmCode)).toBe("ok");
    expect((await liveAuthRequest(id))?.userId).toBe(user.id);

    const first = await issueCode(id);
    const second = await issueCode(id);
    expect(first).not.toBe(second);

    expect(await consumeCode(first!)).toBeUndefined();
    expect((await consumeCode(second!))?.id).toBe(id);
    expect(await consumeCode(second!)).toBeUndefined();
  });

  it("обновление токена с ротацией", async () => {
    const { user } = await person();
    const tokens = await issueTokens(user.id, "c1", "read");

    const next = await rotateTokens(tokens.refresh, "c1");
    expect(next).toBeDefined();
    expect(await rotateTokens(tokens.refresh, "c1")).toBeUndefined();
    expect(await rotateTokens(next!.refresh, "другой")).toBeUndefined();
    expect((await tokenOwner(next!.access))?.user.id).toBe(user.id);
  });
});
