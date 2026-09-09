/**
 * Тонкая обёртка над Telegram WebApp.
 *
 * Берём штатный скрипт Telegram вместо SDK-обёртки: из всего API приложению
 * нужны четыре вещи — initData, тема, haptics и разворот на весь экран. Ради
 * них тянуть отдельную библиотеку и подстраиваться под её версии смысла нет.
 */

type HapticStyle = "light" | "medium" | "heavy" | "soft" | "rigid";

type WebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: HapticStyle) => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const webApp = (): WebApp | undefined => window.Telegram?.WebApp;

export function initTelegram(): void {
  const app = webApp();
  if (app === undefined) return;

  app.ready();
  app.expand();
  app.setHeaderColor?.("#2A1B57");
  app.setBackgroundColor?.("#2A1B57");
}

export function initData(): string {
  return webApp()?.initData ?? "";
}

export function tap(style: HapticStyle = "light"): void {
  webApp()?.HapticFeedback?.impactOccurred(style);
}

export function notify(type: "error" | "success" | "warning"): void {
  webApp()?.HapticFeedback?.notificationOccurred(type);
}

export function backButton(visible: boolean, onClick: () => void): () => void {
  const button = webApp()?.BackButton;
  if (button === undefined) return () => undefined;

  if (visible) {
    button.onClick(onClick);
    button.show();
  } else {
    button.hide();
  }

  return () => {
    button.offClick(onClick);
    button.hide();
  };
}
