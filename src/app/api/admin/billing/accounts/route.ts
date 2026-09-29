// Billing admin console: find an account and read everything about it.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBillingAdmin } from "@/server/billing/admin.server";
import type { BillingAccount } from "@/server/billing/accounts.server";

export const dynamic = "force-dynamic";
const admin = supabaseAdmin as unknown as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function emailsFor(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(userIds)].map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) out.set(id, data.user.email);
    }),
  );
  return out;
}

/** Scan auth users for an email fragment (fine at launch scale: 5,000 users max). */
async function usersByEmail(fragment: string): Promise<string[]> {
  const needle = fragment.toLowerCase();
  const found: string[] = [];
  for (let page = 1; page <= 5 && found.length < 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new HttpError(503, "Could not search users.");
    for (const user of data.users) {
      if (user.email?.toLowerCase().includes(needle)) found.push(user.id);
    }
    if (data.users.length < 1000) break;
  }
  return found.slice(0, 25);
}

async function walletOf(accountId: string) {
  const { data, error } = await admin.rpc("account_wallet", { p_account: accountId });
  if (error) return null;
  const meters: Record<string, { available: number; held: number; debt: number }> = {};
  for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
    meters[String(row.meter)] = {
      available: Number(row.available ?? 0),
      held: Number(row.held ?? 0),
      debt: Number(row.debt ?? 0),
    };
  }
  return meters;
}

function summary(account: BillingAccount, email: string | undefined, brands: number) {
  const now = Date.now();
  const comped =
    account.comped_plan_id &&
    account.comped_until &&
    new Date(account.comped_until).getTime() > now;
  return {
    id: account.id,
    ownerUserId: account.owner_user_id,
    email: email ?? null,
    plan: comped ? account.comped_plan_id : account.plan_id,
    status: comped ? "manual" : account.status,
    manualUntil: comped ? account.comped_until : null,
    interval: account.billing_interval,
    provider: account.provider ?? null,
    brands,
    createdAt: account.created_at,
  };
}

export const GET = defineRoute({
  name: "billing.admin.accounts",
  auth: "user",
  query: z.object({ q: z.string().trim().max(120).optional(), id: z.string().uuid().optional() }),
  rateLimit: "billing-admin",
  handler: async ({ userId, query }) => {
    requireBillingAdmin(userId);
    if (query.id) return { account: await detail(query.id) };

    const q = query.q ?? "";
    let accountIds: string[] | null = null;
    if (UUID.test(q)) {
      const [byId, byOwner, byWorkspace] = await Promise.all([
        admin.from("billing_accounts").select("id").eq("id", q),
        admin.from("billing_accounts").select("id").eq("owner_user_id", q),
        admin.from("workspaces").select("billing_account_id").eq("id", q),
      ]);
      accountIds = [
        ...(byId.data ?? []).map((row) => String(row.id)),
        ...(byOwner.data ?? []).map((row) => String(row.id)),
        ...(byWorkspace.data ?? []).map((row) => String(row.billing_account_id)),
      ];
    } else if (q.includes("@")) {
      const owners = await usersByEmail(q);
      const { data } = owners.length
        ? await admin.from("billing_accounts").select("id").in("owner_user_id", owners)
        : { data: [] };
      accountIds = (data ?? []).map((row) => String(row.id));
    } else if (q) {
      const { data } = await admin
        .from("workspaces")
        .select("billing_account_id")
        .or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,domain.ilike.%${q.replace(/[%,()]/g, "")}%`)
        .limit(50);
      accountIds = (data ?? []).map((row) => String(row.billing_account_id));
    }
    let rows = admin.from("billing_accounts").select("*").order("updated_at", { ascending: false });
    if (accountIds) rows = rows.in("id", [...new Set(accountIds)].slice(0, 50));
    const { data, error } = await rows.limit(30);
    if (error) throw new HttpError(503, "Could not load accounts.");
    const accounts = (data ?? []) as BillingAccount[];
    const ids = accounts.map((account) => account.id);
    const { data: spaces } = ids.length
      ? await admin
          .from("workspaces")
          .select("billing_account_id")
          .in("billing_account_id", ids)
          .is("duplicate_of", null)
      : { data: [] };
    const brandCount = new Map<string, number>();
    for (const row of spaces ?? []) {
      const key = String(row.billing_account_id);
      brandCount.set(key, (brandCount.get(key) ?? 0) + 1);
    }
    const emails = await emailsFor(accounts.map((account) => account.owner_user_id));
    return {
      accounts: accounts.map((account) =>
        summary(account, emails.get(account.owner_user_id), brandCount.get(account.id) ?? 0),
      ),
    };
  },
});

async function detail(accountId: string) {
  const { data: account, error } = await admin
    .from("billing_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not load the account.");
  if (!account) throw new HttpError(404, "Account not found.");
  const typed = account as BillingAccount;
  const [spaces, ledger, grants, requests, activations, wallet] = await Promise.all([
    admin
      .from("workspaces")
      .select("id,name,domain,frozen_at,created_at")
      .eq("billing_account_id", accountId)
      .is("duplicate_of", null)
      .order("created_at", { ascending: true }),
    admin
      .from("meter_ledger")
      .select("id,meter,kind,delta_available,action,reason,workspace_id,created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(40),
    admin
      .from("meter_grants")
      .select("id,meter,source,restriction,amount,remaining,expires_at,created_at")
      .eq("account_id", accountId)
      .gt("remaining", 0)
      .order("created_at", { ascending: false })
      .limit(40),
    admin
      .from("billing_purchase_requests")
      .select("id,kind,catalog_key,billing_interval,status,contact,note,created_at,handled_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("billing_manual_activations")
      .select(
        "id,kind,catalog_key,billing_interval,months,active_until,reference,reason,created_at",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(20),
    walletOf(accountId),
  ]);
  const emails = await emailsFor([typed.owner_user_id]);
  return {
    ...summary(typed, emails.get(typed.owner_user_id), (spaces.data ?? []).length),
    enforcementOverride: typed.enforcement_override,
    periodEnd: typed.current_period_end,
    nextGrantAt: typed.next_grant_at,
    wallet,
    brands: spaces.data ?? [],
    ledger: ledger.data ?? [],
    grants: grants.data ?? [],
    requests: requests.data ?? [],
    activations: activations.data ?? [],
  };
}
