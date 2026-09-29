// Billing admin console: the "Upgrade now" request queue.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_PACKS, PLANS, VIDEO_PACKS, type PlanId } from "@/lib/billing/catalog";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBillingAdmin } from "@/server/billing/admin.server";

export const dynamic = "force-dynamic";
const admin = supabaseAdmin as unknown as SupabaseClient;

function priceUsd(kind: string, key: string, interval: string | null): number | null {
  if (kind === "plan" && key in PLANS) {
    const plan = PLANS[key as PlanId];
    return interval === "year" ? plan.priceAnnualUsd : plan.priceMonthlyUsd;
  }
  return (
    CREDIT_PACKS.find((pack) => pack.key === key)?.usd ??
    VIDEO_PACKS.find((pack) => pack.key === key)?.usd ??
    null
  );
}

export const GET = defineRoute({
  name: "billing.admin.requests",
  auth: "user",
  query: z.object({
    status: z.enum(["pending", "approved", "declined", "canceled", "all"]).optional(),
  }),
  rateLimit: "billing-admin",
  handler: async ({ userId, query }) => {
    requireBillingAdmin(userId);
    let rows = admin
      .from("billing_purchase_requests")
      .select(
        "id,account_id,requested_by,kind,catalog_key,billing_interval,quantity,contact,note,status,admin_note,created_at,handled_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    const status = query.status ?? "pending";
    if (status !== "all") rows = rows.eq("status", status);
    const { data, error } = await rows;
    if (error) throw new HttpError(503, "Could not load requests.");
    const emails = new Map<string, string>();
    await Promise.all(
      [...new Set((data ?? []).map((row) => String(row.requested_by)))].map(async (id) => {
        const { data: person } = await admin.auth.admin.getUserById(id);
        if (person?.user?.email) emails.set(id, person.user.email);
      }),
    );
    return {
      requests: (data ?? []).map((row) => ({
        id: String(row.id),
        accountId: String(row.account_id),
        email: emails.get(String(row.requested_by)) ?? null,
        kind: String(row.kind),
        key: String(row.catalog_key),
        interval: (row.billing_interval as string | null) ?? null,
        priceUsd: priceUsd(String(row.kind), String(row.catalog_key), row.billing_interval),
        contact: (row.contact as string | null) ?? null,
        note: (row.note as string | null) ?? null,
        status: String(row.status),
        adminNote: (row.admin_note as string | null) ?? null,
        createdAt: String(row.created_at),
        handledAt: (row.handled_at as string | null) ?? null,
      })),
    };
  },
});
