import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
}));
vi.mock("./db.server", () => ({
  adminDb: {
    from: (table: string) => {
      const result = { data: mocks.rows[table] ?? [], error: null };
      const chain = {
        select: () => chain,
        gte: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  },
}));
vi.mock("./audit-read.server", async (original) => ({
  ...(await original<typeof import("./audit-read.server")>()),
  emailsFor: async () =>
    new Map([
      ["paid-owner", "paid@example.com"],
      ["free-owner", "free@example.com"],
    ]),
}));

import { getOverviewActivity } from "./activity.server";

describe("purchase activity identity", () => {
  beforeEach(() => {
    mocks.rows = {
      profiles: [
        { id: "paid-owner", name: "Zain Ali", created_at: "2026-10-27T10:00:00Z" },
        { id: "free-owner", name: "Zain Ali", created_at: "2026-10-27T10:00:00Z" },
      ],
      billing_accounts: [{ id: "paid-account", owner_user_id: "paid-owner" }],
      billing_payment_records: [
        {
          account_id: "paid-account",
          amount_cents: 4900,
          refunded_cents: 0,
          catalog_key: "starter",
          created_at: "2026-10-27T11:00:00Z",
          kind: "subscription",
          provider_payment_id: "payment-1",
        },
      ],
    };
  });

  it("identifies the actual billing owner even when two users share a name", async () => {
    const activity = await getOverviewActivity(true, new Date("2026-10-27T12:00:00Z"));
    const purchase = activity.items.find((item) => item.kind === "subscription")!;
    expect(purchase.title).toContain("Zain Ali");
    expect(purchase.detail).toContain("paid@example.com");
    expect(purchase.detail).not.toContain("free@example.com");
    expect(purchase.href).toBe("/admin/billing?account=paid-account");
    expect(purchase.amountUsd).toBe(49);
  });

  it("keeps the purchaser email masked without PII permission", async () => {
    const activity = await getOverviewActivity(false, new Date("2026-10-27T12:00:00Z"));
    const purchase = activity.items.find((item) => item.kind === "subscription")!;
    expect(purchase.detail).not.toContain("paid@example.com");
    expect(purchase.title).not.toContain("Zain Ali");
  });
});
