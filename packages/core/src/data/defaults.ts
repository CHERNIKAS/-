import type { Currency } from "../currencies.js";

/**
 * Значения для нового пользователя.
 *
 * Живут в слое данных, а не в конфиге приложения: заводить пользователя может
 * и бот, и приложение, и оба должны заводить его одинаково.
 */
export const env = {
  DEFAULT_CURRENCY: (process.env["DEFAULT_CURRENCY"] ?? "USD") as Currency,
  DEFAULT_TIMEZONE: process.env["DEFAULT_TIMEZONE"] ?? "Europe/Istanbul",
  DEFAULT_REMINDER_HOUR: Number(process.env["DEFAULT_REMINDER_HOUR"] ?? 21),
};
