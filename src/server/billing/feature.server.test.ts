import { beforeEach, describe, expect, it, vi } from "vitest";

const getEntitlements = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("./entitlements.server", () => ({ getEntitlements }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert }) },
}));

import { requireBillingFeature } from "./feature.server";

const args = {
  workspaceId: "workspace-1",
  userId: "user-1",
  role: "editor" as const,
  feature: "market_brain" as const,
  spending: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getEntitlements.mockResolvedValue({
    accountId: "account-1",
    enforcement: "on",
    entitledPlan: "free",
    role: "editor",
    frozen: false,
    features: { market_brain: { allowed: false, requiredPlan: "growth" } },
  });
});

describe("included billing feature check", () => {
  it("returns a structured upgrade error when locked", async () => {
    await expect(requireBillingFeature(args)).rejects.toMatchObject({ code: "upgrade_required" });
  });

  it("records a would-block in shadow without denying access", async () => {
    getEntitlements.mockResolvedValueOnce({
      accountId: "account-1",
      enforcement: "shadow",
      entitledPlan: "free",
      role: "editor",
      frozen: false,
      features: { market_brain: { allowed: false, requiredPlan: "growth" } },
    });
    await requireBillingFeature(args);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "account-1",
        action: "feature:market_brain",
        decision: "upgrade_required",
      }),
    );
  });

  it("blocks a frozen brand even when the feature is allowed", async () => {
    getEntitlements.mockResolvedValueOnce({
      accountId: "account-1",
      enforcement: "on",
      entitledPlan: "growth",
      role: "editor",
      frozen: true,
      features: { market_brain: { allowed: true, requiredPlan: "growth" } },
    });
    await expect(requireBillingFeature(args)).rejects.toMatchObject({ code: "brand_frozen" });
  });
});
