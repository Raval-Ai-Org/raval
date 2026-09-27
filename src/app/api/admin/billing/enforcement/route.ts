import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileBillingCapacity } from "@/server/billing/capacity.server";
import { invalidateBillingAccount } from "@/server/billing/accounts.server";

export const dynamic = "force-dynamic";
const admin = supabaseAdmin as unknown as SupabaseClient;
const Body = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  mode: z.enum(["off", "shadow", "on"]).nullable(),
  reason: z.string().trim().min(20).max(300),
});

export const POST = defineRoute({
  name: "billing.admin.enforcement",
  auth: "user",
  body: Body,
  rateLimit: "billing-checkout",
  handler: async ({ userId, body }) => {
    const allowed = (process.env.BILLING_ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim());
    if (!allowed.includes(userId))
      throw new HttpError(403, "Billing administrator access required.");
    const { data, error } = await admin.rpc("set_billing_enforcement_override", {
      p_action: body.id,
      p_account: body.accountId,
      p_actor: userId,
      p_mode: body.mode,
      p_reason: body.reason,
    });
    if (error)
      throw new HttpError(
        error.code === "23505" ? 409 : 503,
        "Could not change account enforcement.",
      );
    invalidateBillingAccount(body.accountId);
    if (body.mode === "on") {
      const { data: account, error: ownerError } = await admin
        .from("billing_accounts")
        .select("owner_user_id")
        .eq("id", body.accountId)
        .single();
      if (ownerError || !account) throw new HttpError(503, "Could not load account owner.");
      const capacity = await reconcileBillingCapacity({
        ownerUserId: String(account.owner_user_id),
      });
      return { ...data, capacity };
    }
    return data;
  },
});
