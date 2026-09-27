import { z } from "zod";
import { defineRoute } from "@/server/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { accountForUser } from "@/server/billing/accounts.server";
import { reconcileBillingCapacity } from "@/server/billing/capacity.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "billing.brands.list",
  auth: "user",
  rateLimit: "billing-read",
  handler: async ({ userId }) => {
    const account = await accountForUser(userId);
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("id,name,created_at,frozen_at,frozen_reason")
      .eq("billing_account_id", account.id)
      .is("duplicate_of", null)
      .order("created_at", { ascending: true });
    if (error) throw new HttpError(503, "Could not load brands.");
    return { brands: data ?? [] };
  },
});

export const POST = defineRoute({
  name: "billing.brands.select",
  auth: "user",
  body: z.object({ workspaceId: z.string().uuid() }),
  rateLimit: "billing-checkout",
  handler: async ({ userId, body }) => {
    const result = await reconcileBillingCapacity({
      ownerUserId: userId,
      preferredWorkspaceId: body.workspaceId,
    });
    return { ok: true, ...result };
  },
});
