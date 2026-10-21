// Routing overrides — the runtime half of the admin console's AI controls.
//
// task-models.ts decides which model answers which route and stays the baseline.
// An admin can override a route's models or reasoning effort (table
// model_route_overrides). `planFor` is synchronous and used in many places, so
// the overrides live in a process-wide snapshot that `planFor` reads at once and
// that the gateways refresh (a few seconds' cache) before they build a request.
//
// Precedence in planFor: env var AI_MODEL_<ROUTE> / AI_EFFORT_<ROUTE> > this
// override > the registry. Like every other lookup it fails safe: an unreadable
// table keeps the last snapshot, or the registry's plan.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RouteOverride = {
  models?: string[];
  effort?: "low" | "medium" | "high";
};

const TTL_MS = 15_000;

export type OverrideReader = () => Promise<Record<string, RouteOverride>>;

const defaultReader: OverrideReader = async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await client
    .from("model_route_overrides")
    .select("route_key,models,effort");
  if (error) throw new Error(error.message);
  const out: Record<string, RouteOverride> = {};
  for (const row of (data ?? []) as Array<{
    route_key: string;
    models: string[] | null;
    effort: RouteOverride["effort"] | null;
  }>) {
    out[row.route_key] = {
      ...(row.models?.length ? { models: row.models } : {}),
      ...(row.effort ? { effort: row.effort } : {}),
    };
  }
  return out;
};

let reader: OverrideReader = defaultReader;
let snapshot: Record<string, RouteOverride> = {};
let loadedAt = 0;

/** Tests inject a reader. */
export function setOverrideReader(next: OverrideReader | null): void {
  reader = next ?? defaultReader;
  snapshot = {};
  loadedAt = 0;
}

/** The current snapshot's override for a registry key (synchronous). */
export function routingOverrideFor(registryKey: string): RouteOverride | undefined {
  return snapshot[registryKey];
}

/** Bring the snapshot up to date if it is older than a few seconds. Never throws. */
export async function refreshRoutingOverrides(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  try {
    snapshot = await reader();
    loadedAt = Date.now();
  } catch (error) {
    // Keep what we had; try again on the next call but not on every one.
    loadedAt = Date.now() - TTL_MS + 3_000;
    console.error(
      "[routing] override read failed, keeping the last answer",
      error instanceof Error ? error.message : error,
    );
  }
}
