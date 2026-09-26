import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";

const admin = supabaseAdmin as unknown as SupabaseClient;
const CACHE_MS = 15_000;

export type BillingAccount = {
  id: string;
  owner_user_id: string;
  plan_id: string;
  entitled_plan_id: string | null;
  billing_interval: "month" | "year" | null;
  status: string;
  trial_ends_at: string | null;
  trial_used: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  grant_anchor: string | null;
  next_grant_at: string | null;
  grace_until: string | null;
  comped_plan_id: string | null;
  comped_until: string | null;
  enforcement_override: "off" | "shadow" | "on" | null;
  created_at: string;
};

export type WorkspaceAccount = {
  account: BillingAccount;
  workspaceId: string;
  frozenAt: string | null;
  monthlyCreditCap: number | null;
};

const accountCache = new Map<string, { value: BillingAccount; until: number }>();
const workspaceCache = new Map<string, { value: WorkspaceAccount; until: number }>();
const grantCheckUntil = new Map<string, number>();

async function ensureFirstGrants(account: BillingAccount): Promise<void> {
  if ((grantCheckUntil.get(account.id) ?? 0) > Date.now()) return;
  const { ensureSignupGrant, ensureInitialFreeGrant } = await import("./grants.server");
  await ensureSignupGrant(account);
  await ensureInitialFreeGrant(account);
  grantCheckUntil.set(account.id, Date.now() + 5 * 60_000);
}

function cached<T>(map: Map<string, { value: T; until: number }>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cache<T>(map: Map<string, { value: T; until: number }>, key: string, value: T): T {
  map.set(key, { value, until: Date.now() + CACHE_MS });
  return value;
}

export function invalidateBillingAccount(accountId?: string): void {
  if (!accountId) {
    accountCache.clear();
    workspaceCache.clear();
    grantCheckUntil.clear();
    return;
  }
  accountCache.delete(accountId);
  grantCheckUntil.delete(accountId);
  for (const [workspaceId, entry] of workspaceCache) {
    if (entry.value.account.id === accountId) workspaceCache.delete(workspaceId);
  }
}

async function readAccount(accountId: string): Promise<BillingAccount> {
  const hit = cached(accountCache, accountId);
  if (hit) return hit;
  const { data, error } = await admin
    .from("billing_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error || !data) throw new HttpError(500, "Could not load billing account.");
  return cache(accountCache, accountId, data as BillingAccount);
}

export async function ensureAccount(userId: string): Promise<BillingAccount> {
  const { data, error } = await admin.rpc("ensure_billing_account", { p_user: userId });
  if (error || typeof data !== "string") {
    throw new HttpError(500, "Could not create billing account.");
  }
  const account = await readAccount(data);
  await ensureFirstGrants(account);
  return account;
}

export async function accountForUser(userId: string): Promise<BillingAccount> {
  const { data, error } = await admin
    .from("billing_accounts")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load billing account.");
  if (!data?.id) return ensureAccount(userId);
  const account = await readAccount(String(data.id));
  await ensureFirstGrants(account);
  return account;
}

/** Only call after membership has been verified by defineRoute or the caller. */
export async function accountForWorkspace(workspaceId: string): Promise<WorkspaceAccount> {
  const hit = cached(workspaceCache, workspaceId);
  if (hit) return hit;
  const { data, error } = await admin
    .from("workspaces")
    .select("billing_account_id,frozen_at,monthly_credit_cap")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error || !data?.billing_account_id) throw new HttpError(404, "Workspace not found.");
  const account = await readAccount(String(data.billing_account_id));
  await ensureFirstGrants(account);
  const value: WorkspaceAccount = {
    account,
    workspaceId,
    frozenAt: (data.frozen_at as string | null) ?? null,
    monthlyCreditCap: data.monthly_credit_cap == null ? null : Number(data.monthly_credit_cap),
  };
  return cache(workspaceCache, workspaceId, value);
}
