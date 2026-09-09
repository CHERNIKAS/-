import { CATEGORY_SEED } from "../index.js";
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { activeLedgerId } from "./ledgers.js";
import { env } from "./defaults.js";

export type AppUser = typeof schema.users.$inferSelect;

/**
 * Первое сообщение от человека заводит ему всё сразу: пользователя, личную
 * книгу трат и стартовые категории. Отдельного «зарегистрируйтесь» нет —
 * человек просто пишет трату, и она сохраняется.
 */
export async function ensureUser(tg: {
  id: number;
  username?: string | undefined;
  first_name?: string | undefined;
}): Promise<{ user: AppUser; ledgerId: number }> {
  const tgId = String(tg.id);

  const existing = await db.query.users.findFirst({ where: eq(schema.users.tgId, tgId) });
  if (existing) {
    // Активная книга, а не всегда личная: человек мог переключиться на общую.
    return { user: existing, ledgerId: await activeLedgerId(existing) };
  }

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        tgId,
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        currency: env.DEFAULT_CURRENCY,
        timezone: env.DEFAULT_TIMEZONE,
        reminderHour: env.DEFAULT_REMINDER_HOUR,
      })
      .returning();

    if (!user) throw new Error("не удалось создать пользователя");

    const [ledger] = await tx
      .insert(schema.ledgers)
      .values({ title: "Личные траты", ownerId: user.id, isShared: false })
      .returning();

    if (!ledger) throw new Error("не удалось создать книгу трат");

    await tx
      .insert(schema.ledgerMembers)
      .values({ ledgerId: ledger.id, userId: user.id, role: "owner" });

    await tx.insert(schema.categories).values(
      CATEGORY_SEED.map((c, i) => ({
        ledgerId: ledger.id,
        slug: c.slug,
        title: c.title,
        emoji: c.emoji,
        hint: c.hint,
        sort: i,
      })),
    );

    return { user, ledgerId: ledger.id };
  });
}

export async function updateUser(userId: number, patch: Partial<AppUser>): Promise<void> {
  await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
}
