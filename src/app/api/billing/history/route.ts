import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { accountForUser, accountForWorkspace } from "@/server/billing/accounts.server";

export const dynamic = "force-dynamic";
const admin = supabaseAdmin as unknown as SupabaseClient;

export const GET = defineRoute({
  name: "billing.history",
  auth: "user",
  query: z.object({ workspaceId: z.string().uuid().optional() }),
  rateLimit: "billing-read",
  handler: async ({ query, userId, supabase }) => {
    let account = await accountForUser(userId);
    let ownAccount = true;
    if (query.workspaceId) {
      const { data: member, error } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", query.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !member) throw new HttpError(404, "Workspace not found.");
      account = (await accountForWorkspace(query.workspaceId)).account;
      ownAccount = account.owner_user_id === userId;
    }
    let rows = admin
      .from("meter_ledger")
      .select("id,meter,kind,delta_available,delta_held,action,reason,workspace_id,created_at")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!ownAccount && query.workspaceId) rows = rows.eq("workspace_id", query.workspaceId);
    const { data, error } = await rows;
    if (error) throw new HttpError(503, "Could not load billing history.");
    return {
      entries: (data ?? []).map((row) => ({
        id: row.id,
        meter: row.meter,
        kind: row.kind,
        delta: row.delta_available,
        heldDelta: row.delta_held,
        action: row.action,
        reason: ownAccount ? row.reason : null,
        at: row.created_at,
      })),
    };
  },
});
