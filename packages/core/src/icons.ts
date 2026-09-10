/**
 * Значок для категории по её названию.
 *
 * Новых категорий может быть под полсотни, и если у всех один и тот же значок,
 * список превращается в столбик одинаковых квадратов — глазом уже не найти
 * нужную строку. Поэтому название сопоставляется с набором готовых значков.
 *
 * Таблица одна на бота и приложение: в чате нужен эмодзи, в приложении — свой
 * рисунок, и они не должны разъезжаться. Не угадали — «прочее», это честнее
 * случайного значка.
 */

export type IconKey =
  | "shop" | "cafe" | "transport" | "housing" | "connect" | "health"
  | "clothes" | "fun" | "subs" | "other"
  | "sport" | "kids" | "pets" | "gift" | "study" | "beauty"
  | "repair" | "car" | "travel" | "tax" | "book" | "tech" | "smoke" | "bar";

type Rule = { icon: IconKey; emoji: string; words: string[] };

/**
 * Порядок важен: правила проверяются сверху вниз, и более узкие стоят раньше.
 * «Детские книги» — это дети, а не книги.
 */
const RULES: Rule[] = [
  { icon: "kids", emoji: "🧸", words: ["дет", "ребен", "ребён", "сын", "дочь", "школ", "садик", "игрушк", "kids", "child"] },
  { icon: "pets", emoji: "🐾", words: ["кот", "кош", "собак", "пёс", "пес", "питом", "ветер", "корм", "pet", "vet"] },
  { icon: "sport", emoji: "🏋", words: ["спорт", "зал", "фитнес", "бассейн", "трениров", "йога", "бег", "gym", "sport", "fitness"] },
  { icon: "beauty", emoji: "💅", words: ["красот", "салон", "парикмах", "барбер", "маник", "космет", "уход", "beauty", "barber", "spa"] },
  { icon: "study", emoji: "🎓", words: ["образов", "курс", "учеб", "универ", "школа", "язык", "репетит", "study", "course", "school"] },
  { icon: "book", emoji: "📚", words: ["книг", "чтен", "литерат", "book"] },
  { icon: "travel", emoji: "✈", words: ["путеш", "поезд", "отпуск", "билет", "авиа", "отел", "гостин", "travel", "flight", "hotel"] },
  { icon: "car", emoji: "🚗", words: ["авто", "машин", "бензин", "заправ", "парков", "шино", "страхов", "car", "fuel", "gas"] },
  { icon: "repair", emoji: "🔧", words: ["ремонт", "строй", "инструм", "мастер", "сантех", "электрик", "repair", "tools"] },
  { icon: "tech", emoji: "💻", words: ["техник", "гаджет", "электрон", "компьют", "ноут", "телефон", "tech", "device", "hardware"] },
  { icon: "gift", emoji: "🎁", words: ["подар", "презент", "сувенир", "цвет", "gift", "present"] },
  { icon: "tax", emoji: "🧾", words: ["налог", "пошлин", "штраф", "комисс", "банк", "tax", "fee", "fine"] },
  { icon: "bar", emoji: "🍷", words: ["бар", "алког", "вино", "пиво", "виск", "bar", "wine", "beer", "alcohol"] },
  { icon: "smoke", emoji: "🚬", words: ["сигар", "табак", "вейп", "куриль", "smoke", "vape", "tobacco"] },
  { icon: "health", emoji: "🩺", words: ["здоров", "аптек", "врач", "лекарс", "клиник", "стомат", "анализ", "health", "pharm", "doctor"] },
  { icon: "housing", emoji: "🏠", words: ["жиль", "аренд", "кварт", "квкартплат", "комун", "коммун", "ипотек", "rent", "home", "housing"] },
  { icon: "connect", emoji: "📶", words: ["связ", "интернет", "мобил", "телеком", "sim", "internet", "mobile"] },
  { icon: "subs", emoji: "🔁", words: ["подпис", "сервис", "облак", "хостинг", "subscription", "subs"] },
  { icon: "clothes", emoji: "👕", words: ["одежд", "обув", "гардероб", "магазин одежды", "cloth", "shoes", "wear"] },
  { icon: "cafe", emoji: "☕", words: ["кафе", "кофе", "ресторан", "еда вне", "доставк", "фастфуд", "бранч", "cafe", "coffee", "restaurant"] },
  { icon: "transport", emoji: "🚌", words: ["транспорт", "такси", "метро", "автобус", "проезд", "самокат", "taxi", "metro", "bus"] },
  { icon: "fun", emoji: "🎬", words: ["развлеч", "кино", "театр", "концерт", "игр", "досуг", "fun", "cinema", "game"] },
  { icon: "shop", emoji: "🛒", words: ["магаз", "продукт", "супермарк", "бакал", "хозтов", "shop", "grocery", "market"] },
];

const FALLBACK: Rule = { icon: "other", emoji: "📦", words: [] };

/** Значок и эмодзи по названию категории. */
export function guessIcon(title: string): { icon: IconKey; emoji: string } {
  const clean = title.trim().toLowerCase();

  for (const rule of RULES) {
    if (rule.words.some((word) => clean.includes(word))) {
      return { icon: rule.icon, emoji: rule.emoji };
    }
  }

  return { icon: FALLBACK.icon, emoji: FALLBACK.emoji };
}
