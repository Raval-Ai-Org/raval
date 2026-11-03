import { defineAdminRoute } from "@/server/admin/route";
import { getOverview } from "@/server/admin/overview.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.overview",
  permission: "overview.read",
  handler: ({ can }) => getOverview(can("users.pii.read")),
});
