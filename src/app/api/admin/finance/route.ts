import { defineRoute } from "@/server/route";
import { requireBillingAdmin } from "@/server/billing/admin.server";
import { getFinanceOverview } from "@/server/admin/finance.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "admin.finance.overview",
  auth: "user",
  rateLimit: "billing-admin",
  handler: async ({ userId }) => {
    await requireBillingAdmin(userId);
    return getFinanceOverview();
  },
});
