import { describe, expect, it } from "vitest";
import { applyMapping } from "./apply.js";
import { classifyOperation, isReward, isSwap, sheetKind } from "./kinds.js";

/**
 * Граница системы: доход и расход — это вход и выход денег, всё остальное
 * перекладывание. Ошибка здесь не падает, а тихо врёт в отчётах.
 */
describe("вид операции", () => {
  it("обмен внутри счёта не движение денег", () => {
    expect(isSwap("SWAP")).toBe(true);
    expect(isSwap("Обмен валюты")).toBe(true);
    expect(isSwap("Покупка")).toBe(false);
  });

  it("пополнение и вывод — переводы, а не траты", () => {
    expect(classifyOperation("WITHDRAW", false)).toBe("transfer");
    expect(classifyOperation("DEPOSIT", true)).toBe("transfer");
    expect(classifyOperation("Card top up", true)).toBe("transfer");
    expect(classifyOperation("Надходження", true)).toBe("transfer");
  });

  it("покупка остаётся тратой", () => {
    expect(classifyOperation("Покупка", false)).toBe("expense");
  });

  it("приход без понятного вида считается доходом", () => {
    expect(classifyOperation("", true)).toBe("income");
  });

  it("бонусы и рефералка — доход", () => {
    expect(isReward("REFERRAL_REWARD")).toBe(true);
    expect(classifyOperation("BONUS", true)).toBe("income");
  });
});

describe("вид по листу книги", () => {
  it("лист доходов — доход, переводов — перенос, расходов — трата", () => {
    expect(sheetKind("Доходы")).toBe("income");
    expect(sheetKind("Переводы")).toBe("transfer");
    expect(sheetKind("Расходы")).toBe("expense");
    expect(sheetKind("Income")).toBe("income");
  });

  it("безымянный лист ничего не решает", () => {
    expect(sheetKind("Лист1")).toBeNull();
    expect(sheetKind("")).toBeNull();
  });

  it("доход с листа доходов не угадывается по знаку", () => {
    const sheet = [
      ["Список доходов"],
      ["Дата", "Категория", "Сумма"],
      ["9/4/26", "Зарплата", "285.00"],
    ];
    const mapping = {
      skipRows: 2, dateColumn: 0, amountColumn: 2, descriptionColumn: 1, creditColumn: null,
      currencyColumn: null, statusColumn: null, typeColumn: null, counterpartyColumn: null,
      okStatuses: [], dateOrder: "mdy" as const, decimalSeparator: "." as const,
      expenseIsNegative: false, currency: "EUR" as const, confidence: 1,
    };

    const [row] = applyMapping(sheet, mapping, "2026-09-14", "income").rows;
    expect(row?.kind).toBe("income");
    expect(row?.incoming).toBe(true);
    expect(row?.certain).toBe(true);
  });
});
