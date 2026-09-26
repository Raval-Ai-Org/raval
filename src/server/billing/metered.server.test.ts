import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  entitlements: vi.fn(),
  hold: vi.fn(),
  capture: vi.fn(),
  release: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("./entitlements.server", () => ({ getEntitlements: mocked.entitlements }));
vi.mock("./meters.server", () => ({
  holdMeter: mocked.hold,
  captureMeter: mocked.capture,
  releaseMeter: mocked.release,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: mocked.insert }) },
}));

import { runMetered } from "./metered.server";
import { BillingError } from "./errors";

function entitlements(mode: "off" | "shadow" | "on", patch: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    role: "editor",
    frozen: false,
    enforcement: mode,
    entitledPlan: "growth",
    features: { studio: { allowed: true, requiredPlan: "free" } },
    meters: { credits: { available: 1000 } },
    ...patch,
  };
}

const args = {
  workspaceId: "workspace-1",
  userId: "user-1",
  role: "editor" as const,
  action: "post_set" as const,
  idempotencyKey: "click-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.insert.mockResolvedValue({ error: null });
  mocked.hold.mockResolvedValue({ ok: true, id: "hold-1", available: 988 });
  mocked.capture.mockResolvedValue({ ok: true, available: 988, charge_id: "charge-1" });
  mocked.release.mockResolvedValue({ ok: true, available: 1000 });
});

describe("runMetered", () => {
  it("keeps legacy mode uncharged", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("off"));
    const result = await runMetered(args, async () => "done");
    expect(result).toEqual({ result: "done", balance: null, chargeId: null });
    expect(mocked.hold).not.toHaveBeenCalled();
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("logs a Studio would-charge after success in shadow mode", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("shadow"));
    await runMetered(args, async () => "created");
    expect(mocked.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "post_set",
        meter: "credits",
        amount: 12,
        decision: "would_charge",
      }),
    );
    expect(mocked.hold).not.toHaveBeenCalled();
  });

  it("does not log a would-charge for failed work", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("shadow"));
    await expect(
      runMetered(args, async () => {
        throw new Error("provider failed");
      }),
    ).rejects.toThrow("provider failed");
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("holds, runs and captures only completed work in on mode", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("on"));
    const result = await runMetered(args, async (charge) => {
      charge.setCapturedAmount(5);
      return "partial";
    });
    expect(result.result).toBe("partial");
    expect(mocked.hold).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12, accountId: "account-1" }),
    );
    expect(mocked.capture).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5, holdId: "hold-1" }),
    );
  });

  it("releases a hold after failure", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("on"));
    await expect(
      runMetered(args, async () => {
        throw new Error("provider failed");
      }),
    ).rejects.toThrow("provider failed");
    expect(mocked.release).toHaveBeenCalledWith(expect.objectContaining({ holdId: "hold-1" }));
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it("refuses viewer spending before a hold", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("on", { role: "viewer" }));
    await expect(runMetered(args, async () => "should not run")).rejects.toMatchObject({
      code: "spend_not_allowed",
    } satisfies Partial<BillingError>);
    expect(mocked.hold).not.toHaveBeenCalled();
  });
});
