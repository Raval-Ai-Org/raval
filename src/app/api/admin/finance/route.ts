import { defineAdminRoute } from "@/server/admin/route";
import { requireBillingAdmin } from "@/server/billing/admin.server";
import { getFinanceOverview } from "@/server/admin/finance.server";

export const dynamic = "force-dynamic";

// Revenue figures: an admin with usage.read who is also a billing admin.
export const GET = defineAdminRoute({
  name: "admin.finance.overview",
  permission: "usage.read",
  handler: async ({ admin }) => {
    await requireBillingAdmin(admin.userId);
    return getFinanceOverview();
  },
});
