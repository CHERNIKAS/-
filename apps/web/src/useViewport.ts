import { useEffect } from "react";

/**
 * Высота видимой части экрана в CSS-переменной.
 *
 * Единицы dvh не знают про клавиатуру: она закрывает половину экрана, а
 * 92dvh остаются теми же 92% всего экрана. Шторка оказывается выше доступного
 * места, внутри появляется прокрутка — и любое касание её дёргает, хотя
 * листать там нечего.
 *
 * visualViewport знает про клавиатуру точно, поэтому шторка меряется по нему.
 */
export function useViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;

    function apply(): void {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${Math.round(height)}px`);
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
