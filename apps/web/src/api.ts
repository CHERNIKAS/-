import { initData } from "./telegram.js";

/** Все запросы подписаны initData: сервер по ней же и опознаёт пользователя. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Content-Type ставим только когда тело действительно есть: с этим
  // заголовком и пустым телом Fastify ждёт JSON и отвечает 400. Из-за этого
  // молча ломались все запросы без тела — удаление траты в том числе.
  const headers: Record<string, string> = { "x-init-data": initData() };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
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
  /** Расход, доход или перенос между своими счетами. */
  kind: "expense" | "income" | "transfer";
  incomeSource: string | null;
  /** Сколько по этой покупке вернули: из итогов сумма уже вычтена. */
  refunded: number;
  /** Вес траты в итогах: сумма за вычетом возврата, в валюте отображения. */
  netBase: number;
  /** Куда переехали деньги, если это перенос: наличка, карта, крипта. */
  movedTo: string | null;
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
    /** Подсказки при вводе дохода: свои или список по умолчанию. */
    incomeSources: string[];
  };
  today: string;
  sharedActive: boolean;
  /** Книга, в которую сейчас пишется: личная, общая или книга дела. */
  book: { id: number; title: string; kind: "personal" | "shared" | "business" };
  totals: { day: number; month: number; income: number };
  /** Сколько приходов и переводов ждут ответа «доход или свои деньги». */
  needsReview: number;
  currencies: { currency: string; amount: number; base: number }[];
  categories: Category[];
  recent: Expense[];
};

export type SharedState = {
  activeIsShared: boolean;
  shared: {
    title: string;
    link: string;
    members: { userId: number; name: string; role: string }[];
  } | null;
};

export type RecurringItem = {
  id: number;
  title: string;
  amount: number;
  currency: string;
  dayOfMonth: number;
  active: boolean;
  category: string | null;
  categorySlug: string | null;
};

export type BalanceState = {
  total: number;
  currency: string;
  places: { place: string; currency: string; amount: number; moves: number; lastAt: string }[];
  entries: {
    id: number;
    place: string;
    amount: number;
    currency: string;
    note: string | null;
    happenedAt: string;
  }[];
};

export type ReviewItem = {
  id: number;
  amount: number;
  currency: string;
  base: number;
  spentAt: string;
  merchant: string;
  kind: "expense" | "income" | "transfer";
  /** Деньги пришли, а не ушли: от этого зависит, какой вопрос задаём. */
  incoming: boolean;
};

export type ReviewGroup = { counterparty: string; count: number; items: ReviewItem[] };

export type Analytics = {
  period: { key: string; label: string; from: string; to: string };
  total: number;
  income: number;
  currency: string;
  categories: { slug: string; title: string; emoji: string; total: number }[];
  byCurrency: { currency: string; amount: number; base: number }[];
};

export const api = {
  state: () => request<State>("/state"),

  expense: (id: number) => request<{ expense: Expense }>(`/expenses/${id}`),

  expenses: (from: string, to: string, filters?: { category?: string; payment?: string }) => {
    const params = new URLSearchParams({ from, to });
    if (filters?.category !== undefined) params.set("category", filters.category);
    if (filters?.payment !== undefined) params.set("payment", filters.payment);
    return request<{ expenses: Expense[] }>(`/expenses?${params.toString()}`);
  },

  createFromText: (text: string, currency?: string, kind?: "expense" | "income", incomeSource?: string) =>
    request<{ created: Expense[]; refunded: number }>("/expenses", {
      method: "POST",
      body: JSON.stringify({ text, currency, kind, incomeSource }),
    }),

  create: (payload: {
    amount: number;
    currency?: string;
    categorySlug?: string;
    merchant?: string;
    kind?: "expense" | "income";
    incomeSource?: string;
  }) =>
    request<{ created: Expense[]; refunded: number }>("/expenses", {
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

  recurring: () => request<{ items: RecurringItem[] }>("/recurring"),

  createRecurring: (payload: {
    title: string;
    amount: number;
    currency: string;
    dayOfMonth: number;
    categorySlug?: string;
  }) => request<{ id: number }>("/recurring", { method: "POST", body: JSON.stringify(payload) }),

  toggleRecurring: (id: number, active: boolean) =>
    request<{ ok: true }>(`/recurring/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),

  ledgers: () => request<SharedState>("/ledgers"),

  createLedger: () => request<{ ok: boolean }>("/ledgers", { method: "POST" }),

  setActiveLedger: (shared: boolean) =>
    request<{ ok: boolean }>("/ledgers/active", {
      method: "POST",
      body: JSON.stringify({ shared }),
    }),

  leaveLedger: () => request<{ ok: boolean }>("/ledgers/leave", { method: "POST" }),

  removeMember: (userId: number) =>
    request<{ ok: true }>(`/ledgers/members/${userId}`, { method: "DELETE" }),

  categories: () =>
    request<{
      limit: number;
      categories: { slug: string; title: string; emoji: string; count: number; total: number }[];
      sources: { title: string; count: number; total: number }[];
    }>(
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

  /** Эмодзи не передаём: сервер подбирает его по названию той же таблицей, что и значок. */
  balance: () => request<BalanceState>("/balance"),

  addBalance: (payload: {
    place: string;
    amount: number;
    currency: string;
    note?: string;
    happenedAt?: string;
  }) => request<{ id: number }>("/balance", { method: "POST", body: JSON.stringify(payload) }),

  removeBalance: (id: number) => request<{ ok: true }>(`/balance/${id}`, { method: "DELETE" }),

  books: () =>
    request<{ limit: number; books: { id: number; title: string; kind: string; active: boolean }[] }>(
      "/books",
    ),

  createBook: (title: string, kind: "shared" | "business" = "business") =>
    request<{ id: number }>("/books", { method: "POST", body: JSON.stringify({ title, kind }) }),

  switchBook: (id: number) =>
    request<{ ok: true }>("/books/active", { method: "POST", body: JSON.stringify({ id }) }),

  review: () => request<{ total: number; groups: ReviewGroup[] }>("/review"),

  saveReview: (decisions: { id: number; kind: string }[]) =>
    request<{ ok: true }>("/review", { method: "PATCH", body: JSON.stringify({ decisions }) }),

  createCategory: (title: string) =>
    request<{ category: Category | null }>("/categories", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
};
