// webhook.server.ts — what a Meta webhook delivery does: it marks the brands
// that own those Pages or Instagram accounts as due now, and the normal sweep
// (runDueEngage) reads and answers them, with every check it already has
// (flag, plan, auto-reply, hourly cap). Nothing in the delivery is stored.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as SupabaseClient;

export async function wakeForMetaEvent(ids: {
  pageIds: string[];
  igIds: string[];
}): Promise<number> {
  const workspaces = new Set<string>();
  if (ids.pageIds.length) {
    const { data } = await db.from("meta_pages").select("workspace_id").in("page_id", ids.pageIds);
    for (const r of data ?? []) workspaces.add(r.workspace_id as string);
  }
  if (ids.igIds.length) {
    const { data } = await db.from("meta_pages").select("workspace_id").in("ig_user_id", ids.igIds);
    for (const r of data ?? []) workspaces.add(r.workspace_id as string);
  }
  if (!workspaces.size) return 0;
  await db
    .from("engage_settings")
    .update({ next_sync_at: new Date().toISOString() })
    .in("workspace_id", [...workspaces])
    .or("automations_on.eq.true,auto_reply.eq.true");
  return workspaces.size;
}
