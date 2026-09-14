import { createHash } from "node:crypto";
import { buildPeriod, PERIOD_KEYS, type Currency, type PeriodKey } from "@costnote/core";
import {
  ACCESS_TTL_SECONDS,
  type AppUser,
  activeLedgerId,
  byCategory,
  byCurrency,
  clientById,
  consumeCode,
  createAuthRequest,
  db,
  incomeUsd,
  issueCode,
  issueTokens,
  ledgersOf,
  listCategories,
  liveAuthRequest,
  localToday,
  rateToUsd,
  registerClient,
  rotateTokens,
  schema,
  tokenOwner,
  totalUsd,
} from "@costnote/core/data";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

/**
 * Коннектор для Claude: удалённый MCP-сервер со своим входом.
 *
 * Claude сам регистрируется, уводит человека на страницу входа, а подтверждает
 * человек в нашем боте — пароля у сервиса нет, личность знает Telegram.
 * Пока только чтение: итоги и список операций.
 */

const PUBLIC_URL = (process.env["PUBLIC_URL"] ?? "https://costnote.site").replace(/\/$/, "");
const RESOURCE = `${PUBLIC_URL}/mcp`;
const RESOURCE_METADATA = `${PUBLIC_URL}/.well-known/oauth-protected-resource`;
const SCOPES = ["read"];

/** Адрес возврата: https, или локальный для Claude Code — порт там каждый раз свой. */
function redirectAllowed(registered: string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) return false;
    return registered.some((r) => {
      const known = new URL(r);
      return known.hostname === url.hostname && known.pathname === url.pathname && known.protocol === "http:";
    });
  } catch {
    return false;
  }
}

function validRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function oauthError(reply: FastifyReply, code: number, error: string, description?: string) {
  return reply.code(code).header("Cache-Control", "no-store").send({ error, error_description: description });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function registerMcp(app: FastifyInstance, botUsername: string) {
  // Токен-эндпоинт по стандарту принимает форму, а не JSON.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const resourceMetadata = async () => ({
    resource: RESOURCE,
    authorization_servers: [PUBLIC_URL],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "CostNote",
  });
  app.get("/.well-known/oauth-protected-resource", resourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_URL}/oauth/token`,
    registration_endpoint: `${PUBLIC_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  }));

  app.post("/oauth/register", async (request, reply) => {
    const body = z
      .object({ redirect_uris: z.array(z.string()).min(1).max(10), client_name: z.string().optional() })
      .safeParse(request.body);
    if (!body.success || !body.data.redirect_uris.every(validRedirect)) {
      return oauthError(reply, 400, "invalid_redirect_uri");
    }

    const client = await registerClient(body.data.client_name ?? null, body.data.redirect_uris);
    return reply.code(201).send({
      client_id: client.id,
      client_name: client.name ?? undefined,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const client = q["client_id"] === undefined ? undefined : await clientById(q["client_id"]);
    const redirectUri = q["redirect_uri"] ?? "";

    // С неизвестным клиентом или чужим адресом возврата никуда не перенаправляем.
    if (client === undefined || !redirectAllowed(client.redirectUris, redirectUri)) {
      return reply.code(400).type("text/html").send(page("Ссылка для входа неверная. Начни подключение в Claude заново."));
    }

    const back = new URL(redirectUri);
    const fail = (error: string) => {
      back.searchParams.set("error", error);
      if (q["state"]) back.searchParams.set("state", q["state"]);
      return reply.redirect(back.toString());
    };

    if (q["response_type"] !== "code") return fail("unsupported_response_type");
    if (q["code_challenge_method"] !== "S256" || !q["code_challenge"]) return fail("invalid_request");

    const { id, confirmCode } = await createAuthRequest({
      clientId: client.id,
      redirectUri,
      state: q["state"] ?? null,
      codeChallenge: q["code_challenge"],
      scope: "read",
    });

    const link = `https://t.me/${botUsername}?start=mcp_${id}`;
    return reply
      .type("text/html")
      .header("Cache-Control", "no-store")
      .send(
        page(
          `<p><b>${escapeHtml(client.name ?? "Приложение")}</b> просит доступ к твоим тратам — только чтение.</p>
           <p class="dim">После подтверждения вернёмся на ${escapeHtml(back.host)}</p>
           <p style="margin:18px 0 4px">Открой бота и отправь ему этот код:</p>
           <div class="code">${confirmCode}</div>
           <a class="btn" href="${link}" target="_blank" rel="noopener">Открыть Telegram</a>
           <p class="dim" id="status">Жду подтверждения…</p>
           <script>
             const id = ${JSON.stringify(id)};
             async function poll() {
               try {
                 const r = await fetch("/oauth/poll?id=" + encodeURIComponent(id));
                 const data = await r.json();
                 if (data.redirect) { location.href = data.redirect; return; }
                 if (data.status === "denied" || data.status === "expired") {
                   document.getElementById("status").textContent = data.status === "denied" ? "Отклонено." : "Время вышло, начни заново.";
                   return;
                 }
               } catch {}
               setTimeout(poll, 2000);
             }
             poll();
           </script>`,
        ),
      );
  });

  app.get("/oauth/poll", async (request, reply) => {
    const id = (request.query as { id?: string }).id ?? "";
    const found = await liveAuthRequest(id);
    reply.header("Cache-Control", "no-store");

    if (found === undefined) return { status: "expired" };
    if (found.deniedAt !== null) return { status: "denied" };
    if (found.approvedAt === null) return { status: "pending" };

    const code = await issueCode(id);
    if (code === undefined) return { status: "expired" };

    const back = new URL(found.redirectUri);
    back.searchParams.set("code", code);
    if (found.state) back.searchParams.set("state", found.state);
    return { status: "approved", redirect: back.toString() };
  });

  app.post("/oauth/token", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, string | undefined>;

    if (body["grant_type"] === "authorization_code") {
      const found = body["code"] ? await consumeCode(body["code"]) : undefined;
      if (found === undefined || found.userId === null || found.approvedAt === null) {
        return oauthError(reply, 400, "invalid_grant");
      }
      if (body["client_id"] !== undefined && body["client_id"] !== found.clientId) {
        return oauthError(reply, 400, "invalid_grant");
      }
      if (body["redirect_uri"] !== undefined && body["redirect_uri"] !== found.redirectUri) {
        return oauthError(reply, 400, "invalid_grant");
      }

      const challenge = createHash("sha256").update(body["code_verifier"] ?? "").digest("base64url");
      if (challenge !== found.codeChallenge) return oauthError(reply, 400, "invalid_grant", "PKCE");

      const tokens = await issueTokens(found.userId, found.clientId, found.scope);
      return reply.header("Cache-Control", "no-store").send(tokenResponse(tokens));
    }

    if (body["grant_type"] === "refresh_token") {
      const tokens =
        body["refresh_token"] && body["client_id"]
          ? await rotateTokens(body["refresh_token"], body["client_id"])
          : undefined;
      if (tokens === undefined) return oauthError(reply, 400, "invalid_grant");
      return reply.header("Cache-Control", "no-store").send(tokenResponse(tokens));
    }

    return oauthError(reply, 400, "unsupported_grant_type");
  });

  app.post("/mcp", async (request, reply) => {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const owner = token === "" ? undefined : await tokenOwner(token);

    // Именно 401 с указателем на метаданные: по нему Claude находит вход.
    if (owner === undefined) {
      return reply
        .code(401)
        .header("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA}", scope="read"`)
        .send({ error: "invalid_token" });
    }

    const server = buildServer(owner.user);
    // Без генератора сессий транспорт работает без состояния: каждый запрос сам по себе.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as never);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // Без сессий: подписки по GET и закрытие сессии нам не нужны.
  const notAllowed = async (_req: unknown, reply: FastifyReply) =>
    reply.code(405).header("Allow", "POST").send({ error: "method not allowed" });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}

function tokenResponse(tokens: { access: string; refresh: string; scope: string }) {
  return {
    access_token: tokens.access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: tokens.refresh,
    scope: tokens.scope,
  };
}

function page(body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CostNote · подключение</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#0f1115;color:#e8e8ea;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;box-sizing:border-box}
main{max-width:380px;width:100%;background:#181b21;border-radius:18px;padding:28px}
h1{font-size:20px;margin:0 0 12px}.dim{color:#8b8f98;font-size:14px}
.code{font:700 40px/1 ui-monospace,monospace;letter-spacing:10px;text-align:center;margin:8px 0}
.btn{display:block;text-align:center;background:#2aabee;color:#fff;text-decoration:none;padding:14px;border-radius:12px;font-weight:600;margin:18px 0 8px}
</style></head><body><main><h1>CostNote</h1>${body}</main></body></html>`;
}

/** Инструменты, привязанные к одному человеку: чужих книг отсюда не видно. */
function buildServer(user: AppUser): McpServer {
  const server = new McpServer({ name: "costnote", version: "1.0.0" });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  async function resolveBook(bookId: number | undefined) {
    const books = await ledgersOf(user.id);
    const id = bookId ?? (await activeLedgerId(user));
    const book = books.find((b) => b.id === id);
    if (book === undefined) throw new Error("Такой книги у пользователя нет. Список — в инструменте books.");
    return book;
  }

  const bookTitle = (b: { title: string; kind: string }) => (b.kind === "personal" ? "Личное" : b.title);

  server.registerTool(
    "books",
    {
      title: "Книги",
      description: "Книги учёта пользователя (личная, общие, бизнес) и какая из них сейчас активна.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const books = await ledgersOf(user.id);
      const active = await activeLedgerId(user);
      const data = {
        currency: user.currency,
        timezone: user.timezone,
        today: localToday(user.timezone),
        books: books.map((b) => ({ id: b.id, title: bookTitle(b), kind: b.kind, active: b.id === active })),
      };
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );

  server.registerTool(
    "summary",
    {
      title: "Итоги",
      description:
        "Итоги за период: сумма расходов, доходов, разбивка по категориям и валютам, в основной валюте пользователя. " +
        "Период — пресет (day, week, month, year) или даты from/to (YYYY-MM-DD). По умолчанию активная книга и текущий месяц.",
      inputSchema: {
        period: z.enum(PERIOD_KEYS).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        book_id: z.number().int().optional(),
      },
      annotations: readOnly,
    },
    async ({ period, from, to, book_id }) => {
      const book = await resolveBook(book_id);
      const today = localToday(user.timezone);
      // Одна дата тоже диапазон: «с 1 августа» — до сегодня, «до 10 августа» —
      // с начала того месяца. Раньше одинокая дата молча превращалась в текущий месяц.
      const range =
        from !== undefined || to !== undefined
          ? {
              from: from ?? `${(to ?? today).slice(0, 7)}-01`,
              to: to ?? today,
              label: `${from ?? ""} — ${to ?? ""}`,
            }
          : buildPeriod((period ?? "month") as PeriodKey, today);
      if (range.from > range.to) throw new Error("from позже to");
      const rate = await rateToUsd(user.currency as Currency, today);

      const [categories, currencies, total, income] = await Promise.all([
        byCategory(book.id, range),
        byCurrency(book.id, range),
        totalUsd(book.id, range),
        incomeUsd(book.id, range),
      ]);

      const round = (n: number) => Math.round(n * 100) / 100;
      const data = {
        book: bookTitle(book),
        period: { from: range.from, to: range.to },
        currency: user.currency,
        expenses: round(total / rate),
        income: round(income / rate),
        byCategory: categories.map((c) => ({ category: c.title, total: round(c.totalUsd / rate) })),
        byCurrency: currencies.map((c) => ({ currency: c.currency, amount: round(c.amount), inBase: round(c.totalUsd / rate) })),
      };
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );

  server.registerTool(
    "list_expenses",
    {
      title: "Операции",
      description:
        "Список операций за даты: расходы, доходы и переносы между своими счетами. " +
        "По умолчанию последние 30 дней активной книги. amount — в валюте операции, base — в основной валюте пользователя за вычетом возвратов.",
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        kind: z.enum(["expense", "income", "transfer"]).optional(),
        book_id: z.number().int().optional(),
        all_books: z.boolean().optional().describe("Взять операции из всех книг сразу"),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: readOnly,
    },
    async ({ from, to, kind, book_id, all_books, limit }) => {
      const books = await ledgersOf(user.id);
      const ids = all_books === true ? books.map((b) => b.id) : [(await resolveBook(book_id)).id];
      const today = localToday(user.timezone);
      const start = from ?? shiftDay(today, -30);
      const end = to ?? today;
      const rate = await rateToUsd(user.currency as Currency, today);

      const rows = await db.query.expenses.findMany({
        where: and(
          inArray(schema.expenses.ledgerId, ids),
          gte(schema.expenses.spentAt, start),
          lte(schema.expenses.spentAt, end),
          isNull(schema.expenses.deletedAt),
          ...(kind === undefined ? [] : [eq(schema.expenses.kind, kind)]),
        ),
        orderBy: [desc(schema.expenses.spentAt), desc(schema.expenses.id)],
        limit: limit ?? 200,
      });

      const categories = new Map<number, string>();
      for (const id of ids) for (const c of await listCategories(id)) categories.set(c.id, c.title);
      const titles = new Map(books.map((b) => [b.id, bookTitle(b)]));

      const data = rows.map((e) => ({
        id: e.id,
        date: e.spentAt,
        kind: e.kind,
        amount: Number(e.amount),
        currency: e.currency,
        base: Math.round(((Number(e.amount) - Number(e.refundedAmount)) * Number(e.rateToUsd) * 100) / rate) / 100,
        merchant: e.merchant,
        category: e.categoryId === null ? null : (categories.get(e.categoryId) ?? null),
        incomeSource: e.incomeSource,
        ...(ids.length > 1 ? { book: titles.get(e.ledgerId) } : {}),
      }));
      return {
        content: [
          { type: "text", text: JSON.stringify({ from: start, to: end, currency: user.currency, count: data.length, operations: data }) },
        ],
      };
    },
  );

  return server;
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
