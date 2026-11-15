import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ user: vi.fn(), grant: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { auth: { admin: { getUserById: mock.user } } },
}));
vi.mock("./meters.server", () => ({ grantMeter: mock.grant }));
vi.mock("./accounts.server", () => ({ invalidateBillingAccount: vi.fn() }));
vi.mock("./entitlements.server", () => ({ entitledPlanFor: vi.fn() }));

import { ensureSignupGrant } from "./grants.server";
import { SIGNUP_GRANT } from "@/lib/billing/catalog";
import type { BillingAccount } from "./accounts.server";

const account = {
  id: "account-1",
  owner_user_id: "owner-1",
  created_at: "2026-10-14T00:00:00Z",
} as BillingAccount;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-14T12:00:00Z");
  mock.user.mockResolvedValue({
    data: { user: { email_confirmed_at: "2026-10-14T01:00:00Z" } },
    error: null,
  });
  mock.grant.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("no signup credits (pricing v4)", () => {
  it("issues nothing at signup and never asks Auth", async () => {
    expect(SIGNUP_GRANT.credits).toBe(0);
    await expect(ensureSignupGrant(account)).resolves.toBeUndefined();
    expect(mock.user).not.toHaveBeenCalled();
    expect(mock.grant).not.toHaveBeenCalled();
  });
});
