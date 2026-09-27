import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clawbackMeter, grantMeter } from "@/server/billing/meters.server";

export const dynamic = "force-dynamic";
const admin = supabaseAdmin as unknown as SupabaseClient;

function requireBillingAdmin(userId: string): void {
  const allowed = (process.env.BILLING_ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim());
  if (!allowed.includes(userId)) throw new HttpError(403, "Billing administrator access required.");
}

const Common = {
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000),
  reason: z.string().trim().min(20).max(200),
};
const Adjustment = z.discriminatedUnion("operation", [
  z.object({
    ...Common,
    operation: z.literal("grant"),
    meter: z.enum(["credits", "video", "pro_messages", "flash_messages"]),
  }),
  z.object({ ...Common, operation: z.literal("clawback"), grantId: z.string().uuid() }),
]);

export const GET = defineRoute({
  name: "billing.admin.report",
  auth: "user",
  rateLimit: "billing-read",
  handler: async ({ userId }) => {
    requireBillingAdmin(userId);
    const [report, margin, failed, health, pendingCapacity] = await Promise.all([
      admin.rpc("billing_rollout_report"),
      admin.rpc("billing_margin_report"),
      admin
        .from("billing_events")
        .select("id,type,error,received_at")
        .is("processed_at", null)
        .not("error", "is", null)
        .order("received_at", { ascending: true })
        .limit(25),
      admin.from("billing_provider_health").select("environment,webhook_verified_at,updated_at"),
      admin
        .from("billing_accounts")
        .select("id", { count: "exact", head: true })
        .is("capacity_reconciled_at", null),
    ]);
    if (report.error || margin.error || failed.error || health.error || pendingCapacity.error) {
      throw new HttpError(503, "Billing report is unavailable.");
    }
    return {
      report: { ...report.data, capacityUnchecked: pendingCapacity.count ?? 0 },
      margin: margin.data,
      providerHealth: health.data ?? [],
      failedEvents: failed.data ?? [],
    };
  },
});

export const POST = defineRoute({
  name: "billing.admin.adjust",
  auth: "user",
  body: Adjustment,
  rateLimit: "billing-checkout",
  handler: async ({ userId, body }) => {
    requireBillingAdmin(userId);
    const { data: account, error: accountError } = await admin
      .from("billing_accounts")
      .select("id")
      .eq("id", body.accountId)
      .maybeSingle();
    if (accountError || !account) throw new HttpError(404, "Billing account not found.");
    const { data: existing, error: existingError } = await admin
      .from("billing_admin_adjustments")
      .select("account_id,operation,meter,amount,grant_id,reason")
      .eq("id", body.id)
      .maybeSingle();
    if (existingError) throw new HttpError(503, "Could not check adjustment history.");
    if (existing) {
      const matches =
        existing.account_id === body.accountId &&
        existing.operation === body.operation &&
        Number(existing.amount) === body.amount &&
        existing.reason === body.reason &&
        (body.operation === "grant"
          ? existing.meter === body.meter
          : existing.grant_id === body.grantId);
      if (!matches)
        throw new HttpError(409, "Adjustment key was already used for another operation.");
      return { ok: true, replayed: true };
    }
    let meter: "credits" | "video" | "pro_messages" | "flash_messages";
    if (body.operation === "grant") {
      meter = body.meter;
      const result = await grantMeter({
        accountId: body.accountId,
        meter,
        amount: body.amount,
        source: "adjustment",
        restriction: "ai_only",
        idempotencyKey: `admin:${body.id}`,
        reason: body.reason,
        actor: userId,
      });
      if (!result.ok) throw new HttpError(503, "Could not grant adjustment.");
    } else {
      const { data: grant, error: grantError } = await admin
        .from("meter_grants")
        .select("account_id,meter")
        .eq("id", body.grantId)
        .maybeSingle();
      if (grantError || !grant || grant.account_id !== body.accountId) {
        throw new HttpError(404, "Grant not found in this account.");
      }
      meter = grant.meter;
      const result = await clawbackMeter({
        accountId: body.accountId,
        grantId: body.grantId,
        amount: body.amount,
        idempotencyKey: `admin:${body.id}`,
        reason: `Admin ${userId}: ${body.reason}`,
      });
      if (!result.ok) throw new HttpError(503, "Could not claw back adjustment.");
    }
    const { error } = await admin.from("billing_admin_adjustments").insert({
      id: body.id,
      account_id: body.accountId,
      actor_user_id: userId,
      operation: body.operation,
      meter,
      amount: body.amount,
      grant_id: body.operation === "clawback" ? body.grantId : null,
      reason: body.reason,
    });
    if (error?.code === "23505") throw new HttpError(409, "Adjustment key was already used.");
    if (error) throw new HttpError(503, "Could not audit adjustment.");
    return { ok: true, replayed: false };
  },
});
