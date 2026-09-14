/**
 * «Сегодня» глазами человека, а не сервера.
 *
 * Сервер живёт в UTC, человек — в своём поясе. В Стамбуле трата в час ночи
 * для сервера ещё вчерашняя, и раньше она так и записывалась: ночная покупка
 * уезжала в прошлый день, а с ней съезжали итог дня и вечерний вопрос.
 */
export function localToday(timezone: string, now = new Date()): string {
  try {
    // en-CA даёт дату ровно в виде ГГГГ-ММ-ДД — без ручной сборки из частей.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // Испорченный пояс — не повод ронять запись траты: берём дату сервера.
    return now.toISOString().slice(0, 10);
  }
}
