// ONE query for the "workspace activity" numbers every route needs.
// Cached in-memory per workspace for a short window so back-to-back AI
// calls (chat -> suggest -> coach) don't re-hit the DB three times.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WorkspaceSignals = {
  pending: number;
  scheduled: number;
  published: number;
  recentTitles: string[];
};

type CacheEntry = { value: WorkspaceSignals; expires: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

export async function getWorkspaceSignals(workspaceId: string): Promise<WorkspaceSignals> {
  const now = Date.now();
  const hit = cache.get(workspaceId);
  if (hit && hit.expires > now) return hit.value;

  const [p, s, pub, recent] = await Promise.all([
    supabaseAdmin.from("content_items").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "pending"),
    supabaseAdmin.from("content_items").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "scheduled"),
    supabaseAdmin.from("content_items").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "published"),
    supabaseAdmin.from("content_items").select("title")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
  ]);

  const value: WorkspaceSignals = {
    pending: p.count ?? 0,
    scheduled: s.count ?? 0,
    published: pub.count ?? 0,
    recentTitles: ((recent.data ?? []) as { title: string | null }[])
      .map((r) => r.title)
      .filter((t): t is string => !!t),
  };

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(workspaceId, { value, expires: now + TTL_MS });
  return value;
}

export function invalidateWorkspaceSignals(workspaceId: string): void {
  cache.delete(workspaceId);
}
