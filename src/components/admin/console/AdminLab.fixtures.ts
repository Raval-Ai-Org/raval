// Sample responses for /admin-lab (development only). Typed against the real
// response shapes in src/lib/admin/types.ts, so a change to an API shape breaks
// the build here instead of silently drifting from what the screens expect.

import { FEATURES, PLANS, type FeatureKey } from "@/lib/billing/catalog";
import { OVERRIDE_LIMIT_KEYS } from "@/lib/billing/overrides";
import { calculateFunding } from "@/lib/admin/funding";
import {
  ROLE_PRESETS,
  effectivePermissions,
  maskEmail,
  type AdminRoleKey,
} from "@/lib/admin/permissions";
import type {
  AdminAbuseSignals,
  AdminJobs,
  AdminAiControls,
  AdminSupportView,
  AdminAnalytics,
  AdminAnnouncement,
  AdminIntegrations,
  AdminLookup,
  AdminFlag,
  AdminHealth,
  AdminSwitch,
  AdminUsage,
  AdminAuditRow,
  AdminEntitlementView,
  AdminMe,
  AdminFinanceOverview,
  AdminOverview,
  AdminSecurity,
  AdminTeamMember,
  AdminUserDetail,
  AdminUserRow,
  AdminWorkspaceDetail,
  AdminWorkspaceRow,
  Paged,
} from "@/lib/admin/types";

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export const LAB_ROLES = Object.keys(ROLE_PRESETS) as AdminRoleKey[];

export function labMe(role: AdminRoleKey): AdminMe {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    role,
    roleLabel: ROLE_PRESETS[role].label,
    permissions: effectivePermissions(role),
    source: "team",
    billing: role === "super_admin" || role === "finance",
    mfaRequired: true,
  };
}

const U = (n: number) => `1000000${n}-0000-4000-8000-00000000000${n}`;
const W = (n: number) => `2000000${n}-0000-4000-8000-00000000000${n}`;
const ACCOUNT = "30000001-0000-4000-8000-000000000001";

function users(pii: boolean): AdminUserRow[] {
  const raw: Array<Omit<AdminUserRow, "email"> & { email: string }> = [
    {
      id: U(1),
      email: "amelia.hartwell@brightpath-marketing.example",
      name: "Amelia Hartwell",
      createdAt: ago(24 * 90),
      lastSignInAt: ago(2),
      suspended: false,
      emailConfirmed: true,
      providers: ["google"],
      workspaceCount: 3,
      persona: "agency",
      isAdmin: false,
    },
    {
      id: U(2),
      email: "k.nakamura@tinyfoundry.example",
      name: null,
      createdAt: ago(24 * 12),
      lastSignInAt: null,
      suspended: false,
      emailConfirmed: false,
      providers: ["email"],
      workspaceCount: 0,
      persona: null,
      isAdmin: false,
    },
    {
      id: U(3),
      email:
        "billing-problem-with-a-really-long-address-for-wrapping@subdomain.example-company.example",
      name: "Sam Okafor",
      createdAt: ago(24 * 200),
      lastSignInAt: ago(24 * 40),
      suspended: true,
      emailConfirmed: true,
      providers: ["email", "google"],
      workspaceCount: 1,
      persona: "founder",
      isAdmin: false,
    },
    {
      id: U(4),
      email: "support@mellox.example",
      name: "Mellox Support",
      createdAt: ago(24 * 300),
      lastSignInAt: ago(0.2),
      suspended: false,
      emailConfirmed: true,
      providers: ["google"],
      workspaceCount: 1,
      persona: null,
      isAdmin: true,
    },
  ];
  return raw.map((user) => ({ ...user, email: pii ? user.email : maskEmail(user.email) }));
}

export function labUsers(pii: boolean): Paged<AdminUserRow> {
  const rows = users(pii);
  return { total: 1284, page: 1, pageSize: 25, rows };
}

export function labUserDetail(pii: boolean): AdminUserDetail {
  const [user] = users(pii);
  return {
    user: { ...user!, bannedUntil: null, sessions: 3, mfaFactors: 0 },
    workspaces: [
      { id: W(1), name: "Brightpath Bakery", role: "owner", plan: "growth", owned: true },
      { id: W(2), name: "Northside Dental", role: "editor", plan: "starter", owned: false },
    ],
    billing: [
      {
        id: ACCOUNT,
        planId: "growth",
        status: "active",
        trialEndsAt: null,
        currentPeriodEnd: ahead(12),
        comped: false,
      },
    ],
    notes: [
      {
        id: "n1",
        authorId: U(4),
        authorEmail: pii ? "support@mellox.example" : maskEmail("support@mellox.example"),
        body: "Asked about moving their annual plan to monthly. Told them to use the billing page.\nFollow up next week.",
        createdAt: ago(30),
      },
    ],
    audit: labAudit(pii).rows.slice(0, 3),
  };
}

function workspaces(pii: boolean): AdminWorkspaceRow[] {
  const owner = (email: string) => (pii ? email : maskEmail(email));
  return [
    {
      id: W(1),
      name: "Brightpath Bakery",
      domain: "brightpathbakery.example",
      plan: "growth",
      billingPlan: "growth",
      billingStatus: "active",
      ownerId: U(1),
      ownerEmail: owner("amelia.hartwell@brightpath-marketing.example"),
      memberCount: 4,
      createdAt: ago(24 * 80),
      frozen: false,
      frozenReason: null,
    },
    {
      id: W(2),
      name: "Northside Dental",
      domain: null,
      plan: "free",
      billingPlan: "free",
      billingStatus: "free",
      ownerId: U(3),
      ownerEmail: owner(
        "billing-problem-with-a-really-long-address-for-wrapping@subdomain.example-company.example",
      ),
      memberCount: 1,
      createdAt: ago(24 * 9),
      frozen: true,
      frozenReason: "Over the brand limit for the plan",
    },
  ];
}

export function labWorkspaces(pii: boolean): Paged<AdminWorkspaceRow> {
  return { total: 312, page: 1, pageSize: 25, rows: workspaces(pii) };
}

export function labWorkspaceDetail(pii: boolean): AdminWorkspaceDetail {
  const [workspace] = workspaces(pii);
  return {
    workspace: {
      ...workspace!,
      industry: "Food & beverage",
      websiteUrl: "https://brightpathbakery.example",
      onboardedAt: ago(24 * 79),
    },
    members: [
      {
        userId: U(1),
        email: workspace!.ownerEmail,
        role: "owner",
        joinedAt: ago(24 * 80),
      },
      {
        userId: U(2),
        email: pii ? "k.nakamura@tinyfoundry.example" : maskEmail("k.nakamura@tinyfoundry.example"),
        role: "editor",
        joinedAt: ago(24 * 20),
      },
    ],
    billing: {
      id: ACCOUNT,
      planId: "growth",
      status: "active",
      trialEndsAt: null,
      currentPeriodEnd: ahead(12),
      comped: false,
    },
    studioJobs7d: { succeeded: 41, failed: 3, running: 1 },
    access: { mode: "read_only", reason: "Chargeback under review", changedAt: minutesAgo(90) },
    audit: labAudit(pii).rows.slice(1, 3),
  };
}

export function labEntitlements(pii: boolean): AdminEntitlementView {
  const ws = labWorkspaceDetail(pii).workspace;
  const entitledPlan = "starter";
  const sold = (Object.keys(FEATURES) as FeatureKey[]).filter(
    (key) => (FEATURES[key].availability ?? "launch") === "launch",
  );
  const planRank = ["free", "starter", "growth", "agency", "scale"];
  const planHas = (key: FeatureKey) =>
    planRank.indexOf(entitledPlan) >= planRank.indexOf(FEATURES[key].minPlan);
  return {
    workspace: { id: ws.id, name: ws.name },
    account: {
      id: ACCOUNT,
      plan: entitledPlan,
      entitledPlan,
      status: "active",
      enforcement: "on",
      ownerEmail: ws.ownerEmail,
      overridesEnabled: true,
    },
    features: (Object.keys(FEATURES) as FeatureKey[]).map((key) => {
      const overridden = key === "ugc" || key === "autopilot";
      const allowed = key === "ugc" ? true : key === "autopilot" ? false : planHas(key);
      return {
        key,
        label: FEATURES[key].label,
        module: FEATURES[key].module,
        sold: sold.includes(key),
        allowed,
        planAllows: planHas(key),
        requiredPlan: FEATURES[key].minPlan,
        source: overridden ? ("override" as const) : ("plan" as const),
        ...(overridden
          ? { overrideScope: key === "ugc" ? ("workspace" as const) : ("account" as const) }
          : {}),
      };
    }),
    limits: OVERRIDE_LIMIT_KEYS.map((key) => {
      const planValue = PLANS.starter.limits[key];
      const overridden = key === "trackedPrompts";
      return {
        key,
        planValue,
        effective: overridden ? 250 : planValue,
        used: key === "trackedPrompts" ? 31 : key === "competitors" ? 2 : null,
        source: overridden ? ("override" as const) : ("plan" as const),
        ...(overridden ? { overrideScope: "account" as const } : {}),
      };
    }),
    fixedLimits: [
      { key: "brands", effective: 3, used: 2 },
      { key: "seats", effective: null, used: 5 },
    ],
    overrides: [
      {
        id: "o1",
        scope: "workspace",
        kind: "feature",
        key: "ugc",
        allowed: true,
        limitValue: null,
        startsAt: ago(24 * 3),
        expiresAt: ahead(27),
        status: "active",
        reason: "Design-partner pilot for video, agreed with their founder.",
        createdBy: pii ? "support@mellox.example" : maskEmail("support@mellox.example"),
        createdAt: ago(24 * 3),
        revokedAt: null,
        revokeReason: null,
      },
      {
        id: "o2",
        scope: "account",
        kind: "limit",
        key: "trackedPrompts",
        allowed: null,
        limitValue: 250,
        startsAt: ago(24 * 30),
        expiresAt: null,
        status: "active",
        reason: "Agency partner gets a larger prompt allowance while on the starter plan.",
        createdBy: pii ? "support@mellox.example" : maskEmail("support@mellox.example"),
        createdAt: ago(24 * 30),
        revokedAt: null,
        revokeReason: null,
      },
      {
        id: "o3",
        scope: "account",
        kind: "feature",
        key: "autopilot",
        allowed: false,
        limitValue: null,
        startsAt: ago(24 * 60),
        expiresAt: ago(24 * 50),
        status: "revoked",
        reason: "Paused while we investigated runaway scheduling.",
        createdBy: pii ? "ops@mellox.example" : maskEmail("ops@mellox.example"),
        createdAt: ago(24 * 60),
        revokedAt: ago(24 * 52),
        revokeReason: "Issue fixed, restoring normal access.",
      },
    ],
  };
}

export function labAudit(pii: boolean): Paged<AdminAuditRow> {
  const actor = (email: string) => (pii ? email : maskEmail(email));
  const rows: AdminAuditRow[] = [
    {
      id: "a1",
      createdAt: ago(0.4),
      actorUserId: U(4),
      actorEmail: actor("support@mellox.example"),
      actorRole: "support",
      action: "entitlement.override_created",
      targetType: "workspace",
      targetId: W(1),
      workspaceId: W(1),
      before: null,
      after: { kind: "feature", key: "ugc", allowed: true, expires_at: ahead(27) },
      reason: "Design-partner pilot for video, agreed with their founder.",
      success: true,
      error: null,
      requestId: "7c9f8f2e-4c8e-4a39-8e8b-1b2c3d4e5f60",
      ip: pii ? "203.0.113.7" : null,
    },
    {
      id: "a2",
      createdAt: ago(5),
      actorUserId: U(4),
      actorEmail: actor("support@mellox.example"),
      actorRole: "support",
      action: "admin.permission_denied",
      targetType: "route",
      targetId: "admin.users.suspend",
      workspaceId: null,
      before: null,
      after: { permission: "users.suspend" },
      reason: null,
      success: false,
      error: "Missing permission",
      requestId: "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      ip: pii ? "203.0.113.7" : null,
    },
    {
      id: "a3",
      createdAt: ago(30),
      actorUserId: U(5),
      actorEmail: actor("ops@mellox.example"),
      actorRole: "operations",
      action: "user.suspended",
      targetType: "user",
      targetId: U(3),
      workspaceId: null,
      before: { suspended: false },
      after: { suspended: true, sessions_ended: 2 },
      reason: "Chargeback filed and confirmed fraudulent; suspending until resolved.",
      success: true,
      error: null,
      requestId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      ip: null,
    },
  ];
  return { total: 3, page: 1, pageSize: 25, rows };
}

export function labTeam(pii: boolean): AdminTeamMember[] {
  const email = (value: string) => (pii ? value : maskEmail(value));
  const member = (
    userId: string,
    address: string,
    role: AdminRoleKey,
    extra: Partial<AdminTeamMember> = {},
  ): AdminTeamMember => ({
    userId,
    email: email(address),
    role,
    status: "active",
    source: "team",
    extraPermissions: [],
    deniedPermissions: [],
    effectivePermissions: effectivePermissions(role),
    note: null,
    createdAt: ago(24 * 100),
    lastSeenAt: ago(1),
    ...extra,
  });
  return [
    member(U(6), "founder@mellox.example", "super_admin", {
      source: "environment",
      note: "Set in the server environment (BILLING_ADMIN_USER_IDS).",
      createdAt: "",
      lastSeenAt: null,
    }),
    member(U(5), "ops@mellox.example", "operations"),
    member(U(4), "support@mellox.example", "support", {
      note: "Weekend cover",
      lastSeenAt: ago(0.2),
    }),
    member(U(7), "former.contractor@mellox.example", "analyst", {
      status: "disabled",
      lastSeenAt: ago(24 * 20),
    }),
  ];
}

export function labSecurity(pii: boolean): AdminSecurity {
  return {
    mfaRequired: true,
    admins: labTeam(pii).map((member, index) => ({
      userId: member.userId,
      email: member.email,
      role: member.role,
      status: member.status,
      mfaFactors: index === 2 ? 0 : 1,
      lastSeenAt: member.lastSeenAt,
    })),
    events: labAudit(pii).rows.filter((row) => !row.success || row.action.startsWith("user.")),
  };
}

export const LAB_OVERVIEW: AdminOverview = {
  generatedAt: new Date().toISOString(),
  users: { total: 1284, new7d: 41, new30d: 187, active7d: 402, suspended: 3, unconfirmed: 19 },
  workspaces: { total: 312, new7d: 12, frozen: 2 },
  billing: { payingAccounts: 58, trialingAccounts: 9, pendingRequests: 2 },
  jobs: { studioFailed24h: 4, studioRunning: 7 },
  admins: { active: 3 },
  funding: calculateFunding({
    countingFrom: ago(24),
    accounts: [
      {
        accountId: U(20),
        ownerUserId: U(1),
        ownerEmail: "founder@northstar.example",
        planId: "starter",
        status: "active",
        interval: "month",
        currentPeriodEnd: ahead(18),
        nextGrantAt: ahead(18),
        purchaseRecordedAt: ago(2),
        meters: {
          credits: { available: 1_420, held: 30, debt: 0 },
          video: { available: 300, held: 0, debt: 0 },
          pro_messages: { available: 22, held: 0, debt: 0 },
          flash_messages: { available: 614, held: 0, debt: 0 },
        },
      },
      {
        accountId: U(21),
        ownerUserId: U(2),
        ownerEmail: "ops@aster.example",
        planId: "growth",
        status: "active",
        interval: "year",
        currentPeriodEnd: ahead(120),
        nextGrantAt: ahead(12),
        purchaseRecordedAt: ago(4),
        meters: {
          credits: { available: 4_800, held: 100, debt: 0 },
          video: { available: 900, held: 100, debt: 0 },
          pro_messages: { available: 130, held: 0, debt: 0 },
          flash_messages: { available: 1_760, held: 0, debt: 0 },
        },
      },
    ],
    openRouter: {
      configured: true,
      state: "live",
      balance: 74,
      checkedAt: new Date().toISOString(),
      message: "Live balance from OpenRouter.",
    },
    kie: {
      configured: true,
      state: "live",
      balance: 2_800,
      checkedAt: new Date().toISOString(),
      message: "Live credit balance from KIE.",
    },
    dependencies: [
      {
        id: "tavily",
        label: "Tavily",
        configured: true,
        billingModel: "External plan / usage",
        message: "Search account connected.",
      },
      {
        id: "firecrawl",
        label: "Firecrawl",
        configured: true,
        billingModel: "Self-hosted",
        message: "Crawler connected.",
      },
      {
        id: "post_for_me",
        label: "Post for Me",
        configured: true,
        billingModel: "External plan",
        message: "Publishing connected.",
      },
    ],
  }),
};

export const LAB_FINANCE: AdminFinanceOverview = {
  configured: true,
  generatedAt: new Date().toISOString(),
  livemode: true,
  currency: "usd",
  account: {
    businessName: "Mellox AI",
    country: "US",
    defaultCurrency: "usd",
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    requirements: {
      currentlyDue: [],
      eventuallyDue: [],
      pastDue: [],
      pendingVerification: [],
    },
  },
  balance: {
    available: [{ currency: "usd", amountCents: 182_450 }],
    pending: [{ currency: "usd", amountCents: 48_900 }],
    instantAvailable: [{ currency: "usd", amountCents: 151_200 }],
    connectReserved: [],
    refundPrefundingAvailable: [{ currency: "usd", amountCents: 15_000 }],
    refundPrefundingPending: [],
  },
  periods: [
    {
      key: "today",
      label: "Today",
      startsAt: ago(8),
      receivedCents: 29_700,
      refundsCents: 0,
      feesCents: 1_081,
      disputesCents: 0,
      netRevenueCents: 28_619,
      sales: 4,
    },
    {
      key: "last7Days",
      label: "Last 7 days",
      startsAt: ago(24 * 7),
      receivedCents: 184_200,
      refundsCents: 4_900,
      feesCents: 6_310,
      disputesCents: 0,
      netRevenueCents: 172_990,
      sales: 23,
    },
    {
      key: "monthToDate",
      label: "Month to date",
      startsAt: ago(24 * 22),
      receivedCents: 501_300,
      refundsCents: 13_900,
      feesCents: 17_220,
      disputesCents: 0,
      netRevenueCents: 470_180,
      sales: 61,
    },
    {
      key: "last30Days",
      label: "Last 30 days",
      startsAt: ago(24 * 30),
      receivedCents: 624_800,
      refundsCents: 18_900,
      feesCents: 21_420,
      disputesCents: 0,
      netRevenueCents: 584_480,
      sales: 74,
    },
    {
      key: "yearToDate",
      label: "Year to date",
      startsAt: ago(24 * 220),
      receivedCents: 3_914_600,
      refundsCents: 68_400,
      feesCents: 134_900,
      disputesCents: 19_900,
      netRevenueCents: 3_691_400,
      sales: 482,
    },
  ],
  last30Days: {
    startsAt: ago(24 * 30),
    receivedCents: 624_800,
    refundsCents: 18_900,
    feesCents: 21_420,
    disputesCents: 0,
    netRevenueCents: 584_480,
    paidOutCents: 402_000,
    sales: 74,
    estimatedAiCostUsd: 612.44,
    estimatedProfitCents: 523_236,
    marginPercent: 83.75,
  },
  recurring: {
    mrrCents: 598_500,
    arrCents: 7_182_000,
    active: 58,
    trialing: 9,
    pastDue: 2,
    canceling: 3,
    incomplete: 1,
    unpaid: 0,
    paused: 1,
    new30d: 12,
    canceled30d: 3,
    churnPercent: 4.92,
    plans: [
      { name: "Mellox Growth", subscriptions: 27, mrrCents: 269_700, revenue30dCents: 287_100 },
      { name: "Mellox Starter", subscriptions: 19, mrrCents: 94_810, revenue30dCents: 104_900 },
      { name: "Mellox Agency", subscriptions: 9, mrrCents: 179_100, revenue30dCents: 179_100 },
      { name: "Mellox Scale", subscriptions: 3, mrrCents: 54_890, revenue30dCents: 53_700 },
    ],
  },
  customers: {
    total: 71,
    new30d: 14,
    repeatBuyers30d: 48,
    top30d: [
      {
        id: "cus_lab_1",
        name: "Brightpath Marketing",
        payments: 2,
        receivedCents: 39_800,
        currency: "usd",
      },
      {
        id: "cus_lab_2",
        name: "Northwind Studio",
        payments: 1,
        receivedCents: 29_900,
        currency: "usd",
      },
      {
        id: "cus_lab_3",
        name: "Amelia Hartwell",
        payments: 1,
        receivedCents: 19_900,
        currency: "usd",
      },
    ],
  },
  payments: {
    succeeded30d: 74,
    failed30d: 4,
    successRatePercent: 94.87,
    averageOrderCents: 8_443,
    largestOrderCents: 59_900,
    methods: [
      { method: "card", payments: 67, sharePercent: 90.54 },
      { method: "link", payments: 5, sharePercent: 6.76 },
      { method: "us bank account", payments: 2, sharePercent: 2.7 },
    ],
    currencies: [
      { currency: "usd", payments: 71, receivedCents: 601_800 },
      { currency: "gbp", payments: 3, receivedCents: 18_700 },
    ],
    recentFailures: [
      {
        id: "ch_fail_1",
        customer: "Atlas & Co",
        amountCents: 9_900,
        currency: "usd",
        failedAt: ago(5),
        reason: "Card was declined",
      },
      {
        id: "ch_fail_2",
        customer: "Mina Studio",
        amountCents: 4_900,
        currency: "usd",
        failedAt: ago(28),
        reason: "Insufficient funds",
      },
    ],
  },
  invoices: {
    paid30d: 74,
    open: 3,
    overdue: 1,
    uncollectible: 1,
    draft: 2,
    void: 1,
    outstandingCents: 24_700,
    collectionRatePercent: 94.87,
    nextCollectionAt: ahead(1),
    recentOpen: [
      {
        id: "in_open_1",
        customer: "Atlas & Co",
        amountCents: 9_900,
        currency: "usd",
        status: "overdue",
        dueAt: ago(24),
        nextAttemptAt: ahead(1),
      },
      {
        id: "in_open_2",
        customer: "Harbor Labs",
        amountCents: 9_900,
        currency: "usd",
        status: "open",
        dueAt: ahead(4),
        nextAttemptAt: ahead(2),
      },
    ],
  },
  payoutPipeline: {
    pendingCents: 42_000,
    inTransitCents: 96_400,
    failedCents30d: 0,
    nextArrivalAt: ahead(2),
  },
  health: {
    failedInvoices30d: 2,
    refundedTransactions30d: 3,
    openDisputes: 0,
    failedPayouts30d: 0,
  },
  monthly: Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 11 + index);
    const receivedCents = 168_000 + index * 39_000 + (index % 3) * 21_000;
    const feesCents = Math.round(receivedCents * 0.034);
    const refundsCents = index % 4 === 0 ? 9_900 : 3_500;
    return {
      month: date.toISOString().slice(0, 7),
      receivedCents,
      netRevenueCents: receivedCents - feesCents - refundsCents,
      refundsCents,
      feesCents,
      sales: 20 + index * 5,
    };
  }),
  recentSales: [
    {
      id: "in_lab_1",
      customer: "Amelia Hartwell",
      item: "1 × Mellox Agency (at $199.00 / month)",
      amountCents: 19_900,
      currency: "usd",
      paidAt: ago(2),
      kind: "subscription create",
    },
    {
      id: "in_lab_2",
      customer: "Kai Nakamura",
      item: "1 × Mellox Growth (at $99.00 / month)",
      amountCents: 9_900,
      currency: "usd",
      paidAt: ago(7),
      kind: "subscription cycle",
    },
    {
      id: "in_lab_3",
      customer: "Lumen Studio",
      item: "1 × Mellox Starter (at $49.00 / month)",
      amountCents: 4_900,
      currency: "usd",
      paidAt: ago(20),
      kind: "subscription create",
    },
  ],
  recentPayouts: [
    {
      id: "po_lab_1",
      amountCents: 201_000,
      currency: "usd",
      status: "paid",
      createdAt: ago(48),
      arrivalAt: ago(24),
      method: "standard",
    },
    {
      id: "po_lab_2",
      amountCents: 201_000,
      currency: "usd",
      status: "paid",
      createdAt: ago(24 * 15),
      arrivalAt: ago(24 * 13),
      method: "standard",
    },
  ],
  recentRefunds: [
    {
      id: "re_lab_1",
      amountCents: 4_900,
      currency: "usd",
      status: "succeeded",
      reason: "requested by customer",
      createdAt: ago(16),
    },
    {
      id: "re_lab_2",
      amountCents: 9_900,
      currency: "usd",
      status: "succeeded",
      reason: "duplicate",
      createdAt: ago(80),
    },
  ],
  recentDisputes: [],
  coverage: { truncated: [], unavailable: [] },
};

/* ───────────────────── health, usage and switches ───────────────────── */

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

export const LAB_HEALTH: AdminHealth = {
  generatedAt: minutesAgo(0),
  cron: [
    {
      job: "run-schedules",
      expectedIntervalSeconds: 300,
      lastStartedAt: minutesAgo(2),
      lastSucceededAt: minutesAgo(2),
      lastFailedAt: null,
      failureCount: 0,
      runCount: 4210,
      lastDurationMs: 840,
      lastError: null,
      state: "healthy",
    },
    {
      job: "competitor-watch",
      expectedIntervalSeconds: 3600,
      lastStartedAt: minutesAgo(400),
      lastSucceededAt: minutesAgo(400),
      lastFailedAt: null,
      failureCount: 2,
      runCount: 310,
      lastDurationMs: 5200,
      lastError: "Search provider timed out",
      state: "late",
    },
    {
      job: "link-orders",
      expectedIntervalSeconds: 60,
      lastStartedAt: minutesAgo(3),
      lastSucceededAt: minutesAgo(30),
      lastFailedAt: minutesAgo(3),
      failureCount: 5,
      runCount: 9020,
      lastDurationMs: 120,
      lastError: "Provider basket is locked",
      state: "failing",
    },
  ],
  studio: { queued: 4, running: 2, failed24h: 3, stuck: 1 },
  recentFailures: [
    {
      id: "50000001-0000-4000-8000-000000000001",
      type: "carousel",
      stage: "render",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      updatedAt: minutesAgo(45),
      message: "The image provider is briefly unavailable.",
    },
  ],
};

export const LAB_USAGE: AdminUsage = {
  generatedAt: minutesAgo(0),
  since: minutesAgo(7 * 24 * 60),
  days: 7,
  totals: {
    calls: 18420,
    costUsd: 142.3871,
    savedUsd: 21.04,
    errors: 212,
    cached: 3100,
    inputTokens: 41_200_000,
    outputTokens: 9_800_000,
  },
  byDay: [
    { day: "2026-10-16", calls: 2400, costUsd: 18.2, errors: 20 },
    { day: "2026-10-17", calls: 2900, costUsd: 22.9, errors: 31 },
  ],
  byKind: [
    { kind: "text", calls: 16000, costUsd: 80.1 },
    { kind: "image", calls: 2100, costUsd: 55.3 },
    { kind: "video", calls: 20, costUsd: 6.9 },
  ],
  byModel: [
    {
      provider: "openrouter",
      model: "anthropic/claude-opus-5.5",
      calls: 4000,
      costUsd: 70.2,
      errors: 40,
      avgLatencyMs: 6200,
    },
    {
      provider: "openrouter",
      model: "google/gemini-3.8-flash",
      calls: 12000,
      costUsd: 9.9,
      errors: 150,
      avgLatencyMs: 1400,
    },
  ],
  byRoute: [
    { route: "brand-extract", calls: 5200, costUsd: 61.5, errors: 70 },
    { route: "memory-extract", calls: 8100, costUsd: 33.2, errors: 40 },
  ],
  topWorkspaces: [
    {
      workspaceId: "20000001-0000-4000-8000-000000000001",
      name: "Northwind Coffee",
      calls: 1900,
      costUsd: 22.4,
    },
  ],
};

export function labSwitches(pii: boolean): AdminSwitch[] {
  const email = pii ? "ops@mellox.ai" : "o•••@mellox.ai";
  return [
    {
      key: "ai_text",
      label: "AI writing",
      description: "Chat, Studio copy, plans and every other text model call.",
      engaged: false,
      reason: null,
      changedAt: null,
      changedByEmail: null,
    },
    {
      key: "ai_image",
      label: "Image generation",
      description: "Every image the platform generates.",
      engaged: true,
      reason: "Provider is returning broken images",
      changedAt: minutesAgo(25),
      changedByEmail: email,
    },
    {
      key: "ai_video",
      label: "Video generation",
      description: "Every video the platform generates.",
      engaged: false,
      reason: null,
      changedAt: null,
      changedByEmail: null,
    },
    {
      key: "ai_search",
      label: "Web research",
      description: "Live web search for Market, Competitors and chat.",
      engaged: false,
      reason: null,
      changedAt: null,
      changedByEmail: null,
    },
  ];
}

export const LAB_FLAGS: AdminFlag[] = [
  {
    key: "new-editor",
    description: "The rebuilt post editor",
    enabled: true,
    rolloutPercent: 25,
    workspaceIds: ["20000001-0000-4000-8000-000000000001"],
    expiresAt: null,
    updatedAt: minutesAgo(90),
    envOverride: null,
    state: "partial",
  },
  {
    key: "faster-scan",
    description: "Parallel page fetching in scans",
    enabled: true,
    rolloutPercent: 100,
    workspaceIds: [],
    expiresAt: null,
    updatedAt: minutesAgo(60 * 30),
    envOverride: "off",
    state: "on",
  },
];

export const LAB_ANNOUNCEMENTS: AdminAnnouncement[] = [
  {
    id: "60000001-0000-4000-8000-000000000001",
    title: "Scheduled maintenance on Saturday",
    body: "Publishing may pause for a few minutes around 02:00 UTC.",
    tone: "warning",
    linkUrl: null,
    dismissible: true,
    active: true,
    startsAt: minutesAgo(60),
    endsAt: new Date(NOW + 3 * 86_400_000).toISOString(),
    createdAt: minutesAgo(70),
    status: "live",
  },
];

export const LAB_ANALYTICS: AdminAnalytics = {
  generatedAt: minutesAgo(0),
  days: 30,
  signupsByDay: [
    { day: "2026-10-14", signups: 6 },
    { day: "2026-10-15", signups: 11 },
    { day: "2026-10-16", signups: 4 },
    { day: "2026-10-17", signups: 9 },
  ],
  aiActive: { day: 48, week: 210, month: 530 },
  signedIn: { day: 61, week: 260, month: 640 },
  funnel: { signedUp: 220, hasWorkspace: 198, usedAi: 140, paying: 17 },
  plans: [
    { planId: "free", status: "free", accounts: 610 },
    { planId: "growth", status: "active", accounts: 14 },
    { planId: "starter", status: "trialing", accounts: 6 },
  ],
  adoption: [
    { kind: "text", workspaces: 240, users: 300 },
    { kind: "image", workspaces: 95, users: 120 },
    { kind: "video", workspaces: 8, users: 9 },
  ],
};

export const LAB_INTEGRATIONS: AdminIntegrations = {
  generatedAt: minutesAgo(0),
  social: [
    { platform: "instagram", status: "active", accounts: 120 },
    { platform: "linkedin", status: "active", accounts: 64 },
    { platform: "instagram", status: "reconnect_required", accounts: 7 },
  ],
  connections: [
    { provider: "github", status: "active", connections: 33 },
    { provider: "wordpress", status: "active", connections: 12 },
  ],
  problems: [
    {
      source: "social",
      provider: "instagram",
      status: "reconnect_required",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      message: "The access was revoked by the account owner.",
      at: minutesAgo(180),
    },
  ],
};

export function labLookup(pii: boolean): AdminLookup {
  return {
    users: [
      {
        id: "10000001-0000-4000-8000-000000000001",
        email: pii ? "ada@northwind.example" : "a•••@northwind.example",
        name: "Ada Lovelace",
        createdAt: minutesAgo(60 * 24 * 40),
      },
    ],
    workspaces: [
      {
        id: "20000001-0000-4000-8000-000000000001",
        name: "Northwind Coffee",
        domain: "northwind.example",
        createdAt: minutesAgo(60 * 24 * 39),
      },
    ],
    jobs: [],
  };
}

export const LAB_AI: AdminAiControls = {
  generatedAt: minutesAgo(0),
  models: [
    "anthropic/claude-opus-5.5",
    "google/gemini-3.8-flash",
    "google/gemini-3.1-flash-lite",
    "openai/gpt-5.6-terra",
  ],
  spend: { todayUsd: 18.4, monthUsd: 142.39 },
  caps: [
    {
      scope: "global",
      workspaceId: null,
      workspaceName: null,
      dailyUsd: 250,
      monthlyUsd: 4000,
      updatedAt: minutesAgo(60 * 24 * 3),
    },
    {
      scope: "workspace",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      workspaceName: "Northwind Coffee",
      dailyUsd: 20,
      monthlyUsd: null,
      updatedAt: minutesAgo(60 * 5),
    },
  ],
  routes: [
    {
      route: "brand-extract",
      source: "default",
      models: ["anthropic/claude-opus-5.5", "google/gemini-3.8-flash"],
      effort: "medium",
      defaultModels: ["anthropic/claude-opus-5.5", "google/gemini-3.8-flash"],
      defaultEffort: "medium",
      override: null,
    },
    {
      route: "memory-extract",
      source: "override",
      models: ["google/gemini-3.1-flash-lite"],
      effort: "low",
      defaultModels: ["google/gemini-3.8-flash", "openai/gpt-5.6-terra"],
      defaultEffort: "medium",
      override: { models: ["google/gemini-3.1-flash-lite"], effort: "low" },
    },
    {
      route: "file-extract",
      source: "environment",
      models: ["google/gemini-3.8-flash"],
      effort: "medium",
      defaultModels: ["google/gemini-3.1-flash-lite"],
      defaultEffort: "low",
      override: null,
    },
  ],
};

export function labSupportView(section: string): AdminSupportView {
  const expiresAt = new Date(NOW + 27 * 60_000).toISOString();
  const workspaceId = "20000001-0000-4000-8000-000000000001";
  const data: Record<string, unknown> =
    section === "content"
      ? {
          items: [
            {
              id: "c1",
              kind: "post",
              channel: "instagram",
              status: "approved",
              title: "Autumn menu is here",
              created_at: minutesAgo(300),
              scheduled_at: null,
            },
          ],
        }
      : section === "accounts"
        ? {
            social: [
              {
                platform: "instagram",
                status: "reconnect_required",
                username: "northwind.coffee",
                connected_at: minutesAgo(60 * 24 * 30),
                last_synced_at: minutesAgo(60 * 20),
                reconnect_reason: "The access was revoked by the account owner.",
              },
            ],
            connections: [],
          }
        : section === "jobs"
          ? {
              jobs: [
                {
                  id: "j1",
                  type: "carousel",
                  stage: "render",
                  status: "failed",
                  created_at: minutesAgo(80),
                  updated_at: minutesAgo(75),
                  error: "The image provider is briefly unavailable.",
                },
              ],
            }
          : {
              workspace: {
                name: "Northwind Coffee",
                domain: "northwind.example",
                industry: "Food and drink",
                plan: "growth",
                created_at: minutesAgo(60 * 24 * 39),
                onboarded_at: minutesAgo(60 * 24 * 38),
                frozen_at: null,
              },
              access_mode: "read_only",
              members: [
                {
                  email: "a•••@northwind.example",
                  role: "owner",
                  joined_at: minutesAgo(60 * 24 * 39),
                },
              ],
              content_by_status: { approved: 12, draft: 4 },
              accounts_by_status: { active: 2, reconnect_required: 1 },
              jobs_7d_by_status: { succeeded: 41, failed: 3 },
              ai_30d: { calls: 1900, cost_usd: 22.4 },
            };
  return { workspaceId, expiresAt, section: section as AdminSupportView["section"], data };
}

export const LAB_JOBS: AdminJobs = {
  generatedAt: minutesAgo(0),
  counts: [
    { source: "studio", active: 3, stuck: 1, failed24h: 2 },
    { source: "geo_scan", active: 1, stuck: 0, failed24h: 0 },
    { source: "experiment", active: 0, stuck: 0, failed24h: 1 },
    { source: "autopilot", active: 2, stuck: 0, failed24h: 0 },
  ],
  total: 4,
  page: 1,
  pageSize: 25,
  rows: [
    {
      source: "studio",
      id: "50000001-0000-4000-8000-000000000001",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      kind: "video",
      status: "running",
      attempts: 1,
      maxAttempts: null,
      createdAt: minutesAgo(95),
      updatedAt: minutesAgo(62),
      error: "",
      stuck: true,
      canAct: true,
    },
    {
      source: "studio",
      id: "50000001-0000-4000-8000-000000000002",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      kind: "carousel",
      status: "failed",
      attempts: 1,
      maxAttempts: null,
      createdAt: minutesAgo(200),
      updatedAt: minutesAgo(190),
      error: "The image provider is briefly unavailable.",
      stuck: false,
      canAct: false,
    },
    {
      source: "experiment",
      id: "50000001-0000-4000-8000-000000000003",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      kind: "live_check",
      status: "failed",
      attempts: 5,
      maxAttempts: 5,
      createdAt: minutesAgo(900),
      updatedAt: minutesAgo(300),
      error: "The page could not be fetched.",
      stuck: false,
      canAct: false,
    },
    {
      source: "autopilot",
      id: "50000001-0000-4000-8000-000000000004",
      workspaceId: "20000001-0000-4000-8000-000000000001",
      kind: "content",
      status: "generating",
      attempts: 1,
      maxAttempts: null,
      createdAt: minutesAgo(20),
      updatedAt: minutesAgo(8),
      error: "",
      stuck: false,
      canAct: false,
    },
  ],
};

export const LAB_ABUSE: AdminAbuseSignals = {
  generatedAt: minutesAgo(0),
  signupBursts: [{ domain: "tempbox.example", hour: minutesAgo(180), accounts: 9 }],
  costSpikes: [
    {
      workspaceId: "20000001-0000-4000-8000-000000000001",
      name: "Northwind Coffee",
      cost24hUsd: 38.2,
      avgDaily7dUsd: 4.1,
    },
  ],
  failingUsers: [{ userId: "10000001-0000-4000-8000-000000000001", calls: 120, badCalls: 97 }],
  heavyUsers: [],
  failingWorkspaces: [],
};
