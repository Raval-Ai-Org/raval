import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), grant: vi.fn(), rollover: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("./meters.server", () => ({
  grantMeter: mocks.grant,
  rolloverMeter: mocks.rollover,
  clawbackMeter: vi.fn(),
}));
vi.mock("./creation.server", () => ({ creationPolicyFor: vi.fn().mockResolvedValue(true) }));
vi.mock("./accounts.server", () => ({ invalidateBillingAccount: vi.fn() }));
vi.mock("./entitlements.server", () => ({ entitledPlanFor: vi.fn() }));
import { grantPlanWindow, grantPlanUpgrade } from "./grants.server";
import type { BillingAccount } from "./accounts.server";
const account = { id: "account", current_period_start: "2026-10-01T00:00:00Z" } as BillingAccount;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: "creation_v3", error: null });
  mocks.grant.mockResolvedValue({ ok: true });
});
it("issues a protected 200-point allowance and 500 flex credits with distinct versioned keys", async () => {
  await grantPlanWindow({
    account,
    plan: "starter",
    windowStart: "2026-11-01T00:00:00Z",
    expiresAt: "2026-12-01T00:00:00Z",
  });
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({
      meter: "creation",
      amount: 200,
      idempotencyKey: "creation_v3:account:starter:creation:2026-11-01T00:00:00Z",
    }),
  );
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({ meter: "credits", amount: 500 }),
  );
  expect(mocks.grant).not.toHaveBeenCalledWith(
    expect.objectContaining({ meter: "credits", amount: 2000 }),
  );
});
it("leaves Free monthly chat grants on their existing path", async () => {
  await grantPlanWindow({
    account,
    plan: "free",
    windowStart: "2026-11-01T00:00:00Z",
    expiresAt: "2026-12-01T00:00:00Z",
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({ meter: "flash_messages", amount: 30 }),
  );
  expect(mocks.grant).not.toHaveBeenCalledWith(expect.objectContaining({ meter: "creation" }));
});
it("replays an old grant window with its original credit amount and original keys", async () => {
  mocks.rpc.mockResolvedValue({ data: "legacy", error: null });
  await grantPlanWindow({
    account,
    plan: "starter",
    windowStart: "2026-10-01T00:00:00Z",
    expiresAt: "2026-11-01T00:00:00Z",
  });
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({
      meter: "credits",
      amount: 2000,
      idempotencyKey: "plan:account:starter:credits:2026-10-01T00:00:00Z",
    }),
  );
  expect(mocks.grant).not.toHaveBeenCalledWith(expect.objectContaining({ meter: "creation" }));
});
it("prorates the creation-point upgrade rather than issuing a second full allowance", async () => {
  await grantPlanUpgrade({
    account,
    from: "starter",
    to: "growth",
    paymentId: "invoice",
    expiresAt: "2026-11-01T00:00:00Z",
    now: new Date("2026-10-16T12:00:00Z"),
  });
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({
      meter: "creation",
      amount: 200,
      idempotencyKey: "upgrade:invoice:creation",
    }),
  );
  expect(mocks.grant).toHaveBeenCalledWith(
    expect.objectContaining({ meter: "credits", amount: 500 }),
  );
});
