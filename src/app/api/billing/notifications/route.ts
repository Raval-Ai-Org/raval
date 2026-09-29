// Billing notices for the signed-in person (low balance, requests, plan
// changes). Only their own rows, never another person's.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
const admin = supabaseAdmin as unknown as SupabaseClient;

export const GET = defineRoute({
  name: "billing.notifications.list",
  auth: "user",
  rateLimit: "billing-read",
  handler: async ({ userId }) => {
    const { data, error } = await admin
      .from("account_notifications")
      .select("id,kind,payload,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new HttpError(503, "Could not load notices.");
    const notices = (data ?? []).map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        kind: String(row.kind),
        title: typeof payload.title === "string" ? payload.title : null,
        read: Boolean(row.read_at),
        at: String(row.created_at),
      };
    });
    return { notices, unread: notices.filter((notice) => !notice.read).length };
  },
});

/** Mark notices read (all of the caller's, or the listed ids). */
export const PATCH = defineRoute({
  name: "billing.notifications.read",
  auth: "user",
  body: z.object({ ids: z.array(z.string().uuid()).max(50).optional() }),
  rateLimit: "billing-read",
  handler: async ({ userId, body }) => {
    let query = admin
      .from("account_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    if (body.ids?.length) query = query.in("id", body.ids);
    const { error } = await query;
    if (error) throw new HttpError(503, "Could not update notices.");
    return { ok: true as const };
  },
});
