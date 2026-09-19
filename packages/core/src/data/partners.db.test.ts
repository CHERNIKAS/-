import { describe, expect, it } from "vitest";
import { createSharedLedger, ensureUser, joinLedger, partnerNotice } from "./index.js";

describe("уведомление партнёру по общей книге", () => {
  it("с суммами, валютой и названиями, только другим участникам", async () => {
    const { user } = await ensureUser({ id: 8201, first_name: "Ника" });
    const partner = await ensureUser({ id: 8202 });
    const shared = await createSharedLedger(user, "Общий бюджет");
    await joinLedger(shared.id, partner.user.id);

    const notice = await partnerNotice(user, shared.id, [
      { kind: "expense", amount: 100, currency: "TRY", title: "бумажки для самокруток" },
      { kind: "income", amount: 500, currency: "USD", title: "зарплата" },
      { kind: "expense", amount: 23, currency: "USD", title: "H&M" },
    ]);

    expect(notice?.recipients).toEqual([String(partner.user.tgId)]);
    expect(notice?.text).toContain("<b>Ника</b> · <i>Общий бюджет</i>");
    expect(notice?.text).toContain("−₺100</code> · бумажки для самокруток");
    expect(notice?.text).toContain("+$500</code> · зарплата");
    expect(notice?.text).toContain("H&amp;M");
  });

  it("в личной книге уведомления нет", async () => {
    const { user, ledgerId } = await ensureUser({ id: 8203 });
    expect(await partnerNotice(user, ledgerId, [{ kind: "expense", amount: 1, currency: "USD", title: "x" }])).toBeNull();
  });
});
