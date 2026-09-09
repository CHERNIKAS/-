const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", UAH: "₴", TRY: "₺" };

export function money(amount: number, currency: string): string {
  const digits = Math.abs(amount) < 10 && amount !== 0 ? 2 : 0;
  return `${SYMBOL[currency] ?? ""}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)}`;
}

export function moneyExact(amount: number, currency: string): string {
  return `${SYMBOL[currency] ?? ""}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function dayTitle(day: string, today: string): string {
  if (day === today) return "Сегодня";

  const date = new Date(`${day}T00:00:00Z`);
  const diff = Math.round(
    (new Date(`${today}T00:00:00Z`).getTime() - date.getTime()) / 86_400_000,
  );

  if (diff === 1) return "Вчера";
  if (diff === 2) return "Позавчера";

  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
