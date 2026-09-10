import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import { initTelegram } from "./telegram.js";

initTelegram();

/**
 * Высота шторок — один раз и навсегда.
 *
 * dvh по определению динамическая: она меняется от клавиатуры, от панелей
 * браузера, от чего угодно, и шторка от этого дышит. Замер делается один раз
 * при запуске и больше не повторяется — размер должен быть постоянным, даже
 * если это стоит нескольких пикселей неточности после поворота экрана.
 */
document.documentElement.style.setProperty(
  "--sheet-h",
  `${Math.round(window.innerHeight * 0.92)}px`,
);

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
