import { describe, expect, it } from "vitest";
import { parseAmount, parseDate } from "./import/apply.js";
import { daysInMonth, isRealDate, parseEntry, parseMessage, resolveSpentAt } from "./parse.js";
import { buildPeriod } from "./periods.js";
import { hasMerchantWords } from "./refunds.js";

/**
 * Найденные при разборе проекта ошибки.
 *
 * Каждый случай здесь однажды давал неверную сумму, дату или ронял сохранение.
 */

const TODAY = "2026-09-14";

describe("сумма в строке", () => {
  it("число в названии не становится суммой: «айфон 15 1000$»", () => {
    const r = parseEntry("айфон 15 1000$");
    expect(r.amount).toBe(1000);
    expect(r.currency).toBe("USD");
  });

  it("количество не становится суммой: «бургер 2 шт 300 лир»", () => {
    const r = parseEntry("бургер 2 шт 300 лир");
    expect(r.amount).toBe(300);
    expect(r.currency).toBe("TRY");
  });

  it("без валюты берётся последнее число", () => {
    expect(parseEntry("такси 12 декабристов 5").amount).toBe(5);
  });

  it("сумма рядом с валютой главнее последней", () => {
    expect(parseEntry("5$ кофе 2 шт").amount).toBe(5);
  });

  it("запятая и точка как разделитель тысяч", () => {
    expect(parseEntry("1,000 лир аренда").amount).toBe(1000);
    expect(parseEntry("аренда 1.000 евро").amount).toBe(1000);
    expect(parseEntry("iphone 1 000 000 грн").amount).toBe(1_000_000);
  });

  it("десятичные по-прежнему десятичные", () => {
    expect(parseEntry("кофе 4.50").amount).toBe(4.5);
    expect(parseEntry("кофе 4,50").amount).toBe(4.5);
    expect(parseEntry("подписка 9.99$").amount).toBe(9.99);
    expect(parseEntry("аренда 1 000,50 грн").amount).toBe(1000.5);
  });

  it("хвосты от вырезанного не остаются в названии", () => {
    expect(parseEntry("кафе -15").merchant).toBe("кафе");
    expect(parseEntry("кафе: 15").merchant).toBe("кафе");
  });

  it("диапазон через дефис — не дата", () => {
    const r = parseEntry("такси 12-15 лир");
    expect(r.dateHint).toBeNull();
    expect(r.amount).toBe(15);
  });
});

describe("даты в строке", () => {
  it("несуществующая дата не доходит до базы", () => {
    const r = parseEntry("31/02 такси 10");
    expect(r.dateHint).toBeNull();
    expect(r.amount).toBe(10);
    expect(resolveSpentAt(r, TODAY)).toBe(TODAY);
  });

  it("29 февраля в невисокосный год", () => {
    expect(parseEntry("обед 29.02.2025 15").dateHint).toBeNull();
    expect(resolveSpentAt(parseEntry("обед 29 февраля 15"), TODAY)).toBe("2026-02-28");
  });

  it("слово, похожее на месяц, — не месяц", () => {
    expect(parseEntry("такси 12 декабристов 5").dateHint).toBeNull();
    expect(parseEntry("кофе 5 мая 4").dateHint).toEqual({ day: 5, month: 5, year: null });
    expect(parseEntry("обед 1 сентября 20").dateHint).toEqual({ day: 1, month: 9, year: null });
  });

  it("isRealDate и daysInMonth", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2026-04-31")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("26-01-01")).toBe(false);
    expect(daysInMonth(2, 1900)).toBe(28);
    expect(daysInMonth(2, 2000)).toBe(29);
    expect(daysInMonth(2, null)).toBe(29);
  });
});

describe("возврат с названием", () => {
  it("названная покупка обязана совпасть", () => {
    expect(hasMerchantWords("долг")).toBe(true);
    expect(hasMerchantWords("amazon")).toBe(true);
  });

  it("без названия верим сумме", () => {
    expect(hasMerchantWords("")).toBe(false);
    expect(hasMerchantWords("за")).toBe(false);
    expect(hasMerchantWords("магазин")).toBe(false);
  });
});

describe("суммы и даты из выписок", () => {
  it("типографский минус и минус в конце", () => {
    expect(parseAmount("−15.00", ".")).toBe(-15);
    expect(parseAmount("–1 234,50", ",")).toBe(-1234.5);
    expect(parseAmount("12.50-", ".")).toBe(-12.5);
    expect(parseAmount("(12.50)", ".")).toBe(-12.5);
  });

  it("мусор не превращается в число", () => {
    expect(parseAmount("1.2.3", ".")).toBeNull();
    expect(parseAmount("abc", ".")).toBeNull();
    expect(parseAmount("", ".")).toBeNull();
  });

  it("обычные суммы не сломались", () => {
    expect(parseAmount("1,234.56", ".")).toBe(1234.56);
    expect(parseAmount("1.234,56", ",")).toBe(1234.56);
    expect(parseAmount("$1,000", ".")).toBe(1000);
  });

  it("несуществующая дата пропускает строку, а не роняет импорт", () => {
    expect(parseDate("31.02.2026", "dmy", TODAY)).toBeNull();
    expect(parseDate("2026-02-30", "ymd", TODAY)).toBeNull();
    expect(parseDate("29.02.2024", "dmy", TODAY)).toBe("2024-02-29");
    expect(parseDate("14.09.26", "dmy", TODAY)).toBe("2026-09-14");
  });
});

describe("периоды", () => {
  it("неделя с понедельника, в том числе в воскресенье", () => {
    expect(buildPeriod("week", "2026-09-13")).toMatchObject({ from: "2026-09-07", to: "2026-09-13" });
    expect(buildPeriod("week", "2026-09-14")).toMatchObject({ from: "2026-09-14", to: "2026-09-14" });
  });

  it("день, месяц, год", () => {
    expect(buildPeriod("day", TODAY)).toMatchObject({ from: TODAY, to: TODAY });
    expect(buildPeriod("month", TODAY)).toMatchObject({ from: "2026-09-01", to: TODAY });
    expect(buildPeriod("year", TODAY)).toMatchObject({ from: "2026-01-01", to: TODAY });
  });
});

const DAY17 = "2026-09-17";

describe("дата отдельным куском сообщения", () => {
  it("«бумажки 100 лир, 15.09» — одна трата за 15 сентября", () => {
    const entries = parseMessage("бумажки для самокруток 100 лир, 15.09");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount).toBe(100);
    expect(entries[0]?.currency).toBe("TRY");
    expect(resolveSpentAt(entries[0]!, DAY17)).toBe("2026-09-15");
  });

  it("дата относится ко всем тратам сообщения без своей даты", () => {
    const entries = parseMessage("кофе 3$, такси 10$, 15.09");
    expect(entries.map((e) => resolveSpentAt(e, DAY17))).toEqual(["2026-09-15", "2026-09-15"]);
  });

  it("своя дата у траты главнее", () => {
    const entries = parseMessage("кофе 3$ вчера, такси 10$, 15.09");
    expect(resolveSpentAt(entries[0]!, DAY17)).toBe("2026-09-16");
    expect(resolveSpentAt(entries[1]!, DAY17)).toBe("2026-09-15");
  });

  it("одно число без трат — по-прежнему сумма", () => {
    expect(parseMessage("15.09")[0]?.amount).toBe(15.09);
    expect(parseMessage("кофе 4.50")[0]?.amount).toBe(4.5);
  });

  it("невозможная дата — это сумма", () => {
    expect(parseMessage("кофе 4$, 3.20")).toHaveLength(2);
  });
});
