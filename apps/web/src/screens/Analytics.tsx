import { PALETTE, PERIOD_KEYS, PERIOD_TITLE, donutSvg, type PeriodKey } from "@costnote/core";
import { useEffect, useState } from "react";
import { type Analytics as Data, api } from "../api.js";
import { money, moneyExact } from "../format.js";
import { tap } from "../telegram.js";

/**
 * Аналитика.
 *
 * Кольцо рисует та же функция, что готовит картинку для бота: одна реализация
 * диаграммы на обе поверхности, поэтому они не разъезжаются.
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

  const segments =
    data?.categories.map((c, i) => ({
      label: c.title,
      value: c.total,
      color: PALETTE[i % PALETTE.length] as string,
    })) ?? [];

  return (
    <>
      <div className="chips" style={{ marginBottom: 16 }}>
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

      {data !== null && (
        <>
          {segments.length === 0 ? (
            <div className="glass" style={{ padding: 24, textAlign: "center" }}>
              <p className="muted">За этот период трат нет</p>
            </div>
          ) : (
            <div
              className="glass"
              style={{ padding: 8, overflow: "hidden" }}
              // Разметка приходит из общего пакета и собирается здесь же на
              // клиенте, без сети и без внешних данных.
              dangerouslySetInnerHTML={{
                __html: donutSvg(segments, {
                  total: money(data.total, data.currency),
                  caption: data.period.label,
                  legendRows: Math.min(segments.length, 6),
                  size: 520,
                }),
              }}
            />
          )}

          <div className="glass list" style={{ padding: "4px 14px", marginTop: 14 }}>
            {data.categories.map((c, i) => (
              <div key={c.slug} className="item">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: PALETTE[i % PALETTE.length],
                  }}
                />
                <span style={{ flex: 1 }}>
                  {c.emoji} {c.title}
                </span>
                <span className="num">{money(c.total, data.currency)}</span>
              </div>
            ))}
          </div>

          {data.byCurrency.length > 1 && (
            <>
              <p className="dim" style={{ margin: "18px 2px 8px" }}>
                Как вносил
              </p>
              <div className="glass list" style={{ padding: "4px 14px" }}>
                {data.byCurrency.map((c) => (
                  <div key={c.currency} className="item">
                    <span className="num" style={{ flex: 1 }}>
                      {moneyExact(c.amount, c.currency)}
                    </span>
                    <span className="dim num">≈ {money(c.base, currency)}</span>
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
