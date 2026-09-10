import { describe, expect, it } from "vitest";
import { fetchWithRetry, isRetriable } from "./retry.js";

/**
 * 503 от модели — обычное состояние бесплатного доступа, а не поломка. Одна
 * такая секунда роняла импорт выписки на тысячу строк.
 */
describe("повтор запроса к модели", () => {
  const nap = async () => undefined;

  it("перегрузка и предел частоты — повод попробовать ещё раз", () => {
    expect(isRetriable(503)).toBe(true);
    expect(isRetriable(429)).toBe(true);
    expect(isRetriable(400)).toBe(false);
    expect(isRetriable(403)).toBe(false);
  });

  it("после отказа приходит удачный ответ", async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      return new Response("{}", { status: calls === 1 ? 503 : 200 });
    };

    const response = await fetchWithRetry(fake as never, "u", {}, { sleep: nap });

    expect(calls).toBe(2);
    expect(response.status).toBe(200);
  });

  it("отказ в правах не повторяется: смысла нет", async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      return new Response("{}", { status: 403 });
    };

    await fetchWithRetry(fake as never, "u", {}, { sleep: nap });
    expect(calls).toBe(1);
  });

  it("обрыв связи тоже повод повторить", async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      if (calls < 3) throw new Error("сеть отвалилась");
      return new Response("{}", { status: 200 });
    };

    const response = await fetchWithRetry(fake as never, "u", {}, { sleep: nap });
    expect(calls).toBe(3);
    expect(response.status).toBe(200);
  });
});
