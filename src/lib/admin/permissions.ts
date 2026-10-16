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
  "audit.read",
  "security.read",
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
      "audit.read",
      "security.read",
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
    ],
  },
  finance: {
    label: "Finance admin",
    description: "Reads accounts and the audit trail. Billing has its own console.",
    permissions: ["overview.read", "users.read", "workspaces.read", "audit.read"],
  },
  engineering: {
    label: "Engineering admin",
    description: "Reads accounts, security and audit to investigate incidents.",
    permissions: ["overview.read", "users.read", "workspaces.read", "audit.read", "security.read"],
  },
  analyst: {
    label: "Read-only analyst",
    description: "Sees masked accounts and platform numbers. Changes nothing.",
    permissions: ["overview.read", "users.read", "workspaces.read"],
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
