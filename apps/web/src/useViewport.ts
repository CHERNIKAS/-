import { useEffect } from "react";

/**
 * Высота клавиатуры в CSS-переменной.
 *
 * Шторка не должна менять свой размер от того, что появилась клавиатура —
 * иначе она прыгает при каждом касании поля. Правильное поведение то же, что
 * у обычных приложений: размер свой, а клавиатура просто поднимает её выше.
 *
 * Сколько занимает клавиатура, знает только visualViewport: обычная высота
 * окна при её появлении не меняется.
 */
export function useViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;

    function apply(): void {
      const visible = viewport?.height ?? window.innerHeight;
      const keyboard = Math.max(0, Math.round(window.innerHeight - visible));

      // Мелочь в пару пикселей — это адресная строка и прочая мелкая возня
      // браузера, а не клавиатура: сдвигать из-за неё шторку не надо.
      document.documentElement.style.setProperty("--kb", keyboard > 80 ? `${keyboard}px` : "0px");
    }

    apply();

    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);

    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);
}
