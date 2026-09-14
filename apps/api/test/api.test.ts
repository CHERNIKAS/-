import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { confirmAuthRequest, createLedger, db, ensureUser, expenseById, schema } from "@costnote/core/data";

const { app } = await import("../src/index.js");

const TOKEN = process.env["BOT_TOKEN"] as string;
const TG_ID = 7001;

function initData(id = TG_ID): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, username: "tester" }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  const response = await app.inject({
    method,
    url,
    headers: { "x-init-data": initData() },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, json: response.json() as any };
}

async function newExpense(amount: number) {
  const r = await call("POST", "/api/expenses", { amount, currency: "USD", merchant: "Проверка", categorySlug: "other" });
  return r.json.created[0].id as number;
}

describe("вход", () => {
  it("без подписи Telegram — 401", async () => {
    const r = await app.inject({ method: "GET", url: "/api/expenses" });
    expect(r.statusCode).toBe(401);
  });
});

describe("операции через приложение", () => {
  it("несуществующая дата — 400, а не 500", async () => {
    const r = await call("POST", "/api/expenses", { amount: 5, spentAt: "2026-02-31" });
    expect(r.status).toBe(400);
  });

  it("перенос в книгу: отказ ничего не ломает, сумма и баланс синхронны, удаление целиком", async () => {
    const { user } = await ensureUser({ id: TG_ID });
    const business = await createLedger(user, "Дело", "business");

    const id = await newExpense(40);
    expect((await call("PATCH", `/api/expenses/${id}`, { toBook: business.id })).status).toBe(200);
    const mirrorId = (await expenseById(id))!.pairedWithId!;
    expect((await expenseById(mirrorId))?.ledgerId).toBe(business.id);

    expect((await call("PATCH", `/api/expenses/${id}`, { toBook: 999_999 })).status).toBe(400);
    expect((await expenseById(id))?.pairedWithId).toBe(mirrorId);
    expect((await expenseById(mirrorId))?.deletedAt).toBeNull();

    await call("PATCH", `/api/expenses/${id}`, { amount: 45 });
    expect(Number((await expenseById(mirrorId))?.amount)).toBe(45);

    await call("PATCH", `/api/expenses/${id}`, { movedTo: "нал" });
    const entryId = (await expenseById(id))!.balanceEntryId!;
    await call("PATCH", `/api/expenses/${id}`, { amount: 50 });
    const entry = await db.query.balanceEntries.findFirst({ where: eq(schema.balanceEntries.id, entryId) });
    expect(Math.abs(Number(entry?.amount))).toBe(50);

    expect((await call("DELETE", `/api/expenses/${id}`)).status).toBe(200);
    expect((await expenseById(mirrorId))?.deletedAt).not.toBeNull();
    expect(await db.query.balanceEntries.findFirst({ where: eq(schema.balanceEntries.id, entryId) })).toBeUndefined();
  });

  it("разбивка сходится с итогом, фильтр «без категории» работает", async () => {
    await call("POST", "/api/expenses", { amount: 12, currency: "USD", merchant: "Без категории", categorySlug: "нет-такой" });

    const analytics = await call("GET", "/api/analytics?period=year");
    const sum = analytics.json.categories.reduce((s: number, c: { total: number }) => s + c.total, 0);
    expect(sum).toBeCloseTo(analytics.json.total);

    const list = await call("GET", "/api/expenses?category=uncategorized&from=2020-01-01");
    expect(list.status).toBe(200);
    expect(list.json.expenses.length).toBeGreaterThan(0);
    expect(list.json.expenses.every((e: { category: unknown }) => e.category === null)).toBe(true);
  });
});

describe("коннектор Claude", () => {
  it("без токена — 401 с указателем на метаданные", async () => {
    const r = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(r.statusCode).toBe(401);
    expect(r.headers["www-authenticate"]).toContain("resource_metadata=");
  });

  it("полный вход: регистрация, код в боте, обмен с PKCE, вызов инструмента, ротация", async () => {
    const { user } = await ensureUser({ id: TG_ID });
    const redirect = "https://claude.ai/api/mcp/auth_callback";

    const registered = await app.inject({
      method: "POST",
      url: "/oauth/register",
      payload: { client_name: "Claude", redirect_uris: [redirect] },
    });
    expect(registered.statusCode).toBe(201);
    const clientId = registered.json().client_id as string;

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const page = await app.inject({
      method: "GET",
      url: `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`,
    });
    expect(page.statusCode).toBe(200);

    const requestId = /start=mcp_([\w-]+)/.exec(page.body)?.[1] as string;
    const code = /class="code">(\d{4})</.exec(page.body)?.[1] as string;
    expect(code).toMatch(/^\d{4}$/);

    const pending = await app.inject({ method: "GET", url: `/oauth/poll?id=${requestId}` });
    expect(pending.json().status).toBe("pending");

    expect(await confirmAuthRequest(requestId, user.id, code)).toBe("ok");

    const approved = await app.inject({ method: "GET", url: `/oauth/poll?id=${requestId}` });
    const back = new URL(approved.json().redirect as string);
    expect(back.searchParams.get("state")).toBe("xyz");

    const form = (fields: Record<string, string>) => ({
      method: "POST" as const,
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(fields).toString(),
    });

    const badPkce = await app.inject(
      form({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: "не тот", client_id: clientId }),
    );
    expect(badPkce.json().error).toBe("invalid_grant");

    // Неудачный обмен уже израсходовал код: берём новый через повторный опрос.
    const again = await app.inject({ method: "GET", url: `/oauth/poll?id=${requestId}` });
    expect(again.json().status).toBe("expired");

    // Второй запрос входа — уже с верным verifier.
    const page2 = await app.inject({
      method: "GET",
      url: `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s2`,
    });
    const request2 = /start=mcp_([\w-]+)/.exec(page2.body)?.[1] as string;
    const code2 = /class="code">(\d{4})</.exec(page2.body)?.[1] as string;
    await confirmAuthRequest(request2, user.id, code2);
    const approved2 = await app.inject({ method: "GET", url: `/oauth/poll?id=${request2}` });
    const authCode = new URL(approved2.json().redirect as string).searchParams.get("code")!;

    const token = await app.inject(
      form({ grant_type: "authorization_code", code: authCode, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }),
    );
    expect(token.statusCode).toBe(200);
    const { access_token, refresh_token } = token.json();

    const rpc = (body: unknown, bearer = access_token) =>
      app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        payload: body as object,
      });

    const tools = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(tools.statusCode).toBe(200);
    expect(tools.json().result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["books", "list_expenses", "summary"]);

    const summary = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "summary", arguments: { from: "2020-01-01" } },
    });
    const data = JSON.parse(summary.json().result.content[0].text);
    expect(data.period.from).toBe("2020-01-01");
    expect(data.expenses).toBeGreaterThan(0);

    const rotated = await app.inject(form({ grant_type: "refresh_token", refresh_token, client_id: clientId }));
    expect(rotated.statusCode).toBe(200);
    const reused = await app.inject(form({ grant_type: "refresh_token", refresh_token, client_id: clientId }));
    expect(reused.json().error).toBe("invalid_grant");
  });
});
