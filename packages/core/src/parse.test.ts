import { describe, expect, it } from "vitest";
import { parseEntry, parseMessage, splitEntries } from "./parse.js";

describe("splitEntries", () => {
  it("режет по переносу строки и выкидывает пустые", () => {
    expect(splitEntries("магаз 15\n\nкофе 4")).toEqual(["магаз 15", "кофе 4"]);
  });

  it("режет по запятой", () => {
    expect(splitEntries("магаз 15, кофе 4")).toEqual(["магаз 15", "кофе 4"]);
  });

  it("не режет по точке внутри числа, но режет по точке между тратами", () => {
    expect(splitEntries("кофе 4.50. такси 12")).toEqual(["кофе 4.50", "такси 12"]);
  });

  it("не режет по запятой внутри числа", () => {
    expect(splitEntries("кофе 4,50")).toEqual(["кофе 4,50"]);
  });

  it("выкидывает хвостовые разделители", () => {
    expect(splitEntries("магаз 15,,,")).toEqual(["магаз 15"]);
  });
});

describe("parseEntry", () => {
  it("магаз 15 лир", () => {
    const r = parseEntry("магаз 15 лир");
    expect(r.amount).toBe(15);
    expect(r.currency).toBe("TRY");
    expect(r.merchant).toBe("магаз");
    expect(r.ok).toBe(true);
  });

  it("клод 20 баксов", () => {
    const r = parseEntry("клод 20 баксов");
    expect(r.amount).toBe(20);
    expect(r.currency).toBe("USD");
    expect(r.merchant).toBe("клод");
  });

  it("сервер 18 $ — символ отдельно", () => {
    const r = parseEntry("сервер 18 $");
    expect(r.amount).toBe(18);
    expect(r.currency).toBe("USD");
    expect(r.merchant).toBe("сервер");
  });

  it("$20 такси — символ вплотную и число первым", () => {
    const r = parseEntry("$20 такси");
    expect(r.amount).toBe(20);
    expect(r.currency).toBe("USD");
    expect(r.merchant).toBe("такси");
  });

  it("корм коту 1000 лир — многословное название", () => {
    const r = parseEntry("корм коту 1000 лир");
    expect(r.amount).toBe(1000);
    expect(r.currency).toBe("TRY");
    expect(r.merchant).toBe("корм коту");
  });

  it("кофе 4.50 — дробная сумма через точку", () => {
    expect(parseEntry("кофе 4.50").amount).toBe(4.5);
  });

  it("кофе 4,50 — дробная сумма через запятую", () => {
    expect(parseEntry("кофе 4,50").amount).toBe(4.5);
  });

  it("аренда 1 000 евро — пробел как разделитель тысяч", () => {
    const r = parseEntry("аренда 1 000 евро");
    expect(r.amount).toBe(1000);
    expect(r.currency).toBe("EUR");
    expect(r.merchant).toBe("аренда");
  });

  it("такси 180 вчера — дата словом", () => {
    const r = parseEntry("такси 180 вчера");
    expect(r.daysAgo).toBe(1);
    expect(r.amount).toBe(180);
    expect(r.merchant).toBe("такси");
  });

  it("без валюты оставляет null — подставится валюта по умолчанию", () => {
    expect(parseEntry("migros 24").currency).toBeNull();
  });

  it("строка без суммы не создаёт трату", () => {
    const r = parseEntry("привет как дела");
    expect(r.ok).toBe(false);
    expect(r.amount).toBeNull();
  });

it("плюс впереди делает строку доходом", () => {
    const r = parseEntry("+60000 лир");
    expect(r.kind).toBe("income");
    expect(r.amount).toBe(60000);
    expect(r.currency).toBe("TRY");
  });

  it("зарплата узнаётся по слову, без плюса", () => {
    const r = parseEntry("зарплата 2500");
    expect(r.kind).toBe("income");
    expect(r.incomeSource).toBe("Поступления");
  });

  it("возврат — не доход, а отмена покупки", () => {
    const r = parseEntry("возврат 15 лир");
    expect(r.isRefund).toBe(true);
    expect(r.incomeSource).toBe("Возврат");
  });

  it("обычная трата остаётся расходом", () => {
    const r = parseEntry("магаз 15 лир");
    expect(r.kind).toBe("expense");
    expect(r.incomeSource).toBeNull();
  });

  it("не путает валюту с началом слова", () => {
    const r = parseEntry("евроремонт 500");
    expect(r.currency).toBeNull();
    expect(r.merchant).toBe("евроремонт");
  });

  it("сырой текст сохраняется всегда", () => {
    expect(parseEntry("  магаз 15 лир  ").raw).toBe("магаз 15 лир");
  });
});

describe("parseMessage", () => {
  it("несколько трат одним сообщением", () => {
    const r = parseMessage("магаз 15 лир\nкофе 4.50\nтакси 12");
    expect(r).toHaveLength(3);
    expect(r.map((e) => e.amount)).toEqual([15, 4.5, 12]);
  });

  it("фрагмент без суммы не теряется, но помечен как неразобранный", () => {
    const r = parseMessage("магаз 15, ааа");
    expect(r).toHaveLength(2);
    expect(r[1]?.ok).toBe(false);
    expect(r[1]?.raw).toBe("ааа");
  });
});
