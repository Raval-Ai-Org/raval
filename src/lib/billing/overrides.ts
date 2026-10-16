// overrides.ts — entitlement overrides: a temporary or permanent exception to
// what a plan allows, set by Mellox staff in the admin console for one billing
// account (every brand) or for one workspace.
//
// Pure and browser-safe. The server loads the rows (overrides.server.ts) and
// applies them right after the plan's entitlements are resolved
// (entitlements.server.ts). With no active override nothing changes: the same
// object comes out, which a test pins.
//
// What can be overridden (and what cannot, on purpose):
//   feature  allow or deny one sold feature.
//   limit    set one numeric plan limit to another number.
//   NOT brands or seats: lowering them below usage freezes brands the next time
//   capacity is reconciled. Change those through the plan or the billing console.

import { FEATURES, type FeatureKey } from "./catalog";

export const OVERRIDE_LIMIT_KEYS = [
  "trackedPrompts",
  "scansPerMonth",
  "geoMaxPages",
  "competitors",
  "competitorSweepsPerWeek",
  "marketBrainWeeklyBrands",
  "coachWeeklyBriefings",
  "postsFairUse",
  "maxConcurrentExperiments",
  "maxConcurrentRenders",
] as const;

export type OverrideLimitKey = (typeof OVERRIDE_LIMIT_KEYS)[number];

/** Large enough for "effectively unlimited", small enough to stay a sane number. */
export const MAX_OVERRIDE_LIMIT = 1_000_000;

export type OverrideKind = "feature" | "limit";

export type OverrideRow = {
  id: string;
  account_id: string;
  /** null = the whole billing account (every brand); otherwise one workspace. */
  workspace_id: string | null;
  kind: OverrideKind;
  key: string;
  allowed: boolean | null;
  limit_value: number | null;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AppliedOverride = {
  id: string;
  kind: OverrideKind;
  key: string;
  scope: "account" | "workspace";
  allowed?: boolean;
  value?: number;
  expiresAt: string | null;
};

/** Feature keys an override may touch: only ones that are actually sold. */
export function overridableFeatures(): FeatureKey[] {
  return (Object.keys(FEATURES) as FeatureKey[]).filter(
    (key) => (FEATURES[key].availability ?? "launch") === "launch",
  );
}

export function isOverridableFeature(key: string): key is FeatureKey {
  return overridableFeatures().includes(key as FeatureKey);
}

export function isOverrideLimitKey(key: string): key is OverrideLimitKey {
  return (OVERRIDE_LIMIT_KEYS as readonly string[]).includes(key);
}

export function isValidOverrideTarget(kind: string, key: string): boolean {
  return kind === "feature"
    ? isOverridableFeature(key)
    : kind === "limit" && isOverrideLimitKey(key);
}

/** In force right now: started, not ended, not revoked. */
export function isActiveOverride(row: OverrideRow, now: Date = new Date()): boolean {
  if (row.revoked_at) return false;
  if (new Date(row.starts_at).getTime() > now.getTime()) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return false;
  return true;
}

type Features = Record<string, { allowed: boolean; requiredPlan: string }>;
type Limits = Record<string, unknown>;

/**
 * Apply the active overrides to resolved entitlements. Returns new objects and
 * never changes its inputs. A workspace-scoped override beats an account-scoped
 * one for the same key, and only counts for that workspace. Rows whose key is
 * unknown or no longer sold are ignored, never trusted.
 */
export function applyOverrides<F extends Features, L extends Limits>(
  base: { features: F; limits: L },
  rows: readonly OverrideRow[],
  context: { workspaceId?: string | null; now?: Date } = {},
): { features: F; limits: L; applied: AppliedOverride[] } {
  const now = context.now ?? new Date();
  const relevant = rows
    .filter((row) => isActiveOverride(row, now))
    .filter((row) => isValidOverrideTarget(row.kind, row.key))
    .filter((row) => row.workspace_id === null || row.workspace_id === context.workspaceId)
    // Account first, then workspace, so the more specific one is applied last and wins;
    // among equals the newer row wins.
    .sort(
      (a, b) =>
        Number(a.workspace_id !== null) - Number(b.workspace_id !== null) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  if (relevant.length === 0) return { features: base.features, limits: base.limits, applied: [] };

  const features = { ...base.features } as Record<
    string,
    { allowed: boolean; requiredPlan: string }
  >;
  const limits = { ...base.limits } as Record<string, unknown>;
  const winners = new Map<string, OverrideRow>();
  for (const row of relevant) winners.set(`${row.kind}:${row.key}`, row);

  const applied: AppliedOverride[] = [];
  for (const row of winners.values()) {
    const scope = row.workspace_id ? "workspace" : "account";
    if (row.kind === "feature") {
      if (row.allowed === null || !features[row.key]) continue;
      features[row.key] = { ...features[row.key]!, allowed: row.allowed };
      applied.push({
        id: row.id,
        kind: "feature",
        key: row.key,
        scope,
        allowed: row.allowed,
        expiresAt: row.expires_at,
      });
    } else {
      if (row.limit_value === null || !Number.isFinite(row.limit_value) || row.limit_value < 0) {
        continue;
      }
      limits[row.key] = Math.min(Math.floor(row.limit_value), MAX_OVERRIDE_LIMIT);
      applied.push({
        id: row.id,
        kind: "limit",
        key: row.key,
        scope,
        value: limits[row.key] as number,
        expiresAt: row.expires_at,
      });
    }
  }
  // Rows that were all skipped as invalid change nothing: hand back the originals.
  if (applied.length === 0) return { features: base.features, limits: base.limits, applied };
  return { features: features as F, limits: limits as L, applied };
}
