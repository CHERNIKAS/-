import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExpense, ensureUser, expenseById } from "@costnote/core/data";
import { telegram } from "./setup.js";

const { app } = await import("../src/index.js");

const TOKEN = process.env["BOT_TOKEN"] as string;
const TG_ID = 7101;

function initData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: TG_ID }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

const call = async (method: "GET" | "POST" | "PATCH", url: string, payload?: object) => {
  const r = await app.inject({ method, url, headers: { "x-init-data": initData() }, ...(payload ? { payload } : {}) });
  return { status: r.statusCode, json: r.json() as any };
};

const base = { categoryId: null, currency: "USD" as const, rateToUsd: 1, spentAt: "2026-09-10", confidence: null, needsReview: false };

describe("разбор «доход или свои деньги»", () => {
  it("решение «перевод» сохраняет направление", async () => {
    const { user, ledgerId } = await ensureUser({ id: TG_ID });
    const incoming = await createExpense({ ...base, ledgerId, userId: user.id, amount: 100, merchant: "0xin", kind: "income", needsKindReview: true });
    const outgoing = await createExpense({ ...base, ledgerId, userId: user.id, amount: 50, merchant: "0xout", kind: "transfer", incomeSource: "Отправка", needsKindReview: true });

    const r = await call("PATCH", "/api/review", {
      decisions: [
        { id: incoming.id, kind: "transfer" },
        { id: outgoing.id, kind: "transfer" },
      ],
    });

    expect(r.status).toBe(200);
    expect((await expenseById(incoming.id))?.incomeSource).toBe("Приход");
    expect((await expenseById(outgoing.id))?.incomeSource).toBe("Отправка");
  });
});

describe("история и экспорт", () => {
  it("период целиком, без обрезки на сотне", async () => {
    const { user, ledgerId } = await ensureUser({ id: TG_ID });
    for (let i = 0; i < 130; i++) {
      await createExpense({ ...base, ledgerId, userId: user.id, amount: 1, merchant: `мелочь ${i}`, spentAt: "2026-08-15" });
    }

    const r = await call("GET", "/api/expenses?from=2026-08-01&to=2026-08-31");
    expect(r.json.expenses.length).toBe(130);
  });

  it("в выгрузке есть вид операции и вычтены возвраты", async () => {
    const { user, ledgerId } = await ensureUser({ id: TG_ID });
    await createExpense({ ...base, ledgerId, userId: user.id, amount: 300, merchant: "зарплата", spentAt: "2026-07-01", kind: "income" });

    const r = await call("POST", "/api/export", { from: "2026-07-01", to: "2026-07-31" });
    expect(r.status).toBe(200);

    const sent = telegram.filter((m) => m.method === "sendDocument").pop();
    const file = (sent?.body as FormData).get("document") as Blob;
    const text = await file.text();

    expect(text.split("\r\n")[0]).toContain("вид");
    expect(text).toContain(";доход;300,00;");
  });

  it("неверная дата в балансе — 400", async () => {
    const r = await call("POST", "/api/balance", { place: "нал", amount: 5, currency: "USD", happenedAt: "2026-02-30" });
    expect(r.status).toBe(400);
  });
});
