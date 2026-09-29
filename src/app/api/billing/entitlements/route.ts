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
    const { isBillingAdmin } = await import("@/server/billing/admin.server");
    // Card checkout when Stripe is connected; otherwise "Upgrade now" sends a
    // request that Mellox activates from the admin console.
    const purchasesAvailable = entitlements.isOwner && (await stripeAccountReady());
    const extras = {
      purchasesAvailable,
      checkoutMode: purchasesAvailable ? ("card" as const) : ("request" as const),
      isBillingAdmin: isBillingAdmin(userId),
    };
    if (entitlements.isOwner) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("billing_accounts")
        .select("referral_code")
        .eq("id", entitlements.accountId)
        .maybeSingle();
      return { ...entitlements, ...extras, referralCode: row?.referral_code ?? null };
    }
    return entitlements.isOwner
      ? { ...entitlements, ...extras }
      : {
          ...entitlements,
          accountId: null,
          ownerUserId: null,
          ...extras,
          purchasesAvailable: false,
        };
  },
});
