import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ earlier: vi.fn(), grant: vi.fn(), rollover: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => {
  // meter_grants lookup for a window already granted under older terms.
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    limit: () => mocks.earlier(),
  };
  return { supabaseAdmin: { from: () => chain, rpc: vi.fn() } };
});
vi.mock("./meters.server", () => ({
  grantMeter: mocks.grant,
  rolloverMeter: mocks.rollover,
  clawbackMeter: vi.fn(),
}));
vi.mock("./accounts.server", () => ({ invalidateBillingAccount: vi.fn() }));
vi.mock("./entitlements.server", () => ({ entitledPlanFor: vi.fn() }));
import { PLANS, UNITS_PER_CREDIT } from "@/lib/billing/catalog";
import { CREDITS_POLICY, grantPlanUpgrade, grantPlanWindow } from "./grants.server";
import type { BillingAccount } from "./accounts.server";

const account = { id: "account", current_period_start: "2026-10-01T00:00:00Z" } as BillingAccount;
const window = { windowStart: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.earlier.mockResolvedValue({ data: [], error: null });
  mocks.grant.mockResolvedValue({ ok: true });
  mocks.rollover.mockResolvedValue({ ok: true });
});

it("grants Starter's 150 credits and 50 Pro messages under versioned keys", async () => {
  await grantPlanWindow({ account, plan: "starter", ...window });
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({
      meter: "credits",
      amount: 150 * UNITS_PER_CREDIT,
      idempotencyKey: `${CREDITS_POLICY}:account:starter:credits:2026-11-01T00:00:00Z`,
    }),
  );
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({ meter: "pro_messages", amount: 50 }),
  );
  // No more creation points or free videos.
  for (const meter of ["creation", "video", "premium_video"])
    expect(mocks.grant).not.toHaveBeenCalledWith(expect.objectContaining({ meter }));
});

it("rolls unused credits over a month, capped at one month's credits", async () => {
  await grantPlanWindow({ account, plan: "growth", ...window });
  expect(mocks.rollover).toHaveBeenCalledWith(
    expect.objectContaining({ meter: "credits", cap: PLANS.growth.allowances.credits }),
  );
});

it("grants nothing without a plan", async () => {
  await expect(grantPlanWindow({ account, plan: "free", ...window })).resolves.toBe(0);
  expect(mocks.grant).not.toHaveBeenCalled();
});

it("never grants a window twice when it was already granted under older terms", async () => {
  mocks.earlier.mockResolvedValue({ data: [{ id: "old-grant" }], error: null });
  await expect(grantPlanWindow({ account, plan: "starter", ...window })).resolves.toBe(0);
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.rollover).not.toHaveBeenCalled();
});

it("refuses to grant when it cannot check earlier grants", async () => {
  mocks.earlier.mockResolvedValue({ data: null, error: { message: "down" } });
  await expect(grantPlanWindow({ account, plan: "starter", ...window })).rejects.toThrow();
  expect(mocks.grant).not.toHaveBeenCalled();
});

it("prorates an upgrade's extra credits rather than issuing a second full allowance", async () => {
  await grantPlanUpgrade({
    account,
    from: "starter",
    to: "growth",
    paymentId: "invoice",
    expiresAt: "2026-11-01T00:00:00Z",
    now: new Date("2026-10-16T12:00:00Z"),
  });
  const extra = PLANS.growth.allowances.credits - PLANS.starter.allowances.credits;
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({
      meter: "credits",
      amount: Math.ceil(extra / 2),
      idempotencyKey: "upgrade:invoice:credits",
    }),
  );
});
