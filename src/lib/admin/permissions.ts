// permissions.ts — the Mellox admin permission catalog and role presets.
//
// Pure and browser-safe: the server enforces these (src/server/admin/route.ts),
// the browser only uses them to decide what to show. Frontend visibility is
// never security.
//
// A permission is an action ("users.suspend"), not a role label. A role is a
// preset list of permissions; an individual admin may additionally be granted
// or denied single permissions. Denied always wins.
//
// Add a permission here together with the route that needs it: a test fails
// when a permission is declared but no route uses it, or the reverse.

export const PERMISSIONS = [
  "overview.read",
  "users.read",
  /** See an unmasked email address and other personal details. */
  "users.pii.read",
  "users.suspend",
  "users.sessions.revoke",
  "users.notes.write",
  "workspaces.read",
  /** Put a workspace in read-only mode, suspend it, or restore it. */
  "workspaces.suspend",
  /** Open a short, audited, read-only support view of one workspace. */
  "support.impersonate",
  "entitlements.read",
  /** Grant or remove a feature, or change a limit, for one account or workspace. */
  "entitlements.override",
  "audit.read",
  /** Download the audit log as a CSV (capped, reasoned, itself audited). */
  "data.export",
  "security.read",
  /** Cron jobs, queues and recent failures. */
  "health.read",
  /** AI calls, cost and errors by model, route and workspace. */
  "usage.read",
  /** Stop or restart a paid area of the platform (text, images, video, search). */
  "emergency.manage",
  "flags.read",
  /** Create, change or switch off a feature flag. */
  "flags.manage",
  /** Write, schedule and end the messages shown to signed-in people. */
  "announcements.manage",
  /** Signups, activity, funnel and adoption, from stored rows. */
  "analytics.read",
  /** Connection state of social accounts and website connectors (never tokens). */
  "integrations.read",
  /** Find a user, workspace or job from one search box. */
  "lookup.read",
  /** Add a goodwill credit or video adjustment to an account. */
  "credits.grant",
  /** See which model answers each feature, and the spend caps. */
  "ai.read",
  /** Override the model or reasoning effort of a feature. */
  "ai.routing.manage",
  /** Set a platform-wide or per-workspace AI spend cap. */
  "ai.caps.manage",
  /** Background jobs across Studio, scans, experiments and Autopilot. */
  "jobs.read",
  /** Cancel or nudge a Studio job (the owning feature's own code runs). */
  "jobs.manage",
  /** Heuristic abuse candidates: signup bursts, cost spikes, failing users. */
  "abuse.read",
  "admins.read",
  "admins.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ADMIN_ROLE_KEYS = [
  "super_admin",
  "operations",
  "support",
  "finance",
  "engineering",
  "analyst",
] as const;

export type AdminRoleKey = (typeof ADMIN_ROLE_KEYS)[number];

export type AdminRolePreset = {
  label: string;
  description: string;
  permissions: readonly Permission[];
};

export const ROLE_PRESETS: Record<AdminRoleKey, AdminRolePreset> = {
  super_admin: {
    label: "Super admin",
    description: "Everything, including who else is an admin.",
    permissions: PERMISSIONS,
  },
  operations: {
    label: "Operations admin",
    description: "Runs accounts day to day: suspend, sign out, look into problems.",
    permissions: [
      "overview.read",
      "users.read",
      "users.pii.read",
      "users.suspend",
      "users.sessions.revoke",
      "users.notes.write",
      "workspaces.read",
      "workspaces.suspend",
      "support.impersonate",
      "entitlements.read",
      "entitlements.override",
      "audit.read",
      "data.export",
      "security.read",
      "health.read",
      "usage.read",
      "emergency.manage",
      "flags.read",
      "flags.manage",
      "announcements.manage",
      "analytics.read",
      "integrations.read",
      "lookup.read",
      "credits.grant",
      "ai.read",
      "ai.caps.manage",
      "jobs.read",
      "jobs.manage",
      "abuse.read",
    ],
  },
  support: {
    label: "Support admin",
    description: "Helps customers: look up accounts and leave notes.",
    permissions: [
      "overview.read",
      "users.read",
      "users.pii.read",
      "users.notes.write",
      "workspaces.read",
      "support.impersonate",
      "entitlements.read",
      "health.read",
      "flags.read",
      "integrations.read",
      "lookup.read",
      "jobs.read",
    ],
  },
  finance: {
    label: "Finance admin",
    description: "Reads accounts and the audit trail. Billing has its own console.",
    permissions: [
      "overview.read",
      "users.read",
      "workspaces.read",
      "entitlements.read",
      "audit.read",
      "data.export",
      "usage.read",
      "analytics.read",
      "credits.grant",
      "ai.read",
      "ai.caps.manage",
      "abuse.read",
    ],
  },
  engineering: {
    label: "Engineering admin",
    description: "Reads accounts, security and audit to investigate incidents.",
    permissions: [
      "overview.read",
      "users.read",
      "workspaces.read",
      "entitlements.read",
      "audit.read",
      "security.read",
      "health.read",
      "usage.read",
      "emergency.manage",
      "flags.read",
      "flags.manage",
      "analytics.read",
      "integrations.read",
      "lookup.read",
      "ai.read",
      "ai.routing.manage",
      "ai.caps.manage",
      "jobs.read",
      "jobs.manage",
      "abuse.read",
    ],
  },
  analyst: {
    label: "Read-only analyst",
    description: "Sees masked accounts and platform numbers. Changes nothing.",
    permissions: [
      "overview.read",
      "users.read",
      "workspaces.read",
      "entitlements.read",
      "health.read",
      "usage.read",
      "flags.read",
      "analytics.read",
      "integrations.read",
      "ai.read",
      "jobs.read",
      "abuse.read",
    ],
  },
};

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

export function isAdminRoleKey(value: unknown): value is AdminRoleKey {
  return typeof value === "string" && (ADMIN_ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * The permissions an admin really has: the role's preset plus granted extras,
 * minus denied ones. Unknown strings (from an old row) are ignored, never
 * trusted. An unknown role has no permissions.
 */
export function effectivePermissions(
  role: string,
  extra: readonly string[] = [],
  denied: readonly string[] = [],
): Permission[] {
  const preset = isAdminRoleKey(role) ? ROLE_PRESETS[role].permissions : [];
  const out = new Set<Permission>(preset);
  for (const permission of extra) if (isPermission(permission)) out.add(permission);
  for (const permission of denied) out.delete(permission as Permission);
  return PERMISSIONS.filter((permission) => out.has(permission));
}

export function hasPermission(
  granted: readonly Permission[] | ReadonlySet<Permission>,
  needed: Permission,
): boolean {
  return Array.isArray(granted)
    ? (granted as readonly Permission[]).includes(needed)
    : (granted as ReadonlySet<Permission>).has(needed);
}

/** Permissions that let someone change who is an admin: only a super admin keeps them. */
export const GOVERNANCE_PERMISSIONS: readonly Permission[] = ["admins.manage"];

/* ───────────────────────────── masking ───────────────────────────── */

/** "ada@example.com" → "a**@example.com". Anything that is not an email is hidden. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.lastIndexOf("@");
  if (at < 1) return "••••";
  const local = email.slice(0, at);
  return `${local[0]}${"•".repeat(Math.min(Math.max(local.length - 1, 2), 6))}${email.slice(at)}`;
}

/** Short stable label for a user id when no email may be shown. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
