import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "./db.js";

/**
 * Доступ внешних приложений (Claude) к тратам человека.
 *
 * Всё секретное — коды и токены — живёт в базе только хешем. Отдаётся наружу
 * один раз, в момент выдачи.
 */

export const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_DAYS = 60;
const REQUEST_TTL_MINUTES = 10;

export function secret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function registerClient(name: string | null, redirectUris: string[]) {
  const [row] = await db
    .insert(schema.oauthClients)
    .values({ id: secret(18), name: name?.slice(0, 128) ?? null, redirectUris: JSON.stringify(redirectUris) })
    .returning();
  if (!row) throw new Error("клиент не сохранился");
  return { id: row.id, name: row.name, redirectUris };
}

export async function clientById(id: string) {
  const row = await db.query.oauthClients.findFirst({ where: eq(schema.oauthClients.id, id) });
  if (!row) return undefined;
  return { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirectUris) as string[] };
}

export async function createAuthRequest(values: {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
}): Promise<string> {
  const id = secret(24);
  await db.insert(schema.oauthRequests).values({
    id,
    ...values,
    expiresAt: new Date(Date.now() + REQUEST_TTL_MINUTES * 60_000),
  });
  return id;
}

export type AuthRequest = typeof schema.oauthRequests.$inferSelect;

export async function liveAuthRequest(id: string): Promise<AuthRequest | undefined> {
  return db.query.oauthRequests.findFirst({
    where: and(eq(schema.oauthRequests.id, id), gt(schema.oauthRequests.expiresAt, new Date())),
  });
}

/** Ответ из бота. Один раз: повторное нажатие чужого решения не меняет. */
export async function decideAuthRequest(id: string, userId: number, approve: boolean): Promise<boolean> {
  const rows = await db
    .update(schema.oauthRequests)
    .set(approve ? { userId, approvedAt: new Date() } : { userId, deniedAt: new Date() })
    .where(
      and(
        eq(schema.oauthRequests.id, id),
        isNull(schema.oauthRequests.approvedAt),
        isNull(schema.oauthRequests.deniedAt),
        gt(schema.oauthRequests.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.oauthRequests.id });
  return rows.length > 0;
}

/** Код выдаётся странице входа один раз, после подтверждения в боте. */
export async function issueCode(id: string): Promise<string | undefined> {
  const code = secret(32);
  const rows = await db
    .update(schema.oauthRequests)
    .set({ codeHash: hashSecret(code) })
    .where(and(eq(schema.oauthRequests.id, id), isNull(schema.oauthRequests.codeHash)))
    .returning({ id: schema.oauthRequests.id });
  return rows.length > 0 ? code : undefined;
}

export async function consumeCode(code: string): Promise<AuthRequest | undefined> {
  const [row] = await db
    .update(schema.oauthRequests)
    .set({ codeUsedAt: new Date() })
    .where(
      and(
        eq(schema.oauthRequests.codeHash, hashSecret(code)),
        isNull(schema.oauthRequests.codeUsedAt),
        gt(schema.oauthRequests.expiresAt, new Date()),
      ),
    )
    .returning();
  return row;
}

export async function issueTokens(userId: number, clientId: string, scope: string) {
  const access = secret(32);
  const refresh = secret(32);
  await db.insert(schema.oauthTokens).values({
    userId,
    clientId,
    scope,
    accessHash: hashSecret(access),
    refreshHash: hashSecret(refresh),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
  });
  return { access, refresh, scope };
}

/** Обновление с ротацией: старая пара гасится в тот же момент. */
export async function rotateTokens(refresh: string, clientId: string) {
  const [old] = await db
    .update(schema.oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.oauthTokens.refreshHash, hashSecret(refresh)),
        eq(schema.oauthTokens.clientId, clientId),
        isNull(schema.oauthTokens.revokedAt),
        gt(schema.oauthTokens.refreshExpiresAt, new Date()),
      ),
    )
    .returning();
  if (!old) return undefined;
  return issueTokens(old.userId, old.clientId, old.scope);
}

export async function tokenOwner(access: string) {
  const row = await db.query.oauthTokens.findFirst({
    where: and(
      eq(schema.oauthTokens.accessHash, hashSecret(access)),
      isNull(schema.oauthTokens.revokedAt),
      gt(schema.oauthTokens.accessExpiresAt, new Date()),
    ),
  });
  if (!row) return undefined;

  await db.update(schema.oauthTokens).set({ lastUsedAt: new Date() }).where(eq(schema.oauthTokens.id, row.id));
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
  return user === undefined ? undefined : { user, scope: row.scope };
}

/** Отключить все подключения человека разом. Возвращает, сколько погасло. */
export async function revokeAllTokens(userId: number): Promise<number> {
  const rows = await db
    .update(schema.oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.oauthTokens.userId, userId), isNull(schema.oauthTokens.revokedAt)))
    .returning({ id: schema.oauthTokens.id });
  return rows.length;
}
