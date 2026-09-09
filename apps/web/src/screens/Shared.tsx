import { useEffect, useState } from "react";
import { api, type SharedState } from "../api.js";
import { SwipeRow } from "../SwipeRow.js";
import { notify, tap } from "../telegram.js";

/**
 * Общий бюджет.
 *
 * Отдельная книга трат на несколько человек. Разницы вкладов здесь намеренно
 * нет: она превращает общий бюджет во взаиморасчёты, а нужен был просто общий
 * котёл.
 */
export function Shared({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<SharedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setState(await api.ledgers());
  }

  useEffect(() => {
    void load().catch(() => notify("error"));
  }, []);

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    tap();
    try {
      await fn();
      await load();
      onChanged();
    } catch {
      notify("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === null) return <p className="spinner">Загружаю…</p>;

  if (state.shared === null) {
    return (
      <>
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <p className="h2" style={{ marginBottom: 8 }}>
            Общий бюджет
          </p>
          <p className="muted">
            Отдельная книга трат на несколько человек: у неё свои категории и общий итог.
            Личные траты в неё не попадают.
          </p>
        </div>

        <button className="cta mint" disabled={busy} onClick={() => void act(api.createLedger)}>
          Завести общий бюджет
        </button>
      </>
    );
  }

  return (
    <>
      <div className="between" style={{ padding: "12px 2px 14px" }}>
        <p className="label">{state.shared.title}</p>
        <span className="dim">{state.shared.members.length} участника</span>
      </div>

      <div className="card rows" style={{ padding: "2px 16px", marginBottom: 16 }}>
        {state.shared.members.map((member) =>
          member.role === "owner" ? (
            <div key={member.userId} className="item">
              <span className="tile">{member.name.slice(0, 1).toUpperCase()}</span>
              <span className="grow">
                <span className="title">{member.name}</span>
                <span className="sub">создал</span>
              </span>
            </div>
          ) : (
            <SwipeRow
              key={member.userId}
              label="Убрать"
              onDelete={() => act(() => api.removeMember(member.userId))}
            >
              <div className="item">
                <span className="tile">{member.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow">
                  <span className="title">{member.name}</span>
                  <span className="sub">участник · смахни влево, чтобы убрать</span>
                </span>
              </div>
            </SwipeRow>
          ),
        )}
      </div>

      <p className="label" style={{ margin: "0 2px 10px" }}>
        Куда пишутся траты
      </p>
      <div className="chips" style={{ marginBottom: 20 }}>
        <button
          className={state.activeIsShared ? "pill ghost" : "pill on"}
          onClick={() => void act(() => api.setActiveLedger(false))}
        >
          Личные
        </button>
        <button
          className={state.activeIsShared ? "pill on" : "pill ghost"}
          onClick={() => void act(() => api.setActiveLedger(true))}
        >
          Общий бюджет
        </button>
      </div>

      <p className="label" style={{ margin: "0 2px 10px" }}>
        Приглашение
      </p>
      <div className="card" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <p className="sub" style={{ wordBreak: "break-all" }}>{state.shared.link}</p>
      </div>

      <button
        className="cta"
        style={{ background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
        onClick={() => {
          tap();
          // Буфер в webview иногда закрыт — тогда ссылку просто копируют руками.
          void navigator.clipboard
            ?.writeText(state.shared?.link ?? "")
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
      </button>

      <button
        className="cta"
        style={{ marginTop: 10, background: "transparent", color: "var(--ink-3)" }}
        onClick={() => void act(api.leaveLedger)}
      >
        Выйти из общего бюджета
      </button>
    </>
  );
}
