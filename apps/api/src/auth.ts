import { createHmac } from "node:crypto";

/**
 * Проверка initData от Telegram.
 *
 * Единственный барьер между приложением и чужими данными: без неё любой может
 * подставить чей угодно id обычным запросом. Подпись считается тем же токеном
 * бота, поэтому доверять клиенту ничего не нужно.
 */

export type TelegramUser = {
  id: number;
  username?: string | undefined;
  first_name?: string | undefined;
};

const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyInitData(initData: string, botToken: string): TelegramUser | null {
  if (initData === "") return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (hash === null) return null;

  params.delete("hash");

  const checkString = [...params.entries()]
    .map(([key, value]) => [key, value] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");

  if (expected !== hash) return null;

  // Старую подпись не принимаем: перехваченная строка иначе работала бы вечно.
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate)) return null;
  if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramUser | null;
    if (user === null || typeof user.id !== "number") return null;
    return user;
  } catch {
    return null;
  }
}
