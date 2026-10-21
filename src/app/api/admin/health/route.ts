import { defineAdminRoute } from "@/server/admin/route";
import { getHealth } from "@/server/admin/health.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.health",
  permission: "health.read",
  handler: () => getHealth(),
});
