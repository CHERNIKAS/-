/**
 * Число со словом в нужной форме: «1 трата», «3 траты», «5 трат», «11 трат».
 *
 * Без этого бот и приложение писали «1 трат» и «4 операций».
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  const word = n > 10 && n < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${count} ${word}`;
}
