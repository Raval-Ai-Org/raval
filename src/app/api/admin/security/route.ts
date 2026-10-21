import { defineAdminRoute } from "@/server/admin/route";
import { getSecurity } from "@/server/admin/team.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.security",
  permission: "security.read",
  handler: ({ can }) => getSecurity(can("users.pii.read")),
});
