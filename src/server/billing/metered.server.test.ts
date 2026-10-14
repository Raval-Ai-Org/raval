import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  entitlements: vi.fn(),
  hold: vi.fn(),
  capture: vi.fn(),
  release: vi.fn(),
  insert: vi.fn(),
  heldRecord: vi.fn(),
}));

vi.mock("./entitlements.server", () => ({ getEntitlements: mocked.entitlements }));
vi.mock("./meters.server", () => ({
  holdMeter: mocked.hold,
  captureMeter: mocked.capture,
  releaseMeter: mocked.release,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: mocked.insert,
      select: () => ({ eq: () => ({ single: mocked.heldRecord }) }),
    }),
  },
}));

import { beginDeferredMetered, runMetered } from "./metered.server";
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
  mocked.heldRecord.mockResolvedValue({
    data: { amount: 12, action: "post_set", user_id: "user-1", workspace_id: "workspace-1" },
    error: null,
  });
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

  it("never runs a second provider call for an already held action", async () => {
    mocked.entitlements.mockResolvedValue(entitlements("on"));
    mocked.hold.mockResolvedValue({ ok: true, replayed: true, state: "held", id: "hold-1" });
    const run = vi.fn(async () => "duplicate");
    await expect(runMetered(args, run)).rejects.toMatchObject({ status: 409 });
    expect(run).not.toHaveBeenCalled();
    expect(mocked.capture).not.toHaveBeenCalled();
    expect(mocked.release).not.toHaveBeenCalled();
  });

  it.each(["on", "off", "shadow"] as const)(
    "refuses viewer spending in %s mode before a hold",
    async (mode) => {
      mocked.entitlements.mockResolvedValue(entitlements(mode, { role: "viewer" }));
      await expect(runMetered(args, async () => "should not run")).rejects.toMatchObject({
        code: "spend_not_allowed",
      } satisfies Partial<BillingError>);
      expect(mocked.hold).not.toHaveBeenCalled();
    },
  );

  it("rejects a quantity that overflows the calculated price before provider work", async () => {
    const run = vi.fn();
    await expect(
      runMetered({ ...args, quantity: Number.MAX_SAFE_INTEGER }, run),
    ).rejects.toMatchObject({ status: 400 });
    expect(run).not.toHaveBeenCalled();
    expect(mocked.hold).not.toHaveBeenCalled();
  });
});

describe("deferred stream charges", () => {
  const streamArgs = {
    workspaceId: "workspace-1",
    userId: "user-1",
    role: "editor" as const,
    actionName: "flash_message_included",
    meter: "flash_messages" as const,
    amount: 1,
    idempotencyKey: "chat-click-1",
    route: "chat",
  };

  it.each(["off", "shadow"] as const)(
    "refuses a viewer's streamed spending in %s mode",
    async (mode) => {
      mocked.entitlements.mockResolvedValue(entitlements(mode, { role: "viewer" }));
      await expect(beginDeferredMetered(streamArgs)).rejects.toMatchObject({
        code: "spend_not_allowed",
      });
      expect(mocked.hold).not.toHaveBeenCalled();
    },
  );

  it("serializes capture and client cancellation so a completed answer is never released", async () => {
    mocked.entitlements.mockResolvedValue(
      entitlements("on", { meters: { flash_messages: { available: 10 } } }),
    );
    let finish!: () => void;
    mocked.capture.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const charge = await beginDeferredMetered(streamArgs);
    const capturing = charge.capture();
    const cancelling = charge.release();
    const duplicate = charge.capture();
    expect(mocked.capture).toHaveBeenCalledOnce();
    expect(mocked.release).not.toHaveBeenCalled();
    finish();
    await Promise.all([capturing, cancelling, duplicate]);
    expect(mocked.release).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous capture for reconciliation and permits a capture retry", async () => {
    mocked.entitlements.mockResolvedValue(
      entitlements("on", { meters: { flash_messages: { available: 10 } } }),
    );
    mocked.capture.mockRejectedValueOnce(new Error("response lost"));
    const charge = await beginDeferredMetered(streamArgs);
    await expect(charge.capture()).rejects.toThrow("response lost");
    await charge.release();
    expect(mocked.release).not.toHaveBeenCalled();
    await charge.capture();
    expect(mocked.capture).toHaveBeenCalledTimes(2);
    expect(mocked.capture.mock.calls[0]).toEqual(mocked.capture.mock.calls[1]);
  });

  it("reserves before streaming and captures only after completion", async () => {
    mocked.entitlements.mockResolvedValue(
      entitlements("on", {
        meters: { flash_messages: { available: 10 } },
      }),
    );
    const charge = await beginDeferredMetered(streamArgs);
    expect(mocked.hold).toHaveBeenCalledOnce();
    expect(mocked.capture).not.toHaveBeenCalled();
    await charge.capture();
    expect(mocked.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: "hold-1",
        amount: 1,
        route: "chat",
      }),
    );
    expect(mocked.release).not.toHaveBeenCalled();
  });

  it("releases an abandoned stream and refuses duplicate execution", async () => {
    mocked.entitlements.mockResolvedValue(
      entitlements("on", {
        meters: { flash_messages: { available: 10 } },
      }),
    );
    const charge = await beginDeferredMetered(streamArgs);
    await charge.release();
    expect(mocked.release).toHaveBeenCalledWith(expect.objectContaining({ holdId: "hold-1" }));
    expect(mocked.capture).not.toHaveBeenCalled();
    mocked.hold.mockResolvedValue({ ok: true, replayed: true, state: "held", id: "hold-1" });
    await expect(beginDeferredMetered(streamArgs)).rejects.toMatchObject({ status: 409 });
  });
});
