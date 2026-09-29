import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (column: string) => ({ limit: () => mocked.limit(table, column) }),
    }),
  },
}));

import { billingSchemaReady, ugcBillingColumnReady } from "./schema.server";

beforeEach(() => vi.clearAllMocks());

describe("billing schema probes", () => {
  it("detects an absent account table with a real row query", async () => {
    mocked.limit.mockResolvedValue({ error: { code: "PGRST205" } });
    await expect(billingSchemaReady()).resolves.toBe(false);
    expect(mocked.limit).toHaveBeenCalledWith("billing_accounts", "id");
  });

  it("detects the UGC worker column independently of the account table", async () => {
    mocked.limit
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: "42703" } });
    await expect(ugcBillingColumnReady()).resolves.toBe(false);
    expect(mocked.limit).toHaveBeenCalledWith("ugc_renders", "billing_ready");
  });

  it("does not treat database failures as missing migrations", async () => {
    mocked.limit.mockResolvedValue({ error: { code: "08006" } });
    await expect(billingSchemaReady()).rejects.toMatchObject({ status: 503 });
  });
});
