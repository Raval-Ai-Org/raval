import { z } from "zod";
import { explainWorkspaceEntitlements } from "@/server/admin/entitlements.server";
import { defineAdminRoute } from "@/server/admin/route";

export const dynamic = "force-dynamic";

// What one workspace may do right now, why (plan or override), and the
// exceptions staff have set. Computed by the same resolver the product uses.
export const GET = defineAdminRoute({
  name: "admin.entitlements.view",
  permission: "entitlements.read",
  query: z.object({ workspaceId: z.string().uuid() }),
  handler: ({ query, can }) =>
    explainWorkspaceEntitlements(query.workspaceId, can("users.pii.read")),
});
