/**
 * Словарь состояний операции.
 *
 * Модель находит колонку статуса и говорит, какие значения означают
 * состоявшуюся операцию — и обычно попадает. Но цена ошибки здесь
 * несимметричная: пропустить отменённую операцию в расходы гораздо хуже, чем
 * лишний раз спросить. Поэтому поверх ответа модели работает словарь: слово из
 * списка отказов отбрасывает строку, что бы модель ни решила.
 *
 * Слова собраны из выписок и экспортов банков и кошельков на русском,
 * украинском, английском и турецком — языках, на которых они реально приходят.
 */

const REJECTED = [
  // английский
  "cancelled", "canceled", "cancel", "failed", "failure", "fail", "declined",
  "decline", "rejected", "reject", "reversed", "reversal", "voided", "void",
  "expired", "error", "denied", "chargeback", "refused", "unsuccessful",
  // ожидание: деньги ещё не ушли, считать их тратой рано
  "pending", "processing", "in progress", "hold", "on hold", "authorized",
  "authorisation", "authorization", "waiting", "created", "new",
  // русский
  "отменено", "отменена", "отменён", "отменен", "отмена", "отклонено",
  "отклонена", "отклонён", "отклонен", "ошибка", "неуспешно", "неуспешна",
  "возврат", "сторно", "отказ", "в обработке", "обработка", "ожидание",
  "ожидает", "не проведена", "не проведено", "заблокировано", "холд",
  // украинский
  "скасовано", "скасована", "відхилено", "відхилена", "помилка", "невдало",
  "в обробці", "очікує", "очікування", "заблоковано",
  // турецкий
  "iptal", "iptal edildi", "başarısız", "basarisiz", "reddedildi", "red",
  "beklemede", "bekliyor", "iade",
];

const REJECTED_SET = new Set(REJECTED);

/**
 * Длинные слова ищутся внутри строки — банки пишут «CANCELED BY USER» и
 * «Отменено клиентом». Короткие сравниваются целиком: «red» сидит внутри
 * «cleared», а «new» — внутри «renewal», и по вхождению они отбрасывали бы
 * нормальные операции.
 */
const PARTIAL = REJECTED.filter((word) => word.length >= 6);

/** Похоже ли значение на «операция не состоялась». */
export function looksRejected(value: string): boolean {
  const clean = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (clean === "") return false;
  if (REJECTED_SET.has(clean)) return true;

  return PARTIAL.some((word) => clean.includes(word));
}

/** Состояния, которые заведомо означают проведённую операцию. */
const ACCEPTED = new Set([
  "done", "completed", "complete", "success", "successful", "settled",
  "posted", "approved", "ok", "executed", "cleared", "confirmed",
  "выполнено", "выполнена", "успешно", "проведена", "проведено", "исполнено",
  "виконано", "успішно", "проведено",
  "tamamlandı", "tamamlandi", "başarılı", "basarili", "onaylandı", "onaylandi",
]);

export function looksAccepted(value: string): boolean {
  return ACCEPTED.has(value.trim().toLowerCase().replace(/\s+/g, " "));
}

/**
 * Состояния, означающие приход.
 *
 * Такая строка — не отказ и не трата: деньги пришли. Отличать её важно, чтобы
 * зачисление не попало в расходы и при этом осталось приходом — среди них
 * потом ищутся возвраты.
 */
const INCOMING = [
  "надходження", "зарахування", "зачислення", "поповнення",
  "поступление", "зачисление", "пополнение", "приход", "возврат",
  "deposit", "credit", "incoming", "refund", "payout", "top up", "topup",
  "gelen", "yatirma", "iade",
];

export function looksIncoming(value: string): boolean {
  const clean = value.trim().toLowerCase().replace(/[ ]+/g, " ");
  if (clean === "") return false;

  return INCOMING.some((word) => clean.includes(word));
}
