import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { getEntitlements } from "@/server/billing/entitlements.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "billing-entitlements",
  auth: "user",
  query: z.object({ workspaceId: z.string().uuid().optional() }),
  rateLimit: "billing-read",
  handler: async ({ query, userId, supabase }) => {
    let role: "owner" | "admin" | "editor" | "viewer" = "owner";
    if (query.workspaceId) {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", query.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) throw new HttpError(404, "Workspace not found.");
      role = data.role;
    }
    const entitlements = await getEntitlements({
      userId,
      workspaceId: query.workspaceId,
      role,
    });
    return entitlements.isOwner
      ? entitlements
      : { ...entitlements, accountId: null, ownerUserId: null };
  },
});
