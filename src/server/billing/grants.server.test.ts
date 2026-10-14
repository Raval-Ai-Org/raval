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

describe("signup credit eligibility", () => {
  it("bounds a stalled eligibility lookup and never issues a bonus from its late response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let respond!: (value: unknown) => void;
    mock.user.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const checking = ensureSignupGrant(account);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(checking).resolves.toBeUndefined();
    respond({ data: { user: { email_confirmed_at: "2026-10-14T01:00:00Z" } }, error: null });
    await Promise.resolve();
    expect(mock.grant).not.toHaveBeenCalled();
  });
  it("uses the account owner's trusted Auth record and retains the original allowance and key", async () => {
    await ensureSignupGrant(account);
    expect(mock.user).toHaveBeenCalledWith("owner-1");
    expect(mock.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        amount: SIGNUP_GRANT.credits,
        source: "signup",
        idempotencyKey: "signup:account-1",
      }),
    );
    expect(new Date(mock.grant.mock.calls[0][0].expiresAt).getTime()).toBe(
      new Date(account.created_at).getTime() + SIGNUP_GRANT.expiresInDays * 86_400_000,
    );
  });

  it.each([
    { is_anonymous: true, email_confirmed_at: "2026-10-14T01:00:00Z" },
    { email: "unverified@example.test", user_metadata: { email_verified: true } },
  ])("withholds promotional credits from anonymous or unverified accounts", async (user) => {
    mock.user.mockResolvedValue({ data: { user }, error: null });
    await ensureSignupGrant(account);
    expect(mock.grant).not.toHaveBeenCalled();
  });

  it("allows a previously unverified account after Auth confirms it", async () => {
    mock.user.mockResolvedValueOnce({ data: { user: {} }, error: null });
    await ensureSignupGrant(account);
    expect(mock.grant).not.toHaveBeenCalled();
    await ensureSignupGrant(account);
    expect(mock.grant).toHaveBeenCalledOnce();
  });

  it.each(["error", "throw", "missing"])(
    "withholds only the bonus on an Auth %s without breaking account loading",
    async (kind) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      if (kind === "throw") mock.user.mockRejectedValue(new Error("private service details"));
      else
        mock.user.mockResolvedValue({
          data: null,
          error: kind === "error" ? new Error("unavailable") : null,
        });
      await expect(ensureSignupGrant(account)).resolves.toBeUndefined();
      expect(mock.grant).not.toHaveBeenCalled();
    },
  );

  it("does not revive an expired signup allowance or query Auth for old accounts", async () => {
    await ensureSignupGrant({ ...account, created_at: "2025-01-01T00:00:00Z" });
    expect(mock.user).not.toHaveBeenCalled();
    expect(mock.grant).not.toHaveBeenCalled();
  });
});
