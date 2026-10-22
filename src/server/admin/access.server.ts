// access.server.ts — who is a Mellox admin, and what they may do.
//
// Two ways in:
//   * a row in admin_users (status "active"): the role's permissions plus any
//     granted extras, minus denied ones;
//   * the older BILLING_ADMIN_USER_IDS allowlist (src/server/billing/admin.server.ts):
//     treated as super admin. It is also the way back in if the table is ever
//     empty or every row is disabled. Unset and no row means nobody.
import "server-only";
import {
  effectivePermissions,
  isAdminRoleKey,
  type AdminRoleKey,
  type Permission,
} from "@/lib/admin/permissions";
import { isBillingAdmin } from "@/server/billing/admin.server";
import { adminDb } from "./db.server";

export type AdminIdentity = {
  userId: string;
  role: AdminRoleKey;
  permissions: Permission[];
  /** Where the access comes from. */
  source: "team" | "environment";
  /** May open the existing billing console (it has its own allowlist check). */
  billing: boolean;
};

const SEEN_EVERY_MS = 5 * 60_000;

export async function resolveAdmin(userId: string): Promise<AdminIdentity | null> {
  const environmentBilling = isBillingAdmin(userId);
  const { data, error } = await adminDb
    .from("admin_users")
    .select("role,status,extra_permissions,denied_permissions,last_seen_at")
    .eq("user_id", userId)
    .maybeSingle();

  // A failed lookup must not lock out the break-glass list, and must not
  // grant anything to anyone else.
  if (error) console.error("[admin] could not read admin_users", error.message);

  const row = data as {
    role: string;
    status: string;
    extra_permissions: string[] | null;
    denied_permissions: string[] | null;
    last_seen_at: string | null;
  } | null;

  if (row && row.status === "active" && isAdminRoleKey(row.role)) {
    const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - seen > SEEN_EVERY_MS) {
      void Promise.resolve(
        adminDb
          .from("admin_users")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("user_id", userId),
      ).catch(() => undefined);
    }
    return {
      userId,
      role: row.role,
      permissions: effectivePermissions(
        row.role,
        row.extra_permissions ?? [],
        row.denied_permissions ?? [],
      ),
      source: "team",
      billing: environmentBilling || row.role === "super_admin",
    };
  }

  if (environmentBilling) {
    return {
      userId,
      role: "super_admin",
      permissions: effectivePermissions("super_admin"),
      source: "environment",
      billing: environmentBilling,
    };
  }
  return null;
}
