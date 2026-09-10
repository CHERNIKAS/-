/**
 * Сверка возврата с покупкой.
 *
 * Чистая логика без базы: именно она однажды приняла пополнение карты за
 * возврат и тихо срезала месяц, поэтому живёт отдельно и под тестами.
 */

/** Своё же движение денег: не трата, не доход и точно не возврат. */
const TRANSFER_WORDS = [
  "top up", "topup", "top-up", "deposit", "withdraw", "withdrawal", "transfer",
  "exchange", "swap", "conversion", "cashback", "reward",
  "пополнение", "пополнил", "перевод", "обмен", "вывод", "кэшбек", "кешбек",
  "поповнення", "переказ", "обмін",
  "yükleme", "yukleme", "havale", "transfer i̇şlemi",
];

export function looksLikeTransfer(description: string): boolean {
  const clean = description.toLowerCase().replace(/\s+/g, " ");
  return TRANSFER_WORDS.some((word) => clean.includes(word));
}

/**
 * Общее значимое слово в названиях: «MIGROS-154203» и «MIGROS ALANYA» — одно
 * место.
 *
 * Сравнивается только то, что стоит до первой запятой: в карточных выписках
 * там имя магазина, а дальше город и страна. Без этого возврат из Trendyol
 * «совпадал» с покупкой в Migros — общим у них было слово ISTANBUL.
 */
export function sameMerchant(left: string, right: string): boolean {
  const words = (text: string): string[] =>
    (text.split(",")[0] ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !NOISE.has(w));

  const first = new Set(words(left));
  if (first.size === 0) return false;

  return words(right).some((w) => first.has(w));
}

/** Слова, которые есть у половины магазинов и потому ничего не различают. */
const NOISE = new Set([
  "com", "www", "net", "org", "ltd", "limited", "inc", "llc", "shop", "store",
  "online", "market", "markt", "sanayi", "ticaret", "turizm", "group", "grup",
  "магазин", "маркет", "сервис",
]);
