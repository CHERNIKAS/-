import { describe, expect, it } from "vitest";
import { classifyOperation, isSwap, isReward } from "./kinds.js";

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
