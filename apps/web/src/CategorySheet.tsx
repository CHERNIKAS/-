import { useMemo, useState } from "react";
import { api, type Category } from "./api.js";
import { CategoryIcon, IconSearch } from "./icons.js";
import { categoryColor, tint } from "./palette.js";
import { notify, tap } from "./telegram.js";

/**
 * Выбор категории.
 *
 * Поиск сверху, создание первой строкой, если совпадений нет. Перед созданием
 * — предупреждение о похожей: без него список за пару месяцев зарастает
 * «Кафе», «Кофейни» и «Обедом», и разрез перестаёт что-либо показывать.
 */
export function CategorySheet({
  categories,
  current,
  onPick,
  onClose,
}: {
  categories: Category[];
  current: string | null;
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const needle = query.trim().toLowerCase();
  const found = useMemo(
    () => categories.filter((c) => c.title.toLowerCase().includes(needle)),
    [categories, needle],
  );

  const similar = useMemo(
    () => (needle.length < 3 ? null : categories.find((c) => isSimilar(c.title.toLowerCase(), needle))),
    [categories, needle],
  );

  const canCreate = needle !== "" && !categories.some((c) => c.title.toLowerCase() === needle);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const title = query.trim();
      const result = await api.createCategory(title.charAt(0).toUpperCase() + title.slice(1), "🏷");
      if (result.category) onPick(result.category.slug);
    } catch {
      notify("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />

        <button
          className="pill ghost"
          style={{ marginBottom: 12 }}
          onClick={() => {
            tap();
            onClose();
          }}
        >
          ← Назад
        </button>

        <div style={{ position: "relative", marginBottom: 14 }}>
          <span style={{ position: "absolute", left: 15, top: 17, color: "var(--ink-3)" }}>
            <IconSearch />
          </span>
          <input
            className="field"
            style={{ paddingLeft: 42 }}
            placeholder="Найти или создать"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {canCreate && (
          <>
            <button
              className="item"
              style={{ padding: "12px 0" }}
              onClick={() => {
                tap();
                void create();
              }}
            >
              <span className="tile" style={{ background: "var(--mint)", color: "#10233a" }}>
                +
              </span>
              <span className="grow title">Создать «{query.trim()}»</span>
            </button>

            {similar !== undefined && similar !== null && (
              <p className="dim" style={{ margin: "0 2px 12px" }}>
                Похоже на «{similar.title}» — может, туда?
              </p>
            )}
          </>
        )}

        <div className="card rows" style={{ padding: "2px 16px" }}>
          {found.length === 0 && !canCreate && (
            <p className="muted" style={{ padding: "18px 0" }}>
              Ничего не нашлось
            </p>
          )}

          {found.map((c) => {
            const color = categoryColor(c.slug, categories);
            return (
              <button
                key={c.slug}
                className="item"
                onClick={() => {
                  tap();
                  onPick(c.slug);
                }}
              >
                <span
                  className="tile"
                  style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                >
                  <CategoryIcon slug={c.slug} />
                </span>
                <span className="grow title">{c.title}</span>
                {c.slug === current && <span className="pill on">выбрано</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Грубая проверка на похожесть: общий корень или почти совпадающие строки.
 * Точности здесь и не нужно — решение всё равно принимает человек.
 */
function isSimilar(title: string, query: string): boolean {
  if (title === query) return false;
  const root = query.slice(0, Math.max(4, Math.floor(query.length * 0.6)));
  return title.startsWith(root) || query.startsWith(title.slice(0, 4));
}
