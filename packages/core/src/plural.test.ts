import { describe, expect, it } from "vitest";
import { plural } from "./plural.js";

describe("склонение числа", () => {
  const trats = (n: number) => plural(n, "трата", "траты", "трат");

  it("одна, несколько, много", () => {
    expect(trats(1)).toBe("1 трата");
    expect(trats(2)).toBe("2 траты");
    expect(trats(4)).toBe("4 траты");
    expect(trats(5)).toBe("5 трат");
    expect(trats(0)).toBe("0 трат");
  });

  it("десятые и сотни", () => {
    expect(trats(11)).toBe("11 трат");
    expect(trats(14)).toBe("14 трат");
    expect(trats(21)).toBe("21 трата");
    expect(trats(112)).toBe("112 трат");
    expect(trats(122)).toBe("122 траты");
  });
});
