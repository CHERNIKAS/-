import { describe, expect, it } from "vitest";
import { applyMapping, parseAmount, parseDate } from "./apply.js";
import type { Mapping } from "./detect.js";
import { readCsv } from "./read.js";

const TODAY = "2026-09-09";

describe("parseAmount", () => {
  it("запятая как дробный разделитель", () => {
    expect(parseAmount("1 234,56", ",")).toBe(1234.56);
  });

  it("точка как дробный разделитель, запятая как разряды", () => {
    expect(parseAmount("1,234.56", ".")).toBe(1234.56);
  });

  it("минус", () => {
    expect(parseAmount("-450,00", ",")).toBe(-450);
  });

  it("скобки означают расход", () => {
    expect(parseAmount("(450,00)", ",")).toBe(-450);
  });

  it("суффикс DR означает расход", () => {
    expect(parseAmount("450.00 DR", ".")).toBe(-450);
  });

  it("валютный символ рядом с суммой не мешает", () => {
    expect(parseAmount("₺1 500,00", ",")).toBe(1500);
  });

  it("пустая ячейка — не ноль, а отсутствие суммы", () => {
    expect(parseAmount("   ", ",")).toBeNull();
  });
});

describe("parseDate", () => {
  it("день-месяц-год", () => {
    expect(parseDate("03.09.2026", "dmy", TODAY)).toBe("2026-09-03");
  });

  it("месяц-день-год", () => {
    expect(parseDate("09/03/2026", "mdy", TODAY)).toBe("2026-09-03");
  });

  it("год-месяц-день", () => {
    expect(parseDate("2026-09-03", "ymd", TODAY)).toBe("2026-09-03");
  });

  it("двузначный год достраивается", () => {
    expect(parseDate("03.09.26", "dmy", TODAY)).toBe("2026-09-03");
  });

  it("дата из будущего отвергается — порядок частей определён неверно", () => {
    expect(parseDate("31.12.2027", "dmy", TODAY)).toBeNull();
  });

  it("не дата", () => {
    expect(parseDate("итого", "dmy", TODAY)).toBeNull();
  });
});

describe("readCsv", () => {
  it("определяет точку с запятой", () => {
    expect(readCsv("а;б;в")).toEqual([["а", "б", "в"]]);
  });

  it("не режет по запятой внутри кавычек", () => {
    expect(readCsv('дата;"магазин, у дома";100')).toEqual([
      ["дата", "магазин, у дома", "100"],
    ]);
  });
});

const MAPPING: Mapping = {
  skipRows: 1,
  dateColumn: 0,
  amountColumn: 1,
  descriptionColumn: 2,
  creditColumn: null,
  currencyColumn: null,
  statusColumn: null,
  okStatuses: [],
  dateOrder: "dmy",
  decimalSeparator: ",",
  expenseIsNegative: true,
  currency: "TRY",
  confidence: 0.9,
};

describe("applyMapping", () => {
  const sheet = [
    ["Дата", "Сумма", "Описание"],
    ["03.09.2026", "-1 500,00", "MIGROS"],
    ["04.09.2026", "-120,50", "STARBUCKS"],
    ["05.09.2026", "35 000,00", "ЗАРПЛАТА"],
    ["итого", "", ""],
  ];

  it("берёт только расходы", () => {
    const result = applyMapping(sheet, MAPPING, TODAY);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.amount)).toEqual([1500, 120.5]);
  });

  it("приход считается отдельно и в траты не идёт", () => {
    expect(applyMapping(sheet, MAPPING, TODAY).incomes).toBe(1);
  });

  it("неразобранные строки не теряются молча", () => {
    expect(applyMapping(sheet, MAPPING, TODAY).skipped).toBe(1);
  });

  it("суммы кладутся в плюс, знак остаётся смыслом строки", () => {
    expect(applyMapping(sheet, MAPPING, TODAY).rows[0]?.amount).toBeGreaterThan(0);
  });

  it("отпечаток одинаковый у одинаковых строк и разный у разных", () => {
    const result = applyMapping(sheet, MAPPING, TODAY);
    const again = applyMapping(sheet, MAPPING, TODAY);
    expect(result.rows[0]?.fingerprint).toBe(again.rows[0]?.fingerprint);
    expect(result.rows[0]?.fingerprint).not.toBe(result.rows[1]?.fingerprint);
  });

  it("валюта берётся из карты, если в файле её нет", () => {
    expect(applyMapping(sheet, MAPPING, TODAY).rows[0]?.currency).toBe("TRY");
  });

  it("отменённые операции не становятся тратами", () => {
    const withStatus = [
      ["Дата", "Сумма", "Описание", "Статус"],
      ["03.09.2026", "-1 500,00", "MIGROS", "DONE"],
      ["04.09.2026", "-120,50", "STARBUCKS", "CANCELED"],
      ["05.09.2026", "-80,00", "BIM", "PENDING"],
    ];

    const result = applyMapping(
      withStatus,
      { ...MAPPING, statusColumn: 3, okStatuses: ["DONE"] },
      TODAY,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.description).toBe("MIGROS");
    expect(result.cancelled).toBe(2);
  });

  it("без колонки статуса ничего не отбрасывается", () => {
    expect(applyMapping(sheet, MAPPING, TODAY).cancelled).toBe(0);
  });

  it("приход в отдельной колонке не попадает в траты", () => {
    const withCredit = [
      ["Дата", "Расход", "Описание", "Приход"],
      ["03.09.2026", "1 500,00", "MIGROS", ""],
      ["04.09.2026", "", "ЗАРПЛАТА", "35 000,00"],
    ];

    const result = applyMapping(
      withCredit,
      { ...MAPPING, creditColumn: 3, expenseIsNegative: false },
      TODAY,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.description).toBe("MIGROS");
  });
});
