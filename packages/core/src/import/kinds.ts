/**
 * Что за операция: трата, доход или перекладывание своих денег.
 *
 * Граница проходит по системе учёта, а не по кошельку. Приложение видит те
 * счета, выписки которых человек в него принёс; всё остальное — «улица», даже
 * если это его собственный кошелёк. Деньги, пришедшие с улицы, — доход в тот
 * момент, когда они вошли в систему: другого шанса их заметить не будет.
 *
 * Перекладывание между учтёнными счетами не доход и не расход: одна и та же
 * тысяча, ушедшая с крипты и пришедшая на карту, не должна считаться дважды.
 * Такие пары сводятся по сумме и дате, а всё, что не свелось, человек
 * разбирает сам — руками, каждый раз заново.
 */

export type OperationKind = "expense" | "income" | "transfer";

/** Виды операций из выписок: перевод внутри своих счетов, а не движение денег. */
const TRANSFER_TYPES = [
  "withdraw", "withdrawal", "deposit", "top up", "topup", "top-up",
  "transfer", "перевод", "переказ", "пополнение", "поповнення",
  "надходження", "зарахування", "a2c", "c2c", "p2p", "card top up",
];

/** Обмен одной валюты на другую внутри счёта: денег не стало ни больше, ни меньше. */
const SWAP_TYPES = ["swap", "exchange", "conversion", "обмен", "обмін", "конвертация"];

/** Мелочь, которую платформа возвращает на баланс: комиссия, бонус, кэшбек. */
const REWARD_TYPES = ["referral", "bonus", "reward", "cashback", "кэшбек", "кешбек", "бонус"];

function has(value: string, words: string[]): boolean {
  const clean = value.trim().toLowerCase();
  return clean !== "" && words.some((word) => clean.includes(word));
}

export function isSwap(type: string): boolean {
  return has(type, SWAP_TYPES);
}

export function isReward(type: string): boolean {
  return has(type, REWARD_TYPES);
}

export function isTransferType(type: string): boolean {
  return has(type, TRANSFER_TYPES);
}

/**
 * Вид операции по её типу и направлению.
 *
 * Уход считается переводом, а не тратой, пока человек не сказал обратного:
 * записать перевод расходом — значит завысить траты, а пропущенную покупку
 * видно сразу и вносится она руками. Ошибаться лучше в эту сторону.
 */
export function classifyOperation(type: string, incoming: boolean): OperationKind {
  if (isSwap(type)) return "transfer";
  if (isReward(type)) return incoming ? "income" : "expense";
  if (isTransferType(type)) return "transfer";

  return incoming ? "income" : "expense";
}

/** Насколько разойдутся суммы одной и той же переложенной тысячи. */
export function pairTolerance(amount: number): number {
  // Комиссия сети и разница курса между двумя счетами: пять процентов с запасом.
  return Math.max(0.05, amount * 0.05);
}

/** Сколько дней между уходом и приходом ещё считается одним переносом. */
export const PAIR_WINDOW_DAYS = 3;
