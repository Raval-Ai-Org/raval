import "server-only";

import { HttpError } from "@/server/http-error";
import { getEntitlements } from "./entitlements.server";
import { billingSchemaReady } from "./schema.server";

type EntitlementArgs = Parameters<typeof getEntitlements>[0];

/** Keep legacy workspace lifecycle available until the billing schema is deployed. */
export async function optionalWorkspaceEntitlements(args: EntitlementArgs) {
  if (!(await billingSchemaReady())) {
    if (process.env.BILLING_ENFORCEMENT !== "on") return null;
    throw new HttpError(503, "Plan & billing is being set up. Please try again later.");
  }
  return getEntitlements(args);
}
