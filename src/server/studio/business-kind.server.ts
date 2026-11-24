// business-kind.server.ts — whether a workspace sells a service (Round 9
// video pack, ADR-0053). Read from the workspace's own industry line with
// the caller's client, so the video quote and the billed job settle the
// same kind of video. One small read; null when nothing is known.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { creativeSkillsFor } from "@/lib/feature-flags";
import { businessKindOf, sellsNoThing } from "@/lib/studio/sectors/kinds";

export async function workspaceSellsService(
  client: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  if (!creativeSkillsFor(workspaceId).video) return false;
  try {
    const { data } = await client
      .from("workspaces")
      .select("industry")
      .eq("id", workspaceId)
      .maybeSingle();
    const industry = (data as { industry?: string | null } | null)?.industry ?? null;
    return sellsNoThing(businessKindOf(industry, null));
  } catch {
    return false;
  }
}
