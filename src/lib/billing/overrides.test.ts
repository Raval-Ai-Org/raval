import { describe, expect, it } from "vitest";
import { PLANS } from "./catalog";
import {
  MAX_OVERRIDE_LIMIT,
  OVERRIDE_LIMIT_KEYS,
  applyOverrides,
  isActiveOverride,
  isValidOverrideTarget,
  overridableFeatures,
  type OverrideRow,
} from "./overrides";

const NOW = new Date("2026-10-18T12:00:00Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const WS_A = "22222222-2222-4222-8222-222222222222";
const WS_B = "33333333-3333-4333-8333-333333333333";

let seq = 0;
function row(patch: Partial<OverrideRow>): OverrideRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    account_id: ACCOUNT,
    workspace_id: null,
    kind: "feature",
    key: "ugc",
    allowed: true,
    limit_value: null,
    starts_at: "2026-10-01T00:00:00Z",
    expires_at: null,
    revoked_at: null,
    created_at: `2026-10-0${Math.min(seq, 9)}T00:00:00Z`,
    ...patch,
  };
}

const base = {
  features: {
    ugc: { allowed: false, requiredPlan: "growth" },
    autopilot: { allowed: true, requiredPlan: "growth" },
    studio: { allowed: true, requiredPlan: "free" },
  },
  limits: { trackedPrompts: 10, competitors: 3, brands: 1 },
};

describe("isActiveOverride", () => {
  it("is active between its start and end", () => {
    expect(isActiveOverride(row({}), NOW)).toBe(true);
    expect(isActiveOverride(row({ expires_at: "2026-11-01T00:00:00Z" }), NOW)).toBe(true);
  });
  it("stops at its end, before its start, and when revoked", () => {
    expect(isActiveOverride(row({ expires_at: "2026-10-18T12:00:00Z" }), NOW)).toBe(false);
    expect(isActiveOverride(row({ starts_at: "2026-10-19T00:00:00Z" }), NOW)).toBe(false);
    expect(isActiveOverride(row({ revoked_at: "2026-10-10T00:00:00Z" }), NOW)).toBe(false);
  });
});

describe("applyOverrides", () => {
  it("changes nothing when there are no active overrides (parity)", () => {
    const none = applyOverrides(base, [], { now: NOW });
    expect(none.features).toBe(base.features);
    expect(none.limits).toBe(base.limits);
    expect(none.applied).toEqual([]);

    const allInactive = applyOverrides(
      base,
      [
        row({ revoked_at: "2026-10-02T00:00:00Z" }),
        row({ expires_at: "2026-10-05T00:00:00Z" }),
        row({ starts_at: "2027-01-01T00:00:00Z" }),
      ],
      { now: NOW },
    );
    expect(allInactive.features).toBe(base.features);
    expect(allInactive.limits).toBe(base.limits);
  });

  it("grants a feature the plan lacks and removes one it has", () => {
    const result = applyOverrides(
      base,
      [row({ key: "ugc", allowed: true }), row({ key: "autopilot", allowed: false })],
      { now: NOW },
    );
    expect(result.features.ugc).toEqual({ allowed: true, requiredPlan: "growth" });
    expect(result.features.autopilot.allowed).toBe(false);
    expect(result.features.studio.allowed).toBe(true);
    expect(result.applied.map((a) => a.key).sort()).toEqual(["autopilot", "ugc"]);
  });

  it("sets a limit up or down, capped to a sane number", () => {
    const result = applyOverrides(
      base,
      [
        row({ kind: "limit", key: "trackedPrompts", allowed: null, limit_value: 500 }),
        row({ kind: "limit", key: "competitors", allowed: null, limit_value: 1 }),
      ],
      { now: NOW },
    );
    expect(result.limits).toEqual({ trackedPrompts: 500, competitors: 1, brands: 1 });

    const huge = applyOverrides(
      base,
      [row({ kind: "limit", key: "competitors", allowed: null, limit_value: 9e9 })],
      { now: NOW },
    );
    expect(huge.limits.competitors).toBe(MAX_OVERRIDE_LIMIT);
  });

  it("never touches its inputs", () => {
    const snapshot = JSON.stringify(base);
    applyOverrides(base, [row({ key: "ugc" })], { now: NOW });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("lets a workspace override beat the account one, for that workspace only", () => {
    const rows = [
      row({ key: "ugc", allowed: true, workspace_id: null }),
      row({ key: "ugc", allowed: false, workspace_id: WS_A }),
    ];
    expect(applyOverrides(base, rows, { workspaceId: WS_A, now: NOW }).features.ugc.allowed).toBe(
      false,
    );
    expect(applyOverrides(base, rows, { workspaceId: WS_B, now: NOW }).features.ugc.allowed).toBe(
      true,
    );
    expect(applyOverrides(base, rows, { now: NOW }).features.ugc.allowed).toBe(true);
  });

  it("ignores a workspace override when no workspace is in play", () => {
    const rows = [row({ key: "ugc", allowed: true, workspace_id: WS_A })];
    expect(applyOverrides(base, rows, { now: NOW }).features).toBe(base.features);
  });

  it("lets the newer row win between equals", () => {
    const rows = [
      row({ key: "ugc", allowed: false, created_at: "2026-10-02T00:00:00Z" }),
      row({ key: "ugc", allowed: true, created_at: "2026-10-03T00:00:00Z" }),
    ];
    expect(applyOverrides(base, rows, { now: NOW }).features.ugc.allowed).toBe(true);
  });

  it("ignores unknown keys, unsold features and malformed values", () => {
    const rows = [
      row({ key: "no_such_feature", allowed: true }),
      row({ kind: "limit", key: "brands", allowed: null, limit_value: 99 }),
      row({ kind: "limit", key: "seats", allowed: null, limit_value: 99 }),
      row({ kind: "limit", key: "competitors", allowed: null, limit_value: -5 }),
      row({ kind: "limit", key: "trackedPrompts", allowed: null, limit_value: null }),
      row({ kind: "feature", key: "ugc", allowed: null }),
      row({ kind: "wat" as never, key: "ugc" }),
    ];
    const result = applyOverrides(base, rows, { now: NOW });
    expect(result.features).toBe(base.features);
    expect(result.limits).toBe(base.limits);
    expect(result.applied).toEqual([]);
  });
});

describe("what may be overridden", () => {
  it("never includes brands or seats, which would freeze brands", () => {
    expect(OVERRIDE_LIMIT_KEYS).not.toContain("brands");
    expect(OVERRIDE_LIMIT_KEYS).not.toContain("seats");
  });

  it("only offers numeric limits that exist on every plan", () => {
    for (const plan of Object.values(PLANS)) {
      for (const key of OVERRIDE_LIMIT_KEYS) {
        expect(typeof plan.limits[key], `${plan.id}.${key}`).toBe("number");
      }
    }
  });

  it("only offers features that are sold", () => {
    expect(overridableFeatures()).not.toContain("sso_api");
    expect(isValidOverrideTarget("feature", "ugc")).toBe(true);
    expect(isValidOverrideTarget("feature", "sso_api")).toBe(false);
    expect(isValidOverrideTarget("limit", "seats")).toBe(false);
    expect(isValidOverrideTarget("plan", "ugc")).toBe(false);
  });
});
