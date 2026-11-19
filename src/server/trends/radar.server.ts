// radar.server.ts — the Trend Radar trends that reach one brand (ADR-0052).
//
// Read with the caller's own client through `live_trends_for`, which checks
// membership and never returns the other brands a trend was aimed at. The
// industry match is pure (`trendsForWorkspace`, src/lib/trends/radar.ts).
// Never throws: no trends is a normal answer.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { industryOf } from "@/lib/studio/knowledge/industries";
import { radarFromRow, trendsForWorkspace, type RadarTrend } from "@/lib/trends/radar";

const TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: RadarTrend[] }>();

/** Tests: forget cached reads. */
export function resetRadarCache() {
  memo.clear();
}

export async function radarFor(
  client: SupabaseClient,
  workspaceId: string,
  brand: { industry?: string | null; brandText?: string | null; language?: string | null },
): Promise<RadarTrend[]> {
  const key = `${workspaceId}:${brand.industry ?? ""}:${brand.language ?? ""}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const { data, error } = await client.rpc("live_trends_for", { p_workspace_id: workspaceId });
    if (error) throw new Error(error.message);
    const trends = ((data ?? []) as Record<string, unknown>[])
      .map((row) =>
        radarFromRow({ ...row, workspace_ids: row.aimed_here === true ? [workspaceId] : [] }),
      )
      .filter((t): t is RadarTrend => !!t);
    const value = trendsForWorkspace(trends, {
      workspaceId,
      industryId: industryOf(brand.industry, brand.brandText?.slice(0, 1500))?.id ?? null,
      language: brand.language,
    });
    memo.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    // A database without the migration yet, or a brief outage: no trends.
    console.warn("[trends] radar unavailable", error instanceof Error ? error.message : error);
    memo.set(key, { at: Date.now(), value: [] });
    return [];
  }
}
