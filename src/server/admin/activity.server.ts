import "server-only";

import { ADDONS, CREDIT_PACKS, PLANS, VIDEO_PACKS, type PlanId } from "@/lib/billing/catalog";
import { buildOverviewActivity, type AdminOverviewActivityItem } from "@/lib/admin/activity";
import type { AdminOverview } from "@/lib/admin/types";
import { emailsFor, showEmail } from "./audit-read.server";
import { adminDb } from "./db.server";

const WINDOW_DAYS = 7;
const SOURCE_LIMIT = 20;

type ProfileRow = { id: string; name: string | null; created_at: string };
type WorkspaceRow = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};
type PaymentRow = {
  account_id: string;
  amount_cents: number;
  catalog_key: string;
  created_at: string;
  kind: string;
  provider_payment_id: string;
  refunded_cents: number;
};
type AccountRow = { id: string; owner_user_id: string };
type UpgradeRow = {
  id: string;
  feature: string;
  requested_by: string;
  required_plan: string | null;
  status: string;
  created_at: string;
};
type JobRow = {
  id: string;
  created_by: string | null;
  title: string | null;
  type: string;
  updated_at: string;
};
type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  tone: string;
  link_url: string | null;
  created_at: string;
};

function sinceIso(now: Date): string {
  return new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

function warn(source: string, error: { code?: string; message?: string }): void {
  console.warn(`[admin.overview.activity] ${source} unavailable`, error.code, error.message);
}

async function loadSources(now: Date) {
  const since = sinceIso(now);
  const [profiles, workspaces, payments, upgrades, jobs, announcements] = await Promise.all([
    adminDb
      .from("profiles")
      .select("id,name,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SOURCE_LIMIT),
    adminDb
      .from("workspaces")
      .select("id,name,owner_id,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SOURCE_LIMIT),
    adminDb
      .from("billing_payment_records")
      .select(
        "account_id,amount_cents,catalog_key,created_at,kind,provider_payment_id,refunded_cents",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SOURCE_LIMIT),
    adminDb
      .from("upgrade_requests")
      .select("id,feature,requested_by,required_plan,status,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SOURCE_LIMIT),
    adminDb
      .from("studio_jobs")
      .select("id,created_by,title,type,updated_at")
      .eq("status", "failed")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(10),
    adminDb
      .from("platform_announcements")
      .select("id,title,body,tone,link_url,created_at")
      .eq("active", true)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (profiles.error) warn("profiles", profiles.error);
  if (workspaces.error) warn("workspaces", workspaces.error);
  if (payments.error) warn("payments", payments.error);
  if (upgrades.error) warn("upgrades", upgrades.error);
  if (jobs.error) warn("jobs", jobs.error);
  if (announcements.error) warn("announcements", announcements.error);

  return {
    profiles: (profiles.error ? [] : (profiles.data ?? [])) as ProfileRow[],
    workspaces: (workspaces.error ? [] : (workspaces.data ?? [])) as WorkspaceRow[],
    payments: (payments.error ? [] : (payments.data ?? [])) as PaymentRow[],
    upgrades: (upgrades.error ? [] : (upgrades.data ?? [])) as UpgradeRow[],
    jobs: (jobs.error ? [] : (jobs.data ?? [])) as JobRow[],
    announcements: (announcements.error ? [] : (announcements.data ?? [])) as AnnouncementRow[],
  };
}

async function loadAccounts(accountIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(accountIds)];
  if (!ids.length) return out;
  const { data, error } = await adminDb
    .from("billing_accounts")
    .select("id,owner_user_id")
    .in("id", ids);
  if (error) {
    warn("billing accounts", error);
    return out;
  }
  for (const row of (data ?? []) as AccountRow[]) out.set(row.id, row.owner_user_id);
  return out;
}

async function loadPeople(
  userIds: string[],
): Promise<{ names: Map<string, string>; emails: Map<string, string> }> {
  const ids = [...new Set(userIds)].slice(0, 100);
  const names = new Map<string, string>();
  if (!ids.length) return { names, emails: new Map() };
  const [{ data, error }, emailsResult] = await Promise.all([
    adminDb.from("profiles").select("id,name,created_at").in("id", ids),
    emailsFor(ids).catch((error: unknown) => {
      console.warn("[admin.overview.activity] emails unavailable", error);
      return new Map<string, string>();
    }),
  ]);
  if (error) warn("profile names", error);
  else {
    for (const row of (data ?? []) as ProfileRow[]) {
      if (row.name?.trim()) names.set(row.id, row.name.trim());
    }
  }
  return { names, emails: emailsResult };
}

function catalogLabel(key: string): string {
  const plan = PLANS[key as PlanId];
  if (plan) return `${plan.label} plan`;
  if (key in ADDONS) return ADDONS[key as keyof typeof ADDONS].label;
  const creditPack = CREDIT_PACKS.find((pack) => pack.key === key);
  if (creditPack) return `${creditPack.credits.toLocaleString()} credit pack`;
  const videoPack = VIDEO_PACKS.find((pack) => pack.key === key);
  if (videoPack) return `${videoPack.videoUnits / 100} Video Credit pack`;
  return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortText(value: string, length = 140): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

export async function getOverviewActivity(
  pii: boolean,
  now = new Date(),
): Promise<AdminOverview["activity"]> {
  const source = await loadSources(now);
  const accountOwners = await loadAccounts(source.payments.map((row) => row.account_id));
  const userIds = [
    ...source.profiles.map((row) => row.id),
    ...source.workspaces.map((row) => row.owner_id),
    ...source.upgrades.map((row) => row.requested_by),
    ...source.jobs.map((row) => row.created_by).filter((id): id is string => Boolean(id)),
    ...accountOwners.values(),
  ];
  const people = await loadPeople(userIds);
  const person = (userId: string | null | undefined, fallback = "A user") => {
    if (!userId) return fallback;
    if (pii && people.names.get(userId)) return people.names.get(userId)!;
    return showEmail(people.emails.get(userId), pii) ?? fallback;
  };

  const items: AdminOverviewActivityItem[] = [];

  for (const payment of source.payments) {
    const netCents = Number(payment.amount_cents) - Number(payment.refunded_cents);
    if (netCents <= 0) continue;
    const owner = accountOwners.get(payment.account_id);
    const subscription = payment.kind === "subscription";
    items.push({
      id: `payment:${payment.provider_payment_id}`,
      kind: subscription ? "subscription" : "purchase",
      title: subscription
        ? `${person(owner, "A customer")} bought the ${catalogLabel(payment.catalog_key)}`
        : `${person(owner, "A customer")} bought ${catalogLabel(payment.catalog_key)}`,
      detail: [
        subscription ? "New paid subscription recorded" : "Additional purchase recorded",
        showEmail(owner ? people.emails.get(owner) : null, pii) ?? `Account ${payment.account_id}`,
      ].join(" · "),
      occurredAt: payment.created_at,
      href: `/admin/billing?account=${encodeURIComponent(payment.account_id)}`,
      amountUsd: netCents / 100,
      tone: "success",
    });
  }

  for (const profile of source.profiles) {
    items.push({
      id: `signup:${profile.id}`,
      kind: "signup",
      title: `${person(profile.id)} joined Mellox`,
      detail: "New user account created",
      occurredAt: profile.created_at,
      href: `/admin/users/${encodeURIComponent(profile.id)}`,
      amountUsd: null,
      tone: "primary",
    });
  }

  for (const workspace of source.workspaces) {
    items.push({
      id: `workspace:${workspace.id}`,
      kind: "workspace",
      title: pii
        ? `${person(workspace.owner_id)} created ${workspace.name}`
        : `${person(workspace.owner_id)} created a workspace`,
      detail: "New workspace created",
      occurredAt: workspace.created_at,
      href: `/admin/workspaces/${encodeURIComponent(workspace.id)}`,
      amountUsd: null,
      tone: "primary",
    });
  }

  for (const request of source.upgrades) {
    items.push({
      id: `upgrade:${request.id}`,
      kind: "upgrade_request",
      title: `${person(request.requested_by)} requested an upgrade`,
      detail: `${request.feature.replaceAll("_", " ")}${request.required_plan ? ` · ${catalogLabel(request.required_plan)} required` : ""} · ${request.status}`,
      occurredAt: request.created_at,
      href: "/admin/billing",
      amountUsd: null,
      tone: request.status === "pending" ? "warning" : "neutral",
    });
  }

  for (const job of source.jobs) {
    items.push({
      id: `job:${job.id}`,
      kind: "job_failed",
      title: `${job.title?.trim() || job.type.replaceAll("_", " ")} failed`,
      detail: `${person(job.created_by)} may need assistance`,
      occurredAt: job.updated_at,
      href: "/admin/jobs",
      amountUsd: null,
      tone: "danger",
    });
  }

  for (const announcement of source.announcements) {
    items.push({
      id: `announcement:${announcement.id}`,
      kind: "announcement",
      title: announcement.title,
      detail: shortText(announcement.body),
      occurredAt: announcement.created_at,
      href: announcement.link_url || "/admin/announcements",
      amountUsd: null,
      tone:
        announcement.tone === "danger"
          ? "danger"
          : announcement.tone === "warning"
            ? "warning"
            : "primary",
    });
  }

  return buildOverviewActivity(items, { now, windowDays: WINDOW_DAYS, limit: 30 });
}
