// Sample responses for /admin-lab (development only). Typed against the real
// response shapes in src/lib/admin/types.ts, so a change to an API shape breaks
// the build here instead of silently drifting from what the screens expect.

import { FEATURES, PLANS, type FeatureKey } from "@/lib/billing/catalog";
import { OVERRIDE_LIMIT_KEYS } from "@/lib/billing/overrides";
import {
  ROLE_PRESETS,
  effectivePermissions,
  maskEmail,
  type AdminRoleKey,
} from "@/lib/admin/permissions";
import type {
  AdminAuditRow,
  AdminEntitlementView,
  AdminMe,
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
};
