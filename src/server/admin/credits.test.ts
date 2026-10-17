import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const grantMeter = vi.fn();
const accountForWorkspace = vi.fn();
const recordAdminAudit = vi.fn();

vi.mock("@/server/billing/meters.server", () => ({ grantMeter: (a: unknown) => grantMeter(a) }));
vi.mock("@/server/billing/accounts.server", () => ({
  accountForWorkspace: (id: string) => accountForWorkspace(id),
}));
vi.mock("./audit.server", () => ({
  recordAdminAudit: (...args: unknown[]) => recordAdminAudit(...args),
}));

import { CREDIT_GRANT_LIMITS, grantGoodwill } from "./credits.server";

const actor = {
  actorId: "a0000000-0000-4000-8000-000000000001",
  actorRole: "finance",
  audit: { requestId: "r1", ip: null, userAgent: null },
};
const input = {
  workspaceId: "20000001-0000-4000-8000-000000000001",
  meter: "credits" as const,
  amount: 100,
  reason: "Make good for the failed carousel run",
  operationId: "b0000000-0000-4000-8000-000000000001",
};

beforeEach(() => {
  vi.clearAllMocks();
  accountForWorkspace.mockResolvedValue({ account: { id: "acct-1" } });
});

describe("grantGoodwill", () => {
  it("grants an AI-only adjustment keyed by the operation and audits it", async () => {
    grantMeter.mockResolvedValue({ ok: true });
    await expect(grantGoodwill(actor, input)).resolves.toEqual({ replayed: false });
    expect(grantMeter).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-1",
        source: "adjustment",
        restriction: "ai_only",
        idempotencyKey: `admin:${input.operationId}`,
      }),
    );
    expect(recordAdminAudit).toHaveBeenCalledTimes(1);
    expect(recordAdminAudit.mock.calls[0][0]).toMatchObject({ action: "credits.granted" });
  });

  it("does not audit a replay twice", async () => {
    grantMeter.mockResolvedValue({ ok: true, replayed: true });
    await expect(grantGoodwill(actor, input)).resolves.toEqual({ replayed: true });
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it("audits a failure and rethrows", async () => {
    grantMeter.mockRejectedValue(new Error("Billing balance is temporarily unavailable."));
    await expect(grantGoodwill(actor, input)).rejects.toThrow(/temporarily/);
    expect(recordAdminAudit.mock.calls[0][0]).toMatchObject({ success: false });
  });

  it("keeps the per-adjustment limits small", () => {
    expect(CREDIT_GRANT_LIMITS.credits).toBeLessThanOrEqual(2000);
    expect(CREDIT_GRANT_LIMITS.video).toBeLessThanOrEqual(1000);
  });
});
