import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADDONS,
  FEATURES,
  PAUSE,
  PLANS,
  planAllows,
  type FeatureKey,
  type Meter,
  type PlanId,
} from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  accountForUser,
  accountForWorkspace,
  invalidateBillingAccount,
  type BillingAccount,
} from "./accounts.server";

const admin = supabaseAdmin as unknown as SupabaseClient;
type Role = "owner" | "admin" | "editor" | "viewer";
type Addon = { catalog_key: string; quantity: number };

export type Entitlements = {
  accountId: string;
  ownerUserId: string;
  isOwner: boolean;
  role: Role;
  plan: PlanId;
  entitledPlan: PlanId;
  interval: "month" | "year" | null;
  status: string;
  enforcement: "off" | "shadow" | "on";
  trial: { active: boolean; endsAt: string | null; used: boolean };
  period: { start: string | null; end: string | null; nextGrantAt: string | null };
  frozen: boolean;
  addons: Array<{ key: string; quantity: number }>;
  features: Record<FeatureKey, { allowed: boolean; requiredPlan: PlanId }>;
  limits: (typeof PLANS)[PlanId]["limits"] & { brands: number; seats: number | null };
  usage: {
    brands: number;
    seats: number;
    socialProfiles: number;
    trackedPrompts: number;
    scansUsed: number;
    competitors: number;
    openExperiments: number;
    rendersRunning: number;
  };
  meters: Record<
    Meter,
    { available: number; held: number; debt: number; nextExpiry: string | null }
  >;
};

export function validPlan(value: string | null | undefined): PlanId {
  return value && value in PLANS ? (value as PlanId) : "free";
}

export function enforcementFor(account: BillingAccount): "off" | "shadow" | "on" {
  return (
    account.enforcement_override ??
    (process.env.BILLING_ENFORCEMENT === "on" || process.env.BILLING_ENFORCEMENT === "shadow"
      ? process.env.BILLING_ENFORCEMENT
      : "off")
  );
}

export function entitledPlanFor(account: BillingAccount, now = new Date()): PlanId {
  if (account.comped_plan_id && account.comped_until && new Date(account.comped_until) > now) {
    return validPlan(account.comped_plan_id);
  }
  if (account.status === "paused" || account.status === "canceled") return "free";
  if (
    account.status === "past_due" &&
    (!account.grace_until || new Date(account.grace_until) <= now)
  ) {
    return "free";
  }
  return validPlan(account.entitled_plan_id ?? account.plan_id);
}

export function limitsFor(plan: PlanId, addons: Addon[], paused = false): Entitlements["limits"] {
  const base = PLANS[plan];
  const limits: Entitlements["limits"] = {
    ...base.limits,
    engines: [...base.limits.engines],
    brands: base.brands,
    seats: base.seats,
  };
  if (paused) {
    limits.trackedPrompts = PAUSE.trackedPrompts;
    limits.engines = [...PAUSE.engines];
    limits.promptCadence = "weekly";
    limits.maxConcurrentExperiments = 0;
    limits.maxConcurrentRenders = 0;
    limits.scansPerMonth = 0;
    limits.socialProfiles = 0;
    return limits;
  }
  for (const item of addons) {
    const addon = ADDONS[item.catalog_key as keyof typeof ADDONS];
    if (!addon || addon.availability !== "launch" || !addon.plans.includes(plan as never)) continue;
    const quantity = Math.max(0, item.quantity);
    for (const key of [
      "brands",
      "socialProfiles",
      "trackedPrompts",
      "seats",
      "marketBrainWeeklyBrands",
    ] as const) {
      const amount = addon.adds[key];
      if (typeof amount === "number" && limits[key] !== null) {
        (limits as unknown as Record<string, number>)[key] += amount * quantity;
      }
    }
  }
  return limits;
}

const emptyMeters = (): Entitlements["meters"] => ({
  credits: { available: 0, held: 0, debt: 0, nextExpiry: null },
  video: { available: 0, held: 0, debt: 0, nextExpiry: null },
  pro_messages: { available: 0, held: 0, debt: 0, nextExpiry: null },
  flash_messages: { available: 0, held: 0, debt: 0, nextExpiry: null },
});

export function resolveEntitlements(args: {
  account: BillingAccount;
  userId: string;
  role: Role;
  frozen?: boolean;
  addons?: Addon[];
  usage?: Entitlements["usage"];
  meters?: Entitlements["meters"];
  now?: Date;
}): Entitlements {
  const { account } = args;
  const now = args.now ?? new Date();
  const plan = validPlan(account.plan_id);
  const entitledPlan = entitledPlanFor(account, now);
  const paused = account.status === "paused";
  const features = Object.fromEntries(
    Object.entries(FEATURES).map(([key, feature]) => [
      key,
      {
        allowed: !paused && planAllows(entitledPlan, key as FeatureKey),
        requiredPlan: feature.minPlan,
      },
    ]),
  ) as Entitlements["features"];
  return {
    accountId: account.id,
    ownerUserId: account.owner_user_id,
    isOwner: args.userId === account.owner_user_id,
    role: args.role,
    plan,
    entitledPlan,
    interval: account.billing_interval,
    status: account.status,
    enforcement: enforcementFor(account),
    trial: {
      active:
        account.status === "trialing" &&
        Boolean(account.trial_ends_at && new Date(account.trial_ends_at) > now),
      endsAt: account.trial_ends_at,
      used: account.trial_used,
    },
    period: {
      start: account.current_period_start,
      end: account.current_period_end,
      nextGrantAt: account.next_grant_at,
    },
    frozen: Boolean(args.frozen),
    addons: (args.addons ?? [])
      .filter((item) => item.catalog_key in ADDONS)
      .map((item) => ({ key: item.catalog_key, quantity: item.quantity })),
    features,
    limits: limitsFor(entitledPlan, args.addons ?? [], paused),
    usage: args.usage ?? {
      brands: 0,
      seats: 0,
      socialProfiles: 0,
      trackedPrompts: 0,
      scansUsed: 0,
      competitors: 0,
      openExperiments: 0,
      rendersRunning: 0,
    },
    meters: args.meters ?? emptyMeters(),
  };
}

export async function getEntitlements(args: {
  userId: string;
  workspaceId?: string;
  role?: Role;
  skipCapacityReconcile?: boolean;
}): Promise<Entitlements> {
  const workspace = args.workspaceId ? await accountForWorkspace(args.workspaceId) : null;
  const account = workspace?.account ?? (await accountForUser(args.userId));
  const [items, spaces, wallet, expiring] = await Promise.all([
    admin
      .from("billing_subscription_items")
      .select("catalog_key,quantity")
      .eq("account_id", account.id)
      .eq("status", "active"),
    admin
      .from("workspaces")
      .select("id,owner_id")
      .eq("billing_account_id", account.id)
      .is("duplicate_of", null),
    admin.rpc("account_wallet", { p_account: account.id }),
    admin
      .from("meter_grants")
      .select("meter,expires_at")
      .eq("account_id", account.id)
      .gt("remaining", 0)
      .gte("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true }),
  ]);
  if (items.error || spaces.error || wallet.error || expiring.error)
    throw new Error("Could not load billing entitlements.");
  const workspaceIds = (spaces.data ?? []).map((row) => String(row.id));
  const members = workspaceIds.length
    ? await admin.from("workspace_members").select("user_id,role").in("workspace_id", workspaceIds)
    : { data: [], error: null };
  if (members.error) throw new Error("Could not load billing seats.");
  const seats = new Set<string>([account.owner_user_id]);
  for (const member of members.data ?? []) {
    if (member.role !== "viewer") seats.add(String(member.user_id));
  }
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [scans, competitors, experiments, renders, profiles] = await Promise.all([
    admin
      .from("allowance_usage")
      .select("scans_used")
      .eq("account_id", account.id)
      .gte("window_start", monthStart.toISOString()),
    workspaceIds.length
      ? admin
          .from("workspace_competitors")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
          .eq("status", "tracked")
      : Promise.resolve({ count: 0, error: null }),
    workspaceIds.length
      ? admin
          .from("experiments")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
          .in("status", ["running", "analyzing"])
      : Promise.resolve({ count: 0, error: null }),
    workspaceIds.length
      ? admin
          .from("ugc_renders")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
          .in("status", ["queued", "processing", "persisting"])
      : Promise.resolve({ count: 0, error: null }),
    workspaceIds.length
      ? admin
          .from("social_accounts")
          .select("workspace_id")
          .in("workspace_id", workspaceIds)
          .eq("provider", "socialapi")
          .in("status", ["active", "reconnect_required"])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (scans.error || competitors.error || experiments.error || renders.error || profiles.error) {
    throw new Error("Could not load billing usage limits.");
  }
  const meters = emptyMeters();
  for (const row of (Array.isArray(wallet.data) ? wallet.data : []) as Array<
    Record<string, unknown>
  >) {
    const meter = String(row.meter) as Meter;
    if (!(meter in meters)) continue;
    meters[meter] = {
      available: Number(row.available ?? 0),
      held: Number(row.held ?? 0),
      debt: Number(row.debt ?? 0),
      nextExpiry: (row.next_expiry as string | null) ?? null,
    };
  }
  for (const row of expiring.data ?? []) {
    const meter = String(row.meter) as Meter;
    if (meter in meters && !meters[meter].nextExpiry) {
      meters[meter].nextExpiry = String(row.expires_at);
    }
  }
  const entitlements = resolveEntitlements({
    account,
    userId: args.userId,
    role: args.role ?? "owner",
    frozen: Boolean(workspace?.frozenAt),
    addons: (items.data ?? []) as Addon[],
    usage: {
      brands: workspaceIds.length,
      seats: seats.size,
      socialProfiles: new Set((profiles.data ?? []).map((row) => String(row.workspace_id))).size,
      trackedPrompts: 0,
      scansUsed: (scans.data ?? []).reduce((sum, row) => sum + Number(row.scans_used ?? 0), 0),
      competitors: competitors.count ?? 0,
      openExperiments: experiments.count ?? 0,
      rendersRunning: renders.count ?? 0,
    },
    meters,
  });
  if (
    entitlements.enforcement === "on" &&
    !args.skipCapacityReconcile &&
    (!account.capacity_reconciled_at ||
      new Date(account.capacity_reconciled_at) < new Date(account.updated_at ?? account.created_at))
  ) {
    const { error: capacityError } = await admin.rpc("reconcile_billing_capacity", {
      p_account: account.id,
      p_brand_limit: entitlements.limits.brands,
      p_seat_limit: entitlements.limits.seats,
      p_preferred_workspace: null,
    });
    if (capacityError) throw new Error("Could not apply account capacity.");
    const { error: stampError } = await admin
      .from("billing_accounts")
      .update({ capacity_reconciled_at: new Date().toISOString() })
      .eq("id", account.id);
    if (stampError) throw new Error("Could not record account capacity check.");
    invalidateBillingAccount(account.id);
    if (args.workspaceId) {
      const [brand, member] = await Promise.all([
        admin.from("workspaces").select("frozen_at").eq("id", args.workspaceId).single(),
        admin
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", args.workspaceId)
          .eq("user_id", args.userId)
          .single(),
      ]);
      if (brand.error || member.error || !brand.data || !member.data) {
        throw new Error("Could not refresh brand access after reconciliation.");
      }
      entitlements.frozen = Boolean(brand.data.frozen_at);
      entitlements.role = member.data.role as Role;
    }
  }
  return entitlements;
}
