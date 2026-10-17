import { defineAdminRoute } from "@/server/admin/route";
import { getIntegrations } from "@/server/admin/insight.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.integrations",
  permission: "integrations.read",
  handler: () => getIntegrations(),
});
