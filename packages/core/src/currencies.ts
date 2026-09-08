export const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  UAH: "₴",
  TRY: "₺",
};

/**
 * Слова, по которым в строке опознаётся валюта.
 *
 * Список намеренно широкий: падежи, сленг, латиница, символы и набор в
 * неправильной раскладке. Что сюда не попало — доберёт модель, но каждое
 * слово здесь экономит вызов к ней, а значит и секунду ожидания.
 */
const ALIASES: Record<Currency, string[]> = {
  USD: [
    "$", "usd", "us$", "дол", "долл", "доллар", "доллара", "долларов", "долларах",
    "бакс", "бакса", "баксов", "баксах", "баксы", "бачей", "уе", "у.е",
  ],
  EUR: [
    "€", "eur", "евро", "евра", "еврик", "еврика", "евриков", "евро.", "e", "евр",
  ],
  UAH: [
    "₴", "uah", "грн", "грв", "гривна", "гривны", "гривен", "гривень", "гривна.",
    "гривну", "гривнах", "гривень.",
  ],
  TRY: [
    "₺", "try", "tl", "tr", "лир", "лира", "лиры", "лир.", "лиру", "лирах",
    "лирами", "турлир", "тл",
  ],
};

/** alias -> currency, собирается один раз при загрузке модуля. */
const ALIAS_TO_CURRENCY: Map<string, Currency> = new Map(
  (Object.entries(ALIASES) as [Currency, string[]][]).flatMap(([code, words]) =>
    words.map((w) => [w, code] as const),
  ),
);

/**
 * "eur" и "€" — не одно и то же для регулярки: символы могут стоять вплотную
 * к числу ("15₺", "$20"), буквенные формы — нет ("15лир" встречается, но
 * "20eur" тоже, поэтому вплотную разрешаем и им).
 */
export const CURRENCY_SYMBOLS = Object.values(CURRENCY_SYMBOL);

export function matchCurrency(token: string): Currency | null {
  const normalized = token.toLowerCase().replace(/[.,;:!?]+$/u, "");
  return ALIAS_TO_CURRENCY.get(normalized) ?? null;
}

/** Все алиасы, отсортированные от длинных к коротким — для жадного поиска в строке. */
export const ALL_ALIASES: string[] = [...ALIAS_TO_CURRENCY.keys()].sort(
  (a, b) => b.length - a.length,
);
