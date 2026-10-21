import { defineAdminRoute } from "@/server/admin/route";
import { getAbuseSignals } from "@/server/admin/abuse.server";

export const dynamic = "force-dynamic";

// Candidates only. Nothing here acts on anyone.
export const GET = defineAdminRoute({
  name: "admin.abuse.signals",
  permission: "abuse.read",
  handler: () => getAbuseSignals(),
});
