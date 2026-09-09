import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { CATEGORY_SEED } from "../categories.js";
import { db, schema } from "./db.js";
import type { AppUser } from "./users.js";

/**
 * Книги трат.
 *
 * У каждого есть личная. Общая заводится по желанию и живёт по той же схеме:
 * категории принадлежат книге, правила — человеку. Из-за этого в общем бюджете
 * у каждого свой словарь распознавания, а разрез по категориям — общий.
 */

export type Ledger = typeof schema.ledgers.$inferSelect;

export async function personalLedger(userId: number): Promise<Ledger | undefined> {
  return db.query.ledgers.findFirst({
    where: and(eq(schema.ledgers.ownerId, userId), eq(schema.ledgers.isShared, false)),
  });
}

/** Книга, в которую сейчас пишутся траты. Пусто в настройках — значит личная. */
export async function activeLedgerId(user: AppUser): Promise<number> {
  if (user.activeLedgerId !== null) {
    const member = await db.query.ledgerMembers.findFirst({
      where: and(
        eq(schema.ledgerMembers.ledgerId, user.activeLedgerId),
        eq(schema.ledgerMembers.userId, user.id),
      ),
    });
    // Из книги могли выйти — тогда молча возвращаемся в личную.
    if (member) return user.activeLedgerId;
  }

  const personal = await personalLedger(user.id);
  if (!personal) throw new Error("у пользователя нет личной книги трат");
  return personal.id;
}

export async function ledgersOf(userId: number): Promise<Ledger[]> {
  const rows = await db
    .select({ ledger: schema.ledgers })
    .from(schema.ledgerMembers)
    .innerJoin(schema.ledgers, eq(schema.ledgers.id, schema.ledgerMembers.ledgerId))
    .where(eq(schema.ledgerMembers.userId, userId));

  return rows.map((r) => r.ledger);
}

export type Member = { userId: number; name: string; role: string; tgId: string };

export async function membersOf(ledgerId: number): Promise<Member[]> {
  const rows = await db
    .select({
      userId: schema.users.id,
      firstName: schema.users.firstName,
      username: schema.users.username,
      tgId: schema.users.tgId,
      role: schema.ledgerMembers.role,
    })
    .from(schema.ledgerMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.ledgerMembers.userId))
    .where(eq(schema.ledgerMembers.ledgerId, ledgerId));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.firstName ?? r.username ?? "участник",
    role: r.role,
    tgId: String(r.tgId),
  }));
}

/** Общая книга со своим набором категорий — теми же, что и у личной. */
export async function createSharedLedger(user: AppUser, title = "Общий бюджет"): Promise<Ledger> {
  return db.transaction(async (tx) => {
    const [ledger] = await tx
      .insert(schema.ledgers)
      .values({
        title,
        ownerId: user.id,
        isShared: true,
        inviteToken: randomBytes(12).toString("base64url"),
      })
      .returning();

    if (!ledger) throw new Error("не удалось создать общую книгу");

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

    return ledger;
  });
}

export async function ledgerByToken(token: string): Promise<Ledger | undefined> {
  return db.query.ledgers.findFirst({ where: eq(schema.ledgers.inviteToken, token) });
}

/** Присоединение по ссылке. Повторный переход по той же ссылке ничего не ломает. */
export async function joinLedger(ledgerId: number, userId: number): Promise<void> {
  await db
    .insert(schema.ledgerMembers)
    .values({ ledgerId, userId, role: "member" })
    .onConflictDoNothing();
}

/** Владелец может убрать участника; себя убрать нельзя — это выход из книги. */
export async function removeMember(
  ledgerId: number,
  ownerId: number,
  memberId: number,
): Promise<boolean> {
  const ledger = await db.query.ledgers.findFirst({ where: eq(schema.ledgers.id, ledgerId) });
  if (!ledger || ledger.ownerId !== ownerId || memberId === ownerId) return false;

  await leaveLedger(ledgerId, memberId);
  return true;
}

export async function leaveLedger(ledgerId: number, userId: number): Promise<void> {
  await db
    .delete(schema.ledgerMembers)
    .where(
      and(eq(schema.ledgerMembers.ledgerId, ledgerId), eq(schema.ledgerMembers.userId, userId)),
    );

  await db
    .update(schema.users)
    .set({ activeLedgerId: null })
    .where(and(eq(schema.users.id, userId), eq(schema.users.activeLedgerId, ledgerId)));
}
