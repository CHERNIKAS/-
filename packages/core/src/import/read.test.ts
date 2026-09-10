import { describe, expect, it } from "vitest";
import { splitPdfLine } from "./read.js";

/**
 * Строка карточной выписки: несколько сумм подряд, номер карты, название и
 * вид операции. Раньше такая строка не разбиралась вовсе — бот отвечал, что
 * расходов в файле нет.
 */
describe("строка банковского PDF", () => {
  const line =
    "2026-01-05 23:15:38 108.00 TRY 2026-01-06 107.35 UAH 0.00 UAH 53552800****6147 SEC MARKET GUVENOGLU ANTALYA TRTR Покупка";

  it("колонки встают на свои места", () => {
    const cells = splitPdfLine(line);

    expect(cells[0]).toBe("2026-01-05");
    expect(cells[1]).toBe("23:15:38");
    expect(cells[2]).toBe("108.00");
    expect(cells[3]).toBe("TRY");
    expect(cells[4]).toBe("107.35");
    expect(cells[5]).toBe("UAH");
    expect(cells[9]).toContain("SEC MARKET GUVENOGLU");
    expect(cells[10]).toBe("Покупка");
  });

  it("секунды не приклеиваются к сумме", () => {
    // «23:15:38 108.00» когда-то читалось как одно число 38 108,00.
    expect(splitPdfLine(line)[2]).not.toContain("38");
  });

  it("простая строка разбирается по-прежнему", () => {
    const cells = splitPdfLine("2026.06.01, 20:05 MIGROS-154203,ISTANBUL,TUR -5.39 USDC");

    expect(cells[0]).toBe("2026.06.01");
    expect(cells[2]).toBe("MIGROS-154203,ISTANBUL,TUR");
    expect(cells[3]).toBe("-5.39");
    expect(cells[4]).toBe("USDC");
  });
});
