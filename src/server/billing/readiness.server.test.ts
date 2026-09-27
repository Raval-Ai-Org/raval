import { afterEach, describe, expect, it, vi } from "vitest";

const select = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());
const getEntitlements = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ select }) },
}));
vi.mock("./entitlements.server", () => ({ getEntitlements }));

import { optionalWorkspaceEntitlements } from "./readiness.server";

const previousEnforcement = process.env.BILLING_ENFORCEMENT;

afterEach(() => {
  vi.clearAllMocks();
  if (previousEnforcement === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = previousEnforcement;
});

describe("workspace billing rollout", () => {
  it("keeps legacy workspace actions available before the billing schema is installed", async () => {
    delete process.env.BILLING_ENFORCEMENT;
    select.mockReturnValue({ limit });
    limit.mockResolvedValue({ error: { code: "PGRST205" } });

    await expect(optionalWorkspaceEntitlements({ userId: "user" })).resolves.toBeNull();
    expect(getEntitlements).not.toHaveBeenCalled();
  });

  it("fails closed if billing enforcement is requested without its schema", async () => {
    process.env.BILLING_ENFORCEMENT = "on";
    select.mockReturnValue({ limit });
    limit.mockResolvedValue({ error: { code: "PGRST205" } });

    await expect(optionalWorkspaceEntitlements({ userId: "user" })).rejects.toMatchObject({
      status: 503,
    });
  });

  it("uses account limits when the schema is present", async () => {
    select.mockReturnValue({ limit });
    limit.mockResolvedValue({ error: null });
    getEntitlements.mockResolvedValue({ enforcement: "on" });

    await expect(optionalWorkspaceEntitlements({ userId: "user" })).resolves.toEqual({
      enforcement: "on",
    });
    expect(getEntitlements).toHaveBeenCalledWith({ userId: "user" });
  });
});
