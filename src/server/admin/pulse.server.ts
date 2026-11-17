// The admin pulse: customers by plan, credits left, active time, what people
// were doing and their errors, from stored rows only (billing accounts, credit
// balances, AI calls, Studio jobs, workspaces). Pure half: src/lib/admin/pulse.ts.
import "server-only";

import type { AdminPulse } from "@/lib/admin/types";
import { buildPulse, PULSE_DAYS, type PulseInput } from "@/lib/admin/pulse";
import { PLANS, type PlanId } from "@/lib/billing/catalog";
import { entitledPlanFor } from "@/server/billing/entitlements.server";
import type { BillingAccount } from "@/server/billing/accounts.server";
import { getOverviewActivity } from "./activity.server";
import { emailsFor, showEmail } from "./audit-read.server";
import { adminDb, httpErrorFromPg } from "./db.server";

const PAGE = 1_000;
/** Most rows read from one source; past this the pulse says it is a floor. */
const MAX_ROWS = { users: 5_000, workspaces: 10_000, calls: 40_000, jobs: 10_000 };
const EMAIL_CHUNK = 100;
const PLAN_ORDER: PlanId[] = ["starter", "growth", "agency", "scale", "free"];

type Paged<T> = { rows: T[]; truncated: boolean };

async function readAll<T>(
  label: string,
  max: number,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Paged<T>> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, Math.min(from + PAGE, max) - 1);
    if (error) throw httpErrorFromPg(error as { code?: string }, `Could not load ${label}.`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function emailMap(ids: string[], pii: boolean): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += EMAIL_CHUNK)
    chunks.push(unique.slice(i, i + EMAIL_CHUNK));
  const results = await Promise.all(chunks.map(emailsFor));
  for (const result of results) {
    for (const [id, email] of result) out.set(id, showEmail(email, pii));
  }
  return out;
}

export async function getPulse(pii: boolean, now = new Date()): Promise<AdminPulse> {
  const since = new Date(now.getTime() - PULSE_DAYS * 86_400_000).toISOString();

  const [profiles, accounts, balances, workspaces, calls, jobs, activity] = await Promise.all([
    readAll<{ id: string; name: string | null; created_at: string }>(
      "people",
      MAX_ROWS.users,
      (from, to) =>
        adminDb
          .from("profiles")
          .select("id,name,created_at")
          .order("created_at", { ascending: false })
          .range(from, to),
    ),
    readAll<BillingAccount>("billing accounts", MAX_ROWS.users, (from, to) =>
      adminDb
        .from("billing_accounts")
        .select(
          "id,owner_user_id,plan_id,entitled_plan_id,billing_interval,status,trial_ends_at,trial_used,current_period_start,current_period_end,grant_anchor,next_grant_at,grace_until,comped_plan_id,comped_until,enforcement_override,pro_overage_mode,provider,created_at,updated_at",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readAll<{ account_id: string; available: number | string }>(
      "credit balances",
      MAX_ROWS.users,
      (from, to) =>
        adminDb
          .from("meter_balances")
          .select("account_id,available")
          .eq("meter", "credits")
          .order("account_id", { ascending: true })
          .range(from, to),
    ),
    readAll<{ id: string; name: string; owner_id: string; created_at: string }>(
      "workspaces",
      MAX_ROWS.workspaces,
      (from, to) =>
        adminDb
          .from("workspaces")
          .select("id,name,owner_id,created_at")
          .order("created_at", { ascending: false })
          .range(from, to),
    ),
    readAll<{
      user_id: string | null;
      workspace_id: string | null;
      route: string;
      status: string;
      created_at: string;
    }>("AI activity", MAX_ROWS.calls, (from, to) =>
      adminDb
        .from("ai_usage_events")
        .select("user_id,workspace_id,route,status,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    readAll<{
      id: string;
      created_by: string | null;
      workspace_id: string;
      type: string;
      title: string | null;
      status: string;
      error: unknown;
      created_at: string;
    }>("Studio jobs", MAX_ROWS.jobs, (from, to) =>
      adminDb
        .from("studio_jobs")
        .select("id,created_by,workspace_id,type,title,status,error,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    getOverviewActivity(pii).catch(() => null),
  ]);

  const credits = new Map(balances.rows.map((row) => [row.account_id, Number(row.available ?? 0)]));
  const emails = await emailMap(
    profiles.rows.map((row) => row.id),
    pii,
  );

  const planLabels: Record<string, string> = Object.fromEntries(
    Object.entries(PLANS).map(([id, plan]) => [id, plan.label]),
  );

  // A person with several accounts is shown on their best plan.
  const rank = (id: string) => {
    const index = PLAN_ORDER.indexOf(id as PlanId);
    return index === -1 ? PLAN_ORDER.length : PLAN_ORDER.length - index;
  };
  const byOwner = new Map<string, PulseInput["accounts"][number]>();
  for (const account of accounts.rows) {
    const planId = entitledPlanFor(account, now);
    const row = {
      ownerUserId: account.owner_user_id,
      planId,
      planLabel: PLANS[planId]?.label ?? planId,
      status: account.status,
      creditsUnits: credits.get(account.id) ?? 0,
      allowanceUnits: PLANS[planId]?.allowances.credits ?? 0,
    };
    const existing = byOwner.get(account.owner_user_id);
    if (!existing || rank(planId) > rank(existing.planId)) byOwner.set(account.owner_user_id, row);
  }

  const pulse = buildPulse({
    now,
    users: profiles.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: emails.get(row.id) ?? null,
      createdAt: row.created_at,
    })),
    accounts: [...byOwner.values()],
    workspaces: workspaces.rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      createdAt: row.created_at,
    })),
    calls: calls.rows.map((row) => ({
      userId: row.user_id,
      workspaceId: row.workspace_id,
      route: row.route,
      status: row.status,
      at: row.created_at,
    })),
    jobs: jobs.rows.map((row) => ({
      id: row.id,
      userId: row.created_by,
      workspaceId: row.workspace_id,
      type: row.type,
      title: row.title,
      status: row.status,
      error: row.error,
      at: row.created_at,
    })),
    planOrder: PLAN_ORDER,
    planLabels,
  });

  return {
    generatedAt: now.toISOString(),
    truncated: [profiles, accounts, balances, workspaces, calls, jobs].some((r) => r.truncated),
    ...pulse,
    feed: activity?.items ?? [],
  };
}
