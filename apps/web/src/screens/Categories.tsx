import { useEffect, useState } from "react";
import { api } from "../api.js";
import { money } from "../format.js";
import { guessIcon, PALETTE } from "@costnote/core";
import { CategoryIcon } from "../icons.js";
import { categoryColor, tint } from "../palette.js";
import { notify, tap } from "../telegram.js";

type Row = { slug: string; title: string; emoji: string; count: number; total: number };
type Rule = { id: number; pattern: string; hits: number; title: string; slug: string };

/**
 * Категории и выученные правила.
 *
 * Число трат рядом с названием отвечает на вопрос «а живая ли она»: категории
 * с нулём — первые кандидаты на слияние. Слияние ничего не удаляет, траты и
 * правила переезжают, а исходная уходит в архив.
 */
export function Categories({
  currency,
  incomeSources,
  onChanged,
}: {
  currency: string;
  incomeSources: string[];
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [limit, setLimit] = useState(50);
  const [rules, setRules] = useState<Rule[]>([]);
  const [sources, setSources] = useState<{ title: string; count: number; total: number }[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [title, setTitle] = useState("");
  const [merging, setMerging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  /**
   * Заведение категорий подряд.
   *
   * Поле не прячется после сохранения и не теряет фокус: заводят их обычно
   * пачкой, сразу после первой мысли «а вот этого не хватает».
   */
  const [fresh, setFresh] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [freshSource, setFreshSource] = useState("");
  /**
   * Тот же переключатель, что и при добавлении траты.
   *
   * Расход и доход устроены по-разному — категории против источников, — но
   * настраиваются одинаково, и держать их одним длинным полотном значит
   * заставлять пролистывать чужую половину.
   */
  const [side, setSide] = useState<"expense" | "income">("expense");

  async function load() {
    const [cats, rls] = await Promise.all([api.categories(), api.rules()]);
    setRows(cats.categories);
    setSources(cats.sources);
    setLimit(cats.limit);
    setRules(rls.rules);
  }

  useEffect(() => {
    void load().catch(() => notify("error"));
  }, []);

  async function create() {
    const title = fresh.trim();
    if (title === "" || busy) return;

    setBusy(true);
    try {
      await api.createCategory(title);
      tap();
      setFresh("");
      setAdded((list) => [title, ...list].slice(0, 4));
      await load();
      onChanged();
    } catch (e) {
      notify("error");
      alertError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Источники дохода живут отдельно от категорий: категории отвечают, куда
   * деньги ушли, источники — откуда пришли, и мешать их в одном списке значит
   * получить «Зарплату» в кольце расходов.
   */
  async function saveSources(next: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      await api.settings({ incomeSources: next });
      onChanged();
    } catch (e) {
      notify("error");
      alertError(e);
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (editing === null || busy || title.trim() === "") return;
    setBusy(true);
    try {
      await api.renameCategory(editing.slug, title.trim());
      setEditing(null);
      await load();
      onChanged();
    } catch {
      notify("error");
    } finally {
      setBusy(false);
    }
  }

  async function merge(into: string) {
    if (editing === null || busy) return;
    setBusy(true);
    try {
      await api.mergeCategory(editing.slug, into);
      setMerging(false);
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      notify("error");
      alertError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="seg" style={{ margin: "12px 0 14px" }}>
        {(["expense", "income"] as const).map((value) => (
          <button
            key={value}
            className={side === value ? "on" : ""}
            onClick={() => {
              tap();
              setSide(value);
            }}
          >
            {value === "expense" ? "Расход" : "Доход"}
          </button>
        ))}
      </div>

      <div className="between" style={{ padding: "0 2px 12px" }}>
        <p className="label">{side === "expense" ? "Категории" : "Источники дохода"}</p>
        <span className="dim">
          {side === "expense" ? `${rows.length} из ${limit}` : `${incomeSources.length} из 12`}
        </span>
      </div>

      {side === "expense" && (
        <>
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <input
            className="field grow"
            placeholder="Например, Спорт"
            value={fresh}
            maxLength={64}
            onChange={(e) => setFresh(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <button
            className="pill on"
            style={{ padding: "14px 18px" }}
            disabled={fresh.trim() === "" || busy || rows.length >= limit}
            onClick={() => void create()}
          >
            Завести
          </button>
        </div>

        {added.length > 0 && (
          <p className="dim" style={{ margin: "0 2px 14px" }}>
            Завёл: {added.join(", ")}. Значок подобрал по названию — можно
            переименовать, если не угадал.
          </p>
        )}

        <div className="card rows" style={{ padding: "2px 16px" }}>
          {rows.map((row) => {
            const color = categoryColor(row.slug, rows);
            return (
              <button
                key={row.slug}
                className="item"
                onClick={() => {
                  tap();
                  setEditing(row);
                  setTitle(row.title);
                  setMerging(false);
                }}
              >
                <span
                  className="tile"
                  style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                >
                  <CategoryIcon slug={row.slug} title={row.title} />
                </span>
                <span className="grow">
                  <span className="title">{row.title}</span>
                  <span className="sub">
                    {row.count === 0 ? "за 30 дней трат нет" : `${row.count} трат за 30 дней`}
                  </span>
                </span>
                <span className="amount">{row.total === 0 ? "—" : money(row.total, currency)}</span>
              </button>
            );
          })}
        </div>
        </>
      )}

      {side === "income" && (
        <>
        {/* Такие же карточки, как у категорий: источник — это тоже строка со
            своим значком, и выглядеть по-другому ей не за что. */}
        <div className="card rows" style={{ padding: "2px 16px", marginBottom: 14 }}>
          {incomeSources.map((title, index) => {
            const color = PALETTE[index % PALETTE.length] as string;
            const stat = sources.find((r) => r.title === title);
            return (
              <div key={title} className="item">
                <span
                  className="tile"
                  style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                >
                  <CategoryIcon slug={sourceIcon(title)} />
                </span>
                <span className="grow">
                  <span className="title">{title}</span>
                  <span className="sub">
                    {stat === undefined || stat.count === 0
                      ? "за 30 дней поступлений нет"
                      : `${stat.count} поступлений за 30 дней`}
                  </span>
                </span>
                <span className="amount" style={{ marginRight: 10 }}>
                  {stat === undefined || stat.total === 0 ? "—" : money(stat.total, currency)}
                </span>
                <button
                  className="danger-square"
                  aria-label={`Убрать ${title}`}
                  onClick={() => {
                    tap();
                    void saveSources(incomeSources.filter((t) => t !== title));
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 12.5h9L17.5 7" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <input
            className="field grow"
            placeholder="Например, Аренда"
            value={freshSource}
            maxLength={32}
            onChange={(e) => setFreshSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const title = freshSource.trim();
              if (title === "") return;
              setFreshSource("");
              void saveSources([...incomeSources, title]);
            }}
          />
          <button
            className="pill on"
            style={{ padding: "14px 18px" }}
            disabled={freshSource.trim() === "" || busy}
            onClick={() => {
              const title = freshSource.trim();
              if (title === "") return;
              setFreshSource("");
              void saveSources([...incomeSources, title]);
            }}
          >
            Добавить
          </button>
        </div>

        <p className="dim" style={{ margin: "8px 2px 0" }}>
          Это подсказки при вводе дохода. Уберёшь все — вернутся стандартные.
        </p>
        </>
      )}

      {/* Правила учат категориям расходов, у доходов их нет — на второй
          половине эта кнопка была бы обманом. */}
      <button
        className="cta"
        hidden={side === "income"}
        style={{ marginTop: 22, background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
        onClick={() => {
          tap();
          setShowRules((open) => !open);
        }}
      >
        {showRules ? "Скрыть правила" : `Выученные правила · ${rules.length}`}
      </button>

      {showRules && side === "expense" && (
        <>
          <p className="dim" style={{ margin: "12px 2px" }}>
            Каждая твоя правка превращается в правило, и такая строка больше не
            уходит в модель. Ненужное можно отменить.
          </p>
          <div className="card rows" style={{ padding: "2px 16px" }}>
            {rules.length === 0 && (
              <p className="muted" style={{ padding: "18px 0" }}>
                Пока ничего не выучено
              </p>
            )}
            {rules.map((rule) => (
              <div key={rule.id} className="item">
                <span className="grow">
                  <span className="title">{rule.pattern}</span>
                  <span className="sub">
                    → {rule.title} · срабатывало {rule.hits}
                  </span>
                </span>
                <button
                  className="pill ghost"
                  onClick={() => {
                    tap();
                    void api
                      .deleteRule(rule.id)
                      .then(load)
                      .catch(() => notify("error"));
                  }}
                >
                  Забыть
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {editing !== null && (
        <div className="sheet" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />

            {merging ? (
              <>
                <p className="label" style={{ marginBottom: 6 }}>
                  Слить «{editing.title}» с
                </p>
                <p className="dim" style={{ marginBottom: 14 }}>
                  Траты и правила переедут, исходная уйдёт в архив. Ничего не удалится.
                </p>
                <div className="card rows" style={{ padding: "2px 16px" }}>
                  {rows
                    .filter((r) => r.slug !== editing.slug)
                    .map((r) => (
                      <button key={r.slug} className="item" onClick={() => void merge(r.slug)}>
                        <span className="grow title">{r.title}</span>
                        <span className="dim">{r.count}</span>
                      </button>
                    ))}
                </div>
                <button
                  className="cta"
                  style={{ marginTop: 14, background: "rgba(255,255,255,.1)", color: "var(--ink)" }}
                  onClick={() => setMerging(false)}
                >
                  Назад
                </button>
              </>
            ) : (
              <>
                <p className="label" style={{ marginBottom: 10 }}>
                  Название
                </p>
                <input
                  className="field"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ marginBottom: 16 }}
                />
                <button className="cta mint" disabled={busy} onClick={() => void rename()}>
                  Сохранить
                </button>
                <button
                  className="cta"
                  style={{ marginTop: 10, background: "rgba(255,255,255,.1)", color: "var(--ink)" }}
                  onClick={() => setMerging(true)}
                >
                  Слить с другой
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function alertError(e: unknown): void {
  if (e instanceof Error) console.error(e.message);
}

/**
 * Значок источника.
 *
 * Названия у источников свои — «Аренда», «Продажи», — и таблица значков
 * угадывает их так же, как у категорий. Не угадала — стрелка прихода, а не
 * безликий ромбик.
 */
function sourceIcon(title: string): string {
  const guessed = guessIcon(title).icon;
  return guessed === "other" ? "income" : guessed;
}
