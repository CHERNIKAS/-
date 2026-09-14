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
function merchantWords(text: string): string[] {
  return (text.split(",")[0] ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !NOISE.has(w));
}

/**
 * Названо ли в строке хоть что-то, по чему узнаётся покупка.
 *
 * «возврат 15 лир» — без названия, верим сумме. «вернул долг 100» — названо, и
 * если покупки «долг» нет, это не возврат покупки, а просто пришедшие деньги.
 */
export function hasMerchantWords(text: string): boolean {
  return merchantWords(text).length > 0;
}

export function sameMerchant(left: string, right: string): boolean {
  const words = merchantWords;

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
