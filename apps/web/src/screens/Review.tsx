import { useEffect, useState } from "react";
import { api, type ReviewGroup } from "../api.js";
import { dayTitle, money, moneyExact } from "../format.js";
import { notify, tap } from "../telegram.js";

/**
 * Разбор приходов и переводов.
 *
 * Выписка не знает, чьи это деньги: одна и та же тысяча с одного и того же
 * адреса бывает и заработком, и собственными деньгами с другого кошелька.
 * Ответ не запоминается за адресом намеренно — в следующий раз спросим заново.
 *
 * Списком, а не вопросами в чат: две сотни отдельных сообщений — это не разбор,
 * а наказание. Здесь всё видно разом, решения ставятся галочками и уходят одной
 * кнопкой.
 */
export function Review({
  currency,
  today,
  onDone,
}: {
  currency: string;
  today: string;
  onDone: () => void;
}) {
  const [groups, setGroups] = useState<ReviewGroup[] | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await api.review();
    setGroups(result.groups);

    // Предзаполняем тем, что определил разбор: чаще всего это и есть ответ,
    // а человеку остаётся поправить исключения.
    const start: Record<number, string> = {};
    for (const group of result.groups) {
      for (const item of group.items) start[item.id] = item.kind;
    }
    setChoice(start);
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Не загрузилось"));
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await api.saveReview(Object.entries(choice).map(([id, kind]) => ({ id: Number(id), kind })));
      notify("success");

      // Список перечитывается здесь же: разобранное должно исчезнуть сразу,
      // иначе кнопка выглядит нажатой впустую и её жмут снова.
      await load();
      onDone();
    } catch (e) {
      notify("error");
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  }

  /** Отметить всю группу разом: галочки в текущем списке, не правило на будущее. */
  function markGroup(group: ReviewGroup, kind: string) {
    tap();
    setChoice((current) => {
      const next = { ...current };
      for (const item of group.items) next[item.id] = kind;
      return next;
    });
  }

  const total = groups?.reduce((sum, g) => sum + g.count, 0) ?? 0;

  return (
    <>
      <p className="label" style={{ margin: "12px 2px 6px" }}>
        Приходы и переводы
      </p>
      <p className="dim" style={{ margin: "0 2px 14px" }}>
        Выписка не знает, чьи это деньги. Отметь, что доход, а что перекладывание
        между своими счетами — второе в отчёты не попадёт.
      </p>

      {error !== null && <div className="err">{error}</div>}
      {groups === null && error === null && <p className="spinner">Загружаю…</p>}

      {groups !== null && total === 0 && (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <p className="muted">Всё разобрано</p>
        </div>
      )}

      {groups?.map((group) => {
        const incoming = group.items[0]?.incoming === true;
        const sum = group.items.reduce((acc, item) => acc + item.base, 0);
        const days = group.items.map((item) => item.spentAt).sort();
        const decided = group.items.filter((item) => choice[item.id] !== undefined);
        const mine = decided.filter((item) => choice[item.id] === "transfer").length;
        const expanded = open === group.counterparty;

        return (
          <div key={group.counterparty} style={{ marginBottom: 14 }}>
            <div className="card" style={{ padding: "12px 16px" }}>
              <button
                className="item"
                style={{ padding: 0 }}
                onClick={() => {
                  tap();
                  setOpen(expanded ? null : group.counterparty);
                }}
              >
                <span className="grow">
                  <span className="title">{shorten(group.counterparty)}</span>
                  <span className="sub">
                    {group.count} операций · {money(sum, currency)} ·{" "}
                    {days[0] === days[days.length - 1]
                      ? dayTitle(days[0] ?? today, today)
                      : `${dayTitle(days[0] ?? today, today)} — ${dayTitle(days[days.length - 1] ?? today, today)}`}
                  </span>
                </span>
                <span className="dim" style={{ fontSize: 13 }}>
                  {mine === group.count ? "мои" : mine === 0 ? (incoming ? "доход" : "расход") : "×"}
                </span>
              </button>

              {/* Решение принимается по группе: у одного адреса их бывают сотни,
                  и щёлкать каждую — это час работы вместо минуты. Развернуть и
                  поправить отдельные всё равно можно. */}
              <div className="seg" style={{ marginTop: 10 }}>
                <button
                  className={mine === group.count ? "on" : ""}
                  onClick={() => markGroup(group, "transfer")}
                >
                  мои деньги
                </button>
                <button
                  className={mine === 0 ? "on" : ""}
                  onClick={() => markGroup(group, incoming ? "income" : "expense")}
                >
                  {incoming ? "доход" : "расход"}
                </button>
              </div>
            </div>

            {expanded && (
              <div className="card rows" style={{ padding: "2px 16px", marginTop: 8 }}>
                {group.items.map((item) => (
                  <div key={item.id} className="item dense">
                    <span className="grow">
                      <span className="title">
                        {item.incoming ? "+" : "−"}
                        {moneyExact(item.amount, item.currency)}
                      </span>
                      <span className="sub">{dayTitle(item.spentAt, today)}</span>
                    </span>

                    <span className="seg" style={{ width: 150 }}>
                      <button
                        className={choice[item.id] === "transfer" ? "on" : ""}
                        onClick={() => {
                          tap();
                          setChoice((c) => ({ ...c, [item.id]: "transfer" }));
                        }}
                      >
                        мои
                      </button>
                      <button
                        className={choice[item.id] !== "transfer" ? "on" : ""}
                        onClick={() => {
                          tap();
                          setChoice((c) => ({
                            ...c,
                            [item.id]: item.incoming ? "income" : "expense",
                          }));
                        }}
                      >
                        {item.incoming ? "доход" : "расход"}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {total > 0 && (
        <button className="cta mint" disabled={busy} onClick={() => void save()}>
          {busy ? "Сохраняю…" : `Готово · ${total}`}
        </button>
      )}
    </>
  );
}

/** Адрес кошелька целиком не читается: середину видеть незачем. */
function shorten(value: string): string {
  if (value === "") return "без адреса";
  if (value.length <= 22) return value;

  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}
