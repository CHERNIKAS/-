import { describe, expect, it, vi } from "vitest";
import { ClassifyError, type ClassifyInput, parseResponse } from "./ai/classify.js";
import { categorize } from "./categorize.js";
import { findRule, normalizePattern } from "./rules.js";

const CATEGORIES = [
  { slug: "shop", title: "Магазин" },
  { slug: "cafe", title: "Кафе" },
  { slug: "other", title: "Прочее" },
];

function input(merchant: string): ClassifyInput {
  return { raw: `${merchant} 15`, merchant, amount: 15, currency: "TRY", categories: CATEGORIES };
}

describe("normalizePattern", () => {
  it("не различает регистр, пробелы и хвостовую пунктуацию", () => {
    expect(normalizePattern("  Migros!  ")).toBe("migros");
    expect(normalizePattern("КОРМ   коту")).toBe("корм коту");
  });
});

describe("findRule", () => {
  const rules = [
    { pattern: "migros", categoryId: 1 },
    { pattern: "корм коту", categoryId: 2 },
  ];

  it("находит точное совпадение", () => {
    expect(findRule("Migros", rules)?.categoryId).toBe(1);
  });

  it("находит правило внутри длинного названия", () => {
    expect(findRule("migros на углу", rules)?.categoryId).toBe(1);
  });

  it("не срабатывает на части слова", () => {
    expect(findRule("migroskop", rules)).toBeNull();
  });

  it("из двух подходящих выбирает более конкретное", () => {
    const both = [
      { pattern: "корм", categoryId: 9 },
      { pattern: "корм коту", categoryId: 2 },
    ];
    expect(findRule("корм коту", both)?.categoryId).toBe(2);
  });

  it("пустое название не матчится ни с чем", () => {
    expect(findRule("   ", rules)).toBeNull();
  });
});

describe("categorize", () => {
  it("правило отвечает мгновенно и модель не вызывается", async () => {
    const classify = vi.fn();
    const d = await categorize(input("migros"), {
      rules: [{ pattern: "migros", categoryId: 1, slug: "shop" }],
      classify,
    });

    expect(d.source).toBe("rule");
    expect(d.slug).toBe("shop");
    expect(d.ask).toBe(false);
    expect(classify).not.toHaveBeenCalled();
  });

  it("незнакомая строка уходит в модель", async () => {
    const d = await categorize(input("kirtasiye"), {
      rules: [],
      classify: async () => ({ slug: "shop", confidence: 0.9, merchant: "канцелярский" }),
    });

    expect(d.source).toBe("model");
    expect(d.slug).toBe("shop");
    expect(d.ask).toBe(false);
    expect(d.merchant).toBe("канцелярский");
  });

  it("низкая уверенность заставляет переспросить кнопками", async () => {
    const d = await categorize(input("kirtasiye"), {
      rules: [],
      classify: async () => ({ slug: "other", confidence: 0.35, merchant: "" }),
    });

    expect(d.ask).toBe(true);
    expect(d.merchant).toBe("kirtasiye");
  });

  it("модель недоступна — трата не теряется, а помечается на доразбор", async () => {
    const d = await categorize(input("kirtasiye"), {
      rules: [],
      classify: async () => {
        throw new ClassifyError("сеть отвалилась");
      },
    });

    expect(d.source).toBe("fallback");
    expect(d.slug).toBe("other");
    expect(d.needsReview).toBe(true);
    expect(d.ask).toBe(false);
  });
});

describe("parseResponse", () => {
  const wrap = (obj: unknown) => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
  });

  it("разбирает нормальный ответ", () => {
    const r = parseResponse(wrap({ category: "cafe", confidence: 0.8, merchant: "кофе" }), [
      "cafe",
      "shop",
    ]);
    expect(r).toEqual({ slug: "cafe", confidence: 0.8, merchant: "кофе" });
  });

  it("отвергает категорию вне списка", () => {
    expect(() =>
      parseResponse(wrap({ category: "выдуманная", confidence: 1, merchant: "" }), ["cafe"]),
    ).toThrow(ClassifyError);
  });

  it("зажимает уверенность в 0..1", () => {
    expect(parseResponse(wrap({ category: "cafe", confidence: 7, merchant: "" }), ["cafe"]).confidence).toBe(1);
  });

  it("падает понятной ошибкой на пустом ответе", () => {
    expect(() => parseResponse({}, ["cafe"])).toThrow(ClassifyError);
  });
});
