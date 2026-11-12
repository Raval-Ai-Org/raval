// account.server.ts — the account facts the background gate needs
// (src/lib/background/gate.ts), read once per workspace per few minutes.
//
// "Activity" is a person's: the owner's last sign-in, or a metered call made
// on a person's behalf outside the routes cron jobs run under. Autopilot and
// scheduled jobs carry a user id, so counting every call with a user (the old
// rule) kept workspaces "active" with nobody there.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BackgroundAccount } from "@/lib/background/gate";

/** Routes background work runs under; their calls never count as a person's activity. */
const BACKGROUND_ROUTE_PREFIXES = [
  "autopilot",
  "schedule",
  "market-brain",
  "market-intelligence",
  "competitors",
  "competitor",
  "community",
  "agent",
  "cron",
  "audience.run",
  "studio/jobs:advance",
];

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: BackgroundAccount | null }>();

function newest(...values: (string | null | undefined)[]): string | null {
  const times = values
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

async function lastPersonCall(workspaceId: string): Promise<string | null> {
  let query = supabaseAdmin
    .from("ai_usage_events")
    .select("created_at")
    .eq("workspace_id", workspaceId)
    .not("user_id", "is", null);
  for (const prefix of BACKGROUND_ROUTE_PREFIXES) query = query.not("route", "like", `${prefix}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return (data?.[0]?.created_at as string | undefined) ?? null;
}

/**
 * The account behind a workspace, or null when it can't be read (the gate
 * then waits: a failed read is never a reason to spend).
 */
export async function loadBackgroundAccount(
  workspaceId: string,
): Promise<BackgroundAccount | null> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: BackgroundAccount | null = null;
  try {
    const { accountForWorkspace } = await import("@/server/billing/accounts.server");
    const { getEntitlements } = await import("@/server/billing/entitlements.server");
    const { account } = await accountForWorkspace(workspaceId);
    const entitlements = await getEntitlements({
      workspaceId,
      userId: account.owner_user_id,
      role: "owner",
      skipCapacityReconcile: true,
    });
    const [{ data: owner }, lastCall] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(account.owner_user_id),
      lastPersonCall(workspaceId),
    ]);
    value = {
      plan: entitlements.entitledPlan,
      frozen: entitlements.frozen,
      paused: entitlements.status === "paused",
      limits: {
        marketBrainWeeklyBrands: entitlements.limits.marketBrainWeeklyBrands,
        competitorSweepsPerWeek: entitlements.limits.competitorSweepsPerWeek,
        competitors: entitlements.limits.competitors,
      },
      lastActiveAt: newest(owner?.user?.last_sign_in_at, lastCall),
    };
  } catch (error) {
    console.warn(
      "[background] account read failed",
      workspaceId,
      error instanceof Error ? error.message : error,
    );
    value = null;
  }
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}
