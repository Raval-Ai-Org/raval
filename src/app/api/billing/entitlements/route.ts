import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "billing-entitlements",
  auth: "user",
  query: z.object({ workspaceId: z.string().uuid().optional() }),
  rateLimit: "billing-read",
  handler: async ({ query, userId, supabase }) => {
    const { optionalWorkspaceEntitlements } = await import("@/server/billing/readiness.server");
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
    const entitlements = await optionalWorkspaceEntitlements({
      userId,
      workspaceId: query.workspaceId,
      role,
    });
    if (!entitlements) {
      throw new HttpError(503, "Plan & billing is being set up. Upgrades are unavailable for now.");
    }
    const { stripeAccountReady } = await import("@/server/billing/stripe-account.server");
    const purchasesAvailable = entitlements.isOwner && (await stripeAccountReady());
    return entitlements.isOwner
      ? { ...entitlements, purchasesAvailable }
      : { ...entitlements, accountId: null, ownerUserId: null, purchasesAvailable: false };
  },
});
