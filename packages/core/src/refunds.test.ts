import { describe, expect, it } from "vitest";
import { looksLikeTransfer, sameMerchant } from "./refunds.js";

/**
 * Сверка возврата с покупкой — то место, где ошибка не падает, а тихо врёт в
 * итогах. Оба случая ниже случились на настоящей выписке.
 */
describe("сверка возврата", () => {
  it("пополнение карты не возврат", () => {
    expect(looksLikeTransfer("Card top up")).toBe(true);
    expect(looksLikeTransfer("Пополнение счёта")).toBe(true);
    expect(looksLikeTransfer("SWAP USDT/USDC")).toBe(true);
  });

  it("покупка в магазине не перевод", () => {
    expect(looksLikeTransfer("MIGROS-154203-ALANYA KEY,ISTANBUL,TUR")).toBe(false);
  });

  it("один магазин узнаётся под разными номерами точек", () => {
    expect(
      sameMerchant("MIGROS-154203-ALANYA KEY,ISTANBUL,TUR", "MIGROS-9902-ALANYA,ANTALYA,TUR"),
    ).toBe(true);
  });

  it("общий город не делает магазины одинаковыми", () => {
    expect(
      sameMerchant("MIGROS-154203-ALANYA KEY,ISTANBUL,TUR", "TRENDYOL.COM,ISTANBUL,TUR"),
    ).toBe(false);
  });

  it("слова-пустышки не роднят разные места", () => {
    expect(sameMerchant("Su Market,ANTALYA,TUR", "Best Market,ANTALYA,TUR")).toBe(false);
  });
});
