import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc },
}));

import { holdMeter } from "./meters.server";

const hold = {
  accountId: "account-1",
  workspaceId: "workspace-1",
  meter: "credits" as const,
  amount: 12,
  action: "ideas",
  idempotencyKey: "request-1",
};

beforeEach(() => rpc.mockReset());

describe("holdMeter billing decisions", () => {
  it("returns a structured upgrade prompt for the brand spending cap", async () => {
    rpc.mockResolvedValue({
      data: { ok: false, code: "brand_cap", used: 95, max: 100 },
      error: null,
    });
    await expect(holdMeter(hold)).rejects.toMatchObject({
      status: 402,
      code: "limit_reached",
      details: { limit: "monthly_brand_credits", used: 95, max: 100 },
    });
  });

  it("keeps insufficient credits distinct from the brand cap", async () => {
    rpc.mockResolvedValue({
      data: { ok: false, code: "insufficient_balance", available: 4 },
      error: null,
    });
    await expect(holdMeter(hold)).rejects.toMatchObject({
      status: 402,
      code: "insufficient_balance",
      details: { meter: "credits", needed: 12, available: 4 },
    });
  });
});
