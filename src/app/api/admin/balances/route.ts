import { defineAdminRoute } from "@/server/admin/route";
import { getBalances } from "@/server/admin/balances.server";

export const dynamic = "force-dynamic";

// Live OpenRouter / KIE balances; the Stripe balance only for billing admins.
export const GET = defineAdminRoute({
  name: "admin.balances",
  permission: "overview.read",
  handler: ({ admin }) => getBalances(admin.billing),
});
