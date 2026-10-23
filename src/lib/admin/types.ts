// types.ts — response shapes of /api/admin/*, shared by the server (which
// builds them) and the console (which renders them). Browser-safe.
import type { AdminRoleKey, Permission } from "./permissions";

export type Paged<T> = { total: number; page: number; pageSize: number; rows: T[] };

export type AdminMe = {
  userId: string;
  role: AdminRoleKey;
  roleLabel: string;
  permissions: Permission[];
  source: "team" | "environment";
  /** May open the billing console. */
  billing: boolean;
  /** The server asks for a second factor on admin routes. */
  mfaRequired: boolean;
};

export type AdminUserRow = {
  id: string;
  /** Masked unless the admin holds users.pii.read. */
  email: string | null;
  name: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  suspended: boolean;
  emailConfirmed: boolean;
  providers: string[];
  workspaceCount: number;
  persona: string | null;
  isAdmin: boolean;
};

export type AdminNote = {
  id: string;
  authorId: string;
  authorEmail: string | null;
  body: string;
  createdAt: string;
};

export type AdminAuditRow = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  workspaceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  success: boolean;
  error: string | null;
  requestId: string | null;
  /** Only for admins who may see personal data. */
  ip: string | null;
};

export type AdminBillingSummary = {
  id: string;
  planId: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  comped: boolean;
};

export type AdminUserDetail = {
  user: AdminUserRow & {
    bannedUntil: string | null;
    sessions: number;
    mfaFactors: number;
  };
  workspaces: Array<{
    id: string;
    name: string;
    role: string;
    plan: string | null;
    owned: boolean;
  }>;
  billing: AdminBillingSummary[];
  notes: AdminNote[];
  audit: AdminAuditRow[];
};

export type AdminWorkspaceRow = {
  id: string;
  name: string;
  domain: string | null;
  plan: string | null;
  billingPlan: string | null;
  billingStatus: string | null;
  ownerId: string;
  ownerEmail: string | null;
  memberCount: number;
  createdAt: string;
  frozen: boolean;
  frozenReason: string | null;
};

export type AdminWorkspaceDetail = {
  workspace: AdminWorkspaceRow & {
    industry: string | null;
    websiteUrl: string | null;
    onboardedAt: string | null;
  };
  members: Array<{ userId: string; email: string | null; role: string; joinedAt: string }>;
  billing: AdminBillingSummary | null;
  studioJobs7d: Record<string, number>;
  /** Set by an admin: read-only or suspended. Active when absent. */
  access: AdminWorkspaceAccess;
  audit: AdminAuditRow[];
};

export type AdminWorkspaceAccessMode = "active" | "read_only" | "suspended";

export type AdminWorkspaceAccess = {
  mode: AdminWorkspaceAccessMode;
  reason: string | null;
  changedAt: string | null;
};

export type AdminTeamMember = {
  userId: string;
  email: string | null;
  role: AdminRoleKey;
  status: "active" | "disabled";
  /** "environment" = super admin through the server's allowlist; not editable here. */
  source: "team" | "environment";
  extraPermissions: Permission[];
  deniedPermissions: Permission[];
  effectivePermissions: Permission[];
  note: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export type AdminOverview = {
  generatedAt: string;
  users: {
    total: number;
    new7d: number;
    new30d: number;
    active7d: number;
    suspended: number;
    unconfirmed: number;
  };
  workspaces: { total: number; new7d: number; frozen: number };
  billing: { payingAccounts: number; trialingAccounts: number; pendingRequests: number };
  jobs: { studioFailed24h: number; studioRunning: number };
  admins: { active: number };
  activity: {
    windowDays: number;
    todayCount: number;
    items: Array<{
      id: string;
      kind:
        | "subscription"
        | "purchase"
        | "signup"
        | "workspace"
        | "upgrade_request"
        | "announcement"
        | "job_failed";
      title: string;
      detail: string;
      occurredAt: string;
      href: string | null;
      amountUsd: number | null;
      tone: "success" | "primary" | "warning" | "danger" | "neutral";
    }>;
  };
  funding: AdminFundingOverview;
};

export type AdminFundingMeterBalance = {
  available: number;
  held: number;
  debt: number;
};

export type AdminFundingAccount = {
  accountId: string;
  ownerUserId: string;
  ownerEmail: string | null;
  planId: string;
  planLabel: string;
  status: string;
  interval: "month" | "year" | null;
  currentPeriodEnd: string | null;
  nextGrantAt: string | null;
  purchaseRecordedAt: string;
  reserveEligible: boolean;
  reserve: { openRouterUsd: number; kieUsd: number; totalUsd: number };
  meters: {
    credits: AdminFundingMeterBalance;
    video: AdminFundingMeterBalance;
    proMessages: AdminFundingMeterBalance;
    flashMessages: AdminFundingMeterBalance;
  };
};

export type AdminFundingProvider = {
  id: "openrouter" | "kie";
  label: string;
  configured: boolean;
  balanceState: "live" | "manual" | "unavailable" | "not_configured";
  balanceUsd: number | null;
  balanceCredits: number | null;
  reserveUsd: number;
  reserveCredits: number | null;
  shortfallUsd: number | null;
  shortfallCredits: number | null;
  purchaseFeeUsd: number | null;
  cashRequiredUsd: number | null;
  coveragePercent: number | null;
  topUpUrl: string;
  checkedAt: string;
  message: string;
};

export type AdminFundingOverview = {
  generatedAt: string;
  status: "healthy" | "action_needed" | "unverified";
  calculation: {
    policy: string;
    countingFrom: string;
    kieCreditUsd: number;
    totalReserveUsd: number;
    verifiedTopUpUsd: number;
    estimatedCashRequiredUsd: number;
    unverifiedProviders: number;
  };
  providers: AdminFundingProvider[];
  dependencies: Array<{
    id: string;
    label: string;
    configured: boolean;
    billingModel: string;
    message: string;
  }>;
  plans: Array<{
    planId: string;
    planLabel: string;
    accounts: number;
    openRouterReserveUsd: number;
    kieReserveUsd: number;
    totalReserveUsd: number;
    remaining: { credits: number; video: number; proMessages: number; flashMessages: number };
  }>;
  accounts: AdminFundingAccount[];
};

export type AdminFinanceMoney = {
  currency: string;
  amountCents: number;
};

export type AdminFinanceOverview =
  | {
      configured: false;
      generatedAt: string;
    }
  | {
      configured: true;
      generatedAt: string;
      livemode: boolean;
      currency: string;
      account: {
        businessName: string | null;
        country: string | null;
        defaultCurrency: string;
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
        requirements: {
          currentlyDue: string[];
          eventuallyDue: string[];
          pastDue: string[];
          pendingVerification: string[];
        };
      };
      balance: {
        available: AdminFinanceMoney[];
        pending: AdminFinanceMoney[];
        instantAvailable: AdminFinanceMoney[];
        connectReserved: AdminFinanceMoney[];
        refundPrefundingAvailable: AdminFinanceMoney[];
        refundPrefundingPending: AdminFinanceMoney[];
      };
      periods: Array<{
        key: "today" | "last7Days" | "monthToDate" | "last30Days" | "yearToDate";
        label: string;
        startsAt: string;
        receivedCents: number;
        refundsCents: number;
        feesCents: number;
        disputesCents: number;
        netRevenueCents: number;
        sales: number;
      }>;
      last30Days: {
        startsAt: string;
        receivedCents: number;
        refundsCents: number;
        feesCents: number;
        disputesCents: number;
        netRevenueCents: number;
        paidOutCents: number;
        sales: number;
        estimatedAiCostUsd: number | null;
        estimatedProfitCents: number | null;
        marginPercent: number | null;
      };
      recurring: {
        mrrCents: number;
        arrCents: number;
        active: number;
        trialing: number;
        pastDue: number;
        canceling: number;
        incomplete: number;
        unpaid: number;
        paused: number;
        new30d: number;
        canceled30d: number;
        churnPercent: number | null;
        plans: Array<{
          name: string;
          subscriptions: number;
          mrrCents: number;
          revenue30dCents: number;
        }>;
      };
      customers: {
        total: number;
        new30d: number;
        repeatBuyers30d: number;
        top30d: Array<{
          id: string;
          name: string;
          payments: number;
          receivedCents: number;
          currency: string;
        }>;
      };
      payments: {
        succeeded30d: number;
        failed30d: number;
        successRatePercent: number | null;
        averageOrderCents: number;
        largestOrderCents: number;
        methods: Array<{ method: string; payments: number; sharePercent: number }>;
        currencies: Array<{
          currency: string;
          payments: number;
          receivedCents: number;
        }>;
        recentFailures: Array<{
          id: string;
          customer: string;
          amountCents: number;
          currency: string;
          failedAt: string;
          reason: string;
        }>;
      };
      invoices: {
        paid30d: number;
        open: number;
        overdue: number;
        uncollectible: number;
        draft: number;
        void: number;
        outstandingCents: number;
        collectionRatePercent: number | null;
        nextCollectionAt: string | null;
        recentOpen: Array<{
          id: string;
          customer: string;
          amountCents: number;
          currency: string;
          status: string;
          dueAt: string | null;
          nextAttemptAt: string | null;
        }>;
      };
      payoutPipeline: {
        pendingCents: number;
        inTransitCents: number;
        failedCents30d: number;
        nextArrivalAt: string | null;
      };
      health: {
        failedInvoices30d: number;
        refundedTransactions30d: number;
        openDisputes: number;
        failedPayouts30d: number;
      };
      monthly: Array<{
        month: string;
        receivedCents: number;
        netRevenueCents: number;
        refundsCents: number;
        feesCents: number;
        sales: number;
      }>;
      recentSales: Array<{
        id: string;
        customer: string;
        item: string;
        amountCents: number;
        currency: string;
        paidAt: string;
        kind: string;
      }>;
      recentPayouts: Array<{
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
        arrivalAt: string;
        method: string;
      }>;
      recentRefunds: Array<{
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        reason: string;
        createdAt: string;
      }>;
      recentDisputes: Array<{
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        reason: string;
        createdAt: string;
        evidenceDueAt: string | null;
      }>;
      coverage: {
        truncated: string[];
        unavailable: string[];
      };
    };

export type AdminSecurity = {
  mfaRequired: boolean;
  admins: Array<{
    userId: string;
    email: string | null;
    role: string;
    status: string;
    mfaFactors: number;
    lastSeenAt: string | null;
  }>;
  /** Refused attempts and sensitive changes, newest first. */
  events: AdminAuditRow[];
};

/* ───────────────────────── entitlements (phase 2) ───────────────────────── */

export type AdminOverrideStatus = "active" | "scheduled" | "expired" | "revoked";

export type AdminOverrideRow = {
  id: string;
  scope: "account" | "workspace";
  kind: "feature" | "limit";
  key: string;
  allowed: boolean | null;
  limitValue: number | null;
  startsAt: string;
  expiresAt: string | null;
  status: AdminOverrideStatus;
  reason: string;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
};

export type AdminEntitlementView = {
  workspace: { id: string; name: string };
  account: {
    id: string;
    plan: string;
    entitledPlan: string;
    status: string;
    enforcement: string;
    ownerEmail: string | null;
    overridesEnabled: boolean;
  };
  features: Array<{
    key: string;
    label: string;
    module: string;
    sold: boolean;
    /** What this workspace can do now. */
    allowed: boolean;
    /** What its plan alone would allow. */
    planAllows: boolean;
    requiredPlan: string;
    source: "plan" | "override";
    overrideScope?: "account" | "workspace";
  }>;
  limits: Array<{
    key: string;
    planValue: number;
    effective: number;
    used: number | null;
    source: "plan" | "override";
    overrideScope?: "account" | "workspace";
  }>;
  /** Brands and seats follow the plan; overrides can't change them. */
  fixedLimits: Array<{ key: "brands" | "seats"; effective: number | null; used: number }>;
  overrides: AdminOverrideRow[];
};

/* ───────────────────── health, usage and switches ───────────────────── */

export type AdminCronJob = {
  job: string;
  expectedIntervalSeconds: number;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  failureCount: number;
  runCount: number;
  lastDurationMs: number | null;
  lastError: string | null;
  /** Worked out on the server from the stored times: healthy / late / failing / never. */
  state: "healthy" | "late" | "failing" | "never";
};

export type AdminFailedJob = {
  id: string;
  type: string;
  stage: string;
  workspaceId: string;
  updatedAt: string;
  message: string;
};

export type AdminHealth = {
  generatedAt: string;
  cron: AdminCronJob[];
  studio: { queued: number; running: number; failed24h: number; stuck: number };
  recentFailures: AdminFailedJob[];
};

export type AdminUsageRow = {
  calls: number;
  costUsd: number;
  errors?: number;
};

export type AdminUsage = {
  generatedAt: string;
  since: string;
  days: number;
  /** Estimated from the provider's reported cost, not an invoice. */
  totals: {
    calls: number;
    costUsd: number;
    savedUsd: number;
    errors: number;
    cached: number;
    inputTokens: number;
    outputTokens: number;
  };
  byDay: Array<AdminUsageRow & { day: string }>;
  byKind: Array<AdminUsageRow & { kind: string }>;
  byModel: Array<AdminUsageRow & { provider: string; model: string; avgLatencyMs: number | null }>;
  byRoute: Array<AdminUsageRow & { route: string }>;
  topWorkspaces: Array<AdminUsageRow & { workspaceId: string; name: string | null }>;
};

export type AdminSwitch = {
  key: "ai_text" | "ai_image" | "ai_video" | "ai_search";
  label: string;
  description: string;
  engaged: boolean;
  reason: string | null;
  changedAt: string | null;
  changedByEmail: string | null;
};

/* ───────────────────── flags and announcements ───────────────────── */

export type AdminFlag = {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  workspaceIds: string[];
  expiresAt: string | null;
  updatedAt: string;
  /** Set by an environment variable, which outranks this row. */
  envOverride: "on" | "off" | null;
  /** What the rules say for a workspace not on the allow list. */
  state: "on" | "partial" | "off" | "expired";
};

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  tone: "info" | "success" | "warning";
  linkUrl: string | null;
  dismissible: boolean;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  /** Worked out on the server: live now, scheduled, ended or switched off. */
  status: "live" | "scheduled" | "ended" | "off";
};

/* ───────────────── analytics, integrations, lookup, credits ───────────────── */

export type AdminAnalytics = {
  generatedAt: string;
  days: number;
  signupsByDay: Array<{ day: string; signups: number }>;
  /** People who used an AI feature in the last day / week / month. */
  aiActive: { day: number; week: number; month: number };
  /** People whose last sign-in was within the last day / week / month. */
  signedIn: { day: number; week: number; month: number };
  /** Accounts created in the period, and how far each got. */
  funnel: { signedUp: number; hasWorkspace: number; usedAi: number; paying: number };
  plans: Array<{ planId: string; status: string; accounts: number }>;
  adoption: Array<{ kind: string; workspaces: number; users: number }>;
};

export type AdminIntegrations = {
  generatedAt: string;
  social: Array<{ platform: string; status: string; accounts: number }>;
  connections: Array<{ provider: string; status: string; connections: number }>;
  problems: Array<{
    source: "social" | "connection";
    provider: string;
    status: string;
    workspaceId: string;
    message: string;
    at: string;
  }>;
};

export type AdminLookup = {
  users: Array<{ id: string; email: string | null; name: string | null; createdAt: string }>;
  workspaces: Array<{ id: string; name: string; domain: string | null; createdAt: string }>;
  jobs: Array<{ id: string; type: string; status: string; workspaceId: string; updatedAt: string }>;
};

export type AdminCreditGrantResult = { replayed: boolean };

/* ───────────────────────────── AI controls ───────────────────────────── */

type AdminEffort = "low" | "medium" | "high";

export type AdminAiRoute = {
  route: string;
  /** Where the answer comes from today: an environment variable, an admin override, or the built-in plan. */
  source: "environment" | "override" | "default";
  models: string[];
  effort: AdminEffort | null;
  defaultModels: string[];
  defaultEffort: AdminEffort | null;
  override: { models: string[] | null; effort: AdminEffort | null } | null;
};

export type AdminSpendCap = {
  scope: "global" | "workspace";
  workspaceId: string | null;
  workspaceName: string | null;
  dailyUsd: number | null;
  monthlyUsd: number | null;
  updatedAt: string;
};

export type AdminAiControls = {
  generatedAt: string;
  routes: AdminAiRoute[];
  /** The only models an override may choose: the ones the built-in plans already use. */
  models: string[];
  caps: AdminSpendCap[];
  /** Estimated platform spend so far this UTC day and month; null when it can't be read. */
  spend: { todayUsd: number; monthUsd: number } | null;
};

/* ───────────────────────────── support views ───────────────────────────── */

export type AdminSupportViewStart = { sessionId: string; workspaceId: string; expiresAt: string };

export type AdminSupportViewSection = "overview" | "content" | "accounts" | "jobs";

export type AdminSupportView = {
  workspaceId: string;
  expiresAt: string;
  section: AdminSupportViewSection;
  data: Record<string, unknown>;
};

/* ───────────────────────── jobs and abuse signals ───────────────────────── */

export type AdminJobSource = "studio" | "geo_scan" | "experiment" | "autopilot";

export type AdminJobRow = {
  source: AdminJobSource;
  id: string;
  workspaceId: string;
  kind: string;
  status: string;
  attempts: number | null;
  maxAttempts: number | null;
  createdAt: string;
  updatedAt: string;
  error: string;
  /** In flight but not touched for 30 minutes. */
  stuck: boolean;
  /** An admin action exists for it (Studio jobs in flight). */
  canAct: boolean;
};

export type AdminJobs = {
  generatedAt: string;
  counts: Array<{ source: AdminJobSource; active: number; stuck: number; failed24h: number }>;
  total: number;
  page: number;
  pageSize: number;
  rows: AdminJobRow[];
};

export type AdminAbuseSignals = {
  generatedAt: string;
  signupBursts: Array<{ domain: string; hour: string; accounts: number }>;
  costSpikes: Array<{
    workspaceId: string;
    name: string | null;
    cost24hUsd: number;
    avgDaily7dUsd: number;
  }>;
  failingUsers: Array<{ userId: string; calls: number; badCalls: number }>;
  heavyUsers: Array<{ userId: string; hour: string; calls: number }>;
  failingWorkspaces: Array<{ workspaceId: string; name: string | null; failed: number }>;
};
