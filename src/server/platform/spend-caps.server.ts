// Spend caps — the runtime half of the admin console's AI controls.
//
// Two ceilings an admin can set, in USD: one for the whole platform, and one per
// workspace. Both are checked inside `checkBudget`, so every paid gateway honours
// them. They sit on top of the plan allowances, never replace them.
//
//   platform cap reached  → every paid call is blocked until the day/month rolls
//   workspace cap reached → text degrades to the economy model (like a plan
//                           ceiling); images, video and search are blocked
//
// Like the rest of metering this FAILS OPEN: if the caps or the spend can't be
// read the call proceeds, because a metering outage must not stop the product.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CapKind = "text" | "image" | "video" | "search";

export type Cap = { dailyUsd: number | null; monthlyUsd: number | null };
export type CapSet = { global: Cap | null; workspaces: Record<string, Cap> };
export type SpendReader = {
  caps: () => Promise<CapSet>;
  /** Estimated platform spend since the start of the UTC day / month. */
  platformSpend: () => Promise<{ todayUsd: number; monthUsd: number }>;
};

const CAPS_TTL_MS = 30_000;
const SPEND_TTL_MS = 60_000;

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const defaultReader: SpendReader = {
  async caps() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as unknown as SupabaseClient;
    const { data, error } = await client
      .from("spend_caps")
      .select("scope,workspace_id,daily_usd,monthly_usd")
      .limit(2000);
    if (error) throw new Error(error.message);
    const out: CapSet = { global: null, workspaces: {} };
    for (const row of (data ?? []) as Array<{
      scope: string;
      workspace_id: string | null;
      daily_usd: number | string | null;
      monthly_usd: number | string | null;
    }>) {
      const cap = { dailyUsd: num(row.daily_usd), monthlyUsd: num(row.monthly_usd) };
      if (row.scope === "global") out.global = cap;
      else if (row.workspace_id) out.workspaces[row.workspace_id] = cap;
    }
    return out;
  },
  async platformSpend() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as unknown as SupabaseClient;
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [today, monthly] = await Promise.all([
      client.rpc("platform_spend_since", { p_since: day.toISOString() }),
      client.rpc("platform_spend_since", { p_since: month.toISOString() }),
    ]);
    if (today.error) throw new Error(today.error.message);
    if (monthly.error) throw new Error(monthly.error.message);
    return { todayUsd: Number(today.data ?? 0), monthUsd: Number(monthly.data ?? 0) };
  },
};

let reader: SpendReader = defaultReader;
let capsCache: { at: number; value: CapSet } | null = null;
let spendCache: { at: number; value: { todayUsd: number; monthUsd: number } } | null = null;

/** Tests inject a reader. */
export function setSpendReader(next: Partial<SpendReader> | null): void {
  reader = next ? { ...defaultReader, ...next } : defaultReader;
  capsCache = null;
  spendCache = null;
}

export function clearSpendCapCache(): void {
  capsCache = null;
  spendCache = null;
}

export async function loadCaps(): Promise<CapSet> {
  if (capsCache && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.value;
  const value = await reader.caps();
  capsCache = { at: Date.now(), value };
  return value;
}

export async function loadPlatformSpend(): Promise<{ todayUsd: number; monthUsd: number }> {
  if (spendCache && Date.now() - spendCache.at < SPEND_TTL_MS) return spendCache.value;
  const value = await reader.platformSpend();
  spendCache = { at: Date.now(), value };
  return value;
}

/** Pure: has this spend reached the cap? Returns which limit, or null. */
export function capReached(
  cap: Cap | null | undefined,
  spend: { todayUsd: number; monthUsd: number },
): "daily" | "monthly" | null {
  if (!cap) return null;
  if (cap.dailyUsd !== null && spend.todayUsd >= cap.dailyUsd) return "daily";
  if (cap.monthlyUsd !== null && spend.monthUsd >= cap.monthlyUsd) return "monthly";
  return null;
}

export type CapDecision = { mode: "block" | "degrade"; reason: string };

/**
 * The cap verdict for a paid call, or null when none applies. `workspaceSpend`
 * returns a workspace's metered spend (the caller already caches it).
 */
export async function capDecision(
  kind: CapKind,
  workspaceId: string | null | undefined,
  workspaceSpend: (workspaceId: string) => Promise<{ todayUsd: number; monthUsd: number } | null>,
): Promise<CapDecision | null> {
  try {
    const caps = await loadCaps();

    if (caps.global) {
      const hit = capReached(caps.global, await loadPlatformSpend());
      if (hit) {
        return {
          mode: "block",
          reason: `Mellox has reached its ${hit} AI spending limit. Please try again later.`,
        };
      }
    }

    const cap = workspaceId ? caps.workspaces[workspaceId] : undefined;
    if (workspaceId && cap) {
      const spend = await workspaceSpend(workspaceId);
      const hit = spend ? capReached(cap, spend) : null;
      if (hit) {
        return kind === "text"
          ? {
              mode: "degrade",
              reason: `This workspace's ${hit} AI spending cap is reached — using the economy model.`,
            }
          : { mode: "block", reason: `This workspace's ${hit} AI spending cap is reached.` };
      }
    }
    return null;
  } catch (error) {
    console.error(
      "[spend-caps] check failed, failing open",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
