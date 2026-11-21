import { defineAdminRoute } from "@/server/admin/route";
import { getPulse } from "@/server/admin/pulse.server";

export const dynamic = "force-dynamic";

// Customers by plan, credits left, active time, activity and errors.
export const GET = defineAdminRoute({
  name: "admin.pulse",
  permission: "overview.read",
  handler: ({ can }) => getPulse(can("users.pii.read")),
});
