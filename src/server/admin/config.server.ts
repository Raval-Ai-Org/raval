import "server-only";

/**
 * Whether admin routes demand a verified second factor (TOTP).
 *
 * On by default in production. Off by default elsewhere so a local database
 * without MFA still works; `ADMIN_REQUIRE_MFA=true|false` overrides either way.
 * Dangerous actions (see `danger` in defineAdminRoute) always ask for a recent
 * second-factor check when MFA is required.
 */
export function adminMfaRequired(): boolean {
  const explicit = process.env.ADMIN_REQUIRE_MFA?.trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.NODE_ENV === "production";
}
