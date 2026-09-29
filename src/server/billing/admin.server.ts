import "server-only";

import { HttpError } from "@/server/http-error";

/**
 * Mellox staff who may use the billing admin console. A comma-separated list
 * of Supabase user ids in BILLING_ADMIN_USER_IDS (MELLOX_ADMIN_USER_IDS is
 * accepted as the older name). Unset means nobody: the console fails closed.
 */
export function billingAdminIds(): string[] {
  const raw = [process.env.BILLING_ADMIN_USER_IDS, process.env.MELLOX_ADMIN_USER_IDS]
    .filter(Boolean)
    .join(",");
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

export function isBillingAdmin(userId: string | null | undefined): boolean {
  return Boolean(userId) && billingAdminIds().includes(String(userId));
}

export function requireBillingAdmin(userId: string): void {
  if (!isBillingAdmin(userId)) throw new HttpError(403, "Billing administrator access required.");
}
