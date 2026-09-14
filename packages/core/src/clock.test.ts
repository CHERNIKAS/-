import { describe, expect, it } from "vitest";
import { localToday } from "./data/clock.js";

/**
 * Полночь по Стамбулу — ещё вчерашний вечер по UTC. Раньше ночная трата так и
 * записывалась вчерашней, а с ней съезжали итог дня и вечерний вопрос.
 */
describe("сегодня по поясу человека", () => {
  it("час ночи в Стамбуле — уже новый день, хотя в UTC ещё старый", () => {
    const now = new Date("2026-09-11T22:30:00Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(localToday("Europe/Istanbul", now)).toBe("2026-09-12");
  });

  it("днём пояс не меняет даты", () => {
    expect(localToday("Europe/Istanbul", new Date("2026-09-12T12:00:00Z"))).toBe("2026-09-12");
  });

  it("испорченный пояс не роняет запись — берётся дата сервера", () => {
    expect(localToday("Нигде/Никогда", new Date("2026-09-12T12:00:00Z"))).toBe("2026-09-12");
  });
});
