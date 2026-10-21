// getEntitlements with staff overrides: the real resolver, a faked database.
// Pins the promise that matters most: with no override in force (or the flag
// off, or the table missing) a customer gets exactly what their plan says.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  overrides: { data: [] as unknown[], error: null as null | { code: string } },
}));

vi.mock("@/integrations/supabase/client.server", () => {
  // Any chain of .select().eq()... resolves to the configured result for the table.
  const chain = (result: unknown): unknown =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
        return () => chain(result);
      },
    });
  return {
    supabaseAdmin: {
      from: (table: string) =>
        chain(
          table === "entitlement_overrides" ? state.overrides : { data: [], error: null, count: 0 },
        ),
      rpc: () => chain({ data: [], error: null }),
    },
  };
});
vi.mock("./schema.server", () => ({ billingSchemaReady: async () => true }));
vi.mock("./seat-count.server", () => ({ accountBillableSeatCount: async () => 1 }));
vi.mock("./accounts.server", () => {
  const account = {
    id: "acct-1",
    owner_user_id: "owner-1",
    plan_id: "free",
    entitled_plan_id: "free",
    billing_interval: null,
    status: "free",
    trial_ends_at: null,
    trial_used: false,
    current_period_start: null,
    current_period_end: null,
    grant_anchor: null,
    next_grant_at: null,
    grace_until: null,
    comped_plan_id: null,
    comped_until: null,
    enforcement_override: "off",
    pro_overage_mode: "credits",
    created_at: "2026-01-01T00:00:00Z",
  };
  return {
    accountForWorkspace: async () => ({ account, frozenAt: null }),
    accountForUser: async () => account,
    invalidateBillingAccount: () => undefined,
  };
});

import { FEATURES, PLANS } from "@/lib/billing/catalog";
import { getEntitlements } from "./entitlements.server";

const WS = "22222222-2222-4222-8222-222222222222";
const OTHER_WS = "33333333-3333-4333-8333-333333333333";

function override(patch: Record<string, unknown>) {
  return {
    id: `o-${Math.random().toString(16).slice(2)}`,
    account_id: "acct-1",
    workspace_id: null,
    kind: "feature",
    key: "ugc",
    allowed: true,
    limit_value: null,
    starts_at: "2026-01-02T00:00:00Z",
    expires_at: null,
    revoked_at: null,
    created_at: "2026-01-03T00:00:00Z",
    ...patch,
  };
}

const ask = (workspaceId = WS) =>
  getEntitlements({ userId: "owner-1", workspaceId, role: "owner" });

beforeEach(() => {
  state.overrides = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getEntitlements with overrides", () => {
  it("gives exactly the plan when there are none", async () => {
    const result = await ask();
    expect(result.features.ugc.allowed).toBe(false);
    expect(result.limits.trackedPrompts).toBe(PLANS.free.limits.trackedPrompts);
    expect(result.overrides).toBeUndefined();
  });

  it("opens a feature the plan lacks, and says so", async () => {
    state.overrides = { data: [override({ key: "ugc", allowed: true })], error: null };
    const result = await ask();
    expect(result.features.ugc.allowed).toBe(true);
    // The override changes what is allowed, never what the plan says it takes.
    expect(result.features.ugc.requiredPlan).toBe(FEATURES.ugc.minPlan);
    expect(result.overrides).toEqual([
      expect.objectContaining({ kind: "feature", key: "ugc", scope: "account", allowed: true }),
    ]);
  });

  it("changes a limit", async () => {
    state.overrides = {
      data: [override({ kind: "limit", key: "trackedPrompts", allowed: null, limit_value: 777 })],
      error: null,
    };
    const result = await ask();
    expect(result.limits.trackedPrompts).toBe(777);
    expect(result.limits.competitors).toBe(PLANS.free.limits.competitors);
  });

  it("applies a workspace override to that workspace only", async () => {
    state.overrides = { data: [override({ key: "ugc", workspace_id: WS })], error: null };
    expect((await ask(WS)).features.ugc.allowed).toBe(true);
    expect((await ask(OTHER_WS)).features.ugc.allowed).toBe(false);
  });

  it("ignores an override that has ended or been revoked", async () => {
    state.overrides = {
      data: [
        override({ key: "ugc", expires_at: "2026-02-01T00:00:00Z" }),
        override({ key: "autopilot", revoked_at: "2026-01-05T00:00:00Z" }),
      ],
      error: null,
    };
    const result = await ask();
    expect(result.features.ugc.allowed).toBe(false);
    expect(result.features.autopilot.allowed).toBe(false);
    expect(result.overrides).toBeUndefined();
  });

  it("falls back to the plan when the flag is off", async () => {
    vi.stubEnv("FEATURE_FLAG_ENTITLEMENT_OVERRIDES_ENABLED", "false");
    state.overrides = { data: [override({ key: "ugc" })], error: null };
    const result = await ask();
    expect(result.features.ugc.allowed).toBe(false);
    expect(result.overrides).toBeUndefined();
  });

  it("falls back to the plan when the table is missing or the read fails", async () => {
    state.overrides = { data: [], error: { code: "42P01" } };
    expect((await ask()).features.ugc.allowed).toBe(false);
    state.overrides = { data: [], error: { code: "XX000" } };
    expect((await ask()).features.ugc.allowed).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("never lets an override reach brands or seats", async () => {
    state.overrides = {
      data: [
        override({ kind: "limit", key: "brands", allowed: null, limit_value: 99 }),
        override({ kind: "limit", key: "seats", allowed: null, limit_value: 99 }),
      ],
      error: null,
    };
    const result = await ask();
    expect(result.limits.brands).toBe(PLANS.free.brands);
    expect(result.limits.seats).toBe(PLANS.free.seats);
  });
});
