import { useState } from "react";
import { notify, tap } from "./telegram.js";

/**
 * Подтверждение по центру экрана.
 *
 * Не шторка снизу: смахнутая строка уже уехала, и вопрос должен встать там,
 * куда смотрит человек, а не там, откуда он только что убрал палец.
 */
export function Confirm({
  title,
  detail,
  action = "Удалить",
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string;
  action?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      notify("error");
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}>
        <p className="h2" style={{ marginBottom: detail === undefined ? 18 : 6 }}>
          {title}
        </p>
        {detail !== undefined && (
          <p className="muted" style={{ marginBottom: 18 }}>
            {detail}
          </p>
        )}

        <button
          className="cta"
          style={{ background: "rgba(255,110,110,.9)", color: "#2a0d0d" }}
          disabled={busy}
          onClick={() => {
            tap("medium");
            void confirm();
          }}
        >
          {busy ? "…" : action}
        </button>

        <button
          className="cta"
          style={{ marginTop: 10, background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
