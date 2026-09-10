import { useEffect, useState } from "react";
import { api } from "./api.js";
import { notify, tap } from "./telegram.js";
import { useBodyLock } from "./useBodyLock.js";
import { useSheetDrag } from "./useSheetDrag.js";

/**
 * Переключение книги.
 *
 * Книга — это отдельный мир: пока открыта личная, бизнеса не существует ни в
 * тратах, ни в отчётах. Ничего не смешивается и не фильтруется — просто другая
 * книга.
 *
 * Переключатель один на бота и приложение: иначе выходит ловушка, где в чате
 * пишешь в одну книгу, а смотришь другую и не понимаешь, куда делись деньги.
 */
export function BookPicker({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [books, setBooks] = useState<{ id: number; title: string; kind: string; active: boolean }[]>(
    [],
  );
  const [limit, setLimit] = useState(8);
  const [fresh, setFresh] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  useBodyLock(true);
  const drag = useSheetDrag(onClose);

  useEffect(() => {
    api
      .books()
      .then((result) => {
        setBooks(result.books);
        setLimit(result.limit);
      })
      .catch(() => notify("error"));
  }, []);

  async function switchTo(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      await api.switchBook(id);
      notify("success");
      onDone();
    } catch {
      notify("error");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const title = fresh.trim();
    if (title === "" || busy) return;

    setBusy(true);
    try {
      await api.createBook(title);
      notify("success");
      onDone();
    } catch {
      notify("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet short" onClick={onClose}>
      <div
        ref={drag.ref}
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", ...drag.sheetStyle }}
      >
        <div className="grabber" />

        <p className="label" style={{ marginBottom: 10 }}>
          Книга
        </p>

        <div className="card rows" style={{ padding: "2px 16px", marginBottom: 12 }}>
          {books.map((book) => (
            <button key={book.id} className="item" onClick={() => void switchTo(book.id)}>
              <span className="grow">
                <span className="title">{book.title}</span>
                <span className="sub">{KIND_TITLE[book.kind] ?? "книга"}</span>
              </span>
              {book.active && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4.5 4.5L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {adding ? (
          <div className="row" style={{ gap: 8 }}>
            <input
              className="field grow"
              autoFocus
              placeholder="Например, Чайный магазин"
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
              disabled={fresh.trim() === "" || busy}
              onClick={() => void create()}
            >
              Завести
            </button>
          </div>
        ) : (
          <button
            className="cta"
            style={{ background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
            disabled={books.length >= limit}
            onClick={() => {
              tap();
              setAdding(true);
            }}
          >
            Завести книгу дела
          </button>
        )}

        <p className="dim" style={{ margin: "10px 2px 0" }}>
          У книги дела свои категории — закупка, аренда, зарплаты — и свой главный
          экран: оборот, расходы, прибыль.
        </p>
      </div>
    </div>
  );
}

const KIND_TITLE: Record<string, string> = {
  personal: "личные траты",
  shared: "общий бюджет",
  business: "дело",
};
