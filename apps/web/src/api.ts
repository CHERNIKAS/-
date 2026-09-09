import { initData } from "./telegram.js";

/** Все запросы подписаны initData: сервер по ней же и опознаёт пользователя. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-init-data": initData(),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Ошибка ${response.status}`);
  }

  return (await response.json()) as T;
}

export type Category = { slug: string; title: string; emoji: string };

export type Expense = {
  id: number;
  amount: number;
  currency: string;
  base: number;
  spentAt: string;
  merchant: string;
  note: string | null;
  payment: "card" | "cash" | "transfer";
  confidence: number | null;
  source: "bot" | "app";
  needsReview: boolean;
  category: Category | null;
};

export type State = {
  user: {
    currency: string;
    timezone: string;
    reminderEnabled: boolean;
    reminderHour: number;
    dailyCleanup: boolean;
    monthlyDigest: boolean;
    monthlyBudget: number | null;
    firstName: string | null;
  };
  today: string;
  totals: { day: number; month: number };
  categories: Category[];
  recent: Expense[];
};

export type Analytics = {
  period: { key: string; label: string; from: string; to: string };
  total: number;
  currency: string;
  categories: { slug: string; title: string; emoji: string; total: number }[];
  byCurrency: { currency: string; amount: number; base: number }[];
};

export const api = {
  state: () => request<State>("/state"),

  expense: (id: number) => request<{ expense: Expense }>(`/expenses/${id}`),

  expenses: (from: string, to: string) =>
    request<{ expenses: Expense[] }>(`/expenses?from=${from}&to=${to}`),

  createFromText: (text: string, currency?: string) =>
    request<{ created: Expense[] }>("/expenses", {
      method: "POST",
      body: JSON.stringify({ text, currency }),
    }),

  create: (payload: { amount: number; currency?: string; categorySlug?: string; merchant?: string }) =>
    request<{ created: Expense[] }>("/expenses", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  update: (id: number, patch: Record<string, unknown>) =>
    request<{ expense: Expense | null }>(`/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  remove: (id: number) => request<{ ok: true }>(`/expenses/${id}`, { method: "DELETE" }),

  analytics: (period: string, from?: string, to?: string) =>
    request<Analytics>(
      period === "custom" && from !== undefined && to !== undefined
        ? `/analytics?period=custom&from=${from}&to=${to}`
        : `/analytics?period=${period}`,
    ),

  exportCsv: (from?: string, to?: string) =>
    request<{ ok: true; count: number }>("/export", {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),

  settings: (patch: Record<string, unknown>) =>
    request<{ ok: true }>("/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  categories: () =>
    request<{ limit: number; categories: { slug: string; title: string; emoji: string; count: number; total: number }[] }>(
      "/categories",
    ),

  renameCategory: (slug: string, title: string) =>
    request<{ ok: true }>(`/categories/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  mergeCategory: (slug: string, into: string) =>
    request<{ ok: true }>(`/categories/${slug}/merge`, {
      method: "POST",
      body: JSON.stringify({ into }),
    }),

  rules: () =>
    request<{ rules: { id: number; pattern: string; hits: number; title: string; slug: string }[] }>(
      "/rules",
    ),

  deleteRule: (id: number) => request<{ ok: true }>(`/rules/${id}`, { method: "DELETE" }),

  createCategory: (title: string, emoji: string) =>
    request<{ category: Category | null }>("/categories", {
      method: "POST",
      body: JSON.stringify({ title, emoji }),
    }),
};
