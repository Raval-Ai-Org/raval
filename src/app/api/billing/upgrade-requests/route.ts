// "Ask the owner": a teammate who hits a locked feature or an empty balance
// in someone else's brand asks the account owner to upgrade. Only the owner
// sees the request; the teammate never learns the account id or other brands.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURES, PLANS } from "@/lib/billing/catalog";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";

/** Control characters and line/paragraph separators, removed from customer text. */
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const admin = supabaseAdmin as unknown as SupabaseClient;

const Body = z.object({
  workspaceId: z.string().uuid(),
  feature: z
    .string()
    .regex(/^[a-z0-9_]{1,60}$/)
    .optional(),
  requiredPlan: z
    .string()
    .regex(/^[a-z]{1,20}$/)
    .optional(),
  message: z
    .string()
    .max(300)
    .transform((value) => value.replace(CONTROL_CHARS, " ").trim())
    .optional(),
});

export const POST = defineRoute({
  name: "billing.upgrade-requests.create",
  auth: "workspace",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "billing-request",
  handler: async ({ body, workspaceId, userId }) => {
    const { accountForWorkspace } = await import("@/server/billing/accounts.server");
    const { account } = await accountForWorkspace(workspaceId);
    if (account.owner_user_id === userId) {
      throw new HttpError(400, "You own this plan. Upgrade from Plan & billing.");
    }
    const feature = body.feature && body.feature in FEATURES ? body.feature : "more";
    const requiredPlan = body.requiredPlan && body.requiredPlan in PLANS ? body.requiredPlan : null;
    const { data, error } = await admin
      .from("upgrade_requests")
      .insert({
        account_id: account.id,
        workspace_id: workspaceId,
        requested_by: userId,
        feature,
        required_plan: requiredPlan,
        message: body.message || null,
      })
      .select("id")
      .single();
    if (error && error.code !== "23505") throw new HttpError(503, "Could not send the request.");
    if (!error) {
      const [{ notify }, { appUrl }, person, space] = await Promise.all([
        import("@/server/billing/notify.server"),
        import("@/server/notify/email.server"),
        admin.auth.admin.getUserById(userId),
        admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
      ]);
      const who = person.data?.user?.email ?? "A teammate";
      const what = feature in FEATURES ? FEATURES[feature as keyof typeof FEATURES].label : "more";
      await notify({
        accountId: account.id,
        userId: account.owner_user_id,
        kind: "upgrade_request",
        windowKey: `${userId}:${feature}:${data?.id ?? "open"}`,
        payload: { workspaceId, feature, requiredPlan, requestId: data?.id ?? null },
        email: {
          subject: `${who} asked for ${what}`,
          text: `${who} asked you to unlock ${what} in ${space.data?.name ?? "your brand"}${requiredPlan ? `. It's on the ${PLANS[requiredPlan as keyof typeof PLANS].label} plan` : ""}.`,
          replyTo: person.data?.user?.email ?? undefined,
          action: ["See options", appUrl("/projects?billing=plans")],
        },
      });
    }
    return { ok: true as const, alreadySent: Boolean(error) };
  },
});

/** Owner only: open requests from teammates across the owner's brands. */
export const GET = defineRoute({
  name: "billing.upgrade-requests.list",
  auth: "user",
  rateLimit: "billing-read",
  handler: async ({ userId }) => {
    const { accountForUser } = await import("@/server/billing/accounts.server");
    const account = await accountForUser(userId);
    const { data, error } = await admin
      .from("upgrade_requests")
      .select("id,workspace_id,requested_by,feature,required_plan,message,created_at")
      .eq("account_id", account.id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new HttpError(503, "Could not load requests.");
    const rows = data ?? [];
    const workspaceIds = [...new Set(rows.map((row) => String(row.workspace_id)))];
    const { data: spaces } = workspaceIds.length
      ? await admin.from("workspaces").select("id,name").in("id", workspaceIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const names = new Map((spaces ?? []).map((space) => [String(space.id), String(space.name)]));
    const people = new Map<string, string>();
    for (const id of [...new Set(rows.map((row) => String(row.requested_by)))]) {
      const { data: person } = await admin.auth.admin.getUserById(id);
      people.set(id, person?.user?.email ?? "A teammate");
    }
    return {
      requests: rows.map((row) => ({
        id: String(row.id),
        brand: names.get(String(row.workspace_id)) ?? "A brand",
        requester: people.get(String(row.requested_by)) ?? "A teammate",
        feature: row.feature as string,
        requiredPlan: (row.required_plan as string | null) ?? null,
        message: (row.message as string | null) ?? null,
        at: String(row.created_at),
      })),
    };
  },
});

/** Owner only: dismiss a teammate request once it is handled. */
export const PATCH = defineRoute({
  name: "billing.upgrade-requests.dismiss",
  auth: "user",
  body: z.object({ id: z.string().uuid() }),
  rateLimit: "billing-read",
  handler: async ({ userId, body }) => {
    const { accountForUser } = await import("@/server/billing/accounts.server");
    const account = await accountForUser(userId);
    const { error } = await admin
      .from("upgrade_requests")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("account_id", account.id);
    if (error) throw new HttpError(503, "Could not update the request.");
    return { ok: true as const };
  },
});
