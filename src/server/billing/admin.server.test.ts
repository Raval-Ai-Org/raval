import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from },
}));

import { hasBillingAdminAccess } from "./admin.server";

const USER = "11111111-1111-4111-8111-111111111111";

function adminRow(data: { role: string; status: string } | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  from.mockReturnValue({ select });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BILLING_ADMIN_USER_IDS;
  delete process.env.MELLOX_ADMIN_USER_IDS;
  adminRow(null);
});

describe("billing administrator access", () => {
  it("keeps the environment allowlist as break-glass access", async () => {
    process.env.BILLING_ADMIN_USER_IDS = USER;
    await expect(hasBillingAdminAccess(USER)).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("allows an active super admin from the admin team", async () => {
    adminRow({ role: "super_admin", status: "active" });
    await expect(hasBillingAdminAccess(USER)).resolves.toBe(true);
  });

  it("fails closed for disabled or narrower admin roles", async () => {
    adminRow({ role: "super_admin", status: "disabled" });
    await expect(hasBillingAdminAccess(USER)).resolves.toBe(false);

    adminRow({ role: "finance", status: "active" });
    await expect(hasBillingAdminAccess(USER)).resolves.toBe(false);
  });
});
