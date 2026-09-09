import { PALETTE, PERIOD_KEYS, PERIOD_TITLE, donutSvg, type PeriodKey } from "@costnote/core";
import { useEffect, useState } from "react";
import { type Analytics as Data, api } from "../api.js";
import { money, moneyExact } from "../format.js";
import { CategoryIcon } from "../icons.js";
import { tint } from "../palette.js";
import { tap } from "../telegram.js";

/**
 * Разбор трат.
 *
 * Кольцо рисует та же функция, что готовит картинку для бота, но без подложки
 * и без легенды: подложка дала бы коробку внутри коробки, а легенду заменяет
 * список под кольцом — там и суммы, и доли.
 */
export function Analytics({ currency }: { currency: string }) {
  const [period, setPeriod] = useState<PeriodKey>("d30");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);

    api
      .analytics(period)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не загрузилось");
      });

    return () => {
      alive = false;
    };
  }, [period]);

  const categories = data?.categories ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="chips" style={{ padding: "10px 0 22px" }}>
        {PERIOD_KEYS.map((key) => (
          <button
            key={key}
            className={key === period ? "pill on" : "pill ghost"}
            onClick={() => {
              tap();
              setPeriod(key);
            }}
          >
            {PERIOD_TITLE[key]}
          </button>
        ))}
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
            style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}
            dangerouslySetInnerHTML={{
              __html: donutSvg(
                categories.map((c, i) => ({
                  label: c.title,
                  value: c.total,
                  color: PALETTE[i % PALETTE.length] as string,
                })),
                {
                  total: money(total, data.currency),
                  caption: data.period.label,
                  legendRows: 0,
                  background: "none",
                  size: 300,
                },
              ),
            }}
          />

          <p className="label" style={{ margin: "0 2px 10px" }}>
            По категориям
          </p>

          <div className="card rows" style={{ padding: "2px 16px" }}>
            {categories.map((c, i) => {
              const color = PALETTE[i % PALETTE.length] as string;
              const share = total === 0 ? 0 : c.total / total;

              return (
                <div key={c.slug} className="item">
                  <span
                    className="tile"
                    style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                  >
                    <CategoryIcon slug={c.slug} />
                  </span>
                  <span className="grow">
                    <span className="title">{c.title}</span>
                    <span className="bar" style={{ marginTop: 7 }}>
                      <i style={{ width: `${Math.round(share * 100)}%`, background: color }} />
                    </span>
                  </span>
                  <span className="amount">
                    {money(c.total, data.currency)}
                    <span className="sub" style={{ display: "block" }}>
                      {Math.round(share * 100)}%
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          {data.byCurrency.length > 1 && (
            <>
              <p className="label" style={{ margin: "22px 2px 10px" }}>
                Как вносил
              </p>
              <div className="card rows" style={{ padding: "2px 16px" }}>
                {data.byCurrency.map((c) => (
                  <div key={c.currency} className="item">
                    <span className="grow title num">{moneyExact(c.amount, c.currency)}</span>
                    <span className="amount dim">≈ {money(c.base, currency)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
