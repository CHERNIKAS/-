import { PALETTE, donutSvg } from "@costnote/core";
import { useEffect, useState } from "react";
import { type Analytics as Data, api } from "../api.js";
import { money, moneyExact } from "../format.js";
import { CategoryIcon } from "../icons.js";
import { tap } from "../telegram.js";
import { tint } from "../palette.js";

const CURRENCY_NAME: Record<string, string> = {
  USD: "Доллар",
  EUR: "Евро",
  UAH: "Гривна",
  TRY: "Лира",
};

const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€", UAH: "₴", TRY: "₺" };
import { PeriodPicker } from "../PeriodPicker.js";
import { type Range, rangeFor, rangeTitle } from "../periods.js";

/**
 * Разбор трат.
 *
 * Кольцо рисует та же функция, что готовит картинку для бота, но без подложки
 * и без легенды: подложка дала бы коробку внутри коробки, а легенду заменяет
 * список под кольцом — там и суммы, и доли.
 */
export function Analytics({
  currency,
  today,
  onCategory,
}: {
  currency: string;
  today: string;
  /** Нажатие по категории уводит в историю — с этой категорией и этим периодом. */
  onCategory: (slug: string, range: Range) => void;
}) {
  const [range, setRange] = useState<Range>(() => rangeFor("month", today));
  const [mode, setMode] = useState<"categories" | "currencies">("categories");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);

    api
      .analytics(range.key, range.from, range.to)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не загрузилось");
      });

    return () => {
      alive = false;
    };
  }, [range]);

  const categories = data?.categories ?? [];
  const total = data?.total ?? 0;
  const currencies = data?.byCurrency ?? [];

  // Кольцо одно и то же, меняется только то, по чему оно режет.
  const slices =
    mode === "categories"
      ? categories.map((c) => ({ label: c.title, value: c.total }))
      : currencies.map((c) => ({ label: c.currency, value: c.base }));

  /**
   * Кольцо занимает место, которое осталось от списка.
   *
   * Две категории — под списком полэкрана пустоты, и маленькое кольцо посреди
   * неё выглядит забытым. Десять — наоборот, важен список, и кольцу хватает
   * скромного размера, чтобы всё влезло без прокрутки.
   */
  const donutSize = slices.length <= 3 ? 264 : slices.length <= 5 ? 232 : 200;

  return (
    <>
      <div style={{ padding: "12px 0 16px" }}>
        <PeriodPicker
          today={today}
          range={range}
          onChange={setRange}
          extra={
            currencies.length > 1 ? (
              <span className="seg">
                <button
                  className={mode === "categories" ? "on" : ""}
                  onClick={() => {
                    tap();
                    setMode("categories");
                  }}
                >
                  Категории
                </button>
                <button
                  className={mode === "currencies" ? "on" : ""}
                  onClick={() => {
                    tap();
                    setMode("currencies");
                  }}
                >
                  Валюты
                </button>
              </span>
            ) : undefined
          }
        />
      </div>

      {error !== null && <div className="err">{error}</div>}
      {data === null && error === null && <p className="spinner">Считаю…</p>}

      {data !== null && categories.length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <p className="muted">За этот период трат нет</p>
        </div>
      )}

      {data !== null && categories.length > 0 && (
        <>
          <div
            style={{ display: "flex", justifyContent: "center", margin: "6px 0 14px" }}
            dangerouslySetInnerHTML={{
              __html: donutSvg(
                slices.map((s, i) => ({
                  label: s.label,
                  value: s.value,
                  color: PALETTE[i % PALETTE.length] as string,
                })),
                {
                  total: money(total, data.currency),
                  caption: rangeTitle(range),
                  legendRows: 0,
                  background: "none",
                  size: donutSize,
                },
              ),
            }}
          />

          {/* Доход за тот же период — строкой над разбивкой. В кольцо он не
              идёт: кольцо показывает, куда ушли деньги, а не откуда пришли. */}
          {data.income > 0 && (
            <div className="between" style={{ padding: "0 2px 12px" }}>
              <span className="dim">Доход за период</span>
              <b className="num" style={{ color: "var(--mint)" }}>
                +{money(data.income, data.currency)}
              </b>
            </div>
          )}

          <p className="label" style={{ margin: "0 2px 10px" }}>
            {mode === "categories" ? "По категориям" : "В каких валютах"}
          </p>

          <div className="card rows" style={{ padding: "2px 16px" }}>
            {mode === "categories"
              ? categories.map((c, i) => {
                  const color = PALETTE[i % PALETTE.length] as string;
                  const share = total === 0 ? 0 : c.total / total;

                  return (
                    <button
                      key={c.slug}
                      className="item dense"
                      onClick={() => {
                        tap();
                        onCategory(c.slug, range);
                      }}
                    >
                      <span
                        className="tile"
                        style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                      >
                        <CategoryIcon slug={c.slug} title={c.title} />
                      </span>
                      <span className="grow title" style={{ textAlign: "left" }}>
                        {c.title}
                      </span>
                      <span className="amount">
                        {money(c.total, data.currency)}
                        <span className="sub">{Math.round(share * 100)}%</span>
                      </span>
                    </button>
                  );
                })
              : currencies.map((c, i) => {
                  const color = PALETTE[i % PALETTE.length] as string;
                  const share = total === 0 ? 0 : c.base / total;

                  return (
                    <div key={c.currency} className="item dense">
                      <span
                        className="tile"
                        style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                      >
                        {CURRENCY_SIGN[c.currency] ?? c.currency}
                      </span>
                      <span className="grow title">{CURRENCY_NAME[c.currency] ?? c.currency}</span>
                      <span className="amount">
                        {moneyExact(c.amount, c.currency)}
                        <span className="sub">
                          {c.currency === data.currency
                            ? `${Math.round(share * 100)}%`
                            : `≈ ${money(c.base, data.currency)} · ${Math.round(share * 100)}%`}
                        </span>
                      </span>
                    </div>
                  );
                })}
          </div>
        </>
      )}
    </>
  );
}
